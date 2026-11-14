<div align="center">

# 🔴 Marswalk Planner

**EVA route planner for a human explorer at Jezero Crater, Mars**

Real NASA terrain, imagery and weather in one map: plan a walk, check it against suit limits, replay it.

[**Live demo**](https://marswalk-planner-one.vercel.app) · [Run locally](#run) · [Data](#data)

![React](https://img.shields.io/badge/React_19-20232a?logo=react&logoColor=61dafb)
![Vite](https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?logo=leaflet&logoColor=white)
![three.js](https://img.shields.io/badge/three.js-000?logo=threedotjs&logoColor=white)
![Rust](https://img.shields.io/badge/Rust_tile_cache-b7410e?logo=rust&logoColor=white)

</div>

## Features

| | |
| --- | --- |
| 🧭 **Routing** | Least-time A* paths on a 20 m terrain grid that avoid slopes beyond the suit limit |
| ✅ **Go / no-go** | Slope, suit endurance, daylight, oxygen, walk-back range, comms, temperature |
| 🗺️ **Reach map** | Where you can walk, work and still get home in time (Web Worker) |
| 🆘 **Emergency return** | Cost of turning back at any moment of the walk |
| 🤖 **Auto planner** | Most science targets that fit in one EVA, in the best order |
| 🌗 **Terrain analysis** | Slope classes, cast shadows for any solar time, radio line of sight from base |
| 🎬 **Replay & 3D** | Walk replay with live consumables, 3D view, Perseverance raw images at each stop |
| 🕒 **Mars clock** | Live sol, local solar time, Ls, sunrise / sunset for Jezero |
| 💬 **AI assistant** | Edits the plan through the same actions as the UI (optional, OpenAI) |

Plus: best start time, saved variants side by side, share links, printable briefing.

## Run

```bash
cd app
npm install
npm run dev        # http://localhost:5174
```

**Optional**

- **Faster map** - local Rust tile cache (port 8787, used automatically when up):
  ```bash
  cargo run --release --manifest-path tiles/Cargo.toml
  ```
- **AI assistant** - put `OPENAI_API_KEY=...` in `app/.env.local`. The dev server proxies the calls, the key never reaches the browser.

## Deploy

Hosted on **Vercel**, connected to this repo: `main` goes to production, every PR gets a preview URL. Build settings live in `vercel.json`; `api/openai/v1/responses.js` is the production proxy for the assistant (set `OPENAI_API_KEY` in project settings).

## Data

| Source | Used for |
| --- | --- |
| MRO **HiRISE** | 25 cm base imagery (NASA Mars Trek) |
| MRO **CTX** | 6 m mosaic + 20 m stereo DTM behind slope, shadow, radio and routing |
| MGS **MOLA** | Colour elevation, vertical reference |
| Mars Odyssey **THEMIS** | Day / night IR - rock vs. loose dust |
| **Viking** Orbiters | Global colour context |
| Mars 2020 **Perseverance** | Traverse, science targets, MEDA weather |
| Mars 2020 **Ingenuity** | Flight log and airfields |
| MSL **Curiosity** REMS | Multi-year seasonal weather |

Terrain, rover track and weather ship as snapshots in `app/public/data`. To rebuild them, download the [CTX DTM](https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif) to `data/raw/jezero_ctx_dtm_20m.tif` and run:

```bash
python -m venv .venv && .venv/Scripts/pip install rasterio numpy
.venv/Scripts/python tools/prepare_data.py
```

## Structure

```
app/          React app (UI in src/components, EVA / terrain / routing model in src/lib)
api/          Vercel function: OpenAI proxy for the assistant
tiles/        Rust caching proxy for NASA Trek tiles
tools/        Data preparation script
web/          First prototype, plain HTML
```

> The EVA model is a planning aid with editable assumptions, not flight rules.
