type ReadingVoice = Pick<SpeechSynthesisVoice, 'name' | 'voiceURI'>;

// A null selection follows the preferred voice, including when voices load late.
// An explicit choice (including Device default) survives voiceschanged events.
export function resolveReadingVoice<T extends ReadingVoice>(voices: T[], selectedId: string | null): T | null {
  if (selectedId === 'system') return null;
  if (selectedId !== null) return voices.find(voice => voice.voiceURI === selectedId) ?? null;
  return voices.find(voice => /^Google UK English Male$/i.test(voice.name.trim())) ?? null;
}
