import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { Layers, ClipboardList, CloudSun, Activity, X, PanelLeftClose, PanelRightClose, Sparkles } from 'lucide-react'
import { useStore, roomForBothPanels } from '@/store'
import { MapView } from '@/components/MapView'
import { TopBar, MapHud } from '@/components/Chrome'
import { LayersPanel } from '@/components/LayersPanel'
import { PlanPanel } from '@/components/PlanPanel'
import { ConditionsPanel } from '@/components/ConditionsPanel'
import { Profile } from '@/components/Profile'
import { CommandMenu } from '@/components/CommandMenu'
import { PlayDriver, PlayHud } from '@/components/Playback'
import { Briefing } from '@/components/Briefing'
import { Assistant } from '@/components/Assistant'
// three.js is large: loaded only when the 3D view is opened.
const Terrain3D = lazy(() => import('@/components/Terrain3D'))
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

// Panel geometry in px. The same numbers feed the CSS variables that move map controls out from under the panels.
const GAP = 12, TOP = 76, LEFT_W = 340, RIGHT_W = 400, PROFILE_H = 180, MOBILE_BAR = 60, MOBILE_PROFILE_H = 150

const desktopQuery = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)') : null
const useDesktop = () => useSyncExternalStore(
  (cb) => { desktopQuery.addEventListener('change', cb); return () => desktopQuery.removeEventListener('change', cb) },
  () => desktopQuery.matches,
)

function CloseBtn({ label, icon: Icon = X, className = '', ...props }) {
  return <button aria-label={label} title={label} className={`grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground ${className}`} {...props}><Icon className="size-[18px]" /></button>
}

function LeftPanel() {
  const togglePanel = useStore((s) => s.togglePanel)
  const tab = useStore((s) => s.leftTab)
  const setTab = useStore((s) => s.setLeftTab)
  return (
    <aside className="panel absolute z-[1000] flex animate-in flex-col overflow-hidden duration-200 fade-in slide-in-from-left-4" style={{ top: TOP, left: GAP, bottom: GAP, width: LEFT_W }}>
      <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col gap-0">
        <div className="flex items-center gap-2 border-b py-2.5 pr-2 pl-3">
          <TabsList className="grid flex-1 grid-cols-3">
            <TabsTrigger value="layers" className="px-1 text-[13px]"><Layers />Layers</TabsTrigger>
            <TabsTrigger value="conditions" className="px-1 text-[13px]"><CloudSun />Conditions</TabsTrigger>
            <TabsTrigger value="assistant" className="px-1 text-[13px]"><Sparkles />AI</TabsTrigger>
          </TabsList>
          <CloseBtn label="Hide left panel" icon={PanelLeftClose} onClick={() => togglePanel('left')} />
        </div>
        {tab === 'assistant'
          ? <TabsContent value="assistant" className="min-h-0 flex-1"><Assistant /></TabsContent>
          : (
            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="layers" className="p-4"><LayersPanel /></TabsContent>
              <TabsContent value="conditions" className="p-4"><ConditionsPanel /></TabsContent>
            </ScrollArea>
          )}
      </Tabs>
    </aside>
  )
}

function RightPanel() {
  const togglePanel = useStore((s) => s.togglePanel)
  return (
    <aside className="panel absolute z-[1000] animate-in overflow-hidden duration-200 fade-in slide-in-from-right-4" style={{ top: TOP, right: GAP, bottom: GAP, width: RIGHT_W }}>
      <CloseBtn label="Hide plan panel" icon={PanelRightClose} className="absolute top-2.5 right-2.5 z-10" onClick={() => togglePanel('right')} />
      <ScrollArea className="h-full"><div className="p-4"><PlanPanel /></div></ScrollArea>
    </aside>
  )
}

function ProfileCard({ desktop }) {
  const togglePanel = useStore((s) => s.togglePanel)
  const style = desktop
    ? { left: `calc(var(--pad-l) + ${GAP}px)`, right: `calc(var(--pad-r) + ${GAP}px)`, bottom: GAP, height: PROFILE_H }
    : { left: 8, right: 8, bottom: MOBILE_BAR + 8, height: MOBILE_PROFILE_H }
  return (
    <div className="panel absolute z-[1000] animate-in overflow-hidden transition-[left,right] duration-200 fade-in slide-in-from-bottom-4" style={style}>
      <CloseBtn label="Hide elevation profile" className="absolute top-1 right-1.5 z-10" onClick={() => togglePanel('profile')} />
      <Profile />
    </div>
  )
}

const MOBILE = {
  layers: { title: 'Map layers', desc: 'NASA data layers and the time for shadows.', body: <LayersPanel /> },
  plan: { title: 'EVA plan', desc: 'Route, stops and readiness checks.', body: <PlanPanel /> },
  conditions: { title: 'Conditions', desc: 'Weather from Perseverance and Curiosity.', body: <ConditionsPanel /> },
  assistant: { title: 'Assistant', desc: 'Ask about the plan or ask to change it.', body: <div className="-mx-4 -mb-6 h-[70vh]"><Assistant /></div> },
}

