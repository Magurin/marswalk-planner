// AI assistant for the EVA plan. It sees the whole current plan (rebuilt before every model call) and changes it
// only through the same store actions the interface uses, so every change is checked by the EVA model as usual.
// Calls go to /api/openai, which the Vite dev server forwards to OpenAI with the key from app/.env.local.
import { DEFAULTS, sampleAt, O2_KG_PER_J, timeBudgetH, reserveKg } from './eva.js'
import { reachAt, EMERGENCY } from './reach.js'
import { LAYERS, PRESETS } from './catalog.js'
import { Terrain } from './terrain.js'
import { fmtH } from './marstime.js'
import { plural } from './fmt.js'

export const MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-6-luna'
const API = '/api/openai/v1/responses'
const MAX_ROUNDS = 8

const PARAM_INFO = {
  flatSpeedKmh: 'walking speed on flat ground, km/h', massKg: 'astronaut mass with suit, kg', maxSlopeDeg: 'max walkable slope, degrees',
  evaLimitH: 'suit endurance, h', o2TankKg: 'available oxygen, kg', o2ReserveMin: 'oxygen reserve, min', stationW: 'work power at stops, W',
  walkbackKm: 'walk-back limit from base, km', sunsetMarginMin: 'margin before sunset, min', mastM: 'comms mast height, m', reachWorkMin: 'on-site work assumed for the reach map, min',
}

const r2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d))
const firstSentence = (t) => (t.match(/^.*?[.!?](\s|$)/)?.[0] || t).trim()

// Can the astronaut get to a target from the base and back, with p.reachWorkMin of work there?
function reachInfo(s, t) {
  const f = reachAt(s.reach, s.terrain, t.lon, t.lat)
  if (!f) return { reachable: false, why: 'beyond the walk-back limit or no passable path' }
  const p = s.params, work = p.reachWorkMin * 60
  const hours = (f.tOut + f.tBack + work) / 3600, o2 = (f.eOut + f.eBack + p.stationW * work) * O2_KG_PER_J
  const budget = timeBudgetH(p, s.mt.sunset)
  return { reachable: hours <= budget && o2 + reserveKg(p) <= p.o2TankKg, roundTripH: r2(hours), o2Kg: r2(o2, 3), walkOutMin: Math.round(f.tOut / 60), walkBackMin: Math.round(f.tBack / 60) }
}

