import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { M_PER_DEG, SLOPE_CLASSES, slopeClass, Terrain } from '@/lib/terrain'
import { sunAt } from '@/lib/marstime'
import { LAYERS, LANDMARKS } from '@/lib/catalog'
import { fx } from '@/lib/fmt'
import { reachCanvas } from '@/lib/reach'
import { sampleAt, speedMs, vmaxMs } from '@/lib/eva'

const outsideDem = () => toast.warning('Вне модели рельефа', { description: 'Маршрут можно проложить только внутри модели рельефа CTX кратера Езеро.' })
import { SITE } from '@/store'

// Tiles go through the local Rust cache (tiles/) when it runs, else straight to NASA.
const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ'
const TILE_PROXY = import.meta.env.VITE_TILE_PROXY ?? 'http://127.0.0.1:8787'
let tileBase = TREK
const tileBaseReady = fetch(`${TILE_PROXY}/health`, { signal: AbortSignal.timeout(500) })
  .then((r) => { if (r.ok) tileBase = `${TILE_PROXY}/trek` })
  .catch(() => {})
// updateWhenZooming false: during a wheel zoom the current tiles are scaled instead of fetching every in-between level,
// which is what left empty (black) squares on screen. keepBuffer keeps two rows of tiles around the view loaded while panning;
// more than that means hundreds of extra images to decode per layer on a large screen.
const trek = (id, ext, maxNative, o = {}) => L.tileLayer(`{base}/${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`, { base: () => tileBase, maxNativeZoom: maxNative, maxZoom: 19, noWrap: true, updateWhenZooming: false, keepBuffer: 2, ...o })
const box = (w, s, e, n) => L.latLngBounds([s, w], [n, e])
// Cards opened on the map scroll clear of the top bar.
L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(24, 96), autoPanPaddingBottomRight: L.point(24, 24) })

