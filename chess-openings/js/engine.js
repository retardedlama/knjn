// Thin UCI wrapper around the Stockfish WebAssembly worker.
// One search runs at a time; a new request stops the running search and
// starts as soon as the engine reports `bestmove` for the old one.

const ENGINE_URL = new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url).href;

export class Engine {
  constructor(name = 'Stockfish 19') {
    this.name = name;
    this.worker = null;
    this.ready = null;
    this.current = null;
    this.pending = null;
    this.stopping = false;
    this.options = {};
    this.waiter = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(ENGINE_URL);
      } catch (err) {
        reject(err);
        return;
      }
      this.worker.onmessage = e => this.onLine(String(e.data));
      this.worker.onerror = e => reject(e.message || e);
      this.waiter = {
        token: 'uciok',
        done: () => {
          this.waiter = { token: 'readyok', done: resolve };
          this.send('isready');
        },
      };
      this.send('uci');
    });
    return this.ready;
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  setOption(name, value) {
    if (this.options[name] === value) return;
    this.options[name] = value;
    this.send(`setoption name ${name} value ${value}`);
  }

  onLine(line) {
    if (this.waiter && line.startsWith(this.waiter.token)) {
      const done = this.waiter.done;
      this.waiter = null;
      done();
      return;
    }
    if (line.startsWith('info ') && this.current) this.onInfo(line);
    else if (line.startsWith('bestmove')) this.onBestMove(line);
  }

  /**
   * job: { fen, multipv=1, depth, movetime, searchmoves, options, onUpdate(lines, job), onDone(best, lines) }
   * Scores in lines are from White's point of view.
   */
  analyse(job) {
    this.start().then(() => {
      if (this.current) {
        this.current.cancelled = true;
        this.pending = job;
        if (!this.stopping) {
          this.stopping = true;
          this.send('stop');
        }
      } else {
        this.pending = job;
        this.startPending();
      }
    });
    return job;
  }

  stop() {
    this.pending = null;
    if (this.current) {
      this.current.cancelled = true;
      if (!this.stopping) {
        this.stopping = true;
        this.send('stop');
      }
    }
  }

  startPending() {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    this.current = job;
    this.stopping = false;
    job.lines = [];
    job.white = job.fen.split(' ')[1] === 'w';
    const opts = Object.assign({ MultiPV: job.multipv || 1 }, job.options || {});
    for (const [k, v] of Object.entries(opts)) this.setOption(k, v);
    this.send('position fen ' + job.fen);
    let go = 'go';
    if (job.depth) go += ' depth ' + job.depth;
    if (job.movetime) go += ' movetime ' + job.movetime;
    if (!job.depth && !job.movetime) go += ' infinite';
    if (job.searchmoves && job.searchmoves.length) go += ' searchmoves ' + job.searchmoves.join(' ');
    this.send(go);
  }

  onInfo(line) {
    const job = this.current;
    if (job.cancelled) return;
    const t = line.split(' ');
    const si = t.indexOf('score');
    const pi = t.indexOf('pv');
    if (si < 0 || pi < 0) return;
    if (t[si + 3] === 'lowerbound' || t[si + 3] === 'upperbound') return;
    const val = (k) => {
      const i = t.indexOf(k);
      return i >= 0 ? Number(t[i + 1]) : 0;
    };
    const sign = job.white ? 1 : -1;
    const raw = Number(t[si + 2]);
    const entry = {
      depth: val('depth'),
      multipv: val('multipv') || 1,
      cp: t[si + 1] === 'cp' ? raw * sign : null,
      mate: t[si + 1] === 'mate' ? raw * sign : null,
      nodes: val('nodes'),
      nps: val('nps'),
      pv: t.slice(pi + 1),
    };
    job.lines[entry.multipv - 1] = entry;
    job.depth = entry.depth;
    if (job.onUpdate) job.onUpdate(job.lines.filter(Boolean), job);
  }

  onBestMove(line) {
    const job = this.current;
    this.current = null;
    this.stopping = false;
    if (job && !job.cancelled && job.onDone) job.onDone(line.split(' ')[1], job.lines.filter(Boolean));
    if (this.pending) this.startPending();
  }
}

// Win-probability style mapping used by the evaluation bar (same curve
// shape as lichess uses). Returns 0..100 = White's share of the bar.
export function evalToPercent(line) {
  if (!line) return 50;
  if (line.mate !== null && line.mate !== undefined) return line.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, line.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatEval(line) {
  if (!line) return '…';
  if (line.mate !== null && line.mate !== undefined) return '#' + line.mate;
  const v = line.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
