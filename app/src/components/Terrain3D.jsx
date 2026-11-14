import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { X, Loader2, Crosshair, Play } from 'lucide-react'
import { useStore } from '@/store'
import { sunAt, fmtH } from '@/lib/marstime'
import { sampleAt } from '@/lib/eva'
import { SLOPE_CLASSES, slopeClass, Terrain } from '@/lib/terrain'
import { Button } from '@/components/ui/button'
import { PlayControls } from '@/components/Playback'

// In production tiles come through the Vercel CDN cache (api/trek); the dev server has no functions, so it goes to NASA.
const TREK = import.meta.env.DEV ? 'https://trek.nasa.gov/tiles/Mars/EQ' : '/api/trek'
const TILE_PROXY = import.meta.env.VITE_TILE_PROXY ?? 'http://127.0.0.1:8787'
const CTX = ['JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', 13]
const HIRISE = ['JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 17]
const WALKER_LAYER = 1
const SKINS =[['photo', 'Снимок'], ['slope', 'Уклоны'], ['relief', 'Рельеф']]

// A tile that has not arrived in `ms` is skipped, so one stuck request cannot hold the whole photo.
const loadImg = (src, ms = 12000) => new Promise((res) => {
  const im = new Image(), t = setTimeout(() => { im.src = ''; res(null) }, ms)
  im.crossOrigin = 'anonymous'
  im.onload = () => { clearTimeout(t); res(im) }
  im.onerror = () => { clearTimeout(t); res(null) }
  im.src = src
})

// Orbital image of the area stitched from map tiles: CTX 6 m everywhere, HiRISE 25 cm on top where it exists.
// Tiles must come with CORS headers for WebGL, which the local tile cache sends; without it the photo skin is not offered.
// The texture is handed to onFirst as soon as the first tile lands and then refreshes as the rest arrive.
async function photoTexture(box, onFirst, maxPx = 2048) {
  const ok = await fetch(`${TILE_PROXY}/health`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok).catch(() => false)
  const base = ok ? `${TILE_PROXY}/trek` : TREK
  const [w, s, e, n] = box
  const z = Math.min(16, Math.floor(Math.log2((maxPx * 180) / (256 * (e - w)))))
  const W = Math.round(((e - w) * 256 * 2 ** z) / 180), H = Math.round(((n - s) * 256 * 2 ** z) / 180)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const g = cv.getContext('2d')
  g.fillStyle = '#6b5446'; g.fillRect(0, 0, W, H)
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
  let drawn = 0, queued = false
  const refresh = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; tex.needsUpdate = true }) } }
  for (const [id, maxNative] of [CTX, HIRISE]) {
    const zt = Math.min(z, maxNative), deg = 180 / 2 ** zt
    const x0 = Math.floor((w + 180) / deg), x1 = Math.floor((e + 180) / deg), y0 = Math.floor((90 - n) / deg), y1 = Math.floor((90 - s) / deg)
    const jobs = []
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      jobs.push(loadImg(`${base}/${id}/1.0.0/default/default028mm/${zt}/${y}/${x}.png`).then((im) => {
        if (!im) return
        const lon = x * deg - 180, lat = 90 - y * deg
        g.drawImage(im, ((lon - w) / (e - w)) * W, ((n - lat) / (n - s)) * H, (deg / (e - w)) * W, (deg / (n - s)) * H)
        if (drawn++ === 0) onFirst(tex)
        refresh()
      }))
    }
    await Promise.all(jobs)
  }
  try { g.getImageData(0, 0, 1, 1) } catch { tex.dispose(); return null } // tainted: tiles came without CORS
  if (!drawn) tex.dispose()
  return drawn ? tex : null
}

function gridTexture(T, box, kind) {
  const [w, s, e, n] = box
  const W = 1024, H = Math.round((W * (n - s)) / ((e - w) * Math.cos((T.lat0 * Math.PI) / 180)))
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const g = cv.getContext('2d'), img = g.createImageData(W, H), px = img.data
  const sun = { e: -0.57, n: 0.57, u: 0.59 }
  for (let y = 0; y < H; y++) {
    const r = Math.round(T.row(n - ((y + 0.5) / H) * (n - s)))
    for (let x = 0; x < W; x++) {
      const c = Math.round(T.col(w + ((x + 0.5) / W) * (e - w))), o = (y * W + x) * 4
      px[o + 3] = 255
      if (c < 0 || r < 0 || c >= T.W || r >= T.H) continue
      const i = r * T.W + c, gx = T.gx[i], gy = T.gy[i]
      const ill = Math.max(0, (-gx * sun.e - gy * sun.n + sun.u) / Math.sqrt(gx * gx + gy * gy + 1))
      if (kind === 'slope') {
        const col = SLOPE_CLASSES[Math.max(0, slopeClass(T.slope[i]))].color, k = 0.55 + 0.45 * ill
        px[o] = col[0] * k; px[o + 1] = col[1] * k; px[o + 2] = col[2] * k
      } else {
        const v = 60 + 180 * ill
        px[o] = v; px[o + 1] = v * 0.86; px[o + 2] = v * 0.74
      }
    }
  }
  g.putImageData(img, 0, 0)
  return cv
}

