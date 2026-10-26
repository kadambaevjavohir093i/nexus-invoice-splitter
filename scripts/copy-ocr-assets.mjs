// Copies the OCR worker, engine and English model into public/ocr so the site
// serves them itself. Scanned PDFs are then read entirely in the browser, with
// no dependency on a third-party CDN. Runs automatically before dev and build.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const outDir = new URL('public/ocr/', root);
mkdirSync(outDir, { recursive: true });

const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // tesseract.js picks one engine build per browser, depending on SIMD support.
  // Only the LSTM-only variants are needed because the app runs in LSTM mode.
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

for (const [src, name] of assets) {
  copyFileSync(fileURLToPath(new URL(src, root)), fileURLToPath(new URL(name, outDir)));
}

console.log(`Copied ${assets.length} OCR assets to public/ocr`);