// Everything the model needs to know about the current state, as compact JSON.
export function planContext(s) {
  const R = s.result, p = s.params
  const wx = s.weather?.meda?.sols && [...s.weather.meda.sols].reverse().find((x) => x.min_temp != null)
  return {
    now: { sol: s.mt.sol, ltst: fmtH(s.mt.ltst), sunrise: fmtH(s.mt.sunrise), sunset: fmtH(s.mt.sunset), ls: r2(s.mt.ls, 1), jezeroAirC: wx ? { min: +wx.min_temp, max: +wx.max_temp, sol: wx.sol } : null },
    base: s.base && { name: s.base.name, lon: r2(s.base.lon, 5), lat: r2(s.base.lat, 5) },
    routing: s.routing === 'terrain' ? 'terrain-aware (A*)' : 'straight line',
    start: fmtH(p.startLTST),
    stops: s.stops.map((st, i) => ({ n: i + 1, name: st.name, workMin: st.minutes, arrive: R?.arrivals[i] ? fmtH(R.arrivals[i].ltstArrive) : null, depart: R?.arrivals[i] ? fmtH(R.arrivals[i].ltstDepart) : null, kmFromStart: R?.arrivals[i] ? r2(R.arrivals[i].dist / 1000) : null })),
    result: R && {
      verdict: R.overall, distKm: r2(R.dist / 1000), hours: r2(R.hours), returnAt: fmtH(R.endLTST), climbM: Math.round(R.climb), descentM: Math.round(R.descent),
      maxSlopeDeg: r2(R.maxSlope, 1), o2Kg: r2(R.o2, 3), o2ReserveKg: r2(R.reserveKg, 3), avgW: Math.round(R.avgW), commsPct: r2(R.losPct, 0), shadowPct: r2(R.shadowPct, 0),
      farthestKm: r2(R.far / 1000), airC: R.tLo < Infinity ? { min: Math.round(R.tLo), max: Math.round(R.tHi) } : null,
      checks: R.checks.map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })),
      emergency: R.abort ? { model: `return ${EMERGENCY.slow}x slower with ${EMERGENCY.o2}x O2 consumption`, worstAtKm: r2(R.abort.s.d / 1000), backMin: Math.round(R.abort.tBack / 60), o2LeftKg: r2(R.abort.o2Left, 3) } : null,
    },
    assumptions: Object.fromEntries(Object.keys(PARAM_INFO).map((k) => [k, p[k]])),
    layersOn: LAYERS.filter((l) => s.layers[l.id].on).map((l) => l.id),
    replay: s.play.t != null && R ? (() => { const q = sampleAt(R, s.play.t); return { at: fmtH(q.ltst), km: r2(q.d / 1000), o2LeftKg: r2(p.o2TankKg - q.e * O2_KG_PER_J, 3) } })() : null,
    variants: s.variants.map((v) => ({ id: v.id, name: v.name, verdict: v.sum.overall, distKm: r2(v.sum.dist / 1000), hours: r2(v.sum.hours), o2Kg: r2(v.sum.o2, 3), commsPct: r2(v.sum.losPct, 0), stops: v.sum.stops })),
    targets: s.targets.map((t) => ({
      id: t.id, name: t.name, about: firstSentence(t.sci), sol: t.atSol ?? null,
      kmFromBase: s.base ? r2(Terrain.dist([t.lon, t.lat], [s.base.lon, s.base.lat]) / 1000) : null,
      inTerrainModel: !!s.terrain?.inside(t.lon, t.lat), inPlan: s.stops.some((st) => Terrain.dist([st.lon, st.lat], [t.lon, t.lat]) < 30),
    })),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])),
  }
}

const INSTRUCTIONS = `You are the Assistant of an astronaut EVA planner for Jezero crater on Mars (the Marswalk Planner app).
Answer in English, briefly and to the point, in plain text without markdown tables. Use a plain hyphen, never an em dash.
You can see the whole current plan (JSON below, refreshed after each of your actions). Rely only on this data and on tool results; never invent numbers.
Change the plan only through tools. After a change, briefly say what you did and how the verdict and key numbers changed.
If the user asks for something that reduces safety (for example, cutting the oxygen reserve), do it but warn them plainly.
In the data, verdicts are go, caution, nogo; call them GO, CAUTION and NO-GO for the user. Do not mention internal check or parameter ids in answers. Times are Jezero local true solar time (LTST).
Before recommending a fix, test it with a tool when possible (change it and look at the verdict), and revert it if it did not help.
EVA model: speed from Tobler's hiking function, energy from Santee et al. (2001), oxygen at 20.1 kJ per liter. This is a planning aid, not flight rules.`

const S = (props, required = Object.keys(props)) => ({ type: 'object', properties: props, required, additionalProperties: false })
const fn = (name, description, parameters) => ({ type: 'function', name, description, parameters, strict: true })
const TARGET_IDS = { type: 'array', items: { type: 'string' }, description: 'science target ids from the targets list' }

