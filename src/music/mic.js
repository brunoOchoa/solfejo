// Captura do microfone + detecção de afinação em tempo real.
// Motor novo (AudioWorklet + Worker): blocos com a hora exata do relógio de áudio, análise fora da thread principal.
// Motor clássico (reserva): AnalyserNode lido por setInterval. O app escolhe sozinho e cai para o clássico se algo falhar.
import { getCtx } from './audio.js';
import { getPrefInput, setPrefInput, getPrefEngine } from './audioProfile.js';
import {
  WINDOW, hopFor, workletSource, analyzeBlock, ClockMap, FrameStats,
} from './captureCore.js';

export class Mic {
  /** detect: opções do detector (minFreq/maxFreq…); pode ser trocado a qualquer momento em `mic.detect`. */
  constructor(onFrame, detect = {}) {
    this.onFrame = onFrame;
    this._detect = detect;
    this._noPitch = false;
    this.stream = null;
    this.timer = 0;
    this.level = { rms: 0, peak: 0, t: 0 }; // volume cru do último bloco (para o medidor); t = hora (performance.now) do fim do bloco
    this.info = null; // { label, deviceId, sampleRate, channelCount, processing }
    this.muted = false;
    this.fellBack = false; // a entrada escolhida sumiu e o app voltou para a padrão
    this.onEnded = null; // chamado se o dispositivo for desconectado
    this.engine = null; // 'worklet' | 'analyser'
    this.engineNote = ''; // por que caiu para o clássico, se caiu
    this.frameStats = new FrameStats();
  }

  /** Quem só usa o espectro (acordes) não paga a detecção de altura. */
  get noPitch() { return this._noPitch; }

  set noPitch(v) { this._noPitch = !!v; this.worker?.postMessage({ type: 'config', noPitch: this._noPitch }); }

  get detect() { return this._detect; }

  set detect(v) { this._detect = v; this.worker?.postMessage({ type: 'config', detect: v }); }

  get active() {
    return !!this.stream;
  }