function MobileBar({ show }) {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const togglePanel = useStore((s) => s.togglePanel)
  const profile = useStore((s) => s.ui.profile)
  const verdict = useStore((s) => s.result?.overall)
  const dot = { go: 'bg-go', caution: 'bg-caution', nogo: 'bg-nogo' }[verdict]
  return (
    <>
      {show && (
        <div className="panel absolute inset-x-2 bottom-2 z-[1000] flex gap-1.5 p-1.5">
          <Button variant="secondary" className="h-9 min-w-0 flex-1 shrink gap-1.5 px-2" onClick={() => setPanel('layers')}><Layers />Layers</Button>
          <Button className="h-9 min-w-0 flex-1 shrink gap-1.5 px-2" onClick={() => setPanel('plan')}><ClipboardList />Plan{dot && <span className={`size-2.5 rounded-full ring-2 ring-primary-foreground/40 ${dot}`} />}</Button>
          <Button variant="secondary" className="h-9 min-w-0 flex-1 shrink gap-1.5 px-2" onClick={() => setPanel('conditions')}><CloudSun />Weather</Button>
          <Button variant="secondary" size="icon" className="size-9" aria-label="Assistant" onClick={() => setPanel('assistant')}><Sparkles /></Button>
          <Button variant={profile ? 'default' : 'secondary'} size="icon" className="size-9" aria-label="Elevation profile" aria-pressed={profile} onClick={() => togglePanel('profile')}><Activity /></Button>
        </div>
      )}
      <Drawer open={!!panel} onOpenChange={(o) => !o && setPanel(null)}>
        <DrawerContent className="max-h-[85vh]">
          {panel && <>
            <DrawerHeader className="text-left"><DrawerTitle>{MOBILE[panel].title}</DrawerTitle><DrawerDescription>{MOBILE[panel].desc}</DrawerDescription></DrawerHeader>
            <div className="overflow-y-auto px-4 pb-6">{MOBILE[panel].body}</div>
          </>}
        </DrawerContent>
      </Drawer>
    </>
  )
}

export default function App() {
  const init = useStore((s) => s.init)
  const ui = useStore((s) => s.ui)
  const hidden = useStore((s) => s.hidden)
  const view3d = useStore((s) => s.view3d)
  const desktop = useDesktop()
  useEffect(() => { init() }, [init])
  // When the window gets too narrow for both side panels, keep the plan and fold the layers panel.
  useEffect(() => {
    const fit = () => { const s = useStore.getState(); if (s.ui.left && s.ui.right && !roomForBothPanels()) s.togglePanel('left') }
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  useEffect(() => {
    const onChange = () => useStore.setState({ fullscreen: !!document.fullscreenElement })
    const onKey = (e) => {
      const t = e.target
      if (e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      const s = useStore.getState()
      if (s.cmdOpen || s.panel || s.view3d || s.briefing) return
      const k = e.key.toLowerCase()
      if (k === 'f') { e.preventDefault(); s.toggleFullscreen() }
      else if (k === 'h') s.setHidden(!s.hidden)
      else if (k === 'p') s.togglePanel('profile')
      else if (e.key === 'Escape' && s.hidden) s.setHidden(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    // Capture phase: runs before Radix/Vaul close a drawer on Esc, so Esc closes the drawer first.
    window.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey, true) }
  }, [])

  const left = desktop && !hidden && ui.left, right = desktop && !hidden && ui.right, profile = !hidden && ui.profile
  // How much of each map edge the panels cover. Leaflet controls, the cursor readout and route fitting all read these.
  const pads = {
    '--pad-l': `${left ? LEFT_W + GAP : 0}px`,
    '--pad-r': `${right ? RIGHT_W + GAP : 0}px`,
    '--pad-b': `${desktop ? (profile ? PROFILE_H + GAP : 0) : hidden ? 0 : MOBILE_BAR + (profile ? MOBILE_PROFILE_H + 8 : 0)}px`,
  }
  return (
    <TooltipProvider delayDuration={250}>
      <div className="dark relative isolate h-dvh overflow-hidden bg-background text-foreground" style={pads}>
        <MapView />
        <MapHud />
        <TopBar />
        {left && <LeftPanel />}
        {right && <RightPanel />}
        {profile && <ProfileCard desktop={desktop} />}
        <MobileBar show={!desktop && !hidden} />
        <PlayHud />
      </div>
      <PlayDriver />
      <Briefing />
      {view3d && <Suspense fallback={<div className="fixed inset-0 z-[2500] grid place-items-center bg-black/80 text-[15px]">Loading 3D...</div>}><Terrain3D /></Suspense>}
      <CommandMenu />
      <Toaster position="top-center" offset={78} richColors closeButton toastOptions={{ classNames: { toast: 'text-[13.5px]' } }} />
    </TooltipProvider>
  )
}
