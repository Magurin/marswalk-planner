/* global L */
import { Terrain, M_PER_DEG, SLOPE_CLASSES, slopeClass } from './terrain.js';
import { marsTime, sunAt, seasonName, fmtH, fmtDur } from './marstime.js';
import { DEFAULTS, analyze, speedMs, vmaxMs } from './eva.js';

const SITE = { name: 'Jezero Crater', lon: 77.45, lat: 18.445 };
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
const FEEDS = {
  waypoints: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json',
  meda: 'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json',
  rems: 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json',
};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Science targets. Positions are not typed in: each one is Perseverance's localized position on the given sol.
const TARGETS = [
  { id: 'oeb', sol: 13, name: 'Octavia E. Butler Landing', sci: 'Perseverance touchdown site on the Maaz formation: basaltic lava that caps the crater floor. Flat and well characterized, a natural base location.' },
  { id: 'citadelle', sol: 199, name: 'Citadelle ridge (Rochette)', sci: 'The first rock cores of the mission were drilled here around sols 190-196: basaltic rock with salts, a datable igneous anchor for the crater timeline.' },
  { id: 'seitah', sol: 286, name: 'South Seitah', sci: 'Olivine-rich igneous cumulate later altered by water to carbonates. Sand ripples fill the gaps between ridges, so pick footing carefully.' },
  { id: 'threeforks', sol: 693, name: 'Three Forks sample depot', sci: 'Ten sealed sample tubes were set down on the surface here (Dec 2022 - Jan 2023) as a backup cache. A retrieval target for a crewed mission.' },
  { id: 'wildcat', sol: 502, name: 'Wildcat Ridge, delta front', sci: 'Fine-grained sulfate-bearing mudstone where SHERLOC logged its richest organic detections up to that point. Prime rock for preserving biosignatures.' },
  { id: 'nukshak', sol: 565, name: 'Cape Nukshak, delta base', sci: 'Foot of the delta scarp: the oldest lake-floor sediments. Layered sandstone and siltstone record the first filling of the lake.' },
  { id: 'belva', sol: 770, name: 'Belva crater rim', sci: 'Small impact crater on the fan top. Its walls expose dipping sandstone beds, a natural road cut into the delta interior.' },
  { id: 'fantop', sol: 899, name: 'Upper fan boulder deposits', sci: 'Rounded boulders carried in by late, high-energy floods. Each one is a sample of the watershed beyond the crater.' },
  { id: 'margin', sol: 1000, name: 'Margin unit', sci: 'Carbonate- and olivine-bearing rock along the inner crater edge, possibly an ancient shoreline. Carbonates are good at trapping biosignatures.' },
  { id: 'brightangel', sol: 1219, name: 'Bright Angel (Cheyava Falls)', sci: 'Light-toned mudstone in Neretva Vallis. The Cheyava Falls rock shows "leopard spot" reaction fronts alongside organics - a potential biosignature and a top sampling priority.' },
  { id: 'lookout', sol: 1354, name: 'Lookout Hill, crater rim crest', sci: 'Top of the Jezero rim after a climb of roughly 500 m. Views into the crater and out over Nili Planum; rim rocks predate the lake.' },
  { id: 'witchhazel', sol: 1416, name: 'Witch Hazel Hill', sci: 'Layered outcrop on the outer rim with rocks that may be among the oldest sampled on Mars, including clay-bearing units.' },
];
const PRESETS = {
  floor: { base: 'oeb', stops: [['citadelle', 30], ['seitah', 40]] },
  delta: { base: 'threeforks', stops: [['wildcat', 45], ['nukshak', 30]] },
};

const state = {
  terrain: null, m20: null, weather: null, live: { meda: false, rems: false, rover: false },
  params: { ...DEFAULTS }, base: null, stops: [], routing: 'terrain',
  viewshed: null, result: null, legs: [], sunLTST: 9, mt: null, pickBase: false,
};
const layers = {};
const routeCache = new Map();

// ---------- map ----------
const map = L.map('map', { crs: L.CRS.EPSG4326, center: [SITE.lat, SITE.lon], zoom: 11, minZoom: 3, maxZoom: 18, zoomSnap: 0.5, attributionControl: true });
map.attributionControl.setPrefix(false).addAttribution('Tiles: NASA Solar System Treks (JPL). Terrain: USGS Astrogeology. Rover and weather: NASA/JPL-Caltech');
const trek = (id, ext, maxNative, o = {}) => L.tileLayer(`${TREK}/${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`, { maxNativeZoom: maxNative, maxZoom: 19, noWrap: true, ...o });
const box = (w, s, e, n) => L.latLngBounds([s, w], [n, e]);
map.createPane('raster').style.zIndex = 300;
map.createPane('analysis').style.zIndex = 350;
for (const p of ['raster', 'analysis']) map.getPane(p).style.pointerEvents = 'none';

