import { useEffect } from 'react'
import { Play, Pause, Square, Wind, Clock, Footprints, Home, Radio, Moon, Hammer } from 'lucide-react'
import { useStore, usePlayT } from '@/store'
import { sampleAt, O2_KG_PER_J } from '@/lib/eva'
import { reachAt } from '@/lib/reach'
import { fmtH } from '@/lib/marstime'
import { fx } from '@/lib/fmt'

const SPEEDS = [60, 300, 900]
const hm = (s) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }

// Moves the replay clock. Mounted once; does nothing while the replay is paused or off.
export function PlayDriver() {
  const playing = useStore((s) => s.play.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const step = (now) => {
      const s = useStore.getState(), R = s.result
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      if (!R || s.play.t == null) return
      const end = R.hours * 3600, t = Math.min(end, s.play.t + dt * s.play.speed)
      s.setPlay({ t, playing: t < end })
      // Shadows follow the replay clock, in 5 minute steps so the shadow worker keeps up.
      if (s.layers.shade.on) { const l = Math.round(sampleAt(R, t).ltst * 12) / 12; if (l !== s.sunLTST) s.setSunLTST(l) }
      if (t < end) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing])
  return null
}

export function PlayControls({ compact = false }) {
  const hasRoute = useStore((s) => !!s.result)
  // Only what the buttons show: subscribing to the whole replay state would re-render them on every frame.
  const playing = useStore((s) => s.play.playing)
  const active = useStore((s) => s.play.t != null)
  const speed = useStore((s) => s.play.speed)
  const setPlay = useStore((s) => s.setPlay)
  if (!hasRoute) return null
  const play = { playing, speed, t: active ? 0 : null }
  const toggle = () => {
    const s = useStore.getState(), t = s.play.t
    if (s.play.playing) return setPlay({ playing: false })
    setPlay({ t: t == null || t >= s.result.hours * 3600 ? 0 : t, playing: true })
  }
  const btn = 'grid size-7 place-items-center rounded-md hover:bg-accent [&_svg]:size-4'
  return (
    <div className="flex items-center gap-1">
      <button className={`${btn} ${play.playing ? 'text-primary' : ''}`} onClick={toggle} aria-label={play.playing ? 'Пауза' : 'Проиграть выход'} title={play.playing ? 'Пауза' : 'Проиграть выход'}>{play.playing ? <Pause /> : <Play />}</button>
      {play.t != null && <button className={btn} onClick={() => setPlay({ t: null, playing: false })} aria-label="Остановить проигрывание" title="Остановить проигрывание"><Square /></button>}
      {!compact && <span className="text-[12px] text-muted-foreground">проиграть</span>}
      <div className="ml-1 flex overflow-hidden rounded-md border text-[11.5px] tabular">
        {SPEEDS.map((v) => (
          <button key={v} onClick={() => setPlay({ speed: v })} className={`px-1.5 py-0.5 ${play.speed === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`} title={`1 секунда - ${v / 60} мин выхода`}>×{v}</button>
        ))}
      </div>
    </div>
  )
}

const Item = ({ icon: Icon, label, children, tone = '' }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground"><Icon className="size-3.5" />{label}</div>
    <div className={`text-[15px] font-semibold tabular ${tone}`}>{children}</div>
  </div>
)

// Status card over the map while the replay is on: where the walker is, what is left, and the cost of turning back now.
export function PlayHud() {
  const R = useStore((s) => s.result)
  const t = usePlayT()
  const reach = useStore((s) => s.reach)
  const terrain = useStore((s) => s.terrain)
  const p = useStore((s) => s.params)
  const stops = useStore((s) => s.stops)
  const setPlay = useStore((s) => s.setPlay)
  if (!R || t == null) return null
  const s = sampleAt(R, t)
  const used = s.e * O2_KG_PER_J, left = p.o2TankKg - used
  const home = reachAt(reach, terrain, s.lon, s.lat)
  const homeO2 = home ? home.eBack * O2_KG_PER_J : null
  const spare = home ? left - homeO2 : null
  const status = s.working ? `работа: ${stops[s.leg]?.name ?? `точка ${s.leg + 1}`}` : s.leg < stops.length ? `идёт к точке ${s.leg + 1}` : 'возвращается на базу'
  const tone = spare == null ? '' : spare < 0 ? 'text-nogo' : spare < R.reserveKg / 2 ? 'text-caution' : 'text-go'
  return (
    <div style={{ left: 'calc(var(--pad-l) + (100% - var(--pad-l) - var(--pad-r)) / 2)' }} className="panel absolute top-[76px] z-[1001] w-[min(560px,calc(100%-24px))] -translate-x-1/2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold"><span className="tabular">{fmtH(s.ltst)}</span> <span className="font-normal text-muted-foreground">- {status}</span></div>
          <div className="text-[12px] text-muted-foreground tabular">прошло {hm(t)} из {hm(R.hours * 3600)}</div>
        </div>
        <PlayControls compact />
      </div>
      <input type="range" min={0} max={R.hours * 3600} step={1} value={t} onChange={(e) => setPlay({ t: +e.target.value, playing: false })} className="mt-2 w-full accent-[var(--primary)]" aria-label="Момент выхода" />
      <div className="mt-2 grid grid-cols-4 gap-3">
        <Item icon={Footprints} label="Пройдено">{fx(s.d / 1000, 2)} км</Item>
        <Item icon={Wind} label="Кислород">{fx(left, 2)} кг</Item>
        <Item icon={Home} label="Если назад сейчас" tone={tone}>{home ? `${Math.round(home.tBack / 60)} мин` : 'н/д'}</Item>
        <Item icon={Clock} label="Запас O2 после" tone={tone}>{spare == null ? 'н/д' : `${fx(spare, 2)} кг`}</Item>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
        <span className="flex items-center gap-1"><Radio className="size-3.5" />{s.los == null ? 'связь: н/д' : s.los ? 'мачта базы видна' : <span className="text-nogo">нет прямой связи с базой</span>}</span>
        {s.sh && <span className="flex items-center gap-1"><Moon className="size-3.5" />в тени рельефа</span>}
        {s.working && <span className="flex items-center gap-1"><Hammer className="size-3.5" />работа на точке</span>}
        <span>высота {Math.round(s.z)} м</span>
      </div>
    </div>
  )
}
