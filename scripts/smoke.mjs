// Verificação da versão de PRODUÇÃO (dist/): sobe o servidor de prévia, abre cada aba num Chrome de verdade e falha se algo quebrar.
// Existe porque o servidor de desenvolvimento esconde erros que só aparecem no build (módulos agrupados em arquivos compartilhados).
// Uso: npm run build && npm run smoke
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const PORT = 4173;
const BASE = `http://localhost:${PORT}/`;
const ROUTES = ['notas', 'ritmo', 'cantar', 'instrumento', 'afinador', 'progresso'];
const falhas = [];
const falha = (msg) => { falhas.push(msg); console.log(`  ✗ ${msg}`); };

async function esperaServidor() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('o servidor de prévia não subiu');
}

const vite = spawn(process.execPath, [VITE, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  await esperaServidor();
  browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });

  // 1) cada aba, numa carga nova (pega erro de módulo e de arquivo que não carrega)
  for (const r of ROUTES) {
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(`erro na página: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') erros.push(`console: ${m.text()}`); });
    page.on('requestfailed', (q) => erros.push(`falhou: ${q.url()}`));
    page.on('response', (q) => { if (q.status() >= 400) erros.push(`HTTP ${q.status()}: ${q.url()}`); });
    await page.goto(`${BASE}#/${r}`);
    try {
      await page.waitForFunction(() => { const v = document.getElementById('view'); return v && v.children.length > 0; }, null, { timeout: 15000 });
    } catch { erros.push('a tela não apareceu'); }
    const texto = await page.evaluate(() => document.getElementById('view')?.textContent ?? '');
    if (texto.includes('Não foi possível carregar')) erros.push('"Não foi possível carregar esta tela"');
    await page.waitForTimeout(600);
    console.log(erros.length ? `✗ ${r}` : `✓ ${r}`);
    erros.forEach((e) => falha(`${r}: ${e}`));
    await page.close();
  }

  // 2) navegar entre as abas pelo menu (monta e desmonta cada tela, como o aluno faz)
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(`erro na página: ${e.message}`));
  await page.goto(`${BASE}#/notas`);
  await page.waitForSelector('#nav a');
  for (const r of [...ROUTES, ...ROUTES.slice().reverse()]) {
    await page.click(`#nav a[data-route="${r}"]`);
    try {
      await page.waitForFunction((n) => document.querySelector(`#nav a[data-route="${n}"]`)?.classList.contains('active')
        && !document.getElementById('view').textContent.includes('Não foi possível'), r, { timeout: 8000 });
      await page.waitForFunction(() => document.getElementById('view').children.length > 0, null, { timeout: 8000 });
    } catch { erros.push(`${r}: a tela não apareceu depois do clique no menu`); }
  }
  console.log(erros.length ? '✗ navegação pelo menu' : '✓ navegação pelo menu');
  erros.forEach((e) => falha(e));

  // 3) microfone na aba Praticar: o motor de captura (AudioWorklet ou reserva) precisa entregar quadros
  await page.click('#nav a[data-route="instrumento"]');
  await page.waitForSelector('.inst-bar');
  await page.evaluate(() => { localStorage.setItem('solfejo:cfg.instrument', JSON.stringify({ instr: 'violin', content: 'notes' })); });
  await page.reload();
  await page.waitForSelector('.inst-bar');
  await page.click('.inst-bar >> text=Ligar mic');
  await page.waitForSelector('.inst-bar >> text=Mic ligado', { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.click('.mic-meter');
  await page.waitForSelector('.ap-stats');
  await page.waitForFunction(() => /AudioWorklet|Clássico/.test(document.querySelector('.ap-stats')?.textContent ?? ''), null, { timeout: 8000 });
  const estat = await page.textContent('.ap-stats');
  console.log(`✓ microfone: ${estat}`);
  if (!/AudioWorklet/.test(estat)) console.log('  (aviso: caiu para o motor clássico)');

  // 4) músicas (violino): a pauta inteira aparece, o braço mostra as notas do trecho e "Ouvir" percorre os compassos
  await page.keyboard.press('Escape'); // fecha o painel de áudio
  await page.waitForSelector('.modal-scrim', { state: 'detached', timeout: 5000 });
  await page.click('[aria-label="Área"] >> text=Músicas');
  await page.waitForSelector('.song-staff .vf-stavenote', { timeout: 10000 });
  const nNotas = await page.locator('.song-staff .vf-stavenote').count();
  const nBraco = await page.locator('.fb-scale').count();
  if (nNotas < 40) falha(`músicas: a pauta tem só ${nNotas} notas`);
  if (nBraco < 3) falha(`músicas: o braço mostra só ${nBraco} notas`);
  await page.click('[aria-label="Modo"] >> text=Ouvir');
  await page.click('.btn.primary >> text=Ouvir a música');
  await page.waitForSelector('.tb-sub >> text=compasso 2', { timeout: 8000 });
  console.log(nNotas >= 40 && nBraco >= 3 ? `✓ músicas: ${nNotas} notas na pauta, ${nBraco} no braço, ouvir percorre os compassos` : '✗ músicas');
} catch (e) {
  falha(`verificação interrompida: ${e.message.split('\n')[0]}`);
} finally {
  await browser?.close();
  vite.kill();
}

if (falhas.length) {
  console.log(`\n${falhas.length} problema(s) na versão de produção:`);
  falhas.forEach((f) => console.log(` - ${f}`));
  process.exit(1);
}
console.log('\nTudo certo na versão de produção.');
