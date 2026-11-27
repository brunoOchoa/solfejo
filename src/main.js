import '@fontsource/sora/latin-400.css';
import '@fontsource/sora/latin-600.css';
import '@fontsource/sora/latin-700.css';
import '@fontsource/sora/latin-800.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './theme.css';
import './style.css';
import './instrument.css';
import './tuner.css';
import './slider.css';
import './shell.css';
import './progress.css';
import './select.css';
import './themepicker.css';
import './chords.css';
import './audio.css';
import { setAudioTab } from './music/audio.js';
import { getStats, streakDays } from './storage.js';
import { getCombo, resetCombo } from './ui/fx.js';
import { toast, levelUp } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { sfx, fxEnabled, setFxEnabled, setSfxRoute } from './ui/sfx.js';
import { keepAwake } from './ui/wake.js';
import { levelInfo, BADGES, DAILY_GOAL } from './music/xp.js';
import { initTheme, getTheme, THEME_LABEL, getPaletteId, PALETTES } from './theme.js';
import { toggleThemePicker } from './ui/themePicker.js';
import { initPerf, isLite, sampleFrames } from './perf.js';

// cada tela é carregada sob demanda (o VexFlow e o resto só vêm quando a aba é aberta)
const ROUTES = {
  notas: { label: 'Notas', icon: 'notas', load: () => import('./views/notes.js').then((m) => m.mountNotes) },
  ritmo: { label: 'Ritmo', icon: 'ritmo', load: () => import('./views/rhythm.js').then((m) => m.mountRhythm) },
  cantar: { label: 'Cantar', icon: 'cantar', load: () => import('./views/sing.js').then((m) => m.mountSing) },
  instrumento: { label: 'Praticar', icon: 'praticar', load: () => import('./views/instrument.js').then((m) => m.mountInstrument) },
  afinador: { label: 'Afinar', icon: 'afinar', load: () => import('./views/tuner.js').then((m) => m.mountTuner) },
  progresso: { label: 'Progresso', icon: 'progresso', load: () => import('./views/progress.js').then((m) => m.mountProgress) },
};

const nav = document.getElementById('nav');
const view = document.getElementById('view');
const ORDER = Object.keys(ROUTES);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let unmount = null;
let token = 0;
let current = null;

// anima só os filhos que ficam no fluxo: a gaveta e outros elementos fixos não podem herdar transform (viram posicionados pela tela errada)
const FIXED = '.drawer, .scrim, .focus-exit';
function collect(el, out) {
  if (getComputedStyle(el).position === 'fixed') return out;
  if (el.querySelector(FIXED)) [...el.children].forEach((c) => collect(c, out)); // não anima quem guarda a gaveta: o transform a prenderia dentro dele
  else out.push(el);
  return out;
}
const movers = () => [...view.children].reduce((acc, el) => collect(el, acc), []);
const play = (frames, opts) => movers().map((el) => el.animate(frames, opts));

