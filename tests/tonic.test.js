import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keyNFor, tonicOptions, resolveTonic, migrateTonic, pickKeyN, MAJOR_KEYS, MINOR_KEYS,
} from '../src/music/tonic.js';
import { buildExercise, SCALE_TYPES, PATTERNS, DIRECTIONS } from '../src/music/scales.js';
import { INSTRUMENT_PROFILES } from '../src/music/instrument.js';
import { midiOf, noteName } from '../src/music/theory.js';

test('Sol + menor = Sol menor (2 bemóis); Sol + maior = Sol maior (1 sustenido)', () => {
  assert.equal(keyNFor(7, 'major'), 1);
  assert.equal(keyNFor(7, 'minor'), -2);
  assert.equal(keyNFor(7, 'harmonic'), -2);
  assert.equal(keyNFor(7, 'melodic'), -2);
  assert.equal(keyNFor(9, 'minor'), 0);
  assert.equal(keyNFor(6, 'major'), null); // Fá♯ maior passaria de 5 alterações
  assert.equal(keyNFor(3, 'minor'), null);
});

test('opções por tipo de escala', () => {
  const maj = tonicOptions('major').map((o) => o[1]);
  const min = tonicOptions('minor').map((o) => o[1]);
  assert.deepEqual(maj, ['Dó', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si']);
  assert.deepEqual(min, ['Dó', 'Dó♯', 'Ré', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Si♭', 'Si']);
});

test('tônica inválida para o tipo vira a vizinha', () => {
  assert.equal(resolveTonic(6, 'major'), 7); // Fá♯ maior → Sol maior
  assert.equal(resolveTonic(3, 'minor'), 4); // Mi♭ menor → Mi menor
  assert.equal(resolveTonic(7, 'minor'), 7);
});

test('configuração antiga (armadura) vira tônica sem mudar a escala', () => {
  const a = { key: '1', type: 'major' };
  assert.equal(migrateTonic(a), true);
  assert.equal(a.tonic, '7'); // Sol maior
  const b = { key: '1', type: 'minor' };
  migrateTonic(b);
  assert.equal(b.tonic, '4'); // Mi menor (a escala que o aluno via)
  const c = { key: 'auto', type: 'major' };
  migrateTonic(c);
  assert.equal(c.tonic, 'auto');
  const d = { tonic: '2', key: '0', type: 'major' };
  assert.equal(migrateTonic(d), false);
});

test('tonalidade sorteada respeita o máximo de alterações', () => {
  for (let i = 0; i < 50; i++) assert.ok(Math.abs(pickKeyN({ tonic: 'auto', maxAcc: 2, type: 'major' })) <= 2);
  assert.equal(pickKeyN({ tonic: 'auto', maxAcc: 0, type: 'major' }), 0);
  assert.equal(pickKeyN({ tonic: '7', type: 'minor' }), -2);
});

// ---- todas as combinações dos seletores, nos três instrumentos ------------------------------------
const STEPS = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], melodic: [0, 2, 3, 5, 7, 9, 11] };

for (const instr of ['violin', 'guitar', 'piano']) {
  test(`${instr}: toda tônica × escala × padrão × direção × oitavas obedece aos seletores e cabe no instrumento`, () => {
    const p = INSTRUMENT_PROFILES[instr];
    let n = 0;
    for (const type of Object.keys(SCALE_TYPES)) {
      for (const [pcStr] of tonicOptions(type)) {
        const pc = Number(pcStr);
        const keyN = pickKeyN({ tonic: pcStr, type });
        for (const pattern of Object.keys(PATTERNS)) {
          for (const direction of Object.keys(DIRECTIONS)) {
            for (const octaves of [1, 2]) {
              for (const octave of p.octaves) {
                const ex = buildExercise({
                  keyN, type, pattern, direction, octaves, octave, range: [p.lo, p.hi],
                });
                const tag = `${instr} ${noteName(ex.tonic)} ${type} ${pattern} ${direction} ${octaves}oit reg${octave}`;
                assert.equal(midiOf(ex.tonic) % 12, pc, `${tag}: tônica`);
                const allowed = new Set([...STEPS[type], ...(type === 'melodic' ? STEPS.minor : [])].map((s) => (pc + s) % 12));
                ex.notes.forEach((nt) => {
                  assert.ok(allowed.has(((midiOf(nt) % 12) + 12) % 12), `${tag}: ${noteName(nt)} fora da escala`);
                  assert.ok(nt.step >= p.lo && nt.step <= p.hi, `${tag}: ${noteName(nt, { octave: true })} fora do instrumento`);
                });
                if (pattern === 'scale' && direction === 'up') assert.equal(midiOf(ex.notes[0]), midiOf(ex.tonic), `${tag}: começa na tônica`);
                n++;
              }
            }
          }
        }
      }
    }
    assert.ok(n > 500);
  });
}

test('violino, registro grave: escalas com tônica dentro da extensão começam na corda solta quando possível', () => {
  const p = INSTRUMENT_PROFILES.violin;
  const first = (pc, type) => {
    const ex = buildExercise({ keyN: keyNFor(pc, type), type, octave: 3, range: [p.lo, p.hi] });
    return midiOf(ex.notes[0]);
  };
  assert.equal(first(7, 'major'), 55); // Sol maior: Sol3 (corda Sol solta)
  assert.equal(first(7, 'minor'), 55); // Sol menor natural: o mesmo Sol3
  assert.equal(first(7, 'harmonic'), 55);
  assert.equal(first(7, 'melodic'), 55);
  assert.equal(first(2, 'major'), 62); // Ré maior: Ré4 (corda Ré solta)
  assert.equal(first(2, 'minor'), 62);
  assert.equal(first(9, 'major'), 57); // Lá maior: Lá3, no registro grave (corda Sol, 3º dedo)
});

void MAJOR_KEYS; void MINOR_KEYS;
