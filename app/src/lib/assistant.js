// AI assistant for the EVA plan. It sees the whole current plan (rebuilt before every model call) and changes it
// only through the same store actions the interface uses, so every change is checked by the EVA model as usual.
// Calls go to /api/openai, which the Vite dev server forwards to OpenAI with the key from app/.env.local.
import { DEFAULTS, sampleAt, O2_KG_PER_J, timeBudgetH, reserveKg } from './eva.js'
import { reachAt, EMERGENCY } from './reach.js'
import { LAYERS, PRESETS } from './catalog.js'
import { Terrain } from './terrain.js'
import { fmtH } from './marstime.js'

export const MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-5.4-mini'
const API = '/api/openai/v1/responses'
const MAX_ROUNDS = 8

const PARAM_INFO = {
  flatSpeedKmh: 'скорость по ровному, км/ч', massKg: 'масса астронавта со скафандром, кг', maxSlopeDeg: 'предельный уклон пешком, градусы',
  evaLimitH: 'ресурс скафандра, ч', o2TankKg: 'доступный кислород, кг', o2ReserveMin: 'резерв кислорода, мин', stationW: 'мощность работы на точках, Вт',
  walkbackKm: 'предел удаления от базы, км', sunsetMarginMin: 'запас до заката, мин', mastM: 'высота мачты связи, м', reachWorkMin: 'работа на месте для зоны достижимости, мин',
}

const r2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d))
const firstSentence = (t) => (t.match(/^.*?[.!?](\s|$)/)?.[0] || t).trim()

// Can the astronaut get to a target from the base and back, with p.reachWorkMin of work there?
function reachInfo(s, t) {
  const f = reachAt(s.reach, s.terrain, t.lon, t.lat)
  if (!f) return { reachable: false, why: 'дальше предела удаления или нет проходимого пути' }
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
    routing: s.routing === 'terrain' ? 'по рельефу (A*)' : 'по прямой',
    start: fmtH(p.startLTST),
    stops: s.stops.map((st, i) => ({ n: i + 1, name: st.name, workMin: st.minutes, arrive: R?.arrivals[i] ? fmtH(R.arrivals[i].ltstArrive) : null, depart: R?.arrivals[i] ? fmtH(R.arrivals[i].ltstDepart) : null, kmFromStart: R?.arrivals[i] ? r2(R.arrivals[i].dist / 1000) : null })),
    result: R && {
      verdict: R.overall, distKm: r2(R.dist / 1000), hours: r2(R.hours), returnAt: fmtH(R.endLTST), climbM: Math.round(R.climb), descentM: Math.round(R.descent),
      maxSlopeDeg: r2(R.maxSlope, 1), o2Kg: r2(R.o2, 3), o2ReserveKg: r2(R.reserveKg, 3), avgW: Math.round(R.avgW), commsPct: r2(R.losPct, 0), shadowPct: r2(R.shadowPct, 0),
      farthestKm: r2(R.far / 1000), airC: R.tLo < Infinity ? { min: Math.round(R.tLo), max: Math.round(R.tHi) } : null,
      checks: R.checks.map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })),
      emergency: R.abort ? { model: `обратно в ${EMERGENCY.slow} раза медленнее и с ${EMERGENCY.o2}-кратным расходом O2`, worstAtKm: r2(R.abort.s.d / 1000), backMin: Math.round(R.abort.tBack / 60), o2LeftKg: r2(R.abort.o2Left, 3) } : null,
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

const INSTRUCTIONS = `Ты - помощник планировщика выхода астронавта на поверхность в кратере Езеро на Марсе (приложение Marswalk Planner).
Отвечай по-русски, кратко и по делу, обычным текстом без markdown-таблиц. Используй обычный дефис вместо длинного тире.
Тебе виден текущий план целиком (JSON ниже, он обновляется после каждого твоего действия). Опирайся только на эти данные и на результаты инструментов, не выдумывай цифры.
Меняй план только инструментами. После изменения кратко скажи, что сделал и как изменился вердикт и ключевые цифры.
Если пользователь просит то, что ухудшит безопасность (например, ослабить резерв кислорода), сделай, но прямо предупреди.
В данных вердикты записаны как go, caution, nogo; пользователю называй их по-русски: МОЖНО, ОСТОРОЖНО, НЕЛЬЗЯ. Не используй английские id проверок и параметров в ответе. Время - местное истинное солнечное время Езеро.
Прежде чем советовать исправление, по возможности проверь его инструментом (например, поменяй и посмотри на вердикт), а если оно не помогло - верни как было.
Модель выхода: скорость по кривой Тоблера, энергия по Santee et al. (2001), кислород 20,1 кДж на литр. Это помощь в планировании, а не полётные правила.`