export const TOOLS = [
  fn('add_stops', 'Add science targets to the end of the route (in the given order).', S({ target_ids: TARGET_IDS, minutes: { type: ['integer', 'null'], description: 'minutes of work at each, null - 30' } })),
  fn('remove_stops', 'Remove route stops by number (1-based).', S({ numbers: { type: 'array', items: { type: 'integer' } } })),
  fn('reorder_stops', 'Reorder stops: current numbers (1-based) in the new order, each exactly once.', S({ order: { type: 'array', items: { type: 'integer' } } })),
  fn('set_stop_minutes', 'Change the work time at a stop.', S({ number: { type: 'integer' }, minutes: { type: 'integer' } })),
  fn('clear_stops', 'Remove all route stops.', S({})),
  fn('set_base', 'Move the base (start and finish) to a science target.', S({ target_id: { type: 'string' } })),
  fn('set_start_time', 'Set the EVA start time, local solar time.', S({ time: { type: 'string', description: 'HH:MM' } })),
  fn('set_assumption', 'Change an EVA model assumption.', S({ name: { type: 'string', enum: Object.keys(PARAM_INFO), description: Object.entries(PARAM_INFO).map(([k, v]) => `${k}: ${v}`).join('; ') }, value: { type: 'number' } })),
  fn('reset_assumptions', 'Reset all assumptions to defaults (start time is kept).', S({})),
  fn('set_routing', 'Choose how the route is laid between stops.', S({ mode: { type: 'string', enum: ['terrain', 'straight'] } })),
  fn('load_preset', 'Load an example plan (replaces base and stops).', S({ key: { type: 'string', enum: Object.keys(PRESETS) } })),
  fn('auto_plan', 'Run the auto planner: pick as many targets as possible in the best order so that the plan passes every check (suit endurance, daylight, oxygen, comms, walk-back range, emergency return). Replaces route stops. Takes 1-5 seconds.', S({ target_ids: { ...TARGET_IDS, type: ['array', 'null'], description: 'targets to choose from, null - all' }, minutes: { type: ['integer', 'null'], description: 'minutes of work at each target, null - 30' } })),
  fn('start_time_options', 'Compare start times: verdict of the current route for starts across the day (15 min step), to pick the best time.', S({})),
  fn('check_reach', 'Check reach: can the astronaut walk from the current base to targets and back (over terrain, with on-site work); round-trip time and oxygen.', S({ target_ids: TARGET_IDS })),
  fn('set_layer', 'Turn a map layer on or off.', S({ layer: { type: 'string', enum: LAYERS.map((l) => l.id), description: LAYERS.map((l) => `${l.id}: ${l.name}`).join('; ') }, on: { type: 'boolean' } })),
  fn('show_on_map', 'Show a target or the whole route on the map.', S({ target_id: { type: ['string', 'null'], description: 'null - whole route' } })),
  fn('replay', 'Replay the EVA on the map or stop the replay.', S({ action: { type: 'string', enum: ['play', 'stop'] }, from_km: { type: ['number', 'null'], description: 'km into the route to start from, null - from the start' } })),
  fn('save_variant', 'Save the current plan as a variant for comparison.', S({ name: { type: 'string' } })),
  fn('load_variant', 'Open a saved variant (replaces the current plan).', S({ variant_id: { type: 'string' } })),
  fn('open_view', 'Open the printable briefing or the 3D view of the route.', S({ view: { type: 'string', enum: ['briefing', '3d'] } })),
]

const parseTime = (t) => { const m = String(t).match(/^(\d{1,2})[:.](\d{2})$/); return m ? +m[1] + +m[2] / 60 : null }
const summary = (s) => { const R = s.result; return R ? { verdict: R.overall, distKm: r2(R.dist / 1000), hours: r2(R.hours), returnAt: fmtH(R.endLTST), o2Kg: r2(R.o2, 3), problems: R.checks.filter((c) => c.status !== 'go').map((c) => `${c.label}: ${c.detail}`) } : { verdict: null, note: 'the plan has no stops' } }

