export const MAX_CHARACTERS = 1_000_000;
export type Passage = { text: string; page: number; paragraph: number };
export type ReadingDocument = { id: string; name: string; kind: string; pages: string[]; passages: Passage[]; words: number; warnings: string[] };

export function cleanText(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/\0/g, '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function safeBoundary(text: string, index: number): number {
  const before = text.charCodeAt(index - 1), after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? index - 1 : index;
}

export function paginateText(text: string): string[] {
  const source = cleanText(text);
  const pages: string[] = [];
  let remaining = source;
  while (remaining.length > 5000) {
    let boundary = remaining.lastIndexOf('\n\n', 5000);
    if (boundary < 2500) boundary = remaining.lastIndexOf(' ', 5000);
    if (boundary < 2500) boundary = 5000;
    boundary = safeBoundary(remaining, boundary);
    pages.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) pages.push(remaining);
  return pages;
}

export function splitPassages(pages: string[]): Passage[] {
  const passages: Passage[] = [];
  pages.forEach((pageText, page) => {
    cleanText(pageText).split(/\n\s*\n/).forEach((paragraphText, paragraph) => {
      let text = paragraphText.replace(/\n/g, ' ').trim();
      while (text) {
        let end = Math.min(text.length, 240);
        if (text.length > 240) {
          const candidate = text.slice(0, 240);
          const sentences = [...candidate.matchAll(/[.!?。！？](?:\s|$)/g)];
          const sentence = sentences.at(-1);
          end = sentence && sentence.index! > 50 ? sentence.index! + 1 : candidate.lastIndexOf(' ');
          if (end < 1) end = 240;
        }
        end = safeBoundary(text, end);
        passages.push({ text: text.slice(0, end).trim(), page, paragraph });
        text = text.slice(end).trim();
      }
    });
  });
  return passages;
}

export function makeDocument(name: string, kind: string, inputPages: string[], warnings: string[] = [], id = crypto.randomUUID()): ReadingDocument {
  const pages = inputPages.map(cleanText);
  const text = pages.join('\n\n');
  if (!text.trim()) throw new Error('No readable text was found. Try a clearer image, a different recognition language, or paste the text.');
  if (text.length > MAX_CHARACTERS) throw new Error('This document contains more than 1 million characters. Split it into smaller documents.');
  return { id, name, kind, pages, passages: splitPassages(pages), words: text.trim().split(/\s+/u).length, warnings };
}

export const sampleDocument = makeDocument('A little room to read', 'Sample', [
  'Some things deserve your full attention. Others are better with a little freedom to look away.\n\nFolio gives your documents a voice. Bring a PDF, a Word document, a photo of a page, or a few lines of text. Then settle in, press play, and follow along at your own pace.\n\nThis is a sample to try your voice and reading speed. Your own words are just a file away.'
], [], 'sample');
