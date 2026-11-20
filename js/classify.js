// Move quality labels (Brilliant, Great, Best … Blunder), computed from how
// much of the mover's winning chance a move gives away compared with
// Stockfish's best move. Win chance uses the same logistic curve as lichess;
// thresholds are on the usual "expected points" scale (2% = 0.02 points).
import { Chess } from '../vendor/chessjs/chess.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export const CLASSES = {
  brilliant: { label: 'Brilliant', short: '!!', color: '#1baaa6', text: 'A brilliant sacrifice: it gives up material, and it is still one of the best moves on the board.' },
  great: { label: 'Great move', short: '!', color: '#5c8bb0', text: 'The only good move here. Every alternative is clearly worse.' },
  best: { label: 'Best move', short: '★', color: '#81b64c', text: 'Stockfish’s top choice.' },
  excellent: { label: 'Excellent', short: '👍', color: '#96bc4b', text: 'Practically as good as the best move.' },
  good: { label: 'Good', short: '✓', color: '#95ad84', text: 'A solid move, a little weaker than the best.' },
  book: { label: 'Book', short: '📖', color: '#a88865', text: 'A known opening move from the book.' },
  inaccuracy: { label: 'Inaccuracy', short: '?!', color: '#e9b931', text: 'Not the best — it gives away part of the advantage.' },
  mistake: { label: 'Mistake', short: '?', color: '#e6912c', text: 'A clear mistake that hands the opponent real chances.' },
  miss: { label: 'Miss', short: '✕', color: '#ee6b55', text: 'A missed opportunity: there was a much stronger move that would have been winning.' },
  blunder: { label: 'Blunder', short: '??', color: '#ca3431', text: 'A serious error that changes the result of the position.' },
};

export const CLASS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

// 100x100 symbol drawn on a coloured disc.
function symbol(key) {
  const txt = (t, size = 54) =>
    `<text x="50" y="${50 + size * 0.36}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" fill="#fff">${t}</text>`;
  switch (key) {
    case 'brilliant':
      return txt('!!', 50);
    case 'great':
      return txt('!', 58);
    case 'inaccuracy':
      return txt('?!', 48);
    case 'mistake':
      return txt('?', 58);
    case 'blunder':
      return txt('??', 48);
    case 'best':
      return '<path fill="#fff" d="M50 17l10 20.4 22.5 3.3-16.3 15.9 3.9 22.4L50 68.4 29.9 79l3.9-22.4L17.5 40.7 40 37.4z"/>';
    case 'excellent':
      return '<path fill="#fff" d="M24 46h12v31H24zM40 77V47l12-23c2-4 9-3 9 3l-2 14h15c5 0 8 4 7 9l-4 19c-1 5-4 8-9 8z"/>';
    case 'good':
      return '<path d="M28 52l15 15 30-32" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
    case 'book':
      return '<path fill="#fff" d="M20 31c10-4 21-3 28 3v42c-7-6-18-7-28-3zM80 31c-10-4-21-3-28 3v42c7-6 18-7 28-3z"/>';
    case 'miss':
      return '<path d="M33 33l34 34M67 33L33 67" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/>';
    default:
      return '';
  }
}

export function glyphInner(key) {
  const c = CLASSES[key];
  return `<circle cx="50" cy="50" r="48" fill="${c.color}" stroke="#fff" stroke-width="5"/>${symbol(key)}`;
}

// Small inline icon for lists and badges.
export function glyphIcon(key, cls = 'nag') {
  const c = CLASSES[key];
  return `<svg class="${cls}" viewBox="0 0 100 100" role="img" aria-label="${c.label}"><title>${c.label}</title>${glyphInner(key)}</svg>`;
}

// Glyph in the top-right corner of a board square (chessground customSvg).
export function boardGlyph(key) {
  return `<g transform="translate(66 -14) scale(0.44)" opacity="0.98">${glyphInner(key)}</g>`;
}

// White's winning chance (0..100) for an engine line with a White-POV score.
export function winChance(line) {
  if (!line) return 50;
  if (line.mate !== null && line.mate !== undefined) return line.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * line.cp)) - 1);
}

const forColor = (w, color) => (color === 'w' ? w : 100 - w);

// Is this a real piece sacrifice? (The moved piece can be taken and the
// exchange on that square loses at least two pawns' worth of material.)
export function isSacrifice(move) {
  if (move.piece === 'p' || move.piece === 'k' || move.promotion) return false;
  const after = new Chess(move.after);
  const them = move.color === 'w' ? 'b' : 'w';
  const defenders = after.attackers(move.to, move.color);
  let attackers = after.attackers(move.to, them).map(sq => after.get(sq).type);
  if (defenders.length) attackers = attackers.filter(t => t !== 'k');
  if (!attackers.length) return false;
  const lowest = Math.min(...attackers.map(t => VALUE[t]));
  const gained = move.captured ? VALUE[move.captured] : 0;
  const net = gained - VALUE[move.piece] + (defenders.length ? lowest : 0);
  return net <= -2;
}

/**
 * move: chess.js Move. before: engine lines for the position before the move
 * (best first, White POV). after: lines for the position after (may be null).
 * Returns null when there isn't enough engine data yet.
 */
export function classifyMove(move, before, after, ctx = {}) {
  if (!before || !before.length) return null;
  const uci = move.from + move.to + (move.promotion || '');
  const color = move.color;
  const afterPos = new Chess(move.after);
  const beforePos = new Chess(move.before);
  const best = before[0];
  const bestWin = forColor(winChance(best), color);
  const rank = before.findIndex(l => l.pv[0] === uci);
  let moveWin = null;
  if (afterPos.isCheckmate()) moveWin = 100;
  else if (afterPos.isStalemate() || afterPos.isInsufficientMaterial()) moveWin = 50;
  else if (rank >= 0) moveWin = forColor(winChance(before[rank]), color);
  else if (after && after.length) moveWin = forColor(winChance(after[0]), color);
  if (moveWin === null) return null;

  const loss = Math.max(0, bestWin - moveWin);
  const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
  const legal = beforePos.moves().length;
  const second = before[1];
  const gap = second ? bestWin - forColor(winChance(second), color) : 0;
  const prev = ctx.prevMove;
  const recapture = !!(prev && prev.captured && prev.to === move.to);

  let key;
  if (legal > 1 && loss <= 2 && moveWin >= 50 && bestWin < 97 && isSacrifice(move)) key = 'brilliant';
  else if (legal > 1 && rank === 0 && second && gap >= 10 && bestWin >= 30 && bestWin < 95 && !recapture) key = 'great';
  else if (rank === 0 || loss <= 0.5) key = 'best';
  else if (loss < 2) key = 'excellent';
  else if (loss < 5) key = 'good';
  else if (loss >= 10 && bestWin >= 75 && moveWin >= 45) key = 'miss';
  else if (loss < 10) key = 'inaccuracy';
  else if (loss < 20) key = 'mistake';
  else key = 'blunder';
  return { key, loss, accuracy, bestWin, moveWin, rank, bestUci: best.pv[0] };
}
