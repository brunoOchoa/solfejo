// Mantém a tela do celular acesa durante a prática (Screen Wake Lock). Reaplica ao voltar para a aba, porque o navegador solta o bloqueio ao ocultá-la.
import { load, save } from '../storage.js';

let enabled = load('pref.awake', true) !== false;
let wanted = false;
let lock = null;

async function acquire() {
  if (!wanted || !enabled || lock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
  try {
    const l = await navigator.wakeLock.request('screen');
    if (!wanted || !enabled) { l.release().catch(() => {}); return; }
    lock = l;
    l.addEventListener('release', () => { if (lock === l) lock = null; });
  } catch { /* sem permissão ou sem suporte: segue com o comportamento normal do aparelho */ }
}

function release() {
  const l = lock;
  lock = null;
  l?.release().catch(() => {});
}

/** Liga ou desliga o pedido (a aba atual precisa da tela acesa). Respeita a preferência do usuário. */
export function keepAwake(on) {
  wanted = !!on;
  if (wanted) acquire();
  else release();
}

export const awakeSupported = () => !!navigator.wakeLock;
export const awakeEnabled = () => enabled;
export function setAwakeEnabled(v) {
  enabled = !!v;
  save('pref.awake', enabled);
  if (enabled) acquire();
  else release();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
