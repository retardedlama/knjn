import { Chessground } from '../vendor/chessground/chessground.min.js';
import { Chess } from '../vendor/chessjs/chess.js';
import { Book, POPULAR, epdOf } from './book.js';
import { Engine, evalToPercent, formatEval } from './engine.js';
import { explainMove, categoryOf, PRINCIPLES } from './explain.js';
import { guideFor } from './guides.js';
import { progress, MASTERY_LABELS } from './progress.js';
import { sound } from './sound.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const MODES = ['learn', 'practice', 'explore', 'play', 'quiz'];

const LEVELS = [
  { skill: 0, depth: 1, movetime: 60, label: 'Beginner' },
  { skill: 2, depth: 2, movetime: 120, label: 'Novice' },
  { skill: 5, depth: 4, movetime: 200, label: 'Casual' },
  { skill: 8, depth: 6, movetime: 300, label: 'Club' },
  { skill: 11, depth: 8, movetime: 450, label: 'Strong club' },
  { skill: 14, depth: 10, movetime: 700, label: 'Expert' },
  { skill: 17, depth: 13, movetime: 1000, label: 'Master' },
  { skill: 20, depth: 18, movetime: 1500, label: 'Full strength' },
];

const S = {
  book: null,
  mode: 'learn',
  opening: null,
  bookSans: [],
  moves: [],
  ply: 0,
  orientation: 'white',
  engineOn: progress.setting('engineOn', true),
  lines: [],
  linesFen: null,
  evalFen: null,
  engineState: 'idle',
  cache: new Map(),
  practice: null,
  play: null,
  playSetup: { color: 'white', level: progress.setting('level', 4) },
  quiz: null,
  quizDifficulty: progress.setting('quizDifficulty', 'popular'),
  auto: null,
  glyph: null,
  sideTab: 'popular',
  family: null,
  query: '',
  showAllVars: false,
  settings: {
    theme: progress.setting('theme', 'dark'),
    board: progress.setting('board', 'brown'),
    sound: progress.setting('sound', 'on'),
    depth: progress.setting('depth', '18'),
    multipv: progress.setting('multipv', '3'),
    engineArrows: progress.setting('engineArrows', 'on'),
    bookArrows: progress.setting('bookArrows', 'on'),
  },
};

const analysis = new Engine('Stockfish 19');
let player = null;

// ---------------------------------------------------------------- helpers

const fenAt = ply => (ply <= 0 ? START_FEN : S.moves[ply - 1].after);
const allFens = () => [START_FEN, ...S.moves.map(m => m.after)];
const turnAt = ply => (ply % 2 === 0 ? 'white' : 'black');
const uciOf = m => m.from + m.to + (m.promotion || '');
const sideFor = o => (o.plies % 2 === 1 ? 'white' : 'black');

function buildMoves(sans, fen = START_FEN) {
  const c = new Chess(fen);
  const out = [];
  for (const san of sans) {
    try {
      out.push(c.move(san));
    } catch (e) {
      break;
    }
  }
  return out;
}

function moveFromUci(fen, uci) {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch (e) {
    return null;
  }
}

function moveLabel(ply, san) {
  const n = Math.floor((ply - 1) / 2) + 1;
  return ply % 2 === 1 ? `${n}.${san}` : `${n}…${san}`;
}

function formatSans(sans, startPly = 0, max = 99) {
  const out = [];
  sans.slice(0, max).forEach((san, i) => {
    const ply = startPly + i;
    if (ply % 2 === 0) out.push(`${ply / 2 + 1}.${san}`);
    else if (i === 0) out.push(`${Math.floor(ply / 2) + 1}…${san}`);
    else out.push(san);
  });
  if (sans.length > max) out.push('…');
  return out.join(' ');
}