L.layerGroup([
  trek('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 7),
  trek('Jezero_CTX_BlockAdj_dd', 'png', 10, { bounds: box(75.154, 15.906, 78.872, 19.445) }),
  trek('JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', 'png', 13, { bounds: box(77.1605, 18.2111, 77.6991, 18.7211) }),
  trek('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png', 17, { bounds: box(77.223, 18.3068, 77.5839, 18.6693), minZoom: 12 }),
]).addTo(map);

const LAYER_DEFS = [
  { group: 'Orbital imagery and thermal' },
  { id: 'mola', name: 'Colour elevation', tag: 'MGS - MOLA laser altimeter, 463 m', opacity: 0.45, make: () => trek('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg', 7, { pane: 'raster' }) },
  { id: 'themisDay', name: 'Daytime infrared', tag: 'Mars Odyssey - THEMIS, 100 m', opacity: 0.7, make: () => trek('THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', 'png', 9, { pane: 'raster' }) },
  { id: 'themisNight', name: 'Night infrared (rock vs dust)', tag: 'Mars Odyssey - THEMIS. Bright = rocky, holds heat. Dark = loose dust or sand', opacity: 0.7, make: () => trek('THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', 'png', 9, { pane: 'raster' }) },
  { group: 'Terrain analysis (computed from MRO CTX stereo DTM)' },
  { id: 'slope', name: 'Slope hazard', tag: '20 m slope classes for walking', opacity: 0.6, on: true, legend: true, make: () => overlayFrom(state.terrain.slopeCanvas()) },
  { id: 'shade', name: 'Sun and shadows', tag: 'Cast shadows for the chosen local time', opacity: 0.85, make: () => overlayFrom(shadeCanvas()) },
  { id: 'los', name: 'Radio shadow from base', tag: 'Purple = no line of sight to base mast', opacity: 0.8, make: () => overlayFrom(state.terrain.viewshedCanvas(state.viewshed)) },
  { id: 'ring', name: 'Walk-back limit ring', tag: 'Straight-line range limit around base', on: true, vector: true, make: () => L.layerGroup() },
  { group: 'Surface missions' },
  { id: 'track', name: 'Perseverance traverse', tag: 'Mars 2020 - rover localization', on: true, vector: true, make: () => L.layerGroup() },
  { id: 'heli', name: 'Ingenuity flights', tag: 'Mars 2020 - helicopter airfields', vector: true, make: () => L.layerGroup() },
  { id: 'targets', name: 'Science targets', tag: 'Key sites ground-truthed by the rover', on: true, vector: true, make: () => L.layerGroup() },
];

function overlayFrom(canvas) {
  return L.imageOverlay(canvas.toDataURL('image/png'), state.terrain.bounds, { pane: 'analysis', interactive: false });
}
function refreshOverlay(id) {
  const def = LAYER_DEFS.find((d) => d.id === id), old = layers[id];
  if (!old || !map.hasLayer(old.layer)) { if (old) old.stale = true; return; }
  map.removeLayer(old.layer);
  old.layer = def.make();
  old.layer.setOpacity(old.opacity).addTo(map);
  old.stale = false;
}
function setLayer(id, on) {
  const def = LAYER_DEFS.find((d) => d.id === id);
  let rec = layers[id];
  if (on) {
    if (!rec) rec = layers[id] = { layer: def.make(), opacity: def.opacity ?? 1 };
    else if (rec.stale && !def.vector) { rec.layer = def.make(); rec.stale = false; }
    if (rec.layer.setOpacity) rec.layer.setOpacity(rec.opacity);
    rec.layer.addTo(map);
    if (def.vector) drawVector(id);
  } else if (rec) map.removeLayer(rec.layer);
  if (def.legend) $('#legend').hidden = !on;
}

function buildLayerUI() {
  const el = $('#layers');
  el.innerHTML = LAYER_DEFS.map((d) => d.group
    ? `<div class="group-title">${esc(d.group)}</div>`
    : `<div class="layer ${d.on ? '' : 'off'}" data-id="${d.id}"><label><input type="checkbox" ${d.on ? 'checked' : ''}><span class="name">${esc(d.name)}<span class="tag">${esc(d.tag)}</span></span></label>${d.vector ? '' : `<input type="range" min="0" max="1" step="0.05" value="${d.opacity ?? 1}" aria-label="${esc(d.name)} opacity">`}</div>`).join('');
  el.addEventListener('change', (e) => {
    const row = e.target.closest('.layer');
    if (!row || e.target.type !== 'checkbox') return;
    row.classList.toggle('off', !e.target.checked);
    setLayer(row.dataset.id, e.target.checked);
  });
  el.addEventListener('input', (e) => {
    if (e.target.type !== 'range') return;
    const id = e.target.closest('.layer').dataset.id, rec = layers[id];
    if (rec) { rec.opacity = +e.target.value; rec.layer.setOpacity(rec.opacity); }
  });
  $('#legend').innerHTML = '<h4>Slope (CTX DTM, 20 m)</h4>' + SLOPE_CLASSES.map((c) => `<div><i style="background:rgb(${c.color})"></i>${c.label} <span class="muted">${c.note}</span></div>`).join('');
  $('#sources').innerHTML = [
    ['MRO HiRISE', '25 cm orthomosaic of Jezero'], ['MRO CTX', '6 m mosaic and 20 m stereo terrain model'],
    ['MGS MOLA', 'global laser altimetry, vertical reference'], ['Mars Odyssey THEMIS', 'day and night thermal infrared'],
    ['Viking Orbiters', 'global colour context mosaic'], ['Mars 2020 Perseverance', 'traverse, ground truth, MEDA weather'],
    ['Mars 2020 Ingenuity', 'flight log and airfields'], ['MSL Curiosity REMS', 'multi-year seasonal weather record'],
  ].map(([a, b]) => `<li><b>${a}</b> - ${b}</li>`).join('');
}

// Mars-aware scale bar (Leaflet's own assumes Earth's radius)
const ScaleCtl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd() { this.el = L.DomUtil.create('div', 'mscale'); map.on('zoomend', this.update, this); this.update(); return this.el; },
  update() {
    const mpp = (180 / (256 * 2 ** map.getZoom())) * M_PER_DEG;
    const nice = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
    const m = nice.find((n) => n / mpp >= 60) || nice[nice.length - 1];
    this.el.style.width = `${Math.round(m / mpp)}px`;
    this.el.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
  },
});
map.addControl(new ScaleCtl());