// Up to six raw images from one sol, science cameras first. Cached per sol.
const CAMS = ['MCZ_LEFT', 'MCZ_RIGHT', 'NAVCAM_LEFT', 'NAVCAM_RIGHT', 'SUPERCAM_RMI', 'SHERLOC_WATSON', 'FRONT_HAZCAM_LEFT_A', 'FRONT_HAZCAM_RIGHT_A']
const photoCache = new Map()
function roverPhotos(sol) {
  if (!photoCache.has(sol)) {
    photoCache.set(sol, fetch(`https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=${sol}`).then((r) => r.json()).then((j) => {
      const ims = (j.images || []).filter((im) => CAMS.includes(im.camera?.instrument) && im.image_files?.small)
      ims.sort((a, b) => CAMS.indexOf(a.camera.instrument) - CAMS.indexOf(b.camera.instrument))
      // Spread the pick across cameras instead of six frames of one panorama.
      const pick = [], seen = new Map()
      for (const im of ims) { const k = im.camera.instrument, n = seen.get(k) || 0; if (n < 2 && pick.length < 6) { pick.push(im); seen.set(k, n + 1) } }
      return pick.map((im) => ({ small: im.image_files.small, full: im.image_files.large || im.image_files.medium, title: im.title }))
    }).catch((err) => { photoCache.delete(sol); throw err }))
  }
  return photoCache.get(sol)
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const icon = (cls, size, text = '') => L.divIcon({ className: '', html: `<div class="mk ${cls}" style="width:${size}px;height:${size}px">${text}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })

const RASTER = {
  mola: () => trek('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg', 7, { pane: 'raster', noWrap: false }),
  themisDay: () => trek('THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', 'png', 9, { pane: 'raster', noWrap: false }),
  themisNight: () => trek('THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', 'png', 9, { pane: 'raster', noWrap: false }),
}

export function MapView() {
  const el = useRef(null)

  useEffect(() => {
    const store = useStore
    // The planet wraps east-west without end (global layers repeat, worldCopyJump brings markers along).
    // North-south is clamped at the poles, and minZoom is set from the map height so no empty space shows above or below.
    const map = L.map(el.current, { crs: L.CRS.EPSG4326, center: [SITE.lat, SITE.lon], zoom: 12, minZoom: 2, maxZoom: 18, zoomSnap: 0.5, zoomControl: false, maxBounds: [[-90, -1e6], [90, 1e6]], maxBoundsViscosity: 1, worldCopyJump: true })
    const fitMinZoom = () => {
      const z = Math.log2(map.getSize().y / 256)
      map.setMinZoom(Math.max(0, Math.ceil(z * 20) / 20))
    }
    fitMinZoom()
    if (import.meta.env.DEV) window.__map = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.attributionControl.setPrefix(false).addAttribution('NASA Solar System Treks (JPL), USGS Astrogeology, NASA/JPL-Caltech')
    map.createPane('raster').style.zIndex = 300
    map.createPane('analysis').style.zIndex = 350
    for (const p of ['raster', 'analysis']) map.getPane(p).style.pointerEvents = 'none'
    const CTX_6M = box(77.1605, 18.2111, 77.6991, 18.7211)
    // The three layers that lie under the CTX 6 m mosaic.
    const under = [
      // Coarse planet underlay: about 30 tiles in total that stay loaded, so a gap in the detailed layers never shows the background.
      trek('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 3, { noWrap: false, keepBuffer: 16 }),
      trek('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 7, { noWrap: false }),
      trek('Jezero_CTX_BlockAdj_dd', 'png', 10, { bounds: box(75.154, 15.906, 78.872, 19.445) }),
    ]
    const base = L.layerGroup([
      ...under,
      trek('JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', 'png', 13, { bounds: CTX_6M }),
      trek('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png', 17, { bounds: box(77.223, 18.3068, 77.5839, 18.6693), minZoom: 12 }),
    ])
    // The CTX 6 m mosaic has no holes inside its box (checked tile by tile), so while the whole view is inside it
    // the layers underneath cannot be seen. At walking zooms they are stretched hundreds of times, which is costly
    // to composite, so they are hidden. Their tiles stay loaded: they come back at once, without a flash.
    const OPAQUE = CTX_6M.pad(-0.03)
    let culled = false
    const cull = (bounds) => {
      const hide = OPAQUE.contains(bounds)
      if (hide === culled) return
      culled = hide
      for (const l of under) { const c = l.getContainer(); if (c) c.style.display = hide ? 'none' : '' }
    }
    map.on('move', () => cull(map.getBounds()))
    // A zoom-out animation shows ground outside the current view before 'move' fires: decide by where it will end.
    map.on('zoomanim', (e) => {
      const b = map.getBounds(), k = 1 / map.getZoomScale(e.zoom), hw = ((b.getEast() - b.getWest()) / 2) * k, hh = ((b.getNorth() - b.getSouth()) / 2) * k
      if (!OPAQUE.contains(box(e.center.lng - hw, e.center.lat - hh, e.center.lng + hw, e.center.lat + hh))) cull(L.latLngBounds([[-90, -180], [90, 180]]))
    })
    let disposed = false
    tileBaseReady.then(() => { if (!disposed) { base.addTo(map); culled = false; cull(map.getBounds()) } })

    // Mars-aware scale bar: Leaflet's own assumes Earth's radius.
    const Scale = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd() {
        this.el = L.DomUtil.create('div')
        this.el.style.cssText = 'background:color-mix(in oklch,var(--background) 85%,transparent);border:1.5px solid var(--foreground);border-top:0;padding:1px 6px;font-size:12px;font-weight:500;color:var(--foreground);text-align:center;margin-left:12px;margin-bottom:12px'
        map.on('zoomend', this.update, this); this.update(); return this.el
      },
      update() {
        const mpp = (180 / (256 * 2 ** map.getZoom())) * M_PER_DEG
        const nice = [5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6]
        const m = nice.find((n) => n / mpp >= 70) || nice.at(-1)
        this.el.style.width = `${Math.round(m / mpp)}px`
        this.el.textContent = m >= 1000 ? `${(m / 1000).toLocaleString('ru-RU')} км` : `${m} м`
      },
    })
    map.addControl(new Scale())

    const groups = {
      track: L.layerGroup(), heli: L.layerGroup(), targets: L.layerGroup(), ring: L.layerGroup(),
    }
    const raster = {}
    const overlays = {}
    const ghostLayer = L.layerGroup().addTo(map)
    const planLayer = L.layerGroup().addTo(map)
    const abortLayer = L.layerGroup().addTo(map)
    const playLayer = L.layerGroup().addTo(map)
    const routeLayer = L.layerGroup().addTo(map)
    // Planet-scale labels, shown only when the map is zoomed far out.
    // Each label is placed on three copies of the planet so it shows up after wrapping east or west.
    const landmarks = L.layerGroup(LANDMARKS.flatMap((p) => [-360, 0, 360].map((dx) => {
      const mk = L.marker([p.lat, p.lon + dx], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="mk-label${p.main ? ' main' : ''}"><i></i><b>${p.name}</b>${p.sub ? `<small>${p.sub}</small>` : ''}</div>` }), interactive: !!p.main, keyboard: false, zIndexOffset: p.main ? 1000 : 0 })
      if (p.main) mk.on('click', () => store.getState().fitPlan())
      return mk
    })))
    const syncLandmarks = () => { const far = map.getZoom() <= 7; el.current?.classList.toggle('zoomed-out', far); if (far && !map.hasLayer(landmarks)) landmarks.addTo(map); if (!far && map.hasLayer(landmarks)) map.removeLayer(landmarks) }
    map.on('zoomend', syncLandmarks); syncLandmarks()
    const hoverMk = L.marker([0, 0], { icon: icon('mk-hover', 16), interactive: false, zIndexOffset: 2000 })

    // The canvas itself goes on the map (svgOverlay accepts any element): encoding it to a PNG data URL
    // and decoding that again cost more than drawing it.
    const overlayFrom = (canvas, bounds = store.getState().terrain.bounds) => L.svgOverlay(canvas, bounds, { pane: 'analysis', interactive: false })
    // Shadows take about 0.3 s per sun position, so a worker computes them and paints into one canvas.
    // Only the newest request is kept while the worker is busy, so dragging the time slider never queues up work.
    let shadeWorker, shadeCanvas, shadeBusy = false, shadeNext = null
    const paintShade = (s) => {
      const sun = sunAt(s.sunLTST, s.mt.decl, SITE.lat)
      if (!shadeWorker) {
        shadeWorker = new Worker(new URL('../lib/shade.worker.js', import.meta.url), { type: 'module' })
        shadeWorker.onmessage = ({ data }) => {
          shadeCanvas.getContext('2d').putImageData(new ImageData(data.px, shadeCanvas.width, shadeCanvas.height), 0, 0)
          shadeBusy = false
          if (shadeNext) { const next = shadeNext; shadeNext = null; shadeBusy = true; shadeWorker.postMessage({ sun: next }) }
        }
        shadeBusy = true
        return shadeWorker.postMessage({ grid: s.terrain.shadeGrid(), sun })
      }
      if (shadeBusy) shadeNext = sun
      else { shadeBusy = true; shadeWorker.postMessage({ sun }) }
    }
    const makeOverlay = (id, s) => {
      if (id === 'slope') return overlayFrom(s.terrain.slopeCanvas())
      if (id === 'los') return overlayFrom(s.terrain.viewshedCanvas(s.viewshed))
      if (id === 'reach') return overlayFrom(reachCanvas(s.reach, s.params, s.mt.sunset), s.reach.bounds)
    }

    // ----- vectors -----
    const drawTrack = (s) => {
      const g = groups.track; g.clearLayers()
      const lines = s.m20.traverse.map((t) => t.c.map((c) => [c[1], c[0]]))
      L.polyline(lines, { color: '#000', weight: 6, opacity: 0.55, interactive: false }).addTo(g)
      L.polyline(lines, { color: '#7dd3fc', weight: 2.5, interactive: false }).addTo(g)
      const last = s.m20.waypoints.at(-1)
      L.marker([last.lat, last.lon], { icon: icon('mk-rover', 16), zIndexOffset: 400 }).addTo(g)
        .bindTooltip('Perseverance, последняя позиция', { direction: 'top', offset: [0, -10] })
        .bindPopup(`<h4>Perseverance</h4><p>Последняя известная позиция на сол ${last.sol}. Пройдено ${last.km != null ? fx(last.km, 2) : '?'} км, наклон ${fx(last.tilt, 1)}°, высота ${Math.round(last.elev)} м.</p><div class="meta">${s.live.rover ? 'Онлайн-данные NASA о положении ровера' : 'Сохранённая копия данных NASA'}</div>`)
    }
    const drawHeli = (s) => {
      const g = groups.heli; g.clearLayers()
      const h = s.m20.heli
      L.polyline(h.map((f) => [f.lat, f.lon]), { color: '#86efac', weight: 1.8, dashArray: '5 5', interactive: false }).addTo(g)
      h.forEach((f, i) => {
        const fin = i === h.length - 1
        L.marker([f.lat, f.lon], { icon: icon('mk-heli', fin ? 14 : 9) }).addTo(g)
          .bindPopup(`<h4>Ingenuity: ${fin ? 'последняя площадка' : `площадка ${f.flight}`}</h4><p>Сел здесь после полёта ${f.flight} на сол ${f.sol}.${f.dist_m ? ` Пролетел ${Math.round(f.dist_m)} м` : ''}${f.alt_m ? `, наибольшая высота ${f.alt_m} м` : ''}${f.dist_m || f.alt_m ? '.' : ''}${fin ? ' Вертолёт остался здесь с повреждённой лопастью.' : ''}</p>`)
      })
    }
    const drawTargets = (s) => {
      const g = groups.targets; g.clearLayers()
      for (const t of s.targets) {
        L.marker([t.lat, t.lon], { icon: icon('mk-sci', 13), title: t.name, zIndexOffset: 300 }).addTo(g)
          .bindTooltip(t.name, { direction: 'top', offset: [0, -9] })
          .bindPopup(`<h4>${esc(t.name)}</h4><p>${esc(t.sci)}</p><div class="meta">${fx(t.lat, 5)}° с. ш., ${fx(t.lon, 5)}° в. д.${t.elev != null ? `, высота ${Math.round(t.elev)} м` : ''}<br>${esc(t.src || `Позиция ровера на сол ${t.atSol}`)}</div>${t.atSol != null ? `<div class="photos" data-sol="${t.atSol}"></div>` : ''}<div class="actions"><button class="primary" data-act="add" data-id="${t.id}">Добавить в маршрут</button><button data-act="base" data-id="${t.id}">Поставить базу здесь</button></div>`)
      }
    }
    const drawRing = (s) => {
      const g = groups.ring; g.clearLayers()
      if (!s.base) return
      const r = s.params.walkbackKm * 1000, pts = []
      for (let a = 0; a <= 360; a += 3) pts.push([s.base.lat + (r * Math.cos((a * Math.PI) / 180)) / M_PER_DEG, s.base.lon + (r * Math.sin((a * Math.PI) / 180)) / (M_PER_DEG * Math.cos((s.base.lat * Math.PI) / 180))])
      L.polyline(pts, { color: '#000', weight: 4, opacity: 0.45, interactive: false }).addTo(g)
      L.polyline(pts, { color: '#7dd3fc', weight: 2, dashArray: '8 7', interactive: false }).addTo(g)
    }
    const drawPlan = (s) => {
      planLayer.clearLayers(); routeLayer.clearLayers()
      if (!s.base) return
      const bm = L.marker([s.base.lat, s.base.lon], { icon: icon('mk-base', 26, 'H'), draggable: true, zIndexOffset: 900 }).addTo(planLayer)
        .bindTooltip(`База: ${s.base.name}`, { direction: 'top', offset: [0, -14] })
      bm.on('dragend', () => { const ll = bm.getLatLng(), st = store.getState(); if (!st.terrain.inside(ll.lng, ll.lat)) { bm.setLatLng([st.base.lat, st.base.lon]); return outsideDem() } st.setBase({ lon: ll.lng, lat: ll.lat }) })
      s.stops.forEach((st, i) => {
        const m = L.marker([st.lat, st.lon], { icon: icon('mk-stop', 26, i + 1), draggable: true, zIndexOffset: 800 }).addTo(planLayer)
          .bindTooltip(st.name, { direction: 'top', offset: [0, -14] })
        m.on('dragend', () => { const ll = m.getLatLng(), s2 = store.getState(); if (!s2.terrain.inside(ll.lng, ll.lat)) { m.setLatLng([st.lat, st.lon]); return outsideDem() } s2.updateStop(i, { lon: ll.lng, lat: ll.lat }) })
      })
      const R = s.result
      if (!R) return
      L.polyline(R.samples.map((p) => [p.lat, p.lon]), { color: '#000', weight: 10, opacity: 0.75, interactive: false }).addTo(routeLayer)
      let run = [], cls = -1
      const flush = () => { if (run.length > 1) L.polyline(run, { color: `rgb(${SLOPE_CLASSES[Math.max(0, cls)].color})`, weight: 5, interactive: false }).addTo(routeLayer) }
      for (const p of R.samples) {
        const k = slopeClass(p.slope)
        if (k !== cls) { flush(); run = run.length ? [run.at(-1)] : []; cls = k }
        run.push([p.lat, p.lon])
      }
      flush()
    }

    // The moment of the walk from which a straight return to base costs the most.
    const drawAbort = (s) => {
      abortLayer.clearLayers()
      const a = s.result?.abort
      if (!a || a.check.status === 'go') return
      L.marker([a.s.lat, a.s.lon], { icon: icon(`mk-abort ${a.check.status}`, 22, '!'), zIndexOffset: 700 }).addTo(abortLayer)
        .bindTooltip(`<b>${a.check.label}</b><br>${esc(a.check.detail)}`, { direction: 'top', offset: [0, -12], className: 'tt-wide' })
    }

    // A saved variant drawn faintly while its row is hovered in the plan panel.
    const drawGhost = (s) => {
      ghostLayer.clearLayers()
      const v = s.ghost && s.variants.find((x) => x.id === s.ghost)
      if (!v) return
      L.polyline(v.line, { color: '#000', weight: 7, opacity: 0.5, interactive: false }).addTo(ghostLayer)
      L.polyline(v.line, { color: '#fff', weight: 3, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(ghostLayer)
    }

    // Replay: the walker at the current moment, and the way home if they had to turn back right now.
    const walker = L.marker([0, 0], { icon: icon('mk-walker', 18), zIndexOffset: 1500, interactive: false })
    const homeLine = [L.polyline([], { color: '#000', weight: 6, opacity: 0.5, interactive: false }), L.polyline([], { color: '#fb7185', weight: 3, dashArray: '6 6', interactive: false })]
    let homeTimer = 0, homeAt = null
    const drawPlay = (s) => {
      const R = s.result, t = s.play.t
      if (!R || t == null) { playLayer.clearLayers(); homeAt = null; return }
      const p = sampleAt(R, t)
      walker.setLatLng([p.lat, p.lon]); if (!playLayer.hasLayer(walker)) walker.addTo(playLayer)
      // The return route is an A* search: at most a few per second while the replay runs.
      if (homeTimer) return
      homeTimer = setTimeout(() => {
        homeTimer = 0
        const st = store.getState(), R2 = st.result, t2 = st.play.t
        if (!R2 || t2 == null || !st.base) return
        const q = sampleAt(R2, t2), key = [q.lon.toFixed(5), q.lat.toFixed(5), st.base.lon, st.base.lat, st.params.maxSlopeDeg].join()
        if (key === homeAt) return
        homeAt = key
        const line = st.terrain.route([q.lon, q.lat], [st.base.lon, st.base.lat], { speed: (g) => speedMs(g, st.params), vmax: vmaxMs(st.params), maxSlope: st.params.maxSlopeDeg, limit: 300000 })
        for (const l of homeLine) { l.setLatLngs((line || [[q.lon, q.lat], [st.base.lon, st.base.lat]]).map(([lon, lat]) => [lat, lon])); if (!playLayer.hasLayer(l)) l.addTo(playLayer) }
      }, st0().play.playing ? 350 : 0)
    }
    const st0 = () => store.getState()

    // ----- sync store -> map -----
    const syncLayers = (s) => {
      for (const def of LAYERS) {
        const L1 = s.layers[def.id]
        if (def.vector) {
          const g = groups[def.id]
          if (L1.on && !map.hasLayer(g)) g.addTo(map)
          if (!L1.on && map.hasLayer(g)) map.removeLayer(g)
          continue
        }
        if (RASTER[def.id]) {
          if (L1.on && !raster[def.id]) raster[def.id] = RASTER[def.id]()
          const r = raster[def.id]
          if (r) { if (L1.on && !map.hasLayer(r)) r.addTo(map); if (!L1.on && map.hasLayer(r)) map.removeLayer(r); r.setOpacity(L1.opacity) }
          continue
        }
        // analysis overlays: rebuild only when their inputs changed while they are shown
        // The reach map depends on the fields and on the budget they are read against.
        if (def.id === 'reach' && !s.reach) continue
        const p = s.params
        const key = def.id === 'shade' ? s.sunLTST : def.id === 'los' ? s.viewshed
          : def.id === 'reach' ? [s.reach.key, p.evaLimitH, p.o2TankKg, p.o2ReserveMin, p.startLTST, p.stationW, p.reachWorkMin, p.sunsetMarginMin, Math.round(s.mt.sunset * 60)].join('|') : 1
        const o = overlays[def.id]
        if (def.id === 'shade') {
          // One overlay for good; a new sun position only repaints its canvas.
          if (L1.on) {
            if (!o) {
              shadeCanvas = Object.assign(document.createElement('canvas'), { width: s.terrain.W, height: s.terrain.H })
              overlays.shade = { layer: overlayFrom(shadeCanvas) }
            }
            if (overlays.shade.key !== key) { overlays.shade.key = key; paintShade(s) }
            const lay = overlays.shade.layer
            if (!map.hasLayer(lay)) lay.addTo(map)
            lay.setOpacity(L1.opacity)
          } else if (o && map.hasLayer(o.layer)) map.removeLayer(o.layer)
          continue
        }
        if (L1.on) {
          if (!o || o.key !== key) {
            if (o) map.removeLayer(o.layer)
            overlays[def.id] = { key, layer: makeOverlay(def.id, s) }
          }
          const lay = overlays[def.id].layer
          if (!map.hasLayer(lay)) lay.addTo(map)
          lay.setOpacity(L1.opacity)
        } else if (o && map.hasLayer(o.layer)) map.removeLayer(o.layer)
      }
    }

    const sync = (s, prev) => {
      if (!s.ready) return
      const first = !prev || !prev.ready
      if (first || s.m20 !== prev.m20 || s.live.rover !== prev.live.rover) { drawTrack(s); drawHeli(s) }
      if (first || s.targets !== prev.targets) drawTargets(s)
      if (first || s.base !== prev.base || s.params.walkbackKm !== prev.params.walkbackKm) drawRing(s)
      if (first || s.result !== prev.result || s.base !== prev.base || s.stops !== prev.stops) drawPlan(s)
      if (first || s.layers !== prev.layers || s.viewshed !== prev.viewshed || s.sunLTST !== prev.sunLTST || s.reach !== prev.reach || s.params !== prev.params) syncLayers(s)
      if (first || s.result !== prev.result) drawAbort(s)
      if (first || s.ghost !== prev.ghost || s.variants !== prev.variants) drawGhost(s)
      if (first || s.play !== prev.play || s.result !== prev.result) drawPlay(s)
      if (!first && s.hover !== prev.hover) {
        if (s.hover) hoverMk.setLatLng([s.hover.lat, s.hover.lon]).addTo(map)
        else map.removeLayer(hoverMk)
      }
      if (s.focus && s.focus !== prev?.focus) {
        const f = s.focus
        // Keep the route inside the part of the map that is not covered by floating panels.
        const cs = getComputedStyle(el.current), pad = (k) => parseFloat(cs.getPropertyValue(k)) || 0
        if (f.points) map.flyToBounds(L.latLngBounds(f.points).pad(0.08), { maxZoom: 15, duration: 0.8, paddingTopLeft: [pad('--pad-l') + 40, 100], paddingBottomRight: [pad('--pad-r') + 40, pad('--pad-b') + 40] })
        else map.flyTo([f.lat, f.lon], Math.max(map.getMinZoom(), f.zoom ?? 15), { duration: 0.8 })
      }
      if (!first && s.pickBase !== prev.pickBase) el.current?.classList.toggle('picking', s.pickBase)
    }
    const unsub = store.subscribe(sync)
    sync(store.getState(), null)

    // ----- map -> store -----
    map.on('click', (e) => {
      const s = store.getState()
      if (!s.ready) return
      const w = map.wrapLatLng(e.latlng), pt = { lon: w.lng, lat: w.lat }
      if (!s.terrain.inside(pt.lon, pt.lat)) return void outsideDem()
      if (s.pickBase) s.setBase(pt)
      else s.addStop(pt)
    })
    // The cursor readout updates at most once per frame, and not at all while the map is being dragged or zoomed:
    // every update goes through the store and re-renders the readout.
    let moveRaf = 0, moveAt = null
    map.on('mousemove', (e) => {
      moveAt = e.latlng
      if (moveRaf || map.dragging.moving() || map._animatingZoom) return
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0
        const s = store.getState()
        if (!s.terrain || !moveAt) return
        const { lng, lat } = map.wrapLatLng(moveAt)
        s.setCursor({ lon: lng, lat, z: s.terrain.elevAt(lng, lat), slope: s.terrain.slopeAt(lng, lat), dist: s.base ? Terrain.dist([lng, lat], [s.base.lon, s.base.lat]) : null })
      })
    })
    map.on('mouseout', () => { moveAt = null; store.getState().setCursor(null) })
    const onPopupClick = (e) => {
      const b = e.target.closest('[data-act]')
      if (!b) return
      const s = store.getState(), t = s.targets.find((x) => x.id === b.dataset.id)
      map.closePopup()
      if (b.dataset.act === 'add') s.addStop(t, t.name, 30); else s.setBase(t, t.name)
    }
    el.current.addEventListener('click', onPopupClick)
    // Raw images Perseverance took on the sol it stood at a target, loaded when its card opens.
    // Popup.update() would put the original HTML back and drop the images: only re-measure and re-place the card.
    const refit = (pp) => { if (pp.isOpen()) { pp._updateLayout(); pp._updatePosition(); pp._adjustPan() } }
    map.on('popupopen', (e) => {
      const box = e.popup.getElement()?.querySelector('.photos[data-sol]')
      if (!box || box.dataset.done) return
      box.dataset.done = '1'
      box.innerHTML = '<div class="ph-note">Загружаю снимки ровера...</div>'
      roverPhotos(+box.dataset.sol).then((list) => {
        box.innerHTML = list.length
          ? `<div class="ph-note">Снимки Perseverance за сол ${box.dataset.sol}</div><div class="ph-grid">${list.map((im) => `<a href="${im.full}" target="_blank" rel="noopener" title="${esc(im.title)}"><img src="${im.small}" alt="${esc(im.title)}" loading="lazy"></a>`).join('')}</div>`
          : `<div class="ph-note">Снимков за сол ${box.dataset.sol} в архиве NASA нет</div>`
        refit(e.popup)
        box.querySelectorAll('img').forEach((im) => im.addEventListener('load', () => refit(e.popup), { once: true }))
      }).catch(() => { box.innerHTML = '<div class="ph-note">Не удалось загрузить снимки ровера</div>'; refit(e.popup) })
    })
    const ro = new ResizeObserver(() => { map.invalidateSize(); fitMinZoom() })
    ro.observe(el.current)
    const node = el.current
    return () => { disposed = true; unsub(); ro.disconnect(); cancelAnimationFrame(moveRaf); clearTimeout(homeTimer); shadeWorker?.terminate(); node.removeEventListener('click', onPopupClick); map.remove() }
  }, [])

  return <div ref={el} className="absolute inset-0" />
}
