// Web Audio API-based sound effects (no external files).
// Uses OscillatorNode + GainNode to synthesize game sounds.

let ctx = null;
function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {}
  }
  return ctx;
}

function tone(freq, dur = 0.15, type = "sine", vol = 0.15, delay = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime + delay);
  g.gain.setValueAtTime(0, a.currentTime + delay);
  g.gain.linearRampToValueAtTime(vol, a.currentTime + delay + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + delay + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + delay);
  o.stop(a.currentTime + delay + dur + 0.02);
}

export const sfx = {
  // Countdown 3-2-1-GO
  countdown: () => {
    tone(440, 0.2, "square", 0.12, 0);
    tone(440, 0.2, "square", 0.12, 1.0);
    tone(440, 0.2, "square", 0.12, 2.0);
    tone(880, 0.4, "square", 0.15, 3.0);
  },
  tick: () => tone(1200, 0.05, "square", 0.08),
  correct: () => {
    tone(523.25, 0.12, "sine", 0.18, 0);
    tone(659.25, 0.12, "sine", 0.18, 0.12);
    tone(783.99, 0.2, "sine", 0.2, 0.24);
  },
  wrong: () => {
    tone(220, 0.15, "sawtooth", 0.15, 0);
    tone(110, 0.3, "sawtooth", 0.18, 0.15);
  },
  attack: () => {
    tone(180, 0.08, "square", 0.15, 0);
    tone(120, 0.15, "square", 0.15, 0.08);
  },
  win: () => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => tone(n, 0.25, "triangle", 0.22, i * 0.18));
  },
  powerup: () => {
    tone(880, 0.08, "triangle", 0.14, 0);
    tone(1320, 0.12, "triangle", 0.14, 0.08);
  },
  join: () => tone(660, 0.15, "sine", 0.1),
  resume: () => {
    const a = ac();
    if (a && a.state === "suspended") a.resume();
  },
};
