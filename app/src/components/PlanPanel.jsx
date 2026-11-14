import { useState } from 'react'
import NumberFlow from '@number-flow/react'
import { CircleCheck, TriangleAlert, OctagonX, ChevronUp, ChevronDown, X, Download, Trash2, MapPinned, Settings2, Route, Mountain, Clock, Footprints, Flame, Wind, Radio, Home, Crosshair } from 'lucide-react'
import { useStore, VERDICT } from '@/store'
import { PRESETS } from '@/lib/catalog'
import { DEFAULTS } from '@/lib/eva'
import { fmtH } from '@/lib/marstime'
import { Terrain } from '@/lib/terrain'
import { fx, plural } from '@/lib/fmt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { BorderBeam } from '@/components/ui/border-beam'
import { Section } from '@/components/Section'
import { PlanActions, AutoPlan, StartWindow, Variants } from '@/components/PlanTools'

const STATUS_ICON = { go: CircleCheck, caution: TriangleAlert, nogo: OctagonX }
const STATUS_TEXT = { go: 'text-go', caution: 'text-caution', nogo: 'text-nogo' }
const STATUS_BG = { go: 'bg-go/12 border-go/45', caution: 'bg-caution/12 border-caution/45', nogo: 'bg-nogo/12 border-nogo/50' }

function Verdict() {
  const R = useStore((s) => s.result)
  if (!R) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-[14px] text-muted-foreground">
        <MapPinned className="mb-2 size-5 text-foreground" />
        Маршрута пока нет. Нажмите на карту, чтобы поставить точку, откройте научную цель или загрузите пример ниже.
      </div>
    )
  }
  const v = VERDICT[R.overall], Icon = STATUS_ICON[R.overall]
  const issues = R.checks.filter((c) => c.status !== 'go')
  return (
    <div className={`relative overflow-hidden rounded-xl border-2 p-4 ${STATUS_BG[R.overall]}`}>
      <div className="flex items-center gap-3">
        <Icon className={`size-8 shrink-0 ${STATUS_TEXT[R.overall]}`} strokeWidth={2.2} />
        <div>
          <div className={`text-2xl font-bold tracking-wide ${STATUS_TEXT[R.overall]}`}>{v.label}</div>
          <div className="text-[13.5px] text-foreground/90">{issues.length ? `${issues.length} ${plural(issues.length, ['проверка требует', 'проверки требуют', 'проверок требуют'])} внимания` : 'Все проверки пройдены'}</div>
        </div>
      </div>
      <BorderBeam size={90} duration={7} borderWidth={2} colorFrom={v.color} colorTo="transparent" />
    </div>
  )
}

