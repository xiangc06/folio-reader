import test from 'node:test';
import assert from 'node:assert/strict';
import { readPDFPage, hasBrokenPDFText } from '../lib/pdf-reading.ts';
const signal=()=>new AbortController().signal;

test('optical mode never asks for embedded text, including dense printable gibberish',async()=>{
 let embeddedCalls=0, opticalCalls=0;
 const result=await readPDFPage({mode:'optical',signal:signal(),readEmbedded:async()=>{embeddedCalls++;throw Error('Bad font encoding');},readOptical:async()=>{opticalCalls++;return 'The visible words are correct.';}});
 assert.equal(embeddedCalls,0);assert.equal(opticalCalls,1);
 assert.deepEqual(result,{text:'The visible words are correct.',source:'optical'});
});
test('optical mode cannot replace failed recognition with broken PDF encoding',async()=>{
 let embeddedCalls=0;
 await assert.rejects(readPDFPage({mode:'optical',signal:signal(),readEmbedded:async()=>{embeddedCalls++;return 'garbled';},readOptical:async()=>{throw Error('OCR unavailable');}}),/OCR unavailable/);
 assert.equal(embeddedCalls,0);
});
test('optical empty pages stay empty instead of reusing embedded text',async()=>{
 const result=await readPDFPage({mode:'optical',signal:signal(),readEmbedded:async()=>{throw Error('Must not run');},readOptical:async()=>''});
 assert.equal(result.text,'');assert.equal(result.source,'optical');
});
test('automatic mode falls back when text extraction throws',async()=>{
 const result=await readPDFPage({mode:'auto',signal:signal(),readEmbedded:async()=>{throw Error('Missing mapping');},readOptical:async()=>'Visible text recovered.'});
 assert.equal(result.source,'optical');assert.match(result.note,/could not be decoded/);
});
test('automatic mode recognizes replacement symbols, private-use mappings, and control characters',async()=>{
 for(const broken of ['\ufffd'.repeat(100),'\ue123'.repeat(100),'\0'.repeat(100),'\u{f0001}'.repeat(100)]){
  assert.ok(hasBrokenPDFText(broken));
  const result=await readPDFPage({mode:'auto',signal:signal(),readEmbedded:async()=>broken,readOptical:async()=>'Short but correct.'});
  assert.equal(result.text,'Short but correct.');assert.equal(result.source,'optical');
 }
 assert.equal(hasBrokenPDFText('English Français 中文 日本語.\nMore text.'),false);
});
test('automatic mode never falls back to a known broken map if OCR fails',async()=>{
 await assert.rejects(readPDFPage({mode:'auto',signal:signal(),readEmbedded:async()=>'\ufffd'.repeat(200),readOptical:async()=>{throw Error('OCR failed');}}),/OCR failed/);
});
test('automatic mode keeps valid digital text without unnecessary OCR',async()=>{
 const text='A normal paragraph with valid readable digital text.';
 const result=await readPDFPage({mode:'auto',signal:signal(),readEmbedded:async()=>text,readOptical:async()=>{throw Error('Must not run');}});
 assert.deepEqual(result,{text,source:'embedded'});
});
test('sparse readable text survives an optional OCR failure',async()=>{
 const result=await readPDFPage({mode:'auto',signal:signal(),readEmbedded:async()=>'Chapter one',readOptical:async()=>{throw Error('No connection');}});
 assert.equal(result.text,'Chapter one');assert.equal(result.source,'embedded');assert.match(result.note,/failed/);
});
test('cancellation does not start another reading method',async()=>{
 const controller=new AbortController();let opticalCalls=0;
 await assert.rejects(readPDFPage({mode:'auto',signal:controller.signal,readEmbedded:async()=>{controller.abort();throw Error('Canceled');},readOptical:async()=>{opticalCalls++;return 'Unexpected';}}),{name:'AbortError'});
 assert.equal(opticalCalls,0);
});
