# Folio

A document reader with local text extraction, scanned-page recognition, and browser read-aloud.

## Run

Requires Node 22.13 or newer. Install with `npm ci`, then run `npm run dev`. Build with `npm run build`. The prebuild script copies version-matched PDF and OCR workers into the public directory.

## Supported input

- PDF: extract embedded text; recognize scanned pages automatically. “Recognize every PDF page” handles pages with both images and digital text. Password-protected PDFs require an unlocked copy.
- DOCX: extract paragraph text with Mammoth. Embedded pictures in Word files are not recognized; export these documents to PDF first.
- TXT, Markdown, CSV, and log files: plain text.
- PNG, JPG, WEBP, BMP, GIF: text recognition. Only a still frame is read from animated images.
- Pasted text: up to 1 million characters.

Limits: 50 MB per file, 250 PDF pages, 1 million extracted characters per document. Very complex layouts and handwriting can require corrections with the page text editor. Multiple files open sequentially. Import can be canceled.

## Read-aloud

Uses the device's Web Speech API. Voices vary by browser and operating system. Online voices may send document text to the device's speech provider. Playback uses short passages; pause cancels the current passage and resume repeats it from its beginning. Highlighting tracks passages rather than exact words. Keep the page open while listening; background playback depends on browser behavior.

Files and extracted text remain in memory for this browser session. Refreshing closes the documents. The text download saves the extracted text. OCR language data downloads from the Tesseract project's CDN on first use and may be cached by the browser. Files are not uploaded to Folio's server.

## Validation

`node --test tests/reader.test.mjs` checks speech cancellation and stale callbacks, document replacement, blank pages, Unicode-safe chunking, PDF font-run spacing, and worker cancellation/timeouts. `npx tsc --noEmit` checks types.

Standalone library checks passed for a two-page PDF, a rendered scanned PDF, a known-text PNG, and a DOCX containing literal script text. Image and scanned-PDF OCR returned the expected text at 95% reported confidence. These checks do not establish audible playback in a real browser. No browser is available in this build environment for listening or visual QA.

Optional WebMCP tools insert pasted text and read selected-document metadata when the host browser supports document.modelContext. No supported WebMCP validation context was available, so this optional interface is unverified.
