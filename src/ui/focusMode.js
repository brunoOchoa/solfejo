// Modo foco: esconde cabeçalho, navegação e controles secundários, deixando só o essencial na tela (com tela cheia quando o aparelho permite).
import { h } from '../dom.js';

/**
 * Cria o botão "Foco" e o botão de sair. Quem usa decide, via CSS (body.focus-mode), o que some.
 * onChange(on) é chamado quando entra ou sai (para o gráfico recalcular o tamanho).
 */
export function createFocusMode({ onChange } = {}) {
  let on = false;
  let askedFullscreen = false;

  const btn = h('button', { class: 'btn focus-btn', type: 'button', 'aria-pressed': 'false', title: 'Foco: mostra só o essencial e usa a tela inteira' }, '⛶ Foco');
  const exit = h('button', { class: 'btn focus-exit', type: 'button', 'aria-label': 'Sair do modo foco', title: 'Sair do modo foco', hidden: true }, h('span', { text: '✕' }), h('span', { class: 'lbl', text: ' Sair do foco' }));

  async function enter() {
    on = true;
    document.body.classList.add('focus-mode');
    btn.setAttribute('aria-pressed', 'true');
    exit.hidden = false;
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        askedFullscreen = true;
      }
    } catch { /* iOS e alguns navegadores não têm tela cheia: o modo foco vale mesmo assim */ }
    onChange?.(true);
    window.dispatchEvent(new Event('resize'));
  }

  function leave() {
    if (!on) return;
    on = false;
    document.body.classList.remove('focus-mode');
    btn.setAttribute('aria-pressed', 'false');
    exit.hidden = true;
    if (askedFullscreen && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    askedFullscreen = false;
    onChange?.(false);
    window.dispatchEvent(new Event('resize'));
  }

  btn.addEventListener('click', () => (on ? leave() : enter()));
  exit.addEventListener('click', leave);
  // sair da tela cheia pelo sistema (gesto de voltar, Esc) também sai do foco
  const onFs = () => { if (on && askedFullscreen && !document.fullscreenElement) leave(); };
  document.addEventListener('fullscreenchange', onFs);

  return {
    btn,
    exit,
    isOn: () => on,
    destroy() { document.removeEventListener('fullscreenchange', onFs); leave(); },
  };
}