const icon = (cls, size, text = '') => L.divIcon({ className: '', html: `<div class="mk ${cls}" style="width:${size}px;height:${size}px">${text}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

// ---------- mission vectors ----------
function targetPositions() {
  const wp = state.m20.waypoints;
  for (const t of TARGETS) {
    const p = wp.reduce((a, b) => (Math.abs(b.sol - t.sol) < Math.abs(a.sol - t.sol) ? b : a));
    Object.assign(t, { lon: p.lon, lat: p.lat, elev: p.elev, atSol: p.sol });
  }
}
function popupHtml(t) {
  return `<h4>${esc(t.name)}</h4><p>${esc(t.sci)}</p><div class="meta">${t.lat.toFixed(5)} N, ${t.lon.toFixed(5)} E, ${t.elev != null ? Math.round(t.elev) + ' m' : ''}<br>${esc(t.src || `Rover position on sol ${t.atSol}`)}</div><div class="btns"><button class="btn small" data-act="add" data-id="${t.id}">Add as EVA stop</button><button class="btn small" data-act="base" data-id="${t.id}">Set base here</button></div>`;
}
function drawVector(id) {
  const rec = layers[id];
  if (!rec || !state.m20) return;
  const g = rec.layer; g.clearLayers();
  if (id === 'track') {
    const lines = state.m20.traverse.map((s) => s.c.map((c) => [c[1], c[0]]));
    L.polyline(lines, { color: '#04121c', weight: 5, opacity: 0.6, interactive: false }).addTo(g);
    L.polyline(lines, { color: '#6cc5ff', weight: 2.2, interactive: false }).addTo(g);
    const wp = state.m20.waypoints, last = wp[wp.length - 1];
    L.marker([last.lat, last.lon], { icon: icon('rover', 14), zIndexOffset: 400 }).addTo(g)
      .bindPopup(`<h4>Perseverance, latest position</h4><p>Sol ${last.sol}. Odometer ${last.km || '?'} km, tilt ${last.tilt} deg, elevation ${Math.round(last.elev)} m.</p><div class="meta">${state.live.rover ? 'Live NASA localization feed' : 'Bundled snapshot of the NASA feed'}</div>`);
  } else if (id === 'heli') {
    const h = state.m20.heli;
    L.polyline(h.map((f) => [f.lat, f.lon]), { color: '#7be0a0', weight: 1.5, dashArray: '4 4', interactive: false }).addTo(g);
    h.forEach((f, i) => {
      const fin = i === h.length - 1;
      L.marker([f.lat, f.lon], { icon: icon('heli', fin ? 12 : 7) }).addTo(g).bindPopup(`<h4>Ingenuity ${fin ? 'final airfield' : 'airfield'}</h4><p>Landed here after flight ${f.flight} on sol ${f.sol}. ${f.dist_m ? `Flew ${Math.round(f.dist_m)} m` : ''}${f.alt_m ? `, max height ${f.alt_m} m` : ''}.${fin ? ' The helicopter rests here with a damaged rotor: an engineering inspection target.' : ''}</p>`);
    });
  } else if (id === 'targets') {
    for (const t of TARGETS) L.marker([t.lat, t.lon], { icon: icon('sci', 12), title: t.name }).addTo(g).bindPopup(popupHtml(t)).bindTooltip(t.name, { direction: 'top', offset: [0, -8] });
  } else if (id === 'ring') drawRing();
}
function drawRing() {
  const rec = layers.ring;
  if (!rec || !state.base) return;
  rec.layer.clearLayers();
  const r = state.params.walkbackKm * 1000, pts = [];
  for (let a = 0; a <= 360; a += 4) {
    pts.push([state.base.lat + (r * Math.cos((a * Math.PI) / 180)) / M_PER_DEG, state.base.lon + (r * Math.sin((a * Math.PI) / 180)) / (M_PER_DEG * Math.cos((state.base.lat * Math.PI) / 180))]);
  }
  L.polyline(pts, { color: '#6cc5ff', weight: 1.5, dashArray: '6 6', opacity: 0.9, interactive: false }).addTo(rec.layer);
}

// ---------- plan ----------
const planLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const hoverMk = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#ff8a4c', fillOpacity: 1, interactive: false });

function save() {
  try { localStorage.setItem('marswalk.plan', JSON.stringify({ base: state.base, stops: state.stops, params: state.params, routing: state.routing })); } catch { /* storage unavailable */ }
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('marswalk.plan') || 'null');
    if (!s || !s.base) return false;
    state.base = s.base; state.stops = s.stops || []; state.routing = s.routing || 'terrain';
    Object.assign(state.params, s.params || {});
    return true;
  } catch { return false; }
}
function setBase(pt, name) {
  state.base = { lon: pt.lon, lat: pt.lat, name: name || 'Custom base' };
  routeCache.clear();
  state.viewshed = state.terrain.viewshed(state.base.lon, state.base.lat, state.params.mastM);
  refreshOverlay('los'); drawRing(); replan();
}
function addStop(pt, name, minutes = 20) {
  state.stops.push({ lon: pt.lon, lat: pt.lat, name: name || `Stop ${state.stops.length + 1}`, minutes });
  replan();
}
function loadPreset(key) {
  const p = PRESETS[key], by = (id) => TARGETS.find((t) => t.id === id);
  state.stops = p.stops.map(([id, minutes]) => ({ lon: by(id).lon, lat: by(id).lat, name: by(id).name, minutes }));
  setBase(by(p.base), by(p.base).name);
  fitPlan();
}
function fitPlan() {
  const pts = [state.base, ...state.stops].map((p) => [p.lat, p.lon]);
  map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 15 });
}

function legRoute(a, b) {
  const p = state.params;
  if (state.routing !== 'terrain') return { line: [a, b], routed: false };
  const key = [a, b, p.flatSpeedKmh, p.maxSlopeDeg].flat().map((v) => (+v).toFixed(6)).join(',');
  if (!routeCache.has(key)) {
    const line = state.terrain.route(a, b, { speed: (g) => speedMs(g, p), vmax: vmaxMs(p), maxSlope: p.maxSlopeDeg });
    routeCache.set(key, line);
  }
  const line = routeCache.get(key);
  return line ? { line, routed: true } : { line: [a, b], routed: false, failed: true };
}

function replan() {
  const T = state.terrain;
  if (!T || !state.base) return;
  $('#baseName').textContent = state.base.name;
  const pts = [state.base, ...state.stops, state.base].map((p) => [p.lon, p.lat]);
  const failed = [];
  state.legs = [];
  if (state.stops.length) {
    for (let i = 0; i < pts.length - 1; i++) {
      const r = legRoute(pts[i], pts[i + 1]);
      if (r.failed) failed.push(i);
      state.legs.push(r.line);
    }
  }
  const mt = state.mt;
  const wx = jezeroWx();
  const env = { viewshed: state.viewshed, sunrise: mt.sunrise, sunset: mt.sunset, wx };
  state.result = state.legs.length ? analyze(T, state.legs, [...state.stops, null], [state.base.lon, state.base.lat], state.params, env) : null;
  if (state.result && failed.length) {
    state.result.checks.unshift({ id: 'route', label: 'Routing', status: 'nogo', detail: `No walkable path under ${state.params.maxSlopeDeg} deg for leg ${failed.map((i) => i + 1).join(', ')}. Straight line shown instead.` });
    state.result.overall = 'nogo';
  }
  drawPlan(); renderPlan(); drawProfile(); save();
}

function drawPlan() {
  planLayer.clearLayers(); routeLayer.clearLayers();
  const b = state.base;
  const bm = L.marker([b.lat, b.lon], { icon: icon('base', 22, 'H'), draggable: true, zIndexOffset: 900, title: 'Base / habitat' }).addTo(planLayer);
  bm.on('dragend', () => { const ll = bm.getLatLng(); setBase({ lon: ll.lng, lat: ll.lat }, 'Custom base'); });
  state.stops.forEach((s, i) => {
    const m = L.marker([s.lat, s.lon], { icon: icon('stop', 22, i + 1), draggable: true, zIndexOffset: 800, title: s.name }).addTo(planLayer);
    m.on('dragend', () => { const ll = m.getLatLng(); s.lon = ll.lng; s.lat = ll.lat; replan(); });
  });
  const R = state.result;
  if (!R) return;
  const all = R.samples.map((s) => [s.lat, s.lon]);
  L.polyline(all, { color: '#0b0f14', weight: 8, opacity: 0.85, interactive: false }).addTo(routeLayer);
  let run = [], cls = -1;
  const flush = () => { if (run.length > 1) L.polyline(run, { color: `rgb(${SLOPE_CLASSES[Math.max(0, cls)].color})`, weight: 4, interactive: false }).addTo(routeLayer); };
  for (const s of R.samples) {
    const k = slopeClass(s.slope);
    if (k !== cls) { flush(); run = run.length ? [run[run.length - 1]] : []; cls = k; }
    run.push([s.lat, s.lon]);
  }
  flush();
}

function renderPlan() {
  const R = state.result, p = state.params;
  const v = $('#verdict');
  if (!R) {
    v.className = 'verdict idle';
    v.innerHTML = 'No route yet. Click the map to drop stops, pick a science target, or load a demo loop.';
    $('#stats').innerHTML = ''; $('#checks').innerHTML = '';
  } else {
    const txt = { go: 'GO', caution: 'GO WITH CAUTION', nogo: 'NO-GO' }[R.overall];
    const bad = R.checks.filter((c) => c.status !== 'go').map((c) => c.label.toLowerCase());
    v.className = `verdict ${R.overall}`;
    v.innerHTML = `${txt}<small>${bad.length ? 'Review: ' + esc(bad.join(', ')) : 'All checks pass for this plan and these conditions'}</small>`;
    const stat = (b, val, em = '') => `<div class="stat"><b>${b}</b><span>${val}</span> <em>${em}</em></div>`;
    $('#stats').innerHTML = [
      stat('Distance', (R.dist / 1000).toFixed(2), 'km'),
      stat('Duration', fmtDur(R.hours), ''),
      stat('Back at base', fmtH(R.endLTST), `LTST, sunset ${fmtH(state.mt.sunset)}`),
      stat('Climb / descent', `${Math.round(R.climb)} / ${Math.round(R.descent)}`, 'm'),
      stat('Energy', Math.round(R.energy / 4184), `kcal, avg ${Math.round(R.avgW)} W`),
      stat('Oxygen', R.o2.toFixed(2), `kg of ${p.o2TankKg}`),
      stat('Max slope', R.maxSlope.toFixed(0), 'deg'),
      stat('Line of sight', R.losPct == null ? 'n/a' : R.losPct.toFixed(0) + '%', 'of route'),
    ].join('');
    $('#checks').innerHTML = R.checks.map((c) => `<li><div class="badge ${c.status}">${{ go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' }[c.status]}</div><div>${esc(c.label)}<span>${esc(c.detail)}</span></div></li>`).join('');
  }
  const ol = $('#stops');
  if (!state.stops.length) { ol.innerHTML = '<li class="empty" style="display:block">No stops yet.</li>'; return; }
  const near = (s) => {
    const t = TARGETS.map((t) => [Terrain.dist([s.lon, s.lat], [t.lon, t.lat]), t]).sort((a, b) => a[0] - b[0])[0];
    return t[0] < 400 ? `near ${t[1].name}` : '';
  };
  ol.innerHTML = `<li class="end"><div class="n h">H</div><div>Depart ${esc(state.base.name)}</div><div></div><div>${fmtH(p.startLTST)}</div></li>` +
    state.stops.map((s, i) => {
      const a = R?.arrivals[i];
      const z = state.terrain.elevAt(s.lon, s.lat);
      return `<li data-i="${i}"><div class="n">${i + 1}</div><input type="text" value="${esc(s.name)}" aria-label="Stop name"><input type="number" min="0" max="240" step="5" value="${s.minutes}" title="Minutes of work at this stop" aria-label="Minutes at stop"><button class="x" title="Remove stop" aria-label="Remove stop">x</button><div class="sub">${a ? `arrive ${fmtH(a.ltstArrive)}, ${(a.dist / 1000).toFixed(2)} km in` : ''}${z === z ? `, ${Math.round(z)} m` : ''}${near(s) ? ', ' + esc(near(s)) : ''}, ${s.minutes} min on site</div></li>`;
    }).join('') +
    (R ? `<li class="end"><div class="n h">H</div><div>Return to base</div><div></div><div>${fmtH(R.endLTST)}</div></li>` : '');
}

// ---------- elevation profile ----------
let profGeom = null;
function drawProfile() {
  const cv = $('#profileCv'), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  g.font = '11px "Segoe UI", system-ui, sans-serif';
  const R = state.result;
  profGeom = null;
  if (!R) { g.fillStyle = '#93a0b2'; g.fillText('The profile appears once the plan has at least one stop.', 8, 20); return; }
  const S = R.samples.filter((s) => s.z === s.z);
  if (S.length < 2) return;
  const m = { l: 44, r: 10, t: 14, b: 20 };
  let z0 = Infinity, z1 = -Infinity;
  for (const s of S) { if (s.z < z0) z0 = s.z; if (s.z > z1) z1 = s.z; }
  const pad = Math.max(5, (z1 - z0) * 0.12); z0 -= pad; z1 += pad;
  const X = (d) => m.l + (d / R.dist) * (w - m.l - m.r), Y = (z) => h - m.b - ((z - z0) / (z1 - z0)) * (h - m.t - m.b);
  g.strokeStyle = '#2a3442'; g.fillStyle = '#93a0b2'; g.lineWidth = 1;
  const stepZ = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => (z1 - z0) / s <= 4) || 500;
  for (let z = Math.ceil(z0 / stepZ) * stepZ; z <= z1; z += stepZ) {
    g.beginPath(); g.moveTo(m.l, Y(z)); g.lineTo(w - m.r, Y(z)); g.stroke();
    g.textAlign = 'right'; g.fillText(`${z} m`, m.l - 5, Y(z) + 4);
  }
  const stepD = [100, 200, 500, 1000, 2000, 5000].find((s) => R.dist / s <= 8) || 5000;
  g.textAlign = 'center';
  for (let d = 0; d <= R.dist; d += stepD) g.fillText(d >= 1000 || stepD >= 1000 ? `${(d / 1000).toFixed(stepD < 1000 ? 1 : 0)} km` : `${d} m`, X(d), h - 5);
  g.beginPath(); g.moveTo(X(S[0].d), h - m.b);
  for (const s of S) g.lineTo(X(s.d), Y(s.z));
  g.lineTo(X(S[S.length - 1].d), h - m.b); g.closePath();
  g.fillStyle = '#ff8a4c1c'; g.fill();
  g.lineWidth = 2.2; g.lineJoin = 'round';
  for (let i = 1; i < S.length; i++) {
    g.strokeStyle = `rgb(${SLOPE_CLASSES[Math.max(0, slopeClass(S[i].slope))].color})`;
    g.beginPath(); g.moveTo(X(S[i - 1].d), Y(S[i - 1].z)); g.lineTo(X(S[i].d), Y(S[i].z)); g.stroke();
  }
  // radio shadow strip
  for (let i = 1; i < S.length; i++) if (S[i].los === false) { g.fillStyle = '#b030be'; g.fillRect(X(S[i - 1].d), h - m.b + 1, Math.max(1, X(S[i].d) - X(S[i - 1].d)), 3); }
  R.arrivals.slice(0, -1).forEach((a, i) => {
    const x = X(a.dist);
    g.strokeStyle = '#ffffff55'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, m.t); g.lineTo(x, h - m.b); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ff8a4c'; g.beginPath(); g.arc(x, m.t, 7, 0, 7); g.fill();
    g.fillStyle = '#1a0d05'; g.font = 'bold 10px "Segoe UI", sans-serif'; g.fillText(i + 1, x, m.t + 3.5); g.font = '11px "Segoe UI", system-ui, sans-serif';
  });
  profGeom = { S, X, m, w, h, dist: R.dist };
}
function profileHover(e) {
  if (!profGeom) return;
  const { S, m, w, dist } = profGeom;
  const r = e.currentTarget.getBoundingClientRect();
  const d = ((e.clientX - r.left - m.l) / (w - m.l - m.r)) * dist;
  if (d < 0 || d > dist) return profileLeave();
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid].d < d) lo = mid; else hi = mid; }
  const s = S[hi];
  hoverMk.setLatLng([s.lat, s.lon]).addTo(map);
  $('#profileInfo').textContent = `${(s.d / 1000).toFixed(2)} km, ${Math.round(s.z)} m, slope ${s.slope.toFixed(0)} deg, grade ${(s.grade * 100).toFixed(0)}%, ${(s.v * 3.6).toFixed(1)} km/h, ${Math.round(s.w)} W, LTST ${fmtH(s.ltst)}${s.los === false ? ', no line of sight to base' : ''}`;
}
function profileLeave() { map.removeLayer(hoverMk); $('#profileInfo').textContent = 'colour shows terrain slope, purple strip marks radio shadow'; }

