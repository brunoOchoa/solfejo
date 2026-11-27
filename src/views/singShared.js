import { field, select } from '../dom.js';
import { keyLabel } from '../music/theory.js';
import { h } from '../dom.js';
import {
  INSTRUMENTS, getInstrument, setInstrument,
} from '../music/audio.js';

/** Instrumento que toca as notas (preferência global, vale para Notas e Cantar). */
export const instrumentField = () => field('Instrumento', select(INSTRUMENTS, getInstrument(), (v) => setInstrument(v)));

/** Campo de configuração: suavização da linha do gráfico (aplica na hora, sem reiniciar o exercício). */
export const smoothField = (cfg, ctx) => field('Suavização do gráfico', select(
  [['soft', 'Suave (linha mais calma)'], ['normal', 'Normal'], ['fast', 'Responsiva (mais detalhe)']],
  cfg.smooth, (v) => ctx.setSmoothing(v),
));

export const SING_DEFAULTS = {
  mode: 'melody', key: 'auto', maxAcc: 0, register: 0, anyOctave: true, smooth: 'soft',
  // melodia
  level: 1, length: 8, bpm: 60, names: true, click: true,
  // nota única
  tol: 25, hold: 800, auto: true, chromatic: false, count: 10, showName: true,
};

const KEY_ORDER = [0, 1, 2, 3, 4, 5, -1, -2, -3, -4, -5];

/** Opções do seletor de tom. */
export const keyOptions = () => [
  ['auto', 'Sorteado (veja "até N alterações")'],
  ...KEY_ORDER.map((n) => [String(n), keyLabel(n).split(' / ')[0]]),
];

export const REGISTER_OPTIONS = [[0, 'Como escrito (voz aguda)'], [-1, 'Uma oitava abaixo (voz grave)']];

/** Escolhe a armadura: fixa (cfg.key) ou sorteada entre ±maxAcc. */
export function pickKey(cfg) {
  if (cfg.key !== 'auto') return Number(cfg.key);
  return cfg.maxAcc ? Math.floor(Math.random() * (2 * cfg.maxAcc + 1)) - cfg.maxAcc : 0;
}

/**
 * Botão "🎼 Exercício" (só aparece no celular) que mostra/esconde as opções rápidas dadas.
 * No desktop elas ficam sempre à vista.
 */
export function quickToggle(...els) {
  els.forEach((e) => e.classList.add('collapsible'));
  const btn = h('button', { class: 'btn quick-toggle', 'aria-expanded': 'false', onclick: () => {
    let open = false;
    els.forEach((e) => { open = e.classList.toggle('open'); });
    btn.setAttribute('aria-expanded', open);
  } }, '🎼 Exercício');
  return btn;
}
