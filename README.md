# Solfejo

Web app (PWA) para praticar leitura de partitura e ritmo. Nomenclatura em **Dó fixo**, padrão brasileiro
(Dó Ré Mi Fá Sol Lá Si, semínima, colcheia, sustenido, bemol…).

## Afinar

Aba **Afinar**: violão (afinação padrão, Drop D, meio tom abaixo, DADGAD, Sol aberto), violino e teclado
(cromático). Modo **Automático** (reconhece a corda ou nota) ou **Escolher corda/nota**. O medidor mostra o
desvio em cents e diz se deve subir ou descer o som; ao ficar afinada por ~1 s a corda recebe ✓. Também toca a
nota de referência (instrumento real ou tom puro), repete a nota para afinar de ouvido e toca todas as cordas.
Lá de referência ajustável (430–450 Hz). Lógica em `src/music/tuner.js`.

## Rodar

```powershell
npm install
npm run dev      # http://localhost:5173
npm test         # testes da teoria musical e do ritmo
npm run build    # gera dist/ (PWA, funciona offline após a 1ª visita)
```

## O que tem no MVP

- **Notas**: nota na pauta → responda o nome (botões ou teclas 1–7). Clave de Sol, Fá ou ambas; linhas
  suplementares; armaduras até 5 alterações; alterações ocasionais; cifras opcionais; sessões de 10/20/50.
- **Ritmo**: compassos 2/4, 3/4, 4/4, 5/4, 6/8, 9/8 e 12/8. Você bate o ritmo (toque ou barra de espaço)
  depois de um compasso de contagem, com metrônomo.
  - **5 níveis + personalizado**: 1 Iniciante (semínimas, mínimas, pausas) · 2 Básico (+ colcheias) ·
    3 Intermediário (+ semicolcheias, pontuadas) · 4 Avançado (+ síncopes) · 5 Especialista (+ tercinas).
    Cada figura pode ser ligada ou desligada à mão (notas longas, colcheias, semicolcheias, pontuadas,
    síncopes, tercinas, pausas); o nível se ajusta sozinho. Também: quantidade de pausas, 1–4 compassos,
    andamento até 160 bpm e **rigor** da avaliação (leve / normal / exigente).
  - **Feedback em tempo real**: guias com os números dos tempos, linha de reprodução, bolinhas sob cada
    nota que acendem a cada batida (verde/laranja/vermelho, com o desvio em ms, opcional), "×" nas
    batidas sem nota, resposta no próprio botão ("Perfeito! 10 ms tarde"), som ao bater.
  - **Latência**: a tendência (mediana de adiantar/atrasar) aparece no resultado e, se você erra sempre
    para o mesmo lado, um botão compensa automaticamente (valor absoluto, modo manual).
- **Cantar** (use fones de ouvido), com dois modos e **tom** à escolha (qualquer armadura até 5
  alterações, ou sorteado) e **registro** (como escrito ou uma oitava abaixo, para voz grave):
  - *Nota única*: aparece uma nota, o app toca, você canta; o app confirma quando você sustenta a nota
    afinada (tolerância e tempo configuráveis), com barra de progresso e dica "alto/baixo".
  - *Melodia*: toca a tônica, dá a contagem e mede a afinação nota por nota (detector YIN): desvio em
    cents, nota cantada quando errada, tendência de cantar alto/baixo.
  - **Gráfico de afinação**: trilha da voz rolando no tempo sobre faixas de semitons, com as notas-alvo
    como barras. As leituras são suavizadas (`src/music/smooth.js`: mediana, rejeição de erros de oitava e
    filtro adaptativo One Euro, que acalma o tremor/vibrato e acompanha rápido as trocas de nota).
    Três níveis nas configurações: Suave (padrão), Normal e Responsiva.
  - **Nota atual em destaque** acima da pauta, com selo de estado (Ouça / Cante / Afinado) e pontinhos de
    progresso da sessão.