// ---------- time, sun, weather ----------
function tick() {
  const now = new Date();
  const mt = (state.mt = marsTime(now, SITE.lon, SITE.lat));
  const day = mt.sun.el > 0;
  const chip = (b, v, cls = '') => `<div class="chip ${cls}"><b>${b}</b><span>${v}</span></div>`;
  $('#clock').innerHTML = [
    chip('Jezero solar time', `${fmtH(mt.ltst)} LTST`, day ? 'day' : 'night'),
    chip('Mission sol', `Sol ${mt.sol} (M2020)`),
    chip('Season', `Ls ${mt.ls.toFixed(1)} - ${seasonName(mt.ls)}`),
    chip('Sun', day ? `${mt.sun.el.toFixed(0)} deg up, az ${mt.sun.az.toFixed(0)}` : 'below horizon', day ? 'day' : 'night'),
    chip('Sunrise / sunset', `${fmtH(mt.sunrise)} / ${fmtH(mt.sunset)}`),
    chip('Earth UTC', now.toISOString().slice(0, 16).replace('T', ' ')),
  ].join('');
}
function sunVec() { return sunAt(state.sunLTST, state.mt.decl, SITE.lat); }
function shadeCanvas() { return state.terrain.shadeCanvas(sunVec()); }
function updateSunUI(recompute = true) {
  const s = sunVec();
  $('#sunTime').value = state.sunLTST;
  $('#sunOut').textContent = `${fmtH(state.sunLTST)} LTST`;
  $('#sunInfo').textContent = s.el > 0 ? `Sun ${s.el.toFixed(0)} deg above horizon, azimuth ${s.az.toFixed(0)} deg` : 'Sun below horizon';
  if (recompute) refreshOverlay('shade');
}