const S = (props, required = Object.keys(props)) => ({ type: 'object', properties: props, required, additionalProperties: false })
const fn = (name, description, parameters) => ({ type: 'function', name, description, parameters, strict: true })
const TARGET_IDS = { type: 'array', items: { type: 'string' }, description: 'id научных целей из списка targets' }

export const TOOLS = [
  fn('add_stops', 'Добавить научные цели в конец маршрута (в указанном порядке).', S({ target_ids: TARGET_IDS, minutes: { type: ['integer', 'null'], description: 'минут работы на каждой, null - 30' } })),
  fn('remove_stops', 'Убрать точки маршрута по номерам (с 1).', S({ numbers: { type: 'array', items: { type: 'integer' } } })),
  fn('reorder_stops', 'Задать новый порядок точек: список текущих номеров (с 1) в новом порядке, каждая ровно один раз.', S({ order: { type: 'array', items: { type: 'integer' } } })),
  fn('set_stop_minutes', 'Изменить время работы на точке.', S({ number: { type: 'integer' }, minutes: { type: 'integer' } })),
  fn('clear_stops', 'Удалить все точки маршрута.', S({})),
  fn('set_base', 'Поставить базу (старт и финиш) на научную цель.', S({ target_id: { type: 'string' } })),
  fn('set_start_time', 'Время начала выхода, местное солнечное время.', S({ time: { type: 'string', description: 'ЧЧ:ММ' } })),
  fn('set_assumption', 'Изменить допущение модели выхода.', S({ name: { type: 'string', enum: Object.keys(PARAM_INFO), description: Object.entries(PARAM_INFO).map(([k, v]) => `${k}: ${v}`).join('; ') }, value: { type: 'number' } })),
  fn('reset_assumptions', 'Вернуть все допущения к значениям по умолчанию (время старта не меняется).', S({})),
  fn('set_routing', 'Как прокладывать маршрут между точками.', S({ mode: { type: 'string', enum: ['terrain', 'straight'] } })),
  fn('load_preset', 'Загрузить пример плана (заменяет базу и точки).', S({ key: { type: 'string', enum: Object.keys(PRESETS) } })),
  fn('auto_plan', 'Автоплан: выбрать из целей как можно больше и в лучшем порядке, чтобы уложиться в ресурс скафандра, световой день и кислород. Заменяет точки маршрута. Считает 1-3 секунды.', S({ target_ids: { ...TARGET_IDS, type: ['array', 'null'], description: 'из каких целей выбирать, null - из всех' }, minutes: { type: ['integer', 'null'], description: 'работа на каждой цели, null - 30' } })),
  fn('start_time_options', 'Вердикт текущего маршрута при старте в разное время дня (шаг 15 мин): чтобы подобрать лучшее время.', S({})),
  fn('check_reach', 'Можно ли от текущей базы сходить к целям и вернуться (по рельефу, с работой на месте): время туда-обратно и кислород.', S({ target_ids: TARGET_IDS })),
  fn('set_layer', 'Включить или выключить слой карты.', S({ layer: { type: 'string', enum: LAYERS.map((l) => l.id), description: LAYERS.map((l) => `${l.id}: ${l.name}`).join('; ') }, on: { type: 'boolean' } })),
  fn('show_on_map', 'Показать на карте цель или весь маршрут.', S({ target_id: { type: ['string', 'null'], description: 'null - весь маршрут' } })),
  fn('replay', 'Проиграть выход на карте или остановить проигрывание.', S({ action: { type: 'string', enum: ['play', 'stop'] }, from_km: { type: ['number', 'null'], description: 'с какого км от старта, null - сначала' } })),
  fn('save_variant', 'Сохранить текущий план как вариант для сравнения.', S({ name: { type: 'string' } })),
  fn('load_variant', 'Открыть сохранённый вариант (заменяет текущий план).', S({ variant_id: { type: 'string' } })),
  fn('open_view', 'Открыть брифинг для печати или 3D-вид маршрута.', S({ view: { type: 'string', enum: ['briefing', '3d'] } })),
]

