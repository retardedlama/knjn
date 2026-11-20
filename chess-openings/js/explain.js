// Turns a chess.js move into plain-language coaching notes by looking at the
// board before and after the move: development, centre control, pins, forks,
// threats, gambits, castling, pawn structure and so on.
import { Chess } from '../vendor/chessjs/chess.js';

const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const CENTER = ['d4', 'e4', 'd5', 'e5'];
const FILES = 'abcdefgh';
const HOME = {
  w: { n: ['b1', 'g1'], b: ['c1', 'f1'], q: ['d1'] },
  b: { n: ['b8', 'g8'], b: ['c8', 'f8'], q: ['d8'] },
};

const sideName = c => (c === 'w' ? 'White' : 'Black');
const other = c => (c === 'w' ? 'b' : 'w');
const fileOf = sq => sq[0];
const rankOf = sq => Number(sq[1]);
const sqColor = sq => ((FILES.indexOf(sq[0]) + rankOf(sq)) % 2 === 1 ? 'dark' : 'light');
const list = arr => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
const b = s => `<b>${s}</b>`;

function squaresAttackedBy(chess, from, color) {
  const out = [];
  for (const f of FILES)
    for (let r = 1; r <= 8; r++) {
      const sq = f + r;
      if (sq !== from && chess.attackers(sq, color).includes(from)) out.push(sq);
    }
  return out;
}

function pieces(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === color) out.push(p);
  return out;
}

// Pins created by a sliding piece standing on `from`.
function pinsFrom(chess, from, piece) {
  const dirs = [];
  if (piece.type === 'b' || piece.type === 'q') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  if (piece.type === 'r' || piece.type === 'q') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
  const pins = [];
  const fx = FILES.indexOf(from[0]);
  const fy = rankOf(from);
  for (const [dx, dy] of dirs) {
    let x = fx + dx;
    let y = fy + dy;
    let first = null;
    while (x >= 0 && x < 8 && y >= 1 && y <= 8) {
      const sq = FILES[x] + y;
      const p = chess.get(sq);
      if (p) {
        if (!first) {
          if (p.color === piece.color || p.type === 'k' || p.type === 'p') break;
          first = { sq, p };
        } else {
          if (p.color !== piece.color && (p.type === 'k' || VALUE[p.type] > VALUE[first.p.type])) {
            pins.push({ pinned: first, behind: { sq, p } });
          }
          break;
        }
      }
      x += dx;
      y += dy;
    }
  }
  return pins;
}

