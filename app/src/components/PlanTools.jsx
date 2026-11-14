import { useMemo, useState } from 'react'
import { Wand2, Clock4, Save, Upload, Trash2, Link2, FileText, Box, Play, Loader2 } from 'lucide-react'
import { useStore, startOptions, VERDICT } from '@/store'
import { fmtH } from '@/lib/marstime'
import { fx, plural } from '@/lib/fmt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const DOT = { go: 'bg-go', caution: 'bg-caution', nogo: 'bg-nogo' }
const TEXT = { go: 'text-go', caution: 'text-caution', nogo: 'text-nogo' }

// Replay, 3D, briefing and share link: one row under the verdict.
export function PlanActions() {
  const R = useStore((s) => s.result)
  const { setPlay, setView3d, setBriefing, shareLink } = useStore.getState()
  return (
    <div className="grid grid-cols-4 gap-1.5 [&>button]:h-auto [&>button]:flex-col [&>button]:gap-1 [&>button]:py-2 [&>button]:text-[12px]">
      <Button variant="secondary" disabled={!R} onClick={() => { const t = useStore.getState().play.t; setPlay({ t: t == null || t >= R.hours * 3600 ? 0 : t, playing: true }) }}><Play />Play</Button>
      <Button variant="secondary" onClick={() => setView3d(true)}><Box />3D view</Button>
      <Button variant="secondary" disabled={!R} onClick={() => setBriefing(true)}><FileText />Briefing</Button>
      <Button variant="secondary" onClick={shareLink}><Link2 />Link</Button>
    </div>
  )
}

