// Same legacy (polyfilled) pdf.js build as pdfParser.ts, which also configures its worker.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Worker as OcrWorker } from 'tesseract.js';
import { isOneEditApart, isStatementFirstPage, listedInvoiceNumbers, looksLikeStatementPage } from './pdfParser';

// OCR assets are served by the site itself from /ocr (see scripts/copy-ocr-assets.mjs).
const OCR_ASSET_DIR = 'ocr';

// Pages with less extractable text than this are treated as image-only
// (scanned, or "printed" to PDF with the text flattened) and sent to OCR.
const MIN_PAGE_CHARS = 30;

// Render at ~300 DPI (scale 4.17 of 72-DPI PDF units), the resolution OCR engines
// are tuned for. Statement unit numbers are tiny; at lower DPI digits get misread.
const RENDER_SCALE = 300 / 72;

// Invoice pages print their number in the header. When a statement already
// supplies each invoice's unit, date and total, reading just this top band of an
// invoice page is enough, and about 4x faster than reading the whole page.
const HEADER_BAND = 0.25;

// Pages are read in parallel, one OCR worker per CPU core (leaving one for the
// page itself) up to this cap. Each worker holds its own engine and model.
const MAX_WORKERS = 4;

/** Indexes of pages that carry no usable text layer and need OCR. */
export function pagesNeedingOcr(pagesText: string[]): number[] {
  return pagesText.flatMap((text, i) => ((text || '').trim().length < MIN_PAGE_CHARS ? [i] : []));
}

/**
 * OCR reads table cells and two-column headers line by line, so "INV-9725"
 * comes out as "INV-" on one line and "9725" on the next: at the start of the
 * next line in a statement table ("INV- check engine…" / "9725 leak in…"), or
 * at its end in an invoice header ("…DUE ON INV-" / "…RECEIPT 9725").
 * Re-attach each number to its prefix so the parser sees "INV-9725".
 */
export function joinWrappedInvoiceNumbers(text: string): string {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // OCR commonly misreads the leading "I" of "INV" as "1", "l" or "|".
    lines[i] = lines[i].replace(/(^|[^A-Za-z0-9])[1l|]NV(?=\s*[-–—])/g, '$1INV');

    // A prefix with no number after it on the same line.
    const dangling = /\b(INV|SO)\s*[-–—](?!\s*\d)/.exec(lines[i]);
    if (!dangling) continue;

    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length) continue;

    const prefixEndsLine = !lines[i].slice(dangling.index + dangling[0].length).trim();

    // Where the number sits: [line index, start offset, digits].
    let found: [number, number, string] | null = null;
    if (prefixEndsLine) {
      // Two-column invoice header. bigshop prints the number after "DUE ON
      // RECEIPT", and OCR may place the shop's address line in between
      // ("…ON INV-" / "FL « 32750" / "RECEIPT 9647"), so look for that first.
      for (let k = j, seen = 0; k < lines.length && seen < 3; k++) {
        if (!lines[k].trim()) continue;
        seen++;
        const receipt = /RECEIPT\s+(\d{3,10})\b/i.exec(lines[k]);
        if (receipt) {
          found = [k, receipt.index + receipt[0].length - receipt[1].length, receipt[1]];
          break;
        }
      }
      // Otherwise the number ends the next line, unless that is a postal code
      // following a state abbreviation ("FL « 32750").
      const trailing = /(\d{3,10})\s*$/.exec(lines[j]);
      if (!found && trailing && !/\b[A-Z]{2}\W{0,3}\d{5}\s*$/.test(lines[j])) {
        found = [j, trailing.index, trailing[1]];
      }
    }
    // In a statement table the number starts the next line.
    const leading = /^(\s*)(\d{3,10})\b/.exec(lines[j]);
    if (!found && leading) found = [j, leading[1].length, leading[2]];
    if (!found) continue;

    const [numberLine, start, digits] = found;
    lines[i] =
      lines[i].slice(0, dangling.index) +
      `${dangling[1]}-${digits}` +
      lines[i].slice(dangling.index + dangling[0].length);
    lines[numberLine] = lines[numberLine].slice(0, start) + lines[numberLine].slice(start + digits.length);
  }

  return lines.join('\n');
}

