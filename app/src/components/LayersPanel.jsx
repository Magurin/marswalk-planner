import { Info, Sun, Moon, Sunrise } from 'lucide-react'
import { useStore, SITE } from '@/store'
import { LAYER_GROUPS } from '@/lib/catalog'
import { SLOPE_CLASSES } from '@/lib/terrain'
import { REACH_CLASSES } from '@/lib/reach'
import { sunAt, fmtH } from '@/lib/marstime'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Section } from '@/components/Section'

function LayerRow({ def }) {
  const st = useStore((s) => s.layers[def.id])
  const setLayer = useStore((s) => s.setLayer)
  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-colors ${st.on ? 'border-primary/40 bg-primary/[0.07]' : 'border-transparent hover:bg-accent/50'}`}>
      <div className="flex items-center gap-3">
        <Switch id={`ly-${def.id}`} checked={st.on} onCheckedChange={(on) => setLayer(def.id, { on })} />
        <label htmlFor={`ly-${def.id}`} className="min-w-0 flex-1 cursor-pointer">
          <div className="text-[14px] font-medium leading-tight">{def.name}</div>
          <div className="text-[12.5px] text-muted-foreground">{def.source}</div>
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Подробнее: ${def.name}`}><Info className="size-4" /></button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-64 text-[13px]">{def.desc}</TooltipContent>
        </Tooltip>
      </div>
      {st.on && !def.vector && (
        <div className="mt-2.5 flex items-center gap-3 pl-[52px]">
          <Slider value={[st.opacity]} min={0} max={1} step={0.05} onValueChange={([opacity]) => setLayer(def.id, { opacity })} aria-label={`Непрозрачность: ${def.name}`} />
          <span className="w-9 text-right text-[12.5px] tabular text-muted-foreground">{Math.round(st.opacity * 100)}%</span>
        </div>
      )}
      {st.on && def.id === 'slope' && (
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 pl-[52px]">
          {SLOPE_CLASSES.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[12.5px]">
              <span className="size-3 shrink-0 rounded-sm ring-1 ring-black/40" style={{ background: `rgb(${c.color})` }} />
              <span className="tabular">{c.label}</span>
            </div>
          ))}
        </div>
      )}
      {st.on && def.id === 'los' && <p className="mt-2 pl-[52px] text-[12.5px] text-muted-foreground"><span className="mr-1.5 inline-block size-3 rounded-sm bg-[#7828a0] align-[-1px]" />нет радиосвязи с базой</p>}
      {st.on && def.id === 'reach' && <ReachLegend />}
    </div>
  )
}

function ReachLegend() {
  const busy = useStore((s) => s.reachBusy || !s.reach)
  const work = useStore((s) => s.params.reachWorkMin)
  return (
    <div className="mt-2.5 space-y-1 pl-[52px] text-[12.5px]">
      {REACH_CLASSES.map((c) => (
        <div key={c.label} className="flex items-center gap-2"><span className="size-3 shrink-0 rounded-sm ring-1 ring-black/40" style={{ background: `rgb(${c.color})` }} />{c.label}</div>
      ))}
      <p className="text-muted-foreground">Туда, {work} мин работы и обратно. Доля самого жёсткого из ресурсов: время, световой день, кислород.{busy && ' Считаю...'}</p>
    </div>
  )
}

export function LayersPanel() {
  return (
    <div className="space-y-5">
      {LAYER_GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.exclusive && <p className="-mt-1 mb-2 px-1 text-[12.5px] text-muted-foreground">Снимки закрывают друг друга, поэтому включается только один.</p>}
          <div className="space-y-1">{g.layers.map((d) => <LayerRow key={d.id} def={d} />)}</div>
        </Section>
      ))}
      <SunControl />
    </div>
  )
}

export function SunControl() {
  const sunLTST = useStore((s) => s.sunLTST)
  const mt = useStore((s) => s.mt)
  const start = useStore((s) => s.params.startLTST)
  const setSunLTST = useStore((s) => s.setSunLTST)
  const shadeOn = useStore((s) => s.layers.shade.on)
  const setLayer = useStore((s) => s.setLayer)
  const sun = sunAt(sunLTST, mt.decl, SITE.lat)
  const up = sun.el > 0
  return (
    <Section title="Солнце и тени">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold tabular">{fmtH(sunLTST)}</div>
            <div className="text-[12.5px] text-muted-foreground">истинное местное солнечное время</div>
          </div>
          <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${up ? 'bg-amber-400/15 text-amber-200' : 'bg-sky-400/15 text-sky-200'}`}>
            {up ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {up ? `высота ${sun.el.toFixed(0)}°, азимут ${sun.az.toFixed(0)}°` : 'Солнце за горизонтом'}
          </div>
        </div>
        <Slider className="mt-4" value={[sunLTST]} min={5} max={19} step={0.25} onValueChange={([v]) => { setSunLTST(v); if (!shadeOn) setLayer('shade', { on: true }) }} aria-label="Местное солнечное время для теней" />
        <div className="mt-1.5 flex justify-between text-[12px] text-muted-foreground tabular"><span>05:00</span><span>12:00</span><span>19:00</span></div>
        <div className="mt-3 grid grid-cols-3 gap-2 [&>button]:h-auto [&>button]:min-h-8 [&>button]:px-2 [&>button]:py-1 [&>button]:leading-tight [&>button]:whitespace-normal">
          <Button variant="secondary" size="sm" onClick={() => setSunLTST(Math.round(mt.ltst * 4) / 4)}>Сейчас</Button>
          <Button variant="secondary" size="sm" onClick={() => setSunLTST(start)}>Начало выхода</Button>
          <Button variant="secondary" size="sm" onClick={() => setSunLTST(Math.round(mt.sunset * 4) / 4 - 0.5)}><Sunrise className="rotate-180" />Перед закатом</Button>
        </div>
        {!shadeOn && <p className="mt-3 text-[12.5px] text-muted-foreground">Ползунок сразу включает слой теней.</p>}
      </div>
    </Section>
  )
}
