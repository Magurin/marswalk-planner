import { create } from 'zustand'
import { toast } from 'sonner'
import { Terrain } from '@/lib/terrain'
import { marsTime } from '@/lib/marstime'
import { DEFAULTS, analyze, speedMs, vmaxMs } from '@/lib/eva'
import { TARGETS, PRESETS, LAYERS, EXCLUSIVE } from '@/lib/catalog'
import { fx, plural } from '@/lib/fmt'
import { calc } from '@/lib/calc'
import { reachKey, abortAnalysis } from '@/lib/reach'

export const SITE = { name: 'Jezero Crater', lon: 77.45, lat: 18.445 }
const FEEDS = {
  waypoints: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json',
  meda: 'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json',
  rems: 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
}
// v4: names are in English now, so an old Russian plan is not restored.
const STORE_KEY = 'marswalk.plan.v4'
const UI_KEY = 'marswalk.ui.v1'
// v2: same reason as STORE_KEY v4.
const VARIANTS_KEY = 'marswalk.variants.v2'
// Layers panel 340 + plan panel 400 + gaps leave under ~560 px of map below this width.
export const roomForBothPanels = () => window.innerWidth >= 1320
const loadJson = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def } catch { return def } }
const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } }

// A plan packed into the address bar: #plan=<base64 of compact JSON>. Only parameters that differ from the defaults go in.
function encodePlan({ base, stops, params, routing }) {
  const r6 = (v) => +(+v).toFixed(6)
  const p = Object.fromEntries(Object.entries(params).filter(([k, v]) => DEFAULTS[k] !== v))
  const json = JSON.stringify({ b: [r6(base.lon), r6(base.lat), base.name], s: stops.map((s) => [r6(s.lon), r6(s.lat), s.name, s.minutes]), p, r: routing === 'terrain' ? undefined : routing })
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decodePlan(code) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
  const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  return {
    base: { lon: j.b[0], lat: j.b[1], name: j.b[2] || 'Base' },
    stops: (j.s || []).map(([lon, lat, name, minutes]) => ({ lon, lat, name, minutes: minutes ?? 20 })),
    params: { ...DEFAULTS, ...j.p }, routing: j.r || 'terrain',
  }
}
const planFromHash = () => {
  const m = typeof location !== 'undefined' && location.hash.match(/plan=([\w-]+)/)
  if (!m) return null
  try { return decodePlan(m[1]) } catch { return null }
}
// Which floating panels sit on top of the map. The left one starts closed on narrower screens so the map stays the hero.
function loadUi() {
  const def = { left: typeof window !== 'undefined' && window.innerWidth >= 1440, right: true, profile: true }
  try { return { ...def, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') } } catch { return def }
}
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
const routeCache = new Map()

export function jezeroWx(weather) {
  const s = weather && [...(weather.meda.sols || [])].reverse().find((x) => num(x.min_temp) != null && num(x.max_temp) != null)
  return s ? { tmin: num(s.min_temp), tmax: num(s.max_temp), p: num(s.pressure), sol: s.sol, date: s.terrestrial_date, ls: num(s.ls) } : null
}
const trimRems = (soles) => soles.map((s) => ({ sol: +s.sol, date: s.terrestrial_date, ls: num(s.ls), tmin: num(s.min_temp), tmax: num(s.max_temp), p: num(s.pressure), op: s.atmo_opacity, uv: s.local_uv_irradiance_index }))

function legRoute(terrain, a, b, routing, p) {
  if (routing !== 'terrain') return { line: [a, b] }
  // The pace on the flat scales every leg alike, so it does not change which path is fastest: only the slope limit does.
  const key = [a, b, p.maxSlopeDeg].flat().map((v) => (+v).toFixed(6)).join(',')
  if (!routeCache.has(key)) routeCache.set(key, terrain.route(a, b, { speed: (g) => speedMs(g, p), vmax: vmaxMs(p), maxSlope: p.maxSlopeDeg }))
  const line = routeCache.get(key)
  return line ? { line } : { line: [a, b], failed: true }
}

function plan(s) {
  const { terrain, base, stops, params, routing, mt, reach } = s
  if (!terrain || !base || !mt || !stops.length) return { legs: [], result: null, play: { ...s.play, t: null, playing: false } }
  const pts = [base, ...stops, base].map((p) => [p.lon, p.lat])
  const legs = [], failed = []
  for (let i = 0; i < pts.length - 1; i++) {
    const r = legRoute(terrain, pts[i], pts[i + 1], routing, params)
    if (r.failed) failed.push(i)
    legs.push(r.line)
  }
  const result = analyze(terrain, legs, [...stops, null], [base.lon, base.lat], params, planEnv(s))
  if (failed.length) {
    result.checks.unshift({ id: 'route', label: 'Route planning', status: 'nogo', detail: `No walkable path with slopes up to ${fx(params.maxSlopeDeg)}° on ${failed.length > 1 ? 'legs' : 'leg'} ${failed.map((i) => i + 1).join(', ')}. Showing a straight line.` })
    result.overall = 'nogo'
  }
  // The emergency check needs the return field around this very base, which arrives from the worker a moment later.
  const abort = reach && reach.key === reachKey(base, params) ? abortAnalysis(result, reach, terrain, params) : null
  if (abort) {
    result.abort = abort
    result.checks.push(abort.check)
    const order = { go: 0, caution: 1, nogo: 2 }
    if (order[abort.check.status] > order[result.overall]) result.overall = abort.check.status
  }
  const play = s.play.t != null && s.play.t > result.hours * 3600 ? { ...s.play, t: result.hours * 3600, playing: false } : s.play
  return { legs, result, play }
}

const planEnv = (s) => ({ viewshed: s.viewshed, sunrise: s.mt.sunrise, sunset: s.mt.sunset, decl: s.mt.decl, wx: jezeroWx(s.weather) })

// The same legs started at every quarter hour of daylight: verdict, shadow and cold for each start time.
export function startOptions(s) {
  const { terrain, base, stops, params, legs, mt } = s
  if (!terrain || !base || !stops.length || !legs.length) return []
  const env = planEnv(s), out = []
  const order = { go: 0, caution: 1, nogo: 2 }
  for (let h = Math.ceil(mt.sunrise * 4) / 4; h <= mt.sunset - 0.5; h += 0.25) {
    const R = analyze(terrain, legs, [...stops, null], [base.lon, base.lat], { ...params, startLTST: h }, env)
    out.push({ h, overall: R.overall, shadowPct: R.shadowPct ?? 0, tLo: R.tLo, issues: R.checks.filter((c) => c.status !== 'go').length, score: order[R.overall] * 1000 + R.checks.filter((c) => c.status !== 'go').length * 100 + (R.shadowPct ?? 0) })
  }
  return out
}

export const useStore = create((set, get) => {
  // Every state change that affects the plan goes through here so the route stays in sync.
  const commit = (patch) => {
    set(patch)
    set(plan(get()))
    const { base, stops, params, routing } = get()
    saveJson(STORE_KEY, { base, stops, params, routing })
    requestReach()
  }
  const viewshedFor = (base, params) => get().terrain.viewshed(base.lon, base.lat, params.mastM)
  // Prepares the router's map of connected walkable ground while the page is idle, so the pass never delays a click.
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 300)
  const warmRouter = () => idle(() => { const { terrain, params } = get(); terrain?.walkable(params.maxSlopeDeg) })

  // Out and back fields around the base, recomputed in the worker when the base or the walking model changes.
  let reachAsked = null
  const requestReach = () => {
    const { base, params, ready, terrain } = get()
    const key = reachKey(base, params)
    if (!terrain || !ready || !key || key === reachAsked) return
    reachAsked = key
    set({ reachBusy: true })
    calc('reach', { base: { lon: base.lon, lat: base.lat }, p: params }).then((reach) => {
      if (!reach) return // a newer request replaced this one
      set({ reachBusy: false })
      if (reach.key !== reachKey(get().base, get().params)) return
      set({ reach })
      set(plan(get()))
    }).catch((e) => { set({ reachBusy: false }); console.error(e) })
  }

  return {
    ready: false, error: null,
    terrain: null, m20: null, weather: null, live: { meda: false, rems: false, rover: false },
    targets: TARGETS.map((t) => ({ ...t })),
    params: { ...DEFAULTS }, routing: 'terrain', base: null, stops: [],
    viewshed: null, legs: [], result: null,
    mt: marsTime(new Date(), SITE.lon, SITE.lat), sunLTST: 9,
    layers: Object.fromEntries(LAYERS.map((l) => [l.id, { on: !!l.on, opacity: l.opacity ?? 1 }])),
    pickBase: false, hover: null, cursor: null, focus: null, panel: null, cmdOpen: false, fullscreen: false, ui: loadUi(), hidden: false,
    reach: null, reachBusy: false,
    // Walk replay: t is seconds since the start of the walk, null when the replay is off.
    play: { t: null, playing: false, speed: 300 },
    variants: loadJson(VARIANTS_KEY, []), ghost: null,
    briefing: false, view3d: false, autoBusy: null,
    // AI assistant chat. prevId chains the conversation on the OpenAI side.
    chat: { msgs: [], busy: null, prevId: null }, leftTab: 'layers',

    tick: () => set({ mt: marsTime(new Date(), SITE.lon, SITE.lat) }),
    setPlay: (patch) => set((s) => ({ play: { ...s.play, ...patch } })),
    setGhost: (ghost) => set({ ghost }),
    setBriefing: (briefing) => set({ briefing }),
    setView3d: (view3d) => set({ view3d }),
    setChat: (patch) => set((s) => ({ chat: { ...s.chat, ...patch } })),
    setLeftTab: (leftTab) => set({ leftTab }),
    // Desktop: the assistant is a tab of the left panel. Phones: its own drawer.
    openAssistant: () => {
      if (window.matchMedia('(min-width: 1024px)').matches) { if (!get().ui.left) get().togglePanel('left'); set({ leftTab: 'assistant', hidden: false }) }
      else set({ panel: 'assistant' })
    },
    setCursor: (cursor) => set({ cursor }),
    setHover: (hover) => set({ hover }),
    setCmdOpen: (cmdOpen) => set({ cmdOpen }),
    setPanel: (panel) => set({ panel }),
    togglePanel: (k) => {
      const ui = { ...get().ui, [k]: !get().ui[k] }
      // Too narrow for both side panels and a usable map: opening one side closes the other.
      if (ui[k] && (k === 'left' || k === 'right') && !roomForBothPanels()) ui[k === 'left' ? 'right' : 'left'] = false
      set({ ui, hidden: false })
      try { localStorage.setItem(UI_KEY, JSON.stringify(ui)) } catch { /* storage unavailable */ }
    },
    // Hide every panel at once and leave only the map.
    setHidden: (hidden) => set({ hidden }),
    // Real browser fullscreen. The flag itself is synced from the fullscreenchange event in App.
    toggleFullscreen: () => {
      if (document.fullscreenElement) return void document.exitFullscreen?.().catch(() => {})
      const req = document.documentElement.requestFullscreen?.()
      if (!req) return void toast.warning('Full screen is not available here')
      req.catch(() => toast.warning('The browser blocked full screen', { description: 'Open the app in a regular browser tab and press F.' }))
    },
    setPickBase: (pickBase) => set({ pickBase }),
    setSunLTST: (sunLTST) => set({ sunLTST }),
    flyTo: (target) => set({ focus: { ...target, n: Date.now() } }),
    setLayer: (id, patch) => set((s) => {
      const layers = { ...s.layers, [id]: { ...s.layers[id], ...patch } }
      if (patch.on) for (const o of EXCLUSIVE[id] ?? []) if (layers[o].on) layers[o] = { ...layers[o], on: false }
      return { layers }
    }),

    setBase: (pt, name = 'Custom base') => {
      const base = { lon: pt.lon, lat: pt.lat, name }
      routeCache.clear()
      commit({ base, viewshed: viewshedFor(base, get().params), pickBase: false })
      toast.success('Base moved', { description: name })
    },
    addStop: (pt, name, minutes = 20) => {
      const stops = [...get().stops, { lon: pt.lon, lat: pt.lat, name: name || `Stop ${get().stops.length + 1}`, minutes }]
      commit({ stops })
      const r = get().result
      toast(`Stop ${stops.length} added`, {
        description: r ? `${name || 'Custom stop'} - route ${fx(r.dist / 1000, 2)} km, ${r.overall === 'go' ? 'go' : r.overall === 'caution' ? 'caution' : 'no-go'}` : undefined,
        action: { label: 'Undo', onClick: () => get().removeStop(stops.length - 1) },
      })
    },
    updateStop: (i, patch) => commit({ stops: get().stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) }),
    removeStop: (i) => commit({ stops: get().stops.filter((_, k) => k !== i) }),
    moveStop: (i, dir) => {
      const stops = [...get().stops], j = i + dir
      if (j < 0 || j >= stops.length) return
      ;[stops[i], stops[j]] = [stops[j], stops[i]]
      commit({ stops })
    },
    clearStops: () => commit({ stops: [] }),
    setStops: (stops) => commit({ stops }),
    setRouting: (routing) => commit({ routing }),
    setParam: (k, v) => {
      const params = { ...get().params, [k]: v }
      const patch = { params }
      if (k === 'mastM') patch.viewshed = viewshedFor(get().base, params)
      commit(patch)
      if (k === 'maxSlopeDeg') warmRouter()
    },
    loadPreset: (key) => {
      const p = PRESETS[key], by = (id) => get().targets.find((t) => t.id === id)
      const b = by(p.base)
      const base = { lon: b.lon, lat: b.lat, name: b.name }
      routeCache.clear()
      commit({ base, viewshed: viewshedFor(base, get().params), stops: p.stops.map(([id, minutes]) => ({ lon: by(id).lon, lat: by(id).lat, name: by(id).name, minutes })) })
      get().fitPlan()
      toast(`Example loaded: ${p.label}`)
    },
    fitPlan: () => {
      const { base, stops } = get()
      get().flyTo({ points: [base, ...stops].map((p) => [p.lat, p.lon]) })
    },

    // ----- variants: saved plans compared side by side -----
    saveVariant: (name) => {
      const { base, stops, params, routing, result: R, variants } = get()
      if (!R) return
      const step = Math.max(1, Math.floor(R.samples.length / 300))
      const v = {
        id: Date.now().toString(36), name: name || `Variant ${variants.length + 1}`,
        plan: { base, stops, params, routing },
        sum: { dist: R.dist, hours: R.hours, climb: R.climb, o2: R.o2, losPct: R.losPct, shadowPct: R.shadowPct, overall: R.overall, stops: stops.length, endLTST: R.endLTST },
        line: R.samples.filter((_, i) => i % step === 0 || i === R.samples.length - 1).map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]),
      }
      const list = [...variants, v]
      set({ variants: list }); saveJson(VARIANTS_KEY, list)
      toast.success('Variant saved', { description: v.name })
    },
    loadVariant: (id) => {
      const v = get().variants.find((x) => x.id === id)
      if (!v) return
      routeCache.clear()
      const { base, stops, params, routing } = v.plan
      commit({ base, stops, params: { ...DEFAULTS, ...params }, routing, viewshed: viewshedFor(base, { ...DEFAULTS, ...params }), ghost: null })
      get().fitPlan()
    },
    renameVariant: (id, name) => { const list = get().variants.map((v) => (v.id === id ? { ...v, name } : v)); set({ variants: list }); saveJson(VARIANTS_KEY, list) },
    deleteVariant: (id) => { const list = get().variants.filter((v) => v.id !== id); set({ variants: list, ghost: null }); saveJson(VARIANTS_KEY, list) },

    // ----- share link -----
    shareLink: async () => {
      const { base, stops } = get()
      if (!base) return
      const url = `${location.origin}${location.pathname}#plan=${encodePlan(get())}`
      history.replaceState(null, '', url)
      try { await navigator.clipboard.writeText(url); toast.success('Plan link copied', { description: `${stops.length} ${plural(stops.length, ['stop', 'stops'])}, base ${base.name}` }) }
      catch { toast('Plan link is in the address bar', { description: 'The browser did not allow copying it automatically.' }) }
    },

    // ----- auto planner -----
    runAutoPlan: async ({ ids, minutes }) => {
      const s = get()
      // A target the base stands on is visited anyway: as a stop it would only add a zero-length leg.
      const cands = s.targets.filter((t) => ids.includes(t.id) && s.terrain.inside(t.lon, t.lat) && Terrain.dist([t.lon, t.lat], [s.base.lon, s.base.lat]) > 50).map(({ id, lon, lat }) => ({ id, lon, lat }))
      if (!cands.length) return toast.warning('No targets to plan', { description: 'Select at least one science target inside the terrain model.' })
      set({ autoBusy: 0 })
      try {
        const slacks = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.75, 0.7]
        const r = await calc('autoplan', { base: { lon: s.base.lon, lat: s.base.lat }, cands, p: s.params, opts: { minutes, sunset: s.mt.sunset, slacks } }, (f) => set({ autoBusy: f }))
        if (!r) return
        const by = (id) => get().targets.find((t) => t.id === id)
        const prevStops = get().stops
        // The fields run a little optimistic against the exact model along the drawn route: take the fullest plan
        // that still passes the hard checks (suit time, daylight, oxygen) once routed for real.
        const HARD = ['time', 'sun', 'o2', 'route']
        let pick = null
        for (const pl of r.plans) {
          if (!pl.order.length || (pick && pl.order.join() === pick.order.join())) continue
          commit({ stops: pl.order.map((id) => { const t = by(id); return { lon: t.lon, lat: t.lat, name: t.name, minutes } }) })
          pick = pl
          if (!get().result.checks.some((c) => HARD.includes(c.id) && c.status === 'nogo')) break
        }
        if (!pick) {
          commit({ stops: prevStops })
          return toast.error('No target fits in the EVA', { description: r.outside.length === cands.length ? 'All selected targets are beyond the walk-back limit from the base.' : 'Not enough time, daylight or oxygen for even one target. Move the base or relax the assumptions.' })
        }
        get().fitPlan()
        const R = get().result, n = pick.order.length, skipped = cands.length - n
        const left = cands.map((c) => c.id).filter((id) => !pick.order.includes(id)).map((id) => by(id).name)
        toast.success(`Auto plan: ${n} of ${cands.length} ${plural(cands.length, ['target', 'targets'])}`, {
          description: `${fx(R.hours, 1)} h, ${fx(R.o2, 2)} kg of oxygen, ${VERDICT[R.overall].label.toLowerCase()}.` + (skipped ? ` Did not fit: ${left.slice(0, 3).join(', ')}${skipped > 3 ? ` and ${skipped - 3} more` : ''}.` : ''),
        })
      } catch (e) {
        toast.error('Auto plan failed', { description: e.message })
      } finally {
        set({ autoBusy: null })
      }
    },

    init: async () => {
      if (get()._started) return
      set({ _started: true })
      try {
        const [terrain, m20, weather] = await Promise.all([
          Terrain.load('data/jezero_dem'),
          fetch('data/m20.json').then((r) => r.json()),
          fetch('data/weather.json').then((r) => r.json()),
        ])
        const wp = m20.waypoints
        const targets = get().targets.map((t) => {
          const p = wp.reduce((a, b) => (Math.abs(b.sol - t.sol) < Math.abs(a.sol - t.sol) ? b : a))
          return { ...t, lon: p.lon, lat: p.lat, elev: p.elev, atSol: p.sol }
        })
        const h = m20.heli[m20.heli.length - 1]
        targets.push({ id: 'ingenuity', name: "Ingenuity's final airfield", lon: h.lon, lat: h.lat, elev: h.elev, src: `Helicopter position after flight ${h.flight}, sol ${h.sol}`, sci: 'The first aircraft on another planet came to rest here after 72 flights. Inspecting its damaged rotor blades and the dust on its body is a unique engineering task.' })
        set({ terrain, m20, weather, targets })

        const shared = planFromHash()
        const saved = shared || loadJson(STORE_KEY, null)
        const mt = get().mt
        set({ sunLTST: mt.sun.el > 5 ? Math.round(mt.ltst * 4) / 4 : DEFAULTS.startLTST })
        if (shared) toast.info('Opened a shared plan', { description: `Base ${shared.base.name}, ${shared.stops.length} ${plural(shared.stops.length, ['stop', 'stops'])}` })
        if (saved?.base) {
          const params = { ...DEFAULTS, ...saved.params }
          commit({ base: saved.base, stops: saved.stops || [], params, routing: saved.routing || 'terrain', viewshed: terrain.viewshed(saved.base.lon, saved.base.lat, params.mastM), ready: true })
          get().fitPlan()
        } else {
          const t = targets[0]
          set({ base: { lon: t.lon, lat: t.lat, name: t.name }, ready: true })
          get().loadPreset('floor')
        }
        get().refreshLive()
        warmRouter()
      } catch (err) {
        console.error(err)
        set({ error: err.message })
      }
    },

    refreshLive: () => {
      const getJson = (u) => fetch(u, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      getJson(FEEDS.meda).then((d) => {
        if (!d.sols?.length) return
        commit({ weather: { ...get().weather, meda: d }, live: { ...get().live, meda: true } })
      }).catch(() => {})
      getJson(FEEDS.rems).then((d) => {
        if (!d.soles?.length) return
        set({ weather: { ...get().weather, rems: trimRems(d.soles) }, live: { ...get().live, rems: true } })
      }).catch(() => {})
      getJson(FEEDS.waypoints).then((d) => {
        const wp = d.features.map((f) => { const p = f.properties; return { sol: p.sol, lon: p.lon, lat: p.lat, elev: p.elev_geoid, tilt: +(p.tilt || 0).toFixed(1), km: p.dist_km, note: p.Note || '' } })
        const m20 = get().m20
        if (wp.length < m20.waypoints.length) return
        const known = m20.waypoints.length
        const traverse = wp.length > known ? [...m20.traverse, { sol: wp[known].sol, c: wp.slice(known - 1).map((p) => [p.lon, p.lat]) }] : m20.traverse
        set({ m20: { ...m20, waypoints: wp, traverse }, live: { ...get().live, rover: true } })
        if (wp.length > known) toast.info('Perseverance has moved', { description: `New position as of sol ${wp[wp.length - 1].sol}` })
      }).catch(() => {})
    },

    exportPlan: () => {
      const { result: R, base, stops, params } = get()
      const pt = (p, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })
      const f = [pt(base, { role: 'base', name: base.name })]
      stops.forEach((s, i) => f.push(pt(s, { role: 'stop', order: i + 1, name: s.name, minutes: s.minutes })))
      if (R) f.push({ type: 'Feature', properties: { role: 'route', distance_m: Math.round(R.dist), duration_h: +R.hours.toFixed(2), climb_m: Math.round(R.climb), max_slope_deg: +R.maxSlope.toFixed(1), o2_kg: +R.o2.toFixed(3), verdict: R.overall, checks: R.checks, assumptions: params, body: 'Mars', crs: 'IAU Mars 2000 sphere, planetocentric, east-positive' }, geometry: { type: 'LineString', coordinates: R.samples.map((s) => [+s.lon.toFixed(6), +s.lat.toFixed(6), s.z === s.z ? +s.z.toFixed(1) : null]) } })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features: f }, null, 1)], { type: 'application/geo+json' }))
      a.download = 'marswalk-plan.geojson'; a.click(); URL.revokeObjectURL(a.href)
      toast.success('Plan saved', { description: 'marswalk-plan.geojson' })
    },
  }
})

// The replay clock moves every frame. Text that shows it is refreshed about 15 times a second instead:
// each refresh re-renders a panel, and nobody reads numbers faster than that. Exact when paused or scrubbed.
export const usePlayT = () => useStore((s) => {
  const { t, playing, speed } = s.play
  if (t == null || !playing) return t
  const q = speed / 15
  return Math.round(t / q) * q
})

export const VERDICT = {
  go: { label: 'GO', long: 'All checks passed', color: 'var(--go)' },
  caution: { label: 'CAUTION', long: 'Proceed with caution', color: 'var(--caution)' },
  nogo: { label: 'NO-GO', long: 'EVA not allowed', color: 'var(--nogo)' },
}

// Handy in the browser console while developing.
if (import.meta.env.DEV && typeof window !== 'undefined') window.__store = useStore
