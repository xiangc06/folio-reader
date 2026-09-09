import { cleanText, makeDocument, paginateText, MAX_CHARACTERS } from './reader-model';
import type { Worker as OCRWorker } from 'tesseract.js';
import { abortable } from './async-task';
import { joinPDFText } from './pdf-text';
import { readPDFPage, type PDFReadMode } from './pdf-reading';

export type ImportProgress = { message: string; percent: number };
export const OCR_LANGUAGES = [ {value:'eng',label:'English'}, {value:'spa',label:'Spanish'}, {value:'fra',label:'French'}, {value:'deu',label:'German'}, {value:'por',label:'Portuguese'}, {value:'chi_sim',label:'Chinese (simplified)'}, {value:'jpn',label:'Japanese'} ];

export async function extractDocument(file: File, language: string, pdfMode: PDFReadMode, signal: AbortSignal, progress: (value: ImportProgress) => void) {
  if (file.size > 50 * 1024 * 1024) throw new Error('This file is larger than 50 MB. Split or compress it before opening.');
  const ext = file.name.split('.').at(-1)?.toLowerCase();
  const warnings: string[] = [];
  const assertActive = () => signal.throwIfAborted();
  const report = (message: string, percent: number) => { if (!signal.aborted) progress({message, percent}); };
  let worker: OCRWorker | undefined;
  let terminateWorker: (() => void) | undefined;
  let ocrPage = 0, pageCount = 1;
  let finished = false;
  async function recognize(image: File | HTMLCanvasElement) {
    assertActive();
    if (!worker) {
      report('Loading text recognition. First use may take a moment…', 0);
      const { createWorker } = await import('tesseract.js');
      assertActive();
      let rejectWorkerError: (reason: Error) => void = () => {};
      const workerError = new Promise<never>((_, reject) => { rejectWorkerError = reject; });
      const pendingWorker = createWorker(language, 1, {
        workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', workerBlobURL: false,
        logger: (event) => { if (event.status === 'recognizing text') report(`Recognizing text${pageCount > 1 ? ` on page ${ocrPage + 1} of ${pageCount}` : ''}…`, Math.round(((ocrPage + event.progress) / pageCount) * 100)); },
        errorHandler: () => rejectWorkerError(new Error('Text recognition could not load or run. Check your connection and try opening the file again.')),
      });
      // Dispose workers that finish loading after cancellation or a timeout.
      void pendingWorker.then(ready => { if (finished || signal.aborted) void ready.terminate(); }).catch(() => {});
      worker = await abortable(Promise.race([pendingWorker, workerError]), signal);
      terminateWorker = () => { void worker?.terminate().catch(() => {}); };
      signal.addEventListener('abort', terminateWorker, {once:true});
      assertActive();
    }
    const result = await abortable(worker.recognize(image), signal);
    assertActive();
    if (result.data.confidence < 70 && result.data.text.trim()) warnings.push(`Recognition confidence is low${pageCount > 1 ? ` on page ${ocrPage + 1}` : ''}. Review the text before listening.`);
    return cleanText(result.data.text);
  }
  try {
    assertActive();
    report(`Opening ${file.name}…`, 0);
    if (ext === 'pdf' || file.type === 'application/pdf') {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      assertActive();
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf/pdf.worker.min.mjs';
      const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl:'/pdf/cmaps/', cMapPacked:true, standardFontDataUrl:'/pdf/standard_fonts/', wasmUrl:'/pdf/wasm/', useSystemFonts:true });
      const cancelPDF = () => { void loading.destroy().catch(() => {}); };
      signal.addEventListener('abort', cancelPDF, {once:true});
      try {
        assertActive();
        const pdf = await loading.promise;
        pageCount = pdf.numPages;
        if (pageCount > 250) throw new Error('This PDF has more than 250 pages. Split it into smaller PDFs first.');
        const pages: string[] = [];
        let characterCount = 0, opticalPages = 0;
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          assertActive(); ocrPage = pageNumber - 1;
          report(`Reading page ${pageNumber} of ${pageCount}…`, Math.round((pageNumber - 1) / pageCount * 100));
          const page = await pdf.getPage(pageNumber);
          try {
            const result=await readPDFPage({
              mode:pdfMode, signal,
              readEmbedded:async()=>joinPDFText((await page.getTextContent()).items),
              readOptical:async()=>{
                assertActive();
                report(`Rendering page ${pageNumber} of ${pageCount} for optical recognition…`,Math.round((pageNumber-1)/pageCount*100));
                const viewport=page.getViewport({scale:1});
                // Aim for 300 dpi and keep each page within a bounded canvas.
                const scale=Math.min(300/72,3600/Math.max(viewport.width,viewport.height));
                const scaled=page.getViewport({scale});
                const canvas=document.createElement('canvas');
                canvas.width=Math.ceil(scaled.width); canvas.height=Math.ceil(scaled.height);
                try {
                  const render=page.render({canvas,viewport:scaled,background:'rgb(255, 255, 255)'});
                  const cancelRender=()=>render.cancel();
                  signal.addEventListener('abort',cancelRender,{once:true});
                  try { await render.promise; } finally { signal.removeEventListener('abort',cancelRender); }
                  return await recognize(canvas);
                } finally { canvas.width=0; canvas.height=0; }
              },
            });
            const text=cleanText(result.text);
            if (result.source==='optical') opticalPages++;
            if (result.note) warnings.push(`Page ${pageNumber}: ${result.note}`);
            if (!text) warnings.push(`No readable text was found on page ${pageNumber}.`);
            characterCount+=text.length;
            if (characterCount>MAX_CHARACTERS) throw new Error('This document contains more than 1 million characters. Split it into smaller documents.');
            pages.push(text);
          } finally { page.cleanup(); }
        }
        if (opticalPages) warnings.unshift(`Read ${opticalPages} of ${pageCount} pages visually. Check names, numbers, and reading order. If characters are missing from the visible page, recognition cannot reliably restore them.`);
        return makeDocument(file.name, pdfMode==='optical'?'PDF · optical OCR':opticalPages?'PDF · automatic OCR':'PDF · embedded text', pages, warnings);
      } finally { signal.removeEventListener('abort', cancelPDF); await loading.destroy().catch(() => {}); }
    }
    if (ext === 'docx') {
      const mammoth = await import('mammoth');
      assertActive();
      const result = await mammoth.extractRawText({arrayBuffer: await file.arrayBuffer()});
      assertActive();
      if (result.messages.length) warnings.push('Some Word content may not have been imported. Review the extracted text.');
      return makeDocument(file.name, 'Word', paginateText(result.value), warnings);
    }
    if (['txt','md','markdown','csv','log'].includes(ext ?? '') || file.type === 'text/plain') {
      const text = await file.text(); assertActive();
      return makeDocument(file.name, 'Text', paginateText(text));
    }
    if (['png','jpg','jpeg','webp','bmp','gif'].includes(ext ?? '') || ['image/png','image/jpeg','image/webp','image/bmp','image/gif'].includes(file.type)) {
      const text = await recognize(file);
      warnings.unshift('Text was recognized from an image. Check names, numbers, and reading order.');
      return makeDocument(file.name, 'Image · text recognized', paginateText(text), warnings);
    }
    throw new Error('This file type is not supported. Use PDF, DOCX, TXT, Markdown, PNG, JPG, WEBP, BMP, or GIF. Export older Word files as DOCX, or paste their text.');
  } catch (error) {
    if (signal.aborted) throw new DOMException('Import canceled', 'AbortError');
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password-protected. Save an unlocked copy, then open it here.');
    throw error;
  } finally {
    finished = true;
    if (terminateWorker) signal.removeEventListener('abort', terminateWorker);
    await worker?.terminate().catch(() => {});
  }
}
