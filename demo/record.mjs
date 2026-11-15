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

  const ALL = await run(() => window.S.getState().targets.map((t) => t.id))
  const WIDE = { lat: 18.44, lon: 77.43, zoom: 11.6 }
  const fitStops = () => run(({ b, st }) => window.S.getState().flyTo({ points: [b, ...st].map((p) => [p.lat, p.lon]) }), { b: BASE, st: STOPS })

  console.log('warming up tiles, layers, reach map, auto planner and 3D...')
  await run(() => { const s = window.S.getState(); s.setHidden(true); s.setLayer('track', { on: false }) })
  await run((w) => window.S.getState().flyTo(w), WIDE)
  await sleep(6000)
  await fitStops()
  await sleep(6000)
  for (const id of ['slope', 'ground', 'shade', 'los', 'reach']) {
    await run((id) => window.S.getState().setLayer(id, { on: true }), id)
    await sleep(id === 'reach' ? 8000 : 2500)
    await run((id) => window.S.getState().setLayer(id, { on: false }), id)
  }
  // The auto planner once off camera, so its legs are routed and cached; then its route in 3D, so those tiles load too.
  await run((ids) => window.S.getState().runAutoPlan({ ids, minutes: 20 }), ALL)
  await run(() => window.S.getState().setView3d(true))
  await sleep(12000)
  await run(() => { const s = window.S.getState(); s.setView3d(false); s.clearStops() })
  await run(({ st }) => { const s = window.S.getState(); st.forEach((p) => s.addStop(p, p.name, p.minutes)) }, { st: STOPS })
  await run(() => { const s = window.S.getState(); s.setHidden(false); if (!s.ui.right) s.togglePanel('right') })
  await sleep(2000)
  await run(() => { const s = window.S.getState(); s.setHidden(true); s.clearStops() })
  await run((w) => window.S.getState().flyTo(w), WIDE)
  await sleep(4000)

  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
  await sleep(500)
  const shots = []
  // speed: capture the shot that many times longer than its slot and speed it up in the cut.
  // until: an action that ends the capture when it resolves (the slot is then filled from whatever length it took).
  const shot = async (i, action, { speed = 1, until = null } = {}) => {
    const t = now()
    await action()
    if (until) await until()
    await sleep(Math.max(0, t + CUT[i] * speed - now()) * 1000)
    shots.push([t, now()])
  }
  const layer = (id, on) => run(({ id, on }) => window.S.getState().setLayer(id, { on }), { id, on })

  console.log('shot 1: Jezero overview')
  // Wide view first, the Perseverance traverse drawn over it, then down to the base.
  await shot(0, async () => { await sleep(600); await layer('track', true); await sleep(1300); await fitStops() })
  console.log('shot 2: targets and route')
  await shot(1, async () => {
    await sleep(300)
    await run(({ p }) => window.S.getState().addStop(p, p.name, p.minutes), { p: STOPS[0] })
    await sleep(1300)
    await run(({ p }) => window.S.getState().addStop(p, p.name, p.minutes), { p: STOPS[1] })
  })
  console.log('shot 3: HiRISE slopes and THEMIS ground')
  await shot(2, async () => {
    await layer('track', false)
    await layer('slope', true)
    await sleep(1700)
    await layer('slope', false)
    await layer('ground', true)
  })
  console.log('shot 4: shadows and radio')
  await shot(3, async () => {
    await layer('ground', false)
    // Low morning sun, where the shadows are long enough to read.
    await run(() => window.S.getState().setSunLTST(6.6))
    await layer('shade', true)
    for (let h = 6.6; h <= 8.4; h += 0.3) { await run((h) => window.S.getState().setSunLTST(h), h); await sleep(260) }
    await layer('shade', false)
    await layer('los', true)
  })
  console.log('shot 5: verdict')
  await shot(4, async () => {
    await layer('los', false)
    await run(() => { const s = window.S.getState(); s.setHidden(false); if (!s.ui.right) s.togglePanel('right') })
    await sleep(2300)
    // Down to the readiness checks, where the new ground and radiation lines are.
    await run(() => [...document.querySelectorAll('h2,h3,div')].find((e) => e.textContent.trim() === 'Readiness checks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  })
  console.log('shot 6: reach map')
  await shot(5, async () => {
    await run(({ b }) => { const s = window.S.getState(); s.setHidden(true); s.setLayer('reach', { on: true }); s.flyTo({ lat: b.lat, lon: b.lon, zoom: 12.3 }) }, { b: BASE })
  })
  console.log('shot 7: auto planner')
  await shot(6, async () => {
    await run(() => { const s = window.S.getState(); s.setLayer('reach', { on: false }); s.clearStops() })
  }, { until: () => run((ids) => window.S.getState().runAutoPlan({ ids, minutes: 20 }), ALL).then(() => sleep(900)) })
  await run(() => window.S.getState().setView3d(true))
  await sleep(6000)
  console.log('shot 8: 3D replay with the title')
  await shot(7, async () => {
    await run(() => window.S.getState().setPlay({ t: 0, playing: true, speed: 1500 }))
    // Name and link over the last two seconds of the slot.
    await sleep(Math.max(0, CUT[7] - 2.2) * 1.8 * 1000)
    await run(() => {
      const d = document.createElement('div')
      d.innerHTML = '<div style="font-size:64px;font-weight:700;letter-spacing:-1px">Marswalk Planner</div><div style="font-size:32px;font-weight:600;color:#ffc9a8;margin-top:8px">marswalk-planner-one.vercel.app</div>'
      Object.assign(d.style, { position: 'fixed', left: '64px', bottom: '72px', zIndex: 99999, color: '#f5ede8', fontFamily: 'Inter,Segoe UI,system-ui,sans-serif', textShadow: '0 2px 18px rgba(0,0,0,.85)', opacity: 0, transition: 'opacity .5s' })
      document.body.appendChild(d)
      requestAnimationFrame(() => (d.style.opacity = 1))
    })
  }, { speed: 1.8 })
  await cdp.send('Page.stopScreencast')
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
