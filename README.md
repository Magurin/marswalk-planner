<div align="center">

# 🔴 Marswalk Planner

**EVA route planner for a human explorer at Jezero Crater, Mars**

Real NASA terrain, imagery and weather in one map: plan a walk, check it against suit limits, replay it step by step.

[**Live demo**](https://marswalk-planner-one.vercel.app) · [Run](#run) · [How it is computed](#how-it-is-computed) · [Data](#data) · [Limitations](#model-limitations)

![React](https://img.shields.io/badge/React_19-20232a?logo=react&logoColor=61dafb)
![Vite](https://img.shields.io/badge/Vite_8-646cff?logo=vite&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?logo=leaflet&logoColor=white)
![three.js](https://img.shields.io/badge/three.js-000?logo=threedotjs&logoColor=white)
![Rust](https://img.shields.io/badge/Rust_tile_cache-b7410e?logo=rust&logoColor=white)

</div>

## What it is

Perseverance has already found the places in Jezero worth sending a person back to: the Three Forks sample depot, organic-bearing mudstones, the "leopard spots" of Cheyava Falls. Marswalk Planner answers the practical question: **can an astronaut walk there from the base, do the work and get home alive** - given slopes, suit endurance, oxygen, daylight, comms and cold.

The app runs entirely in the browser. Server-side code is optional: a tile cache for a faster map (a Rust tool locally, a Vercel function in production) and an OpenAI proxy for the AI assistant.

## Features

| | |
| --- | --- |
| 🧭 **Terrain routing** | Least-time A* paths on a 20 m grid that avoid slopes beyond the suit limit |
| ✅ **Go / caution / no-go** | Slope, suit endurance, daylight, oxygen, walk-back range, comms, shadow, temperature |
| 🗺️ **Reach map** | Where you can walk, work and still get home in time - over real terrain, not as the crow flies |
| 🆘 **Emergency return** | The worst moment of the walk for an injury or a leak, and what the way home would cost |
| 🤖 **Auto planner** | The most science targets that fit in one EVA, in the best order (exact search) |
| 🌗 **Terrain analysis** | Slope classes, cast shadows for any solar time, radio shadow from the base mast |
| 🕘 **Best start time** | The same route checked for a start at every quarter hour of daylight |
| 🎬 **Replay and 3D** | Walk replay with live oxygen, 3D view, Perseverance raw images at each stop |
| 🕒 **Mars clock** | Mission sol, local true solar time, Ls, sunrise and sunset at Jezero |
| 💬 **AI assistant** | Edits the plan through the same actions as the UI (optional, OpenAI) |
| 📎 **Sharing** | Saved variants side by side, share links, GeoJSON export, printable briefing |

## Run

You need a Node.js version supported by Vite 8 (20.19+ or 22.12+).

```bash
cd app
```

```bash
npm install
```

```bash
npm run dev
```

The app opens at http://localhost:5174. That is all it takes: terrain, the rover track and weather ship in the repository, and map tiles come straight from NASA Mars Trek.

### Optional: faster map

NASA Trek serves a tile in 1-4 seconds, over HTTP/1.1 only and without `Cache-Control`. The local Rust cache fixes that:

```bash
cargo run --release --manifest-path tiles/Cargo.toml
```

It listens on `127.0.0.1:8787`. On load the page spends up to 500 ms probing `/health` and takes tiles from the cache if it answers, otherwise it goes straight to NASA. Nothing to configure. Details in [Tile cache](#tile-cache).

### Optional: AI assistant

Create `app/.env.local`:

```
OPENAI_API_KEY=sk-...
```

and restart `npm run dev`. The key never reaches the browser: the variable has no `VITE_` prefix, the page calls `/api/openai/...`, and the dev server adds the key header on the way to OpenAI. Without a key the proxy is not created and the assistant reports that it is not connected.

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | `app/.env.local`, Vercel project settings | Key for the assistant. Server side only |
| `VITE_OPENAI_MODEL` | `app/.env.local` | Assistant model, `gpt-5.4-mini` by default |
| `VITE_TILE_PROXY` | `app/.env.local` | Tile cache address, `http://127.0.0.1:8787` by default |

### Checks

```bash
npm run lint --prefix app
```

```bash
cargo test --manifest-path tiles/Cargo.toml
```

The linter is oxlint. Only the tile cache has tests (tile path validation and the tile grid); the JS side has no automated tests.

## Using it

- **Base** (the `H` marker) is the start and finish of the walk. Drag the marker or use "move base". The base and stops can only be placed inside the terrain model.
- **Stops** are added by clicking the map or a science target. Each has a work time on site. Markers can be dragged and stops reordered.
- **The verdict** is recomputed after every change. Every model assumption (pace, mass, tank and so on) is editable in the plan panel.
- **The Sun slider** sets the time for the shadow layer; the start time of the walk is set separately.
- **Hotkeys:** `F` - fullscreen, `H` - hide all panels, `P` - elevation profile, `Esc` - close.
- Below 1024 px the side panels become drawers with a button bar at the bottom.

What is stored and where:

| What | Where |
| --- | --- |
| Current plan (base, stops, assumptions, routing mode) | `localStorage`, key `marswalk.plan.v4` |
| Saved variants | `localStorage`, key `marswalk.variants.v2` |
| Which panels are open | `localStorage`, key `marswalk.ui.v1` |
| Share link | `#plan=<base64url of compact JSON>` in the address. Only assumptions that differ from the defaults go in |
| Export | `marswalk-plan.geojson`: base, stops, route line with elevations, verdict, checks and assumptions |

A plan from a link takes priority over the one saved in the browser. There are no accounts and no server-side storage.

## How it is computed

The whole model lives in `app/src/lib` and does not depend on the UI. Every number in it is an editable assumption, not a flight rule.

### Terrain (`terrain.js`)

The base is the MRO CTX stereo DTM: a 1596 x 1512 grid of 20 m cells (about 32 x 30 km around Jezero), elevations from -2711 to -1516 m relative to MOLA.

- `jezero_dem.u16` is raw little-endian `uint16`: `elevation = value * 0.05 - 3000`, a 5 cm step; `0` means no data. Georeferencing sits next to it in `jezero_dem.json`.
- A cell is 20 m north-south, but east-west it is shorter on the ground by `cos(latitude)` - slopes and distances account for that.
- Slope uses the Horn operator on a 3 x 3 window. Six classes: 0-5°, 5-10°, 10-15°, 15-20° (suit limit), 20-30° (not on foot), over 30° (scarp).
- Distances use a local flat approximation on a 3396.19 km sphere; at EVA scale the error is negligible.

### Speed and energy (`eva.js`)

- **Speed** is a Tobler-style curve against the signed grade of the path, scaled to a suited pace: `v = v0 * exp(-3.5 * |grade + 0.05| + 0.175)`. On level ground that is exactly `v0` (3 km/h by default), the fastest is a gentle 5% descent, the floor is 0.08 m/s.
- **Metabolic rate** follows Santee et al. (2001), the planetary EVA form used by MIT's SEXTANT traverse planner, with Mars gravity of 3.71 m/s². Never below 120 W. At a science stop it is a fixed 220 W.
- **Oxygen** is 20.1 kJ per litre of O2, that is 7.11e-8 kg per joule. The reserve is sized as 45 minutes of walking at 300 W (about 0.06 kg) and must remain in the tank on return.
- Grade is signed, so the way out and the way back cost differently.

Defaults:

| Assumption | Value |
| --- | --- |
| Pace on level ground | 3 km/h |
| Astronaut plus suit mass | 145 kg |
| Slope limit | 20° |
| Suit endurance | 8 h |
| Usable oxygen | 0.75 kg |
| Oxygen reserve | 45 min |
| Work rate at a stop | 220 W |
| Walk-back limit | 6 km straight-line |
| Margin before sunset | 60 min |
| Radio mast height | 10 m |
| Start | 09:00 local solar time |

### Routing

A* on the 20 m grid with 8 directions; the cost is travel time.

- Cells steeper than the limit are closed. The exception is the goal itself: a stop on a steep slope can be reached, and it then shows up in the slope check.
- Nearing the limit is penalized: time on a cell is multiplied by `1 + 1.5 * (slope / limit)²`, so the route prefers a gentle detour to walking along a dangerous edge. The penalty only steers the choice of path; time and oxygen are computed without it.
- The heuristic is straight-line distance over the highest possible speed, so the search stays optimal.
- The result is simplified with Douglas-Peucker at a 6 m tolerance.
- If there is no passable way, the leg is drawn as a straight line and the plan gets a no-go with a "routing" check.
- A "straight line" mode exists for comparison with the naive estimate.

### Readiness checks

The finished route is walked in 20 m steps: each sample knows its elevation, slope, speed, power, time, base visibility and shadow. The overall verdict is the worst of the individual ones.

| Check | No-go | Caution |
| --- | --- | --- |
| Slope | steeper than the limit | within 5° of the limit |
| Suit endurance | longer than the limit | over 85% of it |
| Daylight | start before sunrise or return after sunset | return less than 60 min before sunset |
| Distance from base | beyond the limit | beyond 80% of it |
| Oxygen | use + reserve exceeds the tank | exceeds 90% of the tank |
| Line of sight to base | mast visible from under 60% of the route | under 90% |
| Shadow on the way | - | over 25% of walking time in shadow |
| Air temperature | - | colder than -75 °C |
| Terrain model coverage | - | part of the route is off the model |
| Emergency return | oxygen or suit time runs out | over 90% used, or less than half the reserve left |

Fine print:

- **Shadow** is computed for the Sun at the moment the astronaut reaches each point, not at start time.
- **Radio shadow** is plain line of sight from the base mast (10 m) to a suit antenna (1.8 m) within 12 km, with no diffraction or planetary curvature. It is recomputed when the base moves or the mast height changes.
- **Temperature** is a half-cosine daily cycle between the minimum (just before sunrise) and the maximum (13:30), from the latest MEDA sol with data. It is a warning only: cold does not enter the energy model.
- **Sunrise and sunset** use the geometric horizon; the crater rim blocking the Sun is handled by the shadow check instead.

### Reach map, emergency return, auto planner (`reach.js`)

All three stand on least-time fields: Dijkstra from the base to every cell within the walk-back radius, with the same speed, slope limit and penalty as the route.

- There are two fields, "from base" and "to base" - signed grade makes them differ.
- These use 16 directions (knight moves too). With 8 the zones come out octagonal and distances up to 8% long.
- **Reach map** is the share of the time and oxygen budget a there-and-back walk uses, with 30 minutes of work at the far end. The fields depend only on the base, pace, mass, slope limit and walk-back limit; tank, endurance and start time only change the colouring, so they need no recompute.
- **Emergency return** asks, for every point of the route: what if you turned for base right now, at half the pace and twice the oxygen use? The worst moment of the walk is shown.
- **Auto planner** is an exact search over subsets (Held-Karp), up to 14 candidates within the walk-back limit: most targets first, shortest walk on a tie. The fields run slightly optimistic against the exact model along the drawn route, so the plan is computed against 100%, 96%, ... 70% of the budget, and the fullest one that passes the hard checks (time, daylight, oxygen, passability) on the real route wins.

Heavy work stays off the main thread: fields and the auto planner run in `calc.worker.js`, shadows in `shade.worker.js` (about 0.3 s per frame, so the map does not freeze while the slider is dragged). A newer request of the same kind supersedes an older one.

### Mars time (`marstime.js`)

Allison & McEwen (2000), the algorithm behind NASA GISS Mars24: Ls, equation of time, local mean and true solar time, solar declination and direction.

- Every time in the UI is **local true solar time** at Jezero (LTST).
- The sol number is calibrated so that the Perseverance landing (18 February 2021) falls on sol 0.
- TAI-UTC is hard-coded as 37 s (valid since 2017); a new leap second means updating it.

### Science targets (`catalog.js`)

Target positions are not typed in: each target is tied to a sol and placed where Perseverance was localized on that sol. Ingenuity's final airfield comes from the flight log. Targets outside the terrain model (the rim crest and beyond) appear on the map but cannot be routed to.

## AI assistant

`app/src/lib/assistant.js`, OpenAI Responses API.

- Before every model call a full snapshot of the plan is built as JSON: time, base, stops, the result with every check, assumptions, targets, variants.
- The model changes the plan only through 20 tools, each calling the same store action as a button in the UI. So every change goes through the normal calculation, and the numbers in an answer come from the EVA model rather than being made up.
- One question allows up to 8 rounds of tool calls; the conversation is chained with `previous_response_id`.
- The assistant will carry out an unsafe request (say, cutting the oxygen reserve), but warns about it plainly.

## Tile cache

`tiles/` is a small Rust proxy (axum + reqwest); the compiler version is pinned in `rust-toolchain.toml`.

- Every tile stays on disk forever: tiles are immutable.
- 404s are remembered too, so out-of-coverage requests are answered instantly.
- Concurrent requests for one tile merge into a single upstream fetch.
- Each fetch runs in its own task: Leaflet cancels requests on every pan, and abandoned fetches would otherwise hold their upstream slots forever.
- The Jezero area is warmed in the background, lowest zoom first and nearest to the site first. The warm-up has its own connection pool so it never starves the map.
- The browser gets `Cache-Control: immutable` and CORS headers.

```
marswalk-tiles [--port 8787] [--cache DIR] [--no-prefetch] [--hirise-max 15] [--warm-conns 32]
```

Fine print:

- The cache defaults to `tiles/cache` and only grows. If disk space is tight, pass `--cache` or turn the warm-up off with `--no-prefetch`; `--hirise-max` sets how deep HiRISE is warmed.
- Stats are at `http://127.0.0.1:8787/health`.
- **In development, the photo skin of the 3D view needs the cache.** WebGL requires tiles with CORS headers, which the cache adds; without it only the "slopes" and "relief" skins remain. In production tiles come from the same origin (`/api/trek`), so the photo skin works there without it.
- The map uses the `EPSG:4326` projection (the Trek tile grid), not the usual Web Mercator.

## Data

| Source | Used for |
| --- | --- |
| MRO **HiRISE** | 25 cm base imagery (NASA Mars Trek) |
| MRO **CTX** | 6 m mosaic + 20 m stereo DTM behind slope, shadow, radio and routing |
| MGS **MOLA** | Colour elevation, vertical reference |
| Mars Odyssey **THEMIS** | Day / night IR - rock vs. loose dust |
| **Viking** Orbiters | Global colour context |
| Mars 2020 **Perseverance** | Traverse, science targets, MEDA weather, raw images |
| Mars 2020 **Ingenuity** | Flight log and airfields |
| MSL **Curiosity** REMS | Multi-year seasonal weather (Gale Crater, not Jezero) |

**Snapshots and live data.** Terrain, the rover track and weather ship as snapshots in `app/public/data`, so the calculations work offline. On start the app also asks the live mars.nasa.gov feeds (MEDA and REMS weather, rover position) and quietly stays on the snapshots if a feed is unreachable. Map tiles and raw camera images always come from the network.

### Rebuilding the snapshots

Download the [CTX DTM](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif) to `data/raw/jezero_ctx_dtm_20m.tif` (the folder is in `.gitignore`) and run:

```bash
python -m venv .venv && .venv/Scripts/pip install rasterio numpy
```

```bash
.venv/Scripts/python tools/prepare_data.py
```

A single step can be run on its own: `prepare_data.py dem`, `rover` or `weather` (the last two do not need the DTM).

> The script writes to `web/data`, the folder of the first prototype. The app reads `app/public/data`, so copy the result there by hand.

## AI tools used

Declared per the Space Apps rules on AI attribution.

| Tool | Maker | Used for |
| --- | --- | --- |
| **Claude Code** (models Claude Opus 5.5 and Claude Fable 5.2) | Anthropic | Coding assistant during development: writing and refactoring code, debugging, performance profiling and optimization, the demo recorder script, this README and the English translation of the UI |
| **GPT-5.4 mini** via the OpenAI Responses API | OpenAI | Runtime feature: the in-app AI assistant that edits the EVA plan through the same actions as the UI (`app/src/lib/assistant.js`) |
| **gpt-4o-mini-tts** (voice `onyx`) via the OpenAI Audio API | OpenAI | English voiceover of the 30-second demo video (`demo/voiceover.py`) |

No data in the project comes from AI. Terrain, imagery, the rover track, science target positions and weather are real NASA and USGS data (see [Data](#data)); the EVA model formulas come from the published sources cited in [How it is computed](#how-it-is-computed). The AI assistant only changes the plan through the regular store actions, and every change goes through the same EVA checks as a manual edit.

## Deploy

Hosted on **Vercel**, connected to this repo: `main` goes to production, every PR gets a preview URL.

- `vercel.json` builds `app/` and publishes `app/dist`. The build uses relative paths (`base: './'`), so it works from any subdirectory.
- `api/openai/v1/responses.js` is the production twin of the dev proxy: it adds the key and forwards the request to OpenAI. Set `OPENAI_API_KEY` in project settings; without it the assistant reports that it is not configured.
- That function does not check who is calling and has no rate limit: any visitor spends your key. For a public demo, set a spending limit on the OpenAI side.
- `api/trek/[...path].js` proxies NASA Trek tiles and marks them immutable, so the Vercel CDN keeps each tile after the first request. Production builds load tiles from `/api/trek`; the dev server has no functions and goes to NASA directly. The Rust cache in `tiles/` is a local development tool and is not deployed.

## Structure

```
app/                    React app
  src/lib/              Model, no UI:
    terrain.js            terrain, slope, shadows, radio shadow, A*
    eva.js                speed, energy, oxygen, checks
    reach.js              reach map, emergency return, auto planner
    marstime.js           Mars time and Sun position
    assistant.js          AI assistant and its tools
    catalog.js            science targets, demo plans, map layers
    *.worker.js           calculations off the main thread
  src/store.js          Single state (zustand): every plan change goes
                        through commit and recomputes the route
  src/components/       Map (Leaflet), 3D (three.js), panels, briefing
  public/data/          Terrain, rover track and weather snapshots
  public/models/        3D models of Perseverance and Ingenuity
api/                    Vercel functions: OpenAI proxy, cached NASA Trek tiles
tiles/                  Rust cache for NASA Trek tiles
tools/                  Data preparation (Python)
web/                    First prototype in plain HTML and JS, kept for history
```

## Model limitations

- A 20 m grid cannot see rocks, sand ripples or scarps smaller than a cell. The route says where a slope is passable, not where to put a foot.
- Ground properties are ignored: loose sand and solid slab cost the same at the same slope. The THEMIS night IR layer shows the difference to the eye but does not enter the calculation.
- Dust and atmospheric opacity, radiation, suit thermal balance and water use are not modelled.
- Comms is pure line-of-sight geometry, with no relays or orbiters.
- A route can only be planned inside the CTX terrain model.
- Speed, energetics and limits are reasoned assumptions from published work (Tobler, Santee et al., Apollo experience), not certified figures for a specific suit.

> Marswalk Planner is a planning aid with open assumptions, not flight rules.