function latestValid(sols) { return [...sols].reverse().find((s) => num(s.min_temp) != null && num(s.max_temp) != null); }
function jezeroWx() {
  const s = state.weather && latestValid(state.weather.meda.sols || []);
  return s ? { tmin: num(s.min_temp), tmax: num(s.max_temp), p: num(s.pressure), sol: s.sol, date: s.terrestrial_date, ls: num(s.ls) } : null;
}
function renderWx() {
  const W = state.weather;
  if (!W) return;
  const j = jezeroWx(), r = W.rems.find((s) => s.tmin != null && s.tmax != null) || W.rems[0];
  const pill = (live) => `<span class="pill ${live ? 'live' : ''}">${live ? 'live feed' : 'snapshot'}</span>`;
  const cell = (b, v) => `<div><b>${b}</b><span>${v}</span></div>`;
  const lsGap = j ? Math.abs(((j.ls - state.mt.ls + 540) % 360) - 180) : 0;
  $('#wx').innerHTML = `
  <div class="wxcard"><h4>Jezero - Perseverance MEDA ${pill(state.live.meda)}</h4>
    ${j ? `<div class="wxgrid">${cell('Air max', j.tmax.toFixed(0) + ' C')}${cell('Air min', j.tmin.toFixed(0) + ' C')}${cell('Pressure', j.p != null ? j.p.toFixed(0) + ' Pa' : 'n/a')}</div>
    <div class="small muted">Latest sol NASA has published: sol ${j.sol} (${j.date}), Ls ${j.ls.toFixed(0)}.${lsGap > 30 ? ` That is ${lsGap.toFixed(0)} deg of Ls away from today's season, so treat it as indicative.` : ''} Drives the thermal check.</div>` : '<div class="muted">No MEDA data available.</div>'}
  </div>
  <div class="wxcard"><h4>Gale - Curiosity REMS ${pill(state.live.rems)}</h4>
    <div class="wxgrid">${cell('Air max', r.tmax + ' C')}${cell('Air min', r.tmin + ' C')}${cell('Pressure', r.p != null ? r.p + ' Pa' : 'n/a')}</div>
    <div class="wxgrid">${cell('Sky', esc(r.op || 'n/a'))}${cell('UV', esc(r.uv || 'n/a'))}${cell('Sol', r.sol)}</div>
    <div class="small muted">Sol ${r.sol} (${r.date}), Ls ${r.ls}. Curiosity is about 3,700 km from Jezero: use it for the planet-wide dust and seasonal picture, not as a local forecast.</div>
    <canvas id="remsCv"></canvas>
    <div class="small muted">Daily max (orange) and min (blue) air temperature against season for ${W.rems.length} sols of REMS data. White line: today.</div>
  </div>`;
  const cv = $('#remsCv'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const X = (ls) => 26 + (ls / 360) * (w - 30), Y = (t) => 6 + ((20 - t) / 130) * (h - 22);
  g.font = '10px "Segoe UI", sans-serif'; g.fillStyle = '#93a0b2'; g.strokeStyle = '#2a3442';
  for (const t of [0, -50, -100]) { g.beginPath(); g.moveTo(26, Y(t)); g.lineTo(w - 4, Y(t)); g.stroke(); g.textAlign = 'right'; g.fillText(t, 22, Y(t) + 3); }
  g.textAlign = 'center';
  for (const ls of [0, 90, 180, 270, 360]) g.fillText(`Ls ${ls}`, Math.min(w - 16, Math.max(40, X(ls))), h - 2);
  for (const s of W.rems) {
    if (s.ls == null) continue;
    if (s.tmax != null && s.tmax > -110 && s.tmax < 30) { g.fillStyle = '#ff8a4c66'; g.fillRect(X(s.ls), Y(s.tmax), 1.5, 1.5); }
    if (s.tmin != null && s.tmin > -110 && s.tmin < 30) { g.fillStyle = '#6cc5ff66'; g.fillRect(X(s.ls), Y(s.tmin), 1.5, 1.5); }
  }
  g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(X(state.mt.ls), 4); g.lineTo(X(state.mt.ls), h - 14); g.stroke();
}

const trimRems = (soles) => soles.map((s) => ({ sol: +s.sol, date: s.terrestrial_date, ls: num(s.ls), tmin: num(s.min_temp), tmax: num(s.max_temp), p: num(s.pressure), op: s.atmo_opacity, uv: s.local_uv_irradiance_index }));
async function refreshLive() {
  const get = (u) => fetch(u, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  get(FEEDS.meda).then((d) => { if (d.sols?.length) { state.weather.meda = d; state.live.meda = true; renderWx(); replan(); } }).catch(() => {});
  get(FEEDS.rems).then((d) => { if (d.soles?.length) { state.weather.rems = trimRems(d.soles); state.live.rems = true; renderWx(); } }).catch(() => {});
  get(FEEDS.waypoints).then((d) => {
    const wp = d.features.map((f) => { const p = f.properties; return { sol: p.sol, lon: p.lon, lat: p.lat, elev: p.elev_geoid, tilt: +(p.tilt || 0).toFixed(1), km: p.dist_km, note: p.Note || '' }; });
    if (wp.length >= state.m20.waypoints.length) {
      const known = state.m20.waypoints.length;
      if (wp.length > known) state.m20.traverse.push({ sol: wp[known].sol, c: wp.slice(known - 1).map((p) => [p.lon, p.lat]) });
      state.m20.waypoints = wp; state.live.rover = true; drawVector('track');
    }
  }).catch(() => {});
}

// ---------- UI wiring ----------
function buildParams() {
  const F = [
    ['flatSpeedKmh', 'Flat walking pace, km/h', 0.1], ['massKg', 'Astronaut + suit mass, kg', 1], ['maxSlopeDeg', 'Max slope on foot, deg', 1],
    ['evaLimitH', 'Suit endurance, h', 0.5], ['o2TankKg', 'Usable oxygen, kg', 0.05], ['o2ReserveMin', 'Oxygen reserve, min', 5],
    ['stationW', 'Work rate at stops, W', 10], ['walkbackKm', 'Walk-back limit, km', 0.5], ['sunsetMarginMin', 'Back before sunset, min', 5], ['mastM', 'Base mast height, m', 1],
  ];
  $('#params').innerHTML = F.map(([k, label, step]) => `<label for="p_${k}">${label}</label><input id="p_${k}" data-k="${k}" type="number" step="${step}" min="0" value="${state.params[k]}">`).join('');
  $('#params').addEventListener('change', (e) => {
    const k = e.target.dataset.k, v = parseFloat(e.target.value);
    if (!k || !(v > 0)) { e.target.value = state.params[k]; return; }
    state.params[k] = v;
    if (k === 'mastM') { state.viewshed = state.terrain.viewshed(state.base.lon, state.base.lat, v); refreshOverlay('los'); }
    if (k === 'walkbackKm') drawRing();
    replan();
  });
}
function wire() {
  map.on('click', (e) => {
    const pt = { lon: e.latlng.lng, lat: e.latlng.lat };
    if (!state.terrain.inside(pt.lon, pt.lat)) { $('#hint').textContent = 'That point is outside the Jezero terrain model. Stay inside the crater region.'; return; }
    if (state.pickBase) { state.pickBase = false; $('#pickBase').classList.remove('active'); $('#pickBase').textContent = 'Move base'; setBase(pt, 'Custom base'); } else addStop(pt);
    $('#hint').textContent = 'Click the map to add an EVA stop. Drag markers to adjust.';
  });
  map.on('mousemove', (e) => {
    const { lng, lat } = e.latlng, T = state.terrain;
    const z = T.elevAt(lng, lat), s = T.slopeAt(lng, lat);
    const d = state.base ? Terrain.dist([lng, lat], [state.base.lon, state.base.lat]) : null;
    $('#readout').textContent = `${lat.toFixed(5)} N  ${lng.toFixed(5)} E` + (z === z ? `   elev ${z.toFixed(0)} m   slope ${s.toFixed(0)} deg` : '   outside terrain model') + (d != null ? `   ${(d / 1000).toFixed(2)} km from base` : '');
  });
  $('#map').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const t = TARGETS.find((x) => x.id === b.dataset.id);
    map.closePopup();
    if (b.dataset.act === 'add') addStop(t, t.name, 30); else setBase(t, t.name);
  });
  $('#stops').addEventListener('change', (e) => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    const s = state.stops[+li.dataset.i];
    if (e.target.type === 'text') s.name = e.target.value.trim() || s.name; else s.minutes = Math.max(0, Math.min(240, parseFloat(e.target.value) || 0));
    replan();
  });
  $('#stops').addEventListener('click', (e) => {
    if (!e.target.classList.contains('x')) return;
    state.stops.splice(+e.target.closest('li').dataset.i, 1); replan();
  });
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => loadPreset(b.dataset.preset)));
  $('#clearPlan').addEventListener('click', () => { state.stops = []; replan(); });
  $('#pickBase').addEventListener('click', (e) => { state.pickBase = !state.pickBase; e.target.classList.toggle('active', state.pickBase); e.target.textContent = state.pickBase ? 'Click the map...' : 'Move base'; });
  $('#routing').value = state.routing;
  $('#routing').addEventListener('change', (e) => { state.routing = e.target.value; replan(); });
  $('#startTime').value = fmtH(state.params.startLTST);
  $('#startTime').addEventListener('change', (e) => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isFinite(h)) { state.params.startLTST = h + (m || 0) / 60; replan(); } });
  let sunTimer;
  $('#sunTime').addEventListener('input', (e) => { state.sunLTST = +e.target.value; updateSunUI(false); clearTimeout(sunTimer); sunTimer = setTimeout(() => refreshOverlay('shade'), 120); });
  $('#sunNow').addEventListener('click', () => { state.sunLTST = Math.round(state.mt.ltst * 4) / 4; updateSunUI(); });
  $('#sunStart').addEventListener('click', () => { state.sunLTST = state.params.startLTST; updateSunUI(); });
  $('#exportPlan').addEventListener('click', exportPlan);
  const cv = $('#profileCv');
  cv.addEventListener('mousemove', profileHover); cv.addEventListener('mouseleave', profileLeave);
  new ResizeObserver(() => { drawProfile(); map.invalidateSize(); }).observe($('#center'));
}
function exportPlan() {
  const R = state.result, f = [];
  const pt = (p, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
  f.push(pt(state.base, { role: 'base', name: state.base.name }));
  state.stops.forEach((s, i) => f.push(pt(s, { role: 'stop', order: i + 1, name: s.name, minutes: s.minutes, arrive_ltst: R ? fmtH(R.arrivals[i].ltstArrive) : null })));
  if (R) f.push({ type: 'Feature', properties: { role: 'route', distance_m: Math.round(R.dist), duration_h: +R.hours.toFixed(2), start_ltst: fmtH(state.params.startLTST), end_ltst: fmtH(R.endLTST), climb_m: Math.round(R.climb), max_slope_deg: +R.maxSlope.toFixed(1), o2_kg: +R.o2.toFixed(3), verdict: R.overall, checks: R.checks, assumptions: state.params, body: 'Mars', crs: 'IAU Mars 2000 sphere, planetocentric, east-positive' }, geometry: { type: 'LineString', coordinates: R.samples.map((s) => [+s.lon.toFixed(6), +s.lat.toFixed(6), s.z === s.z ? +s.z.toFixed(1) : null]) } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features: f }, null, 1)], { type: 'application/geo+json' }));
  a.download = 'marswalk-plan.geojson'; a.click(); URL.revokeObjectURL(a.href);
}