function pvToSan(fen, pv, max = 10) {
  const c = new Chess(fen);
  const sans = [];
  for (const u of pv.slice(0, max)) {
    try {
      sans.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch (e) {
      break;
    }
  }
  return sans;
}

function nameHtml(o) {
  return o.variation ? `${esc(o.family)}: <em>${esc(o.variation)}</em>` : esc(o.family);
}

function devIndex() {
  if (!S.opening) return 0;
  let i = 0;
  while (i < S.moves.length && i < S.bookSans.length && S.moves[i].san === S.bookSans[i]) i++;
  return i;
}

const onBookPath = () => !!S.opening && S.ply <= devIndex();

function scoreFor(line, color) {
  if (!line) return 0;
  const v = line.mate !== null && line.mate !== undefined ? (line.mate > 0 ? 100 : -100) : line.cp / 100;
  return color === 'w' ? v : -v;
}

const fmtPawns = v => (v >= 50 ? 'winning' : v <= -50 ? 'losing' : (v > 0 ? '+' : '') + v.toFixed(1));

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- board

const cg = Chessground($('board'), {
  fen: START_FEN,
  orientation: 'white',
  coordinates: true,
  animation: { enabled: true, duration: 220 },
  highlight: { lastMove: true, check: true },
  movable: { free: false, color: 'white', showDests: true, events: { after: onBoardMove } },
  draggable: { enabled: true, showGhost: true },
  premovable: { enabled: false },
  drawable: { enabled: true, visible: true, eraseOnClick: true },
});

function canMove(chess) {
  if (chess.isGameOver()) return false;
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  switch (S.mode) {
    case 'practice': {
      const P = S.practice;
      return !!P && !P.done && !P.waiting && S.ply === S.moves.length && turn === P.color;
    }
    case 'play': {
      const G = S.play;
      if (!G) return true;
      return !G.over && !G.thinking && S.ply === S.moves.length && turn === G.color;
    }
    case 'quiz':
      return false;
    default:
      return true;
  }
}

function syncBoard() {
  const fen = fenAt(S.ply);
  const chess = new Chess(fen);
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  const last = S.moves[S.ply - 1];
  const movable = canMove(chess);
  const dests = new Map();
  if (movable)
    for (const m of chess.moves({ verbose: true })) {
      if (!dests.has(m.from)) dests.set(m.from, []);
      dests.get(m.from).push(m.to);
    }
  cg.set({
    fen,
    orientation: S.orientation,
    turnColor: turn,
    lastMove: last ? [last.from, last.to] : undefined,
    check: chess.inCheck() ? turn : false,
    movable: { color: movable ? turn : undefined, dests },
  });
  $('evalBar').classList.toggle('flipped', S.orientation === 'black');
}

function onBoardMove(orig, dest) {
  sound.unlock();
  const fen = fenAt(S.ply);
  const chess = new Chess(fen);
  const piece = chess.get(orig);
  if (piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
    askPromotion(piece.color === 'w' ? 'white' : 'black').then(p => {
      if (p) userMove(orig, dest, p);
      else syncBoard();
    });
    return;
  }
  userMove(orig, dest);
}

function userMove(from, to, promotion) {
  let m;
  try {
    m = new Chess(fenAt(S.ply)).move({ from, to, promotion });
  } catch (e) {
    syncBoard();
    return;
  }
  stopAuto();
  if (S.mode === 'practice') return practiceMove(m);
  if (S.mode === 'play' && S.play) return gameMove(m);
  freeMove(m);
}

// Learn / explore / play-setup: follow the existing line if the move matches,
// otherwise branch off from here.
function freeMove(m) {
  const next = S.moves[S.ply];
  if (next && next.san === m.san) {
    goTo(S.ply + 1);
    return;
  }
  S.moves = S.moves.slice(0, S.ply).concat(m);
  goTo(S.ply + 1);
}

function askPromotion(color) {
  return new Promise(resolve => {
    const el = $('promo');
    el.innerHTML = `<div class="promo-box">${['q', 'r', 'b', 'n']
      .map(p => `<button data-p="${p}" aria-label="${ROLE[p]}"><span class="cg-wrap pc"><piece class="${ROLE[p]} ${color}"></piece></span></button>`)
      .join('')}</div>`;
    el.classList.remove('hidden');
    el.onclick = e => {
      const b = e.target.closest('button');
      el.classList.add('hidden');
      resolve(b ? b.dataset.p : null);
    };
  });
}

function playMoveSound(m) {
  if (!m) return;
  if (m.san.includes('+') || m.san.includes('#')) sound.check();
  else if (m.captured) sound.capture();
  else sound.move();
}

function goTo(ply, { silent = false } = {}) {
  ply = Math.max(0, Math.min(S.moves.length, ply));
  const forward = ply === S.ply + 1;
  S.ply = ply;
  S.glyph = null;
  if (forward && !silent) playMoveSound(S.moves[ply - 1]);
  render();
}

function navAllowed() {
  if (S.mode === 'practice') return !!S.practice && S.practice.done;
  if (S.mode === 'quiz') return !!S.quiz && !!S.quiz.answered;
  return true;
}

function nav(delta) {
  if (!navAllowed()) return;
  stopAuto();
  if (delta === 'first') goTo(0);
  else if (delta === 'last') goTo(S.moves.length);
  else goTo(S.ply + delta);
}

function flip() {
  S.orientation = S.orientation === 'white' ? 'black' : 'white';
  syncBoard();
  drawShapes();
  renderEvalBar();
}

const GLYPH = good =>
  `<g transform="translate(71 -12) scale(0.4)"><circle cx="50" cy="50" r="48" fill="${good ? '#629924' : '#cc3333'}" stroke="#fff" stroke-width="6"/>` +
  `<path d="${good ? 'M28 52l15 15 30-32' : 'M33 33l34 34M67 33L33 67'}" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;

function drawShapes() {
  const shapes = [];
  const fen = fenAt(S.ply);
  if (engineActive() && S.settings.engineArrows === 'on' && S.linesFen === fen) {
    S.lines.slice(0, Number(S.settings.multipv)).forEach((l, i) => {
      const u = l.pv[0];
      if (u) shapes.push({ orig: u.slice(0, 2), dest: u.slice(2, 4), brush: i === 0 ? 'paleBlue' : 'paleGrey', modifiers: i ? { lineWidth: 7 } : undefined });
    });
  }
  if (S.mode === 'learn' && S.settings.bookArrows === 'on' && onBookPath() && S.ply < S.bookSans.length) {
    const next = S.moves[S.ply];
    if (next) shapes.push({ orig: next.from, dest: next.to, brush: 'green' });
  }
  const P = S.practice;
  if (S.mode === 'practice' && P && P.hintLevel && !P.done) {
    const m = buildMoves([S.bookSans[S.moves.length]], fenAt(S.moves.length))[0];
    if (m) shapes.push(P.hintLevel === 1 ? { orig: m.from, brush: 'green' } : { orig: m.from, dest: m.to, brush: 'green' });
  }
  if (S.glyph) shapes.push({ orig: S.glyph.sq, customSvg: { html: GLYPH(S.glyph.good) } });
  cg.setAutoShapes(shapes);
}

function flashGlyph(sq, good) {
  S.glyph = { sq, good };
  drawShapes();
  clearTimeout(flashGlyph.t);
  flashGlyph.t = setTimeout(() => {
    S.glyph = null;
    drawShapes();
  }, 1100);
}

function banner(html) {
  const b = $('banner');
  if (!html) b.classList.add('hidden');
  else {
    b.innerHTML = html;
    b.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------- engine

function engineActive() {
  if (!S.engineOn) return false;
  if (S.mode === 'quiz') return !!S.quiz && !!S.quiz.answered;
  if (S.mode === 'practice') return !!S.practice && S.practice.done;
  if (S.mode === 'play') return !S.play || !!S.play.over;
  return true;
}

let evalTimer = null;
function requestEval(force = false) {
  const fen = fenAt(S.ply);
  if (!engineActive()) {
    if (S.engineState === 'running') analysis.stop();
    S.engineState = 'idle';
    S.evalFen = null;
    S.lines = [];
    S.linesFen = null;
    renderCeval();
    return;
  }
  if (fen === S.evalFen && !force) return;
  S.evalFen = fen;
  const cached = S.cache.get(epdOf(fen));
  S.lines = cached ? cached.lines : [];
  S.linesFen = cached ? fen : null;
  renderCeval();
  clearTimeout(evalTimer);
  const chess = new Chess(fen);
  if (chess.isGameOver()) {
    analysis.stop();
    S.engineState = 'over';
    renderCeval();
    return;
  }
  evalTimer = setTimeout(() => startAnalysis(fen), 90);
}

let uiPending = false;
function scheduleEngineUi() {
  if (uiPending) return;
  uiPending = true;
  setTimeout(() => {
    uiPending = false;
    renderCeval();
    drawShapes();
    refreshVerdicts();
  }, 160);
}

function cacheLines(fen, lines, depth) {
  const key = epdOf(fen);
  const old = S.cache.get(key);
  if (!old || depth >= old.depth) S.cache.set(key, { depth, lines: lines.map(l => ({ ...l })) });
}

function startAnalysis(fen) {
  if (fen !== fenAt(S.ply)) return;
  const depth = Number(S.settings.depth);
  const multipv = Number(S.settings.multipv);
  const cached = S.cache.get(epdOf(fen));
  if (cached && cached.depth >= depth && cached.lines.length >= Math.min(multipv, legalCount(fen))) {
    S.lines = cached.lines;
    S.linesFen = fen;
    S.engineState = 'done';
    S.engineDepth = cached.depth;
    renderCeval();
    drawShapes();
    refreshVerdicts();
    backgroundPrev();
    return;
  }
  S.engineState = analysis.ready ? 'running' : 'loading';
  renderCeval();
  analysis.start().catch(err => {
    S.engineState = 'error';
    S.engineError = String(err);
    renderCeval();
  });
  analysis.analyse({
    fen,
    multipv,
    depth,
    onUpdate(lines, job) {
      if (fen !== fenAt(S.ply)) return;
      S.engineState = 'running';
      S.lines = lines;
      S.linesFen = fen;
      S.engineDepth = job.depth;
      S.engineNps = lines[0] ? lines[0].nps : 0;
      if (job.depth >= 6) cacheLines(fen, lines, job.depth);
      scheduleEngineUi();
    },
    onDone(best, lines) {
      if (lines.length) cacheLines(fen, lines, Math.min(...lines.map(l => l.depth)));
      if (fen !== fenAt(S.ply)) return;
      S.engineState = 'done';
      scheduleEngineUi();
      backgroundPrev();
    },
  });
}

function legalCount(fen) {
  return new Chess(fen).moves().length;
}

// Analyse the previous position quietly so "was this move good?" can be answered.
function backgroundPrev() {
  if (S.ply === 0 || !(S.mode === 'learn' || S.mode === 'explore')) return;
  const prev = fenAt(S.ply - 1);
  const c = S.cache.get(epdOf(prev));
  if (c && c.depth >= 12) return;
  const here = fenAt(S.ply);
  analysis.analyse({
    fen: prev,
    multipv: 3,
    depth: 14,
    onDone(best, lines) {
      if (lines.length) cacheLines(prev, lines, Math.min(...lines.map(l => l.depth)));
      if (here === fenAt(S.ply)) refreshVerdicts();
    },
  });
}

function renderEvalBar() {
  const fen = fenAt(S.ply);
  const line = S.linesFen === fen ? S.lines[0] : null;
  const bar = $('evalBar');
  bar.classList.toggle('off', !engineActive());
  $('evalFill').style.height = (engineActive() && line ? evalToPercent(line) : 50) + '%';
}

function renderCeval() {
  $('engineToggle').checked = S.engineOn;
  const fen = fenAt(S.ply);
  const lines = S.linesFen === fen ? S.lines : [];
  const score = $('cevalScore');
  const depth = $('cevalDepth');
  const pvs = $('pvs');
  renderEvalBar();
  if (!S.engineOn) {
    score.textContent = '–';
    depth.textContent = 'Off — press E or the switch';
    pvs.innerHTML = '';
    return;
  }
  if (!engineActive()) {
    score.textContent = '–';
    depth.textContent = S.mode === 'play' ? 'Hidden during the game' : S.mode === 'quiz' ? 'Hidden until you answer' : 'Hidden while you practise';
    pvs.innerHTML = '';
    return;
  }
  const chess = new Chess(fen);
  if (chess.isGameOver()) {
    score.textContent = chess.isCheckmate() ? '#' : '½';
    depth.textContent = chess.isCheckmate() ? 'Checkmate' : 'Draw';
    pvs.innerHTML = '';
    return;
  }
  if (S.engineState === 'error') {
    score.textContent = '!';
    depth.textContent = 'Engine failed to load — serve the folder over http(s)';
    pvs.innerHTML = '';
    return;
  }
  score.textContent = lines[0] ? formatEval(lines[0]) : '…';
  if (S.engineState === 'loading' && !lines.length) depth.textContent = 'Loading engine…';
  else if (lines[0]) {
    const d = lines[0].depth;
    const nps = S.engineNps ? ` · ${Math.round(S.engineNps / 1000)}k n/s` : '';
    depth.textContent = `Depth ${d}${S.engineState === 'running' ? '/' + S.settings.depth : ''}${nps}`;
  } else depth.textContent = 'Calculating…';
  const ply = S.ply;
  const bookUcis = new Set(S.book ? S.book.movesFrom(fen).map(m => m.uci) : []);
  pvs.innerHTML = lines
    .slice(0, Number(S.settings.multipv))
    .map((l, i) => {
      const sans = pvToSan(fen, l.pv, 12);
      const isBook = bookUcis.has(l.pv[0]);
      return `<div class="pv" data-pv="${i}" title="Click to play ${esc(sans[0] || '')}"><strong>${formatEval(l)}</strong><span>${isBook ? '<span class="book-tag">BOOK</span> ' : ''}${esc(formatSans(sans, ply))}</span></div>`;
    })
    .join('');
}

// ---------------------------------------------------------------- verdicts

function verdictFor(fenBefore, uci, color, { book = false } = {}) {
  const c = S.cache.get(epdOf(fenBefore));
  const live = S.linesFen === fenBefore ? S.lines : null;
  const lines = live && live.length ? live : c ? c.lines : null;
  if (!S.engineOn) return '';
  if (!lines || !lines.length) return `<div class="verdict"><span class="ic">…</span><span class="muted">Stockfish is thinking about this…</span></div>`;
  const depth = lines[0].depth;
  const best = lines[0];
  const bestSan = pvToSan(fenBefore, best.pv, 1)[0];
  const rank = lines.findIndex(l => l.pv[0] === uci);
  const bestScore = scoreFor(best, color);
  if (rank === 0) return `<div class="verdict"><span class="ic good">✓</span><span>Stockfish's <b>top choice</b> here (${fmtPawns(bestScore)} for ${color === 'w' ? 'White' : 'Black'}, depth ${depth}).</span></div>`;
  if (rank > 0) {
    const s = scoreFor(lines[rank], color);
    const loss = bestScore - s;
    if (loss < 0.35)
      return `<div class="verdict"><span class="ic good">✓</span><span>One of Stockfish's top moves (#${rank + 1}, ${fmtPawns(s)}). Practically as good as its favourite, <b>${esc(bestSan)}</b> (${fmtPawns(bestScore)}).</span></div>`;
    return `<div class="verdict"><span class="ic warn">!</span><span>Stockfish's #${rank + 1} choice (${fmtPawns(s)}). It prefers <b>${esc(bestSan)}</b> (${fmtPawns(bestScore)}).${book ? ' Book moves are often chosen for practical reasons — small differences rarely matter this early.' : ''}</span></div>`;
  }
  return `<div class="verdict"><span class="ic ${book ? 'warn' : 'bad'}">${book ? '!' : '?'}</span><span>Not in Stockfish's top ${lines.length}. It prefers <b>${esc(bestSan)}</b> (${fmtPawns(bestScore)}).${book ? ' This is still established theory: gambits and offbeat lines trade a little objective value for practical chances.' : ''}</span></div>`;
}

