// Paletas de cor. Cada uma tem versão escura e clara; o modo (auto/claro/escuro) é escolhido à parte.
// Fonte única: o tema.js escreve estes valores como variáveis CSS em <html>. "aurora" é a original.
// bg = fundo · glow = brilho do fundo · card/card2 = superfícies · ink = texto · muted = texto secundário · line = bordas
// brand = cor principal · brand2 = destaque (também usado em texto) · brandInk = texto sobre brand
// ok/err/warn = acerto, erro e atenção ajustados para cada fundo.

export const PALETTES = [
  {
    id: 'aurora', name: 'Aurora', tag: 'Violeta e ciano',
    dark: { bg: '#0b0d1a', glow: '#1a1450', card: '#141830', card2: '#1b2040', ink: '#eef0ff', muted: '#98a1c7', line: '#272d55', brand: '#6f4dff', brand2: '#5ad6ff', brandInk: '#ffffff', ok: '#3ddc84', err: '#ff5a86', warn: '#ffb938' },
    light: { bg: '#f3f2fb', glow: '#e3dcff', card: '#ffffff', card2: '#f7f5ff', ink: '#1a1740', muted: '#65638f', line: '#e1ddf3', brand: '#6a43f0', brand2: '#0677b4', brandInk: '#ffffff', ok: '#0e7f38', err: '#d01650', warn: '#b45309' },
  },
  {
    id: 'brasa', name: 'Brasa', tag: 'Jazz club: laranja e ouro',
    dark: { bg: '#140d0a', glow: '#3d1b0b', card: '#201512', card2: '#2a1c17', ink: '#fff1e6', muted: '#c4a898', line: '#432d24', brand: '#ff7a3d', brand2: '#ffc857', brandInk: '#1a0d05', ok: '#7bd88f', err: '#ff6b6b', warn: '#ffc857' },
    light: { bg: '#fdf4ec', glow: '#ffe0c8', card: '#ffffff', card2: '#fff8f1', ink: '#3a1c0d', muted: '#7e5f4d', line: '#f0dccb', brand: '#c2410c', brand2: '#965400', brandInk: '#ffffff', ok: '#17803d', err: '#c81e3a', warn: '#8f5200' },
  },
  {
    id: 'sakura', name: 'Sakura', tag: 'Synthwave: rosa e menta',
    dark: { bg: '#140a1d', glow: '#3d1042', card: '#1e1029', card2: '#281538', ink: '#fdeefb', muted: '#c3a3c9', line: '#3f2355', brand: '#ff4fa3', brand2: '#6ff2d0', brandInk: '#1a0618', ok: '#6ff2a0', err: '#ff7a8a', warn: '#ffd36b' },
    light: { bg: '#fff1f8', glow: '#ffd3ea', card: '#ffffff', card2: '#fff7fb', ink: '#3a0f33', muted: '#7d5873', line: '#f3d3e6', brand: '#b8126f', brand2: '#00695c', brandInk: '#ffffff', ok: '#0e7f38', err: '#c4123a', warn: '#8f5200' },
  },
  {
    id: 'fjord', name: 'Fjord', tag: 'Petróleo e salmão',
    dark: { bg: '#07141b', glow: '#0b3d49', card: '#0d212b', card2: '#132c38', ink: '#e8f8fb', muted: '#8fb3bd', line: '#1f4150', brand: '#2dd4bf', brand2: '#ff9e8a', brandInk: '#04201c', ok: '#5eeaa0', err: '#ff6f7d', warn: '#ffc15e' },
    light: { bg: '#eef8f8', glow: '#c9eeee', card: '#ffffff', card2: '#f3fbfb', ink: '#0b2a33', muted: '#4a6e76', line: '#d3e8ea', brand: '#0f766e', brand2: '#b23a08', brandInk: '#ffffff', ok: '#0e7f38', err: '#c4123a', warn: '#8f5200' },
  },
  {
    id: 'musgo', name: 'Musgo', tag: 'Floresta: lima e creme',
    dark: { bg: '#0a130d', glow: '#183c21', card: '#101e15', card2: '#16291d', ink: '#eef8e8', muted: '#9ab5a0', line: '#24412c', brand: '#9be15d', brand2: '#f6d88a', brandInk: '#0d1a08', ok: '#5eea8a', err: '#ff7b7b', warn: '#f6c85a' },
    light: { bg: '#f3f7ec', glow: '#d9edc3', card: '#ffffff', card2: '#f8fbf3', ink: '#17301c', muted: '#547059', line: '#dde8d0', brand: '#3a7410', brand2: '#855400', brandInk: '#ffffff', ok: '#17803d', err: '#c4123a', warn: '#855400' },
  },
  {
    id: 'cobre', name: 'Cobre', tag: 'Azul-noite e cobre',
    dark: { bg: '#090e22', glow: '#12307a', card: '#101736', card2: '#17204a', ink: '#eaf0ff', muted: '#93a3d3', line: '#28376f', brand: '#5b8cff', brand2: '#ffa65c', brandInk: '#06112e', ok: '#4be08f', err: '#ff6b86', warn: '#ffc15e' },
    light: { bg: '#f1f4ff', glow: '#d3deff', card: '#ffffff', card2: '#f6f8ff', ink: '#0f1a44', muted: '#55639a', line: '#dbe2f7', brand: '#2b55d6', brand2: '#a84a07', brandInk: '#ffffff', ok: '#0e7f38', err: '#c4123a', warn: '#8f5200' },
  },
  {
    id: 'vinil', name: 'Vinil', tag: 'Grafite e amarelo ácido',
    dark: { bg: '#0d0d0f', glow: '#2a2a0b', card: '#161619', card2: '#1f1f23', ink: '#f5f5f0', muted: '#a3a39a', line: '#303036', brand: '#e4ff3a', brand2: '#ff4d8d', brandInk: '#131300', ok: '#5eea8a', err: '#ff5a7a', warn: '#ffc83a' },
    light: { bg: '#f6f6f1', glow: '#e9f2a8', card: '#ffffff', card2: '#fafaf5', ink: '#17171a', muted: '#62625a', line: '#e4e4da', brand: '#1c1c1f', brand2: '#c01255', brandInk: '#e4ff3a', ok: '#0e7f38', err: '#c4123a', warn: '#8f5200' },
  },
  {
    id: 'partitura', name: 'Partitura', tag: 'Pergaminho: sépia e ouro',
    dark: { bg: '#12100c', glow: '#3a2e14', card: '#1c1812', card2: '#262017', ink: '#f6ecd8', muted: '#b9a98a', line: '#3b3220', brand: '#d9a441', brand2: '#8fd8cc', brandInk: '#1a1204', ok: '#8fdc8f', err: '#ff7b6b', warn: '#f2c15a' },
    light: { bg: '#f6efdf', glow: '#ead9b0', card: '#fffaf0', card2: '#fbf3e2', ink: '#2a1d0c', muted: '#6e5a3c', line: '#e6d9bc', brand: '#8a4a12', brand2: '#1b6b64', brandInk: '#ffffff', ok: '#1a6f2f', err: '#b3152e', warn: '#7d4b00' },
  },
];