// Runs one tool call against the store. Returns [result for the model, short line for the chat].
export async function runTool(store, name, args, startOptions) {
  const s = store.getState(), by = (id) => s.targets.find((t) => t.id === id)
  const stopOf = (t, minutes) => ({ lon: t.lon, lat: t.lat, name: t.name, minutes: minutes ?? 30 })
  const done = (note) => [{ ok: true, plan: summary(store.getState()) }, note]
  const fail = (error) => [{ ok: false, error }, null]
  switch (name) {
    case 'add_stops': {
      const ts = args.target_ids.map(by)
      if (ts.some((t) => !t)) return fail(`unknown targets: ${args.target_ids.filter((id) => !by(id)).join(', ')}`)
      const out = ts.filter((t) => !s.terrain.inside(t.lon, t.lat))
      if (out.length) return fail(`outside the terrain model, no route possible: ${out.map((t) => t.name).join(', ')}`)
      s.setStops([...s.stops, ...ts.map((t) => stopOf(t, args.minutes))])
      return done(`Added: ${ts.map((t) => t.name).join(', ')}`)
    }
    case 'remove_stops': {
      const drop = new Set(args.numbers.map((n) => n - 1))
      s.setStops(s.stops.filter((_, i) => !drop.has(i)))
      return done(`Removed ${plural(args.numbers.length, ['stop', 'stops'])} ${args.numbers.join(', ')}`)
    }
    case 'reorder_stops': {
      const o = args.order
      if (o.length !== s.stops.length || new Set(o).size !== o.length || o.some((n) => n < 1 || n > s.stops.length)) return fail(`need a permutation of 1..${s.stops.length}`)
      s.setStops(o.map((n) => s.stops[n - 1]))
      return done(`New order: ${o.join(', ')}`)
    }
    case 'set_stop_minutes': {
      if (!s.stops[args.number - 1]) return fail('no such stop')
      s.updateStop(args.number - 1, { minutes: Math.max(0, Math.min(240, args.minutes)) })
      return done(`Stop ${args.number}: ${args.minutes} min of work`)
    }
    case 'clear_stops': s.clearStops(); return done('Route stops cleared')
    case 'set_base': {
      const t = by(args.target_id)
      if (!t || !s.terrain.inside(t.lon, t.lat)) return fail('no such target, or it is outside the terrain model')
      s.setBase(t, t.name)
      return done(`Base: ${t.name}`)
    }
    case 'set_start_time': {
      const h = parseTime(args.time)
      if (h == null || h < 0 || h >= 24) return fail('time must be HH:MM')
      s.setParam('startLTST', h)
      return done(`Start at ${fmtH(h)}`)
    }
    case 'set_assumption': {
      if (!(args.value > 0)) return fail('value must be greater than zero')
      s.setParam(args.name, args.value)
      return done(`${PARAM_INFO[args.name]}: ${args.value}`)
    }
    case 'reset_assumptions': {
      for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'startLTST' && s.params[k] !== v) store.getState().setParam(k, v)
      return done('Assumptions reset to defaults')
    }
    case 'set_routing': s.setRouting(args.mode); return done(args.mode === 'terrain' ? 'Terrain-aware routing' : 'Straight-line routing')
    case 'load_preset': s.loadPreset(args.key); return done(`Example: ${PRESETS[args.key].label}`)
    case 'auto_plan': {
      const ids = args.target_ids ?? s.targets.map((t) => t.id)
      await s.runAutoPlan({ ids, minutes: args.minutes ?? 30 })
      const st = store.getState()
      return [{ ok: true, stops: st.stops.map((x) => x.name), plan: summary(st) }, `Auto planner: ${st.stops.length} ${plural(st.stops.length, ['stop', 'stops'])}`]
    }
    case 'start_time_options': {
      const opts = startOptions(s)
      if (!opts.length) return fail('the plan has no route')
      const best = [...opts].sort((a, b) => a.score - b.score).slice(0, 5)
      const runs = []
      for (const o of opts) { const last = runs.at(-1); if (last && last.verdict === o.overall) last.to = fmtH(o.h); else runs.push({ verdict: o.overall, from: fmtH(o.h), to: fmtH(o.h) }) }
      return [{ ok: true, current: fmtH(s.params.startLTST), best: best.map((o) => ({ start: fmtH(o.h), verdict: o.overall, problems: o.issues, shadowPct: Math.round(o.shadowPct), minAirC: o.tLo < Infinity ? Math.round(o.tLo) : null })), byTime: runs }, 'Checked start times']
    }
    case 'check_reach': {
      if (!s.reach) return fail('the reach map is still computing, try again in a couple of seconds')
      return [{ ok: true, budgetH: r2(timeBudgetH(s.params, s.mt.sunset)), workMinAssumed: s.params.reachWorkMin, targets: Object.fromEntries(args.target_ids.map((id) => [id, by(id) ? reachInfo(s, by(id)) : 'no such target'])) }, 'Checked reach']
    }
    case 'set_layer': s.setLayer(args.layer, { on: args.on }); return [{ ok: true }, `Layer ${args.on ? 'shown' : 'hidden'}: ${LAYERS.find((l) => l.id === args.layer).name}`]
    case 'show_on_map': {
      if (!args.target_id) { if (!s.stops.length) return fail('no route'); s.fitPlan(); return [{ ok: true }, 'Showing the route'] }
      const t = by(args.target_id)
      if (!t) return fail('no such target')
      s.flyTo({ lon: t.lon, lat: t.lat, zoom: 15.5 })
      return [{ ok: true }, `Showing: ${t.name}`]
    }
    case 'replay': {
      if (args.action === 'stop') { s.setPlay({ t: null, playing: false }); return [{ ok: true }, 'Replay stopped'] }
      if (!s.result) return fail('no route')
      const t = args.from_km ? (s.result.samples.find((q) => q.d >= args.from_km * 1000)?.t ?? 0) : 0
      s.setPlay({ t, playing: true })
      return [{ ok: true }, 'Replaying the EVA']
    }
    case 'save_variant': if (!s.result) return fail('no route'); s.saveVariant(args.name); return [{ ok: true }, `Saved variant "${args.name}"`]
    case 'load_variant': if (!s.variants.some((v) => v.id === args.variant_id)) return fail('no such variant'); s.loadVariant(args.variant_id); return done('Variant opened')
    case 'open_view':
      if (args.view === 'briefing') { if (!s.result) return fail('no route'); s.setBriefing(true); return [{ ok: true }, 'Briefing opened'] }
      s.setView3d(true); return [{ ok: true }, '3D view opened']
    default: return fail(`unknown tool ${name}`)
  }
}

