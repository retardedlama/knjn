// Per-browser progress: practice results with Leitner-style spaced
// repetition, favourites and settings. Everything is optional — if storage
// is blocked the app still works, it just forgets on reload.

const KEY = 'opening-trainer:v1';
const DAY = 24 * 60 * 60 * 1000;
// Review intervals per box (box 0 = new / failed).
const INTERVALS = [0, 1, 3, 7, 16, 35, 90].map(d => d * DAY);

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* storage unavailable */
  }
  return {};
}

const data = Object.assign({ lines: {}, fav: [], settings: {}, quiz: { best: 0, played: 0, correct: 0 } }, read());

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    /* storage unavailable */
  }
}

export const progress = {
  line(key) {
    return data.lines[key] || null;
  },

  record(key, mistakes) {
    const now = Date.now();
    const l = data.lines[key] || { box: 0, attempts: 0, perfect: 0 };
    l.attempts++;
    if (mistakes === 0) {
      l.perfect++;
      l.box = Math.min(INTERVALS.length - 1, l.box + 1);
    } else {
      l.box = Math.max(0, mistakes > 1 ? 0 : l.box - 1);
    }
    l.last = now;
    l.due = now + INTERVALS[l.box];
    data.lines[key] = l;
    save();
    return l;
  },

  mastery(key) {
    const l = data.lines[key];
    return l ? l.box : -1;
  },

  isDue(key) {
    const l = data.lines[key];
    return !!l && l.due <= Date.now();
  },

  practiced() {
    return Object.entries(data.lines).map(([key, l]) => ({ key, ...l }));
  },

  due() {
    const now = Date.now();
    return this.practiced()
      .filter(l => l.due <= now)
      .sort((a, b) => a.due - b.due);
  },

  isFav(key) {
    return data.fav.includes(key);
  },

  toggleFav(key) {
    const i = data.fav.indexOf(key);
    if (i >= 0) data.fav.splice(i, 1);
    else data.fav.push(key);
    save();
    return i < 0;
  },

  favs() {
    return data.fav.slice();
  },

  setting(name, fallback) {
    return name in data.settings ? data.settings[name] : fallback;
  },

  set(name, value) {
    data.settings[name] = value;
    save();
  },

  quiz() {
    return data.quiz;
  },

  quizResult(correct, streak) {
    data.quiz.played++;
    if (correct) data.quiz.correct++;
    data.quiz.best = Math.max(data.quiz.best, streak);
    save();
  },

  reset() {
    data.lines = {};
    data.fav = [];
    data.quiz = { best: 0, played: 0, correct: 0 };
    save();
  },
};

export const MASTERY_LABELS = ['Learning', 'Seen', 'Familiar', 'Good', 'Strong', 'Mastered', 'Mastered'];
