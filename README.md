# Nexus Invoice Splitter

Split a BigShop batch **carrier statement** (one big PDF holding many invoices) into
**one PDF per truck** — same layout as the original, named `INV-####_Unit-####.pdf`,
organized into a per-carrier zip.

Everything runs **in the browser**. The PDFs never leave the device — which matters for
carrier billing data. No server, no API key, no upload.

## How it works

BigShop statements have **no text layer** (every glyph is drawn as a vector outline), so
ordinary text extraction reads nothing. Instead:

1. **pdf.js** renders the top strip of each page to a canvas.
2. **Tesseract.js** OCRs that strip to read the invoice number, unit, carrier, and vehicle.
3. Consecutive pages sharing an invoice number are grouped into one invoice.
4. **pdf-lib** copies those original pages into a new PDF — *lossless*, so each output
   invoice is pixel-identical to the source.
5. **JSZip** packages everything under `<Carrier>/INV-####_Unit-####.pdf`.

## Run locally

```bash
npm install
npm start
# open http://localhost:8080
```

Or just open `public/index.html` directly in a browser — the server is only there so it
has something to host. An internet connection is needed on first use to load the libraries
and the (cached) English OCR model.

## Deploy to Cloud Run

```bash
gcloud run deploy nexus-invoice-splitter \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

(The included `Dockerfile` builds a Node 20 image serving the static app on `$PORT`.)

## Use as a Telegram Mini App

Point your Mini App / web-app button at the deployed URL — the UI is responsive and
self-contained, so it works as-is inside Telegram.

## Notes

- **Multiple statements at once** — drop several PDFs; each is grouped under its own carrier.
- **Sales orders** (`SO-########`) with no vehicle are handled; unit falls back to `NA`.
- **Accuracy** — OCR on these clean, computer-rendered headers is effectively exact. If a
  carrier or unit ever reads wrong, it's an OCR edge case; re-running usually resolves it.
- Tuned for the Nexus/BigShop statement layout. A very different invoice template would need
  the header regexes in `parseHeader()` adjusted.