export function AutoPlan() {
  const targets = useStore((s) => s.targets)
  const terrain = useStore((s) => s.terrain)
  const busy = useStore((s) => s.autoBusy)
  const run = useStore((s) => s.runAutoPlan)
  const inside = targets.filter((t) => terrain?.inside(t.lon, t.lat))
  const [ids, setIds] = useState(null)
  const [minutes, setMinutes] = useState(30)
  const [open, setOpen] = useState(false)
  const chosen = ids ?? inside.map((t) => t.id)
  const flip = (id) => setIds(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy != null}>{busy != null ? <Loader2 className="animate-spin" /> : <Wand2 />}{busy != null ? `Planning ${Math.round(busy * 100)}%` : 'Auto plan'}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>EVA auto planner</DialogTitle>
          <DialogDescription className="text-[13.5px]">Picks which of the selected targets to visit and in what order, to see as much as possible within suit endurance, daylight and oxygen with reserve. Paths follow the terrain from the current base. The current route stops will be replaced.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-1">
          {inside.map((t) => (
            <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-accent">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={chosen.includes(t.id)} onChange={() => flip(t.id)} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13.5px]">Work at each target
            <Input type="number" min={0} max={180} step={5} value={minutes} onChange={(e) => setMinutes(Math.max(0, Math.min(180, +e.target.value || 0)))} className="h-8 w-20 tabular" />min
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIds(chosen.length ? [] : inside.map((t) => t.id))}>{chosen.length ? 'Clear all' : 'Select all'}</Button>
            <Button size="sm" disabled={!chosen.length} onClick={() => { setOpen(false); run({ ids: chosen, minutes }) }}><Wand2 />Build route</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Verdict for every start time of the day for the current route, so the best window can be picked with one click.
export function StartWindow() {
  const legs = useStore((s) => s.legs)
  const params = useStore((s) => s.params)
  const viewshed = useStore((s) => s.viewshed)
  const weather = useStore((s) => s.weather)
  const sunset = useStore((s) => Math.round(s.mt.sunset * 60))
  const setParam = useStore((s) => s.setParam)
  const [open, setOpen] = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opts = useMemo(() => (open ? startOptions(useStore.getState()) : []), [open, legs, params, viewshed, weather, sunset])
  const best = opts.reduce((a, o) => (!a || o.score < a.score ? o : a), null)
  if (!legs.length) return null
  return (
    <div>
      <button className="flex items-center gap-1.5 text-[12.5px] text-sky hover:underline" onClick={() => setOpen(!open)}><Clock4 className="size-3.5" />{open ? 'Hide start times' : 'Find best start time'}</button>
      {open && opts.length > 0 && (
        <div className="mt-2">
          <div className="flex h-16 items-end gap-px">
            {opts.map((o) => (
              <button key={o.h} onClick={() => setParam('startLTST', o.h)} title={`${fmtH(o.h)}: ${VERDICT[o.overall].label}, shade ${o.shadowPct.toFixed(0)}%${o.tLo < Infinity ? `, low ${o.tLo.toFixed(0)} °C` : ''}`}
                className={`relative flex-1 rounded-t-sm ${DOT[o.overall]} ${o.h === params.startLTST ? 'ring-2 ring-white' : 'opacity-75 hover:opacity-100'}`}
                style={{ height: `${o.overall === 'nogo' ? 25 : o.overall === 'caution' ? 55 : 70 + 30 * (1 - Math.min(1, o.shadowPct / 40))}%` }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground tabular"><span>{fmtH(opts[0].h)}</span><span>{fmtH(opts.at(-1).h)}</span></div>
          {best && (
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px]">
              <span>Best: <b className="tabular">{fmtH(best.h)}</b> <span className={TEXT[best.overall]}>{VERDICT[best.overall].label}</span>{best.shadowPct >= 1 && <span className="text-muted-foreground">, shade {best.shadowPct.toFixed(0)}%</span>}</span>
              {best.h !== params.startLTST && <Button size="xs" variant="secondary" onClick={() => setParam('startLTST', best.h)}>Use</Button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Variants() {
  const variants = useStore((s) => s.variants)
  const R = useStore((s) => s.result)
  const { saveVariant, loadVariant, deleteVariant, setGhost, renameVariant } = useStore.getState()
  const cols = [
    ['Dist.', (v) => `${fx(v.sum.dist / 1000, 1)} km`, (v) => v.sum.dist],
    ['Time', (v) => `${fx(v.sum.hours, 1)} h`, (v) => v.sum.hours],
    ['Climb', (v) => `${Math.round(v.sum.climb)} m`, (v) => v.sum.climb],
    ['O2', (v) => `${fx(v.sum.o2, 2)}`, (v) => v.sum.o2],
    ['Link', (v) => (v.sum.losPct == null ? 'n/a' : `${Math.round(v.sum.losPct)}%`), (v) => -(v.sum.losPct ?? 0)],
  ]
  // Highlight the best value in each column.
  const best = cols.map(([, , k]) => Math.min(...variants.map(k)))
  return (
    <div className="space-y-2">
      {variants.length > 0 && (
        // One card per variant: the name gets the full width and the figures sit in their own row,
        // so nothing is squeezed in the narrow plan panel.
        <div className="divide-y overflow-hidden rounded-xl border bg-card text-[12.5px]">
          {variants.map((v) => (
            <div key={v.id} className="px-3 py-2 hover:bg-accent/50" onMouseEnter={() => setGhost(v.id)} onMouseLeave={() => setGhost(null)}>
              <div className="flex items-center gap-1.5">
                <span className={`size-2 shrink-0 rounded-full ${DOT[v.sum.overall]}`} title={VERDICT[v.sum.overall].label} />
                <input value={v.name} onChange={(e) => renameVariant(v.id, e.target.value)} className="min-w-0 flex-1 truncate bg-transparent font-medium outline-none" aria-label="Variant name" />
                <span className="shrink-0 text-[11.5px] whitespace-nowrap text-muted-foreground">{v.sum.stops} {plural(v.sum.stops, ['stop', 'stops'])}, until {fmtH(v.sum.endLTST)}</span>
                <button className="shrink-0 rounded p-1 hover:bg-accent" title="Open variant" aria-label="Open variant" onClick={() => loadVariant(v.id)}><Upload className="size-3.5" /></button>
                <button className="shrink-0 rounded p-1 hover:bg-accent hover:text-nogo" title="Delete variant" aria-label="Delete variant" onClick={() => deleteVariant(v.id)}><Trash2 className="size-3.5" /></button>
              </div>
              <div className="mt-1 grid grid-cols-5 gap-1 pl-3.5 tabular">
                {cols.map(([h, f, k], i) => (
                  <div key={h} className="min-w-0">
                    <div className="truncate text-[10.5px] text-muted-foreground">{h}</div>
                    <div className={`truncate whitespace-nowrap ${variants.length > 1 && k(v) === best[i] ? 'font-semibold text-go' : ''}`}>{f(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!R} onClick={() => saveVariant()}><Save />Save current as variant</Button>
        {variants.length > 0 && <span className="text-[12px] text-muted-foreground">hover a row to see its route on the map</span>}
      </div>
    </div>
  )
}
