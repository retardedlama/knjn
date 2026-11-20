// Builds data/openings.json from the Lichess chess-openings dataset (CC0).
// Usage: node tools/build-book.mjs [dir-with-a..e.tsv]
// If no directory is given, the TSV files are downloaded from GitHub.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../vendor/chessjs/chess.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
const RAW = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';

async function loadTsv(letter) {
  if (src) return readFileSync(join(src, letter + '.tsv'), 'utf8');
  const res = await fetch(RAW + letter + '.tsv');
  if (!res.ok) throw new Error('download failed: ' + letter);
  return res.text();
}

const epd = fen => fen.split(' ').slice(0, 4).join(' ');

const openings = [];
for (const letter of 'abcde') {
  const lines = (await loadTsv(letter)).trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    const ucis = [];
    for (const san of sans) {
      const m = chess.move(san);
      ucis.push(m.from + m.to + (m.promotion || ''));
    }
    openings.push({ eco, name, sans, ucis, epd: epd(chess.fen()) });
  }
}

// Position graph: every position reached inside any named line, keyed by EPD
// so transpositions are recognised. Each node lists the book moves that
// continue from it and how many named lines lie behind each move.
const nodes = new Map();
const node = key => {
  if (!nodes.has(key)) nodes.set(key, { named: [], moves: new Map() });
  return nodes.get(key);
};
openings.forEach((o, id) => {
  const chess = new Chess();
  let key = epd(chess.fen());
  const seen = new Set();
  o.sans.forEach((san, i) => {
    const parent = node(key);
    chess.move(san);
    const childKey = epd(chess.fen());
    const edge = parent.moves.get(o.ucis[i]) || { san, lines: 0, child: childKey };
    if (!seen.has(key)) { edge.lines++; seen.add(key); }
    parent.moves.set(o.ucis[i], edge);
    key = childKey;
  });
  node(key).named.push(id);
});

const keys = [...nodes.keys()];
const index = new Map(keys.map((k, i) => [k, i]));
const out = {
  source: 'lichess-org/chess-openings (CC0)',
  built: new Date().toISOString().slice(0, 10),
  // [eco, name, "san san ...", "uci uci ..."]
  openings: openings.map(o => [o.eco, o.name, o.sans.join(' '), o.ucis.join(' ')]),
  // positions[i] = [epd, [namedOpeningIds], [[uci, san, lines, childIndex], ...]]
  positions: keys.map(k => {
    const n = nodes.get(k);
    const moves = [...n.moves.entries()]
      .map(([uci, e]) => [uci, e.san, e.lines, index.get(e.child)])
      .sort((a, b) => b[2] - a[2]);
    return [k, n.named, moves];
  }),
};
const file = join(here, '..', 'data', 'openings.json');
writeFileSync(file, JSON.stringify(out));
console.log(`${openings.length} openings, ${keys.length} positions -> ${file}`);
