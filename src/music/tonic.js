// Tonalidade escolhida pela TÔNICA (Sol + menor natural = Sol menor natural), e não pela armadura.
// A armadura (quantos sustenidos ou bemóis) é calculada a partir da tônica e do tipo de escala.

// classe de altura (0 = Dó … 11 = Si) da tônica → armadura (+ sustenidos, − bemóis), até 5 alterações
export const MAJOR_KEYS = {
  0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5,
};
export const MINOR_KEYS = {
  9: 0, 4: 1, 11: 2, 6: 3, 1: 4, 8: 5, 2: -1, 7: -2, 0: -3, 5: -4, 10: -5,
};
const NAMES_MAJOR = {
  0: 'Dó', 1: 'Ré♭', 2: 'Ré', 3: 'Mi♭', 4: 'Mi', 5: 'Fá', 7: 'Sol', 8: 'Lá♭', 9: 'Lá', 10: 'Si♭', 11: 'Si',
};
const NAMES_MINOR = {
  0: 'Dó', 1: 'Dó♯', 2: 'Ré', 4: 'Mi', 5: 'Fá', 6: 'Fá♯', 7: 'Sol', 8: 'Sol♯', 9: 'Lá', 10: 'Si♭', 11: 'Si',
};

export const isMinorType = (type) => type !== 'major';
const keysFor = (type) => (isMinorType(type) ? MINOR_KEYS : MAJOR_KEYS);
const namesFor = (type) => (isMinorType(type) ? NAMES_MINOR : NAMES_MAJOR);

/** Armadura da escala com essa tônica (pc) e tipo, ou null se passar de 5 alterações. */
export const keyNFor = (pc, type) => keysFor(type)[pc] ?? null;

/** Opções do seletor de tonalidade para o tipo de escala: [['0', 'Dó'], …] na ordem das notas. */
export const tonicOptions = (type) => Object.keys(keysFor(type)).map(Number).sort((a, b) => a - b)
  .map((pc) => [String(pc), namesFor(type)[pc]]);

/** Tônica válida para o tipo: a própria, ou a vizinha (meio tom acima, depois abaixo) quando a escala passaria de 5 alterações. */
export function resolveTonic(pc, type) {
  const k = keysFor(type);
  for (const d of [0, 1, -1, 2, -2]) {
    const p = (((pc + d) % 12) + 12) % 12;
    if (k[p] != null) return p;
  }
  return 0;
}

/**
 * Configurações antigas guardavam a armadura (cfg.key). Converte para a tônica (cfg.tonic) mantendo a escala que o aluno via.
 * Retorna true se mudou alguma coisa (para gravar).
 */
export function migrateTonic(cfg) {
  if (cfg.tonic !== undefined) return false;
  if (cfg.key === 'auto') { cfg.tonic = 'auto'; return true; }
  const n = Number(cfg.key) || 0;
  const table = keysFor(cfg.type);
  const pc = Object.keys(table).map(Number).find((p) => table[p] === n);
  cfg.tonic = String(pc ?? 0);
  return true;
}

/** Armadura a usar no exercício: da tônica escolhida, ou sorteada (até cfg.maxAcc alterações). */
export function pickKeyN(cfg, rand = Math.random) {
  if (cfg.tonic === 'auto') return cfg.maxAcc ? Math.floor(rand() * (2 * cfg.maxAcc + 1)) - cfg.maxAcc : 0;
  return keyNFor(resolveTonic(Number(cfg.tonic) || 0, cfg.type), cfg.type);
}
