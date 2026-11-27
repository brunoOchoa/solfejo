// Helper mínimo para montar DOM sem framework.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'value') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function field(label, control) {
  return h('label', { class: 'field' }, h('span', { text: label }), control);
}

export { select } from './ui/select.js';

export function checkbox(checked, onChange) {
  return h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
}

/** Ignora atalhos de teclado quando o foco está em campos de formulário. */
export const isFormTarget = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '') || !!e.target?.closest?.('[data-select]');
