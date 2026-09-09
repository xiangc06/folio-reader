import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, paginateText, splitPassages } from '../lib/reader-model.ts';
import { SpeechPlayer } from '../lib/speech-player.ts';
import { abortable } from '../lib/async-task.ts';
import { joinPDFText } from '../lib/pdf-text.ts';

function playerFixture() {
 const utterances=[];let state;const errors=[];
 const synth={speak:u=>utterances.push(u),cancel(){},resume(){}};
 const player=new SpeechPlayer(synth,text=>({text}),value=>{state=value;},message=>errors.push(message));
 player.load(['First passage.','Second passage.','Third passage.']);
 return {player,utterances,errors,get state(){return state;}};
}
test('split long text without losing words or exceeding speech chunk limit',()=>{
 const text=('A sentence about the world. '+ 'A'.repeat(510)+'\n\n').repeat(15);
 const pages=paginateText(text);const passages=splitPassages(pages);
 assert.ok(pages.length>1);assert.ok(passages.every(p=>p.text.length<=240));
 assert.equal(passages.map(p=>p.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
});
test('empty text fails and blank PDF pages retain page numbers',()=>{
 assert.throws(()=>makeDocument('empty','Text',['   ']),/No readable text/);
 const doc=makeDocument('pages','PDF',['First.','','Third.']);
 assert.equal(doc.pages.length,3);assert.deepEqual(doc.passages.map(p=>p.page),[0,2]);
});
test('pause and resume repeat current passage; stopped callbacks cannot advance',()=>{
 const f=playerFixture();f.player.play();const old=f.utterances[0];
 f.player.pause();old.onend();assert.equal(f.state.status,'paused');
 f.player.play();assert.equal(f.utterances.at(-1).text,'First passage.');
 f.player.stop();f.utterances.at(-1).onend();assert.deepEqual(f.state,{index:0,status:'idle'});
 f.player.play();assert.equal(f.state.status,'playing');
});
test('seeking invalidates old utterances and natural finish reaches ended',()=>{
 const f=playerFixture();f.player.play();const old=f.utterances[0];f.player.seek(2);
 old.onend();assert.equal(f.state.index,2);assert.equal(f.utterances.length,2);
 f.utterances.at(-1).onend();assert.equal(f.state.status,'ended');
 f.player.play();assert.equal(f.state.index,0);
});
test('changing voice or replacing document cancels the old speech session',()=>{
 const f=playerFixture();f.player.play();const old=f.utterances[0];
 f.player.configure(1.5,{lang:'en-US',name:'Test'});old.onend();
 assert.equal(f.utterances.length,2);assert.equal(f.utterances[1].rate,1.5);
 f.player.load(['New document.']);f.utterances[1].onend();assert.equal(f.state.status,'idle');
 f.player.play();assert.equal(f.utterances.at(-1).text,'New document.');
});
test('voice errors pause instead of silently continuing',()=>{
 const f=playerFixture();f.player.play();f.utterances[0].onerror({error:'not-allowed'});
 assert.equal(f.state.status,'paused');assert.match(f.errors[0],/blocked audio/);
});
test('canceling a never-settling worker promise finishes promptly',async()=>{
 const controller=new AbortController();const pending=abortable(new Promise(()=>{}),controller.signal);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('a stalled worker reaches a useful timeout',async()=>{
 await assert.rejects(abortable(new Promise(()=>{}),new AbortController().signal,5),/too long/);
});
test('PDF text joins contiguous font runs without inserting spaces',()=>{
 const item=(str,x,width,hasEOL=false)=>({str,transform:[18,0,0,18,x,200],width,height:18,dir:'ltr',hasEOL});
 assert.equal(joinPDFText([item('inter',0,30),item('national',30,50),item('agreement',86,60,true)]),'international agreement\n');
});
test('long passages preserve emoji surrogate pairs',()=>{
 const text='a'+'😀'.repeat(3000);
 const pages=paginateText(text);const passages=splitPassages(pages);
 assert.ok(pages.every(p=>p.isWellFormed()));assert.ok(passages.every(p=>p.text.isWellFormed()));
 assert.equal(passages.map(p=>p.text).join(''),text);
});
