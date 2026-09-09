import type { Passage } from './reader-model';

export type ReadingOmission = {id:string; page:number; start:number; end:number; text:string; reason:string};
export type SpokenPassage = {text:string; sourceIndex:number; page:number};
type SourceLine = {page:number; start:number; end:number; text:string};

const referenceHeading = /^(?:\d+[.)]?\s+)?(?:references|bibliography|works cited|literature cited)\s*:?[\s]*$/i;
const nextSection = /^(?:(?:\d+[.)]?|[A-Z][.)])\s+)?(?:appendix|appendices|appendix\s+[A-Z0-9]|acknowledg(?:e)?ments?|supplement(?:ary)?(?:\s+material)?|glossary|index|conclusions?|discussion|abstract|introduction|chapter\s+\d+|section\s+\d+)(?:\s*[:.\-–]\s*.*)?$/i;
function referenceEntry(text:string) {
  return /(?:\b(?:18|19|20)\d{2}[a-z]?\b|\bdoi\s*:|doi\.org)/i.test(text)
    && /^(?:(?:\[\d+\]|\d+[.)])\s*)?(?:[\p{Lu}][\p{L}\p{M}'’.-]+,\s*[\p{Lu}]|[\p{Lu}][\p{L}\p{M}'’.-]+\s+[\p{Lu}](?:[.\s,]|[\p{Lu}]\b)|[\p{Lu}][\p{L}\p{M}'’.-]+\s+et al\.|https?:\/\/|doi\s*:)/u.test(text.trim());
}
function authorYearCitation(text:string) {
  const surname = "(?:(?:van|von|de|der|den|da|di|del|la)\\s+)*[\\p{Lu}][\\p{L}\\p{M}'’.-]+";
  const author = `${surname}(?:(?:\\s+(?:and|&)\\s+|,\\s*)${surname})*(?:\\s+et al\\.?)?`;
  const year = '(?:18|19|20)\\d{2}[a-z]?';
  const entry = `${author},?\\s+${year}(?:\\s*,\\s*${year})*(?:(?:,\\s*(?:p{1,2}\\.|pages?)|:)\\s*\\d+(?:\\s*[-–]\\s*\\d+)?)?`;
  return new RegExp(`^(?:see\\s+|e\\.g\\.,?\\s*)?${entry}(?:\\s*;\\s*${entry})*$`,'u').test(text.trim());
}

export function findReadingOmissions(pages:string[]):ReadingOmission[] {
  const omissions:ReadingOmission[] = [];
  const add = (page:number,start:number,end:number,reason:string) => {
    const raw=pages[page].slice(start,end);
    const leading=raw.length-raw.trimStart().length;
    const text=raw.trim();
    if (!text) return;
    start+=leading; end=start+text.length;
    omissions.push({id:`${page}:${start}:${end}:${reason}:${text}`,page,start,end,text,reason});
  };
  const lines:SourceLine[]=[];
  pages.forEach((pageText,page)=>{
    for (const match of pageText.matchAll(/[^\n]+/g)) {
      const text=match[0].trim();
      if (!text) continue;
      const start=match.index!+match[0].length-match[0].trimStart().length;
      lines.push({page,start,end:start+text.length,text});
    }
  });
  const pageEdges=new Map<number,{first:SourceLine;last:SourceLine;count:number}>();
  for (const line of lines) {
    const group=pageEdges.get(line.page);
    if (group) {group.last=line;group.count++;} else pageEdges.set(line.page,{first:line,last:line,count:1});
  }
  let inReferences=false;
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    if (referenceHeading.test(line.text) && lines.slice(i+1,i+6).some(next=>referenceEntry(next.text))) {
      inReferences=true; add(line.page,line.start,line.end,'Reference list'); continue;
    }
    if (inReferences) {
      const hasBlankBefore=i>0 && line.page===lines[i-1].page && /\n\s*\n/.test(pages[line.page].slice(lines[i-1].end,line.start));
      const shortHeading=hasBlankBefore && line.text.split(/\s+/).length<=7 && /^[\p{Lu}][\p{L}\p{M} &-]+$/u.test(line.text);
      if (nextSection.test(line.text) || /^(?:appendix|appendices)\b/i.test(line.text) || shortHeading) inReferences=false;
      else { add(line.page,line.start,line.end,'Reference list'); continue; }
    }
    const explicit = /^(?:¶{1,2}|§{1,2}|[Pp]aragraph)\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?[.):]?\s*/u.exec(line.text);
    if (explicit) {
      const rest=line.text.slice(explicit[0].length);
      // A leading label is different from a reference that acts as the subject.
      if (/^¶/u.test(explicit[0]) || !rest || /^[“"'‘\p{Lu}]/u.test(rest)) add(line.page,line.start,line.start+explicit[0].length,'Paragraph label');
    }
    const numbered=/^(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/u.exec(line.text);
    if (numbered) {
      add(line.page,line.start,line.start+numbered[0].length,'Paragraph label');
    }
    const decoration=/^(?:[•●◦▪▫‣⁃]+\s*|[-*+]\s+(?=[\p{L}“"'‘])|#{1,6}\s+|>\s+)/u.exec(line.text);
    const mathLine=decoration && /^[-+*]/.test(decoration[0]) && /^[\p{L}\p{N}_]+[¹²³⁴⁵⁶⁷⁸⁹⁰]*\s*[=+−*/<>×÷-]/u.test(line.text.slice(decoration[0].length));
    if (decoration && !mathLine) add(line.page,line.start,line.start+decoration[0].length,'Decorative symbol');
    if (/^(?:[-*_~─━—–]\s*){3,}$/.test(line.text) || /^[•●◦▪▫‣⁃†‡¶§]+$/.test(line.text)) add(line.page,line.start,line.end,'Decorative separator');
    const noteLabel=/^[¹²³⁴⁵⁶⁷⁸⁹⁰†‡]+\s+(?=\S)/.exec(line.text);
    if (noteLabel) add(line.page,line.start,line.start+noteLabel[0].length,'Footnote label');
    if (/^(?:doi\s*:\s*10\.\d{4,9}\/\S+|https?:\/\/(?:dx\.)?doi\.org\/\S+)\.?$/i.test(line.text)) add(line.page,line.start,line.end,'Source identifier');
    const edges=pageEdges.get(line.page)!;
    if (edges.count>=3 && (line===edges.first || line===edges.last) && /^Page\s+\d+(?:\s+of\s+\d+)?$/i.test(line.text)) add(line.page,line.start,line.end,'Page number');
  }
  pages.forEach((text,page)=>{
    for (const match of text.matchAll(/\[[1-9]\d{0,2}(?:\s*[,;–—-]\s*\d{1,3})*\]/g)) {
      const start=match.index!;
      const before=text.slice(Math.max(0,start-70),start);
      const after=text.slice(start+match[0].length);
      const token=before.match(/([\p{L}\p{N}_]+)$/u)?.[1];
      if (token && (token.length<3 || /[\d_]/.test(token))) continue; // x[12], item_1[12].
      if (/\b(?:arr|array|vector|matrix|interval|range|set|values?|index|coordinates?|chapter|section|paragraph|table|figure|equation|problem|example|step|case|item|experiment)\s*$/i.test(before)) continue;
      if (/\b(?:code|array|vector|matrix|interval|range|set|values?|index|coordinates?)\b[^.!?\n]{0,45}$/i.test(before)) continue;
      if (/^\s*(?:=|[+*/]|\b(?:is|means|equals)\b)/.test(after)) continue;
      const open=before.match(/\(\s*$/),close=after.match(/^\s*\)/);
      if (open && close) add(page,start-open[0].length,start+match[0].length+close[0].length,'Citation marker');
      else add(page,start,start+match[0].length,'Citation marker');
    }
    for (const match of text.matchAll(/\(([^()]{3,500})\)/g)) {
      if (authorYearCitation(match[1])) add(page,match.index!,match.index!+match[0].length,'Author and year citation');
    }
    for (const match of text.matchAll(/[¹²³⁴⁵⁶⁷⁸⁹⁰†‡]+/g)) {
      const before=text.slice(Math.max(0,match.index!-50),match.index!);
      const token=before.match(/([\p{L}\p{N}]+)[.!?,;:'’"”)\]]*$/u)?.[1];
      const after=text.slice(match.index!+match[0].length);
      if (token && token.length>=3 && !/\d/u.test(token) && !/^(?:mm|cm|km|mol|mmol|kwh|kcal|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|log|ln|exp)$/i.test(token) && !/^\s*[+−\-*/=<>×÷]/.test(after) && (!after || /^[\s.,;:!?)]/.test(after))) add(page,match.index!,match.index!+match[0].length,'Footnote marker');
    }
    // Paired Markdown emphasis markers are formatting, not part of the prose.
    for (const match of text.matchAll(/(?<![\p{L}\p{N}*_~])(\*{1,2}|_{1,2}|~~)(?=\S)([^\n]*?\S)\1(?![\p{L}\p{N}*_~])/gu)) {
      add(page,match.index!,match.index!+match[1].length,'Formatting marker');
      add(page,match.index!+match[0].length-match[1].length,match.index!+match[0].length,'Formatting marker');
    }
  });
  // Prefer a whole reference entry over small citations inside that entry.
  const sorted=omissions.sort((a,b)=>a.page-b.page || a.start-b.start || b.end-a.end);
  const result:ReadingOmission[]=[];
  for (const candidate of sorted) {
    const previous=result.at(-1);
    if (!previous || previous.page!==candidate.page || candidate.start>=previous.end) result.push(candidate);
  }
  return result;
}

export function buildSpeechPlan(passages:Passage[],omissions:ReadingOmission[],enabled:boolean,restored:ReadonlySet<string>=new Set()) {
  const active=enabled?omissions.filter(item=>!restored.has(item.id)):[];
  const queue:SpokenPassage[]=[];
  const sourceToSpeech=new Map<number,number>();
  const byPage=new Map<number,ReadingOmission[]>();
  for (const item of active) { const list=byPage.get(item.page)??[]; list.push(item); byPage.set(item.page,list); }
  passages.forEach((passage,sourceIndex)=>{
    let text=passage.text;
    const ranges=(byPage.get(passage.page)??[]).filter(item=>item.start<passage.end && item.end>passage.start);
    for (const range of ranges.toReversed()) {
      const start=Math.max(0,range.start-passage.start),end=Math.min(text.length,range.end-passage.start);
      text=text.slice(0,start)+(range.reason==='Formatting marker'?'':' ')+text.slice(end);
    }
    text=text.replace(/\s+/g,' ').replace(/\s+([,.;:!?])/g,'$1').trim();
    if (!text || (ranges.length>0 && !/[\p{L}\p{N}]/u.test(text))) return;
    sourceToSpeech.set(sourceIndex,queue.length); queue.push({text,sourceIndex,page:passage.page});
  });
  return {queue,sourceToSpeech,skippedCount:active.length,words:queue.reduce((sum,item)=>sum+item.text.split(/\s+/).length,0)};
}