async function init() {
  tick(); setInterval(tick, 15000);
  buildLayerUI();
  const [terrain, m20, weather] = await Promise.all([
    Terrain.load('data/jezero_dem'), fetch('data/m20.json').then((r) => r.json()), fetch('data/weather.json').then((r) => r.json()),
  ]);
  Object.assign(state, { terrain, m20, weather });
  targetPositions();
  const h = m20.heli[m20.heli.length - 1];
  TARGETS.push({ id: 'ingenuity', name: 'Ingenuity final airfield (Valinor Hills)', lon: h.lon, lat: h.lat, elev: h.elev, src: `Helicopter position after flight ${h.flight}, sol ${h.sol}`, sci: 'The first aircraft to fly on another planet rests here after 72 flights. Inspecting rotor damage and dust loading is a unique engineering science objective.' });
  const restored = restore();
  buildParams();
  if (!restored) { const t = TARGETS[0]; state.base = { lon: t.lon, lat: t.lat, name: t.name }; }
  state.viewshed = terrain.viewshed(state.base.lon, state.base.lat, state.params.mastM);
  const d = state.mt.sun.el > 5;
  state.sunLTST = d ? Math.round(state.mt.ltst * 4) / 4 : state.params.startLTST;
  updateSunUI(false);
  for (const def of LAYER_DEFS) if (def.on) setLayer(def.id, true);
  wire(); renderWx();
  if (restored) { replan(); fitPlan(); } else loadPreset('floor');
  refreshLive();
  window.__marswalk = { state, map, layers, setLayer };
}
init().catch((err) => { console.error(err); $('#hint').textContent = `Failed to start: ${err.message}`; });
