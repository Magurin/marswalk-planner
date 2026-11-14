import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { useStore, VERDICT } from '@/store'
import { SLOPE_CLASSES, slopeClass, M_PER_DEG } from '@/lib/terrain'
import { O2_KG_PER_J } from '@/lib/eva'
import { fmtH } from '@/lib/marstime'
import { fx, plural } from '@/lib/fmt'
import { SOURCES } from '@/lib/catalog'
import { Button } from '@/components/ui/button'

const VERDICT_BG = { go: '#16a34a', caution: '#ca8a04', nogo: '#dc2626' }
const PARAMS = [
  ['flatSpeedKmh', 'Speed on flat ground', 'km/h'], ['massKg', 'Mass with suit', 'kg'], ['maxSlopeDeg', 'Max slope', '°'], ['evaLimitH', 'Suit endurance', 'h'],
  ['o2TankKg', 'Oxygen', 'kg'], ['o2ReserveMin', 'Oxygen reserve', 'min'], ['stationW', 'Power at stops', 'W'], ['walkbackKm', 'Walk-back limit', 'km'],
  ['sunsetMarginMin', 'Margin before sunset', 'min'], ['mastM', 'Radio mast', 'm'],
]

// Shaded relief of the route area drawn from the CTX terrain model, with the route on top. Needs no map tiles, so it always prints.
function RouteMap({ R, base, stops, terrain }) {
  const ref = useRef(null)
  useEffect(() => {
    const T = terrain, cv = ref.current
    const pts = [[base.lon, base.lat], ...R.samples.map((s) => [s.lon, s.lat])]
    let w0 = Infinity, e0 = -Infinity, s0 = Infinity, n0 = -Infinity
    for (const [lo, la] of pts) { w0 = Math.min(w0, lo); e0 = Math.max(e0, lo); s0 = Math.min(s0, la); n0 = Math.max(n0, la) }
    const kx = Math.cos(T.lat0 * Math.PI / 180)
    const padX = Math.max(0.004, (e0 - w0) * 0.15), padY = Math.max(0.004, (n0 - s0) * 0.15)
    w0 -= padX; e0 += padX; s0 -= padY; n0 += padY
    const W = 1000, H = Math.round(Math.min(760, Math.max(420, (W * (n0 - s0)) / ((e0 - w0) * kx))))
    // Keep the ground undistorted: widen the narrower side.
    const aspect = W / H, spanX = (e0 - w0) * kx, spanY = n0 - s0
    if (spanX / spanY > aspect) { const d = (spanX / aspect - spanY) / 2; s0 -= d; n0 += d } else { const d = (spanY * aspect - spanX) / 2 / kx; w0 -= d; e0 += d }
    cv.width = W; cv.height = H
    const g = cv.getContext('2d'), img = g.createImageData(W, H), px = img.data
    const sun = { e: -0.57, n: 0.57, u: 0.59 } // from the north-west, 36° up: the usual cartographic light
    for (let y = 0; y < H; y++) {
      const lat = n0 - ((y + 0.5) / H) * (n0 - s0), r = Math.round(T.row(lat))
      for (let x = 0; x < W; x++) {
        const lon = w0 + ((x + 0.5) / W) * (e0 - w0), c = Math.round(T.col(lon)), o = (y * W + x) * 4
        if (c < 0 || r < 0 || c >= T.W || r >= T.H || !(T.z[r * T.W + c] === T.z[r * T.W + c])) { px[o] = px[o + 1] = px[o + 2] = 235; px[o + 3] = 255; continue }
        const i = r * T.W + c, gx = T.gx[i], gy = T.gy[i]
        const ill = Math.max(0, (-gx * sun.e - gy * sun.n + sun.u) / Math.sqrt(gx * gx + gy * gy + 1))
        const v = 70 + 175 * ill
        px[o] = v * 1.0; px[o + 1] = v * 0.9; px[o + 2] = v * 0.8; px[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    const X = (lon) => ((lon - w0) / (e0 - w0)) * W, Y = (lat) => ((n0 - lat) / (n0 - s0)) * H
    g.lineJoin = g.lineCap = 'round'
    g.strokeStyle = '#000'; g.lineWidth = 7; g.beginPath(); R.samples.forEach((s, k) => (k ? g.lineTo : g.moveTo).call(g, X(s.lon), Y(s.lat))); g.stroke()
    g.lineWidth = 4
    for (let k = 1; k < R.samples.length; k++) {
      const a = R.samples[k - 1], b = R.samples[k]
      g.strokeStyle = `rgb(${SLOPE_CLASSES[Math.max(0, slopeClass(b.slope))].color})`
      g.beginPath(); g.moveTo(X(a.lon), Y(a.lat)); g.lineTo(X(b.lon), Y(b.lat)); g.stroke()
    }
    const mark = (lon, lat, text, fill, square) => {
      g.fillStyle = fill; g.strokeStyle = '#fff'; g.lineWidth = 3
      g.beginPath(); if (square) g.roundRect(X(lon) - 13, Y(lat) - 13, 26, 26, 6); else g.arc(X(lon), Y(lat), 13, 0, 7)
      g.fill(); g.stroke(); g.fillStyle = '#111'; g.font = '700 14px Geist Variable, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, X(lon), Y(lat) + 1)
    }
    if (R.abort && R.abort.check.status !== 'go') mark(R.abort.s.lon, R.abort.s.lat, '!', R.abort.check.status === 'nogo' ? '#ef4444' : '#eab308', true)
    mark(base.lon, base.lat, 'H', '#7dd3fc', true)
    stops.forEach((s, i) => mark(s.lon, s.lat, i + 1, '#ff9a5c'))
    // Scale bar and north arrow.
    const mpp = ((e0 - w0) * kx * M_PER_DEG) / W
    const bar = [100, 200, 500, 1000, 2000, 5000].find((m) => m / mpp >= 110) || 5000
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(14, H - 44, bar / mpp + 24, 32)
    g.fillStyle = '#111'; g.fillRect(26, H - 22, bar / mpp, 4); g.font = '600 13px Geist Variable, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'
    g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, 26, H - 28)
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(W - 34, 36, 22, 0, 7); g.fill()
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(W - 34, 18); g.lineTo(W - 42, 42); g.lineTo(W - 34, 36); g.lineTo(W - 26, 42); g.closePath(); g.fill()
    g.textAlign = 'center'; g.fillText('N', W - 34, 54)
  }, [R, base, stops, terrain])
  return <canvas ref={ref} className="block w-full rounded-lg border border-zinc-300" />
}

function ProfileChart({ R }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current, W = 1000, H = 220
    cv.width = W; cv.height = H
    const g = cv.getContext('2d'), S = R.samples.filter((s) => s.z === s.z)
    if (S.length < 2) return
    const m = { l: 64, r: 12, t: 26, b: 28 }
    let z0 = Math.min(...S.map((s) => s.z)), z1 = Math.max(...S.map((s) => s.z))
    const pad = Math.max(5, (z1 - z0) * 0.12); z0 -= pad; z1 += pad
    const X = (d) => m.l + (d / R.dist) * (W - m.l - m.r), Y = (z) => H - m.b - ((z - z0) / (z1 - z0)) * (H - m.t - m.b)
    g.font = '13px Geist Variable, sans-serif'; g.fillStyle = '#444'; g.strokeStyle = '#ddd'
    const stepZ = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => (z1 - z0) / s <= 4) || 500
    for (let z = Math.ceil(z0 / stepZ) * stepZ; z <= z1; z += stepZ) { g.beginPath(); g.moveTo(m.l, Y(z)); g.lineTo(W - m.r, Y(z)); g.stroke(); g.textAlign = 'right'; g.fillText(`${z} m`, m.l - 8, Y(z) + 4) }
    const stepD = [100, 200, 500, 1e3, 2e3, 5e3].find((s) => (s / R.dist) * (W - m.l - m.r) >= 70) || 5e3
    g.textAlign = 'center'
    for (let d = 0; d <= R.dist; d += stepD) g.fillText(d >= 1000 || stepD >= 1000 ? `${fx(d / 1000, stepD < 1000 ? 1 : 0)} km` : `${d} m`, X(d), H - 8)
    g.fillStyle = '#f5e2d3'; g.beginPath(); g.moveTo(X(0), H - m.b); S.forEach((s) => g.lineTo(X(s.d), Y(s.z))); g.lineTo(X(R.dist), H - m.b); g.fill()
    g.lineWidth = 3
    for (let i = 1; i < S.length; i++) { g.strokeStyle = `rgb(${SLOPE_CLASSES[Math.max(0, slopeClass(S[i].slope))].color})`; g.beginPath(); g.moveTo(X(S[i - 1].d), Y(S[i - 1].z)); g.lineTo(X(S[i].d), Y(S[i].z)); g.stroke() }
    R.arrivals.slice(0, -1).forEach((a, i) => {
      g.strokeStyle = '#999'; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(a.dist), m.t); g.lineTo(X(a.dist), H - m.b); g.stroke(); g.setLineDash([])
      g.fillStyle = '#ff9a5c'; g.beginPath(); g.arc(X(a.dist), m.t - 10, 10, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = '700 12px Geist Variable, sans-serif'; g.fillText(i + 1, X(a.dist), m.t - 6)
    })
  }, [R])
  return <canvas ref={ref} className="block w-full" />
}