/**
 * Renders the given pages and reads their text with OCR, entirely in the
 * browser. `pagesText` is the text layer already extracted for every page.
 * Returns the recognised text keyed by 0-based page index.
 *
 * A batch's statement is read in full first: it lists every invoice with its
 * unit, date and total. Invoice pages are then read in parallel, and only
 * their header band, when it shows a single invoice number from that list.
 * Anything else (no statement, an unexpected or missing number) is read in full.
 */
export async function ocrPages(
  pdfBytes: Uint8Array,
  pageIndexes: number[],
  pagesText: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  if (pageIndexes.length === 0) return results;

  // Loaded on demand so ordinary text PDFs never download the OCR engine.
  const { createWorker, OEM } = await import('tesseract.js');
  const assetBase = new URL(`${OCR_ASSET_DIR}/`, document.baseURI).href.replace(/\/$/, '');
  const newWorker = () =>
    createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${assetBase}/worker.min.js`,
      corePath: assetBase,
      langPath: assetBase,
      gzip: true,
    });

  // The first worker downloads the model and caches it in the browser; the
  // extra workers start afterwards so they load it from that cache.
  const firstWorker = await newWorker();
  const workerCount = Math.min(MAX_WORKERS, Math.max(1, (navigator.hardwareConcurrency || 2) - 1), pageIndexes.length);
  const extraWorkers = Promise.all(Array.from({ length: workerCount - 1 }, newWorker));
  extraWorkers.catch(() => {}); // surfaced when awaited below; avoid an unhandled-rejection warning

  // Copy the bytes: pdf.js detaches the buffer it is given (see extractTextFromPdf).
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await loadingTask.promise;

  const readPage = async (worker: OcrWorker, pageIndex: number, headerOnly: boolean): Promise<string> => {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    // A shorter canvas simply clips the render to the header band.
    canvas.height = Math.ceil(viewport.height * (headerOnly ? HEADER_BAND : 1));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');

    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport }).promise;

    const { data } = await worker.recognize(canvas);
    // Release the bitmap right away; large batches otherwise hold many pages in memory.
    canvas.width = 0;
    canvas.height = 0;
    return joinWrappedInvoiceNumbers(data.text);
  };

  const targets = new Set(pageIndexes);
  const textOf = (i: number) => results.get(i) ?? pagesText[i] ?? '';
  const finish = (pageIndex: number, text: string) => {
    results.set(pageIndex, text);
    onProgress?.(results.size, pageIndexes.length);
  };

  try {
    onProgress?.(0, pageIndexes.length);

    // 1. The statement, read in full and in order: page 1, then any
    //    continuation pages of a statement that lists many invoices.
    const statementNumbers = new Set<string>();
    const headerText = new Map<number, string>(); // header bands already read
    if (targets.has(0)) finish(0, await readPage(firstWorker, 0, false));
    if (isStatementFirstPage(textOf(0))) {
      listedInvoiceNumbers(textOf(0)).forEach(n => statementNumbers.add(n));
      for (let i = 1; i < pagesText.length; i++) {
        if (targets.has(i)) {
          const header = await readPage(firstWorker, i, true);
          if (!looksLikeStatementPage(header)) {
            headerText.set(i, header);
            break;
          }
          finish(i, await readPage(firstWorker, i, false));
        } else if (!looksLikeStatementPage(textOf(i))) {
          break;
        }
        listedInvoiceNumbers(textOf(i)).forEach(n => statementNumbers.add(n));
      }
    }

    const onStatement = (n: string) =>
      statementNumbers.has(n) || [...statementNumbers].some(s => isOneEditApart(s, n));

    // 2. Everything else, in parallel across the workers.
    const workers = [firstWorker, ...(await extraWorkers)];
    const queue = pageIndexes.filter(i => !results.has(i));
    let next = 0;
    await Promise.all(
      workers.map(async worker => {
        while (next < queue.length) {
          const i = queue[next++];
          if (statementNumbers.size > 0) {
            const header = headerText.get(i) ?? (await readPage(worker, i, true));
            const listed = listedInvoiceNumbers(header);
            if (listed.length === 1 && /invoice/i.test(header) && onStatement(listed[0])) {
              finish(i, header);
              continue;
            }
          }
          finish(i, await readPage(worker, i, false));
        }
      })
    );
  } finally {
    // Terminate every worker, including extras that finished loading after a failure.
    const extras = await extraWorkers.catch(() => [] as OcrWorker[]);
    await Promise.all([firstWorker, ...extras].map(w => w.terminate()));
    await loadingTask.destroy();
  }

  return results;
}
