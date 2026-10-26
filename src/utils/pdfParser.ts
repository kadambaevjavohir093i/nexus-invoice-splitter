import { PDFDocument } from 'pdf-lib';
// pdf.js's default build relies on very new built-ins (e.g. Map.getOrInsertComputed)
// and fails when rendering pages in browsers that lack them. The legacy build
// bundles polyfills for those, so the app works across current browsers.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { InvoiceGroup } from '../types';

// Establish worker for PDF.js using an unpkg CDN to ensure matching versions
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.370'}/legacy/build/pdf.worker.min.mjs`;

/**
 * Extracts raw text page by page from a PDF Uint8Array.
 */
export async function extractTextFromPdf(pdfBytes: Uint8Array): Promise<string[]> {
  try {
    // pdf.js transfers (detaches) the input ArrayBuffer to its worker. If we
    // passed the caller's array directly, that same array — which the app also
    // keeps for later page-splitting — would be left empty, producing blank
    // output PDFs. Hand pdf.js a copy so the caller's bytes stay intact.
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const pagesText: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const textItems = textContent.items.map((item: any) => item.str);
        pagesText.push(textItems.join(' '));
      } catch (pageErr) {
        console.warn(`Error extracting text from page ${i}:`, pageErr);
        pagesText.push(''); // Add blank page text fallback
      }
    }
    return pagesText;
  } catch (error) {
    console.error("Error extracting PDF text: ", error);
    throw new Error("Failed to parse PDF text. Please make sure it's a valid text-based PDF.");
  }
}

/**
 * PDF text layers frequently break an invoice number into separate text items,
 * so the extracted text reads "INV- 2845" or even "SO- 0000006 4" instead of
 * "INV-2845" / "SO-00000064". Repair those tokens before any matching so a
 * single invoice is recognised no matter how the PDF happened to encode it.
 */
function normalizeInvoiceNumbers(text: string): string {
  return text
    // "INV - 2845" / "INV- 2845" -> "INV-2845"
    .replace(/\b(INV|SO)\s*-\s*/gi, (_m, prefix: string) => `${prefix.toUpperCase()}-`)
    // "SO-0000006 4" -> "SO-00000064" (digits split across text items).
    // Only single-space splits are joined, so table columns separated by wider
    // gaps (e.g. "INV-2845   —   ... 7/15/2026") are never merged by accident.
    .replace(/\b(INV|SO)-(\d+(?: \d+)+)/gi, (whole, prefix: string, digits: string) => {
      const joined = digits.replace(/ /g, '');
      return joined.length <= 12 ? `${prefix.toUpperCase()}-${joined}` : whole;
    });
}

// Invoice identifiers come in both "INV-####" and "SO-########" flavours.
const INVOICE_NUMBER_RE = /\b((?:INV|SO)-\d+)/;
const INVOICE_NUMBER_RE_G = /\b((?:INV|SO)-\d+)/g;

/**
 * Statements printed from bigshop carry a browser header on every page such as
 * "Statement - US MEGA (2026-07-14 to 2026-10-12)". It names the customer
 * exactly and survives OCR, unlike the small "BILL TO" label.
 */
