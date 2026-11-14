# 30-second demo

One story: pick targets - get a route and a verdict - see where you can reach - replay the walk in 3D.

- **Video:** `out/marswalk-demo.mp4`, 30 s, 1920x1080, made by [`record.mjs`](record.mjs). Not in git: rebuild it with the steps below.
- **Voiceover:** [`audio/voiceover_onyx.wav`](audio/voiceover_onyx.wav), made by [`voiceover.py`](voiceover.py). The video is cut to the voice, not the other way round.
- **AI disclosure:** the voiceover is AI-generated speech (OpenAI `gpt-4o-mini-tts`, voice `onyx`); the footage is a plain screen recording of the app. The recorder writes this note into the MP4 metadata (`title`, `comment`, `description` and the audio track title), as Space Apps requires for AI audio.

## Storyboard

Each shot runs from the start of its voiceover line to the start of the next one, so the cut follows the voice.

| Shot | Time, s | On screen | Voice |
| --- | --- | --- | --- |
| 1 | 0.0-5.4 | Jezero map, zoom from the wide view to the delta and the Three Forks base | Jezero Crater, from real NASA data. Where can a human walk? |
| 2 | 5.4-9.5 | Two stops added, Wildcat then Nukshak: the route bends around the delta scarp by itself | Pick science targets - the route steers around dangerous slopes. |
| 3 | 9.5-16.3 | Plan panel: green GO verdict, distance, oxygen, energy, radio link | Every plan is checked instantly: slopes, oxygen, suit time, daylight and comms. |
| 4 | 16.3-20.0 | The reach map layer turns on | The reach map shows where you can go - and still make it back. |
| 5 | 20.0-23.6 | 3D view with the replay running: the astronaut walks the route | Then replay the whole walk in 3D, step by step. |
| 6 | 23.6-30.0 | Title card: Marswalk Planner + live demo link | Marswalk Planner. Plan the walk before you take it. |

Each phrase is also a separate file, `audio/shot1_onyx.wav` ... `shot6_onyx.wav`, if that is easier to place in the edit.

## Ready-made plans

Open in a clean tab. A plan from a link wins over the one saved in the browser.

**Base only (shots 1, 2, 4)** - base at the Three Forks depot, no stops. In shot 2 the targets are clicked live:

https://marswalk-planner-one.vercel.app/#plan=eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwiVGhyZWUgRm9ya3Mgc2FtcGxlIGRlcG90Il0sInMiOltdLCJwIjp7fX0

**Full route (shots 3, 5)** - Three Forks → Wildcat (45 min) → Nukshak (30 min) → base. Verdict "go", 1.4 km, about 1 h 45 min:

https://marswalk-planner-one.vercel.app/#plan=eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwiVGhyZWUgRm9ya3Mgc2FtcGxlIGRlcG90Il0sInMiOltbNzcuNDA1OTI1LDE4LjQ1ODY0NywiV2lsZGNhdCBSaWRnZSwgZGVsdGEgZnJvbnQiLDQ1XSxbNzcuNDAxNDQsMTguNDUwNzI2LCJDYXBlIE51a3NoYWssIGRlbHRhIGJhc2UiLDMwXV0sInAiOnt9fQ

Locally the same: replace the start with `http://localhost:5174/`.

Why this route: longer loops around the delta almost always get "no-go" for radio shadow - the scarp hides the base mast. The loop on the crater floor gets "caution". Thirty seconds need a clean green verdict.

## Cut

AI assistant, auto planner, shadows and the Sun slider, radio shadow, best start time, emergency return, variants, export, briefing, Mars clock, weather, Perseverance images, editing assumptions.

The auto planner is cut on purpose: with every target selected it builds 6 stops over 12 km, and that plan gets "no-go" for comms (the planner only checks time, daylight, oxygen and passability). In a demo that looks like a bug.

## Making the video

```bash
.venv/Scripts/python demo/voiceover.py onyx
```

```bash
npm run dev --prefix app
```

```bash
cargo run --release --manifest-path tiles/Cargo.toml
```

```bash
cd demo && npm install && npm run record
```

- The first command makes the voiceover and `audio/timings_onyx.json`; the recorder cuts each shot to those timings. Set `VOICE=nova` (or another voice) to use a different track.
- The tile cache is optional but makes tiles load fast, and the photo skin of the 3D view needs it in development.
- `record.mjs` drives the app through its store, warms up tiles, the reach map and 3D off camera, captures the page with the Chrome DevTools screencast and encodes H.264 + AAC with ffmpeg. It uses installed Google Chrome (`PW_CHANNEL` to change).
- The replay is captured 1.6 times longer than its slot and sped up in the cut.

## Recording by hand

- Each shot is a separate take with 2-3 s to spare, then edited together. Tile loading and calculations stay out of frame.
- Before recording, pan over the whole area and open 3D once so the tiles are cached.
- Turn on the reach map layer (Layers panel → terrain analysis) once before shot 4, then turn it off and on again on camera.
- Set the replay to ×900: the whole walk runs in about 7 s; speed it up in the edit to fit shot 5.
- `H` hides all panels (shots 1, 4), `F` is fullscreen.
- Browser window 1920×1080, zoom 100%.

## Rebuilding the voiceover

Phrase text and voice style are at the top of [`voiceover.py`](voiceover.py). Needs `OPENAI_API_KEY` (read from `app/.env.local`).

```bash
.venv/Scripts/python demo/voiceover.py onyx
```

Other voices: `ash`, `echo`, `sage` (male), `nova`, `coral`, `shimmer` (female). The script prints the time of each phrase and saves them for the recorder. Pauses inside a phrase longer than 0.22 s are shortened automatically.
