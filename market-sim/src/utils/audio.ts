export type GameCue =
  | 'market-open'
  | 'closing-warning'
  | 'trade-success'
  | 'trade-error'
  | 'key-article'
  | 'rank-up';

type Tone = {
  frequency: number;
  start: number;
  duration: number;
};

const CUES: Record<GameCue, Tone[]> = {
  'market-open': [
    { frequency: 880, start: 0, duration: 0.18 },
    { frequency: 660, start: 0.16, duration: 0.22 },
  ],
  'closing-warning': [
    { frequency: 520, start: 0, duration: 0.08 },
    { frequency: 520, start: 0.16, duration: 0.08 },
  ],
  'trade-success': [
    { frequency: 760, start: 0, duration: 0.05 },
    { frequency: 980, start: 0.06, duration: 0.07 },
  ],
  'trade-error': [{ frequency: 180, start: 0, duration: 0.12 }],
  'key-article': [
    { frequency: 740, start: 0, duration: 0.08 },
    { frequency: 440, start: 0.08, duration: 0.12 },
  ],
  'rank-up': [
    { frequency: 660, start: 0, duration: 0.07 },
    { frequency: 880, start: 0.07, duration: 0.08 },
    { frequency: 1100, start: 0.14, duration: 0.1 },
  ],
};

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export function playGameCue(cue: GameCue, volume = 0.18): void {
  if (typeof window === 'undefined') return;
  const AudioContextCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!AudioContextCtor) return;

  const context = new AudioContextCtor();
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(context.destination);

  const startedAt = context.currentTime;
  for (const tone of CUES[cue]) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = cue === 'trade-error' ? 'sawtooth' : 'sine';
    oscillator.frequency.value = tone.frequency;
    oscillator.connect(envelope);
    envelope.connect(gain);

    const start = startedAt + tone.start;
    const end = start + tone.duration;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(1, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }

  const longest = Math.max(...CUES[cue].map(tone => tone.start + tone.duration));
  window.setTimeout(() => void context.close(), Math.ceil((longest + 0.05) * 1000));
}