const parseTime = (t) => { const m = String(t).match(/^(\d{1,2})[:.](\d{2})$/); return m ? +m[1] + +m[2] / 60 : null }
const summary = (s) => { const R = s.result; return R ? { verdict: R.overall, distKm: r2(R.dist / 1000), hours: r2(R.hours), returnAt: fmtH(R.endLTST), o2Kg: r2(R.o2, 3), problems: R.checks.filter((c) => c.status !== 'go').map((c) => `${c.label}: ${c.detail}`) } : { verdict: null, note: 'в плане нет точек' } }

// Runs one tool call against the store. Returns [result for the model, short Russian line for the chat].
export async function runTool(store, name, args, startOptions) {
  const s = store.getState(), by = (id) => s.targets.find((t) => t.id === id)
  const stopOf = (t, minutes) => ({ lon: t.lon, lat: t.lat, name: t.name, minutes: minutes ?? 30 })
  const done = (note) => [{ ok: true, plan: summary(store.getState()) }, note]
  const fail = (error) => [{ ok: false, error }, null]
  switch (name) {
    case 'add_stops': {
      const ts = args.target_ids.map(by)
      if (ts.some((t) => !t)) return fail(`нет целей: ${args.target_ids.filter((id) => !by(id)).join(', ')}`)
      const out = ts.filter((t) => !s.terrain.inside(t.lon, t.lat))
      if (out.length) return fail(`вне модели рельефа, маршрут туда не проложить: ${out.map((t) => t.name).join(', ')}`)
      s.setStops([...s.stops, ...ts.map((t) => stopOf(t, args.minutes))])
      return done(`Добавлено: ${ts.map((t) => t.name).join(', ')}`)
    }
    case 'remove_stops': {
      const drop = new Set(args.numbers.map((n) => n - 1))
      s.setStops(s.stops.filter((_, i) => !drop.has(i)))
      return done(`Убраны точки ${args.numbers.join(', ')}`)
    }
    case 'reorder_stops': {
      const o = args.order
      if (o.length !== s.stops.length || new Set(o).size !== o.length || o.some((n) => n < 1 || n > s.stops.length)) return fail(`нужна перестановка чисел 1..${s.stops.length}`)
      s.setStops(o.map((n) => s.stops[n - 1]))
      return done(`Новый порядок: ${o.join(', ')}`)
    }
    case 'set_stop_minutes': {
      if (!s.stops[args.number - 1]) return fail('нет такой точки')
      s.updateStop(args.number - 1, { minutes: Math.max(0, Math.min(240, args.minutes)) })
      return done(`Точка ${args.number}: ${args.minutes} мин работы`)
    }
    case 'clear_stops': s.clearStops(); return done('Точки маршрута удалены')
    case 'set_base': {
      const t = by(args.target_id)
      if (!t || !s.terrain.inside(t.lon, t.lat)) return fail('такой цели нет или она вне модели рельефа')
      s.setBase(t, t.name)
      return done(`База: ${t.name}`)
    }
    case 'set_start_time': {
      const h = parseTime(args.time)
      if (h == null || h < 0 || h >= 24) return fail('время в формате ЧЧ:ММ')
      s.setParam('startLTST', h)
      return done(`Старт в ${fmtH(h)}`)
    }
    case 'set_assumption': {
      if (!(args.value > 0)) return fail('значение должно быть больше нуля')
      s.setParam(args.name, args.value)
      return done(`${PARAM_INFO[args.name]}: ${String(args.value).replace('.', ',')}`)
    }
    case 'reset_assumptions': {
      for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'startLTST' && s.params[k] !== v) store.getState().setParam(k, v)
      return done('Допущения по умолчанию')
    }
    case 'set_routing': s.setRouting(args.mode); return done(args.mode === 'terrain' ? 'Маршрут по рельефу' : 'Маршрут по прямой')
    case 'load_preset': s.loadPreset(args.key); return done(`Пример: ${PRESETS[args.key].label}`)
    case 'auto_plan': {
      const ids = args.target_ids ?? s.targets.map((t) => t.id)
      await s.runAutoPlan({ ids, minutes: args.minutes ?? 30 })
      const st = store.getState()
      return [{ ok: true, stops: st.stops.map((x) => x.name), plan: summary(st) }, `Автоплан: ${st.stops.length} точек`]
    }
    case 'start_time_options': {
      const opts = startOptions(s)
      if (!opts.length) return fail('в плане нет маршрута')
      const best = [...opts].sort((a, b) => a.score - b.score).slice(0, 5)
      const runs = []
      for (const o of opts) { const last = runs.at(-1); if (last && last.verdict === o.overall) last.to = fmtH(o.h); else runs.push({ verdict: o.overall, from: fmtH(o.h), to: fmtH(o.h) }) }
      return [{ ok: true, current: fmtH(s.params.startLTST), best: best.map((o) => ({ start: fmtH(o.h), verdict: o.overall, problems: o.issues, shadowPct: Math.round(o.shadowPct), minAirC: o.tLo < Infinity ? Math.round(o.tLo) : null })), byTime: runs }, 'Посмотрел время старта']
    }
    case 'check_reach': {
      if (!s.reach) return fail('зона достижимости ещё считается, попробуй через пару секунд')
      return [{ ok: true, budgetH: r2(timeBudgetH(s.params, s.mt.sunset)), workMinAssumed: s.params.reachWorkMin, targets: Object.fromEntries(args.target_ids.map((id) => [id, by(id) ? reachInfo(s, by(id)) : 'нет такой цели'])) }, 'Проверил досягаемость']
    }
    case 'set_layer': s.setLayer(args.layer, { on: args.on }); return [{ ok: true }, `${args.on ? 'Показан' : 'Скрыт'} слой: ${LAYERS.find((l) => l.id === args.layer).name}`]
    case 'show_on_map': {
      if (!args.target_id) { if (!s.stops.length) return fail('нет маршрута'); s.fitPlan(); return [{ ok: true }, 'Показан маршрут'] }
      const t = by(args.target_id)
      if (!t) return fail('нет такой цели')
      s.flyTo({ lon: t.lon, lat: t.lat, zoom: 15.5 })
      return [{ ok: true }, `Показано: ${t.name}`]
    }
    case 'replay': {
      if (args.action === 'stop') { s.setPlay({ t: null, playing: false }); return [{ ok: true }, 'Проигрывание остановлено'] }
      if (!s.result) return fail('нет маршрута')
      const t = args.from_km ? (s.result.samples.find((q) => q.d >= args.from_km * 1000)?.t ?? 0) : 0
      s.setPlay({ t, playing: true })
      return [{ ok: true }, 'Проигрывание выхода']
    }
    case 'save_variant': if (!s.result) return fail('нет маршрута'); s.saveVariant(args.name); return [{ ok: true }, `Сохранён вариант «${args.name}»`]
    case 'load_variant': if (!s.variants.some((v) => v.id === args.variant_id)) return fail('нет такого варианта'); s.loadVariant(args.variant_id); return done('Открыт вариант')
    case 'open_view':
      if (args.view === 'briefing') { if (!s.result) return fail('нет маршрута'); s.setBriefing(true); return [{ ok: true }, 'Открыт брифинг'] }
      s.setView3d(true); return [{ ok: true }, 'Открыт 3D-вид']
    default: return fail(`неизвестный инструмент ${name}`)
  }
}

async function call(body, signal) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (r.status === 404) throw new Error('Помощник не подключён: положите OPENAI_API_KEY в app/.env.local и перезапустите npm run dev.')
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error?.message || `OpenAI ответил ${r.status}`)
  return j
}

// One user turn: the model may call several tools in a row before it answers.
// onStep(line) reports each action as it happens. Returns { text, prevId, actions }.
export async function ask({ store, text, prevId, signal, onStep, startOptions }) {
  const actions = []
  const instructions = () => `${INSTRUCTIONS}\n\nТекущий план (JSON):\n${JSON.stringify(planContext(store.getState()))}`
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
    onStep?.('Думаю...')
    res = await call({ model: MODEL, reasoning: { effort: 'low' }, instructions: instructions(), tools: TOOLS, previous_response_id: res.id, input: outputs }, signal)
  }
  const msg = res.output.filter((o) => o.type === 'message').flatMap((o) => o.content.filter((c) => c.type === 'output_text').map((c) => c.text)).join('\n').trim()
  return { text: msg || (actions.length ? 'Готово.' : 'Не получилось ответить, попробуйте переформулировать.'), prevId: res.id, actions }
}
