// Opening database: 3,800+ named openings from the Lichess chess-openings
// dataset (CC0), with a position graph so transpositions are recognised.

const norm = s =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/defence/g, 'defense')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9+#=\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Strips move numbers so "1.e4 c5 2.Nf3" and "e4 c5 nf3" compare equally.
const normMoves = s =>
  s
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/[+#!?]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const epdOf = fen => fen.split(' ').slice(0, 4).join(' ');

export class Book {
  static async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not load the opening database (' + res.status + ')');
    return new Book(await res.json());
  }

  constructor(data) {
    this.openings = data.openings.map(([eco, name, san, uci], id) => {
      const [family, variation = ''] = splitName(name);
      const sans = san.split(' ');
      return {
        id,
        eco,
        name,
        family,
        variation,
        sans,
        ucis: uci.split(' '),
        key: uci,
        plies: sans.length,
        hay: norm(name + ' ' + eco),
        movesNorm: normMoves(san),
      };
    });
    this.positions = new Map();
    const list = data.positions;
    list.forEach(([epd, named, moves]) => {
      this.positions.set(epd, { epd, named, moves: [] });
    });
    list.forEach(([epd, , moves]) => {
      const node = this.positions.get(epd);
      node.moves = moves.map(([uci, san, lines, child]) => ({ uci, san, lines, child: list[child][0] }));
    });
    this.byKey = new Map(this.openings.map(o => [o.key, o]));
    this.familyIndex = buildFamilies(this.openings);
  }

  node(fen) {
    return this.positions.get(epdOf(fen));
  }

  // The opening named exactly at this position, if any.
  namedAt(fen) {
    const n = this.node(fen);
    if (!n || !n.named.length) return null;
    return this.openings[n.named[0]];
  }

  // Like lichess: walk back from the current position to the last named one.
  detect(fens) {
    for (let i = fens.length - 1; i >= 0; i--) {
      const o = this.namedAt(fens[i]);
      if (o) return { opening: o, ply: i, exact: i === fens.length - 1 };
    }
    return null;
  }

  inBook(fen) {
    return this.positions.has(epdOf(fen));
  }

  // Book moves from a position, each with the opening it leads to (if named).
  movesFrom(fen) {
    const n = this.node(fen);
    if (!n) return [];
    return n.moves.map(m => {
      const child = this.positions.get(m.child);
      const named = child && child.named.length ? this.openings[child.named[0]] : null;
      return { ...m, opening: named };
    });
  }

  // All openings that extend this one's moves (its sub-variations).
  variationsOf(opening, limit = 400) {
    const prefix = opening.key + ' ';
    const out = [];
    for (const o of this.openings) {
      if (o.key.startsWith(prefix)) out.push(o);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => a.plies - b.plies || a.name.localeCompare(b.name));
  }

  // Shortest line that carries exactly this name.
  byName(name) {
    let best = null;
    for (const o of this.openings) if (o.name === name && (!best || o.plies < best.plies)) best = o;
    return best;
  }

  families() {
    return this.familyIndex;
  }

  search(query, limit = 120) {
    const q = norm(query);
    if (!q) return [];
    const qm = normMoves(query);
    const looksLikeMoves = /^(\d+\.\s*)?([a-h][1-8]|[nbrqk][a-h]?[1-8]?x?[a-h][1-8]|o-o(-o)?|[a-h]x[a-h][1-8])(\s|$)/i.test(
      query.trim()
    );
    const tokens = q.split(' ');
    const ecoQuery = /^[a-e]\d{0,2}$/.test(q) ? q.toUpperCase() : null;
    const scored = [];
    for (const o of this.openings) {
      let score = 0;
      if (ecoQuery && o.eco.startsWith(ecoQuery)) score += 60 - (o.eco === ecoQuery ? 0 : 10);
      if (looksLikeMoves && (o.movesNorm === qm || o.movesNorm.startsWith(qm + ' '))) {
        score += 80 - Math.max(0, o.plies - qm.split(' ').length) * 2;
      }
      let all = true;
      let tokenScore = 0;
      for (const t of tokens) {
        const i = o.hay.indexOf(t);
        if (i < 0) {
          all = false;
          break;
        }
        tokenScore += i === 0 ? 12 : o.hay[i - 1] === ' ' ? 8 : 2;
      }
      if (all) {
        score += tokenScore;
        if (o.hay.startsWith(q)) score += 30;
        if (!o.variation) score += 15;
      }
      if (score > 0) {
        score -= o.plies * 0.6 + o.name.length * 0.05;
        scored.push([score, o]);
      }
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, limit).map(s => s[1]);
  }

  random(filter = () => true) {
    const pool = this.openings.filter(filter);
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

function splitName(name) {
  const i = name.indexOf(':');
  if (i < 0) return [name, ''];
  return [name.slice(0, i).trim(), name.slice(i + 1).trim()];
}

function buildFamilies(openings) {
  const map = new Map();
  for (const o of openings) {
    let f = map.get(o.family);
    if (!f) {
      f = { name: o.family, count: 0, root: o, eco: o.eco };
      map.set(o.family, f);
    }
    f.count++;
    if (o.plies < f.root.plies) f.root = o;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// A curated starting list. Names are exact Lichess names; the shortest line
// with that name is used.
export const POPULAR = [
  { group: 'Popular for White', names: [
    'Italian Game', 'Ruy Lopez', 'Scotch Game', 'Vienna Game', "King's Gambit",
    "Queen's Gambit", "Queen's Pawn Game: London System", 'Catalan Opening', 'English Opening',
    'Réti Opening', "King's Indian Attack", 'Italian Game: Evans Gambit',
    'Sicilian Defense: Smith-Morra Gambit', 'Danish Gambit', 'Trompowsky Attack', 'Bird Opening',
  ] },
  { group: 'Black vs 1.e4', names: [
    'Sicilian Defense', 'Sicilian Defense: Najdorf Variation', 'Sicilian Defense: Dragon Variation',
    'French Defense', 'Caro-Kann Defense', 'Scandinavian Defense', 'Pirc Defense', 'Alekhine Defense',
    "Petrov's Defense", 'Italian Game: Two Knights Defense', 'Ruy Lopez: Berlin Defense',
  ] },
  { group: 'Black vs 1.d4 / 1.c4', names: [
    "Queen's Gambit Declined", 'Slav Defense', 'Semi-Slav Defense', "King's Indian Defense",
    'Nimzo-Indian Defense', 'Grünfeld Defense', "Queen's Indian Defense", 'Dutch Defense',
    'Benoni Defense: Modern Variation', 'Benko Gambit', 'Indian Defense: Budapest Gambit',
  ] },
];