  /** Entradas de áudio disponíveis (os nomes só aparecem depois que o usuário permitiu o microfone). */
  static async listInputs() {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId);
    } catch {
      return [];
    }
  }

  /** Lança erro com .name = 'NotAllowedError' etc. se o usuário negar. Usa a entrada escolhida em Áudio (ou a padrão). */
  async start() {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('sem suporte'), { name: 'NotSupportedError' });
    // sem processamento de voz; mono (microfones USB às vezes aparecem em estéreo); pede a menor latência que o aparelho der
    const base = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 }, latency: { ideal: 0 },
    };
    const pref = getPrefInput();
    this.fellBack = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: pref ? { ...base, deviceId: { exact: pref } } : base });
    } catch (err) {
      if (pref && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        setPrefInput('');
        this.fellBack = true;
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: base });
      } else throw err;
    }
    const track = this.stream.getAudioTracks()[0];
    const st = track?.getSettings?.() ?? {};
    this.info = {
      label: track?.label || '',
      deviceId: st.deviceId || '',
      sampleRate: st.sampleRate || 0,
      channelCount: st.channelCount || 0,
      processing: { echoCancellation: st.echoCancellation, noiseSuppression: st.noiseSuppression, autoGainControl: st.autoGainControl },
    };
    this.muted = !!track?.muted;
    if (track) {
      track.onmute = () => { this.muted = true; };
      track.onunmute = () => { this.muted = false; };
      track.onended = () => { this.stop(); this.onEnded?.(); };
    }
    const ctx = getCtx();
    this.source = ctx.createMediaStreamSource(this.stream);
    // o bloco analisado termina agora e tem ~85 ms: o centro dele é ~metade disso no passado
    this.lagMs = (WINDOW / 2 / ctx.sampleRate) * 1000;
    this.frameStats = new FrameStats();
    this.engine = null;
    this.engineNote = '';
    if (getPrefEngine() === 'legacy') this.engineNote = 'motor clássico escolhido em Áudio';
    else {
      try {
        await this.startWorklet(ctx);
      } catch (err) {
        this.engineNote = `AudioWorklet indisponível (${err?.message || err?.name || 'erro'})`;
        this.stopWorklet();
      }
    }
    if (!this.stream) return; // foi parado enquanto o motor novo subia
    if (!this.engine) this.startLegacy(ctx);
  }

  // ---- motor novo: AudioWorklet + Worker ------------------------------------------------------
  async startWorklet(ctx) {
    if (!ctx.audioWorklet || typeof Worker === 'undefined') throw new Error('sem suporte neste navegador');
    if (!ctx.solfejoCapture) {
      const url = URL.createObjectURL(new Blob([workletSource()], { type: 'text/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      ctx.solfejoCapture = true;
    }
    if (!this.stream) throw new Error('parado');
    const node = new AudioWorkletNode(ctx, 'solfejo-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit', processorOptions: { win: WINDOW, hop: hopFor(ctx.sampleRate) },
    });
    const chan = new MessageChannel();
    node.port.postMessage({ port: chan.port1 }, [chan.port1]);
    const worker = new Worker(new URL('./micWorker.js', import.meta.url), { type: 'module' });
    this.node = node;
    this.worker = worker;
    const ready = new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('o analisador não respondeu')), 3000);
      worker.onmessage = (e) => { if (e.data.type === 'ready') { clearTimeout(to); res(); } else this.onWorkerMsg(e.data); };
      worker.onerror = (e) => { clearTimeout(to); rej(new Error(e.message || 'erro no analisador')); };
    });
    worker.postMessage({
      type: 'init', port: chan.port2, sr: ctx.sampleRate, detect: this._detect, noPitch: this._noPitch,
    }, [chan.port2]);
    await ready;
    // relógio de áudio → performance.now()
    this.clock = new ClockMap();
    const sample = () => this.clock.add(ctx.currentTime, performance.now());
    sample();
    this.clockTimer = setInterval(sample, 100);
    const first = new Promise((res, rej) => {
      this.gotFirst = res;
      setTimeout(() => rej(new Error('nenhum bloco de áudio chegou')), 2000);
    });
    // o nó precisa estar no grafo para processar: sai mudo para o destino
    this.mute = ctx.createGain();
    this.mute.gain.value = 0;
    this.source.connect(node);
    node.connect(this.mute).connect(ctx.destination);
    await first;
    worker.onerror = (e) => this.degrade(e.message || 'erro no analisador');
    this.engine = 'worklet';
  }

  onWorkerMsg(d) {
    if (d.type !== 'frame' || !this.clock) return;
    const now = performance.now();
    const end = this.clock.perfOf(d.endSec);
    this.level = { rms: d.rms, peak: d.peak, t: end };
    this.frameStats.add(end, Math.max(0, now - end));
    if (this.gotFirst) { this.gotFirst(); this.gotFirst = null; }
    if (!this._noPitch) {
      this.onFrame({
        rms: d.rmsLow, t: end - this.lagMs, freq: d.freq, clarity: d.clarity,
      });
    }
  }

  /** O motor novo falhou no meio do uso: continua no clássico. */
  degrade(reason) {
    if (!this.stream) return;
    this.engineNote = `Voltou ao motor clássico (${reason})`;
    this.stopWorklet();
    this.startLegacy(getCtx());
  }

  stopWorklet() {
    clearInterval(this.clockTimer);
    this.clockTimer = 0;
    if (this.worker) { this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate(); }
    this.worker = null;
    try { this.source?.disconnect(this.node); } catch { /* já desligado */ }
    this.node?.disconnect();
    this.mute?.disconnect();
    this.node = null;
    this.mute = null;
    this.clock = null;
    this.gotFirst = null;
    if (this.engine === 'worklet') this.engine = null;
  }

  // ---- motor clássico: AnalyserNode + setInterval ---------------------------------------------
  startLegacy(ctx) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = WINDOW;
    this.source.connect(this.analyser); // não conecta ao destino: evita microfonia
    this.buf = new Float32Array(WINDOW);
    this.frameStats.reset();
    this.engine = 'analyser';
    this.timer = setInterval(() => this.tick(), 30);
  }

  tick() {
    this.analyser.getFloatTimeDomainData(this.buf);
    const now = performance.now();
    const a = analyzeBlock(this.buf, getCtx().sampleRate, this._detect, this._noPitch);
    this.level = { rms: a.rms, peak: a.peak, t: now };
    this.frameStats.add(now, 0);
    if (this._noPitch) return;
    this.onFrame({
      rms: a.rmsLow, t: now - this.lagMs, freq: a.freq, clarity: a.clarity,
    });
  }

  /** Espectro em dB (janela longa, boa para separar notas de um acorde). Cria o analisador na primeira chamada. */
  spectrum() {
    if (!this.source) return null;
    const ctx = getCtx();
    if (!this.spec) {
      const a = ctx.createAnalyser();
      a.fftSize = 16384;
      a.smoothingTimeConstant = 0.35;
      a.minDecibels = -120;
      a.maxDecibels = -10;
      this.source.connect(a);
      this.spec = { a, db: new Float32Array(a.frequencyBinCount) };
    }
    this.spec.a.getFloatFrequencyData(this.spec.db);
    return { db: this.spec.db, sampleRate: ctx.sampleRate, lagMs: (16384 / 2 / ctx.sampleRate) * 1000 };
  }

  stop() {
    this.spec?.a.disconnect();
    this.spec = null;
    clearInterval(this.timer);
    this.timer = 0;
    this.stopWorklet();
    this.analyser?.disconnect();
    this.analyser = null;
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.stream = null;
    this.engine = null;
  }
}