function refreshVerdicts() {
  const mv = $('moveVerdict');
  if (mv && S.ply > 0) {
    const m = S.moves[S.ply - 1];
    mv.innerHTML = verdictFor(m.before, uciOf(m), m.color, { book: S.ply <= devIndex() || !!S.book.inBook(m.after) });
  }
  const nv = $('nextVerdict');
  if (nv) {
    const next = S.moves[S.ply];
    if (next) nv.innerHTML = verdictFor(next.before, uciOf(next), next.color, { book: true });
  }
}

// ---------------------------------------------------------------- render

function render() {
  syncBoard();
  renderTitle();
  renderMoves();
  renderPanel();
  renderControls();
  drawShapes();
  requestEval();
}

function renderTitle() {
  const bar = $('openingBar');
  if (S.mode === 'quiz' && S.quiz && !S.quiz.answered) {
    bar.innerHTML = '<span class="name">Which opening is this?</span>';
    return;
  }
  let o = null;
  let suffix = '';
  if ((S.mode === 'learn' || S.mode === 'practice') && S.opening) o = S.opening;
  else {
    const det = S.book && S.book.detect(allFens().slice(0, S.ply + 1));
    if (det) {
      o = det.opening;
      if (!det.exact && !S.book.inBook(fenAt(S.ply))) suffix = ' <span class="muted">· out of book</span>';
    }
  }
  if (!o) {
    bar.innerHTML = '<span class="name muted">Starting position</span>';
    return;
  }
  const fav = progress.isFav(o.key);
  bar.innerHTML =
    `<span class="eco">${o.eco}</span><span class="name" title="${esc(o.name)}">${nameHtml(o)}${suffix}</span>` +
    `<button class="star ${fav ? 'on' : ''}" data-fav="${o.id}" title="${fav ? 'Remove from' : 'Add to'} My lines" aria-label="Favourite"><svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg></button>`;
}

function renderMoves() {
  const el = $('moves');
  if (!S.moves.length) {
    const msg =
      S.mode === 'practice' && S.practice ? 'Play the first move of the line.' : S.mode === 'quiz' ? '' : 'Make a move on the board, or pick an opening from the list.';
    el.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }
  const dev = devIndex();
  const hide = S.mode === 'quiz' && S.quiz && !S.quiz.answered;
  let html = '';
  S.moves.forEach((m, i) => {
    if (i % 2 === 0) html += `<span class="idx">${i / 2 + 1}</span>`;
    const cls = ['mv'];
    if (i + 1 === S.ply) cls.push('active');
    if (S.opening && S.mode === 'learn' && i >= dev) cls.push('dev');
    if (i + 1 > S.ply) cls.push('ahead');
    if (hide) cls.push('hidden-mv');
    html += `<span class="${cls.join(' ')}" data-ply="${i + 1}">${hide ? '????' : esc(m.san)}</span>`;
  });
  el.innerHTML = html;
  const a = el.querySelector('.active');
  if (a) el.scrollTop = Math.max(0, a.offsetTop - el.clientHeight / 2);
  else if (S.ply === 0) el.scrollTop = 0;
}

function renderControls() {
  const ok = navAllowed();
  $('btnFirst').disabled = !ok || S.ply === 0;
  $('btnPrev').disabled = !ok || S.ply === 0;
  $('btnNext').disabled = !ok || S.ply >= S.moves.length;
  $('btnLast').disabled = !ok || S.ply >= S.moves.length;
  $('btnAuto').disabled = !ok || S.ply >= S.moves.length;
  $('btnAuto').classList.toggle('on', !!S.auto);
}

function card(title, body, right = '') {
  return `<div class="card"><h4>${title}${right ? `<span class="right">${right}</span>` : ''}</h4>${body}</div>`;
}

function renderPanel() {
  const p = $('panel');
  const keep = renderPanel.keepScroll ? p.scrollTop : 0;
  renderPanel.keepScroll = false;
  let html = '';
  switch (S.mode) {
    case 'learn':
      html = learnPanel();
      break;
    case 'practice':
      html = practicePanel();
      break;
    case 'explore':
      html = explorePanel();
      break;
    case 'play':
      html = playPanel();
      break;
    case 'quiz':
      html = quizPanel();
      break;
  }
  p.innerHTML = html;
  p.scrollTop = keep;
  refreshVerdicts();
}

// ---------- shared cards

function moveCard({ title = 'This move' } = {}) {
  const m = S.moves[S.ply - 1];
  if (!m) return '';
  const name = S.opening ? S.opening.name : '';
  const notes = explainMove(m, { prevMove: S.moves[S.ply - 2], gambit: /Gambit/i.test(name) });
  const named = S.book.namedAt(m.after);
  const inBook = S.book.inBook(m.after);
  let tag = '';
  if (S.mode === 'learn' && S.opening) tag = S.ply <= devIndex() ? '<span class="tag book">Book line</span>' : inBook ? '<span class="tag dev">Other book move</span>' : '<span class="tag dev">Off book</span>';
  else tag = inBook ? '<span class="tag book">Book</span>' : '<span class="tag dev">Out of book</span>';
  return card(
    title,
    `<div class="move-head"><span class="san">${esc(moveLabel(S.ply, m.san))}</span><span class="who">${m.color === 'w' ? 'White' : 'Black'}</span>${tag}</div>` +
      `<ul class="notes">${notes.map(n => `<li class="${n.kind}">${n.text}</li>`).join('')}</ul>` +
      (named ? `<div class="named">This position is the <b>${esc(named.name)}</b> (${named.eco}).</div>` : '') +
      '<div id="moveVerdict"></div>',
    `${S.ply} / ${S.moves.length}`
  );
}

function bookMovesCard(title = 'Book moves from here') {
  const fen = fenAt(S.ply);
  const moves = S.book.movesFrom(fen);
  if (!moves.length) return card(title, '<p class="muted small">No named openings continue from this position — you are out of the opening book. Stockfish can still guide you.</p>');
  const next = S.moves[S.ply];
  const rows = moves
    .slice(0, 14)
    .map(m => {
      const isNext = next && uciOf(next) === m.uci && (S.mode !== 'learn' || onBookPath());
      return `<tr data-uci="${m.uci}" class="${isNext ? 'next' : ''}"><td class="m">${esc(moveLabel(S.ply + 1, m.san))}</td><td class="o">${m.opening ? nameHtml(m.opening) : '<span class="muted">…</span>'}</td><td class="n" title="named lines behind this move">${m.lines}</td></tr>`;
    })
    .join('');
  return card(title, `<table class="bookmoves">${rows}</table>`, `${moves.length} move${moves.length > 1 ? 's' : ''}`);
}

