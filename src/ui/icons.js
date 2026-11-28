// Ícones próprios (traço de 1,8 px, 24×24). Devolvem texto SVG; a cor vem de currentColor.
const P = {
  notas: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  ritmo: '<path d="M8.5 21h7l2-16h-11z"/><path d="M12 15.5 16 6"/><circle cx="12" cy="15.5" r=".6"/>',
  cantar: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/>',
  praticar: '<rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="M9 5v14M15 5v14"/><path d="M7 5v7h4V5M13 5v7h4V5" fill="currentColor" stroke="none" opacity=".85"/>',
  afinar: '<path d="M4 17a8 8 0 0 1 16 0"/><path d="m12 17 4-6"/><circle cx="12" cy="17" r="1.2"/><path d="M7 9.5 8 11M17 9.5 16 11M12 6.5V8"/>',
  progresso: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  paleta: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.5-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10" cy="7.2" r="1.1" fill="currentColor"/><circle cx="14.5" cy="7.2" r="1.1" fill="currentColor"/>',
  ajustes: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  foco: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  lua: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.7 6.7 0 0 0 20 14.5z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" opacity=".85"/>',
  somOn: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  somOff: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  chama: '<path d="M12 3c.5 3.2 4.5 5 4.5 10a4.5 4.5 0 0 1-9 0c0-2 1-3 2-4 .2 1.2.8 2 1.5 2.3C10.5 8.5 11 5.5 12 3z"/>',
  raio: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
};

/** icon('notas') → '<svg …>…</svg>' */
export function icon(name, size = '1em') {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