function label(text, color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128
  const g = cv.getContext('2d')
  g.fillStyle = color; g.strokeStyle = '#fff'; g.lineWidth = 10
  g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill(); g.stroke()
  g.fillStyle = '#111'; g.font = '700 64px Geist Variable, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68)
  // No depth write, so the astronaut (drawn in a later pass) is not hidden behind the badges.
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, depthWrite: false }))
  sp.renderOrder = 10
  return sp
}

// A caption that keeps the same size on screen at any distance.
function caption(text) {
  const cv = document.createElement('canvas'), g = cv.getContext('2d'), font = '600 34px Geist Variable, sans-serif'
  g.font = font
  cv.width = Math.ceil(g.measureText(text).width) + 44; cv.height = 60
  g.fillStyle = 'rgba(15,12,10,.82)'; g.beginPath(); g.roundRect(0, 0, cv.width, cv.height, 16); g.fill()
  g.font = font; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cv.width / 2, 32)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, depthWrite: false, sizeAttenuation: false }))
  sp.scale.set(0.03 * (cv.width / cv.height), 0.03, 1); sp.center.set(0.5, 0); sp.renderOrder = 11
  return sp
}

// Soft dark spot under an object, instead of real shadows over kilometres of terrain.
function blobShadow(radius) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128
  const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 8, 64, 64, 64)
  gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }))
  m.rotation.x = -Math.PI / 2; m.position.y = 0.04
  return m
}

// The astronaut on the walk, 1.9 m tall, facing +Z.
function astronaut() {
  const g = new THREE.Group()
  const suit = new THREE.MeshStandardMaterial({ color: '#f1efe9', roughness: 0.75 }), dark = new THREE.MeshStandardMaterial({ color: '#3a3d44', roughness: 0.6 })
  const visor = new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.15, metalness: 0.9 }), trim = new THREE.MeshStandardMaterial({ color: '#ff7a3d', roughness: 0.6 })
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m }
  add(new THREE.CapsuleGeometry(0.27, 0.42, 6, 14), suit, 0, 1.15, 0)
  add(new THREE.SphereGeometry(0.23, 20, 16), suit, 0, 1.68, 0)
  add(new THREE.SphereGeometry(0.19, 20, 16), visor, 0, 1.69, 0.08)
  add(new THREE.BoxGeometry(0.44, 0.62, 0.22), dark, 0, 1.22, -0.3)
  add(new THREE.BoxGeometry(0.46, 0.08, 0.24), trim, 0, 1.5, -0.3)
  // Legs hang from the hips and arms from the shoulders, so they can swing in the walk cycle.
  const joint = (x, y) => { const j = new THREE.Group(); j.position.set(x, y, 0); g.add(j); return j }
  const part = (j, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x - j.position.x, y - j.position.y, z); j.add(m); return m }
  const legs = [], arms = []
  for (const k of [-1, 1]) {
    const hip = joint(0.14 * k, 0.84)
    part(hip, new THREE.CapsuleGeometry(0.11, 0.52, 4, 10), suit, 0.14 * k, 0.45, 0)
    part(hip, new THREE.BoxGeometry(0.2, 0.12, 0.34), dark, 0.14 * k, 0.06, 0.04)
    const sh = joint(0.34 * k, 1.42)
    part(sh, new THREE.CapsuleGeometry(0.09, 0.46, 4, 10), suit, 0.37 * k, 1.12, 0.03).rotation.z = 0.14 * k
    part(sh, new THREE.SphereGeometry(0.1, 10, 8), dark, 0.42 * k, 0.8, 0.03)
    legs.push(hip); arms.push(sh)
  }
  // Walk cycle: phase in radians, amount 0 (standing) to 1 (full stride).
  g.userData.pose = (phase, amount) => {
    const swing = Math.sin(phase) * 0.55 * amount
    legs[0].rotation.x = swing; legs[1].rotation.x = -swing
    arms[0].rotation.x = -swing * 0.8; arms[1].rotation.x = swing * 0.8
    g.position.y = Math.abs(Math.cos(phase)) * 0.07 * amount
  }
  return g
}

