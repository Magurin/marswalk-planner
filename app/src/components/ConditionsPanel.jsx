import { useEffect, useRef } from 'react'
import { Thermometer, Gauge, CloudSun, Sun } from 'lucide-react'
import { useStore, jezeroWx } from '@/store'
import { SOURCES } from '@/lib/catalog'
import { Badge } from '@/components/ui/badge'
import { Section } from '@/components/Section'

const LiveBadge = ({ live }) => live
  ? <Badge className="border-go/40 bg-go/15 text-go"><span className="size-1.5 animate-pulse rounded-full bg-go" />онлайн</Badge>
  : <Badge variant="outline" className="text-muted-foreground">снимок данных</Badge>

// REMS reports sky and UV as English words.
const SKY = { Sunny: 'Ясно', 'Mostly Sunny': 'Почти ясно', Cloudy: 'Облачно', 'Partly Cloudy': 'Переменная облачность', Dusty: 'Пыльно' }
const UV = { Low: 'Низкий', Moderate: 'Средний', High: 'Высокий', 'Very High': 'Очень высокий', Very_High: 'Очень высокий', Extreme: 'Экстремальный' }

const Metric = ({ icon: Icon, label, value }) => (
  <div className="rounded-lg bg-background/60 px-2.5 py-2">
    <div className="flex items-center gap-1 text-[12px] text-muted-foreground"><Icon className="size-3.5" />{label}</div>
    <div className="mt-0.5 text-[17px] font-semibold tabular">{value}</div>
  </div>
)

function RemsChart({ rems, ls }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight
    cv.width = w * dpr; cv.height = h * dpr
    const g = cv.getContext('2d'); g.scale(dpr, dpr)
    const X = (v) => 32 + (v / 360) * (w - 38), Y = (t) => 8 + ((20 - t) / 130) * (h - 28)
    g.font = '12px Geist Variable, sans-serif'; g.fillStyle = '#c9c3bb'; g.strokeStyle = 'rgba(255,255,255,0.12)'
    for (const t of [0, -50, -100]) { g.beginPath(); g.moveTo(32, Y(t)); g.lineTo(w - 4, Y(t)); g.stroke(); g.textAlign = 'right'; g.fillText(`${t}°`, 27, Y(t) + 4) }
    g.textAlign = 'center'
    for (const v of [0, 90, 180, 270, 360]) g.fillText(`Ls ${v}`, Math.min(w - 20, Math.max(46, X(v))), h - 3)
    for (const s of rems) {
      if (s.ls == null) continue
      if (s.tmax != null && s.tmax > -110 && s.tmax < 30) { g.fillStyle = 'rgba(255,150,80,0.55)'; g.fillRect(X(s.ls), Y(s.tmax), 2, 2) }
      if (s.tmin != null && s.tmin > -110 && s.tmin < 30) { g.fillStyle = 'rgba(110,200,255,0.55)'; g.fillRect(X(s.ls), Y(s.tmin), 2, 2) }
    }
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.setLineDash([4, 3])
    g.beginPath(); g.moveTo(X(ls), 4); g.lineTo(X(ls), h - 18); g.stroke()
  }, [rems, ls])
  return <canvas ref={ref} className="mt-2 block h-36 w-full" />
}

export function ConditionsPanel() {
  const weather = useStore((s) => s.weather)
  const live = useStore((s) => s.live)
  const mt = useStore((s) => s.mt)
  if (!weather) return null
  const j = jezeroWx(weather)
  const r = weather.rems.find((s) => s.tmin != null && s.tmax != null) || weather.rems[0]
  const lsGap = j ? Math.abs(((j.ls - mt.ls + 540) % 360) - 180) : 0
  return (
    <div className="space-y-5">
      <Section title="Езеро - Perseverance MEDA" action={<LiveBadge live={live.meda} />}>
        <div className="rounded-xl border bg-card p-3.5">
          {j ? <>
            <div className="grid grid-cols-3 gap-2">
              <Metric icon={Thermometer} label="Макс. воздух" value={`${j.tmax.toFixed(0)} °C`} />
              <Metric icon={Thermometer} label="Мин. воздух" value={`${j.tmin.toFixed(0)} °C`} />
              <Metric icon={Gauge} label="Давление" value={j.p != null ? `${j.p.toFixed(0)} Па` : 'н/д'} />
            </div>
            <p className="mt-2.5 text-[13px] text-muted-foreground">Последний сол, опубликованный NASA: <span className="text-foreground">сол {j.sol} ({j.date})</span>, Ls {j.ls.toFixed(0)}°. По нему считается проверка температуры.</p>
            {lsGap > 30 && <p className="mt-2 rounded-lg border border-caution/40 bg-caution/10 px-2.5 py-1.5 text-[12.5px] text-caution">Это на {lsGap.toFixed(0)}° по Ls от текущего сезона, поэтому данные только ориентировочные.</p>}
          </> : <p className="text-muted-foreground">Данных MEDA нет.</p>}
        </div>
      </Section>

      <Section title="Гейл - Curiosity REMS" action={<LiveBadge live={live.rems} />}>
        <div className="rounded-xl border bg-card p-3.5">
          <div className="grid grid-cols-3 gap-2">
            <Metric icon={Thermometer} label="Макс. воздух" value={`${r.tmax} °C`} />
            <Metric icon={Thermometer} label="Мин. воздух" value={`${r.tmin} °C`} />
            <Metric icon={Gauge} label="Давление" value={r.p != null ? `${r.p} Па` : 'н/д'} />
            <Metric icon={CloudSun} label="Небо" value={SKY[r.op] || r.op || 'н/д'} />
            <Metric icon={Sun} label="УФ" value={UV[r.uv] || r.uv || 'н/д'} />
            <Metric icon={Gauge} label="Сол" value={r.sol} />
          </div>
          <p className="mt-2.5 text-[13px] text-muted-foreground">Сол {r.sol} ({r.date}). Curiosity находится примерно в 3700 км, поэтому эти данные показывают сезонную картину по планете, а не местный прогноз.</p>
          <RemsChart rems={weather.rems} ls={mt.ls} />
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            <span><span className="mr-1.5 inline-block size-2.5 rounded-full bg-[#ff9650]" />дневной максимум</span>
            <span><span className="mr-1.5 inline-block size-2.5 rounded-full bg-[#6ec8ff]" />ночной минимум</span>
            <span><span className="mr-1.5 inline-block h-0.5 w-3 bg-white align-middle" />сегодня</span>
            <span>{weather.rems.length} солов, °C</span>
          </div>
        </div>
      </Section>

      <Section title="Источники данных">
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {SOURCES.map(([a, b]) => <li key={a} className="px-3.5 py-2 text-[13px]"><span className="font-medium">{a}</span><span className="block text-muted-foreground">{b}</span></li>)}
        </ul>
      </Section>
    </div>
  )
}
