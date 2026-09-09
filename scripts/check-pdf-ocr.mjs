import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readPDFPage } from '../lib/pdf-reading.ts';
import { joinPDFText } from '../lib/pdf-text.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
const {createCanvas,DOMMatrix,ImageData,Path2D}=require('@napi-rs/canvas');
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
const {createWorker}=require('tesseract.js');
const modelPath=process.argv[2];
if(!modelPath) throw Error('Pass a directory containing eng.traineddata.gz. No model is downloaded by this check.');
const worker=await createWorker('eng',1,{cachePath:path.resolve(modelPath),langPath:path.resolve(modelPath),errorHandler:()=>{}});
const expected='Folio optical text recovery\nThe quick brown fox jumps over the lazy dog.\nInvoice number 12345. Total 67 dollars.';
try {
 for(const variant of ['replacement','scrambled']){
  const loading=pdfjs.getDocument({data:new Uint8Array(await fs.readFile(path.join(root,'tests/fixtures',`bad-tounicode-${variant}.pdf`))),standardFontDataUrl:path.join(root,'public/pdf/standard_fonts/'),useSystemFonts:true});
  try {
   const pdf=await loading.promise;const page=await pdf.getPage(1);
   const embedded=joinPDFText((await page.getTextContent()).items).trim();
   assert.notEqual(embedded,expected);
   let reads=0;
   const result=await readPDFPage({mode:'optical',signal:new AbortController().signal,readEmbedded:async()=>{reads++;throw Error('Optical mode must not extract embedded text');},readOptical:async()=>{
    const original=page.getViewport({scale:1});
    const scale=Math.min(300/72,3600/Math.max(original.width,original.height));
    const viewport=page.getViewport({scale});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvas,viewport,background:'rgb(255, 255, 255)'}).promise;
    const {data}=await worker.recognize(canvas.toBuffer('image/png'));
    return data.text.trim();
   }});
   assert.equal(reads,0);assert.equal(result.text,expected);assert.equal(result.source,'optical');
   console.log(`${variant}: recovered all 3 lines exactly; optical text extraction calls = ${reads}`);
   page.cleanup();
  } finally { await loading.destroy(); }
 }
} finally { await worker.terminate(); }
