/**
 * 100% Procedural Web Audio API V12 Acoustic Synthesizer.
 *
 * A 60° 4-stroke V12 fires 6 times per crankshaft revolution, producing
 * a signature 6th-order harmonic howl (f_fire = 6 * RPM / 60 = RPM / 10 Hz)
 * layered with 3rd-order bank pulse, 12th-order metallic scream,
 * bandpass-filtered intake induction roar, and subtle valvetrain whir.
 */
export class V12AudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;
  private intakeFilter: BiquadFilterNode | null = null;
  private intakeGain: GainNode | null = null;
  private osc3rd: OscillatorNode | null = null;
  private osc6th: OscillatorNode | null = null;
  private osc12th: OscillatorNode | null = null;
  private osc18th: OscillatorNode | null = null;
  private gain3rd: GainNode | null = null;
  private gain6th: GainNode | null = null;
  private gain12th: GainNode | null = null;
  private gain18th: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private enabled = false;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public toggle(): boolean {
    if (!this.enabled) {
      this.start();
    } else {
      this.stop();
    }
    return this.enabled;
  }

  public start(): void {
    if (this.enabled) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.enabled = true;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setTargetAtTime(0.24, this.ctx.currentTime, 0.08);
    }
  }

  public stop(): void {
    this.enabled = false;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.06);
    }
  }

  private buildGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    // Gentle waveshaper for warm analog exhaust saturation
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = Math.tanh(x * 2.1);
    }
    shaper.curve = curve;

    const exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = 'lowpass';
    exhaustFilter.frequency.value = 600;
    exhaustFilter.Q.value = 2.4;

    // 3rd order (single bank firing: RPM / 20 Hz) - low burble
    const osc3rd = ctx.createOscillator();
    osc3rd.type = 'sawtooth';
    const gain3rd = ctx.createGain();
    gain3rd.gain.value = 0.24;

    // 6th order (primary V12 firing fundamental: RPM / 10 Hz)
    const osc6th = ctx.createOscillator();
    osc6th.type = 'sawtooth';
    const gain6th = ctx.createGain();
    gain6th.gain.value = 0.42;

    // 12th order (2nd harmonic of firing order — classic Italian F1/V12 wail)
    const osc12th = ctx.createOscillator();
    osc12th.type = 'triangle';
    const gain12th = ctx.createGain();
    gain12th.gain.value = 0.26;

    // 18th order (metallic upper harmonic shimmer past 6,000 RPM)
    const osc18th = ctx.createOscillator();
    osc18th.type = 'sine';
    const gain18th = ctx.createGain();
    gain18th.gain.value = 0.08;

    osc3rd.connect(gain3rd).connect(exhaustFilter);
    osc6th.connect(gain6th).connect(exhaustFilter);
    osc12th.connect(gain12th).connect(exhaustFilter);
    osc18th.connect(gain18th).connect(exhaustFilter);

    exhaustFilter.connect(shaper).connect(masterGain);

    // Bandpass noise for carbon intake induction howl
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.frequency.value = 800;
    intakeFilter.Q.value = 3.2;

    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0.04;

    noiseSource.connect(intakeFilter).connect(intakeGain).connect(masterGain);
    masterGain.connect(ctx.destination);

    osc3rd.start();
    osc6th.start();
    osc12th.start();
    osc18th.start();
    noiseSource.start();

    this.masterGain = masterGain;
    this.exhaustFilter = exhaustFilter;
    this.intakeFilter = intakeFilter;
    this.intakeGain = intakeGain;
    this.osc3rd = osc3rd;
    this.osc6th = osc6th;
    this.osc12th = osc12th;
    this.osc18th = osc18th;
    this.gain3rd = gain3rd;
    this.gain6th = gain6th;
    this.gain12th = gain12th;
    this.gain18th = gain18th;
    this.noiseSource = noiseSource;
  }

  public update(rpm: number, isPlaying: boolean): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    if (!isPlaying || rpm < 80) {
      this.masterGain.gain.setTargetAtTime(0.0, now, 0.05);
      return;
    }

    const clampedRpm = Math.max(400, Math.min(9600, rpm));
    const norm = (clampedRpm - 800) / 8700; // 0 at idle, 1 at redline

    // V12 6th order firing fundamental = RPM / 10 Hz (e.g. 900 RPM -> 90 Hz, 9000 RPM -> 900 Hz)
    const f6 = clampedRpm / 10;
    this.osc3rd?.frequency.setTargetAtTime(f6 * 0.5, now, 0.025);
    this.osc6th?.frequency.setTargetAtTime(f6, now, 0.025);
    this.osc12th?.frequency.setTargetAtTime(f6 * 2.0, now, 0.025);
    this.osc18th?.frequency.setTargetAtTime(f6 * 3.0, now, 0.025);

    // Filter opens dramatically as revs climb into the screaming upper range
    const cutoff = 320 + Math.pow(Math.max(0, norm), 1.35) * 3400;
    this.exhaustFilter?.frequency.setTargetAtTime(cutoff, now, 0.03);

    // Shift tonal balance from warm burble at idle to high-order F1 scream at redline
    this.gain3rd?.gain.setTargetAtTime(0.28 - norm * 0.14, now, 0.04);
    this.gain6th?.gain.setTargetAtTime(0.36 + norm * 0.14, now, 0.04);
    this.gain12th?.gain.setTargetAtTime(0.14 + norm * 0.34, now, 0.04);
    this.gain18th?.gain.setTargetAtTime(0.02 + Math.pow(Math.max(0, norm), 2) * 0.24, now, 0.04);

    // Carbon plenum induction intake roar
    this.intakeFilter?.frequency.setTargetAtTime(480 + norm * 2200, now, 0.03);
    this.intakeGain?.gain.setTargetAtTime(0.025 + Math.pow(Math.max(0, norm), 1.5) * 0.18, now, 0.04);

    const targetVol = 0.16 + Math.max(0, norm) * 0.16;
    this.masterGain.gain.setTargetAtTime(targetVol, now, 0.04);
  }

  public dispose(): void {
    this.enabled = false;
    try {
      this.osc3rd?.stop();
      this.osc6th?.stop();
      this.osc12th?.stop();
      this.osc18th?.stop();
      this.noiseSource?.stop();
      void this.ctx?.close();
    } catch {
      // ignore already-stopped nodes
    }
    this.ctx = null;
  }
}
