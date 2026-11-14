# 30-second demo

One story: pick targets - get a route and a verdict - see where you can reach - replay the walk in 3D.

The voiceover is ready: [`audio/voiceover_onyx.wav`](audio/voiceover_onyx.wav), 27.3 s. Cut the video to the voice, not the other way round.

## Storyboard

Timings come from the finished voiceover. The last 2.7 s are a title card with no voice.

| Shot | Time, s | On screen | Voice |
| --- | --- | --- | --- |
| 1 | 0.0-4.5 | Jezero map, slow zoom to the delta and the Three Forks base | Jezero Crater, from real NASA data. Where can a human walk? |
| 2 | 4.5-8.6 | Click Wildcat, then Nukshak: the route bends around the delta scarp by itself | Pick science targets - the route steers around dangerous slopes. |
| 3 | 8.6-15.3 | Plan panel: green "go" verdict and the list of checks | Every plan is checked instantly: slopes, oxygen, suit time, daylight and comms. |
| 4 | 15.3-19.1 | The reach map layer turns on | The reach map shows where you can go - and still make it back. |
| 5 | 19.1-23.6 | "3D view", then "Play": the astronaut walks, oxygen goes down | Replay it in 3D and watch the oxygen drain with every step. |
| 6 | 23.6-30.0 | Title card: Marswalk Planner + live demo link | Marswalk Planner. Plan the walk before you take it. |

Each phrase is also a separate file, `audio/shot1_onyx.wav` ... `shot6_onyx.wav`, if that is easier to place in the edit.

## Ready-made plans

Open in a clean tab. A plan from a link wins over the one saved in the browser.

**Base only (shots 1, 2, 4)** - base at the Three Forks depot, no stops. In shot 2 the targets are clicked live:

https://marswalk-planner-one.vercel.app/#plan=eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwi0KHQutC70LDQtCDQvtCx0YDQsNC30YbQvtCyIFRocmVlIEZvcmtzIl0sInMiOltdLCJwIjp7fX0

**Full route (shots 3, 5)** - Three Forks → Wildcat (45 min) → Nukshak (30 min) → base. Verdict "go", 1.4 km, about 1 h 45 min:

https://marswalk-planner-one.vercel.app/#plan=eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwi0KHQutC70LDQtCDQvtCx0YDQsNC30YbQvtCyIFRocmVlIEZvcmtzIl0sInMiOltbNzcuNDA1OTI1LDE4LjQ1ODY0Nywi0JPRgNGP0LTQsCBXaWxkY2F0LCDRhNGA0L7QvdGCINC00LXQu9GM0YLRiyIsNDVdLFs3Ny40MDE0NCwxOC40NTA3MjYsItCc0YvRgSDQndGD0LrRiNCw0LosINC_0L7QtNC90L7QttC40LUg0LTQtdC70YzRgtGLIiwzMF1dLCJwIjp7fX0

Locally the same: replace the start with `http://localhost:5174/`.

Why this route: longer loops around the delta almost always get "no-go" for radio shadow - the scarp hides the base mast. The loop on the crater floor gets "caution". Thirty seconds need a clean green verdict.

## Cut

AI assistant, auto planner, shadows and the Sun slider, radio shadow, best start time, emergency return, variants, export, briefing, Mars clock, weather, Perseverance images, editing assumptions.

The auto planner is cut on purpose: with every target selected it builds 6 stops over 12 km, and that plan gets "no-go" for comms (the planner only checks time, daylight, oxygen and passability). In a demo that looks like a bug.

## Recording

- Each shot is a separate take with 2-3 s to spare, then edited together. Tile loading and calculations stay out of frame.
- Before recording, pan over the whole area and open 3D once so the tiles are cached.
- Turn on the reach map layer (Layers panel → terrain analysis) once before shot 4, then turn it off and on again on camera.
- Set the replay to ×900: the whole walk runs in about 7 s; speed it up 1.5-2x in the edit to fit shot 5. Route drawing in shot 2 can be sped up the same way.
- `H` hides all panels (shots 1, 4), `F` is fullscreen.
- Browser window 1920×1080, zoom 100%.

## Rebuilding the voiceover

Phrase text and voice style are at the top of [`voiceover.py`](voiceover.py). Needs `OPENAI_API_KEY` (read from `app/.env.local`).

```bash
.venv/Scripts/python demo/voiceover.py onyx
```

Other voices: `ash`, `echo`, `sage` (male), `nova`, `coral`, `shimmer` (female). The script prints the time of each phrase - if the text changes, shift the storyboard to the new numbers. Pauses inside a phrase longer than 0.22 s are shortened automatically.
