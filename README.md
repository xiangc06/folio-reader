# Folio

A document reader with local text extraction, scanned-page recognition, and browser read-aloud.

## Run

Requires Node 22.13 or newer. Install with `npm ci`, then run `npm run dev`. Build with `npm run build`. The prebuild script copies version-matched PDF and OCR workers into the public directory.

## Supported input

- PDF: **Optical OCR is the default.** Every page is rendered to an image at up to 300 dpi (bounded to 3600 pixels per side), then recognized. This path never calls PDF text extraction and ignores embedded text mappings, including long printable gibberish. It works when text looks correct on the rendered page but copying or extracting it produces wrong characters. Font substitution is enabled for unembedded fonts; OCR cannot reliably restore glyphs that are missing or wrong in the rendered image itself.
- Optional **PDF text with automatic OCR** extracts embedded text first. Scans, extraction exceptions, replacement characters, invalid control characters, and private-use mappings trigger recognition. Automatic detection cannot catch every plausible but incorrect character map; use optical mode in those cases. It never silently falls back to a known broken text map after recognition fails.
- **Read PDF visually / Run OCR again** reprocesses the selected PDF using the selected language without choosing its file again. The original File stays in browser memory for the session. Existing text and corrections are replaced only after the whole import succeeds; cancellation and failure keep the previous text. Password-protected PDFs require an unlocked copy.
- DOCX: extract paragraph text with Mammoth. Embedded pictures in Word files are not recognized; export these documents to PDF first.
- TXT, Markdown, CSV, and log files: plain text.
- PNG, JPG, WEBP, BMP, GIF: text recognition. Only a still frame is read from animated images.
- Pasted text: up to 1 million characters.

Limits: 50 MB per file, 250 PDF pages, 1 million extracted characters per document. Very complex layouts and handwriting can require corrections with the page text editor. Multiple files open sequentially. Import can be canceled.

## Read-aloud

Uses the device's Web Speech API. Voices vary by browser and operating system. Online voices may send document text to the device's speech provider. Playback uses short passages; pause cancels the current passage and resume repeats it from its beginning. Highlighting tracks passages rather than exact words. Keep the page open while listening; background playback depends on browser behavior.

Files and extracted text remain in memory for this browser session. Refreshing closes the documents. The text download saves the extracted text. OCR language data downloads from the Tesseract project's CDN on first use and may be cached by the browser. Files are not uploaded to Folio's server.

## Validation

`npm test` runs 19 checks covering speech cancellation and stale callbacks, document replacement, blank pages, Unicode-safe chunking, PDF font-run spacing, worker cancellation/timeouts, and optical/automatic PDF reading paths. The optical checks assert that embedded text extraction is never called, even when it would throw. `npx tsc --noEmit` checks types.

`npm run test:ocr -- /path/to/models` uses a local `eng.traineddata.gz` model and the two synthetic PDFs in `tests/fixtures`. Their visible glyphs are normal English, but their ToUnicode maps produce replacement symbols or long printable gibberish. Both recovered all three expected lines exactly at the production rendering resolution with zero embedded extraction calls in optical mode. This checks actual PDF rendering and recognition without uploading files or downloading models.

Standalone library checks passed for a two-page PDF, a rendered scanned PDF, a known-text PNG, and a DOCX containing literal script text. Image and scanned-PDF OCR returned the expected text at 95% reported confidence. These checks do not establish audible playback in a real browser. No browser is available in this build environment for listening or visual QA.

Optional WebMCP tools insert pasted text and read selected-document metadata when the host browser supports document.modelContext. No supported WebMCP validation context was available, so this optional interface is unverified.