// The base, about 30 m across and 6 m tall, airlock door towards +Z: a domed habitat on a levelled pad,
// with a greenhouse, a lab module, a solar field, tanks and a dish.
function habitat() {
  const g = new THREE.Group()
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o })
  const white = std('#efeee9'), grey = std('#a9adb3', { roughness: 0.5, metalness: 0.4 }), dark = std('#2b2f35', { roughness: 0.5, metalness: 0.3 })
  const orange = std('#ff7a3d', { roughness: 0.55 }), pad = std('#7b7975', { roughness: 1 }), cell = std('#16264a', { roughness: 0.25, metalness: 0.7 })
  const glow = std('#ffe2a8', { emissive: '#ffb347', emissiveIntensity: 1.6 }), red = std('#ff4d4d', { emissive: '#ff2a2a', emissiveIntensity: 2 })
  const glass = std('#a8e6bd', { transparent: true, opacity: 0.42, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide }), leaf = std('#3f9b4b', { roughness: 0.9 })
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m }
  const cyl = (r1, r2, h, n = 24) => new THREE.CylinderGeometry(r1, r2, h, n), box = (a, b, c) => new THREE.BoxGeometry(a, b, c)
  const ball = (r) => new THREE.SphereGeometry(r, 24, 16), cap = (r) => new THREE.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2)
  const H = Math.PI / 2

  // levelled pad with a marked walkway to the airlock
  add(cyl(15, 15.6, 0.3, 48), pad, 0, 0.15, 0)
  add(box(2.2, 0.04, 7), std('#9a9893', { roughness: 1 }), 0, 0.32, 10.5)
  for (const k of [-1, 1]) for (let i = 0; i < 4; i++) add(ball(0.12), glow, 1.3 * k, 0.4, 8 + i * 1.8)

  // main habitat: drum, dome, window band, ribs
  add(cyl(4, 4.2, 3.2, 36), white, 0, 1.9, 0)
  add(cap(4), white, 0, 3.5, 0).scale.y = 0.62
  add(cyl(4.06, 4.06, 0.35, 36), orange, 0, 3.2, 0)
  for (const y of [0.4, 3.5]) add(new THREE.TorusGeometry(4.12, 0.1, 8, 40), grey, 0, y, 0, H)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31
    if (Math.abs(Math.sin(a)) < 0.35 && Math.cos(a) < 0) continue
    add(box(0.95, 0.6, 0.12), glow, Math.sin(a) * 4.08, 2.2, Math.cos(a) * 4.08, 0, a)
  }
  add(cyl(0.9, 1, 0.4), grey, 0, 5.98, 0)
  add(cyl(0.05, 0.05, 2.6, 6), dark, 0.5, 7.2, 0); add(ball(0.14), red, 0.5, 8.55, 0)
  add(cyl(0.04, 0.04, 1.4, 6), dark, -0.5, 6.7, 0.2)

  // airlock tunnel with a door, frame, lamp and steps
  add(cyl(1.25, 1.25, 3.2, 20), white, 0, 1.6, 5.4, H)
  add(new THREE.TorusGeometry(1.27, 0.12, 8, 28), orange, 0, 1.6, 7.0)
  add(cyl(1.0, 1.0, 0.12, 20), dark, 0, 1.6, 7.02, H)
  add(box(0.5, 0.5, 0.06), glow, 0, 1.9, 7.1)
  add(box(0.3, 0.14, 0.14), glow, 0, 3.05, 7.0)
  for (let i = 0; i < 3; i++) add(box(1.8, 0.14, 0.45), grey, 0, 0.75 - i * 0.2, 7.35 + i * 0.45)

  // greenhouse on the east side, joined by a tube
  add(cyl(0.8, 0.8, 3, 16), white, 5.3, 1.3, 0, 0, 0, H)
  add(cyl(3.3, 3.4, 0.7, 32), white, 9.2, 0.65, 0)
  add(cap(3.25), glass, 9.2, 1.0, 0)
  for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(3.27, 0.04, 6, 24, Math.PI), grey, 9.2, 1.0, 0, 0, (i / 6) * Math.PI)
  for (let i = -2; i <= 2; i++) { const w = Math.sqrt(9 - i * i) * 1.5; add(box(0.6, 0.5, w), leaf, 9.2 + i * 1.05, 1.2, 0); add(box(0.75, 0.16, w + 0.1), dark, 9.2 + i * 1.05, 0.95, 0) }

  // lab module on the west side: a cylinder on legs, joined by a tube
  add(cyl(0.8, 0.8, 2.2, 16), white, -4.9, 1.5, 0, 0, 0, H)
  add(cyl(1.7, 1.7, 6, 24), white, -7.6, 2, 0, H)
  for (const k of [-1, 1]) { add(ball(1.7), white, -7.6, 2, 3 * k).scale.z = 0.45; add(new THREE.TorusGeometry(1.72, 0.08, 8, 28), orange, -7.6, 2, 2.2 * k) }
  for (const k of [-1, 1]) for (const j of [-1, 1]) add(cyl(0.12, 0.16, 1.2, 8), grey, -7.6 + 0.9 * j, 0.6, 2 * k)
  for (const k of [-1, 0, 1]) add(box(0.1, 0.5, 0.8), glow, -9.28, 2.2, 1.5 * k)

  // solar field behind the habitat: three tracked arrays
  for (let i = -1; i <= 1; i++) {
    const x = i * 6.2, z = -9.5
    add(cyl(0.12, 0.16, 2.2, 8), grey, x, 1.4, z)
    add(box(5.4, 0.1, 2.9), cell, x, 2.6, z, -0.55)
    add(box(5.5, 0.06, 0.08), grey, x, 2.6, z, -0.55)
    for (const k of [-1, 0, 1]) add(box(0.06, 0.12, 2.9), grey, x + k * 1.8, 2.61, z, -0.55)
  }

  // tanks and a dish
  for (const k of [0, 1]) { add(ball(1.1), white, -11.2, 1.5, -4.5 - k * 2.6); add(cyl(0.8, 0.9, 0.5, 12), grey, -11.2, 0.5, -4.5 - k * 2.6); add(new THREE.TorusGeometry(1.1, 0.06, 6, 24), orange, -11.2, 1.5, -4.5 - k * 2.6, H) }
  add(cyl(0.14, 0.2, 2.6, 8), grey, 11.5, 1.6, -6)
  const dish = add(new THREE.SphereGeometry(2.4, 24, 8, 0, Math.PI * 2, 0, 0.75), std('#e6e6e2', { side: THREE.DoubleSide, roughness: 0.5 }), 11.5, 5.0, -6, 2.3, 0, 0.4)
  dish.scale.setScalar(0.8)
  add(cyl(0.03, 0.03, 1.5, 6), dark, 11.5, 3.3, -6, 2.3 - Math.PI, 0, 0.4)
  return g
}

