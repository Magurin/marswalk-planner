// Reach map, emergency return and the auto planner. All three stand on least-time fields over the 20 m grid:
// Dijkstra from one point to every cell around it, with the same walking speed, slope limit and slope penalty
// as Terrain.route, so a field agrees with the routes drawn on the map.
import { Heap } from './terrain.js'
import { speedMs, powerW, O2_KG_PER_J, reserveKg, timeBudgetH } from './eva.js'
import { fx } from './fmt.js'

const HAZARD = 1.5 // slope penalty, as in Terrain.route

// Parameters that change the fields themselves. The rest (tank, suit hours, start time...) only change how they are read.
export const reachKey = (base, p) => base && [base.lon, base.lat, p.flatSpeedKmh, p.massKg, p.maxSlopeDeg, p.walkbackKm].map((v) => (+v).toFixed(6)).join(',')

// Grid window around a point, with a mask for the cells within `radius` metres of it.
export function windowAround(T, lon, lat, radius) {
  const c = Math.round(T.col(lon)), r = Math.round(T.row(lat))
  const rc = Math.ceil(radius / T.dx) + 1, rr = Math.ceil(radius / T.dy) + 1
  const c0 = Math.max(0, c - rc), r0 = Math.max(0, r - rr)
  const w = Math.min(T.W, c + rc + 1) - c0, h = Math.min(T.H, r + rr + 1) - r0
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = Math.hypot((x + c0 - c) * T.dx, (y + r0 - r) * T.dy) <= radius ? 1 : 0
  const m = T.meta, cw = (m.east - m.west) / T.W, ch = (m.north - m.south) / T.H
  return { c0, r0, w, h, mask, bounds: [[m.north - (r0 + h) * ch, m.west + c0 * cw], [m.north - r0 * ch, m.west + (c0 + w) * cw]] }
}