- **Praticar** (teclado, violino ou violão): escalas maiores e menores (natural, harmônica e melódica),
  em graus, **em terças**, **em quintas** ou arpejo da tríade, subindo, descendo ou os dois, em 1 ou 2
  oitavas e em qualquer tonalidade (até 5 alterações, ou sorteada). O microfone escuta o que você toca
  (`src/music/instrument.js`: detector de notas com confirmação e rejeição de harmônicos) e valida nota a nota:
  - *Sem tempo*: o app mostra a nota-alvo e espera; confirma quando você a toca afinada, avisa qual nota você
    tocou quando erra e conta as tentativas erradas.
  - *Com metrônomo*: toca a tônica, dá 4 tempos de contagem e você toca uma nota por pulso (semínimas ou
    colcheias, 40–140 bpm). Cada nota recebe verde (nota e tempo certos), laranja (certa, fora do tempo) ou
    vermelho, com o desvio em ms; no fim mostra a tendência (adianta/atrasa, alto/baixo) e compensa a latência.
  - Cada instrumento tem a sua extensão e faixa do detector (o violão é escrito uma oitava acima do que soa).
    Tolerância de afinação, rigor do tempo e "qualquer oitava" são configuráveis.
- **Tema**: botão no canto do cabeçalho alterna Auto (segue o sistema) → Claro → Escuro; a escolha fica salva.
- **Progresso**: acerto e tempo por nota e clave, sequência de dias, histórico de ritmo. Dados em
  `localStorage` (módulo isolado em `src/storage.js`, pronto para trocar por backend).

## Praticar (instrumento)

**Desempenho visual.** O app mede os quadros por segundo a cada troca de aba (`src/perf.js`). Em Aparência › Desempenho dá
para ver as últimas medidas e escolher Auto, Completo ou Leve. No Auto, três trocas seguidas abaixo de ~30 fps ligam o modo leve
sozinho (sem desfoque de fundo, sem partículas, troca de aba só em fade). As outras telas são carregadas em segundo plano
depois de 3 s, para a primeira visita a cada aba não baixar nem compilar na hora da troca. Para testar no celular via túnel,
use a versão de produção (`npm run build && npm run preview`): o servidor de desenvolvimento serve centenas de arquivos
soltos, e cada um passa pelo túnel.

**Calibração por eco e sinal contra ruído.** Em Áudio, *Calibrar por eco* (`src/ui/echoCalibration.js`) toca 10 sinais pela
caixa de som e mede, sem você tocar, o atraso entre tocar e ouvir (os 2 primeiros não contam); só funciona com som saindo pela
caixa. *Medir meu sinal* compara o seu volume com o ruído de fundo e diz se o ganho está bom, estourando ou baixo. O painel
também avisa quando o microfone e o navegador estão em taxas de amostragem diferentes.

**Captura de áudio (AudioWorklet).** O microfone entra num `AudioWorklet` (`src/music/captureCore.js`) que recorta blocos de 4096
amostras a cada ~30 ms e marca a hora exata de cada um no relógio do áudio; um `Worker` (`src/music/micWorker.js`) mede volume e
afinação fora da thread principal, e o `Mic` converte a hora para `performance.now()`. Uma página pesada ou uma aba em segundo plano
não atrasam mais a medida (no teste de carga: regularidade ±0,0 ms contra ±12 ms do motor clássico). Se o navegador não
suportar ou algo falhar, o app cai sozinho para o motor clássico (AnalyserNode); em Áudio dá para escolher o motor e rodar o teste de carga.

**Áudio e latência.** O medidor ao lado de "Mic" mostra o sinal (mudo, sem sinal, fraco, estourando). Clicando nele abre o painel
*Áudio e latência* (`src/ui/audioPanel.js`): escolha da entrada (vale para todas as telas), informações do aparelho, aviso de
Bluetooth/caixa de som/processamento de voz forçado, medida de ruído de fundo, dicas por sistema e um relatório de diagnóstico
para copiar. A latência calibrada fica salva **por combinação entrada + saída** (`src/music/audioProfile.js`) e o app troca de
perfil sozinho quando o aparelho muda; se a variação (jitter) medida for alta, a avaliação ganha folga extra. A calibração
(`src/ui/calibration.js`) mede o atraso entre o clique e o ataque do som, então funciona também com acordes.

