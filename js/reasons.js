// Explains *why* a move got its label, using Stockfish's lines: what the
// opponent's best answer does to the played move (mate, lost material, a
// fork…), and what the best move would have achieved instead.
import { Chess } from '../vendor/chessjs/chess.js';
import { explainMove } from './explain.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PLURAL = { p: 'pawns', n: 'knights', b: 'bishops', r: 'rooks', q: 'queens' };
const WORDS = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const BAD = ['inaccuracy', 'mistake', 'blunder', 'miss'];

const side = c => (c === 'w' ? 'White' : 'Black');
const other = c => (c === 'w' ? 'b' : 'w');
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
const join = arr => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);

// Play a list of UCI moves from a FEN; returns chess.js Move objects.
export function playLine(fen, pv, max = 10) {
  const c = new Chess(fen);
  const out = [];
  for (const u of (pv || []).slice(0, max)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
    } catch (e) {
      break;
    }
  }
  return out;
}

export function formatMoves(moves) {
  return moves
    .map((m, i) => {
      const n = Number(m.before.split(' ')[5]);
      if (m.color === 'w') return `${n}.${m.san}`;
      return i === 0 ? `${n}…${m.san}` : m.san;
    })
    .join(' ');
}

const moveLabel = m => formatMoves([m]);

// What happens to `color` along a line: material won or lost up to the first
// quiet moment (no capture or check next), or checkmate.
function outcome(moves, color) {
  let k = moves.length;
  let mate = null;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.san.includes('#')) {
      mate = m.color;
      k = i + 1;
      break;
    }
    const next = moves[i + 1];
    if (i >= 1 && !m.san.includes('+') && (!next || !next.captured)) {
      k = i + 1;
      break;
    }
  }
  const tally = n => {
    const gained = [];
    const lost = [];
    for (const m of moves.slice(0, n)) {
      const mine = m.color === color;
      if (m.captured) (mine ? gained : lost).push(m.captured);
      if (m.promotion) (mine ? gained : lost).push('promo:' + m.promotion);
    }
    const val = t => (t.startsWith('promo:') ? VALUE[t.slice(6)] - 1 : VALUE[t]);
    return { gained, lost, delta: gained.reduce((s, t) => s + val(t), 0) - lost.reduce((s, t) => s + val(t), 0) };
  };
  // A material swing only counts if it still holds at the last quiet moment
  // of the whole line (so a pawn that is won back two moves later is not "won").
  let end = moves.length;
  if (!mate) {
    while (end > k && moves[end - 1] && (moves[end - 1].captured || (moves[end] && moves[end].captured))) end--;
  }
  const first = tally(k);
  const last = mate ? first : tally(end);
  let chosen = first;
  if (Math.sign(first.delta) !== Math.sign(last.delta)) chosen = { gained: [], lost: [], delta: 0 };
  else if (Math.abs(last.delta) < Math.abs(first.delta)) chosen = last;
  const { gained, lost, delta } = chosen;
  // cancel out identical captures (a knight for a knight is a trade)
  const g = gained.filter(t => !t.startsWith('promo:'));
  const l = lost.filter(t => !t.startsWith('promo:'));
  for (const t of [...g]) {
    const j = l.indexOf(t);
    if (j >= 0) {
      l.splice(j, 1);
      g.splice(g.indexOf(t), 1);
    }
  }
  return { k, mate, delta, gained: g, lost: l, promoted: gained.some(t => t.startsWith('promo:')) };
}

function pieceList(types) {
  const counts = {};
  for (const t of types) counts[t] = (counts[t] || 0) + 1;
  const order = ['q', 'r', 'b', 'n', 'p'];
  return join(order.filter(t => counts[t]).map(t => (counts[t] === 1 ? `a ${NAME[t]}` : `${WORDS[counts[t]] || counts[t]} ${PLURAL[t]}`)));
}

function materialPhrase(o, positive) {
  const minor = t => t === 'b' || t === 'n';
  if (o.gained.length === 1 && o.gained[0] === 'r' && o.lost.length === 1 && minor(o.lost[0])) return 'wins the exchange (a rook for a minor piece)';
  if (o.lost.length === 1 && o.lost[0] === 'r' && o.gained.length === 1 && minor(o.gained[0])) return 'loses the exchange (a rook for a minor piece)';
  if (positive) {
    if (o.promoted && !o.gained.length) return 'gets a new queen';
    return o.lost.length ? `wins ${pieceList(o.gained)} for ${pieceList(o.lost)}` : `wins ${pieceList(o.gained)}`;
  }
  return o.gained.length ? `gives up ${pieceList(o.lost)} for ${pieceList(o.gained)}` : `loses ${pieceList(o.lost)}`;
}

