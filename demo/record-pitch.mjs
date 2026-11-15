// Records the 2-minute silent walkthrough shown next to the slides in a live pitch.
//
//   npm run dev --prefix app        (the app on http://localhost:5174)
//   tiles/target/release/marswalk-tiles.exe   (optional: faster tiles, photo skin in 3D)
//   cd demo && npm run record:pitch
//
// Same approach as record.mjs: every scene is driven through the app store or its real buttons,
// the page is captured with the Chrome DevTools screencast and each scene is retimed to its
// slot. No audio: the presenter talks over it (see PITCH.md for the script and the timings).
import { chromium } from 'playwright'
import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'out')
const APP = process.env.APP_URL || 'http://localhost:5174/'
const W = 1920, H = 1080, FPS = 30
// Ask the in-app assistant a question on camera. Needs OPENAI_API_KEY in app/.env.local; ASSISTANT=0 skips the scene.
const ASSISTANT = process.env.ASSISTANT !== '0'
const QUESTION = 'Is this walk safe? What is the weakest point?'

const BASE_ONLY = 'eyJiIjpbNzcuNDA4NDM4LDE4LjQ1MzQxOSwiVGhyZWUgRm9ya3Mgc2FtcGxlIGRlcG90Il0sInMiOltdLCJwIjp7fX0'
const BASE = { lon: 77.408438, lat: 18.453419 }
const STOPS = [
  { lon: 77.405925, lat: 18.458647, name: 'Wildcat Ridge, delta front', minutes: 45 },
  { lon: 77.40144, lat: 18.450726, name: 'Cape Nukshak, delta base', minutes: 30 },
]
const NOTE = 'Screen recording of Marswalk Planner. No audio. The footage is not AI-generated.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.goto(`${APP}#plan=${BASE_ONLY}`)
  await page.waitForFunction(() => document.querySelector('.leaflet-container'))
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/store.js')
    const { useStore } = await import(url)
    window.S = useStore
  })
  await page.waitForFunction(() => window.S.getState().base && window.S.getState().terrain)
  const run = (fn, arg) => page.evaluate(fn, arg)
  // A real click on a real button; a miss is logged, not fatal, so one renamed label does not lose the take.
  const click = async (name, opts = {}) => {
    try { await page.getByRole(opts.role || 'button', { name, exact: opts.exact ?? false }).first().click({ timeout: 2500 }) }
    catch { console.log(`  ! no button "${name}"`) }
  }
  const scrollTo = (text) => run((text) => [...document.querySelectorAll('h2,h3,div,span')].find((e) => e.textContent.trim() === text)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), text)

  const frames = []
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, jpg: Buffer.from(data, 'base64') })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })

  const ALL = await run(() => window.S.getState().targets.map((t) => t.id))
  const WIDE = { lat: 18.44, lon: 77.43, zoom: 11.6 }
  const layer = (id, on) => run(({ id, on }) => window.S.getState().setLayer(id, { on }), { id, on })
  const fitStops = () => run(({ b, st }) => window.S.getState().flyTo({ points: [b, ...st].map((p) => [p.lat, p.lon]) }), { b: BASE, st: STOPS })
  const addStops = () => run(({ st }) => { const s = window.S.getState(); st.forEach((p) => s.addStop(p, p.name, p.minutes)) }, { st: STOPS })
  const panels = (left, right, profile) => run(({ left, right, profile }) => {
    const s = window.S.getState()
    s.setHidden(false)
    for (const [k, want] of [['left', left], ['right', right], ['profile', profile]]) if (!!window.S.getState().ui[k] !== want) window.S.getState().togglePanel(k)
  }, { left, right, profile })
  const mapOnly = () => run(() => window.S.getState().setHidden(true))

  console.log('warming up tiles, layers, reach map, auto planner and 3D...')
  await run(() => { const s = window.S.getState(); s.setHidden(true); s.setLayer('track', { on: false }); s.setLeftTab('layers') })
  await run((w) => window.S.getState().flyTo(w), WIDE)
  await sleep(6000)
  await fitStops()
  await sleep(6000)
  for (const id of ['mola', 'themisNight', 'slope', 'ground', 'shade', 'los', 'reach']) {
    await layer(id, true)
    await sleep(id === 'reach' ? 8000 : 2500)
    await layer(id, false)
  }
  await run((ids) => window.S.getState().runAutoPlan({ ids, minutes: 20 }), ALL)
  await run(() => window.S.getState().setView3d(true))
  await sleep(12000)
  await run(() => { const s = window.S.getState(); s.setView3d(false); s.clearStops() })
  await addStops()
  await run(() => window.S.getState().setView3d(true))
  await sleep(8000)
  await run(() => window.S.getState().setView3d(false))
  await panels(true, true, true)
  await sleep(2500)
  await run(() => { const s = window.S.getState(); s.setHidden(true); s.clearStops() })
  await run((w) => window.S.getState().flyTo(w), WIDE)
  await sleep(4000)

  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
  await sleep(500)
  const scenes = []
  // len: seconds of this scene in the video. speed: capture that many times longer and speed it up.
  // until: ends the capture when it resolves, whatever it took (the slot is filled from that).
  const scene = async (title, len, action, { speed = 1, until = null } = {}) => {
    console.log(`scene ${scenes.length + 1}: ${title}`)
    const t = now()
    await action()
    if (until) await until()
    else await sleep(Math.max(0, t + len * speed - now()) * 1000)
    scenes.push({ title, len, t0: t, t1: now() })
  }

  await scene('Jezero overview and the Perseverance traverse', 8, async () => {
    await sleep(1200); await layer('track', true); await layer('heli', true); await sleep(2600); await fitStops()
  })
  await scene('Orbital layers: MOLA elevation, THEMIS night infrared', 7, async () => {
    await sleep(400); await layer('mola', true); await sleep(3000); await layer('mola', false); await layer('themisNight', true); await sleep(3000); await layer('themisNight', false)
  })
  await scene('Pick two science targets, the route goes around the scarp', 8, async () => {
    await layer('heli', false)
    await sleep(900)
    await run(({ p }) => window.S.getState().addStop(p, p.name, p.minutes), { p: STOPS[0] })
    await sleep(3000)
    await run(({ p }) => window.S.getState().addStop(p, p.name, p.minutes), { p: STOPS[1] })
  })
  await scene('Slopes from HiRISE, loose ground from THEMIS', 9, async () => {
    await layer('track', false); await layer('slope', true); await sleep(4400); await layer('slope', false); await layer('ground', true)
  })
  await scene('Shadows through the morning, radio shadow from the base mast', 10, async () => {
    await layer('ground', false)
    await run(() => window.S.getState().setSunLTST(6.4))
    await layer('shade', true)
    for (let h = 6.4; h <= 9.01; h += 0.2) { await run((h) => window.S.getState().setSunLTST(h), h); await sleep(380) }
    await layer('shade', false); await layer('los', true)
  })
  await scene('The verdict: go, with every number', 7, async () => {
    await layer('los', false)
    await panels(false, true, false)
  })
  await scene('Readiness checks, one by one', 9, async () => {
    await scrollTo('Readiness checks')
    await sleep(4200)
    await run(() => { const el = [...document.querySelectorAll('h2,h3,div,span')].find((e) => e.textContent.trim() === 'Readiness checks'); let p = el?.parentElement; while (p && p.scrollHeight <= p.clientHeight + 4) p = p.parentElement; p?.scrollBy({ top: 420, behavior: 'smooth' }) })
  })
  await scene('Elevation profile and the best start time', 9, async () => {
    await scrollTo('EVA plan')
    await panels(false, true, true)
    await sleep(3200)
    await click('Find best start time')
    await sleep(600)
    await scrollTo('Find best start time')
  })
  await scene('Open assumptions: a smaller tank turns the plan to no-go', 9, async () => {
    await click('Hide start times')
    await scrollTo('EVA plan')
    await sleep(700)
    await click('Assumptions')
    await sleep(3200)
    await page.keyboard.press('Escape')
    await sleep(500)
    await run(() => window.S.getState().setParam('o2TankKg', 0.15))
    await sleep(3200)
    await run(() => window.S.getState().setParam('o2TankKg', 0.75))
  })
  await scene('Reach map: where you can go and still get back', 8, async () => {
    await mapOnly()
    await run(({ b }) => { const s = window.S.getState(); s.setLayer('reach', { on: true }); s.flyTo({ lat: b.lat, lon: b.lon, zoom: 12.3 }) }, { b: BASE })
  })
  await scene('Auto planner: the most science that fits one EVA', 9, async () => {
    await run(() => { const s = window.S.getState(); s.setLayer('reach', { on: false }); s.clearStops() })
    await panels(false, true, false)
    await sleep(600)
    await click('Auto plan')
    await sleep(2400)
  }, { until: async () => { await click('Build route'); await sleep(300); await page.waitForFunction(() => window.S.getState().autoBusy == null, null, { timeout: 60000 }).catch(() => {}); await run(() => window.S.getState().fitPlan()); await sleep(2600) } })
  if (ASSISTANT) {
    await scene('AI assistant answers from the model', 9, async () => {
      await run(() => window.S.getState().openAssistant())
      await sleep(900)
      const box = page.getByLabel('Message the Assistant').first()
      await box.click({ timeout: 2500 }).catch(() => {})
      await page.keyboard.type(QUESTION, { delay: 28 })
      await sleep(400)
      await click('Send', { exact: true })
    }, { until: async () => { await sleep(1500); await page.waitForFunction(() => window.S.getState().chat.busy == null, null, { timeout: 60000 }).catch(() => {}); await sleep(3500) } })
  }
  await scene('Printable briefing', 7, async () => {
    await run(() => { const s = window.S.getState(); s.setLeftTab('layers'); s.setBriefing(true) })
    await sleep(2200)
    await run(() => { const el = [...document.querySelectorAll('h2,h3,div')].find((e) => e.textContent.trim() === 'Schedule'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }) })
  })
  await run(() => { const s = window.S.getState(); s.setBriefing(false); s.clearStops() })
  await addStops()
  await run(() => window.S.getState().setView3d(true))
  await sleep(7000)
  await scene('Walk it in 3D', 18, async () => {
    await sleep(1500)
    await run(() => window.S.getState().setPlay({ t: 0, playing: true, speed: 300 }))
    await sleep(22000)
    await run(() => {
      const d = document.createElement('div')
      d.innerHTML = '<div style="font-size:64px;font-weight:700;letter-spacing:-1px">Marswalk Planner</div><div style="font-size:32px;font-weight:600;color:#ffc9a8;margin-top:8px">marswalk-planner-one.vercel.app</div>'
      Object.assign(d.style, { position: 'fixed', left: '64px', bottom: '72px', zIndex: 99999, color: '#f5ede8', fontFamily: 'Inter,Segoe UI,system-ui,sans-serif', textShadow: '0 2px 18px rgba(0,0,0,.85)', opacity: 0, transition: 'opacity .5s' })
      document.body.appendChild(d)
      requestAnimationFrame(() => (d.style.opacity = 1))
    })
  }, { speed: 1.6 })
  await cdp.send('Page.stopScreencast')
  await browser.close()

  // Retime each scene to its slot: the output frame at k/FPS shows the latest captured frame
  // at the matching moment of the source window.
  const out = []
  let at = 0
  const timeline = scenes.map(({ title, len, t0, t1 }) => {
    const n = Math.round(len * FPS)
    let j = 0
    const src = frames.filter((f) => f.t <= t1)
    for (let k = 0; k < n; k++) {
      const t = t0 + (k / n) * (t1 - t0)
      while (j + 1 < src.length && src[j + 1].t <= t) j++
      out.push(src[j].jpg)
    }
    console.log(`  ${at.toFixed(0).padStart(3)} s  ${title}: ${(t1 - t0).toFixed(1)} s captured -> ${len} s`)
    const row = { start: at, length: len, title }
    at += len
    return row
  })
  const total = at
  writeFileSync(path.join(OUT, 'marswalk-pitch-timeline.json'), JSON.stringify(timeline, null, 2))
  console.log(`${frames.length} frames captured, ${out.length} output frames, ${total} s`)

  const mp4 = path.join(OUT, 'marswalk-pitch.mp4')
  const ff = spawn(ffmpegPath, ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=${W}:${H},format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=${total - 0.6}:d=0.6`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', String(FPS), '-an',
    '-metadata', 'title=Marswalk Planner walkthrough', '-metadata', `comment=${NOTE}`, '-metadata', `description=${NOTE}`,
    '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] })
  for (const jpg of out) if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r))
  ff.stdin.end()
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error(`ffmpeg exited ${c}`)) : r())))
  console.log(`done: ${mp4}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