function Stat({ icon: Icon, label, children, sub }) {
  return (
    <div className="rounded-xl border bg-card px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-none tabular">{children}</div>
      {sub && <div className="mt-1.5 text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Stats() {
  const R = useStore((s) => s.result)
  const mt = useStore((s) => s.mt)
  const tank = useStore((s) => s.params.o2TankKg)
  if (!R) return null
  const mins = Math.round(R.hours * 60)
  const small = (t) => <span className="ml-0.5 text-[14px] font-medium text-muted-foreground">{t}</span>
  return (
    <div className="grid grid-cols-2 gap-2">
      <Stat icon={Footprints} label="Расстояние"><NumberFlow locales="ru-RU" value={R.dist / 1000} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />{small('км')}</Stat>
      <Stat icon={Clock} label="Длительность" sub={`возврат ${fmtH(R.endLTST)}, закат ${fmtH(mt.sunset)}`}><NumberFlow value={Math.floor(mins / 60)} />{small('ч')} <NumberFlow value={mins % 60} format={{ minimumIntegerDigits: 2 }} />{small('мин')}</Stat>
      <Stat icon={Mountain} label="Подъём / спуск"><NumberFlow value={Math.round(R.climb)} /><span className="text-muted-foreground"> / </span><NumberFlow value={Math.round(R.descent)} />{small('м')}</Stat>
      <Stat icon={Wind} label="Расход кислорода" sub={`из ${fx(tank, 2)} кг запаса`}><NumberFlow locales="ru-RU" value={R.o2} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />{small('кг')}</Stat>
      <Stat icon={Flame} label="Энергия" sub={`в среднем ${Math.round(R.avgW)} Вт`}><NumberFlow locales="ru-RU" value={Math.round(R.energy / 4184)} />{small('ккал')}</Stat>
      <Stat icon={Radio} label="Радиосвязь" sub="маршрута в зоне мачты базы">{R.losPct == null ? 'н/д' : <><NumberFlow value={Math.round(R.losPct)} />{small('%')}</>}</Stat>
    </div>
  )
}

const Row = ({ badge, title, time, cls = '' }) => (
  <div className={`flex items-center gap-3 px-3 py-2.5 ${cls}`}>
    <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-sky text-[13px] font-bold text-[#04202e]">{badge}</div>
    <div className="min-w-0 flex-1 truncate text-[14px]">{title}</div>
    <div className="text-[13px] font-medium tabular">{time}</div>
  </div>
)

function Stops() {
  const stops = useStore((s) => s.stops)
  const base = useStore((s) => s.base)
  const R = useStore((s) => s.result)
  const targets = useStore((s) => s.targets)
  const start = useStore((s) => s.params.startLTST)
  const { updateStop, removeStop, moveStop, flyTo } = useStore.getState()
  const near = (s) => {
    const [d, t] = targets.map((t) => [Terrain.dist([s.lon, s.lat], [t.lon, t.lat]), t]).sort((a, b) => a[0] - b[0])[0] || []
    return d < 400 ? t.name : null
  }
  if (!base) return null
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Row badge={<Home className="size-4" />} title={<>Старт: <span className="font-medium">{base.name}</span></>} time={fmtH(start)} />
      {stops.map((s, i) => {
        const a = R?.arrivals[i], n = near(s)
        return (
          <div key={i} className="group border-t px-3 py-2.5">
            <div className="flex items-center gap-3">
              <button onClick={() => flyTo({ lon: s.lon, lat: s.lat })} title="Показать на карте" className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground ring-2 ring-white/80">{i + 1}</button>
              <Input value={s.name} onChange={(e) => updateStop(i, { name: e.target.value })} className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-[14px] font-medium shadow-none hover:border-input focus-visible:bg-background" aria-label="Название точки" />
              <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100">
                <Button variant="ghost" size="icon-sm" onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label="Выше"><ChevronUp /></Button>
                <Button variant="ghost" size="icon-sm" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} aria-label="Ниже"><ChevronDown /></Button>
                <Button variant="ghost" size="icon-sm" className="hover:text-nogo" onClick={() => removeStop(i)} aria-label="Удалить точку"><X /></Button>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-10 text-[12.5px] text-muted-foreground">
              {a && <span>прибытие <b className="font-semibold text-foreground tabular">{fmtH(a.ltstArrive)}</b>, {fx(a.dist / 1000, 2)} км от старта</span>}
              <label className="flex items-center gap-1.5">работа
                <Input type="number" min={0} max={240} step={5} value={s.minutes} onChange={(e) => updateStop(i, { minutes: Math.max(0, Math.min(240, +e.target.value || 0)) })} className="h-7 w-16 px-2 text-[13px] tabular" aria-label="Минут на точке" />мин
              </label>
              {n && <span className="text-sky">рядом: {n}</span>}
            </div>
          </div>
        )
      })}
      {R && <Row cls="border-t" badge={<Home className="size-4" />} title="Возвращение на базу" time={fmtH(R.endLTST)} />}
    </div>
  )
}

function Checks() {
  const R = useStore((s) => s.result)
  if (!R) return null
  const order = { nogo: 0, caution: 1, go: 2 }
  return (
    <div className="space-y-1.5">
      {[...R.checks].sort((a, b) => order[a.status] - order[b.status]).map((c) => {
        const Icon = STATUS_ICON[c.status]
        return (
          <div key={c.id} className={`flex gap-3 rounded-xl border px-3 py-2.5 ${c.status === 'go' ? 'bg-card' : STATUS_BG[c.status]}`}>
            <Icon className={`mt-0.5 size-[18px] shrink-0 ${STATUS_TEXT[c.status]}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[14px] font-medium">{c.label}<span className={`text-[11.5px] font-bold tracking-wide ${STATUS_TEXT[c.status]}`}>{VERDICT[c.status].label}</span></div>
              <div className="text-[13px] text-muted-foreground">{c.detail}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const PARAM_FIELDS = [
  ['flatSpeedKmh', 'Скорость по ровному', 'км/ч', 0.1], ['massKg', 'Масса астронавта со скафандром', 'кг', 1], ['maxSlopeDeg', 'Предельный уклон пешком', '°', 1],
  ['evaLimitH', 'Ресурс скафандра', 'ч', 0.5], ['o2TankKg', 'Доступный кислород', 'кг', 0.05], ['o2ReserveMin', 'Резерв кислорода', 'мин', 5],
  ['stationW', 'Мощность работы на точках', 'Вт', 10], ['walkbackKm', 'Предел удаления от базы', 'км', 0.5], ['sunsetMarginMin', 'Запас до заката', 'мин', 5], ['mastM', 'Высота мачты на базе', 'м', 1], ['reachWorkMin', 'Работа на месте для зоны достижимости', 'мин', 5],
]

function Assumptions() {
  const params = useStore((s) => s.params)
  const setParam = useStore((s) => s.setParam)
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Settings2 />Допущения</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Допущения модели выхода</DialogTitle>
          <DialogDescription className="text-[13.5px]">Скорость зависит от уклона по кривой типа Тоблера и привязана к темпу в скафандре по ровной поверхности. Затраты энергии считаются по Santee et al. (2001) с марсианской гравитацией, кислород - из расчёта 20,1 кДж на литр. Это помощь в планировании, а не полётные правила.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {PARAM_FIELDS.map(([k, label, unit, step]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`p-${k}`} className="text-[13px]">{label} <span className="font-normal text-muted-foreground">({unit})</span></Label>
              <Input id={`p-${k}`} type="number" step={step} min={0} defaultValue={params[k]} className="tabular"
                onBlur={(e) => { const v = parseFloat(e.target.value); if (v > 0 && v !== params[k]) setParam(k, v); else e.target.value = params[k] }} />
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => Object.entries(DEFAULTS).forEach(([k, v]) => k !== 'startLTST' && setParam(k, v))}>Вернуть значения по умолчанию</Button>
      </DialogContent>
    </Dialog>
  )
}

function Settings() {
  const routing = useStore((s) => s.routing)
  const start = useStore((s) => s.params.startLTST)
  const base = useStore((s) => s.base)
  const pickBase = useStore((s) => s.pickBase)
  const { setRouting, setParam, setPickBase } = useStore.getState()
  const [t, setT] = useState(null)
  return (
    <div className="space-y-3 rounded-xl border bg-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="start" className="flex-col items-start gap-0.5 text-[13.5px]">Начало выхода <span className="text-[12px] font-normal text-muted-foreground">местное солнечное время</span></Label>
        <Input id="start" type="time" step={900} value={t ?? fmtH(start)} className="h-8 w-[9.75rem] shrink-0 tabular"
          onChange={(e) => setT(e.target.value)}
          onBlur={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isFinite(h)) setParam('startLTST', h + (m || 0) / 60); setT(null) }} />
      </div>
      <StartWindow />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-medium">Маршрут</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={routing} onValueChange={(v) => v && setRouting(v)}>
          <ToggleGroupItem value="terrain" className="px-3"><Route />По рельефу</ToggleGroupItem>
          <ToggleGroupItem value="straight" className="px-3">Напрямую</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[13.5px]"><span className="text-muted-foreground">База</span> <span className="font-medium">{base?.name}</span></div>
        <Button variant={pickBase ? 'default' : 'outline'} size="sm" onClick={() => setPickBase(!pickBase)}><Crosshair />{pickBase ? 'Нажмите на карту' : 'Перенести базу'}</Button>
      </div>
    </div>
  )
}

export function PlanPanel() {
  const { loadPreset, clearStops, exportPlan } = useStore.getState()
  const hasStops = useStore((s) => s.stops.length > 0)
  return (
    <div className="space-y-5">
      <Section title="План выхода">
        <div className="space-y-2"><Verdict /><PlanActions /><Stats /></div>
      </Section>
      <Section title="Маршрут" action={<div className="flex gap-1.5"><AutoPlan /><Assumptions /></div>}>
        <div className="space-y-2">
          <Settings />
          <Stops />
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(PRESETS).map(([k, p]) => <Button key={k} variant="secondary" size="sm" onClick={() => loadPreset(k)}>Пример: {p.label}</Button>)}
            <Button variant="ghost" size="sm" onClick={clearStops} disabled={!hasStops}><Trash2 />Очистить</Button>
            <Button variant="ghost" size="sm" onClick={exportPlan} disabled={!hasStops}><Download />GeoJSON</Button>
          </div>
        </div>
      </Section>
      <Section title="Проверки готовности"><Checks /></Section>
      <Section title="Сравнение вариантов"><Variants /></Section>
    </div>
  )
}