function guideCard(o, open = true) {
  if (!o) return '';
  const g = guideFor(o.name);
  const cat = categoryOf(o.sans);
  let body = '';
  if (g) {
    body += `<p><b>${esc(g.title)}.</b> ${esc(g.summary)}</p>`;
    body += `<p class="small"><b>Plans for White</b></p><ul class="small">${g.white.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    body += `<p class="small"><b>Plans for Black</b></p><ul class="small">${g.black.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (g.tip) body += `<div class="feedback warn small"><b>Watch out:</b> ${esc(g.tip)}</div>`;
    body += `<p class="muted small">${esc(cat.title)}</p>`;
  } else {
    body += `<p><b>${esc(cat.title)}.</b> ${esc(cat.text)}</p>`;
    body += `<p class="muted small">Stockfish's evaluation and the book moves show you which continuations are sound.</p>`;
  }
  return open ? card('Strategy guide', body) : `<div class="card"><details><summary>Strategy guide</summary>${body}</details></div>`;
}

function variationsCard(o) {
  const vars = S.book.variationsOf(o);
  if (!vars.length) {
    const parent = S.book.byName(o.family);
    if (parent && parent.id !== o.id) return card('Part of', `<div class="var-list">${opItem(parent)}</div>`);
    return '';
  }
  const shown = S.showAllVars ? vars : vars.slice(0, 12);
  return card(
    'Variations',
    `<div class="var-list">${shown.map(v => opItem(v, o.plies)).join('')}</div>` +
      (vars.length > shown.length ? `<div style="padding-top:10px"><button class="btn small block" data-act="allvars">Show all ${vars.length} variations</button></div>` : ''),
    `${vars.length}`
  );
}

function principlesHtml() {
  return `<details><summary>Opening principles</summary><ul class="small">${PRINCIPLES.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>`;
}

// ---------- learn

function learnPanel() {
  const o = S.opening;
  if (!o) {
    return (
      card(
        'Welcome',
        `<p>Pick any opening from the list — or search <b>3,800+</b> named openings by name, ECO code or moves — and step through it move by move. Every move is explained, and <b>Stockfish</b> checks the theory as you go.</p>
        <div class="row"><button class="btn primary" data-act="start-italian">Start with the Italian Game</button><button class="btn" data-act="random">Random opening</button></div>
        <ul class="small">
          <li><b>Learn</b> — step through a line with explanations (arrow keys or ▶).</li>
          <li><b>Practice</b> — play the moves yourself; mistakes are corrected and lines come back for review.</li>
          <li><b>Explore</b> — play any moves and see which openings they lead to.</li>
          <li><b>Play</b> — continue from any position against Stockfish (8 levels).</li>
          <li><b>Quiz</b> — guess the opening from the position.</li>
        </ul>${principlesHtml()}`
      ) +
      (S.ply > 0 ? moveCard() : '') +
      bookMovesCard()
    );
  }
  let html = '';
  if (S.ply === 0) {
    html += card(
      'Get started',
      `<p>Step through <b>${esc(o.name)}</b> with <span class="kbd">→</span> or the ▶ button. The green arrow shows the next book move; the blue arrow is Stockfish's choice.</p>
       <p class="muted small">${o.plies} half-moves · ECO ${o.eco} · best learned as ${sideFor(o) === 'white' ? 'White' : 'Black'}</p>
       <div class="row"><button class="btn primary" data-act="next">Start ▶</button><button class="btn" data-act="practice">Practice it</button></div>
       ${principlesHtml()}`
    );
  } else html += moveCard();

  const dev = devIndex();
  if (S.ply > dev) {
    html += card(
      'You left the line',
      `<p>You are exploring your own moves. The book line continues with <b>${esc(moveLabel(dev + 1, S.bookSans[dev]))}</b>.</p><button class="btn primary" data-act="backtoline">Back to the book line</button>`
    );
  } else if (S.ply < S.bookSans.length) {
    const next = S.bookSans[S.ply];
    html += card(
      'Next in the line',
      `<div class="row"><span class="move-head"><span class="san">${esc(moveLabel(S.ply + 1, next))}</span></span><button class="btn small primary" data-act="next">Play it ▶</button></div><div id="nextVerdict"></div>`
    );
  } else {
    const l = progress.line(o.key);
    html += card(
      'Line complete',
      `<p>That's the whole of <b>${esc(o.name)}</b>${l ? ` — mastery: <b>${MASTERY_LABELS[l.box]}</b>` : ''}. Now test yourself, look at the variations below, or play on against Stockfish.</p>
       <div class="row"><button class="btn good" data-act="practice">Practice it</button><button class="btn" data-act="playon">Play on vs Stockfish</button><button class="btn" data-act="explore">Explore from here</button></div>`
    );
  }
  html += bookMovesCard();
  html += guideCard(o);
  html += variationsCard(o);
  return html;
}

// ---------- practice

function startPractice(o = S.opening, color) {
  if (!o) return;
  stopAuto();
  banner(null);
  S.opening = o;
  S.bookSans = o.sans;
  color = color || sideFor(o);
  S.practice = { color, mistakes: 0, hints: 0, hintLevel: 0, done: false, waiting: false, feedback: null };
  S.orientation = color;
  S.moves = [];
  S.ply = 0;
  render();
  practiceAdvance();
}

function practiceAdvance() {
  const P = S.practice;
  if (!P || P.done) return;
  if (S.moves.length >= S.bookSans.length) return finishPractice();
  if (turnAt(S.moves.length) !== P.color) {
    P.waiting = true;
    syncBoard();
    setTimeout(() => {
      if (S.practice !== P || S.mode !== 'practice') return;
      P.waiting = false;
      const m = buildMoves([S.bookSans[S.moves.length]], fenAt(S.moves.length))[0];
      S.moves.push(m);
      S.ply = S.moves.length;
      playMoveSound(m);
      if (S.moves.length >= S.bookSans.length) return finishPractice();
      render();
    }, 550);
  }
}

function practiceMove(m) {
  const P = S.practice;
  const expected = S.bookSans[S.moves.length];
  const fen = fenAt(S.ply);
  if (m.san === expected) {
    P.hintLevel = 0;
    const note = explainMove(m, { prevMove: S.moves[S.ply - 1], gambit: /Gambit/i.test(S.opening.name) })[0];
    P.feedback = { kind: 'good', html: `<b>${esc(m.san)}</b> — correct!${note ? ' ' + note.text : ''}` };
    S.moves.push(m);
    S.ply = S.moves.length;
    playMoveSound(m);
    render();
    flashGlyph(m.to, true);
    practiceAdvance();
    return;
  }
  P.mistakes++;
  sound.bad();
  const wrap = $('boardWrap');
  wrap.classList.remove('shake');
  void wrap.offsetWidth;
  wrap.classList.add('shake');
  syncBoard();
  flashGlyph(m.to, false);
  const alt = S.book.movesFrom(fen).find(x => x.uci === uciOf(m));
  P.feedback = {
    kind: 'bad',
    html:
      `<b>${esc(m.san)}</b> isn't the move in this line.` +
      (alt ? ` It is a book move too${alt.opening ? ` — it leads to the <b>${esc(alt.opening.name)}</b>` : ''}, but here you're training <b>${esc(S.opening.name)}</b>.` : '') +
      ' Try again, or take a hint.',
    cmp: null,
  };
  const fb = P.feedback;
  renderPanel();
  const exp = buildMoves([expected], fen)[0];
  analysis.start().catch(() => {});
  analysis.analyse({
    fen,
    multipv: 2,
    depth: 13,
    searchmoves: [uciOf(m), uciOf(exp)],
    onDone(best, lines) {
      if (S.practice !== P || P.feedback !== fb) return;
      const mine = lines.find(l => l.pv[0] === uciOf(m));
      const theirs = lines.find(l => l.pv[0] === uciOf(exp));
      if (!mine || !theirs) {
        fb.cmp = '';
        return;
      }
      const a = scoreFor(mine, m.color);
      const b = scoreFor(theirs, m.color);
      const diff = b - a;
      let txt;
      if (diff < 0.3) txt = `Stockfish rates your move about the same (${fmtPawns(a)} vs ${fmtPawns(b)}), so it's a fine move — just not this line.`;
      else if (diff < 1) txt = `Stockfish thinks your move is a bit worse (${fmtPawns(a)} vs ${fmtPawns(b)} for the book move).`;
      else txt = `Stockfish says your move is a real mistake: ${fmtPawns(a)} vs ${fmtPawns(b)} after the book move.`;
      fb.cmp = txt;
      const el = $('cmp');
      if (el) {
        el.textContent = txt;
        el.classList.remove('muted');
      }
    },
  });
}

function practiceHint() {
  const P = S.practice;
  if (!P || P.done || P.waiting) return;
  P.hintLevel = Math.min(2, P.hintLevel + 1);
  P.hints++;
  drawShapes();
  renderPanel();
}

function practiceShow() {
  const P = S.practice;
  if (!P || P.done || P.waiting) return;
  const m = buildMoves([S.bookSans[S.moves.length]], fenAt(S.moves.length))[0];
  P.mistakes++;
  P.hintLevel = 0;
  P.feedback = { kind: 'warn', html: `The move was <b>${esc(m.san)}</b>.` };
  S.moves.push(m);
  S.ply = S.moves.length;
  playMoveSound(m);
  render();
  practiceAdvance();
}

function finishPractice() {
  const P = S.practice;
  P.done = true;
  P.waiting = false;
  P.result = progress.record(S.opening.key, P.mistakes + (P.hints ? 1 : 0));
  sound.done();
  render();
  renderSide();
}

function practicePanel() {
  const P = S.practice;
  if (!P) {
    const due = progress.due().map(l => S.book.byKey.get(l.key)).filter(Boolean);
    return (
      card(
        'Practice',
        `<p>Choose an opening from the list to drill it. You play your side's moves; the trainer answers with the book moves. Mistakes are explained by Stockfish and the line comes back sooner for review (spaced repetition).</p>
         <div class="row"><button class="btn primary" data-act="random-practice">Random popular opening</button>${due.length ? `<button class="btn good" data-act="next-due">Review due lines (${due.length})</button>` : ''}</div>`
      ) + dueCard()
    );
  }
  const total = S.bookSans.filter((_, i) => turnAt(i) === P.color).length;
  const doneN = S.moves.filter((_, i) => turnAt(i) === P.color).length;
  const pct = total ? Math.round((doneN / total) * 100) : 0;
  let status;
  if (P.done) status = `<div class="status"><span class="ic good">✓</span>Line complete!</div>`;
  else if (P.waiting) status = `<div class="status"><span class="ic turn ${P.color === 'white' ? 'b' : 'w'}"></span>Opponent is moving…</div>`;
  else status = `<div class="status"><span class="ic turn ${P.color === 'white' ? 'w' : 'b'}"></span>Your move — find ${P.color === 'white' ? 'White' : 'Black'}'s book move</div>`;
  let body = `${status}<div class="bar-line"><div style="width:${pct}%"></div></div>
    <div class="row small muted"><span>${doneN} / ${total} moves</span><span>·</span><span>${P.mistakes} mistake${P.mistakes === 1 ? '' : 's'}</span><span>·</span><span>${P.hints} hint${P.hints === 1 ? '' : 's'}</span></div>`;
  if (P.feedback && !P.done) {
    const cmp = P.feedback.cmp === undefined ? '' : `<div id="cmp" class="small ${P.feedback.cmp ? '' : 'muted'}" style="margin-top:6px">${P.feedback.cmp === null ? 'Asking Stockfish about your move…' : esc(P.feedback.cmp)}</div>`;
    body += `<div class="feedback ${P.feedback.kind}">${P.feedback.html}${cmp}</div>`;
  }
  if (P.done) {
    const l = P.result;
    const days = Math.max(0, Math.round((l.due - Date.now()) / 86400000));
    const perfect = P.mistakes === 0 && P.hints === 0;
    body += `<div class="feedback ${perfect ? 'good' : 'warn'}">${perfect ? '<b>Perfect run!</b>' : `Finished with ${P.mistakes} mistake${P.mistakes === 1 ? '' : 's'}${P.hints ? ' and hints' : ''}.`} Mastery: <b>${MASTERY_LABELS[l.box]}</b>. ${days ? `Next review in ${days} day${days === 1 ? '' : 's'}.` : 'Practice it again soon.'}</div>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="practice">Again</button><button class="btn" data-act="next-due">Next due line</button><button class="btn" data-act="playon">Play on vs Stockfish</button><button class="btn" data-act="learn">Review in Learn</button></div>`;
  } else {
    body += `<div class="row" style="margin-top:10px"><button class="btn" data-act="hint" ${P.waiting ? 'disabled' : ''}>Hint <span class="kbd">H</span></button><button class="btn" data-act="show" ${P.waiting ? 'disabled' : ''}>Show move</button><button class="btn" data-act="practice">Restart</button></div>`;
  }
  const sideSel = `<div class="seg" data-practice-color><button data-v="white" class="${P.color === 'white' ? 'active' : ''}">White</button><button data-v="black" class="${P.color === 'black' ? 'active' : ''}">Black</button></div>`;
  return card(`Practice · ${esc(S.opening.name)}`, body) + card('Play as', `<div class="row">${sideSel}<span class="muted small">Restarts the line from the other side.</span></div>`) + (P.done ? moveCard({ title: 'Last move' }) : '') + dueCard();
}

function dueCard() {
  const due = progress
    .due()
    .map(l => S.book.byKey.get(l.key))
    .filter(Boolean);
  if (!due.length) return '';
  return card('Due for review', `<div class="var-list">${due.slice(0, 15).map(o => opItem(o)).join('')}</div>`, `${due.length}`);
}

function nextDue() {
  const due = progress
    .due()
    .map(l => S.book.byKey.get(l.key))
    .filter(o => o && (!S.opening || o.id !== S.opening.id));
  if (due.length) return startPractice(due[0]);
  const favs = progress
    .favs()
    .map(k => S.book.byKey.get(k))
    .filter(o => o && (!S.opening || o.id !== S.opening.id));
  if (favs.length) {
    toast('Nothing due — practising one of your favourites.');
    return startPractice(favs[Math.floor(Math.random() * favs.length)]);
  }
  toast('Nothing due — here is a random popular opening.');
  startPractice(randomPopular());
}

// ---------- explore

function explorePanel() {
  const det = S.book.detect(allFens().slice(0, S.ply + 1));
  let info;
  if (!det) info = '<p>Starting position. Make any move on the board — the trainer shows which openings each move leads to.</p>';
  else if (det.exact) info = `<p>This position is the <b>${esc(det.opening.name)}</b> <span class="muted">(${det.opening.eco})</span>.</p><div class="row"><button class="btn small" data-learn="${det.opening.id}">Learn this line</button><button class="btn small" data-practice="${det.opening.id}">Practice it</button></div>`;
  else if (S.book.inBook(fenAt(S.ply))) info = `<p>Still in the opening book. Last named position: <b>${esc(det.opening.name)}</b> after move ${Math.ceil(det.ply / 2)}.</p>`;
  else info = `<p><b>Out of book.</b> The last named position was <b>${esc(det.opening.name)}</b> after move ${Math.ceil(det.ply / 2)}. From here, follow Stockfish's suggestions.</p><button class="btn small" data-learn="${det.opening.id}">Learn ${esc(det.opening.family)}</button>`;
  return card('Where am I?', info) + bookMovesCard() + (S.ply > 0 ? moveCard({ title: 'Last move' }) : '') + (det ? guideCard(det.opening, false) : '');
}

// ---------- play

function playPanel() {
  const G = S.play;
  if (!G) {
    const lv = S.playSetup.level;
    return (
      card(
        'Play vs Stockfish',
        `<p>Play from the position on the board${S.ply ? ` (after ${moveLabel(S.ply, S.moves[S.ply - 1].san)})` : ''}. Set up a position first by picking an opening or making moves, then start.</p>
        <p class="small"><b>Level</b> <span class="muted">${LEVELS[lv - 1].label}</span></p>
        <div class="levels" data-levels>${LEVELS.map((_, i) => `<button data-v="${i + 1}" class="${i + 1 === lv ? 'active' : ''}">${i + 1}</button>`).join('')}</div>
        <p class="small"><b>You play</b></p>
        <div class="row"><div class="seg" data-play-color><button data-v="white" class="${S.playSetup.color === 'white' ? 'active' : ''}">White</button><button data-v="black" class="${S.playSetup.color === 'black' ? 'active' : ''}">Black</button><button data-v="random" class="${S.playSetup.color === 'random' ? 'active' : ''}">Random</button></div></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-act="startgame">Start game</button>${S.ply ? '<button class="btn" data-act="startgame-fresh">From the start position</button>' : ''}</div>`
      ) + bookMovesCard('Opening book')
    );
  }
  const chess = new Chess(fenAt(S.moves.length));
  const yourTurn = turnAt(S.moves.length) === G.color;
  let status;
  if (G.over) status = `<div class="status"><span class="ic ${G.result === 'win' ? 'good' : G.result === 'loss' ? 'bad' : 'turn'}">${G.result === 'win' ? '✓' : G.result === 'loss' ? '✗' : '½'}</span>${esc(G.over)}</div>`;
  else if (G.thinking) status = `<div class="status"><span class="ic turn ${G.color === 'white' ? 'b' : 'w'}"></span>Stockfish is thinking…</div>`;
  else status = `<div class="status"><span class="ic turn ${G.color === 'white' ? 'w' : 'b'}"></span>Your move${chess.inCheck() ? ' — you are in check!' : ''}</div>`;
  const det = S.book.detect(allFens());
  const bookNote = det ? `<p class="small muted">Opening: ${esc(det.opening.name)}${S.book.inBook(fenAt(S.moves.length)) ? ' (still in book)' : ''}</p>` : '';
  const buttons = G.over
    ? `<button class="btn primary" data-act="rematch">Play again</button><button class="btn" data-act="analyse">Analyse in Explore</button><button class="btn" data-act="newsetup">New setup</button>`
    : `<button class="btn" data-act="takeback" ${S.moves.length <= G.startPly ? 'disabled' : ''}>Takeback</button><button class="btn" data-act="resign">Resign</button>`;
  return card(`vs Stockfish · level ${G.level}`, `${status}${bookNote}<div class="row" style="margin-top:10px">${buttons}</div>`) + (S.ply > 0 && G.over ? moveCard({ title: 'Last move' }) : '');
}

function startGame(fromStart = false) {
  stopAuto();
  banner(null);
  if (fromStart) {
    S.moves = [];
    S.ply = 0;
  }
  S.moves = S.moves.slice(0, S.ply);
  let color = S.playSetup.color;
  if (color === 'random') color = Math.random() < 0.5 ? 'white' : 'black';
  S.play = { color, level: S.playSetup.level, startPly: S.ply, thinking: false, over: null };
  S.orientation = color;
  progress.set('level', S.playSetup.level);
  render();
  engineTurn();
}

function gameMove(m) {
  S.moves = S.moves.slice(0, S.ply).concat(m);
  S.ply = S.moves.length;
  playMoveSound(m);
  if (!checkGameOver()) engineTurn();
  render();
}

function engineTurn() {
  const G = S.play;
  if (!G || G.over) return;
  if (turnAt(S.moves.length) === G.color) return;
  const fen = fenAt(S.moves.length);
  const lv = LEVELS[G.level - 1];
  if (!player) player = new Engine('Stockfish (opponent)');
  G.thinking = true;
  renderPanel();
  syncBoard();
  const started = Date.now();
  player.start().catch(err => toast('Engine failed to load: ' + err));
  player.analyse({
    fen,
    multipv: 1,
    depth: lv.depth,
    movetime: lv.movetime,
    options: { 'Skill Level': lv.skill },
    onDone(best) {
      if (S.play !== G || G.over) return;
      const delay = Math.max(0, 350 - (Date.now() - started));
      setTimeout(() => {
        if (S.play !== G || G.over) return;
        G.thinking = false;
        const m = moveFromUci(fen, best);
        if (!m) return;
        S.moves = S.moves.slice(0, S.moves.length).concat(m);
        S.ply = S.moves.length;
        playMoveSound(m);
        checkGameOver();
        render();
      }, delay);
    },
  });
}

function checkGameOver() {
  const G = S.play;
  const c = new Chess();
  for (const m of S.moves) c.move(m.san);
  if (!c.isGameOver()) return false;
  if (c.isCheckmate()) {
    const loser = c.turn() === 'w' ? 'white' : 'black';
    G.result = loser === G.color ? 'loss' : 'win';
    G.over = G.result === 'win' ? 'Checkmate — you win!' : 'Checkmate — Stockfish wins.';
  } else {
    G.result = 'draw';
    G.over = c.isStalemate() ? 'Stalemate — draw.' : c.isThreefoldRepetition() ? 'Draw by repetition.' : c.isInsufficientMaterial() ? 'Draw — insufficient material.' : 'Draw by the 50-move rule.';
  }
  G.thinking = false;
  sound.done();
  banner(`<strong>${esc(G.over)}</strong>`);
  setTimeout(() => banner(null), 2500);
  return true;
}

function takeback() {
  const G = S.play;
  if (!G || G.over) return;
  if (player) player.stop();
  G.thinking = false;
  let n = turnAt(S.moves.length) === G.color ? 2 : 1;
  n = Math.min(n, S.moves.length - G.startPly);
  S.moves = S.moves.slice(0, S.moves.length - n);
  S.ply = S.moves.length;
  render();
  engineTurn();
}

// ---------- quiz

let quizPool = null;
function buildQuizPool() {
  const fams = new Set();
  POPULAR.forEach(g => g.names.forEach(n => fams.add(n.split(':')[0])));
  ['Scotch Game', "Petrov's Defense", 'Four Knights Game', 'Philidor Defense', 'Bishop\'s Opening', 'Benoni Defense', 'Catalan Opening', 'Nimzo-Indian Defense', 'Grünfeld Defense', 'Dutch Defense', "King's Indian Attack", 'Modern Defense', 'Pirc Defense'].forEach(f => fams.add(f));
  quizPool = {
    popular: S.book.openings.filter(o => fams.has(o.family) && o.plies >= 2 && o.plies <= 12),
    all: S.book.openings.filter(o => o.plies >= 2 && o.plies <= 16),
  };
}

function newQuiz() {
  stopAuto();
  banner(null);
  if (!quizPool) buildQuizPool();
  const diff = S.quizDifficulty;
  const pool = diff === 'hard' ? quizPool.popular : diff === 'all' ? quizPool.all : quizPool.popular;
  const o = pool[Math.floor(Math.random() * pool.length)];
  const opts = [o];
  const used = new Set([o.name]);
  const usedFam = new Set([o.family]);
  let tries = 0;
  while (opts.length < 4 && tries++ < 500) {
    let cand;
    if (diff === 'hard') {
      const same = pool.filter(x => x.family === o.family && !used.has(x.name));
      cand = same.length && tries < 200 ? same[Math.floor(Math.random() * same.length)] : pool[Math.floor(Math.random() * pool.length)];
    } else {
      cand = pool[Math.floor(Math.random() * pool.length)];
      if (usedFam.has(cand.family)) continue;
    }
    if (used.has(cand.name)) continue;
    used.add(cand.name);
    usedFam.add(cand.family);
    opts.push(cand);
  }
  const prev = S.quiz || { streak: 0, score: 0, total: 0 };
  S.quiz = { o, options: shuffle(opts), answered: null, streak: prev.streak, score: prev.score, total: prev.total };
  S.opening = null;
  S.bookSans = [];
  S.moves = buildMoves(o.sans);
  S.orientation = 'white';
  S.ply = 0;
  render();
  // Replay the moves so the player sees how the position arose.
  const q = S.quiz;
  const step = () => {
    if (S.quiz !== q || S.mode !== 'quiz' || S.ply >= S.moves.length) return;
    S.ply++;
    syncBoard();
    playMoveSound(S.moves[S.ply - 1]);
    q.timer = setTimeout(step, 380);
  };
  q.timer = setTimeout(step, 400);
}

function answerQuiz(id) {
  const q = S.quiz;
  if (!q || q.answered) return;
  clearTimeout(q.timer);
  q.answered = S.book.openings[id];
  const right = q.answered.id === q.o.id;
  q.total++;
  if (right) {
    q.score++;
    q.streak++;
    sound.good();
  } else {
    q.streak = 0;
    sound.bad();
  }
  progress.quizResult(right, q.streak);
  S.ply = S.moves.length;
  render();
}

function quizPanel() {
  const q = S.quiz;
  if (!q) return '';
  const stats = progress.quiz();
  const diffSel = `<div class="seg" data-quiz-diff><button data-v="popular" class="${S.quizDifficulty === 'popular' ? 'active' : ''}">Popular</button><button data-v="hard" class="${S.quizDifficulty === 'hard' ? 'active' : ''}">Variations</button><button data-v="all" class="${S.quizDifficulty === 'all' ? 'active' : ''}">All 3,800+</button></div>`;
  const opts = q.options
    .map(o => {
      let cls = '';
      if (q.answered) {
        if (o.id === q.o.id) cls = 'right';
        else if (o.id === q.answered.id) cls = 'wrong';
      }
      return `<button data-quiz="${o.id}" class="${cls}" ${q.answered ? 'disabled' : ''}>${nameHtml(o)}</button>`;
    })
    .join('');
  let after = '';
  if (q.answered) {
    const right = q.answered.id === q.o.id;
    after = `<div class="feedback ${right ? 'good' : 'bad'}">${right ? '<b>Correct!</b>' : `<b>Not quite.</b> It was the <b>${esc(q.o.name)}</b>.`} <span class="muted">${esc(formatSans(q.o.sans))}</span></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="nextquiz">Next ▶</button><button class="btn" data-learn="${q.o.id}">Learn this opening</button></div>`;
  }
  return (
    card('Name that opening', `<p class="small muted">Watch the moves, then pick the opening's name.</p><div class="quiz-opts">${opts}</div>${after}`) +
    card('Score', `<div class="stats"><div><strong>${q.score}/${q.total}</strong><small>Session</small></div><div><strong>${q.streak}</strong><small>Streak</small></div><div><strong>${stats.best}</strong><small>Best streak</small></div></div><div class="row" style="margin-top:10px">${diffSel}</div>`)
  );
}

// ---------------------------------------------------------------- side list

function opItem(o, basePlies = 0) {
  const m = progress.mastery(o.key);
  const due = progress.isDue(o.key);
  const cur = S.opening && S.opening.id === o.id ? ' current' : '';
  return `<button class="op${cur}" data-op="${o.id}"><span class="op-name">${m >= 0 ? `<i class="dot m${m}" title="${MASTERY_LABELS[m]}"></i>` : ''}${nameHtml(o)}${due ? '<span class="due-tag">due</span>' : ''}</span><span class="op-eco">${o.eco}</span><span class="op-moves">${esc(formatSans(o.sans))}</span></button>`;
}

function renderSide() {
  const el = $('sideList');
  if (!S.book) return;
  let html = '';
  if (S.query) {
    const res = S.book.search(S.query);
    html = res.length
      ? `<h3>${res.length >= 120 ? 'Top 120 matches' : res.length + ' match' + (res.length === 1 ? '' : 'es')}</h3>` + res.map(o => opItem(o)).join('')
      : `<div class="hint">No openings found. Try a name (<i>najdorf</i>), an ECO code (<i>B90</i>) or moves (<i>e4 c5 Nf3</i>).</div>`;
  } else if (S.sideTab === 'popular') {
    html = POPULAR.map(g => `<h3>${esc(g.group)}</h3>` + g.names.map(n => S.book.byName(n)).filter(Boolean).map(o => opItem(o)).join('')).join('');
    html += `<div class="hint">Showing a starter list. All <b>${S.book.openings.length.toLocaleString()}</b> named openings are searchable above or browsable in <b>A–Z</b>.</div>`;
  } else if (S.sideTab === 'families') {
    if (S.family) {
      const list = S.book.openings.filter(o => o.family === S.family).sort((a, b) => a.plies - b.plies || a.name.localeCompare(b.name));
      html = `<button class="op" data-back="1"><span class="op-name">‹ All families</span></button><h3>${esc(S.family)} · ${list.length}</h3>` + list.map(o => opItem(o)).join('');
    } else {
      html =
        `<h3>${S.book.families().length} opening families</h3>` +
        S.book
          .families()
          .map(f => `<button class="op" data-family="${esc(f.name)}"><span class="op-name">${esc(f.name)}</span><span class="op-count">${f.count}</span><span class="op-moves">${esc(formatSans(f.root.sans))}</span></button>`)
          .join('');
    }
  } else {
    const due = progress.due().map(l => S.book.byKey.get(l.key)).filter(Boolean);
    const favs = progress.favs().map(k => S.book.byKey.get(k)).filter(Boolean);
    const practiced = progress
      .practiced()
      .sort((a, b) => b.last - a.last)
      .map(l => S.book.byKey.get(l.key))
      .filter(Boolean);
    if (due.length) html += `<h3>Due for review · ${due.length}</h3>` + due.map(o => opItem(o)).join('');
    html += `<h3>Favourites · ${favs.length}</h3>` + (favs.length ? favs.map(o => opItem(o)).join('') : '<div class="hint">Tap the ☆ next to an opening\'s name to save it here — build your own repertoire.</div>');
    html += `<h3>Practised · ${practiced.length}</h3>` + (practiced.length ? practiced.map(o => opItem(o)).join('') : '<div class="hint">Lines you drill in Practice mode appear here with their mastery level.</div>');
  }
  el.innerHTML = html;
}

// ---------------------------------------------------------------- actions

function randomPopular() {
  const names = POPULAR.flatMap(g => g.names);
  const base = S.book.byName(names[Math.floor(Math.random() * names.length)]);
  const vars = S.book.variationsOf(base).filter(v => v.plies <= 14);
  return Math.random() < 0.5 || !vars.length ? base : vars[Math.floor(Math.random() * vars.length)];
}

function selectOpening(o, mode) {
  if (!o) return;
  stopAuto();
  banner(null);
  closeDrawer();
  S.showAllVars = false;
  if (mode && mode !== S.mode) setMode(mode, { silent: true });
  else if (S.mode === 'quiz') setMode('learn', { silent: true });
  S.opening = o;
  S.bookSans = o.sans;
  if (S.mode === 'practice') {
    startPractice(o);
  } else if (S.mode === 'explore') {
    S.moves = buildMoves(o.sans);
    S.ply = S.moves.length;
    render();
  } else if (S.mode === 'play') {
    S.play = null;
    S.moves = buildMoves(o.sans);
    S.ply = S.moves.length;
    S.playSetup.color = sideFor(o);
    S.orientation = sideFor(o);
    render();
  } else {
    S.moves = buildMoves(o.sans);
    S.orientation = sideFor(o);
    S.ply = 0;
    render();
  }
  updateHash();
  renderSide();
  $('panel').scrollTop = 0;
}

function setMode(mode, { silent = false } = {}) {
  if (!MODES.includes(mode)) return;
  stopAuto();
  banner(null);
  const prev = S.mode;
  S.mode = mode;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (prev === 'play' && player) player.stop();
  if (prev === 'quiz' && S.quiz) clearTimeout(S.quiz.timer);
  S.practice = null;
  S.play = null;
  if (prev === 'quiz') {
    // keep the quiz position as an explorable line
    S.opening = null;
    S.bookSans = [];
  }
  if (silent) return;
  if (mode === 'practice') {
    if (S.opening) return startPractice(S.opening);
    S.moves = [];
    S.ply = 0;
  } else if (mode === 'quiz') {
    return newQuiz();
  } else if (mode === 'learn' && S.opening) {
    if (devIndex() < S.bookSans.length || S.moves.length !== S.bookSans.length) {
      const keep = Math.min(S.ply, devIndex());
      S.moves = buildMoves(S.bookSans);
      S.ply = keep;
    }
  }
  render();
  updateHash();
}

function startAuto() {
  if (S.auto) return stopAuto();
  if (S.ply >= S.moves.length) return;
  S.auto = setInterval(() => {
    if (S.ply >= S.moves.length) return stopAuto();
    goTo(S.ply + 1);
    if (S.ply >= S.moves.length) stopAuto();
  }, 1800);
  goTo(S.ply + 1);
}

function stopAuto() {
  if (S.auto) clearInterval(S.auto);
  S.auto = null;
  if ($('btnAuto')) $('btnAuto').classList.remove('on');
}

function playUci(uci) {
  const m = moveFromUci(fenAt(S.ply), uci);
  if (!m) return;
  if (S.mode === 'practice') return practiceMove(m);
  if (S.mode === 'play' && S.play) {
    if (canMove(new Chess(fenAt(S.ply)))) gameMove(m);
    return;
  }
  if (S.mode === 'quiz') return;
  freeMove(m);
}

function toggleEngine() {
  S.engineOn = !S.engineOn;
  progress.set('engineOn', S.engineOn);
  if (!S.engineOn) analysis.stop();
  S.evalFen = null;
  requestEval();
  drawShapes();
  renderPanel.keepScroll = true;
  renderPanel();
}

function toggleFav(id) {
  const o = S.book.openings[id];
  const on = progress.toggleFav(o.key);
  toast(on ? `Saved "${o.name}" to My lines` : 'Removed from My lines');
  renderTitle();
  renderSide();
}

function closeDrawer() {
  document.body.classList.remove('drawer');
}

// ---------------------------------------------------------------- hash

function updateHash() {
  const key = S.opening && S.mode !== 'quiz' ? '/' + S.opening.ucis.join('-') : '';
  try {
    history.replaceState(null, '', '#' + S.mode + key);
  } catch (e) {
    /* sandboxed */
  }
}

function applyHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return false;
  const [mode, line] = h.split('/');
  const o = line ? S.book.byKey.get(line.split('-').join(' ')) : null;
  if (!MODES.includes(mode)) return false;
  if (o) {
    setMode(mode, { silent: true });
    selectOpening(o);
  } else setMode(mode);
  return true;
}

