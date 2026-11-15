# 30-second demo

Eight quick shots, no title card: pick targets - see the terrain the route reads - get a verdict - see where you can reach - let the planner choose - walk it in 3D. The name and link sit over the last two seconds of the 3D shot.

- **Video:** `out/marswalk-demo.mp4`, 30 s, 1920x1080, made by [`record.mjs`](record.mjs). `out/marswalk-demo-youtube.mp4` is the same at a lower bitrate (under 10 MB) for uploading. Not in git: rebuild them with the steps below.
- **Voiceover:** [`audio/voiceover_onyx.wav`](audio/voiceover_onyx.wav), made by [`voiceover.py`](voiceover.py). The video is cut to the voice, not the other way round.
- **AI disclosure:** the voiceover is AI-generated speech (OpenAI `gpt-4o-mini-tts`, voice `onyx`); the footage is a plain screen recording of the app. The recorder writes this note into the MP4 metadata (`title`, `comment`, `description` and the audio track title), as Space Apps requires for AI audio.

## Storyboard

Each shot runs from the start of its voiceover line to the start of the next one, so the cut follows the voice.

| Shot | Time, s | On screen | Voice |
| --- | --- | --- | --- |
| 1 | 0.0-4.3 | Wide Jezero view, the Perseverance traverse drawn over it, then down to the Three Forks base | Jezero Crater, from real NASA data. Can a human walk here? |
| 2 | 4.3-7.7 | Two stops added, Wildcat then Nukshak: the route bends around the delta scarp by itself | Pick targets - the route avoids steep slopes. |
| 3 | 7.7-11.9 | Slope layer (CTX sharpened by HiRISE 1 m), then the loose ground layer (THEMIS thermal inertia) | One-meter HiRISE terrain. Loose sand from THEMIS. |
| 4 | 11.9-15.1 | Cast shadows as the morning sun climbs, then the radio shadow of the base mast | Shadows for any hour. Radio dead zones. |
| 5 | 15.1-20.0 | Plan panel with the GO verdict, then it scrolls down to the readiness checks | An instant verdict: oxygen, daylight, comms, radiation. |
| 6 | 20.0-23.2 | Reach map around the base | The reach map: where you can go and get back. |
| 7 | 23.2-26.0 | Auto planner over every target: picks three stops (captured at full length and sped up) | Or let it pick the most science that fits. |
| 8 | 26.0-30.0 | 3D replay of the auto plan, the name and link fading in | Then walk it in 3D. Marswalk Planner. |

Each phrase is also a separate file, `audio/shot1_onyx.wav` ... `shot8_onyx.wav`, if that is easier to place in the edit.

## Ready-made plans

Open in a clean tab. A plan from a link wins over the one saved in the browser.

**Base only (shots 1, 2, 4)** - base at the Three Forks depot, no stops. In shot 2 the targets are clicked live:

https://marswalk-planner-one.vercel.app/#plan=eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwiVGhyZWUgRm9ya3Mgc2FtcGxlIGRlcG90Il0sInMiOltdLCJwIjp7fX0

**Full route (shots 3, 5)** - Three Forks → Wildcat (45 min) → Nukshak (30 min) → base. Verdict "go", 1.4 km, about 1 h 45 min:

https://marswalk-planner-one.vercel.app/#plan=eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwiVGhyZWUgRm9ya3Mgc2FtcGxlIGRlcG90Il0sInMiOltbNzcuNDA1OTI1LDE4LjQ1ODY0NywiV2lsZGNhdCBSaWRnZSwgZGVsdGEgZnJvbnQiLDQ1XSxbNzcuNDAxNDQsMTguNDUwNzI2LCJDYXBlIE51a3NoYWssIGRlbHRhIGJhc2UiLDMwXV0sInAiOnt9fQ

Locally the same: replace the start with `http://localhost:5174/`.

Why this route: longer loops around the delta almost always get "no-go" for radio shadow - the scarp hides the base mast. The loop on the crater floor gets "caution". Thirty seconds need a clean green verdict.

## Cut

AI assistant, best start time, emergency return, variants, export, briefing, Mars clock, weather, Perseverance images, editing assumptions.

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
- The auto planner shot runs until the plan is ready and is sped up to its slot; the 3D replay is captured 1.8 times longer than its slot and sped up too.

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