export function explainMove(move, ctx = {}) {
  const before = new Chess(move.before);
  const after = new Chess(move.after);
  const us = move.color;
  const them = other(us);
  const piece = move.piece;
  const notes = [];
  const add = (text, kind = 'info') => notes.push({ text, kind });
  const pieceName = NAME[piece];
  const homeRank = us === 'w' ? 1 : 8;
  const moveNo = Number(move.before.split(' ')[5]);
  const castled = move.flags.includes('k') || move.flags.includes('q');

  // --- check / mate --------------------------------------------------------
  if (after.isCheckmate()) add('Checkmate! The game is over.', 'good');
  else if (before.inCheck()) add('Gets out of check.', 'warn');

  // --- castling ------------------------------------------------------------
  if (castled) {
    const king = move.flags.includes('k') ? 'kingside' : 'queenside';
    if (king === 'kingside') add(`Castles ${b('kingside')}: the king is tucked away behind its pawns and the rook moves toward the centre.`, 'good');
    else add(`Castles ${b('queenside')}: the king goes to the c-file and the rook lands on the d-file at once — an aggressive choice that often leads to sharp play.`, 'good');
    const ek = after.findPiece({ type: 'k', color: them })[0];
    if (ek) {
      const ourWing = king === 'kingside' ? 'g' : 'c';
      const theirFile = fileOf(ek);
      const opposite = ourWing === 'g' ? 'abc'.includes(theirFile) : 'fgh'.includes(theirFile);
      if (opposite) add('The kings are now on opposite wings, so both sides will race to storm the enemy king with their pawns.', 'warn');
    }
  }

  // --- captures ------------------------------------------------------------
  if (move.captured) {
    const cap = NAME[move.captured];
    const prev = ctx.prevMove;
    if (move.flags.includes('e')) {
      add(`Captures ${b('en passant')}: the pawn that just jumped two squares is taken as if it had moved only one.`);
    } else if (prev && prev.to === move.to && prev.captured) {
      add(`Recaptures on ${move.to}.`);
    } else if (move.captured === 'p' && prev && prev.to === move.to && prev.piece === 'p' && !before.attackers(move.to, them).length) {
      add(`Takes the pawn on ${move.to}, ${b(ctx.gambit ? 'accepting the gambit' : 'accepting the pawn offer')}: ${sideName(us)} grabs material now, while the opponent hopes for faster development and the initiative.`);
    } else {
      add(`Takes the ${cap} on ${move.to}.`);
    }
    const attackers = after.attackers(move.to, them);
    const defenders = after.attackers(move.to, us);
    if (attackers.length && VALUE[piece] > VALUE[move.captured] + 1 && !(prev && prev.to === move.to)) {
      const king = before.findPiece({ type: 'k', color: them })[0];
      const nearKing = king && Math.abs(FILES.indexOf(king[0]) - FILES.indexOf(move.to[0])) <= 2 && Math.abs(rankOf(king) - rankOf(move.to)) <= 2;
      if (!defenders.length || attackers.some(a => VALUE[after.get(a).type] < VALUE[piece])) {
        add(`This is a ${b('sacrifice')}: the ${pieceName} can be taken. ${nearKing ? 'The point is to rip open the enemy king.' : 'The point is to grab the initiative.'}`, 'warn');
      }
    }
    if (piece === 'b' && move.captured === 'n') {
      const bishops = before.findPiece({ type: 'b', color: us }).length;
      if (bishops === 2) add('Gives up the bishop pair for a knight. In return the opponent may have to recapture in a way that damages their pawns.');
    }
  }

  // --- pawn moves ----------------------------------------------------------
  if (piece === 'p' && !move.captured) {
    const f = fileOf(move.to);
    const r = rankOf(move.to);
    const rel = us === 'w' ? r : 9 - r; // rank from our side
    const twoStep = move.flags.includes('b');
    const fromRel = us === 'w' ? rankOf(move.from) : 9 - rankOf(move.from);
    if ((f === 'e' || f === 'd') && rel === 4) {
      const bishopHome = us === 'w' ? (f === 'e' ? 'f1' : 'c1') : f === 'e' ? 'f8' : 'c8';
      const bp = before.get(bishopHome);
      const opens = bp && bp.type === 'b' && bp.color === us;
      const shade = sqColor(bishopHome);
      add(`Puts a pawn in the ${b('centre')}, controlling ${list(squaresAttackedBy(after, move.to, us))}` +
        (opens ? ` and opening the diagonal of the ${shade}-squared bishop${f === 'e' ? ' and the queen' : ''}.` : '.'));
    } else if ((f === 'e' || f === 'd') && rel === 3) {
      const target = us === 'w' ? (f === 'e' ? 'd4' : 'e4') : f === 'e' ? 'd5' : 'e5';
      const tp = after.get(target);
      const filePawn = [2, 3].some(rr => {
        const q = after.get(target[0] + (us === 'w' ? rr : 9 - rr));
        return q && q.type === 'p' && q.color === us;
      });
      if (tp && tp.type === 'p' && tp.color === us) add(`A solid pawn move: it supports the pawn on ${target} and opens a diagonal for the bishop.`);
      else if (!filePawn) add('A solid pawn move that opens a diagonal for the bishop and covers the squares in front of it.');
      else add(`A modest, solid pawn move: it prepares ${us === 'b' ? '…' : ''}${target} and opens a diagonal for the bishop.`);
    } else if (f === 'c' && rel === 4) {
      const hit = us === 'w' ? 'd5' : 'd4';
      add(`Hits the centre from the side: the c-pawn fights for ${b(hit)} while the d-pawn stays flexible. It also gains space on the queenside.`);
    } else if (f === 'c' && rel === 3) {
      const dsq = us === 'w' ? 'd4' : 'd5';
      const dp = after.get(dsq);
      if (dp && dp.type === 'p' && dp.color === us) add(`Reinforces the pawn on ${dsq}: if it is exchanged, ${sideName(us)} can recapture with a pawn and keep a pawn in the centre.`);
      else add(`Prepares ${us === 'w' ? 'd4' : '…d5'} with pawn support, so a pawn exchange in the centre can be answered by recapturing with a pawn.`);
    } else if (f === 'f' && rel === 4 && twoStep) {
      add(`An ambitious flank thrust: it hits ${us === 'w' ? 'e5' : 'e4'} and may open the f-file for the rook, but it also loosens the king's position.`, 'warn');
    } else if (f === 'f' && rel === 3) {
      add(`Supports the centre and controls ${us === 'w' ? 'e4 and g4' : 'e5 and g5'}, at the cost of weakening the king's diagonal and taking the knight's best square.`);
    } else if ((f === 'g' || f === 'b') && rel === 3) {
      const sq = (f === 'g' ? 'g' : 'b') + (us === 'w' ? '2' : '7');
      add(`Prepares a ${b('fianchetto')}: the bishop will go to ${sq}, where it rakes the long diagonal toward the centre.`);
    } else if (f === 'h' && rel === 3) {
      const covers = 'g' + (us === 'w' ? '4' : '5');
      add(`A useful prophylactic move: it takes ${b(covers)} away from enemy pieces (no annoying pin with a bishop there) and gives the king an escape square later.`);
    } else if (f === 'a' && rel === 3) {
      const covers = 'b' + (us === 'w' ? '4' : '5');
      add(`A useful prophylactic move: it takes ${b(covers)} away from enemy pieces and prepares to expand with ${us === 'w' ? 'b4' : '…b5'}.`);
    } else if ((f === 'g' || f === 'h') && rel >= 4 && twoStep) {
      add(`An aggressive pawn storm on the kingside, grabbing space and preparing to attack — it also weakens its own king's cover.`, 'warn');
    } else if ((f === 'a' || f === 'b') && rel >= 4) {
      add('Gains space on the queenside and prepares to undermine the opponent there.');
    } else if (rel >= 5 && fromRel >= 4) {
      add(`Advances to gain ${b('space')} and cramp the opponent: the pawn on ${move.to} takes squares away from the enemy pieces.`);
    } else if (twoStep) {
      add(`Pushes the ${f}-pawn two squares to grab space.`);
    } else {
      add(`Moves the ${f}-pawn forward one square.`);
    }
    // Offering a pawn?
    const attackers = after.attackers(move.to, them);
    const defenders = after.attackers(move.to, us);
    if (attackers.length && attackers.length > defenders.length) {
      add(`It ${b('offers the pawn')}: if it is taken, ${sideName(us)} plans to use the time for development, central control or an attack.`, 'warn');
    }
  }

  // --- piece moves ---------------------------------------------------------
  if (piece !== 'p' && piece !== 'k') {
    const firstTime = (HOME[us][piece] || []).includes(move.from);
    const center = CENTER.filter(sq => after.attackers(sq, us).includes(move.to));
    if ((piece === 'n' || piece === 'b') && firstTime) {
      if (piece === 'n') {
        const rim = 'ah'.includes(fileOf(move.to));
        if (rim) add(`Develops the knight to the ${b('rim')}: it controls fewer squares there, so it is usually heading somewhere specific or keeping a pawn free to move.`);
        else add(`${b('Develops')} the knight toward the centre${center.length ? `, where it controls ${list(center)}` : ''}.`, 'good');
        const cPawn = us === 'w' ? 'c2' : 'c7';
        const cp = after.get(cPawn);
        if ((move.to === 'c3' || move.to === 'c6') && cp && cp.type === 'p' && cp.color === us) {
          add(`The knight now blocks the c-pawn, so ${us === 'w' ? 'c4' : '…c5'} is off the table for the moment.`);
        }
      } else {
        const fianchetto = ['g2', 'b2', 'g7', 'b7'].includes(move.to);
        if (fianchetto) add(`${b('Fianchettoes')} the bishop: from ${move.to} it controls the long diagonal${center.length ? ` and the centre (${list(center)})` : ''}.`, 'good');
        else {
          const target = us === 'w' ? 'f7' : 'f2';
          const hitsF7 = squaresAttackedBy(after, move.to, us).includes(target) || xrays(after, move.to, target);
          if (hitsF7) add(`${b('Develops')} the bishop to an active diagonal aimed at ${b(target)} — the weakest square near the enemy king, defended only by the king.`, 'good');
          else add(`${b('Develops')} the bishop${center.length ? `, eyeing ${list(center)}` : ''}.`, 'good');
        }
      }
    } else if (piece === 'q' && firstTime && moveNo <= 8 && (us === 'w' ? rankOf(move.to) : 9 - rankOf(move.to)) >= 3) {
      add(`Brings the ${b('queen')} out early. She is active, but the opponent may gain time by developing pieces with attacks on her.`, 'warn');
    } else if (piece === 'q' && firstTime && !move.captured) {
      add(`Develops the queen to ${move.to}, where she supports the other pieces without being exposed.`);
    } else if (piece === 'r') {
      const f = fileOf(move.to);
      let own = 0, theirs = 0;
      for (let r = 1; r <= 8; r++) {
        const p = after.get(f + r);
        if (p && p.type === 'p') p.color === us ? own++ : theirs++;
      }
      if (!own && !theirs) add(`Puts the rook on the ${b('open ' + f + '-file')}, where it can invade.`, 'good');
      else if (!own) add(`Puts the rook on the ${b('half-open ' + f + '-file')}, pressing against the enemy pawn.`, 'good');
      else if (f === 'e' || f === 'd') add(`Supports the ${f}-pawn and the centre from behind.`);
      else add(`Repositions the rook to ${move.to}.`);
    } else if (!move.captured) {
      if (before.attackers(move.from, them).length) add(`Moves the attacked ${pieceName} to safety on ${move.to}.`);
      else add(`Repositions the ${pieceName} to ${move.to}${center.length ? `, increasing control of ${list(center)}` : ''}.`);
    }
  }

  if (piece === 'k' && !castled) {
    const rights = before.getCastlingRights(us);
    if (rights.k || rights.q) add('Moves the king and gives up the right to castle.', 'warn');
    else add(`Moves the king to ${move.to}.`);
  }

  // --- tactics after the move ----------------------------------------------
  const moved = after.get(move.to);
  if (moved) {
    // attacks on enemy pieces
    const targets = [];
    const pressure = [];
    const hits = squaresAttackedBy(after, move.to, us);
    for (const sq of hits) {
      const p = after.get(sq);
      if (!p || p.color !== them || p.type === 'k') continue;
      const att = after.attackers(sq, us).length;
      const def = after.attackers(sq, them).length;
      if (VALUE[p.type] > VALUE[moved.type] || def === 0) targets.push({ sq, p, defended: def > 0 });
      else if (att > def) targets.push({ sq, p, defended: true, outnumbered: [att, def] });
      else if (p.type === 'p' && CENTER.includes(sq) && att >= 2) pressure.push({ sq, att });
    }
    targets.sort((x, y) => VALUE[y.p.type] - VALUE[x.p.type]);
    const forkable = targets.filter(t => t.p.type !== 'p');
    if (after.inCheck() && targets.length) {
      add(`Check — and it also attacks the ${NAME[targets[0].p.type]} on ${targets[0].sq}!`, 'good');
    } else if (forkable.length >= 2) {
      add(`A ${b('fork')}: it attacks the ${NAME[targets[0].p.type]} on ${targets[0].sq} and the ${NAME[targets[1].p.type]} on ${targets[1].sq} at once.`, 'good');
    } else if (targets.length) {
      const t = targets[0];
      if (moved.type === 'p' && t.p.type !== 'p') add(`The pawn attacks the ${NAME[t.p.type]} on ${t.sq}, which must move — ${sideName(us)} gains a ${b('tempo')}.`, 'good');
      else if (t.outnumbered) add(`Piles up on the ${NAME[t.p.type]} on ${t.sq}: it is now attacked ${t.outnumbered[0]} times and defended only ${t.outnumbered[1] === 1 ? 'once' : t.outnumbered[1] + ' times'}, so there is a ${b('threat')} to capture it.`, 'good');
      else if (!t.defended) add(`Attacks the undefended ${NAME[t.p.type]} on ${t.sq}.`, 'good');
      else add(`Attacks the ${NAME[t.p.type]} on ${t.sq}, a more valuable piece.`, 'good');
    } else if (after.inCheck()) {
      add(`Gives ${b('check')}.`);
    } else if (pressure.length) {
      add(`Adds pressure to the central pawn on ${pressure[0].sq} (now attacked ${pressure[0].att} times).`);
    }

    // attacking a defender
    if (!targets.length && moved.type !== 'p') {
      outer: for (const sq of hits) {
        const x = after.get(sq);
        if (!x || x.color !== them || x.type === 'k' || x.type === 'p') continue;
        for (const row of after.board())
          for (const y of row) {
            if (!y || y.color !== them || y.square === sq || y.type === 'k') continue;
            const att = after.attackers(y.square, us).filter(s => s !== move.to).length;
            const defs = after.attackers(y.square, them);
            if (att && defs.includes(sq) && defs.length <= att) {
              add(`Attacks the ${NAME[x.type]} on ${sq}, which is the defender of the ${NAME[y.type]} on ${y.square} — indirect pressure.`, 'good');
              break outer;
            }
          }
      }
    }

    // pins
    if ('brq'.includes(moved.type)) {
      for (const pin of pinsFrom(after, move.to, moved).slice(0, 1)) {
        const what = pin.behind.p.type === 'k' ? 'king — it cannot legally move' : NAME[pin.behind.p.type];
        add(`${b('Pins')} the ${NAME[pin.pinned.p.type]} on ${pin.pinned.sq} to the ${what}.`, 'good');
      }
    }
  }

  // defending something that was hanging
  const defendedNow = [];
  for (const row of after.board())
    for (const p of row) {
      if (!p || p.color !== us || p.square === move.to || p.type === 'k') continue;
      const wasAttacked = before.attackers(p.square, them).length;
      const hadDefenders = before.attackers(p.square, us).length;
      const nowDefenders = after.attackers(p.square, us).length;
      if (wasAttacked && !hadDefenders && nowDefenders && after.attackers(p.square, us).includes(move.to)) defendedNow.push(p);
    }
  if (defendedNow.length) add(`Defends the ${NAME[defendedNow[0].type]} on ${defendedNow[0].square}, which was under attack.`);

  // castling preparation
  if (!castled && piece !== 'k') {
    const rights = after.getCastlingRights(us);
    const r = homeRank;
    const clear = sqs => sqs.every(s => !after.get(s + r));
    const wasClear = sqs => sqs.every(s => !before.get(s + r));
    if (rights.k && clear(['f', 'g']) && !wasClear(['f', 'g'])) add('This clears the way to castle kingside next.');
    else if (rights.q && clear(['b', 'c', 'd']) && !wasClear(['b', 'c', 'd'])) add('This clears the way to castle queenside.');
  }

  // connected rooks
  if (piece !== 'r') {
    const r = homeRank;
    const connected = chess => {
      const rooks = FILES.split('').filter(f => {
        const p = chess.get(f + r);
        return p && p.type === 'r' && p.color === us;
      });
      if (rooks.length !== 2) return false;
      const [a, z] = rooks.map(f => FILES.indexOf(f));
      for (let i = a + 1; i < z; i++) if (chess.get(FILES[i] + r)) return false;
      return true;
    };
    if (connected(after) && !connected(before)) add('The rooks are now connected: they protect each other along the back rank and are ready to take open files.');
  }

  return notes.slice(0, 5);
}

