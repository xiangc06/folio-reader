export type PlayerStatus = 'idle' | 'playing' | 'paused' | 'ended';
type SpeechPort = Pick<SpeechSynthesis, 'speak' | 'cancel' | 'resume'>;
export type PlayerSnapshot = { index: number; status: PlayerStatus };

// A session number prevents late browser callbacks from restarting canceled speech.
export class SpeechPlayer {
  private synth: SpeechPort;
  private utteranceFactory: (text: string) => SpeechSynthesisUtterance;
  private onChange: (state: PlayerSnapshot) => void;
  private onError: (message: string) => void;
  private session = 0;
  private texts: string[] = [];
  private utterance: SpeechSynthesisUtterance | null = null;
  private index = 0;
  private status: PlayerStatus = 'idle';
  private rate = 1;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(synth: SpeechPort, utteranceFactory: (text: string) => SpeechSynthesisUtterance, onChange: (state: PlayerSnapshot) => void, onError: (message: string) => void) {
    this.synth = synth; this.utteranceFactory = utteranceFactory; this.onChange = onChange; this.onError = onError;
  }
  private emit() { this.onChange({ index: this.index, status: this.status }); }
  private cancel() { this.session++; this.synth.cancel(); this.utterance = null; }
  load(texts: string[]) { this.cancel(); this.texts = texts; this.index = 0; this.status = 'idle'; this.emit(); }
  configure(rate: number, voice: SpeechSynthesisVoice | null) {
    const restart = this.status === 'playing';
    this.cancel(); this.rate = rate; this.voice = voice;
    if (restart) this.play();
  }
  play() {
    if (!this.texts.length) return;
    if (this.status === 'ended') this.index = 0;
    this.cancel(); this.synth.resume(); this.status = 'playing';
    this.speak(this.session);
  }
  private speak(session: number) {
    if (session !== this.session || this.status !== 'playing') return;
    const utterance = this.utteranceFactory(this.texts[this.index]);
    this.utterance = utterance; utterance.rate = this.rate;
    if (this.voice) { utterance.voice = this.voice; utterance.lang = this.voice.lang; }
    utterance.onend = () => {
      if (session !== this.session || this.status !== 'playing') return;
      if (this.index + 1 < this.texts.length) { this.index++; this.speak(session); }
      else { this.status = 'ended'; this.utterance = null; this.emit(); }
    };
    utterance.onerror = (event) => {
      if (session !== this.session) return;
      this.cancel(); this.status = 'paused'; this.emit();
      this.onError(event.error === 'not-allowed' ? 'Your browser blocked audio. Press Read aloud again, or open this page in Safari, Chrome, or Edge.' : 'This voice could not play. Choose another voice and press Read aloud.');
    };
    this.emit();
    try { this.synth.speak(utterance); }
    catch { this.cancel(); this.status = 'paused'; this.emit(); this.onError('Audio could not start. Try another voice or browser.'); }
  }
  pause() { this.cancel(); this.status = 'paused'; this.emit(); }
  stop() { this.cancel(); this.index = 0; this.status = 'idle'; this.emit(); }
  seek(index: number) {
    const playing = this.status === 'playing';
    this.cancel(); this.index = Math.max(0, Math.min(this.texts.length - 1, Math.round(index)));
    this.status = playing ? 'playing' : 'paused';
    if (playing) { this.synth.resume(); this.speak(this.session); } else this.emit();
  }
  destroy() { this.cancel(); }
}
