import { useEffect } from 'react'
import { Search, Sun, Moon, Crosshair, X, Layers, ClipboardList, Activity, Eye, EyeOff, Maximize2, Minimize2, Sparkles } from 'lucide-react'
import { useStore } from '@/store'
import { fmtH, seasonName } from '@/lib/marstime'
import { fx } from '@/lib/fmt'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const VERDICT_DOT = { go: 'bg-go', caution: 'bg-caution', nogo: 'bg-nogo' }
const VERDICT_TEXT = { go: 'text-go', caution: 'text-caution', nogo: 'text-nogo' }
const VERDICT_LABEL = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' }

function IconBtn({ label, hint, active, className = '', children, ...props }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button aria-label={label} aria-pressed={active}
          className={`grid size-9 shrink-0 place-items-center rounded-xl text-foreground transition-colors hover:bg-accent [&_svg]:size-[18px] ${active ? 'bg-accent text-primary' : ''} ${className}`} {...props}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[13px]">{label}{hint && <kbd className="ml-1.5 rounded border px-1 text-[11px]">{hint}</kbd>}</TooltipContent>
    </Tooltip>
  )
}

function Fact({ label, className = '', children }) {
  return (
    <div className={`px-3.5 leading-tight ${className}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-[13.5px] font-semibold tabular">{children}</div>
    </div>
  )
}

// Floating bar over the map: brand and layers on the left, Mars clock in the middle, view controls and the plan button on the right.
export function TopBar() {
  const mt = useStore((s) => s.mt)
  const tick = useStore((s) => s.tick)
  const ui = useStore((s) => s.ui)
  const hidden = useStore((s) => s.hidden)
  const fullscreen = useStore((s) => s.fullscreen)
  const R = useStore((s) => s.result)
  const { setCmdOpen, togglePanel, setHidden, toggleFullscreen, openAssistant } = useStore.getState()
  const aiOpen = useStore((s) => s.ui.left && s.leftTab === 'assistant')
  useEffect(() => { const id = setInterval(tick, 15000); return () => clearInterval(id) }, [tick])
  const day = mt.sun.el > 0
  const FsIcon = fullscreen ? Minimize2 : Maximize2

  const view = (
    <>
      <IconBtn label={hidden ? 'Show interface' : 'Hide interface'} hint="H" onClick={() => setHidden(!hidden)}>{hidden ? <Eye /> : <EyeOff />}</IconBtn>
      <IconBtn label={fullscreen ? 'Exit full screen' : 'Full screen'} hint="F" onClick={toggleFullscreen}><FsIcon /></IconBtn>
    </>
  )
  if (hidden) return <div className="panel absolute top-3 right-3 z-[1001] flex items-center gap-0.5 p-1.5">{view}</div>

  return (
    <header className="pointer-events-none absolute inset-x-3 top-3 z-[1001] flex items-start justify-between gap-2 whitespace-nowrap [&>*]:pointer-events-auto">
      <div className="panel flex h-[52px] min-w-0 items-center gap-1.5 overflow-hidden py-1.5 pr-1.5 pl-2.5">
        <div className="size-8 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffbe8a,#d1592c_55%,#6b2413)] shadow-[0_0_16px_#d1592c80]" />
        <div className="mr-2 ml-1 hidden leading-tight sm:block">
          <h1 className="text-[15px] font-semibold">Marswalk Planner</h1>
          <p className="text-[11.5px] text-muted-foreground">Jezero Crater</p>
        </div>
        <Button variant={ui.left && !aiOpen ? 'secondary' : 'ghost'} className={`hidden h-9 rounded-xl px-3 text-[13.5px] lg:flex ${ui.left && !aiOpen ? 'text-primary' : ''}`} aria-pressed={ui.left && !aiOpen} onClick={() => { if (aiOpen) useStore.getState().setLeftTab('layers'); else togglePanel('left') }}><Layers />Layers</Button>
        <Button variant={aiOpen ? 'secondary' : 'ghost'} className={`hidden h-9 rounded-xl px-3 text-[13.5px] lg:flex ${aiOpen ? 'text-primary' : ''}`} aria-pressed={aiOpen} onClick={() => (aiOpen ? togglePanel('left') : openAssistant())}><Sparkles />Assistant</Button>
        <Button variant="ghost" className="hidden h-9 w-52 min-w-9 shrink justify-start overflow-hidden gap-2 rounded-xl border px-3 text-[13.5px] text-muted-foreground xl:flex" onClick={() => setCmdOpen(true)}>
          <Search className="size-4" />Search...
        </Button>
        <IconBtn label="Search" className="xl:hidden" onClick={() => setCmdOpen(true)}><Search /></IconBtn>
      </div>

      <div className="panel hidden h-[52px] shrink-0 items-center divide-x divide-border px-1.5 xl:flex">
        <Fact label="Time at Jezero"><span className="inline-flex items-center gap-1.5">{day ? <Sun className="size-3.5 text-amber-300" /> : <Moon className="size-3.5 text-sky-300" />}{fmtH(mt.ltst)}</span></Fact>
        <Fact label="Mission sol">{mt.sol}</Fact>
        <Fact label="Season (north)" className="max-2xl:hidden">Ls {fx(mt.ls, 1)}°, {seasonName(mt.ls)}</Fact>
        <Fact label="Sunrise / sunset" className="max-2xl:hidden">{fmtH(mt.sunrise)} / {fmtH(mt.sunset)}</Fact>
      </div>

      <div className="panel flex h-[52px] shrink-0 items-center gap-0.5 p-1.5">
        <IconBtn label="Elevation profile" hint="P" active={ui.profile} className="max-lg:hidden" onClick={() => togglePanel('profile')}><Activity /></IconBtn>
        {view}
        <Button className="ml-1 hidden h-9 shrink-0 rounded-xl pr-1 pl-3.5 text-[13.5px] font-semibold lg:flex" aria-pressed={ui.right} onClick={() => togglePanel('right')}>
          <ClipboardList />{ui.right ? 'Hide plan' : 'Plan'}
          {R && (
            <span className="ml-1 flex h-7 items-center gap-1.5 rounded-lg bg-background px-2 text-[11.5px] font-bold text-foreground tabular shadow-sm">
              <span className={`size-2 rounded-full ${VERDICT_DOT[R.overall]}`} />
              <span className={VERDICT_TEXT[R.overall]}>{VERDICT_LABEL[R.overall]}</span>
              <span className="font-semibold text-muted-foreground">{fx(R.dist / 1000, 1)} km</span>
            </span>
          )}
        </Button>
      </div>
    </header>
  )
}

export function MapHud() {
  const cursor = useStore((s) => s.cursor)
  const pickBase = useStore((s) => s.pickBase)
  const setPickBase = useStore((s) => s.setPickBase)
  const ready = useStore((s) => s.ready)
  const error = useStore((s) => s.error)
  // Centre of the map area that is not covered by the side panels.
  const centre = { left: 'calc(var(--pad-l) + (100% - var(--pad-l) - var(--pad-r)) / 2)' }
  return (
    <>
      {pickBase && (
        <div style={centre} className="absolute top-[76px] z-[1001] flex -translate-x-1/2 items-center gap-3 rounded-2xl border-2 border-sky bg-popover py-1.5 pr-1.5 pl-4 text-[14px] font-medium whitespace-nowrap shadow-2xl">
          <Crosshair className="size-4 text-sky" />Click the map to place the base
          <Button size="sm" variant="ghost" onClick={() => setPickBase(false)}><X />Cancel</Button>
        </div>
      )}
      {cursor && (
        <div style={{ ...centre, bottom: 'calc(var(--pad-b) + 40px)' }} className="panel pointer-events-none absolute z-[999] flex -translate-x-1/2 gap-4 rounded-xl px-4 py-2 text-[13px] whitespace-nowrap tabular max-lg:hidden">
          <span>{fx(Math.abs(cursor.lat), 5)}° {cursor.lat >= 0 ? 'N' : 'S'}, {fx(Math.abs(cursor.lon), 5)}° {cursor.lon >= 0 ? 'E' : 'W'}</span>
          {cursor.z === cursor.z
            ? <><span><span className="text-muted-foreground">elevation</span> {cursor.z.toFixed(0)} m</span><span><span className="text-muted-foreground">slope</span> {cursor.slope.toFixed(0)}°</span></>
            : <span className="text-caution">outside the terrain model</span>}
          {cursor.dist != null && <span><span className="text-muted-foreground">to base</span> {fx(cursor.dist / 1000, 2)} km</span>}
        </div>
      )}
      {!ready && (
        <div className="absolute inset-0 z-[1002] grid place-items-center bg-background/70 text-[15px]">
          {error ? <span className="text-nogo">Failed to load: {error}</span> : <span className="animate-pulse">Loading the terrain model and mission data...</span>}
        </div>
      )}
    </>
  )
}