async function call(body, signal) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (r.status === 404) throw new Error('Assistant is not connected: put OPENAI_API_KEY in app/.env.local and restart npm run dev.')
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error?.message || `OpenAI returned ${r.status}`)
  return j
}

// One user turn: the model may call several tools in a row before it answers.
// onStep(line) reports each action as it happens. Returns { text, prevId, actions }.
export async function ask({ store, text, prevId, signal, onStep, startOptions }) {
  const actions = []
  const instructions = () => `${INSTRUCTIONS}\n\nCurrent plan (JSON):\n${JSON.stringify(planContext(store.getState()))}`
  let res = await call({ model: MODEL, reasoning: { effort: 'low' }, instructions: instructions(), tools: TOOLS, previous_response_id: prevId || undefined, input: [{ role: 'user', content: text }] }, signal)
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const calls = res.output.filter((o) => o.type === 'function_call')
    if (!calls.length) break
    const outputs = []
    for (const c of calls) {
      let args = {}
      try { args = JSON.parse(c.arguments || '{}') } catch { /* keep empty */ }
      onStep?.(`${TOOLS.find((t) => t.name === c.name)?.description.split(/[.:]/)[0] ?? c.name}...`)
      let out, note
      try { [out, note] = await runTool(store, c.name, args, startOptions) } catch (e) { out = { ok: false, error: e.message } }
      if (note) actions.push(note)
      outputs.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) })
    }
    onStep?.('Thinking...')
    res = await call({ model: MODEL, reasoning: { effort: 'low' }, instructions: instructions(), tools: TOOLS, previous_response_id: res.id, input: outputs }, signal)
  }
  const msg = res.output.filter((o) => o.type === 'message').flatMap((o) => o.content.filter((c) => c.type === 'output_text').map((c) => c.text)).join('\n').trim()
  return { text: msg || (actions.length ? 'Done.' : 'Could not answer, try rephrasing.'), prevId: res.id, actions }
}