export const DEFAULT_PALETTE = 'aurora';
export const getPalette = (id) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/** Variáveis CSS (nome → valor) de uma paleta num modo. As derivadas (soft, glow, glass…) saem das cores base. */
export function paletteVars(id, mode) {
  const c = getPalette(id)[mode];
  const dark = mode === 'dark';
  return {
    '--bg': c.bg, '--bg-glow': c.glow, '--card': c.card, '--card-2': c.card2, '--ink': c.ink, '--muted': c.muted, '--line': c.line,
    '--brand': c.brand, '--brand-2': c.brand2, '--brand-ink': c.brandInk,
    '--ok': c.ok, '--err': c.err, '--warn': c.warn, '--staff-ink': c.ink,
    '--brand-soft': `color-mix(in srgb, ${c.brand} ${dark ? 15 : 11}%, transparent)`,
    '--glass': `color-mix(in srgb, ${c.bg} 72%, transparent)`,
    '--glow': `0 0 0 1px color-mix(in srgb, ${c.brand} ${dark ? 40 : 28}%, transparent), 0 6px ${dark ? 28 : 22}px color-mix(in srgb, ${c.brand} ${dark ? 25 : 18}%, transparent)`,
    '--lift': dark ? '0 10px 30px #00000066' : `0 10px 26px color-mix(in srgb, ${c.ink} 14%, transparent)`,
    '--btn-edge': dark ? '#00000055' : `color-mix(in srgb, ${c.ink} 15%, transparent)`,
  };
}
