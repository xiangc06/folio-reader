export type PDFReadMode = 'optical' | 'auto';
export const PDF_READ_MODES = [
  {value:'optical',label:'Optical OCR (recommended)'},
  {value:'auto',label:'PDF text with automatic OCR'},
];

// These detect broken character mappings, not every possible encoding error.
export function hasBrokenPDFText(text: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ue000-\uf8ff\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}]/u.test(text);
}

type PageReader = {
  mode: PDFReadMode;
  readEmbedded: () => Promise<string>;
  readOptical: () => Promise<string>;
  signal: AbortSignal;
};
export type PDFPageResult = {text:string; source:'optical'|'embedded'; note?:string};

export async function readPDFPage({mode,readEmbedded,readOptical,signal}:PageReader):Promise<PDFPageResult> {
  signal.throwIfAborted();
  const optical = async ():Promise<PDFPageResult> => {
    const text=await readOptical(); signal.throwIfAborted();
    return {text,source:'optical'};
  };
  // Optical mode never requests the text layer, even when it looks valid.
  if (mode==='optical') return optical();
  let embedded: string;
  try { embedded=await readEmbedded(); }
  catch {
    signal.throwIfAborted();
    return {...await optical(),note:'PDF text could not be decoded. Used optical recognition.'};
  }
  signal.throwIfAborted();
  const broken=hasBrokenPDFText(embedded);
  if (!broken && embedded.replace(/\s/g,'').length>=30) return {text:embedded,source:'embedded'};
  let result:PDFPageResult;
  try { result=await optical(); }
  catch (error) {
    signal.throwIfAborted();
    // Keep sparse but readable text only. Never silently use a known broken map.
    if (!broken && embedded.trim()) return {text:embedded,source:'embedded',note:'Optical recognition failed. Kept the readable PDF text.'};
    throw error;
  }
  if (broken) return {...result,note:'The PDF contains invalid character mappings. Used optical recognition.'};
  if (result.text.trim().length<embedded.trim().length) return {text:embedded,source:'embedded'};
  return result;
}
