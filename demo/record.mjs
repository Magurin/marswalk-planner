// Records the 30-second demo video and puts the voiceover on it.
//
//   npm run dev --prefix app        (the app on http://localhost:5174)
//   cargo run --release --manifest-path tiles/Cargo.toml   (optional: faster tiles, photo skin in 3D)
//   cd demo && npm install && npm run record
//
// Every shot is driven through the app store, so the run is repeatable. The page is captured
// with the Chrome DevTools screencast, each shot is cut from the capture and retimed to the
// length of its voiceover line, and ffmpeg encodes the result to demo/out/marswalk-demo.mp4.
import { chromium } from 'playwright'
import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const APP = process.env.APP_URL || 'http://localhost:5174/'
const W = 1920, H = 1080, FPS = 30

// Base at the Three Forks depot, no stops yet.
const BASE_ONLY = 'eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwiVGhyZWUgRm9ya3Mgc2FtcGxlIGRlcG90Il0sInMiOltdLCJwIjp7fX0'
const BASE = { lon: 77.408438, lat: 18.453419 }
const STOPS = [
  { lon: 77.405925, lat: 18.458647, name: 'Wildcat Ridge, delta front', minutes: 45 },
  { lon: 77.40144, lat: 18.450726, name: 'Cape Nukshak, delta base', minutes: 30 },
]
const VOICE = process.env.VOICE || 'onyx'
const TOTAL = 30
// Space Apps asks for AI-generated audio to be acknowledged in the file metadata as well as in text.
const AI_NOTE = 'Screen recording of Marswalk Planner. The English voiceover is AI-generated (OpenAI gpt-4o-mini-tts, voice onyx); the footage is not.'
const AI_META = ['-metadata', 'title=Marswalk Planner demo', '-metadata', `comment=${AI_NOTE}`, '-metadata', `description=${AI_NOTE}`, '-metadata:s:a:0', 'title=AI-generated voiceover (OpenAI gpt-4o-mini-tts)']
// Each shot lasts from the start of its voiceover line to the start of the next one; the last runs to TOTAL.
const LINES = JSON.parse(readFileSync(path.join(HERE, 'audio', `timings_${VOICE}.json`), 'utf8'))
const CUT = LINES.map((l, i) => +((i + 1 < LINES.length ? LINES[i + 1].start : TOTAL) - (i ? l.start : 0)).toFixed(3))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.goto(`${APP}#plan=${BASE_ONLY}`)
  await page.waitForFunction(() => document.querySelector('.leaflet-container'))
  // Import the same store module instance the app uses (after a hot reload its URL carries ?t=...).
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/store.js')
    const { useStore } = await import(url)
    window.S = useStore
  })
  await page.waitForFunction(() => window.S.getState().base && window.S.getState().terrain)
  const run = (fn, arg) => page.evaluate(fn, arg)

  // Screencast: every repaint arrives as a JPEG with a wall-clock timestamp.
  const frames = []
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, jpg: Buffer.from(data, 'base64') })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })

  console.log('warming up tiles, reach map and 3D...')
  await run(() => { const s = window.S.getState(); s.setHidden(true); s.setLayer('track', { on: false }) })
  await run(({ b }) => window.S.getState().flyTo({ lat: b.lat, lon: b.lon, zoom: 13 }), { b: BASE })
  await sleep(6000)
  await run(({ b, st }) => window.S.getState().flyTo({ points: [b, ...st].map((p) => [p.lat, p.lon]) }), { b: BASE, st: STOPS })
  await sleep(6000)
  await run(() => window.S.getState().setLayer('reach', { on: true }))
  await sleep(8000)
  await run(() => window.S.getState().setLayer('reach', { on: false }))
  await run(({ st }) => { const s = window.S.getState(); st.forEach((p) => s.addStop(p, p.name, p.minutes)) }, { st: STOPS })
  await sleep(3000)
  await run(() => window.S.getState().setView3d(true))
  await sleep(12000)
  await run(() => { const s = window.S.getState(); s.setView3d(false); s.clearStops() })
  await run(({ b }) => window.S.getState().flyTo({ lat: b.lat, lon: b.lon, zoom: 13 }), { b: BASE })
  await sleep(4000)

  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
  await sleep(500)
  const shots = []
  const shot = async (seconds, action) => { const t = now(); await action(); await sleep(Math.max(0, t + seconds - now()) * 1000); shots.push([t, now()]) }

  console.log('shot 1: Jezero overview')
  await shot(CUT[0], async () => {
    await sleep(1200)
    await run(({ b, st }) => window.S.getState().flyTo({ points: [b, ...st].map((p) => [p.lat, p.lon]) }), { b: BASE, st: STOPS })
  })
  console.log('shot 2: targets and route')
  await shot(CUT[1], async () => {
    await sleep(400)
    await run(({ p }) => window.S.getState().addStop(p, p.name, p.minutes), { p: STOPS[0] })
    await sleep(1600)
    await run(({ p }) => window.S.getState().addStop(p, p.name, p.minutes), { p: STOPS[1] })
  })
  console.log('shot 3: verdict')
  await shot(CUT[2], async () => {
    await run(() => { const s = window.S.getState(); s.setHidden(false); if (!s.ui.right) s.togglePanel('right') })
  })
  console.log('shot 4: reach map')
  await shot(CUT[3], async () => {
    await run(({ b }) => { const s = window.S.getState(); s.setHidden(true); s.setLayer('reach', { on: true }); s.flyTo({ lat: b.lat, lon: b.lon, zoom: 13.5 }) }, { b: BASE })
  })
  await run(() => { const s = window.S.getState(); s.setLayer('reach', { on: false }); s.setView3d(true) })
  await sleep(5000)
  console.log('shot 5: 3D replay')
  // The replay is captured longer than its slot and sped up in the cut.
  await shot(CUT[4] * 1.6, async () => {
    await run(() => window.S.getState().setPlay({ t: 0, playing: true, speed: 900 }))
  })
  await cdp.send('Page.stopScreencast')

  console.log('shot 6: title card')
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#2a130c,#0b0b0d 70%);font-family:Inter,Segoe UI,system-ui,sans-serif;color:#f5ede8">
    <div style="text-align:center">
      <div style="width:92px;height:92px;margin:0 auto 36px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f08a5d,#b83b1e 60%,#5a1a0c)"></div>
      <div style="font-size:96px;font-weight:700;letter-spacing:-2px">Marswalk Planner</div>
      <div style="font-size:38px;opacity:.75;margin-top:18px">EVA route planning at Jezero Crater, Mars</div>
      <div style="font-size:32px;color:#f08a5d;margin-top:56px">marswalk-planner-one.vercel.app</div>
    </div></body></html>`)
  await sleep(500)
  const title = await page.screenshot({ type: 'jpeg', quality: 95 })
  await browser.close()

  // Retime each shot to its cut length: the output frame at time k/FPS shows the latest
  // captured frame at the matching moment of the source window.
  const out = []
  shots.forEach(([t0, t1], i) => {
    const n = Math.round(CUT[i] * FPS)
    let j = 0
    const src = frames.filter((f) => f.t <= t1)
    for (let k = 0; k < n; k++) {
      const t = t0 + (k / n) * (t1 - t0)
      while (j + 1 < src.length && src[j + 1].t <= t) j++
      out.push(src[j].jpg)
    }
    console.log(`  shot ${i + 1}: ${(t1 - t0).toFixed(1)} s captured -> ${CUT[i]} s`)
  })
  for (let k = 0; k < Math.round(CUT[5] * FPS); k++) out.push(title)
  console.log(`${frames.length} frames captured, ${out.length} output frames`)

  const mp4 = path.join(OUT, 'marswalk-demo.mp4')
  const total = TOTAL
  const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-i', path.join(HERE, 'audio', `voiceover_${VOICE}.wav`),
    '-vf', `scale=${W}:${H},format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=${total - 0.6}:d=0.6`,
    '-af', `apad,afade=t=out:st=${total - 0.6}:d=0.6`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-t', String(total), ...AI_META, '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] })
  for (const jpg of out) if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
  ff.stdin.end()
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error(`ffmpeg exited ${c}`)) : r())))
  console.log(`done: ${mp4}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
