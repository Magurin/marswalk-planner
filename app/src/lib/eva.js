// EVA traverse model: walking speed, metabolic cost, consumables and go / no-go checks.
// Planning-grade only. Every number here is an adjustable assumption shown in the UI.
import { Terrain } from './terrain.js';
import { sunAt } from './marstime.js';

const D2R = Math.PI / 180;
export const G_MARS = 3.71;

export const DEFAULTS = {
  flatSpeedKmh: 3.0,   // suited walking pace on level regolith (Apollo crews averaged roughly 2 to 4 km/h on foot)
  massKg: 145,         // astronaut plus suit and life support
  maxSlopeDeg: 20,     // steepest terrain allowed on foot
  evaLimitH: 8,        // suit endurance per EVA
  o2TankKg: 0.75,      // usable primary oxygen
  o2ReserveMin: 45,    // reserve that must remain on return
  stationW: 220,       // metabolic rate while working at a science stop
  walkbackKm: 6,       // furthest allowed straight-line distance from base
  sunsetMarginMin: 60, // be back this long before sunset
  mastM: 10,           // base radio mast height
  reachWorkMin: 30,    // work time at the far point assumed by the reach map
  startLTST: 9.0,
};

// Tobler-style speed against signed grade (rise over run), scaled to the suited flat pace.
export function speedMs(grade, p) {
  const v0 = p.flatSpeedKmh / 3.6;
  return Math.max(0.08, v0 * Math.exp(-3.5 * Math.abs(grade + 0.05) + 0.175));
}
export const vmaxMs = (p) => (p.flatSpeedKmh / 3.6) * Math.exp(0.175);

// Metabolic rate in watts after Santee et al. (2001), the planetary EVA form used by MIT's SEXTANT traverse planner.
export function powerW(v, grade, p) {
  const a = Math.atan(grade), deg = a / D2R, m = p.massKg;
  const level = (3.28 * m + 71.1) * (0.661 * v * Math.cos(a) + 0.115);
  const slope = grade >= 0
    ? 3.5 * m * G_MARS * v * Math.sin(a)
    : 2.4 * m * G_MARS * v * Math.sin(a) * Math.pow(0.3, Math.abs(deg) / 7.65);
  return Math.max(120, level + slope);
}

export const O2_KG_PER_J = 7.11e-8; // about 20.1 kJ per litre of O2, 1.429 g per litre
// Oxygen that must be left on return, sized at a 300 W walk-back rate.
export const reserveKg = (p) => p.o2ReserveMin * 60 * 300 * O2_KG_PER_J;
// Hours the suit and the daylight allow for a walk that starts at p.startLTST.
export const timeBudgetH = (p, sunset) => Math.max(0, Math.min(p.evaLimitH, sunset - p.sunsetMarginMin / 60 - p.startLTST));

// Half-cosine diurnal air temperature between the daily minimum (near sunrise) and maximum (early afternoon).
export function airTemp(ltst, wx, sunrise) {
  if (!wx || wx.tmin == null || wx.tmax == null) return null;
  const tMin = sunrise - 0.3, tMax = 13.5;
  let h = ((ltst - tMin) % 24 + 24) % 24;
  const up = tMax - tMin;
  const f = h <= up ? 0.5 - 0.5 * Math.cos((Math.PI * h) / up) : 0.5 + 0.5 * Math.cos((Math.PI * (h - up)) / (24 - up));
  return wx.tmin + (wx.tmax - wx.tmin) * f;
}

// State of the walk at t seconds after the start, interpolated between samples.
export function sampleAt(R, t) {
  const S = R.samples
  if (!S.length) return null
  if (t <= S[0].t) return S[0]
  if (t >= S[S.length - 1].t) return S[S.length - 1]
  let lo = 0, hi = S.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].t <= t) lo = m; else hi = m }
  const a = S[lo], b = S[hi], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
  const mix = (k) => a[k] + (b[k] - a[k]) * f
  return { ...a, idx: lo, t, ltst: mix('ltst'), d: mix('d'), e: mix('e'), lon: mix('lon'), lat: mix('lat'), z: mix('z'), working: b.v === 0 }
}