// dir 1: walking out from the point to every cell. dir -1: walking from every cell back to the point.
// Returns actual seconds and joules along the least-penalty path (NaN where unreachable).
// targets: optional Set of window indices; the search stops once all are settled, and they may be steep themselves.
export function fieldFrom(T, lon, lat, p, win, dir = 1, targets = null) {
  const { W, z, slope, dx, dy } = T
  const { c0, r0, w, h, mask } = win
  const n = w * h
  const cost = new Float32Array(n).fill(Infinity), time = new Float32Array(n).fill(NaN), en = new Float32Array(n).fill(NaN)
  const ci = Math.round(T.col(lon)) - c0, ri = Math.round(T.row(lat)) - r0
  if (ci < 0 || ri < 0 || ci >= w || ri >= h) return { time, en }
  const done = new Uint8Array(n)
  // 16 directions (knight moves too): with 8 the zones come out octagonal and distances up to 8% long.
  const nb = []
  for (const [a, b] of [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) {
    for (const [sa, sb] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const v = [a * sa, b * sb, Math.hypot(a * dx, b * dy)]
      if (!nb.some((q) => q[0] === v[0] && q[1] === v[1])) nb.push(v)
    }
  }
  const ms = p.maxSlopeDeg
  const s0 = ri * w + ci
  const heap = new Heap()
  cost[s0] = 0; time[s0] = 0; en[s0] = 0; heap.push(0, s0)
  let left = targets ? targets.size : -1
  while (heap.size) {
    const i = heap.pop()
    if (done[i]) continue
    done[i] = 1
    if (targets && targets.has(i) && --left <= 0) break
    const c = i % w, r = (i / w) | 0, gi = (r + r0) * W + c + c0, zi = z[gi]
    for (const [dc, dr, d] of nb) {
      const c2 = c + dc, r2 = r + dr
      if (c2 < 0 || r2 < 0 || c2 >= w || r2 >= h) continue
      const j = r2 * w + c2
      if (done[j] || !mask[j]) continue
      const gj = (r2 + r0) * W + c2 + c0, zj = z[gj]
      if (!(zj === zj)) continue
      // Slope of the cell being walked into: j on the way out, i on the way back.
      let sIn = dir > 0 ? slope[gj] : slope[gi]
      // A knight move also crosses the cell between: it must be walkable too.
      if (Math.abs(dc) + Math.abs(dr) === 3) {
        const mid = (r + r0 + Math.round(dr / 2)) * W + c + c0 + Math.round(dc / 2)
        if (!(z[mid] === z[mid])) continue
        sIn = Math.max(sIn, slope[mid])
      }
      if (sIn > ms && !(dir > 0 ? targets?.has(j) : i === s0)) continue
      const grade = dir > 0 ? (zj - zi) / d : (zi - zj) / d
      const v = speedMs(grade, p), dt = d / v
      const k = cost[i] + dt * (1 + HAZARD * Math.min(1, sIn / ms) ** 2)
      if (k < cost[j]) { cost[j] = k; time[j] = time[i] + dt; en[j] = en[i] + powerW(v, grade, p) * dt; heap.push(k, j) }
    }
  }
  return { time, en }
}

// Out and back fields around the base, for the reach map and the emergency check.
export function reachFields(T, base, p) {
  const win = windowAround(T, base.lon, base.lat, p.walkbackKm * 1000)
  const out = fieldFrom(T, base.lon, base.lat, p, win, 1)
  const back = fieldFrom(T, base.lon, base.lat, p, win, -1)
  return { key: reachKey(base, p), c0: win.c0, r0: win.r0, w: win.w, h: win.h, bounds: win.bounds, tOut: out.time, eOut: out.en, tBack: back.time, eBack: back.en }
}

export function reachAt(R, T, lon, lat) {
  if (!R) return null
  const c = Math.round(T.col(lon)) - R.c0, r = Math.round(T.row(lat)) - R.r0
  if (c < 0 || r < 0 || c >= R.w || r >= R.h) return null
  const i = r * R.w + c
  return R.tBack[i] === R.tBack[i] ? { tOut: R.tOut[i], eOut: R.eOut[i], tBack: R.tBack[i], eBack: R.eBack[i] } : null
}

// Share of the time and oxygen budget a there-and-back walk to each cell uses, with p.reachWorkMin of work at the far end.
// > 1 means out of reach. NaN where the ground cannot be walked.
export function reachRatio(R, p, sunset) {
  const budget = timeBudgetH(p, sunset) * 3600, work = p.reachWorkMin * 60
  const o2Avail = p.o2TankKg - reserveKg(p)
  const out = new Float32Array(R.w * R.h)
  for (let i = 0; i < out.length; i++) {
    const t = R.tOut[i] + R.tBack[i]
    if (!(t === t)) { out[i] = NaN; continue }
    const o2 = (R.eOut[i] + R.eBack[i] + p.stationW * work) * O2_KG_PER_J
    out[i] = Math.max(budget > 0 ? (t + work) / budget : Infinity, o2Avail > 0 ? o2 / o2Avail : Infinity)
  }
  return out
}

// Cool colours, so the zone never reads as the slope classes (green to red) drawn under it.
export const REACH_CLASSES = [
  { max: 0.5, color: [56, 189, 248], label: 'до 50% ресурса' },
  { max: 0.8, color: [129, 140, 248], label: '50-80%' },
  { max: 1, color: [244, 114, 182], label: '80-100%, на пределе' },
]

export function reachCanvas(R, p, sunset) {
  const ratio = reachRatio(R, p, sunset), { w, h } = R
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h), px = img.data
  const ok = (i) => ratio[i] <= 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!ok(i)) continue
      const k = REACH_CLASSES.findIndex((c) => ratio[i] <= c.max), col = REACH_CLASSES[k].color
      // Draw the outer edge of the zone solid, so the limit reads as a line.
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !ok(i - 1) || !ok(i + 1) || !ok(i - w) || !ok(i + w)
      px[i * 4] = edge ? 255 : col[0]; px[i * 4 + 1] = edge ? 255 : col[1]; px[i * 4 + 2] = edge ? 255 : col[2]
      px[i * 4 + 3] = edge ? 230 : 70 + k * 25
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

// Emergency return: something goes wrong (an injury, a suit leak) and the astronaut turns straight back to base,
// at half the pace and burning oxygen twice as fast. Finds the moment of the walk where that costs the most.
export const EMERGENCY = { slow: 2, o2: 2 }
export function abortAnalysis(R, reach, T, p) {
  if (!reach) return null
  let worst = null
  for (let k = 0; k < R.samples.length; k++) {
    const s = R.samples[k], f = reachAt(reach, T, s.lon, s.lat)
    // Within a minute of the base there is nothing to turn back from.
    if (!f || f.tBack < 60) continue
    const tBack = f.tBack * EMERGENCY.slow, o2Back = f.eBack * O2_KG_PER_J * EMERGENCY.o2
    const o2Need = s.e * O2_KG_PER_J + o2Back, tNeed = s.t + tBack
    const ratio = Math.max(o2Need / p.o2TankKg, tNeed / 3600 / p.evaLimitH)
    if (!worst || ratio > worst.ratio) worst = { k, s, ratio, o2Need, tNeed, tBack, o2Back, o2Left: p.o2TankKg - o2Need }
  }
  if (!worst) return null
  const reserve = reserveKg(p)
  const status = worst.ratio > 1 ? 'nogo' : worst.o2Left < reserve / 2 || worst.ratio > 0.9 ? 'caution' : 'go'
  const tail = worst.ratio > 1
    ? (worst.o2Need > p.o2TankKg ? ': кислорода на это не хватит' : ': ресурса скафандра на это не хватит')
    : `, в баллоне останется ${fx(worst.o2Left, 2)} кг`
  worst.check = {
    id: 'abort', label: 'Аварийный возврат', status,
    detail: `При травме или утечке (обратно вдвое медленнее, кислорода вдвое больше) хуже всего на ${fx(worst.s.d / 1000, 2)} км от старта: до базы ${Math.round(worst.tBack / 60)} мин и ${fx(worst.o2Back, 2)} кг кислорода${tail}`,
  }
  return worst
}

