# Marswalk Planner - live pitch script

Presenter: Igor Stolyarov, team captain. NASA Space Apps Challenge 2026, challenge "Interplanetary Survival Guide: Martian Map".

## 1. How to use

Show the deck first, then play the silent screen recording and talk over it, then go back to slide 7 for the close. Lines in quote blocks are the exact words to say. Text in [brackets] is a note for you, not to be spoken. Do not read the slides aloud - the words below add what the slides do not say. Speak slowly: about 2 words per second. If you fall behind in the video, skip a line and wait for the next scene. Never rush to catch up.

| Version | Slides | Video | Close | Total |
| --- | --- | --- | --- | --- |
| FULL | slides 1-6, about 2:10 | 2:07 | slide 7, about 0:40 | about 5:00 |
| SHORT | slides 1-2 only, about 0:35 | 2:07 | slide 7, one sentence, about 0:10 | about 3:00 |

Video timings below match the recorded timeline (demo/out/marswalk-pitch-timeline.json, 14 scenes, 2:07). If the video is recorded again, check that file first. On stage, watch the screen, not the clock.

## 2. Slide script (FULL version)

### Slide 1 - Cover (10 s) [Presentation]

> Hello. I am Igor Stolyarov. This is Marswalk Planner. It is about one walk on Mars, and one question.

### Slide 2 - The question (25 s) [Impact, Presentation]

> Perseverance has already done the scouting in Jezero Crater. We know where a person should go.
>
> But a map shows the place. It does not tell you if you get home.
>
> The challenge asks for a layered view that helps an explorer plan a safe Marswalk and still do science.

### Slide 3 - The solution (20 s) [Presentation, Validity]

> So we built a planner, not only a map.
>
> You choose the science stops. The app finds the path over real terrain. Then it checks that walk against the suit.
>
> You get one clear answer: go, caution, or no-go. I will show it in a minute.

### Slide 4 - NASA data (25 s) [Relevance]

> NASA data is the engine here, not the background.
>
> HiRISE and CTX give the shape of the ground. THEMIS tells loose sand from firm rock. Perseverance gives the targets and the weather. Curiosity gives the radiation rate.
>
> Optical, topographic, thermal, atmospheric and radiation data, in one view. No data comes from AI.

### Slide 5 - The science (25 s) [Validity]

> The math comes from published work.
>
> Walking speed follows a Tobler-style curve. Energy follows Santee, the same form MIT uses in its traverse planner, at Mars gravity. Mars time follows the algorithm behind NASA's Mars24 clock.
>
> Every number is an open assumption, and you can edit it. This is a planning aid, not flight rules.

### Slide 6 - What is new (25 s) [Creativity]

> What is new is the focus on the way back.
>
> The reach map shows where you can walk, work, and still get home. The emergency check finds the worst moment for a leak or an injury. The auto planner fits the most science into one walk.
>
> Now let me show you. [start the video]

### SHORT version - slides 1 and 2 only (35 s) [Impact, Relevance, Presentation]

> Hello. I am Igor Stolyarov. This is Marswalk Planner.
>
> Perseverance has already done the scouting in Jezero Crater. We know where a person should go. What a map does not tell you is if you get home.
>
> So we put data from many NASA missions into one planner. It finds a safe route and gives one answer: go, caution, or no-go. Let me show you. [start the video]

## 3. Video narration (2:07, silent recording)

Say each line when its scene starts. "Pause" means say nothing or almost nothing and let the picture work.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 - 0:08 | Wide view of Jezero. Perseverance traverse and Ingenuity flights appear. Zoom to the base at the Three Forks depot. | This is Jezero Crater, with the real Perseverance track. Our base is the Three Forks depot. |
| 0:08 - 0:15 | Layers switch: MOLA colour elevation, then THEMIS night infrared. | Same place, other missions. Elevation from MOLA. Night infrared from THEMIS. |
| 0:15 - 0:23 | Two science targets added. The route bends around the delta scarp. | I add two science targets. The route goes around the scarp by itself. |
| 0:23 - 0:32 | Slope hazard layer, then loose ground layer. | Slopes too steep for a suit, from one-meter HiRISE terrain. Then loose ground, from THEMIS. |
| 0:32 - 0:42 | Terrain shadows sweep through the morning. Then the radio shadow from the base mast. | **Pause - let it play.** One short line only: Morning shadows. Then the radio shadow from the base. |
| 0:42 - 0:49 | Plan panel opens: green GO, 1.41 km, 1 h 45 min, oxygen, energy, radio link. | The verdict is go. One point four one kilometers. One hour forty-five minutes. |
| 0:49 - 0:58 | Scroll through the readiness checks. | **Pause - let it play.** One short line only: Twelve checks. The worst one sets the verdict. |
| 0:58 - 1:07 | Elevation profile. "Find best start time" shows a bar for every quarter hour of daylight. | The height profile. And the same walk, tested for every quarter hour of daylight. |
| 1:07 - 1:16 | Assumptions dialog. Oxygen tank cut from 0.75 to 0.15 kg, verdict flips to no-go, then restored. | Every assumption is open. I cut the oxygen tank. Now it is no-go. I put it back. |
| 1:16 - 1:24 | Reach map. | The reach map. Where you can walk, work thirty minutes, and still get home. |
| 1:24 - 1:33 | Auto planner dialog, Build route. | The auto planner. It picks the most science targets that fit in one walk. |
| 1:33 - 1:42 | AI assistant is asked "Is this walk safe? What is the weakest point?" and answers. | I ask the assistant: is this walk safe? Its numbers come from our model. |
| 1:42 - 1:49 | Printable EVA briefing: route map, schedule, checks. | And a briefing you can print. |
| 1:49 - 2:07 | 3D replay: the astronaut walks the route. Title and live link at the end. | Now we walk it. **Pause - let it play for about 8 seconds.** Then: Real terrain. Real targets. One walk, checked before anyone takes it. |