// ---------------------------------------------------------------- settings

function applySettings() {
  const s = S.settings;
  document.body.classList.toggle('light', s.theme === 'light');
  document.body.classList.remove('board-brown', 'board-blue', 'board-green', 'board-grey');
  document.body.classList.add('board-' + s.board);
  sound.setEnabled(s.sound === 'on');
  document.querySelectorAll('#settings .seg').forEach(seg => {
    const v = s[seg.dataset.setting];
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === String(v)));
  });
}

// ---------------------------------------------------------------- events

function bindEvents() {
  $('modes').addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (b) {
      sound.unlock();
      setMode(b.dataset.mode);
    }
  });
  $('btnFirst').onclick = () => nav('first');
  $('btnPrev').onclick = () => nav(-1);
  $('btnNext').onclick = () => nav(1);
  $('btnLast').onclick = () => nav('last');
  $('btnFlip').onclick = flip;
  $('btnAuto').onclick = () => {
    sound.unlock();
    if (navAllowed()) startAuto();
  };
  $('engineToggle').addEventListener('change', toggleEngine);
  $('brand').addEventListener('click', e => {
    e.preventDefault();
    S.opening = null;
    S.bookSans = [];
    S.moves = [];
    S.ply = 0;
    setMode('learn', { silent: true });
    S.mode = 'learn';
    render();
    renderSide();
    updateHash();
  });

  $('menuBtn').onclick = () => document.body.classList.toggle('drawer');
  $('scrim').onclick = closeDrawer;

  let searchTimer;
  $('search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      S.query = e.target.value.trim();
      renderSide();
      $('sideList').scrollTop = 0;
    }, 110);
  });
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = $('sideList').querySelector('[data-op]');
      if (first) selectOpening(S.book.openings[Number(first.dataset.op)]);
    }
  });
  $('sideTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    S.sideTab = b.dataset.tab;
    S.query = '';
    $('search').value = '';
    document.querySelectorAll('#sideTabs button').forEach(x => x.classList.toggle('active', x === b));
    renderSide();
    $('sideList').scrollTop = 0;
  });
  $('sideList').addEventListener('click', e => {
    const op = e.target.closest('[data-op]');
    if (op) return selectOpening(S.book.openings[Number(op.dataset.op)]);
    const fam = e.target.closest('[data-family]');
    if (fam) {
      S.family = fam.dataset.family;
      renderSide();
      $('sideList').scrollTop = 0;
      return;
    }
    if (e.target.closest('[data-back]')) {
      S.family = null;
      renderSide();
    }
  });

  $('moves').addEventListener('click', e => {
    const mv = e.target.closest('[data-ply]');
    if (mv && navAllowed()) {
      stopAuto();
      goTo(Number(mv.dataset.ply), { silent: true });
    }
  });
  $('pvs').addEventListener('click', e => {
    const pv = e.target.closest('[data-pv]');
    if (!pv) return;
    const line = S.lines[Number(pv.dataset.pv)];
    if (line && S.linesFen === fenAt(S.ply)) playUci(line.pv[0]);
  });
  $('openingBar').addEventListener('click', e => {
    const s = e.target.closest('[data-fav]');
    if (s) toggleFav(Number(s.dataset.fav));
  });

  $('panel').addEventListener('click', e => {
    const t = e.target;
    const op = t.closest('[data-op]');
    if (op) return selectOpening(S.book.openings[Number(op.dataset.op)]);
    const row = t.closest('[data-uci]');
    if (row) return playUci(row.dataset.uci);
    const learn = t.closest('[data-learn]');
    if (learn) return selectOpening(S.book.openings[Number(learn.dataset.learn)], 'learn');
    const prac = t.closest('[data-practice]');
    if (prac) return selectOpening(S.book.openings[Number(prac.dataset.practice)], 'practice');
    const qz = t.closest('[data-quiz]');
    if (qz) return answerQuiz(Number(qz.dataset.quiz));
    const segBtn = t.closest('.seg button, .levels button');
    if (segBtn) {
      const seg = segBtn.parentElement;
      const v = segBtn.dataset.v;
      if (seg.hasAttribute('data-practice-color')) return startPractice(S.opening, v);
      if (seg.hasAttribute('data-play-color')) {
        S.playSetup.color = v;
        renderPanel.keepScroll = true;
        return renderPanel();
      }
      if (seg.hasAttribute('data-levels')) {
        S.playSetup.level = Number(v);
        renderPanel.keepScroll = true;
        return renderPanel();
      }
      if (seg.hasAttribute('data-quiz-diff')) {
        S.quizDifficulty = v;
        progress.set('quizDifficulty', v);
        return newQuiz();
      }
    }
    const act = t.closest('[data-act]');
    if (!act) return;
    sound.unlock();
    switch (act.dataset.act) {
      case 'next':
        return nav(1);
      case 'practice':
        return S.mode === 'practice' ? startPractice(S.opening, S.practice && S.practice.color) : selectOpening(S.opening, 'practice');
      case 'learn':
        return selectOpening(S.opening, 'learn');
      case 'explore':
        setMode('explore', { silent: true });
        return render();
      case 'playon': {
        const moves = S.moves.slice(0, S.mode === 'practice' ? S.moves.length : S.ply);
        const color = S.practice ? S.practice.color : S.opening ? sideFor(S.opening) : 'white';
        setMode('play', { silent: true });
        S.moves = moves;
        S.ply = moves.length;
        S.playSetup.color = color;
        return startGame();
      }
      case 'backtoline': {
        const dev = devIndex();
        S.moves = buildMoves(S.bookSans);
        return goTo(dev, { silent: true });
      }
      case 'allvars':
        S.showAllVars = true;
        renderPanel.keepScroll = true;
        return renderPanel();
      case 'start-italian':
        return selectOpening(S.book.byName('Italian Game'));
      case 'random':
        return selectOpening(randomPopular());
      case 'random-practice':
        return startPractice(randomPopular());
      case 'next-due':
        return nextDue();
      case 'hint':
        return practiceHint();
      case 'show':
        return practiceShow();
      case 'startgame':
        return startGame();
      case 'startgame-fresh':
        return startGame(true);
      case 'rematch': {
        const G = S.play;
        S.moves = S.moves.slice(0, G.startPly);
        S.ply = G.startPly;
        return startGame();
      }
      case 'takeback':
        return takeback();
      case 'resign': {
        const G = S.play;
        if (!G || G.over) return;
        if (player) player.stop();
        G.over = 'You resigned.';
        G.result = 'loss';
        G.thinking = false;
        return render();
      }
      case 'analyse':
        setMode('explore', { silent: true });
        return render();
      case 'newsetup':
        S.play = null;
        return render();
      case 'nextquiz':
        return newQuiz();
    }
  });

  // settings
  $('settingsBtn').onclick = () => $('settings').classList.remove('hidden');
  $('settings').addEventListener('click', e => {
    if (e.target === $('settings') || e.target.closest('[data-close]')) return $('settings').classList.add('hidden');
    const b = e.target.closest('.seg button');
    if (b) {
      const key = b.parentElement.dataset.setting;
      S.settings[key] = b.dataset.v;
      progress.set(key, b.dataset.v);
      applySettings();
      if (key === 'depth' || key === 'multipv') {
        S.evalFen = null;
        requestEval(true);
      }
      drawShapes();
      renderCeval();
    }
  });
  // Two-step confirmation (no confirm() dialog: some embedded views block it).
  let resetArmed = null;
  $('resetProgress').onclick = () => {
    const btn = $('resetProgress');
    if (!resetArmed) {
      btn.textContent = 'Click again to erase everything';
      resetArmed = setTimeout(() => {
        resetArmed = null;
        btn.textContent = 'Reset all progress';
      }, 4000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    btn.textContent = 'Reset all progress';
    progress.reset();
    renderSide();
    renderPanel();
    toast('Progress, favourites and quiz stats erased');
  };

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const keys = {
      ArrowLeft: () => nav(-1),
      ArrowRight: () => nav(1),
      ArrowUp: () => nav('first'),
      Home: () => nav('first'),
      ArrowDown: () => nav('last'),
      End: () => nav('last'),
      f: flip,
      e: toggleEngine,
      h: practiceHint,
      ' ': () => (S.mode === 'learn' ? startAuto() : null),
      '/': () => {
        document.body.classList.add('drawer');
        $('search').focus();
      },
      Escape: () => {
        closeDrawer();
        $('settings').classList.add('hidden');
      },
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
  window.addEventListener('hashchange', () => {
    const want = location.hash.slice(1);
    const have = S.mode + (S.opening && S.mode !== 'quiz' ? '/' + S.opening.ucis.join('-') : '');
    if (want && want !== have) applyHash();
  });
}

// ---------------------------------------------------------------- boot

async function boot() {
  applySettings();
  bindEvents();
  renderCeval();
  try {
    S.book = await Book.load(new URL('../data/openings.json', import.meta.url).href);
  } catch (err) {
    $('sideList').innerHTML = `<div class="hint">Could not load the opening database. Serve this folder over http (for example <code>python3 -m http.server</code>) and reload.<br><br>${esc(err.message)}</div>`;
    return;
  }
  $('search').placeholder = `Search ${S.book.openings.length.toLocaleString()} openings…`;
  renderSide();
  if (!applyHash()) render();
  window.__trainer = { S, book: S.book, selectOpening, setMode };
}

// ---------------------------------------------------------------- install (PWA)

function setupInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('installText').innerHTML = standalone
    ? 'Already installed — you are using the app.'
    : ios
      ? 'On iPhone/iPad: open this page in <b>Safari</b>, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.'
      : 'Use the green <b>Install app</b> button at the top, or your browser menu → <b>Install app</b> / <b>Add to Home screen</b>. Once installed it works offline.';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  }
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    $('installBtn').classList.remove('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    $('installBtn').classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    $('installBtn').classList.add('hidden');
    toast('Installed! Open Opening Trainer from your home screen or app list.');
  });
}

setupInstall();

boot();
