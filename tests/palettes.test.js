import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, paletteVars } from '../src/palettes.js';

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

for (const p of PALETTES) {
  for (const mode of ['dark', 'light']) {
    test(`${p.id}/${mode}: contraste legível`, () => {
      const c = p[mode];
      const need = (fg, bg, min, what) => assert.ok(ratio(fg, bg) >= min, `${what} ${fg} sobre ${bg} = ${ratio(fg, bg).toFixed(2)} (mín ${min})`);
      need(c.ink, c.bg, 7, 'texto/fundo');
      need(c.ink, c.card, 7, 'texto/card');
      need(c.muted, c.card, 4.5, 'texto secundário/card');
      need(c.muted, c.bg, 4.5, 'texto secundário/fundo');
      need(c.brandInk, c.brand, 4.5, 'texto sobre a cor principal');
      need(c.brand2, c.card, 4.5, 'destaque/card');
      need(c.brand, c.card, 3, 'cor principal/card (componente)');
      for (const k of ['ok', 'err', 'warn']) need(c[k], c.card, 4.5, k);
    });
  }
}

test('paletas: ids únicos e variáveis completas', () => {
  assert.equal(new Set(PALETTES.map((p) => p.id)).size, PALETTES.length);
  for (const p of PALETTES) assert.ok(Object.keys(paletteVars(p.id, 'dark')).length >= 17);
});