// Auto planner: which of the candidate targets to visit, and in what order, to see as many as possible
// within the suit time, daylight and oxygen (with the reserve kept). Exact search over subsets (Held-Karp).
// slacks: shares of the budget to plan against. The fields are a little more optimistic than the exact model
// along the drawn route, so the caller tries them in turn until the exact check passes.
export function autoPlan(T, base, cands, p, { minutes = 30, sunset, onProgress, slacks = [1] } = {}) {
  const win = windowAround(T, base.lon, base.lat, p.walkbackKm * 1000)
  const idx = (pt) => {
    const c = Math.round(T.col(pt.lon)) - win.c0, r = Math.round(T.row(pt.lat)) - win.r0
    return c >= 0 && r >= 0 && c < win.w && r < win.h && win.mask[r * win.w + c] ? r * win.w + c : -1
  }
  const outside = cands.filter((c) => idx(c) < 0)
  const C = cands.filter((c) => idx(c) >= 0).slice(0, 14)
  const nodes = [base, ...C], N = nodes.length, at = nodes.map(idx)
  const tm = Array.from({ length: N }, () => new Float64Array(N).fill(Infinity)), em = Array.from({ length: N }, () => new Float64Array(N).fill(Infinity))
  for (let a = 0; a < N; a++) {
    onProgress?.(a / N)
    const f = fieldFrom(T, nodes[a].lon, nodes[a].lat, p, win, 1, new Set(at.filter((_, b) => b !== a)))
    for (let b = 0; b < N; b++) if (b !== a && f.time[at[b]] === f.time[at[b]]) { tm[a][b] = f.time[at[b]]; em[a][b] = f.en[at[b]] }
  }
  const unreachable = C.filter((_, j) => tm[0][j + 1] === Infinity || tm[j + 1][0] === Infinity).map((c) => c.id)
  const plans = slacks.map((k) => ({ slack: k, ...bestTour(tm, em, C, minutes, p, timeBudgetH(p, sunset) * 3600 * k, ((p.o2TankKg - reserveKg(p)) / O2_KG_PER_J) * k) }))
  return { plans, unreachable, outside: outside.map((c) => c.id) }
}

function bestTour(tm, em, C, minutes, p, budget, eMax) {
  const n = C.length, stopS = minutes * 60, stopJ = p.stationW * stopS
  const S = 1 << n
  const dt = new Float64Array(S * n).fill(Infinity), de = new Float64Array(S * n), par = new Int8Array(S * n).fill(-1)
  for (let j = 0; j < n; j++) { dt[(1 << j) * n + j] = tm[0][j + 1] + stopS; de[(1 << j) * n + j] = em[0][j + 1] + stopJ }
  let best = null
  for (let m = 1; m < S; m++) {
    for (let j = 0; j < n; j++) {
      const v = dt[m * n + j]
      if (!(m & (1 << j)) || v === Infinity) continue
      const e = de[m * n + j]
      const total = v + tm[j + 1][0], eTot = e + em[j + 1][0]
      if (total <= budget && eTot <= eMax) {
        let cnt = 0; for (let q = m; q; q &= q - 1) cnt++
        if (!best || cnt > best.cnt || (cnt === best.cnt && total < best.total)) best = { cnt, total, eTot, m, j }
      }
      // Partial tours already over budget cannot become feasible: prune them.
      if (v > budget || e > eMax) continue
      for (let k = 0; k < n; k++) {
        if (m & (1 << k)) continue
        const t2 = v + tm[j + 1][k + 1] + stopS
        const m2 = m | (1 << k)
        if (t2 < dt[m2 * n + k]) { dt[m2 * n + k] = t2; de[m2 * n + k] = e + em[j + 1][k + 1] + stopJ; par[m2 * n + k] = j }
      }
    }
  }
  if (!best) return { order: [] }
  const order = []
  for (let m = best.m, j = best.j; j >= 0;) { order.push(C[j].id); const pj = par[m * n + j]; m &= ~(1 << j); j = pj }
  order.reverse()
  return { order, hours: best.total / 3600, o2: best.eTot * O2_KG_PER_J }
}

