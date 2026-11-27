// Tema = modo ('auto' segue o sistema, 'light', 'dark') + paleta de cores (ver palettes.js).
// Os valores viram variáveis CSS em <html>; o último conjunto fica em cache para o index.html pintar sem piscar.
import { load, save } from './storage.js';
import { PALETTES, DEFAULT_PALETTE, getPalette, paletteVars } from './palettes.js';

const MODES = ['auto', 'light', 'dark'];
export const THEME_LABEL = { auto: 'Auto', light: 'Claro', dark: 'Escuro' };
export const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
export { PALETTES };

let mode = load('pref.theme', 'dark');
if (!MODES.includes(mode)) mode = 'auto';
let palette = load('pref.palette', DEFAULT_PALETTE);
if (!PALETTES.some((p) => p.id === palette)) palette = DEFAULT_PALETTE;

export const getTheme = () => mode;
export const getPaletteId = () => palette;

/** Tema efetivo ('light' | 'dark'), resolvendo o modo automático. */
export const effectiveTheme = () => (mode === 'auto'
  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : mode);

/** Cor de destaque da nota atual nas pautas, em hex (o SVG precisa do valor literal). */
export const highlight = () => getPalette(palette)[effectiveTheme()].brand2;

function apply() {
  const root = document.documentElement;
  const eff = effectiveTheme();
  const vars = paletteVars(palette, eff);
  root.dataset.theme = eff;
  root.dataset.palette = palette;
  root.style.colorScheme = eff;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', vars['--bg']);
  try { localStorage.setItem('solfejo:themevars', JSON.stringify({ theme: eff, palette, vars })); } catch { /* sem cache */ }
  window.dispatchEvent(new CustomEvent('themechange'));
}

export function setTheme(next) {
  mode = next;
  save('pref.theme', mode);
  apply();
}

export function setPalette(next) {
  palette = getPalette(next).id;
  save('pref.palette', palette);
  apply();
}

export const cycleTheme = () => setTheme(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);

export function initTheme() {
  apply();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (mode === 'auto') apply();
  });
}
