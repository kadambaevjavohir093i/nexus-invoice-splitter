// Same legacy (polyfilled) pdf.js build as pdfParser.ts, which also configures its worker.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// OCR assets are served by the site itself from /ocr (see scripts/copy-ocr-assets.mjs).
const OCR_ASSET_DIR = 'ocr';

// Pages with less extractable text than this are treated as image-only
// (scanned, or "printed" to PDF with the text flattened) and sent to OCR.
const MIN_PAGE_CHARS = 30;

// Render at ~300 DPI (scale 4.17 of 72-DPI PDF units), the resolution OCR engines
// are tuned for. Statement unit numbers are tiny; at lower DPI digits get misread.
const RENDER_SCALE = 300 / 72;

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
    // In a two-column header the number ends the next line; in a table it starts it.
    const numberMatch =
      (prefixEndsLine ? /(\d{3,10})\s*$/.exec(lines[j]) : null) || /^\s*(\d{3,10})\b/.exec(lines[j]);
    if (!numberMatch) continue;

    lines[i] =
      lines[i].slice(0, dangling.index) +
      `${dangling[1]}-${numberMatch[1]}` +
      lines[i].slice(dangling.index + dangling[0].length);
    lines[j] = lines[j].slice(0, numberMatch.index) + lines[j].slice(numberMatch.index + numberMatch[0].length);
  }

  return lines.join('\n');
}

/**
 * Renders the given pages and reads their text with OCR, entirely in the
 * browser. Returns the recognised text keyed by 0-based page index.
 */
export async function ocrPages(
  pdfBytes: Uint8Array,
  pageIndexes: number[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  if (pageIndexes.length === 0) return results;

  // Loaded on demand so ordinary text PDFs never download the OCR engine.
  const { createWorker, OEM } = await import('tesseract.js');
  const assetBase = new URL(`${OCR_ASSET_DIR}/`, document.baseURI).href.replace(/\/$/, '');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${assetBase}/worker.min.js`,
    corePath: assetBase,
    langPath: assetBase,
    gzip: true,
  });

  // Copy the bytes: pdf.js detaches the buffer it is given (see extractTextFromPdf).
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
  const pdf = await loadingTask.promise;

  try {
    for (let n = 0; n < pageIndexes.length; n++) {
      onProgress?.(n, pageIndexes.length);

      const page = await pdf.getPage(pageIndexes[n] + 1);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) continue;

      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;

      const { data } = await worker.recognize(canvas);
      results.set(pageIndexes[n], joinWrappedInvoiceNumbers(data.text));

      // Release the bitmap right away; large batches otherwise hold many pages in memory.
      canvas.width = 0;
      canvas.height = 0;
    }
    onProgress?.(pageIndexes.length, pageIndexes.length);
  } finally {
    await worker.terminate();
    await loadingTask.destroy();
  }

  return results;
}
