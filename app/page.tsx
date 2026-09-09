'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Upload, FileText, Headphones, Play, Pause, Square, SkipBack, SkipForward, ArrowUpRight, ChevronLeft, ChevronRight, PencilLine, Download, X, ScanText, LoaderCircle, Volume2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { sampleDocument, makeDocument, paginateText, MAX_CHARACTERS, type ReadingDocument } from '@/lib/reader-model';
import { extractDocument, OCR_LANGUAGES, type ImportProgress } from '@/lib/extract-document';
import { PDF_READ_MODES, type PDFReadMode } from '@/lib/pdf-reading';
import { SpeechPlayer, type PlayerSnapshot } from '@/lib/speech-player';
import { findReadingOmissions, buildSpeechPlan } from '@/lib/reading-filter';
import { resolveReadingVoice } from '@/lib/reading-voice';

type ModelTool = { name:string; description:string; inputSchema:object; annotations:object; execute:(input:unknown)=>unknown };
type ModelContext = {registerTool:(tool:ModelTool,options:{signal:AbortSignal})=>void|Promise<void>};

export default function Home() {
  const [documents,setDocuments] = useState<ReadingDocument[]>([sampleDocument]);
  const [selectedId,setSelectedId] = useState('sample');
  const active = documents.find(item=>item.id===selectedId) ?? sampleDocument;
  const [page,setPage] = useState(0);
  const [pasted,setPasted] = useState('');
  const [pasteName,setPasteName] = useState('');
  const [language,setLanguage] = useState('eng');
  const [pdfMode,setPDFMode] = useState<PDFReadMode>('optical');
  const [busy,setBusy] = useState<ImportProgress|null>(null);
  const [error,setError] = useState('');
  const [dragging,setDragging] = useState(false);
  const [voices,setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceId,setVoiceId] = useState<string|null>(null);
  const [speed,setSpeed] = useState(1);
  const [fontSize,setFontSize] = useState(20);
  const [supported,setSupported] = useState(true);
  const [playback,setPlayback] = useState<PlayerSnapshot>({index:0,status:'idle'});
  const [editOpen,setEditOpen] = useState(false);
  const [edited,setEdited] = useState('');
  const [cleanReading,setCleanReading] = useState(true);
  const [reviewOpen,setReviewOpen] = useState(false);
  const [restoredByDocument,setRestoredByDocument] = useState<Record<string,string[]>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const importJob = useRef<AbortController|null>(null);
  const sourcePDFs = useRef(new Map<string,File>());
  const speech = useRef<SpeechPlayer|null>(null);
  const passageElement = useRef<HTMLButtonElement|null>(null);
  const activeRef = useRef(active);
  const addTextRef = useRef<(text:string,name:string)=>ReadingDocument>(()=>sampleDocument);
  const actualVoice = resolveReadingVoice(voices,selectedVoiceId);
  const voiceId = actualVoice?.voiceURI ?? 'system';
  const omissions=useMemo(()=>findReadingOmissions(active.pages),[active]);
  const restored=useMemo(()=>new Set(restoredByDocument[active.id]??[]),[restoredByDocument,active.id]);
  const readingPlan=useMemo(()=>buildSpeechPlan(active.passages,omissions,cleanReading,restored),[active,omissions,cleanReading,restored]);
  const currentPassageIndex=readingPlan.queue[playback.index]?.sourceIndex??-1;
  const hasSpeech=readingPlan.queue.length>0;
  const pageOmissions=omissions.filter(item=>item.page===page);
  const readPercent = playback.status === 'ended' ? 100 : Math.round(playback.index / Math.max(1,readingPlan.queue.length)*100);
  const readingMinutes = hasSpeech?Math.max(1,Math.ceil(readingPlan.words / (160 * speed))):0;
  const pagePassages = useMemo(()=>active.passages.map((passage,index)=>({...passage,index})).filter(p=>p.page===page),[active,page]);
  const groups = useMemo(()=>{
    const output:typeof pagePassages[] = [];
    for (const passage of pagePassages) {
      if (!output.length || output.at(-1)![0].paragraph!==passage.paragraph) output.push([]);
      output.at(-1)!.push(passage);
    }
    return output;
  },[pagePassages]);

  useEffect(()=>{
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { setSupported(false); return; }
    const synth = window.speechSynthesis;
    const player = new SpeechPlayer(synth,text=>new SpeechSynthesisUtterance(text),setPlayback,setError);
    speech.current = player;
    const loadVoices = ()=>setVoices(synth.getVoices());
    loadVoices(); synth.addEventListener('voiceschanged',loadVoices);
    return ()=>{ player.destroy(); synth.removeEventListener('voiceschanged',loadVoices); speech.current=null; };
  },[]);
  useEffect(()=>{ activeRef.current=active; setPage(0); },[active]);
  useEffect(()=>{ speech.current?.load(readingPlan.queue.map(item=>item.text)); },[readingPlan]);
  useEffect(()=>{ speech.current?.configure(speed,actualVoice); },[speed,actualVoice]);
  useEffect(()=>{
    if (playback.status==='playing') {
      const passage = active.passages[currentPassageIndex];
      if (passage) setPage(passage.page);
      passageElement.current?.scrollIntoView({behavior:'auto',block:'nearest'});
    }
  },[currentPassageIndex,playback.status,active,page]);
  useEffect(()=>()=>{importJob.current?.abort();},[]);

  function selectDocument(document:ReadingDocument) { setSelectedId(document.id); setError(''); }
  function addDocument(document:ReadingDocument) {
    setDocuments(current=>[...current,document]); setSelectedId(document.id); setError('');
  }
  function addText(text:string,name:string) {
    if (text.length>MAX_CHARACTERS) throw new Error('Use fewer than 1 million characters, or split the text into smaller parts.');
    const document=makeDocument(name.trim() || 'Pasted text','Text',paginateText(text));
    addDocument(document); return document;
  }
  addTextRef.current=addText;
  useEffect(()=>{
    const context=(document as Document & {modelContext?:ModelContext}).modelContext;
    if (!context?.registerTool) return;
    const lifecycle=new AbortController();
    const register=(tool:ModelTool)=>{
      try { void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{}); } catch { /* Optional browser API. */ }
    };
    register({name:'insert_reading_text',description:'Add pasted text to Folio and select it for reading. Does not start audio.',inputSchema:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:MAX_CHARACTERS},title:{type:'string',maxLength:200}},required:['text'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){
      if (!input || typeof input!=='object' || !('text' in input) || typeof input.text!=='string' || !input.text.trim()) throw new Error('A nonempty text string is required.');
      const value=input as {text:string;title?:unknown};
      if (value.title!==undefined && (typeof value.title!=='string' || value.title.length>200)) throw new Error('Title must be a string of at most 200 characters.');
      const result=addTextRef.current(value.text,typeof value.title==='string'?value.title:'Pasted text');
      return new Promise(resolve=>requestAnimationFrame(()=>resolve({id:result.id,title:result.name,pages:result.pages.length,words:result.words})));
    }});
    register({name:'get_reading_status',description:'Read the title and size of the selected document without returning its text.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if (!input || typeof input!=='object' || Object.keys(input).length) throw new Error('Expected an empty object.');const current=activeRef.current;return {title:current.name,pages:current.pages.length,words:current.words};}});
    return ()=>lifecycle.abort();
  },[]);

  async function openFiles(files:File[]) {
    if (!files.length || importJob.current) return;
    const controller=new AbortController(); importJob.current=controller;
    setError(''); speech.current?.pause();
    const failures:string[]=[];
    for (const file of files) {
      if (controller.signal.aborted) break;
      setBusy({message:`Opening ${file.name}…`,percent:0});
      try {
        const document=await extractDocument(file,language,pdfMode,controller.signal,setBusy);
        if (!controller.signal.aborted) {
          if (file.type==='application/pdf' || /\.pdf$/i.test(file.name)) sourcePDFs.current.set(document.id,file);
          addDocument(document);
        }
      } catch (reason) {
        if (!controller.signal.aborted) failures.push(`${file.name}: ${reason instanceof Error?reason.message:'Could not open this file. Try another copy.'}`);
      }
    }
    if (importJob.current===controller) {
      importJob.current=null; setBusy(null); if (failures.length) setError(failures.join('\n'));
    }
  }
  async function rereadPDF() {
    const source=sourcePDFs.current.get(active.id);
    if (!source || importJob.current) return;
    const originalId=active.id;
    const controller=new AbortController(); importJob.current=controller;
    setError(''); speech.current?.pause();
    setBusy({message:`Reading ${source.name} visually…`,percent:0});
    try {
      const result=await extractDocument(source,language,'optical',controller.signal,setBusy);
      if (!controller.signal.aborted) setDocuments(current=>current.map(doc=>doc.id===originalId?{...result,id:originalId}:doc));
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error?reason.message:'Optical recognition failed. Your existing text was kept.');
    } finally {
      if (importJob.current===controller) { importJob.current=null; setBusy(null); }
    }
  }
  function cancelImport() { importJob.current?.abort(); importJob.current=null; setBusy(null); }
  function togglePlayback() { setError(''); if (playback.status==='playing') speech.current?.pause(); else speech.current?.play(); }
  function goToPage(next:number) {
    setPage(next); const index=readingPlan.queue.findIndex(p=>p.page===next);
    if (index>=0) speech.current?.seek(index); else speech.current?.pause();
  }
  function readFromPassage(sourceIndex:number) {
    const index=readingPlan.sourceToSpeech.get(sourceIndex);
    if (index===undefined) return;
    setError(''); speech.current?.seek(index); speech.current?.play();
  }
  function restoreOmission(id:string,read:boolean) {
    setRestoredByDocument(current=>{
      const items=new Set(current[active.id]??[]);
      if(read)items.add(id);else items.delete(id);
      return {...current,[active.id]:[...items]};
    });
  }
  function downloadText() {
    const blob=new Blob([active.pages.join('\n\n')],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob); const link=document.createElement('a');
    link.href=url; link.download=active.name.replace(/\.[^.]+$/,'')+'.txt'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function openEditor() { speech.current?.pause(); setEdited(active.pages[page]); setEditOpen(true); }
  function saveEdit() {
    try {
      const pages=[...active.pages]; pages[page]=edited;
      const updated=makeDocument(active.name,active.kind,pages,active.warnings,active.id);
      setDocuments(current=>current.map(doc=>doc.id===active.id?updated:doc)); setEditOpen(false); setError('');
    } catch (reason) { setError(reason instanceof Error?reason.message:'The edited text could not be saved.'); }
  }
  const statusLabel=!hasSpeech?'Nothing selected for audio':playback.status==='playing'?'Reading aloud':playback.status==='paused'?'Paused':playback.status==='ended'?'Finished reading':'Ready when you are';

  return <main className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="Folio home"><BookOpen size={27}/><span>folio<span className="brand-dot">.</span></span></a><span className="header-caption">Your reading room</span><span className="local-note">Files are processed in your browser</span></header>
    <div className="workspace">
      <aside className="library" aria-label="Documents and reading settings">
        <div className="section-title"><h1>Add something to read</h1><ArrowUpRight size={18}/></div>
        <Tabs defaultValue="file"><TabsList className="import-tabs"><TabsTrigger value="file">Open a file</TabsTrigger><TabsTrigger value="text">Paste text</TabsTrigger></TabsList>
          <TabsContent value="file">
            <input ref={fileInput} type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.csv,.log,.png,.jpg,.jpeg,.webp,.bmp,.gif" className="sr-only" aria-label="Choose documents" disabled={!!busy} onChange={event=>{void openFiles(Array.from(event.target.files??[]));event.target.value='';}}/>
            <button className={`dropzone${dragging?' dragging':''}`} disabled={!!busy} onClick={()=>fileInput.current?.click()} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);void openFiles(Array.from(event.dataTransfer.files));}}>
              <Upload size={28}/><strong>Drop your document here</strong><span>or choose a file</span><small>PDF, DOCX, TXT, or an image</small>
            </button>
            <p className="file-limits">Up to 50 MB per file · 250 PDF pages</p>
            <label className="control-label" id="pdf-mode-label"><FileText size={15}/> PDF reading method</label>
            <Select value={pdfMode} onValueChange={value=>{if(value==='optical'||value==='auto')setPDFMode(value);}} items={PDF_READ_MODES} disabled={!!busy}><SelectTrigger aria-labelledby="pdf-mode-label" className="full-select"><SelectValue/></SelectTrigger><SelectContent>{PDF_READ_MODES.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
            <p className="field-note pdf-method-note">{pdfMode==='optical'?'Reads the visible page image on every page. Bypasses broken text encoding and font mappings. Slower than extracting PDF text.':'Uses PDF text when it looks readable, with optical recognition for scans and detected errors. Choose Optical OCR if the words are still garbled.'}</p>
            <label className="control-label" id="recognition-label"><ScanText size={15}/> Text recognition language</label>
            <Select value={language} onValueChange={value=>value&&setLanguage(value)} items={OCR_LANGUAGES} disabled={!!busy}><SelectTrigger aria-labelledby="recognition-label" className="full-select"><SelectValue/></SelectTrigger><SelectContent>{OCR_LANGUAGES.map(item=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
            <p className="field-note">Choose the language printed on the page. Language data downloads on first use.</p>
          </TabsContent>
          <TabsContent value="text"><input className="title-input" aria-label="Document title" placeholder="Document title (optional)" value={pasteName} maxLength={200} onChange={event=>setPasteName(event.target.value)}/><textarea className="text-input" placeholder="Paste anything you’d like to listen to…" aria-label="Text to read" value={pasted} maxLength={MAX_CHARACTERS} onChange={event=>setPasted(event.target.value)}/><button className="primary-button full-width" disabled={!pasted.trim() || !!busy} onClick={()=>{try{addText(pasted,pasteName);setPasted('');setPasteName('');}catch(reason){setError(reason instanceof Error?reason.message:'Could not add text.');}}}>Add text to reader</button></TabsContent>
        </Tabs>
        {busy&&<div className="import-progress" role="status"><div><LoaderCircle className="spinning" size={16}/><span>{busy.message}</span><button className="icon-button" onClick={cancelImport} aria-label="Cancel import"><X size={17}/></button></div><Progress value={busy.percent} aria-label="Import progress"/></div>}
        <div className="library-heading">In this session <span>{documents.length}</span></div>
        <div className="document-list">{documents.map(document=><button key={document.id} className={`document-item${document.id===active.id?' selected':''}`} onClick={()=>selectDocument(document)} aria-pressed={document.id===active.id}><FileText size={21}/><div><strong>{document.name}</strong><small>{document.kind} · {document.pages.length} {document.pages.length===1?'page':'pages'}</small></div></button>)}</div>
        <div className="voice-settings"><div className="switch-row filter-switch"><label htmlFor="clean-reading">Skip reading clutter</label><Switch id="clean-reading" checked={cleanReading} onCheckedChange={setCleanReading}/></div><p className="field-note">Skip paragraph numbers, decorative symbols, citations, and reference lists. Review skipped text to keep anything you need. Turn this off to read everything.</p><label className="control-label voice-label" id="voice-label"><Volume2 size={16}/> Reading voice</label>
          <Select value={voiceId} onValueChange={value=>value&&setVoiceId(value)} items={[{value:'system',label:'Device default'},...voices.map(v=>({value:v.voiceURI,label:`${v.name} (${v.lang})`}))]} disabled={!supported}><SelectTrigger className="full-select" aria-labelledby="voice-label"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="system">Device default</SelectItem>{voices.map(voice=><SelectItem key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang}){voice.localService?'':' · online'}</SelectItem>)}</SelectContent></Select>
          <p className="field-note">{actualVoice ? actualVoice.localService?'This voice runs on your device.':'This voice uses an online service. Text is sent to your device’s speech provider.':'Your device chooses the voice. Some voices use an online speech service.'}</p>
          <div className="setting-heading"><label id="speed-label">Reading speed</label><span>{speed.toFixed(2).replace(/0$/,'')}×</span></div><Slider aria-labelledby="speed-label" value={[speed]} min={.5} max={2} step={.25} onValueChange={value=>setSpeed(Array.isArray(value)?value[0]:value)}/><div className="range-labels"><span>Slower</span><span>Faster</span></div>
        </div>
        <div className="side-note"><Headphones size={21}/><p>Documents are kept for this session.<br/>Download the text to keep a copy.</p></div>
      </aside>
      <section className="reading-area" aria-label="Document reader">
        {error&&<div className="error-notice" role="alert"><p>{error}</p><button className="icon-button" aria-label="Dismiss error" onClick={()=>setError('')}><X size={17}/></button></div>}
        {!supported&&<div className="error-notice" role="alert">This browser does not support read-aloud. Open this page in Safari, Chrome, or Edge.</div>}
        <div className="reader-toolbar"><span><FileText size={16}/>{active.kind==='Sample'?'Sample document':'Reading view'}</span><div className="toolbar-actions"><button className="icon-button" title="Smaller text" aria-label="Smaller text" disabled={fontSize<=16} onClick={()=>setFontSize(size=>size-2)}>A−</button><button className="icon-button" title="Larger text" aria-label="Larger text" disabled={fontSize>=30} onClick={()=>setFontSize(size=>size+2)}>A+</button><span className="toolbar-separator"/><button className="icon-button" title="Edit this page’s text" aria-label="Edit this page’s text" onClick={openEditor} disabled={!!busy}><PencilLine size={17}/></button><button className="icon-button" title="Download extracted text" aria-label="Download extracted text" onClick={downloadText}><Download size={17}/></button></div></div>
        {sourcePDFs.current.has(active.id)&&<div className="optical-action"><div><strong>{active.kind==='PDF · optical OCR'?'Reading from page images':'Garbled or missing words?'}</strong><p>Recognize this PDF again using the selected language. This replaces the text and any corrections when recognition succeeds.</p></div><button className="secondary-button" disabled={!!busy} onClick={()=>void rereadPDF()}><ScanText size={16}/>{active.kind==='PDF · optical OCR'?'Run OCR again':'Read PDF visually'}</button></div>}
        {active.warnings.length>0&&<details className="recognition-note"><summary><ScanText size={15}/> Review recognized text ({active.warnings.length} {active.warnings.length===1?'note':'notes'})</summary><ul>{active.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
        {cleanReading&&omissions.length>0&&<div className="filter-summary"><div><strong>{readingPlan.skippedCount} {readingPlan.skippedCount===1?'item':'items'} skipped in read-aloud</strong><p>{hasSpeech?'The full text is shown below. Detection uses common patterns; review anything you want to hear.':'All text is currently skipped. Restore items or turn off “Skip reading clutter” to listen.'}</p></div><button className="secondary-button" onClick={()=>setReviewOpen(true)} disabled={!pageOmissions.length}>Review this page ({pageOmissions.length})</button></div>}
        <article className="paper"><div className="paper-meta">{active.id==='sample'?'Welcome to Folio':`${readingPlan.words.toLocaleString()} spoken words · About ${readingMinutes} min at this speed`}</div><h2>{active.name}</h2>
          <div className="document-text" style={{fontSize}}>{groups.length?groups.map((group,index)=><p key={`${page}-${index}`}>{group.map(passage=><span key={passage.index}><button ref={passage.index===currentPassageIndex?passageElement:undefined} className={`passage${passage.index===currentPassageIndex && playback.status!=='idle'?' current':''}${!readingPlan.sourceToSpeech.has(passage.index)?' skipped-passage':''}`} aria-label={readingPlan.sourceToSpeech.has(passage.index)?`Read from: ${passage.text.slice(0,70)}`:`Skipped from audio: ${passage.text.slice(0,70)}`} aria-current={passage.index===currentPassageIndex?'true':undefined} title={!readingPlan.sourceToSpeech.has(passage.index)?'Skipped from audio. Use Review this page to restore.':undefined} onClick={()=>readFromPassage(passage.index)} disabled={!supported || !readingPlan.sourceToSpeech.has(passage.index)}>{passage.text}</button>{' '}</span>)}</p>):<p className="empty-page">No readable text on this page. Use the pencil to add text, or try Optical OCR with the language printed on the page.</p>}</div>
          <div className="paper-end">{page===active.pages.length-1?active.id==='sample'?'End of sample':'End of document':`Page ${page+1}`}</div>
        </article>
        <div className="page-controls"><span>Click a passage to read from there</span><div><button className="icon-button" aria-label="Previous page" disabled={page===0} onClick={()=>goToPage(page-1)}><ChevronLeft size={18}/></button><span>Page {page+1} of {active.pages.length}</span><button className="icon-button" aria-label="Next page" disabled={page>=active.pages.length-1} onClick={()=>goToPage(page+1)}><ChevronRight size={18}/></button></div></div>
      </section>
    </div>
    <footer className="player"><div className="player-document"><Headphones/><div><strong role="status">{statusLabel}</strong><small>{active.name}</small></div></div><div className="playback-center"><div className="transport"><button className="icon-button" aria-label="Previous passage" title="Previous passage" disabled={!supported || !hasSpeech || playback.index===0} onClick={()=>speech.current?.seek(playback.index-1)}><SkipBack size={19}/></button><button className="play-button" disabled={!supported || !hasSpeech} onClick={togglePlayback}>{playback.status==='playing'?<Pause size={19} fill="currentColor"/>:<Play size={19} fill="currentColor"/>}{playback.status==='playing'?'Pause':playback.status==='ended'?'Read again':playback.status==='paused'?'Resume':'Read aloud'}</button><button className="icon-button" aria-label="Next passage" title="Next passage" disabled={!supported || !hasSpeech || playback.index>=readingPlan.queue.length-1} onClick={()=>speech.current?.seek(playback.index+1)}><SkipForward size={19}/></button><button className="icon-button stop-button" aria-label="Stop and return to start" title="Stop and return to start" disabled={!supported || playback.status==='idle'} onClick={()=>{speech.current?.stop();setPage(0);}}><Square size={17}/></button></div></div><div className="reading-progress"><div><span>{readPercent}% read</span><span>~{readingMinutes} min total</span></div><Slider aria-label="Reading position" value={[playback.status==='ended'?Math.max(0,readingPlan.queue.length-1):playback.index]} min={0} max={Math.max(1,readingPlan.queue.length-1)} step={1} disabled={!supported || readingPlan.queue.length<2} onValueChange={value=>{const index=Array.isArray(value)?value[0]:value;speech.current?.seek(index);setPage(readingPlan.queue[index]?.page??0);}}/></div></footer>
    <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent className="edit-dialog"><DialogHeader><DialogTitle>Skipped text on page {page+1}</DialogTitle><DialogDescription>Turn on “Read this” for any item you want spoken. The original document text is unchanged.</DialogDescription></DialogHeader><div className="omission-list">{pageOmissions.map((item,index)=><div key={item.id} className="omission-item"><div className="omission-heading"><span>{item.reason}</span><label htmlFor={`restore-item-${index}`}>Read this <Switch id={`restore-item-${index}`} checked={restored.has(item.id)} onCheckedChange={checked=>restoreOmission(item.id,checked)}/></label></div><p>{item.text}</p></div>)}</div><DialogFooter><button className="secondary-button" onClick={()=>{setCleanReading(false);setReviewOpen(false);}}>Read everything</button><button className="primary-button" onClick={()=>setReviewOpen(false)}>Done</button></DialogFooter></DialogContent></Dialog>
    <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="edit-dialog"><DialogHeader><DialogTitle>Edit page {page+1}</DialogTitle><DialogDescription>Correct the recognized text. Your changes apply to reading and playback.</DialogDescription></DialogHeader><textarea className="text-input edit-input" aria-label="Page text" value={edited} maxLength={MAX_CHARACTERS} onChange={event=>setEdited(event.target.value)}/><DialogFooter><button className="secondary-button" onClick={()=>setEditOpen(false)}>Cancel</button><button className="primary-button" onClick={saveEdit}>Save text</button></DialogFooter></DialogContent></Dialog>
  </main>;
}