function customerFromStatementHeader(text: string): string {
  const m = text.match(/Statement\s*[-–]\s*([^()\n]{2,60}?)\s*\(\d{4}-\d{2}-\d{2}/);
  return m ? m[1].trim() : '';
}

// Unit IDs are usually numeric ("1326") but can be alphanumeric ("PTLZ262100").
function extractUnitNumber(text: string): string {
  const m =
    text.match(/Unit\s*#?\s*:\s*([A-Z]*\d[A-Z0-9]*)/i) ||
    text.match(/Unit\s*#?\s*([A-Z]*\d[A-Z0-9]*)/i);
  return m ? m[1] : '';
}

// Dollar amounts may carry thousands separators: "$1,264.75".
const parseAmount = (s: string) => parseFloat(s.replace(/,/g, ''));

/**
 * A statement page lists several invoices, or carries the statement's totals
 * block (on its last page). Invoice pages show a single invoice number.
 */
function looksLikeStatementPage(text: string): boolean {
  const listed = new Set([...text.matchAll(INVOICE_NUMBER_RE_G)].map(m => m[1]));
  return listed.size >= 2 || /\btotals\b|paid to date|total amount/i.test(text);
}

/** True when two invoice numbers differ by exactly one inserted, deleted or changed character. */
function isOneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  return endA - start + 1 <= 1 && endB - start + 1 <= 1;
}

/**
 * True when a PDF actually carries text we can parse.
 *
 * Scanned PDFs, and PDFs "printed" through a virtual PDF printer with every
 * character flattened into outlines, have no text layer; the app reads those
 * pages with OCR first. If a document still has essentially no text after that,
 * invoice detection would silently degrade into one meaningless "Page N" entry
 * per page, so the caller rejects it with an explanation instead.
 */
export function hasExtractableText(pagesText: string[]): boolean {
  const totalChars = pagesText.reduce((sum, t) => sum + (t || '').trim().length, 0);
  // A genuine invoice page carries hundreds of characters; this threshold only
  // rejects documents with essentially nothing extractable at all.
  return totalChars >= 50;
}

/**
 * Parses page texts and detects invoices, grouping multi-page invoices dynamically.
 * `ocrPageIndexes` lists pages whose text came from OCR rather than the PDF's text layer.
 */
export async function parsePdfInvoices(
  pdfBytes: Uint8Array,
  pagesText: string[],
  { ocrPageIndexes = [] }: { ocrPageIndexes?: number[] } = {}
): Promise<InvoiceGroup[]> {
  const invoices: InvoiceGroup[] = [];
  const numPages = pagesText.length;

  if (numPages === 0) return [];

  // Work on repaired text throughout so split invoice-number tokens still match.
  const normalizedPages = pagesText.map(t => normalizeInvoiceNumbers(t || ''));
  const ocrPageSet = new Set(ocrPageIndexes);

  // Check if Page 1 is a Statement summarizing the individual invoices. Judge it
  // by structure too, not only by the "Balance Due" heading: OCR can misread that
  // small label, and "TOTALS" only appears on the last page of a long statement.
  const page1Text = normalizedPages[0] || '';
  const isPage1Statement =
    page1Text.toLowerCase().includes('statement') &&
    (page1Text.toLowerCase().includes('balance due') || looksLikeStatementPage(page1Text));

  // A statement listing many invoices runs over several pages; keep them all.
  const statementPageIdx: number[] = [];
  if (isPage1Statement) {
    statementPageIdx.push(0);
    while (statementPageIdx.length < numPages && looksLikeStatementPage(normalizedPages[statementPageIdx.length])) {
      statementPageIdx.push(statementPageIdx.length);
    }
  }
  const statementPageSet = new Set(statementPageIdx);
  const statementText = statementPageIdx.map(i => normalizedPages[i]).join('\n');
  
  interface StatementRow {
    invoiceNumber: string;
    vehicle: string;
    date: string;
    total: number;
    unitNumber?: string;
  }
  
  const statementInvoices: StatementRow[] = [];
  let statementCustomer = '';
  let periodStr = '';

  if (isPage1Statement) {
    // Extract customer from Page 1: the printed page header is the most
    // reliable source, then the "BILL TO" section.
    statementCustomer = customerFromStatementHeader(page1Text);
    const billToIdx = page1Text.indexOf('BILL TO');
    if (!statementCustomer && billToIdx !== -1) {
      const afterBillTo = page1Text.substring(billToIdx + 7).trim();
      // Grab customer (first text chunk after BILL TO)
      const parts = afterBillTo.split(/\s{2,}/);
      if (parts.length > 0 && parts[0]) {
        statementCustomer = parts[0].trim();
      }
    }

    // Extract Period for filename
    // e.g., "Period: 3/31/2026 – 6/29/2026"
    const periodMatch = page1Text.match(/Period:\s*([\d\/\s–-]+)/i);
    if (periodMatch) {
      periodStr = periodMatch[1].trim().replace(/\s+/g, ' ');
    }

    // Regex to capture invoice table rows
    // Standard row looks like: "INV-2675 — 2025 FREIGHTLINER Cascadia 3AKJHHDR5SSWA6179 · Unit: 1215 6/23/2026 $577.56"
    // Let's scan for all invoice-number patterns and capture surrounding info
    const invoiceMatches = [...statementText.matchAll(INVOICE_NUMBER_RE_G)];
    for (let j = 0; j < invoiceMatches.length; j++) {
      const match = invoiceMatches[j];
      const invNum = match[1];
      const index = match.index || 0;

      // Look ahead context to find vehicle, date, and amount
      const nextMatchIndex = j < invoiceMatches.length - 1 ? invoiceMatches[j + 1].index : statementText.length;
      const context = statementText.substring(index, Math.min(index + 300, nextMatchIndex || statementText.length));

      // Extract Date (MM/DD/YYYY)
      const dateMatch = context.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      const date = dateMatch ? dateMatch[1] : '';

      // Extract Total (e.g., "$1372.76" or "$1,264.75")
      const totalMatch = context.match(/\$([\d,]+\.\d{2})/);
      const total = totalMatch ? parseAmount(totalMatch[1]) : 0;

      // Extract Unit Number if present in context
      const unitNumber = extractUnitNumber(context);

      // Extract Vehicle Name
      // It sits between "INV-XXXX — " (or space) and the date or VIN
      let vehicle = '';
      const cleanContext = context.replace(invNum, '').replace(/[—_·]/g, ' ').trim();
      
      // Let's match typical truck patterns, or take the words leading to the date/unit
      const vehicleMatch = cleanContext.match(/^[\s]*([A-Z0-9\s]{4,30}?)(?:\s+\d{1,2}\/|Unit:|VIN:)/i);
      if (vehicleMatch) {
        vehicle = vehicleMatch[1].trim();
      } else {
        // Fallback: try scanning for VOLVO or FREIGHTLINER
        if (cleanContext.match(/freightliner/i)) {
          vehicle = 'FREIGHTLINER Cascadia';
        } else if (cleanContext.match(/volvo/i)) {
          vehicle = 'VOLVO TRUCK VNL';
        } else {
          vehicle = 'Vehicle';
        }
      }

      statementInvoices.push({
        invoiceNumber: invNum,
        vehicle,
        date,
        total,
        unitNumber
      });
    }
  }

  const statementNumbers = statementInvoices.map(s => s.invoiceNumber);

  /**
   * OCR occasionally misreads one character of an invoice number ("9954" read
   * as "9934"), which would split one invoice across two files. When an OCR'd
   * number isn't on the statement but is one edit away from a number that is,
   * use the statement's number — preferring the invoice currently being read,
   * so its continuation pages stay with it.
   */
  const snapToStatementNumber = (invNum: string, currentNumber?: string): string => {
    if (statementNumbers.length === 0 || statementNumbers.includes(invNum)) return invNum;
    const near = statementNumbers.filter(n => isOneEditApart(n, invNum));
    if (currentNumber && near.includes(currentNumber)) return currentNumber;
    return near.length === 1 ? near[0] : invNum;
  };

  let currentGroup: InvoiceGroup | null = null;

  for (let i = 0; i < numPages; i++) {
    const text = normalizedPages[i];
    const lowercaseText = text.toLowerCase();

    // The statement summary: page 1, plus any continuation pages of a long statement
    if (statementPageSet.has(i)) {
      if (i > 0) continue; // already included in the statement group's pages
      const customer = statementCustomer;
      const fileDateSuffix = periodStr ? ` (${periodStr.replace(/\//g, '-')})` : '';
      const statementGroup: InvoiceGroup = {
        id: 'statement',
        invoiceNumber: 'Statement',
        customer,
        vehicle: 'All Invoices Summary',
        date: 'Statement Period',
        total: statementInvoices.reduce((sum, item) => sum + item.total, 0),
        pages: [...statementPageIdx],
        filename: `Statement${customer ? ` - ${customer}` : ''}${fileDateSuffix}.pdf`,
        isSelected: true,
        isStatement: true
      };
      invoices.push(statementGroup);
      // Keep the statement as the current group so a multi-page statement's
      // continuation pages are appended to it instead of becoming their own
      // standalone "Page X" files.
      currentGroup = statementGroup;
      continue;
    }

    // Check if this page starts a new invoice
    // Look for standard Invoice indicators e.g., "Invoice" text at top, and "INV-\d+"
    const invMatch = text.match(INVOICE_NUMBER_RE);
    const hasInvoiceHeader =
      lowercaseText.includes('invoice') || lowercaseText.includes('inv-') || lowercaseText.includes('so-');

    if (invMatch && hasInvoiceHeader) {
      // Text-layer numbers are exact; only OCR'd numbers are corrected.
      const invNum = ocrPageSet.has(i)
        ? snapToStatementNumber(invMatch[1], currentGroup?.isStatement ? undefined : currentGroup?.invoiceNumber)
        : invMatch[1];

      // Multi-page invoices often repeat the invoice number on every page.
      // If we've already opened a group for this number, this page is a
      // continuation of that invoice — not a new one.
      const existingGroup = invoices.find(g => !g.isStatement && g.invoiceNumber === invNum);
      if (existingGroup) {
        existingGroup.pages.push(i);
        currentGroup = existingGroup;
        continue;
      }

      // Check if we already have metadata from the parsed statement
      const matchedStmt = statementInvoices.find(s => s.invoiceNumber === invNum);
      
      let customer = '';
      let vehicle = '';
      let date = '';
      let total = 0;

      if (matchedStmt) {
        customer = statementCustomer || customerFromStatementHeader(text);
        vehicle = matchedStmt.vehicle;
        date = matchedStmt.date;
        total = matchedStmt.total;
      } else {
        // Parse metadata directly from the page
        // Customer Name
        const custMatch = text.match(/CUSTOMER\s+([^\n•]+)/i);
        customer = custMatch ? custMatch[1].trim() : statementCustomer || customerFromStatementHeader(text);
        
        // Vehicle Name
        const vehMatch = text.match(/VEHICLE\s+([^\n•]+)/i) || text.match(/(?:20\d{2}\s+[A-Za-z0-9\s]{4,30})/);
        vehicle = vehMatch ? vehMatch[1]?.trim() || vehMatch[0].trim() : 'Vehicle';
        
        // Date
        const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        date = dateMatch ? dateMatch[1] : '';

        // Total
        const totalMatch = text.match(/Grand Total\s*\$?([\d,]+\.\d{2})/i) || text.match(/REMAINING BALANCE\s*\$?([\d,]+\.\d{2})/i) || text.match(/Total:\s*\$?([\d,]+\.\d{2})/i);
        total = totalMatch ? parseAmount(totalMatch[1]) : 0;
      }

      // Prefer the statement's unit: it sits alone in a clean table cell, while
      // the invoice page prints it beside the mileage ("Unit #: 1159 • 0 mi"),
      // which OCR can fuse into "11590".
      const unitNumber = matchedStmt?.unitNumber || extractUnitNumber(text);

      currentGroup = {
        id: invNum,
        invoiceNumber: invNum,
        customer,
        vehicle,
        date,
        total,
        pages: [i],
        filename: `${invNum} - ${customer}.pdf`, // Dynamic default
        isSelected: true,
        isStatement: false,
        unitNumber
      };
      invoices.push(currentGroup);
    } else if (
      currentGroup &&
      !currentGroup.id.startsWith('page_') &&
      // A page only continues the statement when it still reads like the
      // statement itself. Otherwise a failure to recognise invoice pages would
      // silently sweep the whole document into the Statement file.
      (!currentGroup.isStatement || (lowercaseText.includes('statement') && !lowercaseText.includes('invoice')))
    ) {
      // Continuation page! Group it with the current invoice
      currentGroup.pages.push(i);
    } else {
      // Unassigned standalone page (e.g. cover letter or statement sheet without summary)
      currentGroup = {
        id: `page_${i + 1}`,
        invoiceNumber: `Page ${i + 1}`,
        customer: 'Document Page',
        vehicle: 'Standalone Sheet',
        date: '',
        total: 0,
        pages: [i],
        filename: `Invoice Page ${i + 1}.pdf`,
        isSelected: true,
        isStatement: false
      };
      invoices.push(currentGroup);
    }
  }

  return invoices;
}

/**
 * Creates a split PDF by extracting a specific set of page numbers from an original PDF.
 * If the PDF is encrypted/restricted, uses a high-fidelity rendering pipeline via PDF.js to bypass restrictions.
 */
export async function splitPdfPages(
  originalPdfBytes: Uint8Array,
  pages: number[]
): Promise<Uint8Array> {
  // Check if PDF has a valid header (%PDF-)
  const hasPdfHeader = (bytes: Uint8Array): boolean => {
    if (!bytes || bytes.length < 5) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  };

  let bytesToLoad = originalPdfBytes;
  if (!hasPdfHeader(bytesToLoad)) {
    console.warn("Invalid or missing PDF header in splitPdfPages. Generating fallback dummy PDF.");
    const fallbackDoc = await PDFDocument.create();
    fallbackDoc.addPage([612, 792]);
    bytesToLoad = await fallbackDoc.save();
  }

  try {
    let originalDoc;
    let isEncrypted = false;

    // 1. First attempt to load PDF without ignoreEncryption.
    // If it's encrypted or restricted, it will throw an error, which alerts us to use the rendering pipeline.
    try {
      originalDoc = await PDFDocument.load(bytesToLoad);
    } catch (loadErr: any) {
      const errMsg = String(loadErr.message || loadErr).toLowerCase();
      if (errMsg.includes('encrypted') || errMsg.includes('password') || errMsg.includes('decrypt') || errMsg.includes('encryption')) {
        isEncrypted = true;
      } else {
        // Try with ignoreEncryption as backup
        try {
          originalDoc = await PDFDocument.load(bytesToLoad, { ignoreEncryption: true });
          // If load succeeds for a non-encryption error, it is NOT encrypted. We should keep isEncrypted as false
          // to utilize native, fast and perfect vector copyPages.
          isEncrypted = false;
        } catch (innerErr) {
          throw loadErr;
        }
      }
    }

    // 2. If PDF is encrypted/restricted, fall back to high-fidelity PDF.js Canvas Rendering.
    // This renders each page onto an image, creating a crisp, unencrypted vector-wrapped PDF.
    if (isEncrypted) {
      console.log("Encrypted or restricted PDF detected. Initiating high-resolution rendering pipeline...");
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytesToLoad) });
      const pdf = await loadingTask.promise;
      const newDoc = await PDFDocument.create();

      const validPages = pages.filter(p => p >= 0 && p < pdf.numPages);
      const pagesToExtract = validPages.length > 0 ? validPages : (pdf.numPages > 0 ? [0] : []);

      for (const pageNum of pagesToExtract) {
        const page = await pdf.getPage(pageNum + 1);
        
        // Use 2.5x high-resolution scaling for pristine crispness (looks identical to original printout)
        const viewport = page.getViewport({ scale: 2.5 });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Ensure standard solid white background
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        await page.render({
          canvas: canvas,
          viewport: viewport
        }).promise;
        
        const imgDataUrl = canvas.toDataURL('image/jpeg', 0.95);
        const base64Data = imgDataUrl.split(',')[1];
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const imgBytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          imgBytes[j] = binaryStr.charCodeAt(j);
        }
        
        const embeddedImage = await newDoc.embedJpg(imgBytes);
        const newPage = newDoc.addPage([viewport.width, viewport.height]);
        newPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
        });
      }
      
      return await newDoc.save();
    }

    // 3. For normal PDFs, proceed with extremely fast native copyPages!
    if (!originalDoc) {
      throw new Error("Unable to parse source PDF document.");
    }

    const newDoc = await PDFDocument.create();
    const pageCount = originalDoc.getPageCount();
    const validPages = pages.filter(p => p >= 0 && p < pageCount);
    const pagesToExtract = validPages.length > 0 ? validPages : (pageCount > 0 ? [0] : []);
    
    if (pagesToExtract.length > 0) {
      const copiedPages = await newDoc.copyPages(originalDoc, pagesToExtract);
      copiedPages.forEach((page) => newDoc.addPage(page));
    } else {
      newDoc.addPage([612, 792]);
    }
    
    return await newDoc.save();
  } catch (error) {
    console.error("Error in splitPdfPages, generating high-fidelity fallback:", error);
    
    // Critical Fallback Pipeline: Force PDF.js image rendering
    try {
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytesToLoad) });
      const pdf = await loadingTask.promise;
      const newDoc = await PDFDocument.create();
      
      const validPages = pages.filter(p => p >= 0 && p < pdf.numPages);
      const pagesToExtract = validPages.length > 0 ? validPages : (pdf.numPages > 0 ? [0] : []);
      
      for (const pageNum of pagesToExtract) {
        const page = await pdf.getPage(pageNum + 1);
        const viewport = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        await page.render({
          canvas: canvas,
          viewport: viewport
        }).promise;
        
        const imgDataUrl = canvas.toDataURL('image/jpeg', 0.95);
        const base64Data = imgDataUrl.split(',')[1];
        const binaryStr = atob(base64Data);
        const len = binaryStr.length;
        const imgBytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          imgBytes[j] = binaryStr.charCodeAt(j);
        }
        
        const embeddedImage = await newDoc.embedJpg(imgBytes);
        const newPage = newDoc.addPage([viewport.width, viewport.height]);
        newPage.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
        });
      }
      return await newDoc.save();
    } catch (fallbackErr) {
      console.error("Critical fallback failure in PDF split pipeline:", fallbackErr);
      const fallbackDoc = await PDFDocument.create();
      fallbackDoc.addPage([612, 792]);
      return await fallbackDoc.save();
    }
  }
}
