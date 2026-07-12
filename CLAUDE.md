# Racing-game Prototype — working notes

Driver-like open-world racing game. Three.js 0.160, procedural + some GLB assets,
deployed on GitHub Pages.

## Deploy workflow (important)

GitHub Pages serves **`main`** (site root, `index.html`). The user tests the
deployed site, so **merge every finished change to `main`** — don't leave work
on the feature branch, or the user tests stale code.

Per change: commit on `claude/minimal-racing-game-5rnbme` → push → open a PR →
**squash-merge to `main`** → reset the branch onto the new `main`
(`git fetch origin main && git checkout -B <branch> origin/main && git push
--force-with-lease`). This matches the project's PR history (#27–#32).

## Layout

- Race circuit is the default mode; **free-roam open world is behind `?world=1`**.
- Open-world modules: `citymodel.js` (grid data spine) → `world.js` (geometry +
  central plaza) → `signals.js` (traffic lights) → `traffic_world.js` (AI cars) →
  `pedestrians_world.js` (people) → `collision.js` (grid-aware collision).
- Design doc / roadmap: `docs/OPEN_WORLD.md`.

## Dev / testing

- Dev server: `python3 -m http.server 8744 --bind 127.0.0.1`
- Headless smoke test needs modern software-GL flags on this Chromium:
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
  --remote-allow-origins=*`. `window.__dbg` exposes runtime state for CDP checks.