// troca de aba: a tela atual sai deslizando para o lado da aba, a nova entra do lado oposto (mesma mola da pílula do menu)
async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const name = raw in ROUTES ? raw : 'notas';
  const mine = ++token;
  const dir = current ? Math.sign(ORDER.indexOf(name) - ORDER.indexOf(current)) : 0;
  const animate = !reducedMotion();
  const hadView = view.children.length > 0;
  current = name;
  nav.querySelectorAll('a').forEach((a) => {
    const active = a.dataset.route === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  movePill();
  const loading = ROUTES[name].load().catch(() => null); // baixa a tela nova enquanto a antiga sai
  let outs = [];
  if (animate && hadView && dir) {
    view.style.overflowX = 'clip';
    outs = isLite()
      ? play([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'linear', fill: 'forwards' })
      : play([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 26}px)` }],
        { duration: 140, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    await Promise.all(outs.map((a) => a.finished)).catch(() => {});
    if (mine !== token) { outs.forEach((a) => a.cancel()); view.style.overflowX = ''; return; }
  }
  resetCombo();
  if (unmount) { unmount(); unmount = null; }
  setAudioTab(name); // volumes de instrumento e metrônomo são por aba
  setSfxRoute(name);
  keepAwake(name !== 'progresso'); // telas de prática mantêm o celular acordado
  view.replaceChildren();
  paintHud();
  const mount = await loading;
  if (mine !== token) { view.style.overflowX = ''; return; } // o usuário já trocou de aba enquanto carregava
  if (!mount) {
    view.textContent = 'Não foi possível carregar esta tela. Verifique a conexão e tente de novo.';
    view.style.overflowX = '';
    return;
  }
  unmount = mount(view);
  if (animate) {
    view.style.overflowX = 'clip';
    const ins = isLite()
      ? play([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })
      : play([{ opacity: 0, transform: dir ? `translateX(${dir * 30}px)` : 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: 420, easing: 'cubic-bezier(.34, 1.4, .64, 1)' });
    sampleFrames(480, name); // mede a fluidez da troca (alimenta o modo automático)
    Promise.all(ins.map((a) => a.finished)).catch(() => {}).finally(() => { if (mine === token) view.style.overflowX = ''; });
  } else view.style.overflowX = '';
}

const pill = document.createElement('span');
pill.className = 'nav-pill';
pill.setAttribute('aria-hidden', 'true');
function movePill() {
  const a = nav.querySelector('a.active');
  if (!a || !a.offsetWidth) return;
  pill.style.width = `${a.offsetWidth}px`;
  pill.style.transform = `translateX(${a.offsetLeft}px)`;
}
window.addEventListener('resize', movePill);

const hud = document.getElementById('hud');
function paintHud() {
  const st = getStats();
  const days = streakDays(st.sessions);
  const lv = levelInfo(st.xp);
  const lvChip = document.createElement('a');
  lvChip.className = 'hud-chip level';
  lvChip.href = '#/progresso';
  lvChip.title = `Nível ${lv.level} · ${lv.title} · ${lv.into}/${lv.span} XP`;
  lvChip.innerHTML = `<b>Nv ${lv.level}</b><span class="xpbar"><i style="width:${Math.round(lv.pct * 100)}%"></i></span>`;
  const chip = document.createElement('span');
  chip.className = `hud-chip streak${days > 0 ? ' on' : ''}`;
  chip.title = days > 0 ? `${days} dia(s) seguidos praticando` : 'Pratique hoje para começar uma sequência';
  chip.innerHTML = `<span class="hi">${icon('chama', '1.05em')}</span><span>${days}</span>`;
  hud.replaceChildren(comboChip, lvChip, chip, fxBtn, themeBtn);
  paintCombo();
}

const comboChip = document.createElement('span');
comboChip.className = 'hud-chip combo';
function paintCombo() {
  const c = getCombo();
  comboChip.hidden = c < 2;
  if (c >= 2) comboChip.innerHTML = `<span class="hi">${icon('raio', '1.05em')}</span><span>×${c}</span>`;
}
window.addEventListener('combochange', () => {
  paintCombo();
  comboChip.style.animation = 'none'; void comboChip.offsetWidth; comboChip.style.animation = '';
});

for (const [name, r] of Object.entries(ROUTES)) {
  const a = document.createElement('a');
  a.href = `#/${name}`;
  a.dataset.route = name;
  a.innerHTML = `<span class="ni" aria-hidden="true">${icon(r.icon, '1em')}</span><span>${r.label}</span>`;
  nav.append(a);
}
nav.prepend(pill);

// botões do HUD: efeitos (som + vibração) e tema
const THEME_ICON_NAME = { auto: 'auto', light: 'sol', dark: 'lua' };
const themeBtn = document.createElement('button');
themeBtn.className = 'theme-btn';
themeBtn.type = 'button';
function paintThemeBtn() {
  const m = getTheme();
  const pal = PALETTES.find((p) => p.id === getPaletteId())?.name ?? '';
  themeBtn.innerHTML = icon('paleta', '1.1rem');
  themeBtn.title = `Aparência: ${pal} · ${THEME_LABEL[m]}`;
  themeBtn.setAttribute('aria-label', `Aparência: paleta ${pal}, modo ${THEME_LABEL[m]}. Abrir opções.`);
  themeBtn.setAttribute('aria-haspopup', 'dialog');
}
themeBtn.addEventListener('click', () => toggleThemePicker(themeBtn));
window.addEventListener('themechange', paintThemeBtn);

const fxBtn = document.createElement('button');
fxBtn.className = 'theme-btn';
fxBtn.type = 'button';
function paintFxBtn() {
  const on = fxEnabled();
  fxBtn.innerHTML = icon(on ? 'somOn' : 'somOff', '1.1rem');
  fxBtn.title = `Sons e vibração: ${on ? 'ligados' : 'desligados'}`;
  fxBtn.setAttribute('aria-pressed', String(on));
  fxBtn.setAttribute('aria-label', `Sons e vibração de interface: ${on ? 'ligados' : 'desligados'}. Clique para alternar.`);
}
fxBtn.addEventListener('click', () => { setFxEnabled(!fxEnabled()); paintFxBtn(); sfx('ok'); });
initPerf();
initTheme();
paintThemeBtn();
paintFxBtn();

window.addEventListener('hashchange', route);
route();
// aquece as outras telas quando o navegador está ocioso: a primeira visita a cada aba deixa de baixar e compilar na hora da troca
const warm = () => {
  if (navigator.connection?.saveData) return;
  Object.values(ROUTES).forEach((r, i) => setTimeout(() => r.load().catch(() => {}), i * 500));
};
setTimeout(() => (window.requestIdleCallback ? window.requestIdleCallback(warm, { timeout: 5000 }) : warm()), 3000);
window.addEventListener('perflite', () => toast({ icon: '🍃', title: 'Modo leve ativado', text: 'Este aparelho está com poucos quadros por segundo: simplifiquei as animações. Dá para mudar em Aparência › Desempenho.', ms: 5200 }));
document.fonts?.ready.then(movePill);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

// XP, medalhas e nível novo depois de cada sessão
window.addEventListener('xpgain', (e) => {
  const d = e.detail;
  paintHud();
  if (d.gain > 0) toast({ icon: '✨', title: `+${d.gain} XP`, text: `Nível ${d.level} · ${d.title}`, kind: 'xp', ms: 2600 });
  if (d.goalReached) toast({ icon: '🎯', title: 'Meta do dia concluída', text: `${DAILY_GOAL} XP hoje`, kind: 'goal' });
  d.newBadges.forEach((id) => {
    const b = BADGES.find((x) => x.id === id);
    if (b) toast({ icon: b.icon, title: `Medalha: ${b.name}`, text: b.desc, kind: 'badge', ms: 4200 });
  });
  if (d.newBadges.length) sfx('badge');
  if (d.leveledUp) setTimeout(() => { levelUp(d); sfx('level'); }, 900);
});
