# Opening Trainer

A browser app for learning chess openings — **all 3,865 named openings and variations** from the Lichess opening database — on a Lichess-style board, with **Stockfish 19** running locally in your browser to check every move.

## Modes

| Mode | What it does |
| --- | --- |
| **Learn** | Pick any opening and step through it move by move. Each move is explained in plain language (development, centre control, pins, forks, gambits, castling, pawn structure…), the green arrow shows the next book move and Stockfish says whether it agrees. Every opening also gets a strategy guide (plans for both sides, traps to know) and a list of its sub-variations. |
| **Practice** | You play your side of the line; the trainer answers with the book moves. Wrong moves are taken back, explained ("that's the Center Game, not the Italian") and compared by Stockfish. Hints, "show move", and spaced repetition: lines you get right come back after 1, 3, 7, 16… days. |
| **Explore** | Play any moves. The app names the opening you're in (transpositions included) and lists every book move from the current position with the opening it leads to. |
| **Play** | Continue from any position — e.g. the end of an opening you just learned — against Stockfish at 8 levels. |
| **Quiz** | Watch a sequence of moves and name the opening (popular openings, variations, or all 3,865). |

**Move labels:** every move gets a Stockfish rating: Brilliant !!, Great !, Best ★, Excellent, Good, Book, Inaccuracy ?!, Mistake ?, Miss or Blunder ??. The rating is based on how much winning chance the move gives away compared with the engine's best move. Labels appear on the board, in the move list and in the coach panel. After a game in Play (and in Explore) a review card shows each side's accuracy and how many moves fell into each category. Each label comes with a reason taken from Stockfish's lines: why a move is a blunder (it allows mate, loses a piece to a fork, hands over the position…), what the best move was and why (it wins material, stops a threat, attacks the queen…), or why a good move works (how a Brilliant sacrifice pays off, why a Great move was the only one). Practice mode uses the same explanations when you play a move that isn't in the line. Labels can be switched on or off separately for each mode (green **!?** button under the board, the `L` key, or Settings). They work without the engine display, so you can play Stockfish with live labels while the evaluation and best-move arrows stay hidden.

Also: search by name (`najdorf`), ECO code (`B90`) or moves (`e4 c5 Nf3 d6`); browse 149 opening families A–Z; star openings to build your own repertoire ("My lines"); dark/light theme; four board colours; synthesized move sounds.

**Keyboard:** `←` `→` step, `↑` `↓` first/last, `F` flip board, `L` move labels on/off, `E` engine on/off, `H` hint (Practice), `Space` auto-play (Learn), `/` search.

## Try it / install it as an app

**Online (recommended):** this repository is published with GitHub Pages at
**https://retardedlama.github.io/knjn/**. Open that link on your phone or computer, then install it:

- **Android / Chrome / Edge (desktop too):** tap the green **Install app** button at the top, or browser menu → *Install app* / *Add to Home screen*.
- **iPhone / iPad:** open the link in **Safari** → **Share** → **Add to Home Screen**.

Once installed it has its own icon, opens full-screen like a normal app and **works offline** (Stockfish and all 3,865 openings are stored on the device).

To turn GitHub Pages on (one time): repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick the branch that holds these files and the `/ (root)` folder, then **Save**. After about a minute the site is live.

**On your own computer:** the files must be served over HTTP (ES modules and the Stockfish worker don't load from `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Progress, favourites and settings are saved on the device (`localStorage`).

## Layout

```
index.html            page shell
manifest.webmanifest  app name, icons, colours (installable app)
sw.js                 service worker: offline cache + automatic updates (bump VERSION on each release)
icons/                app icons
css/style.css         theme (dark/light, board colours, responsive layout)
js/app.js             UI, modes, board wiring
js/book.js            opening database, search, position graph (transpositions)
js/engine.js          UCI wrapper around the Stockfish worker
js/classify.js        move labels (Brilliant … Blunder) and accuracy
js/reasons.js         explanations: why a move got its label, best move and why
js/explain.js         move-by-move explanations generated from the position
js/guides.js          hand-written strategy guides for the main opening families
js/progress.js        spaced repetition, favourites, settings (localStorage)
js/sound.js           Web Audio sound effects
data/openings.json    compiled opening database
tools/build-book.mjs  rebuilds data/openings.json from the Lichess TSV files
vendor/               chessground, chess.js, Stockfish (unmodified copies)
```

To refresh the opening data from upstream:

```bash
node tools/build-book.mjs            # downloads a.tsv … e.tsv from GitHub
node tools/build-book.mjs ./tsv-dir  # or use local copies
```

## Credits and licences

- Opening names and lines: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0 / public domain.
- Board UI: [chessground](https://github.com/lichess-org/chessground) 9.2.1 (the board used by Lichess), GPL-3.0, with cburnett pieces.
- Engine: [Stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.1, lite single-threaded build, GPL-3.0.
- Move generation: [chess.js](https://github.com/jhlywa/chess.js) 1.4.0, BSD-2-Clause.

Because chessground and Stockfish are GPL-3.0, this app as a whole should be distributed under GPL-3.0-compatible terms.