// legs: array of polylines ([lon, lat] lists) joining consecutive plan points. stops[i] is the point where leg i ends.
export function analyze(terrain, legs, stops, base, p, env) {
  const STEP = 20;
  const S = [];
  let dist = 0, t = 0, energy = 0, climb = 0, descent = 0, maxSlope = 0, far = 0, farAt = null;
  let losKnown = 0, losYes = 0, offDem = 0, walkT = 0, shadeT = 0;
  const arrivals = [];
  // Cast shadow at each sample, for the sun at the time the walker gets there (cold and poor light).
  const sunCache = new Map();
  const sunFor = (ltst) => {
    const k = Math.round(ltst * 12);
    if (!sunCache.has(k)) sunCache.set(k, sunAt(k / 12, env.decl ?? 0, terrain.lat0));
    return sunCache.get(k);
  };
  const push = (pt, z, slope, grade, v, w, leg) => {
    const los = terrain.losAt(env.viewshed, pt[0], pt[1]);
    if (los !== null) { losKnown++; if (los) losYes++; }
    const ltst = p.startLTST + t / 3600;
    const sh = env.decl != null ? terrain.inShadow(pt[0], pt[1], sunFor(ltst)) : null;
    S.push({ d: dist, t, e: energy, lon: pt[0], lat: pt[1], z, slope, grade, v, w, leg, los, sh, ltst });
  };
  legs.forEach((line, li) => {
    for (let k = 0; k < line.length - 1; k++) {
      const a = line[k], b = line[k + 1];
      const L = Terrain.dist(a, b);
      if (!(L > 0.01)) continue; // zero-length piece (a stop on the base itself): its grade would be 0/0
      const n = Math.max(1, Math.round(L / STEP));
      for (let s = 0; s < n; s++) {
        const p0 = [a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n];
        const p1 = [a[0] + ((b[0] - a[0]) * (s + 1)) / n, a[1] + ((b[1] - a[1]) * (s + 1)) / n];
        const z0 = terrain.elevAt(p0[0], p0[1]), z1 = terrain.elevAt(p1[0], p1[1]);
        const d = L / n;
        const known = z0 === z0 && z1 === z1;
        if (!known) offDem += d;
        const grade = known ? (z1 - z0) / d : 0;
        const slope = known ? terrain.slopeAt(p0[0], p0[1]) : 0;
        const v = speedMs(grade, p), w = powerW(v, grade, p);
        if (S.length === 0) push(p0, z0, slope, grade, v, w, li);
        dist += d; t += d / v; energy += (w * d) / v;
        if (known) { if (z1 > z0) climb += z1 - z0; else descent += z0 - z1; }
        if (slope > maxSlope) maxSlope = slope;
        const fb = Terrain.dist(p1, base);
        if (fb > far) { far = fb; farAt = p1; }
        push(p1, z1, slope, grade, v, w, li);
        const sh = S[S.length - 1].sh;
        if (sh != null) { walkT += d / v; if (sh) shadeT += d / v; }
      }
    }
    const st = stops[li];
    const arrive = t;
    if (st && st.minutes > 0) {
      t += st.minutes * 60; energy += p.stationW * st.minutes * 60;
      const last = S[S.length - 1];
      if (last) S.push({ ...last, t, e: energy, ltst: p.startLTST + t / 3600, w: p.stationW, v: 0 });
    }
    arrivals.push({ arrive, depart: t, ltstArrive: p.startLTST + arrive / 3600, ltstDepart: p.startLTST + t / 3600, dist });
  });

  const hours = t / 3600, endLTST = p.startLTST + hours;
  const o2 = energy * O2_KG_PER_J;
  const avgW = t > 0 ? energy / t : 0;
  const reserve = reserveKg(p);
  const walkbackH = far / 1000 / p.flatSpeedKmh;
  const losPct = losKnown ? (100 * losYes) / losKnown : null;
  const shadowPct = walkT > 0 ? (100 * shadeT) / walkT : null;
  let tLo = Infinity, tHi = -Infinity;
  for (let h = p.startLTST; h <= endLTST + 1e-6; h += 0.25) {
    const T = airTemp(h, env.wx, env.sunrise);
    if (T != null) { tLo = Math.min(tLo, T); tHi = Math.max(tHi, T); }
  }

  const checks = [];
  const fx = (n, d = 0) => (+n).toFixed(d).replace('.', ',');
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
  const lvl = (bad, warn) => (bad ? 'nogo' : warn ? 'caution' : 'go');
  add('slope', 'Крутизна склонов', lvl(maxSlope > p.maxSlopeDeg, maxSlope > p.maxSlopeDeg - 5),
    `Самый крутой участок ${maxSlope.toFixed(0)}°, предел ${fx(p.maxSlopeDeg)}°`);
  add('time', 'Ресурс скафандра', lvl(hours > p.evaLimitH, hours > p.evaLimitH * 0.85),
    `${fx(hours, 1)} ч из ${fx(p.evaLimitH, p.evaLimitH % 1 ? 1 : 0)} ч`);
  const back = env.sunset - endLTST;
  add('sun', 'Световой день', lvl(back < 0 || p.startLTST < env.sunrise, back < p.sunsetMarginMin / 60),
    p.startLTST < env.sunrise ? 'Выход начинается до восхода Солнца' : back >= 0
      ? `Возвращение за ${Math.round(back * 60)} мин до заката` : `Возвращение через ${Math.round(-back * 60)} мин после заката`);
  add('walkback', 'Удаление от базы', lvl(far / 1000 > p.walkbackKm, far / 1000 > p.walkbackKm * 0.8),
    `Самая дальняя точка в ${fx(far / 1000, 2)} км от базы, обратно напрямую около ${Math.round(walkbackH * 60)} мин`);
  add('o2', 'Кислород', lvl(o2 + reserve > p.o2TankKg, o2 + reserve > p.o2TankKg * 0.9),
    `Расход ${fx(o2, 2)} кг и резерв ${fx(reserve, 2)} кг из ${fx(p.o2TankKg, 2)} кг`);
  if (shadowPct != null && shadowPct >= 1) add('shadow', 'Тени на пути', lvl(false, shadowPct > 25),
    `${shadowPct.toFixed(0)}% времени в пути в тени рельефа` + (shadowPct > 25 ? ': холоднее и хуже видно грунт под ногами' : ''));
  if (losPct != null) add('comms', 'Прямая видимость базы', lvl(losPct < 60, losPct < 90),
    `С ${losPct.toFixed(0)}% маршрута видна мачта базы высотой ${fx(p.mastM)} м` + (losPct < 90 ? '. Нужен ретранслятор или точки сеанса связи' : ''));
  if (tLo < Infinity) add('thermal', 'Температура воздуха', lvl(false, tLo < -75),
    `От ${tLo.toFixed(0)} до ${tHi.toFixed(0)} °C во время выхода, оценка по MEDA в Езеро за сол ${env.wx.sol}`);
  if (offDem > 1) add('dem', 'Покрытие моделью рельефа', 'caution', `${fx(offDem / 1000, 2)} км маршрута вне модели рельефа CTX`);

  const order = { go: 0, caution: 1, nogo: 2 };
  const overall = checks.reduce((a, c) => (order[c.status] > order[a] ? c.status : a), 'go');
  return { samples: S, dist, hours, endLTST, energy, avgW, o2, reserveKg: reserve, shadowPct, climb, descent, maxSlope, far, farAt, losPct, tLo, tHi, arrivals, checks, overall };
}