// NASA's own models, brought to real size in metres, standing on y = 0, centred, facing +Z.
const gltf = new GLTFLoader()
const loadModel = (url, lengthM, turnY = 0) => gltf.loadAsync(url).then(({ scene: m }) => {
  const b = new THREE.Box3().setFromObject(m), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3())
  const k = lengthM / Math.max(size.x, size.z)
  m.position.set(-c.x * k, -b.min.y * k, -c.z * k); m.scale.multiplyScalar(k)
  const g = new THREE.Group(); g.add(m); g.rotation.y = turnY
  const out = new THREE.Group(); out.add(g)
  return { model: out, height: size.y * k }
})

function Scene({ exag, skin, focusReq, follow, onStatus, onInfo }) {
  const host = useRef(null)
  const api = useRef(null)
  const followRef = useRef(follow)
  followRef.current = follow

  // Build once per open: terrain mesh, route and markers. Exaggeration and skin are applied in place below.
  useEffect(() => {
    const { terrain: T, result: R, base, stops, sunLTST, mt, m20 } = useStore.getState()
    const el = host.current
    const pts = R ? R.samples.map((p) => [p.lon, p.lat]) : []
    pts.push([base.lon, base.lat])
    let w = Math.min(...pts.map((p) => p[0])), e = Math.max(...pts.map((p) => p[0])), s = Math.min(...pts.map((p) => p[1])), n = Math.max(...pts.map((p) => p[1]))
    const kx = Math.cos((T.lat0 * Math.PI) / 180), M = 3396190 * Math.PI / 180
    const padM = Math.max(800, Math.max((e - w) * kx, n - s) * M * 0.25)
    w = Math.max(T.meta.west, w - padM / (M * kx)); e = Math.min(T.meta.east, e + padM / (M * kx)); s = Math.max(T.meta.south, s - padM / M); n = Math.min(T.meta.north, n + padM / M)
    const box = [w, s, e, n]
    const spanX = (e - w) * kx * M, spanZ = (n - s) * M
    const segX = Math.min(360, Math.round(spanX / 20)), segZ = Math.max(2, Math.round((segX * spanZ) / spanX))
    const lonAt = (u) => w + u * (e - w), latAt = (v) => n - v * (n - s)
    const X = (lon) => ((lon - w) / (e - w) - 0.5) * spanX, Z = (lat) => ((n - lat) / (n - s) - 0.5) * spanZ

    const geo = new THREE.PlaneGeometry(spanX, spanZ, segX, segZ)
    geo.rotateX(-Math.PI / 2)
    const heights = new Float32Array(geo.attributes.position.count)
    let zSum = 0, zN = 0
    for (let k = 0; k < heights.length; k++) {
      const u = (k % (segX + 1)) / segX, v = Math.floor(k / (segX + 1)) / segZ
      const h = T.elevAt(lonAt(u), latAt(v))
      heights[k] = h; if (h === h) { zSum += h; zN++ }
    }
    const zMid = zSum / zN
    for (let k = 0; k < heights.length; k++) if (!(heights[k] === heights[k])) heights[k] = zMid

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    if (import.meta.env.DEV) window.__scene3d = scene
    const span = Math.max(spanX, spanZ)
    const sun = sunAt(sunLTST, mt.decl, T.lat0)
    // Daylight fades as the sun gets low; it never goes fully dark, so the route stays readable.
    const day = Math.min(1, Math.max(0.3, sun.u * 4 + 0.3))
    const horizon = [0.847 * day, 0.706 * day, 0.604 * day]
    scene.fog = new THREE.Fog(new THREE.Color().setRGB(...horizon, THREE.SRGBColorSpace), span * 1.2, span * 4)
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 1, span * 10)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = span * 0.01; controls.maxDistance = span * 3

    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0 })
    const mesh = new THREE.Mesh(geo, mat)
    scene.add(mesh)
    const sunDir = new THREE.Vector3(sun.e, Math.max(0.15, sun.u), -sun.n).normalize()
    const light = new THREE.DirectionalLight('#fff4e6', 2.2 * day)
    light.position.copy(sunDir).multiplyScalar(1000)
    const ambient = new THREE.AmbientLight('#ffe8d6', 1.1 * day)
    light.layers.enable(WALKER_LAYER); ambient.layers.enable(WALKER_LAYER)
    scene.add(light, ambient)
    // Reflections for the metal parts of the rover; the ground ignores them (envMapIntensity 0).
    const pmrem = new THREE.PMREMGenerator(renderer), envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex; scene.environmentIntensity = 0.55 * day

    // Martian sky: dusty butterscotch at the horizon, darker overhead, a small sun with a cool glow around it.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false,
      uniforms: { sunDir: { value: sunDir }, horizon: { value: new THREE.Vector3(...horizon) }, zenith: { value: new THREE.Vector3(0.55 * day, 0.4 * day, 0.31 * day) } },
      vertexShader: 'varying vec3 d; void main(){ d = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 d; uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; void main(){ vec3 n = normalize(d); float h = clamp(n.y, 0.0, 1.0); vec3 c = mix(horizon, zenith, pow(h, 0.55)); float s = max(dot(n, sunDir), 0.0); c += vec3(0.55, 0.68, 0.85) * pow(s, 24.0) * 0.35 + vec3(1.0, 0.98, 0.94) * smoothstep(0.99985, 0.99995, s); gl_FragColor = vec4(c, 1.0); }',
    }))
    sky.renderOrder = -1; sky.frustumCulled = false
    scene.add(sky)

    // Side walls, so the terrain reads as a cut-out block of ground rather than a sheet.
    const rim = []
    for (let i = 0; i <= segX; i++) rim.push(i)
    for (let j = 1; j <= segZ; j++) rim.push(j * (segX + 1) + segX)
    for (let i = segX - 1; i >= 0; i--) rim.push(segZ * (segX + 1) + i)
    for (let j = segZ - 1; j >= 0; j--) rim.push(j * (segX + 1))
    const skirtGeo = new THREE.BufferGeometry(), skirtPos = new Float32Array(rim.length * 6), skirtIdx = []
    for (let k = 0; k < rim.length - 1; k++) skirtIdx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2)
    skirtGeo.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3)); skirtGeo.setIndex(skirtIdx)
    scene.add(new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: '#6a4a3a', roughness: 1, envMapIntensity: 0, side: THREE.DoubleSide })))
    let hMin = Infinity
    for (const h of heights) if (h < hMin) hMin = h

    // Route as a tube floating a little above the ground, coloured by slope like on the map.
    const routeGroup = new THREE.Group(), marks = new THREE.Group(), trackGroup = new THREE.Group()
    scene.add(routeGroup, marks, trackGroup)
    const wipe = (g) => { g.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose() } }); g.clear() }

    let curExag = 1
    const yOf = (h) => (h - zMid) * curExag
    const groundY = (lon, lat) => { const h = T.elevAt(lon, lat); return yOf(h === h ? h : zMid) }
    const inBox = (lon, lat) => lon > w && lon < e && lat > s && lat < n

    // At true size (rover 3 m, astronaut 1.9 m) the objects would be specks on kilometres of terrain,
    // so each gets one fixed size, set as a share of the scene's width (frac = height / span). It never changes with the camera.
    const props = []
    const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3(), basis = new THREE.Matrix4()
    // Stand the object on the ground, facing its heading (degrees clockwise from north) and leaning with the slope.
    const place = (p) => {
      p.holder.position.set(X(p.lon), groundY(p.lon, p.lat), Z(p.lat))
      vy.set(0, 1, 0)
      if (p.tilt) {
        const c = Math.round(T.col(p.lon)), r = Math.round(T.row(p.lat))
        if (c >= 0 && r >= 0 && c < T.W && r < T.H) { const i = r * T.W + c; if (T.gx[i] === T.gx[i]) vy.set(-T.gx[i] * curExag, 1, T.gy[i] * curExag).normalize() }
      }
      const a = (p.yaw * Math.PI) / 180
      vz.set(Math.sin(a), 0, -Math.cos(a)); vx.crossVectors(vy, vz).normalize(); vz.crossVectors(vx, vy)
      p.holder.quaternion.setFromRotationMatrix(basis.makeBasis(vx, vy, vz))
    }
    const addProp = (o) => {
      const holder = new THREE.Group()
      holder.add(o.model, blobShadow(o.shadow ?? o.size * 0.8))
      const p = { yaw: 0, tilt: true, ...o, holder, label: o.text ? caption(o.text) : null }
      p.h = Math.max(o.size, span * o.frac); holder.scale.setScalar(p.h / o.size)
      scene.add(holder); if (p.label) scene.add(p.label)
      props.push(p); place(p)
      return p
    }

    const walker = addProp({ model: astronaut(), size: 1.9, frac: 0.03, lon: base.lon, lat: base.lat, tilt: false })
    walker.holder.visible = false
    // The astronaut lives on its own layer and is drawn after everything else (see the render loop),
    // so stop badges never cover it while the ground still does.
    walker.holder.traverse((o) => o.layers.set(WALKER_LAYER))
    let stride = 0, phase = 0, lastT = performance.now()
    const focusOn = { walker, base: addProp({ model: habitat(), size: 6, shadow: 17, frac: 0.024, lon: base.lon, lat: base.lat, tilt: false, yaw: 180 }) }

    // Perseverance stands on its latest known position inside the scene: today's, if the scene reaches it,
    // otherwise the last place here that it drove through. Ingenuity sits on its latest landing spot inside the scene.
    const wps = m20.waypoints, now = wps.at(-1)
    // Prefer a spot away from the very edge of the cut-out.
    const mx = (e - w) * 0.08, my = (n - s) * 0.08, well = (p) => p.lon > w + mx && p.lon < e - mx && p.lat > s + my && p.lat < n - my
    const latest = (list) => { const r = [...list].reverse(); return r.find(well) || r.find((p) => inBox(p.lon, p.lat)) }
    const rv = inBox(now.lon, now.lat) ? now : latest(wps), hl = latest(m20.heli)
    const info = { rover: rv ? { sol: rv.sol, current: rv === now, awayKm: Terrain.dist([rv.lon, rv.lat], [now.lon, now.lat]) / 1000 } : null }
    const tell = () => onInfo({ ...info, roverReady: !!focusOn.rover, heliReady: !!focusOn.heli })
    if (rv) loadModel('models/perseverance.glb', 3).then(({ model, height }) => {
      if (api.current?.disposed) return
      focusOn.rover = addProp({ model, size: height, shadow: 2.4, frac: 0.04, lon: rv.lon, lat: rv.lat, yaw: rv.yaw ?? 0, text: rv === now ? 'Perseverance' : `Perseverance · сол ${rv.sol}` })
      tell()
    }).catch(() => { info.rover = null; info.failed = true; tell() })
    if (hl) loadModel('models/ingenuity.glb', 1.2).then(({ model, height }) => {
      if (api.current?.disposed) return
      focusOn.heli = addProp({ model, size: height, shadow: 0.7, frac: 0.018, lon: hl.lon, lat: hl.lat, text: `Ingenuity · полёт ${hl.flight}` })
      tell()
    }).catch(() => {})
    tell()
    const build = (ex) => {
      curExag = ex
      const pos = geo.attributes.position
      for (let k = 0; k < pos.count; k++) pos.setY(k, yOf(heights[k]))
      pos.needsUpdate = true; geo.computeVertexNormals()
      const floorY = yOf(hMin) - span * 0.04
      rim.forEach((v, k) => { skirtPos.set([pos.getX(v), pos.getY(v), pos.getZ(v), pos.getX(v), floorY, pos.getZ(v)], k * 6) })
      skirtGeo.attributes.position.needsUpdate = true; skirtGeo.computeVertexNormals(); skirtGeo.computeBoundingSphere()
      wipe(routeGroup); wipe(marks); wipe(trackGroup)
      // The path Perseverance drove, as on the map.
      for (const t of m20.traverse) {
        let run = []
        const flush = () => { if (run.length > 1) trackGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(run), new THREE.LineBasicMaterial({ color: '#7dd3fc' }))); run = [] }
        for (const [lon, lat] of t.c) { if (inBox(lon, lat)) run.push(new THREE.Vector3(X(lon), groundY(lon, lat) + 2 + ex, Z(lat))); else flush() }
        flush()
      }
      props.forEach(place)
      const lift = 4 + 2 * ex, r = Math.max(4, spanX / 500)
      if (R) {
        const S = R.samples.filter((p) => p.z === p.z)
        for (let k = 1; k < S.length; k++) {
          const a = S[k - 1], b = S[k]
          const pa = new THREE.Vector3(X(a.lon), yOf(a.z) + lift, Z(a.lat)), pb = new THREE.Vector3(X(b.lon), yOf(b.z) + lift, Z(b.lat))
          const len = pa.distanceTo(pb); if (len < 0.01) continue
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(`rgb(${SLOPE_CLASSES[Math.max(0, slopeClass(b.slope))].color})`) }))
          seg.position.copy(pa).add(pb).multiplyScalar(0.5)
          seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize())
          routeGroup.add(seg)
        }
      }
      const pin = (lon, lat, text, color) => {
        const h = T.elevAt(lon, lat), y = yOf(h === h ? h : zMid)
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.35, 60, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
        stick.position.set(X(lon), y + 30, Z(lat)); marks.add(stick)
        const sp = label(text, color); sp.position.set(X(lon), y + 60 + r * 6, Z(lat)); sp.scale.setScalar(r * 14); marks.add(sp)
      }
      pin(base.lon, base.lat, 'H', '#7dd3fc')
      stops.forEach((p, i) => pin(p.lon, p.lat, String(i + 1), '#ff9a5c'))
    }
    build(1)

    const centre = new THREE.Vector3(0, 0, 0)
    camera.position.set(-spanX * 0.35, Math.max(spanX, spanZ) * 0.55, spanZ * 0.75)
    controls.target.copy(centre); controls.update()

    const home = { pos: camera.position.clone(), tgt: centre.clone() }
    // Smooth camera move: to the whole route, or close to one of the objects.
    let fly = null
    const focus = (kind) => {
      const p = focusOn[kind]
      let pos = home.pos, tgt = home.tgt
      if (p) {
        tgt = p.holder.position.clone(); tgt.y += p.h * 0.5
        const dir = camera.position.clone().sub(controls.target).setY(0).normalize().multiplyScalar(Math.cos(0.38)).setY(Math.sin(0.38))
        pos = tgt.clone().addScaledVector(dir, p.h * (kind === 'base' ? 7 : 4.5))
      }
      fly = { t0: performance.now(), p0: camera.position.clone(), g0: controls.target.clone(), p1: pos.clone(), g1: tgt.clone() }
    }
    const stopFly = () => { fly = null }
    renderer.domElement.addEventListener('pointerdown', stopFly)
    renderer.domElement.addEventListener('wheel', stopFly, { passive: true })

    let raf = 0, tracking = null
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const st = useStore.getState()
      if (st.result && st.play.t != null) {
        const p = sampleAt(st.result, st.play.t), q = sampleAt(st.result, st.play.t + 20)
        const dx = (q.lon - p.lon) * kx, dy = q.lat - p.lat
        if (dx * dx + dy * dy > 1e-12) walker.yaw = (Math.atan2(dx, dy) * 180) / Math.PI
        walker.lon = p.lon; walker.lat = p.lat; walker.holder.visible = true; place(walker)
      } else walker.holder.visible = false
      // Follow mode: fly to the astronaut once when the replay starts, then carry the camera along with it,
      // so the view can still be orbited and zoomed around the walker.
      if (followRef.current && walker.holder.visible) {
        const wp = walker.holder.position
        if (!tracking) { tracking = wp.clone(); focus('walker') }
        else {
          const d = wp.clone().sub(tracking); tracking.copy(wp)
          camera.position.add(d); controls.target.add(d)
          if (fly) { fly.p1.add(d); fly.g1.add(d) }
        }
      } else tracking = null
      // Stride eases in while the replay runs and out when it pauses; about 1.6 steps a second.
      const tNow = performance.now(), dt = Math.min(0.1, (tNow - lastT) / 1000); lastT = tNow
      stride += ((st.play.playing ? 1 : 0) - stride) * Math.min(1, dt * 6)
      phase += dt * Math.PI * 1.6 * stride
      walker.model.userData.pose(phase, stride)
      if (fly) {
        const k = Math.min(1, (performance.now() - fly.t0) / 1100), q = k * k * (3 - 2 * k)
        camera.position.lerpVectors(fly.p0, fly.p1, q); controls.target.lerpVectors(fly.g0, fly.g1, q)
        if (k === 1) fly = null
      }
      controls.update()
      for (const p of props) {
        if (p.label) { p.label.visible = p.holder.visible; p.label.position.copy(p.holder.position); p.label.position.y += p.h * 1.25 }
      }
      sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 0.5)
      camera.layers.set(0); renderer.autoClear = true; renderer.render(scene, camera)
      camera.layers.set(WALKER_LAYER); renderer.autoClear = false; renderer.render(scene, camera)
      camera.layers.set(0)
    }
    loop()
    const ro = new ResizeObserver(() => { renderer.setSize(el.clientWidth, el.clientHeight); camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix() })
    ro.observe(el)

    const textures = {}
    const aniso = renderer.capabilities.getMaxAnisotropy()
    const gone = () => api.current?.disposed
    const show = (tex) => { if (!gone()) { mat.map = tex; mat.needsUpdate = true } }
    const grid = (kind) => {
      if (!textures[kind]) {
        const tex = new THREE.CanvasTexture(gridTexture(T, box, kind))
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso
        textures[kind] = tex
      }
      return textures[kind]
    }
    let wanted = null, photo = null // photo: null | 'loading' | 'done'
    const setSkin = async (kind) => {
      wanted = kind
      if (kind !== 'photo') { show(grid(kind)); onStatus(null); return }
      if (photo === 'done') { show(textures.photo); onStatus(null); return }
      // Until the photo arrives the shaded relief stands in, so the terrain is never blank.
      show(textures.photo ?? grid('relief'))
      onStatus('Собираю снимок из тайлов...')
      if (photo === 'loading') return
      photo = 'loading'
      const tex = await photoTexture(box, (t) => {
        if (gone()) return
        t.anisotropy = aniso; textures.photo = t
        if (wanted === 'photo') show(t)
      })
      if (gone()) { tex?.dispose(); return }
      if (!tex) { photo = null; if (wanted === 'photo') { onStatus('Снимок недоступен, показан рельеф'); show(grid('relief')) } return }
      photo = 'done'
      if (wanted === 'photo') onStatus(null)
    }
    api.current = { build, setSkin, focus }

    return () => {
      api.current = { disposed: true }
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose()
      scene.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose() } })
      Object.values(textures).forEach((t) => t.dispose())
      envTex.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [onStatus, onInfo])

  useEffect(() => { api.current?.build?.(exag) }, [exag])
  useEffect(() => { api.current?.setSkin?.(skin) }, [skin])
  useEffect(() => { if (focusReq) api.current?.focus?.(focusReq.kind) }, [focusReq])
  return <div ref={host} className="absolute inset-0" />
}

