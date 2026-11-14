import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store'
import { SLOPE_CLASSES, slopeClass } from '@/lib/terrain'
import { fmtH } from '@/lib/marstime'
import { fx } from '@/lib/fmt'
import { sampleAt } from '@/lib/eva'
import { PlayControls } from '@/components/Playback'

export function Profile() {
  const R = useStore((s) => s.result)
  const setHover = useStore((s) => s.setHover)
  const setPlay = useStore((s) => s.setPlay)
  const ref = useRef(null)
  const geom = useRef(null)
  const head = useRef(null)
  const [info, setInfo] = useState(null)
  const [size, setSize] = useState(0)
  // Horizontal scale of the drawn chart, for the replay playhead.
  const [plot, setPlot] = useState(null)

  useEffect(() => {
    const ro = new ResizeObserver(() => setSize(ref.current?.clientWidth || 0))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = ref.current, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight
    if (!w || !h) return
    cv.width = w * dpr; cv.height = h * dpr
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h)
    geom.current = null
    const S = R?.samples.filter((s) => s.z === s.z)
    if (!S || S.length < 2) return
    const font = (px, wgt = 400) => `${wgt} ${px}px Geist Variable, sans-serif`
    const m = { l: 56, r: 14, t: 22, b: 24 }
    let z0 = Infinity, z1 = -Infinity
    for (const s of S) { z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z) }
    const pad = Math.max(5, (z1 - z0) * 0.12); z0 -= pad; z1 += pad
    const X = (d) => m.l + (d / R.dist) * (w - m.l - m.r), Y = (z) => h - m.b - ((z - z0) / (z1 - z0)) * (h - m.t - m.b)
    g.font = font(12); g.fillStyle = '#c9c3bb'; g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1
    const stepZ = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => (z1 - z0) / s <= 4) || 500
    for (let z = Math.ceil(z0 / stepZ) * stepZ; z <= z1; z += stepZ) {
      g.beginPath(); g.moveTo(m.l, Y(z)); g.lineTo(w - m.r, Y(z)); g.stroke()
      g.textAlign = 'right'; g.fillText(`${z} m`, m.l - 8, Y(z) + 4)
    }
    // Pick the distance step from the room each label needs, so long routes never pile labels on top of each other.
    const plotW = w - m.l - m.r
    const stepD = [50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6].find((s) => (s / R.dist) * plotW >= 64) || 1e6
    const fmtD = (d) => (d === 0 ? '0' : stepD >= 1000 || d >= 1000 ? `${(d / 1000).toFixed(stepD < 1000 ? 1 : 0)} km` : `${d} m`)
    g.textAlign = 'center'
    for (let d = 0; d <= R.dist; d += stepD) g.fillText(fmtD(d), Math.max(X(d), m.l + 6), h - 6)
    const grad = g.createLinearGradient(0, m.t, 0, h - m.b)
    grad.addColorStop(0, 'rgba(255,140,70,0.32)'); grad.addColorStop(1, 'rgba(255,140,70,0.02)')
    g.beginPath(); g.moveTo(X(S[0].d), h - m.b)
    for (const s of S) g.lineTo(X(s.d), Y(s.z))
    g.lineTo(X(S.at(-1).d), h - m.b); g.closePath(); g.fillStyle = grad; g.fill()
    g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round'
    for (let i = 1; i < S.length; i++) {
      g.strokeStyle = `rgb(${SLOPE_CLASSES[Math.max(0, slopeClass(S[i].slope))].color})`
      g.beginPath(); g.moveTo(X(S[i - 1].d), Y(S[i - 1].z)); g.lineTo(X(S[i].d), Y(S[i].z)); g.stroke()
    }
    for (let i = 1; i < S.length; i++) if (S[i].los === false) { g.fillStyle = '#b54ad6'; g.fillRect(X(S[i - 1].d), h - m.b + 2, Math.max(1, X(S[i].d) - X(S[i - 1].d)), 4) }
    for (let i = 1; i < S.length; i++) if (S[i].sh) { g.fillStyle = '#5b7bd6'; g.fillRect(X(S[i - 1].d), h - m.b + 7, Math.max(1, X(S[i].d) - X(S[i - 1].d)), 3) }
    // The point where turning back costs the most (see the emergency check).
    if (R.abort && R.abort.check.status !== 'go') {
      const a = R.abort.s, col = R.abort.check.status === 'nogo' ? '#ff6b5b' : '#f5c84b'
      g.fillStyle = col; g.beginPath(); g.moveTo(X(a.d), Y(a.z) - 7); g.lineTo(X(a.d) - 6, Y(a.z) - 17); g.lineTo(X(a.d) + 6, Y(a.z) - 17); g.closePath(); g.fill()
    }
    // Stop badges that would touch drop to a second row instead of piling on top of each other.
    const rowsX = [-Infinity, -Infinity]
    R.arrivals.slice(0, -1).forEach((a, i) => {
      const x = X(a.dist)
      let row = rowsX.findIndex((px) => x - px >= 21)
      if (row < 0) row = rowsX[0] <= rowsX[1] ? 0 : 1
      rowsX[row] = x
      const cy = m.t - 2 + row * 21
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1; g.setLineDash([4, 4])
      g.beginPath(); g.moveTo(x, cy + 9); g.lineTo(x, h - m.b); g.stroke(); g.setLineDash([])
      g.fillStyle = '#ff9a5c'; g.strokeStyle = '#fff'; g.lineWidth = 2
      g.beginPath(); g.arc(x, cy, 9, 0, 7); g.fill(); g.stroke()
      g.fillStyle = '#2a1206'; g.font = font(11, 700); g.fillText(i + 1, x, cy + 4)
    })
    geom.current = { S, X, Y, m, w, h }
    setPlot({ l: m.l, span: w - m.l - m.r, dist: R.dist })
  }, [R, size])

  // The replay playhead is moved directly in the DOM: going through React would re-render the chart's component every frame.
  useEffect(() => {
    const place = (s) => {
      const el = head.current, t = s.play.t
      if (!el) return
      if (t == null || !s.result || !plot) { el.style.display = 'none'; return }
      el.style.display = ''
      el.style.transform = `translateX(${plot.l + (sampleAt(s.result, t).d / plot.dist) * plot.span}px)`
    }
    place(useStore.getState())
    return useStore.subscribe((s, prev) => { if (s.play !== prev.play || s.result !== prev.result) place(s) })
  }, [plot])

  const move = (e) => {
    const G = geom.current
    if (!G) return
    const r = e.currentTarget.getBoundingClientRect()
    const d = ((e.clientX - r.left - G.m.l) / (G.w - G.m.l - G.m.r)) * R.dist
    if (d < 0 || d > R.dist) return leave()
    let lo = 0, hi = G.S.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (G.S[mid].d < d) lo = mid; else hi = mid }
    const s = G.S[hi]
    setHover(s)
    setInfo({ s, x: G.X(s.d), y: G.Y(s.z), w: G.w })
  }
  const leave = () => { setHover(null); setInfo(null) }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 pt-2.5 pr-12 pl-4">
        <h2 className="text-[13px] font-semibold whitespace-nowrap">Elevation profile</h2>
        <div className="flex items-center gap-3 text-[12.5px] text-muted-foreground">
          <span className="max-xl:hidden">line color - slope</span>
          <span className="flex items-center gap-1.5 max-sm:hidden"><span className="h-1 w-4 rounded bg-[#b54ad6]" />radio shadow</span>
          <span className="flex items-center gap-1.5 max-md:hidden"><span className="h-1 w-4 rounded bg-[#5b7bd6]" />shade</span>
          <PlayControls compact />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas ref={ref} className="absolute inset-0 h-full w-full cursor-pointer" onMouseMove={move} onMouseLeave={leave} title="Click to replay the EVA from here"
          onClick={() => { if (info) setPlay({ t: info.s.t, playing: false }) }} />
        <div ref={head} className="pointer-events-none absolute top-5 bottom-6 left-0 w-0.5 bg-[#fb7185] shadow-[0_0_8px_#fb7185]" style={{ display: 'none' }} />
        {!R && <div className="absolute inset-0 grid place-items-center text-[14px] text-muted-foreground">The profile appears once the plan has at least one stop.</div>}
        {info && (
          <>
            <div className="pointer-events-none absolute top-5 bottom-6 w-px bg-white/70" style={{ left: info.x }} />
            <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2.5 py-1.5 text-[12.5px] shadow-xl tabular"
              style={{ left: Math.min(Math.max(info.x, 110), info.w - 110), top: Math.max(info.y - 10, 70) }}>
              <div className="font-semibold">{fx(info.s.d / 1000, 2)} km - elevation {Math.round(info.s.z)} m - {fmtH(info.s.ltst)}</div>
              <div className="text-muted-foreground">slope {info.s.slope.toFixed(0)}°, grade {(info.s.grade * 100).toFixed(0)}%, {fx(info.s.v * 3.6, 1)} km/h, {Math.round(info.s.w)} W{info.s.los === false ? ', no link' : ''}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