export function Briefing() {
  const open = useStore((s) => s.briefing)
  const R = useStore((s) => s.result)
  return open && R ? <BriefingDoc R={R} /> : null
}

function BriefingDoc({ R }) {
  const setOpen = useStore((s) => s.setBriefing)
  const { base, stops, params, terrain, mt } = useStore.getState()
  const [made] = useState(() => new Date().toLocaleString('en-US'))
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])
  const v = VERDICT[R.overall]
  const rows = [{ name: `Start: ${base.name}`, arrive: null, depart: params.startLTST, dist: 0, o2: 0 }]
  R.arrivals.forEach((a, i) => {
    const s = R.samples.find((x) => x.t >= a.arrive - 0.5) || R.samples.at(-1)
    rows.push({ name: i < stops.length ? stops[i].name : 'Return to base', n: i < stops.length ? i + 1 : null, arrive: a.ltstArrive, depart: i < stops.length ? a.ltstDepart : null, dist: a.dist, o2: s.e * O2_KG_PER_J, work: stops[i]?.minutes })
  })
  const order = { nogo: 0, caution: 1, go: 2 }
  return createPortal(
    <div className="briefing fixed inset-0 z-[3000] overflow-auto bg-zinc-200 text-zinc-900" role="dialog" aria-label="EVA briefing">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-300 bg-white/95 px-5 py-3">
        <div className="text-[15px] font-semibold">EVA briefing</div>
        <div className="flex gap-2">
          <Button onClick={() => window.print()}><Printer />Print or PDF</Button>
          <Button variant="outline" className="border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100" onClick={() => setOpen(false)}><X />Close</Button>
        </div>
      </div>
      <article className="paper mx-auto my-6 max-w-[1040px] space-y-6 bg-white p-10 shadow-xl">
        <header className="flex items-start justify-between gap-6 border-b border-zinc-300 pb-5">
          <div>
            <div className="text-[13px] tracking-wide text-zinc-500 uppercase">Surface EVA briefing - Jezero crater</div>
            <h1 className="mt-1 text-[28px] font-bold leading-tight">{base.name}: {stops.length} {plural(stops.length, ['stop', 'stops'])}, {fx(R.dist / 1000, 2)} km</h1>
            <div className="mt-1 text-[14px] text-zinc-600 tabular">Sol {mt.sol}, start {fmtH(params.startLTST)} local solar time, back {fmtH(R.endLTST)}, sunset {fmtH(mt.sunset)}. Generated {made}.</div>
          </div>
          <div className="shrink-0 rounded-xl px-5 py-3 text-center text-white" style={{ background: VERDICT_BG[R.overall] }}>
            <div className="text-[24px] font-bold tracking-wide">{v.label}</div>
            <div className="text-[12.5px]">{v.long}</div>
          </div>
        </header>

        <section className="grid grid-cols-6 gap-3 text-center tabular">
          {[['Distance', `${fx(R.dist / 1000, 2)} km`], ['Duration', `${fx(R.hours, 1)} h`], ['Climb / descent', `${Math.round(R.climb)} / ${Math.round(R.descent)} m`], ['Oxygen', `${fx(R.o2, 2)} of ${fx(params.o2TankKg, 2)} kg`], ['Link to base', R.losPct == null ? 'n/a' : `${Math.round(R.losPct)}% of route`], ['In shade', R.shadowPct == null ? 'n/a' : `${Math.round(R.shadowPct)}% of route`]].map(([k, val]) => (
            <div key={k} className="rounded-lg border border-zinc-200 px-2 py-2.5"><div className="text-[11.5px] text-zinc-500">{k}</div><div className="mt-0.5 text-[15px] font-semibold">{val}</div></div>
          ))}
        </section>

        <section>
          <h2 className="mb-2 text-[16px] font-semibold">Route map</h2>
          <RouteMap R={R} base={base} stops={stops} terrain={terrain} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-600">
            {SLOPE_CLASSES.slice(0, 5).map((c) => <span key={c.label} className="flex items-center gap-1.5"><span className="h-1.5 w-5 rounded" style={{ background: `rgb(${c.color})` }} />slope {c.label}</span>)}
            <span>H - base, numbers - stops, ! - worst point for emergency return. Terrain: MRO CTX 20 m stereo model.</span>
          </div>
        </section>

        <section className="break-inside-avoid">
          <h2 className="mb-2 text-[16px] font-semibold">Elevation profile</h2>
          <ProfileChart R={R} />
        </section>

        <section className="break-inside-avoid">
          <h2 className="mb-2 text-[16px] font-semibold">Schedule</h2>
          <table className="w-full border-collapse text-[13.5px] tabular [&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0">
            <thead><tr className="border-b-2 border-zinc-300 text-left text-[12px] text-zinc-500"><th className="py-1.5">#</th><th>Stop</th><th className="text-right">Arrive</th><th className="text-right">Work</th><th className="text-right">Depart</th><th className="text-right">From start</th><th className="text-right">O2 used</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-zinc-200">
                  <td className="py-1.5 font-semibold">{r.n ?? 'H'}</td><td>{r.name}</td>
                  <td className="text-right">{r.arrive == null ? '-' : fmtH(r.arrive)}</td><td className="text-right">{r.work ? `${r.work} min` : '-'}</td>
                  <td className="text-right">{r.depart == null ? '-' : fmtH(r.depart)}</td><td className="text-right">{fx(r.dist / 1000, 2)} km</td><td className="text-right">{fx(r.o2, 2)} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="break-inside-avoid">
          <h2 className="mb-2 text-[16px] font-semibold">Readiness checks</h2>
          <div className="grid grid-cols-2 gap-2">
            {[...R.checks].sort((a, b) => order[a.status] - order[b.status]).map((c) => (
              <div key={c.id} className="flex gap-2.5 rounded-lg border border-zinc-200 px-3 py-2">
                <span className="mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: VERDICT_BG[c.status] }}>{VERDICT[c.status].label}</span>
                <div><div className="text-[13.5px] font-semibold">{c.label}</div><div className="text-[12.5px] text-zinc-600">{c.detail}</div></div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-6 break-inside-avoid text-[12.5px]">
          <div>
            <h2 className="mb-2 text-[16px] font-semibold">Model assumptions</h2>
            <table className="w-full tabular"><tbody>{PARAMS.map(([k, label, unit]) => <tr key={k} className="border-b border-zinc-100"><td className="py-1 text-zinc-600">{label}</td><td className="text-right font-medium">{params[k]} {unit}</td></tr>)}</tbody></table>
          </div>
          <div>
            <h2 className="mb-2 text-[16px] font-semibold">Data sources</h2>
            <ul className="space-y-1 text-zinc-600">{SOURCES.map(([a, b]) => <li key={a}><b className="text-zinc-800">{a}</b>: {b}</li>)}</ul>
            <p className="mt-3 text-zinc-500">A planning aid built on open NASA data, not flight rules.</p>
          </div>
        </section>
      </article>
    </div>,
    document.body,
  )
}
