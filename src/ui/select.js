// Select próprio (lista suspensa arredondada e animada) no lugar do <select> nativo, que não aceita estilo na lista.
// Mesma assinatura do antigo: select(opções [[valor, texto]…], valorAtual, onChange(valorTexto)). O elemento tem `.value` (leitura e escrita).
const CHEVRON = '<svg class="sel-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK = '<svg class="sel-ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

let uid = 0;
let openClose = null; // fecha a lista que estiver aberta (só uma por vez)

export function select(options, current, onChange) {
  const id = `sel${++uid}`;
  const opts = options.map(([v, t]) => ({ v: String(v), t: String(t) }));
  let value = String(current);
  if (!opts.some((o) => o.v === value) && opts.length) value = opts[0].v;
  let active = -1;
  let pop = null;
  let typed = '';
  let typedTimer = 0;

  const label = document.createElement('span');
  label.className = 'sel-txt';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sel-btn';
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', `${id}-list`);
  btn.append(label);
  btn.insertAdjacentHTML('beforeend', CHEVRON);
  const root = document.createElement('div');
  root.className = 'sel';
  root.dataset.select = '';
  root.append(btn);

  const textOf = (v) => opts.find((o) => o.v === v)?.t ?? '';
  const paint = () => { label.textContent = textOf(value); };
  paint();
  Object.defineProperty(root, 'value', {
    get: () => value,
    set: (v) => { value = String(v); paint(); },
  });

  function place() {
    const r = btn.getBoundingClientRect();
    const maxW = Math.min(400, innerWidth - 16);
    // largura: a do gatilho no mínimo, e cresce até caber o texto mais longo (sem quebrar linhas feias)
    pop.style.minWidth = `${Math.min(r.width, maxW)}px`;
    pop.style.maxWidth = `${maxW}px`;
    pop.style.width = 'max-content';
    const w = pop.offsetWidth;
    const maxH = Math.min(320, opts.length * 42 + 14);
    const below = innerHeight - r.bottom - 10;
    const above = r.top - 10;
    const up = below < Math.min(maxH, 180) && above > below;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
    pop.style.maxHeight = `${Math.max(120, Math.min(maxH, up ? above : below))}px`;
    if (up) { pop.style.bottom = `${innerHeight - r.top + 6}px`; pop.style.top = 'auto'; pop.dataset.up = ''; }
    else { pop.style.top = `${r.bottom + 6}px`; pop.style.bottom = 'auto'; delete pop.dataset.up; }
  }

  function setActive(i, scroll = true) {
    active = Math.max(0, Math.min(opts.length - 1, i));
    [...pop.children].forEach((li, k) => li.classList.toggle('act', k === active));
    btn.setAttribute('aria-activedescendant', `${id}-o${active}`);
    if (scroll) pop.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function close(refocus = false) {
    if (!pop) return;
    const p = pop;
    pop = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    root.classList.remove('open');
    p.classList.add('out');
    setTimeout(() => p.remove(), 140);
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onWin);
    window.removeEventListener('scroll', onWin, true);
    if (openClose === close) openClose = null;
    if (refocus) btn.focus({ preventScroll: true });
  }
  const onOutside = (e) => { if (!root.contains(e.target) && !pop?.contains(e.target)) close(); };
  const onWin = (e) => { if (!pop?.contains(e?.target)) close(); };

  function choose(i) {
    const o = opts[i];
    if (!o) return;
    const changed = o.v !== value;
    value = o.v;
    paint();
    close(true);
    if (changed) onChange?.(value);
  }

  function open() {
    if (pop) return;
    openClose?.();
    pop = document.createElement('ul');
    pop.className = 'sel-pop';
    pop.id = `${id}-list`;
    pop.setAttribute('role', 'listbox');
    opts.forEach((o, i) => {
      const li = document.createElement('li');
      li.id = `${id}-o${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(o.v === value));
      li.className = 'sel-opt';
      li.style.setProperty('--i', String(Math.min(i, 8)));
      const t = document.createElement('span');
      t.textContent = o.t;
      li.append(t);
      li.insertAdjacentHTML('beforeend', CHECK);
      li.addEventListener('pointermove', () => setActive(i, false));
      li.addEventListener('click', () => choose(i));
      pop.append(li);
    });
    document.body.append(pop);
    place();
    btn.setAttribute('aria-expanded', 'true');
    root.classList.add('open');
    setActive(Math.max(0, opts.findIndex((o) => o.v === value)));
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    openClose = close;
  }

  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!pop) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (k === 'Home') { e.preventDefault(); setActive(0); }
    else if (k === 'End') { e.preventDefault(); setActive(opts.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
    else if (k === 'Tab') close();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { // digitar a inicial salta para a opção
      clearTimeout(typedTimer);
      typed += k.toLowerCase();
      typedTimer = setTimeout(() => { typed = ''; }, 600);
      const i = opts.findIndex((o) => o.t.toLowerCase().startsWith(typed));
      if (i >= 0) setActive(i);
    }
  });

  return root;
}
