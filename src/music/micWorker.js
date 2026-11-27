// Worker do microfone: recebe blocos do AudioWorklet (por uma porta direta), mede volume e afinação e devolve os resultados.
// Fica fora da thread principal: página pesada ou aba em segundo plano não atrapalham a medição.
import { analyzeBlock } from './captureCore.js';

let sr = 48000;
let detect = {};
let noPitch = false;

function onBlock(e) {
  const { buf, endSec, seq } = e.data;
  const r = analyzeBlock(buf, sr, detect, noPitch);
  self.postMessage({
    type: 'frame', endSec, seq, rms: r.rms, peak: r.peak, rmsLow: r.rmsLow, freq: r.freq, clarity: r.clarity,
  });
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    sr = m.sr;
    detect = m.detect || {};
    noPitch = !!m.noPitch;
    m.port.onmessage = onBlock;
    self.postMessage({ type: 'ready' });
  } else if (m.type === 'config') {
    if (m.detect) detect = m.detect;
    if (m.noPitch != null) noPitch = !!m.noPitch;
  }
};
