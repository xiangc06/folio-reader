import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from '../lib/reader-model.ts';
import { findReadingOmissions, buildSpeechPlan } from '../lib/reading-filter.ts';
import { resolveReadingVoice } from '../lib/reading-voice.ts';
import { SpeechPlayer } from '../lib/speech-player.ts';

function fixture(pages) {
  const document = makeDocument('Reading check', 'Text', pages);
  const omissions = findReadingOmissions(document.pages);
  const plan = (enabled = true, restored = new Set()) => buildSpeechPlan(document.passages, omissions, enabled, restored);
  return { document, omissions, plan, spoken: () => plan().queue.map(item => item.text).join(' ') };
}

test('short paragraph labels, list labels, and decorative symbols do not reach speech', () => {
  const f = fixture(['1. A short paragraph.\n\n(2) Another paragraph.\n\n¶12 this starts in lowercase.\n\n• Read this sentence.\n\n***\n\n# Heading\n\n- Keep reading.']);
  assert.equal(f.spoken(), 'A short paragraph. Another paragraph. this starts in lowercase. Read this sentence. Heading Keep reading.');
});

test('numeric and author-year citations are removed with their enclosing wrappers', () => {
  const f = fixture(['The treatment improved recovery[12]. Our result ([2, 4–6]) was confirmed (Smith et al., 2020). More evidence (van der Waals, 2020; Jones 2021: 12–14) supports it.']);
  assert.equal(f.spoken(), 'The treatment improved recovery. Our result was confirmed. More evidence supports it.');
});

test('footnote and emphasis markers are removed while their words remain', () => {
  assert.equal(fixture(['The **important** result¹ was *clear*. The **reader**’s voice.\n\n† A note.']).spoken(), 'The important result was clear. The reader’s voice. A note.');
});

test('ordinary numbers, mathematical symbols, identifiers, and meaningful parentheses survive', () => {
  const text = 'Paragraph 12 describes the results. Revenue rose 12% to $40 at 20°C. E = mc². The identity sin² + cos² = 1 is useful. Use array[12] and x[1]. The interval [1, 2] is closed. It took 3.14 seconds (about three). a * b * c = 6.';
  assert.equal(fixture([text]).spoken(), text);
  const specialCases = ['- x = 2 implies x = -2.', '§12 applies to every reader.', 'The vector entries [1, 2] were added.', 'The code reads prices[12] and returns it.'];
  for (const source of specialCases) assert.equal(fixture([source]).spoken(), source);
});

test('reference lists span pages and stop before appendix prose', () => {
  const f = fixture(['Main text.\n\nReferences\n1. Smith J. Reading in the modern age. 2020.', '2. Jones K. More reading. 2021.\n\nAppendix A Additional Results\n\nThis paragraph must still be read.']);
  assert.equal(f.spoken(), 'Main text. Appendix A Additional Results This paragraph must still be read.');
});

test('a reference heading alone does not hide ordinary prose', () => {
  assert.equal(fixture(['References\n\nThis section explains how references help the reader.']).spoken(), 'References This section explains how references help the reader.');
});

test('filtered documents preserve full source text and allow individual restoration or reading everything', () => {
  const source = '1. A short statement [12].\n\n***';
  const f = fixture([source]);
  assert.equal(f.document.pages[0], source);
  const citation = f.omissions.find(item => item.text === '[12]');
  assert.ok(citation);
  assert.equal(f.plan(true, new Set([citation.id])).queue.map(item => item.text).join(' '), 'A short statement [12].');
  assert.equal(f.plan(false).queue.map(item => item.text).join(' '), '1. A short statement [12]. ***');
  for (const item of f.omissions) assert.equal(f.document.pages[item.page].slice(item.start, item.end), item.text);
});

test('omission offsets remain correct across wrapped lines, long chunks, and Unicode', () => {
  const prose = 'Words about reading and understanding the world. '.repeat(9);
  const f = fixture([`\n  12. ${prose}\nThe result 😀 (Smith, 2020)\nwas clear[3].\n\n${prose}`]);
  assert.equal(f.spoken(), `${prose}The result 😀 was clear. ${prose}`.trim());
  for (const passage of f.document.passages) assert.equal(f.document.pages[passage.page].slice(passage.start, passage.end).replace(/\n/g, ' '), passage.text);
});

test('citation-only and decoration-only passages never become empty utterances', () => {
  const f = fixture(['***\n\n[12]\n\nThe result is clear.']);
  const plan = f.plan();
  assert.deepEqual(plan.queue.map(item => item.text), ['The result is clear.']);
  assert.equal(plan.sourceToSpeech.get(2), 0);
  assert.equal(plan.sourceToSpeech.has(0), false);
  const spoken = [];
  const player = new SpeechPlayer({ speak: u => spoken.push(u), cancel() {}, resume() {} }, text => ({ text }), () => {}, () => assert.fail('Speech error'));
  player.load(plan.queue.map(item => item.text));
  player.play();
  assert.equal(spoken[0].text, 'The result is clear.');
  spoken[0].onend();
  assert.equal(spoken.length, 1);
});

test('a document consisting only of clutter has no speech queue', () => {
  assert.deepEqual(fixture(['***\n\n[12]']).plan().queue, []);
});

const male = { name: 'Google UK English Male', voiceURI: 'google-uk-male', lang: 'en-GB' };
const female = { name: 'Google UK English Female', voiceURI: 'google-uk-female', lang: 'en-GB' };
const device = { name: 'Device voice', voiceURI: 'device-en', lang: 'en-US' };

test('Google UK English Male becomes the default even when voices arrive late', () => {
  assert.equal(resolveReadingVoice([], null), null);
  assert.equal(resolveReadingVoice([device], null), null);
  assert.equal(resolveReadingVoice([female, device, male], null), male);
});

test('an explicit voice or Device default survives refreshed voice lists', () => {
  assert.equal(resolveReadingVoice([female, device, male], device.voiceURI), device);
  assert.equal(resolveReadingVoice([female, device, male], 'system'), null);
  assert.equal(resolveReadingVoice([device], male.voiceURI), null);
  assert.equal(resolveReadingVoice([device, male], male.voiceURI), male);
});

test('the preferred voice is assigned to the actual speech utterance', () => {
  let utterance;
  const player = new SpeechPlayer({ speak: u => { utterance = u; }, cancel() {}, resume() {} }, text => ({ text }), () => {}, () => assert.fail('Speech error'));
  player.load(['A fluid reading.']);
  player.configure(1, resolveReadingVoice([device, female, male], null));
  player.play();
  assert.equal(utterance.voice, male);
  assert.equal(utterance.lang, 'en-GB');
});