**Acordes (violão e teclado).** Nesses dois instrumentos a aba pratica acordes, não notas soltas (em Ajustes dá para
voltar às notas). Exercícios: escala harmonizada (I a VII, subindo, descendo ou os dois) e progressões (I–IV–V–I,
I–V–vi–IV, ii–V–I, cânone…), em tríades ou com sétima, em qualquer tonalidade. O violão mostra o braço com as 6
cordas, casas, dedos, cordas soltas (○) e abafadas (×), em formas abertas ou com pestana; o teclado mostra as teclas
do acorde (com inversões próximas e baixo na mão esquerda, se quiser). O microfone ouve o acorde inteiro
(`src/music/chroma.js`: espectro → energia nas 12 notas → comparação com o acorde-alvo, descontando harmônicos) e as
notas do acorde acendem em verde conforme soam; notas de fora aparecem em vermelho. Guiado espera cada acorde;
Metrônomo conta 4 tempos e avalia a troca no tempo. Regras de acordes e formas do violão: `src/music/chords.js`.

As notas tocadas pelo app (Notas e Cantar) usam **piano real** por padrão, com a opção de voltar ao
sintetizador simples nas configurações ("Instrumento"; a escolha vale para todas as telas). As amostras
estão em `public/samples/piano` (17 MP3, ~1,3 MB) e o PWA as guarda para uso offline. Para somar outro
instrumento, coloque as amostras em outra pasta e registre em `src/music/audio.js`.

Créditos: Salamander Grand Piano, de Alexander Holm, licença CC-BY 3.0. Violino (`public/samples/violin`) e violão de nylon (`public/samples/guitar`): coleção tonejs-instruments, de Nicholas Brosowsky, licença CC-BY 3.0. Ao trocar o instrumento na aba Praticar, o som acompanha (dá para mudar em Ajustes › Som).

## Estrutura

```
src/music/theory.js   Dó fixo, armaduras, claves, sorteio de notas
src/music/rhythm.js   figuras, níveis, geração de compassos (ticks: 12 por semínima) e avaliação das batidas
src/music/audio.js    Web Audio (nota, metrônomo)
src/render/*          VexFlow (pauta de notas e de ritmo)
src/music/pitch.js    detector de afinação (YIN); smooth.js: suavização e nota sustentada
src/ui/pitchGraph.js  gráfico de afinação em canvas
src/views/*           telas: notas, ritmo, cantar (melodia / nota única), progresso
src/storage.js        persistência e estatísticas
```

## Próximas fases

1. Solfejo cantado com os ritmos variados do modo Ritmo (hoje a melodia cantada só usa semínimas) e leitura sem nomes.
2. Entrada por teclado MIDI (Web MIDI).
3. Intervalos e ditado melódico.
4. Repetição espaçada sobre as notas com mais erros.
5. Leitura à primeira vista (melodias completas).
6. Reduzir o bundle (VexFlow embute fontes; ~1,2 MB).

## Visual e gamificação

- **Tema "arcade clean"**: tokens em `src/theme.css` (escuro padrão, claro opcional), casca em `src/shell.css` (HUD, abas com pílula, barra inferior no celular), Progresso em `src/progress.css`.
- **XP e nível** (`src/music/xp.js`): XP vem da precisão de cada sessão; nível, meta diária (100 XP), 12 medalhas e mapa de domínio por nota. Gravados em `solfejo:stats`.
- **Efeitos** (`src/ui/fx.js`, `sfx.js`, `toast.js`): partículas, combo, sons e vibração. O botão de som no topo liga/desliga; nas abas que escutam o microfone (Cantar, Praticar, Afinar) só há vibração, para o som não ser captado como nota.
- Telas carregadas sob demanda (code-splitting por aba).
