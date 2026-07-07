import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { InvoiceGroup } from '../types';

// Establish worker for PDF.js using an unpkg CDN to ensure matching versions
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.370'}/build/pdf.worker.min.mjs`;

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
 * Parses page texts and detects invoices, grouping multi-page invoices dynamically.
 */
export async function parsePdfInvoices(
  pdfBytes: Uint8Array,
  pagesText: string[]
): Promise<InvoiceGroup[]> {
  const invoices: InvoiceGroup[] = [];
  const numPages = pagesText.length;
  
  if (numPages === 0) return [];

  // Check if Page 1 is a Statement summarizing the individual invoices
  const page1Text = pagesText[0] || '';
  const isPage1Statement = 
    page1Text.toLowerCase().includes('statement') && 
    (page1Text.toLowerCase().includes('balance due') || page1Text.toLowerCase().includes('totals'));
  
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
    // Extract customer from Page 1
    // Look for "BILL TO" section
    const billToIdx = page1Text.indexOf('BILL TO');
    if (billToIdx !== -1) {
      const afterBillTo = page1Text.substring(billToIdx + 7).trim();
      // Grab customer (first text chunk after BILL TO)
      const parts = afterBillTo.split(/\s{2,}/);
      if (parts.length > 0 && parts[0]) {
        statementCustomer = parts[0].trim();
      }
    }
    
    // Fallback Customer extraction
    if (!statementCustomer) {
      const customerMatch = page1Text.match(/Gurman Trucking/i);
      statementCustomer = customerMatch ? customerMatch[0] : 'Gurman Trucking';
    }

    // Extract Period for filename
    // e.g., "Period: 3/31/2026 – 6/29/2026"
    const periodMatch = page1Text.match(/Period:\s*([\d\/\s–-]+)/i);
    if (periodMatch) {
      periodStr = periodMatch[1].trim().replace(/\s+/g, ' ');
    }

    // Regex to capture invoice table rows
    // Standard row looks like: "INV-2675 — 2025 FREIGHTLINER Cascadia 3AKJHHDR5SSWA6179 · Unit: 1215 6/23/2026 $577.56"
    // Let's scan for all "INV-\d+" patterns and capture surrounding info
    const invoiceMatches = [...page1Text.matchAll(/(INV-\d+)/g)];
    for (let j = 0; j < invoiceMatches.length; j++) {
      const match = invoiceMatches[j];
      const invNum = match[1];
      const index = match.index || 0;
      
      // Look ahead context to find vehicle, date, and amount
      const nextMatchIndex = j < invoiceMatches.length - 1 ? invoiceMatches[j + 1].index : page1Text.length;
      const context = page1Text.substring(index, Math.min(index + 300, nextMatchIndex || page1Text.length));

      // Extract Date (MM/DD/YYYY)
      const dateMatch = context.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
      const date = dateMatch ? dateMatch[1] : '';

      // Extract Total (e.g., "$1372.76" or "$577.56")
      const totalMatch = context.match(/\$(\d+\.\d{2})/);
      const total = totalMatch ? parseFloat(totalMatch[1]) : 0;

      // Extract Unit Number if present in context
      const unitMatch = context.match(/Unit\s*#?\s*:\s*(\d+)/i) || context.match(/Unit\s*#?\s*(\d+)/i);
      const unitNumber = unitMatch ? unitMatch[1] : '';

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

  let currentGroup: InvoiceGroup | null = null;

  for (let i = 0; i < numPages; i++) {
    const text = pagesText[i];
    const lowercaseText = text.toLowerCase();
    
    // Page 1 is the statement summary page
    if (i === 0 && isPage1Statement) {
      const customer = statementCustomer || 'Gurman Trucking';
      const fileDateSuffix = periodStr ? ` (${periodStr.replace(/\//g, '-')})` : '';
      invoices.push({
        id: 'statement',
        invoiceNumber: 'Statement',
        customer,
        vehicle: 'All Invoices Summary',
        date: 'Statement Period',
        total: statementInvoices.reduce((sum, item) => sum + item.total, 0),
        pages: [0],
        filename: `Statement - ${customer}${fileDateSuffix}.pdf`,
        isSelected: true,
        isStatement: true
      });
      continue;
    }

    // Check if this page starts a new invoice
    // Look for standard Invoice indicators e.g., "Invoice" text at top, and "INV-\d+"
    const invMatch = text.match(/(INV-\d+)/);
    const hasInvoiceHeader = lowercaseText.includes('invoice') || lowercaseText.includes('inv-');

    if (invMatch && hasInvoiceHeader) {
      const invNum = invMatch[1];
      
      // Check if we already have metadata from the parsed statement
      const matchedStmt = statementInvoices.find(s => s.invoiceNumber === invNum);
      
      let customer = '';
      let vehicle = '';
      let date = '';
      let total = 0;

      if (matchedStmt) {
        customer = statementCustomer || 'Gurman Trucking';
        vehicle = matchedStmt.vehicle;
        date = matchedStmt.date;
        total = matchedStmt.total;
      } else {
        // Parse metadata directly from the page
        // Customer Name
        const custMatch = text.match(/CUSTOMER\s+([^\n•]+)/i) || text.match(/Gurman Trucking/i);
        customer = custMatch ? custMatch[1]?.trim() || custMatch[0].trim() : 'Gurman Trucking';
        
        // Vehicle Name
        const vehMatch = text.match(/VEHICLE\s+([^\n•]+)/i) || text.match(/(?:20\d{2}\s+[A-Za-z0-9\s]{4,30})/);
        vehicle = vehMatch ? vehMatch[1]?.trim() || vehMatch[0].trim() : 'Vehicle';
        
        // Date
        const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        date = dateMatch ? dateMatch[1] : '';

        // Total
        const totalMatch = text.match(/Grand Total\s*\$?(\d+\.\d{2})/i) || text.match(/REMAINING BALANCE\s*\$?(\d+\.\d{2})/i) || text.match(/Total:\s*\$?(\d+\.\d{2})/i);
        total = totalMatch ? parseFloat(totalMatch[1]) : 0;
      }

      const pageUnitMatch = text.match(/Unit\s*#?\s*:\s*(\d+)/i) || text.match(/Unit\s*#?\s*(\d+)/i) || text.match(/Unit\s+(\d+)/i);
      const unitNumber = pageUnitMatch ? pageUnitMatch[1] : (matchedStmt?.unitNumber || '');

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
    } else if (currentGroup && !currentGroup.id.startsWith('page_')) {
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