// Does a bishop on `from` look through exactly one piece at `target`?
function xrays(chess, from, target) {
  const fx = FILES.indexOf(from[0]);
  const fy = rankOf(from);
  const tx = FILES.indexOf(target[0]);
  const ty = rankOf(target);
  if (Math.abs(tx - fx) !== Math.abs(ty - fy)) return false;
  const dx = Math.sign(tx - fx);
  const dy = Math.sign(ty - fy);
  let blockers = 0;
  for (let x = fx + dx, y = fy + dy; x !== tx; x += dx, y += dy) if (chess.get(FILES[x] + y)) blockers++;
  return blockers <= 1;
}

// A short, friendly description of what kind of opening this is, derived
// from the first moves. Used when no hand-written guide matches.
export function categoryOf(sans) {
  const [m1, m2] = sans;
  if (m1 === 'e4' && m2 === 'e5')
    return { title: 'Open Game (1.e4 e5)', text: 'Both sides put a pawn on the centre and fight directly over e4/e5. Expect quick development, open lines and tactics against the weak f7/f2 squares.' };
  if (m1 === 'e4' && m2 === 'c5')
    return { title: 'Sicilian family (1.e4 c5)', text: 'Black fights for d4 from the side instead of copying White. The positions are unbalanced: White often attacks the king, Black counterattacks on the queenside and the half-open c-file.' };
  if (m1 === 'e4' && m2)
    return { title: 'Semi-Open Game (1.e4, not …e5)', text: 'Black answers 1.e4 asymmetrically, aiming to challenge the centre later with …d5 or …c5 rather than mirroring White.' };
  if (m1 === 'd4' && m2 === 'd5')
    return { title: 'Closed Game (1.d4 d5)', text: 'A slower, strategic fight. Pawn structures and piece placement matter more than early tactics; c4 is White’s main lever against Black’s centre.' };
  if (m1 === 'd4' && m2 === 'Nf6')
    return { title: 'Indian Defences (1.d4 Nf6)', text: 'A hypermodern approach: Black controls the centre with pieces (especially against e4) before deciding where the pawns go, often with a fianchetto.' };
  if (m1 === 'd4')
    return { title: 'Queen’s Pawn Game', text: 'White starts with the d-pawn, which is already defended by the queen. Black has many ways to reply; the position usually stays more closed than after 1.e4.' };
  if (m1 === 'c4')
    return { title: 'English Opening family', text: 'White controls d5 from the flank and keeps the centre flexible. Many lines transpose to 1.d4 openings or become a reversed Sicilian.' };
  if (m1 === 'Nf3')
    return { title: 'Réti / Zukertort family', text: 'A flexible, hypermodern start: the knight controls e5 and d4 without committing a pawn, and White can later choose c4, d4, g3 or e4.' };
  return { title: 'Flank / irregular opening', text: 'An unusual first move. These openings are rarely the most testing, but they can take an unprepared opponent out of familiar territory. Fight for the centre and develop normally against them.' };
}

export const PRINCIPLES = [
  'Fight for the centre (e4, d4, e5, d5) with pawns and pieces.',
  'Develop knights and bishops before moving the same piece twice.',
  'Castle early to keep your king safe and connect your rooks.',
  'Don’t bring the queen out too early — it gets chased around.',
  'Every move should do something: develop, control the centre, or stop the opponent’s idea.',
];