## 4. Close (back to slide 7)

### FULL close (40 s) [Impact, Validity, Presentation]

> Marswalk Planner turns layers from many NASA missions into one answer for an explorer: can I go, do the science, and get home.
>
> It is for mission thinking and for learning. It runs in a browser today.
>
> It has limits, and we name them. Solar particle events, suit heat and comms relays are not in the model yet. Those are the next steps.
>
> The app is live and the code is open. AI helped write the code. It gave no data.
>
> Plan the walk before you take it.

### SHORT close (10 s)

> Many NASA missions, one answer for the explorer. The app is live and the code is open. Plan the walk before you take it.

## 5. Likely judge questions

**How accurate is the routing?**
It runs on a 20 meter grid from the CTX terrain model. Where we have the 1 meter HiRISE model, about a third of the area, each cell also knows how rough it is. Single rocks under a couple of meters stay invisible. So the route says where the ground is passable, not where to put a foot.

**Why Jezero?**
Perseverance has already found the targets there: the Three Forks depot, the organic-bearing mudstones, Cheyava Falls. And the data is there: 1 meter and 20 meter terrain models, the rover track, MEDA weather from the rover itself.

**What is not modelled?**
Solar particle events. Dust and atmospheric opacity. Suit thermal balance and water use. Comms relays and orbiters - radio is plain line of sight. Cold is a warning only, it does not enter the energy model.

**Is the oxygen model validated?**
No, not for a real suit. It uses the Santee metabolic model at Mars gravity and 20.1 kilojoules per litre of oxygen, plus a reserve of 45 minutes of walking. These are reasoned assumptions from published work, not certified figures. That is why every one of them is editable.

**Where does the radiation number come from?**
From the RAD instrument on Curiosity: 0.64 millisievert per day on the surface, measured in Gale Crater, not Jezero. We show the dose for the walk against NASA's 600 millisievert career limit. It is for information. It does not change the verdict.

**How did you use AI?**
Three ways, all declared in the README. Claude Code helped write and debug the code and the README. An OpenAI model runs the in-app assistant. An OpenAI voice read the short demo video. No data comes from AI. The assistant can change the plan only through the same actions as the buttons, so its numbers come from our model.

**What is new compared with NASA Mars Trek?**
Mars Trek is where our map tiles come from. It gives the layers. We add a walking model on top: a route over terrain, oxygen, time, daylight, radio, and one verdict. I have not done a full feature comparison, so I will not claim more than that.

**Can it work for other sites?**
Today it is Jezero only. A route can be planned only inside our terrain model. The model code does not depend on the site or on the UI, but another site needs its own terrain, targets and weather prepared. We have not done that yet.

**How well is it tested?** (if asked)
Honestly: only the tile cache has automated tests. The JavaScript model has none yet.

## 6. Checklist before going on stage

- Open the live app in a browser tab as a backup: marswalk-planner-one.vercel.app. Load it once so the map tiles are cached.
- Open the video player with the recording, muted, on loop, paused at 0:00.
- Deck on slide 1, in presenter mode. Know the key that switches from the deck to the video and back.
- Type nothing into the app on stage. No forms, no assistant prompt. If the video fails, show the live app with the demo plan already loaded and say the same lines.
- Check the screen resolution on the projector: the GO verdict and the numbers must be readable from the back.
- Have the code link ready in case judges ask: github.com/Magurin/marswalk-planner.
- Water. One slow breath before "Hello".
- Decide before you start: FULL or SHORT. Do not switch in the middle.