function scoreFor(line, color) {
  if (!line) return 0;
  if (line.mate !== null && line.mate !== undefined) return (line.mate > 0 ? 100 : -100) * (color === 'w' ? 1 : -1);
  return (line.cp / 100) * (color === 'w' ? 1 : -1);
}

function fmt(line, color) {
  if (!line) return '?';
  if (line.mate !== null && line.mate !== undefined) {
    const forMover = (line.mate > 0) === (color === 'w');
    return forMover ? `mate in ${Math.abs(line.mate)}` : `getting mated in ${Math.abs(line.mate)}`;
  }
  const v = scoreFor(line, color);
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

function standing(v) {
  if (v >= 3) return 'a winning position';
  if (v >= 1.2) return 'a clear advantage';
  if (v >= 0.4) return 'a small edge';
  if (v > -0.4) return 'the balance';
  if (v > -1.2) return 'a slightly worse but playable position';
  return 'a difficult position';
}

// The most telling tactical note about a move (fork, pin, attack…).
function motif(move, prev) {
  const notes = explainMove(move, { prevMove: prev });
  const hit = notes.find(n => /fork|Pins|undefended|Piles up|sacrifice|also attacks|Checkmate|tempo/.test(n.text));
  return hit ? hit.text : null;
}

// Was `refutation` already a threat before the move (if the mover had passed)?
function threatExisted(beforeFen, refutation) {
  const parts = beforeFen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try {
    const m = new Chess(parts.join(' ')).move({ from: refutation.from, to: refutation.to, promotion: refutation.promotion });
    return !!m && (!!m.captured || m.san.includes('#'));
  } catch (e) {
    return false;
  }
}

// What the best move does, in one or two sentences.
function bestIdea(bestMoves, bestLine, color, refutation, playedAfter) {
  const out = [];
  const best = bestMoves[0];
  const bo = outcome(bestMoves, color);
  if (bo.mate === color || (bestLine && bestLine.mate && scoreFor(bestLine, color) > 0)) {
    out.push(`It forces checkmate${bestLine && bestLine.mate ? ` in ${Math.abs(bestLine.mate)}` : ''}.`);
  } else if (bo.delta >= 1) {
    out.push(`It ${materialPhrase(bo, true)}.`);
  }
  // Does it stop the opponent's answer to the played move?
  if (refutation && playedAfter && threatExisted(best.before, refutation)) {
    const pos = new Chess(best.after);
    let stops = false;
    let legal = null;
    try {
      legal = pos.move({ from: refutation.from, to: refutation.to, promotion: refutation.promotion });
    } catch (e) {
      legal = null;
    }
    if (!legal) stops = true;
    else if (refutation.san.includes('#') && !legal.san.includes('#')) stops = true;
    else if (refutation.captured) {
      const before = new Chess(playedAfter).attackers(refutation.to, color).length;
      const now = new Chess(best.after).attackers(refutation.to, color).length;
      if (!legal.captured || now > before) stops = true;
    }
    if (stops) out.push(`It also stops ${esc(moveLabel(refutation))}.`);
  }
  const notes = explainMove(best, {}).filter(n => !/clears the way|rooks are now connected/i.test(n.text));
  const tactical = notes.find(n => /fork|Pins|undefended|Piles up|also attacks|tempo|Checkmate/.test(n.text));
  const pick = tactical || notes[0];
  if (pick && out.length < 2) out.push(pick.text.replace(/\.$/, '') + '.');
  if (!out.length) out.push(`It keeps ${standing(scoreFor(bestLine, color))} (${fmt(bestLine, color)}).`);
  return out;
}

/**
 * Builds the "why" explanation for a labelled move.
 * move: chess.js Move. label: classification key. before/after: engine lines
 * (best first, White POV) for the positions before/after the move.
 * opts.bookName: label used for the comparison move (Practice: "The book move").
 */
export function explainLabel({ move, label, before, after, opts = {} }) {
  if (!before || !before.length) return '';
  const color = move.color;
  const them = other(color);
  const uci = move.from + move.to + (move.promotion || '');
  const rank = before.findIndex(l => l.pv[0] === uci);
  const bestLine = opts.bestLine || before[0];
  const moveLine = opts.moveLine || (rank >= 0 ? before[rank] : after && after[0] ? after[0] : null);
  const movePv = opts.moveLine ? opts.moveLine.pv : rank >= 0 ? before[rank].pv : after && after[0] ? [uci, ...after[0].pv] : [uci];
  const isBest = bestLine.pv[0] === uci;
  const moveMoves = playLine(move.before, movePv, 10);
  const bestMoves = isBest ? moveMoves : playLine(move.before, bestLine.pv, 10);
  const mo = outcome(moveMoves, color);
  const reply = moveMoves[1];
  const bad = BAD.includes(label) || (opts.compare && scoreFor(bestLine, color) - scoreFor(moveLine, color) >= 0.3);
  const why = [];

  if (bad) {
    const mateAt = moveMoves.findIndex(x => x.san.includes('#') && x.color === them);
    const mated = mo.mate === them || mateAt >= 0 || (moveLine && moveLine.mate && scoreFor(moveLine, color) < 0);
    if (mated) {
      const upto = mateAt >= 0 ? moveMoves.slice(0, mateAt + 1) : moveMoves.slice(0, 6);
      why.push(`It allows a forced checkmate${moveLine && moveLine.mate ? ` (mate in ${Math.abs(moveLine.mate)})` : ''}: <span class="line">${esc(formatMoves(upto))}</span>.`);
    } else if (mo.delta <= -1 && reply) {
      const m = motif(reply, move);
      why.push(`After ${esc(moveLabel(reply))} it ${materialPhrase(mo, false)}: <span class="line">${esc(formatMoves(moveMoves.slice(0, mo.k)))}</span>.` + (m ? ` (${esc(moveLabel(reply))}: ${lowerFirst(m)})` : ''));
    } else if (label === 'miss') {
      why.push(`Nothing is lost right away, but it lets a winning chance slip: the evaluation goes from ${fmt(bestLine, color)} to ${fmt(moveLine, color)}.`);
    } else if (reply) {
      const m = motif(reply, move);
      why.push(
        `It doesn't lose material at once, but ${side(them)} answers ${esc(moveLabel(reply))}${m ? ` (${lowerFirst(m).replace(/\.$/, '')})` : ''} and gets the better of it. ` +
          `Stockfish's evaluation drops from ${fmt(bestLine, color)} to ${fmt(moveLine, color)}.`
      );
    } else {
      why.push(`Stockfish's evaluation drops from ${fmt(bestLine, color)} to ${fmt(moveLine, color)}.`);
    }
  } else if (label === 'brilliant') {
    const piece = NAME[move.piece];
    const taken = reply && reply.to === move.to && reply.captured;
    const result =
      mo.mate === color ? 'it ends in checkmate' : mo.delta >= 0 ? 'the material comes back with interest' : `${side(color)} gets ${standing(scoreFor(moveLine, color))} (${fmt(moveLine, color)})`;
    why.push(
      `It sacrifices the ${piece} on ${move.to}. ` +
        (taken
          ? `If ${side(them)} takes (${esc(moveLabel(reply))})` +
            (moveMoves.length > 2 ? `, then <span class="line">${esc(formatMoves(moveMoves.slice(2, 8)))}</span> and ${result}.` : `, ${result}.`)
          : `The point: <span class="line">${esc(formatMoves(moveMoves.slice(0, 7)))}</span>, and ${result}.`)
    );
  } else if (label === 'great') {
    const second = before[1];
    const secondMove = second ? playLine(move.before, second.pv, 1)[0] : null;
    why.push(
      `It is the only move that keeps ${standing(scoreFor(bestLine, color))}` +
        (secondMove ? `: the next best, ${esc(moveLabel(secondMove))}, would drop the evaluation to ${fmt(second, color)}.` : '.')
    );
  } else {
    if (mo.mate === color) why.push(`It leads to a forced checkmate: <span class="line">${esc(formatMoves(moveMoves.slice(0, mo.k)))}</span>.`);
    else if (mo.delta >= 1) why.push(`It ${materialPhrase(mo, true)}: <span class="line">${esc(formatMoves(moveMoves.slice(0, mo.k)))}</span>.`);
    else if (label === 'book') why.push(`Known opening theory. It keeps ${standing(scoreFor(moveLine, color))} (${fmt(moveLine, color)}).`);
    else why.push(`It keeps ${standing(scoreFor(moveLine, color))} (${fmt(moveLine, color)}).`);
  }

  let html = `<div class="why"><p><b>Why:</b> ${why.join(' ')}</p>`;
  if (!isBest && bestMoves.length) {
    const ideas = bestIdea(bestMoves, bestLine, color, bad ? reply : null, move.after);
    const title = opts.bestTitle || (bad ? 'Best was' : 'Stockfish’s top choice was');
    html += `<div class="best-alt"><p><b>${title} ${esc(moveLabel(bestMoves[0]))}.</b> ${ideas.join(' ')}</p><p class="line small">Line: ${esc(formatMoves(bestMoves.slice(0, 8)))}</p></div>`;
  } else if (isBest && moveMoves.length > 1) {
    html += `<p class="line small">Stockfish's line: ${esc(formatMoves(moveMoves.slice(0, 8)))}</p>`;
  }
  return html + '</div>';
}