export default function Terrain3D() {
  const setView3d = useStore((s) => s.setView3d)
  const [exag, setExag] = useState(2)
  const [skin, setSkin] = useState('photo')
  const [status, setStatus] = useState(null)
  const [info, setInfo] = useState(null)
  const [focusReq, setFocusReq] = useState(null)
  const [follow, setFollow] = useState(true)
  const cam = [['route', 'Маршрут'], ['base', 'База'], ...(info?.roverReady ? [['rover', 'Perseverance']] : []), ...(info?.heliReady ? [['heli', 'Ingenuity']] : [])]
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setView3d(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView3d])
  const seg = (items, value, set) => (
    <div className="flex overflow-hidden rounded-lg border text-[13px]">
      {items.map(([v, l]) => <button key={v} onClick={() => set(v)} className={`px-2.5 py-1 ${value === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>{l}</button>)}
    </div>
  )
  return (
    <div className="fixed inset-0 z-[2500] bg-black" role="dialog" aria-label="3D-вид маршрута">
      <Scene exag={exag} skin={skin} focusReq={focusReq} follow={follow} onStatus={setStatus} onInfo={setInfo} />
      <div className="panel absolute top-3 left-3 flex flex-wrap items-center gap-3 px-3 py-2">
        <div className="text-[14px] font-semibold">3D-вид маршрута</div>
        {seg(SKINS, skin, setSkin)}
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">рельеф {seg([[1, '×1'], [2, '×2'], [3, '×3']], exag, setExag)}</div>
        <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">камера
          <div className="flex overflow-hidden rounded-lg border text-[13px] text-foreground">
            {cam.map(([k, l]) => <button key={k} onClick={() => setFocusReq({ kind: k })} className="px-2.5 py-1 hover:bg-accent">{l}</button>)}
          </div>
        </div>
        {status && <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">{status.endsWith('...') && <Loader2 className="size-3.5 animate-spin" />}{status}</span>}
      </div>
      <Button className="absolute top-3 right-3" onClick={() => setView3d(false)}><X />Закрыть</Button>
      <PlayBar follow={follow} setFollow={setFollow} />
    </div>
  )
}

const hm = (s) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }

// Route replay inside the 3D view: start, pause, speed, scrub, and whether the camera follows the astronaut.
function PlayBar({ follow, setFollow }) {
  const R = useStore((s) => s.result)
  const t = useStore((s) => s.play.t)
  const stops = useStore((s) => s.stops)
  const setPlay = useStore((s) => s.setPlay)
  if (!R) return null
  const end = R.hours * 3600
  const s = t != null ? sampleAt(R, t) : null
  const status = !s ? 'астронавт на базе' : s.working ? `работа: ${stops[s.leg]?.name ?? `точка ${s.leg + 1}`}` : s.leg < stops.length ? `идёт к точке ${s.leg + 1}` : 'возвращается на базу'
  return (
    <div className="panel absolute bottom-4 left-1/2 flex w-[min(640px,calc(100%-24px))] -translate-x-1/2 flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-2">
          {t == null
            ? <Button size="sm" onClick={() => setPlay({ t: 0, playing: true })}><Play />Запустить маршрут</Button>
            : <PlayControls compact />}
        </div>
        <div className="min-w-0 text-[13px]">
          {s && <span className="font-semibold tabular">{fmtH(s.ltst)} </span>}
          <span className="text-muted-foreground">{status}{t != null && <span className="tabular"> · {hm(t)} из {hm(end)}</span>}</span>
        </div>
        <button onClick={() => setFollow(!follow)} title="Камера следует за астронавтом" className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] ${follow ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}><Crosshair className="size-3.5" />Следить</button>
      </div>
      {t != null && <input type="range" min={0} max={end} step={1} value={t} onChange={(e) => setPlay({ t: +e.target.value, playing: false })} className="w-full accent-[var(--primary)]" aria-label="Момент выхода" />}
    </div>
  )
}
