import { MapPin, Layers, Route, Download, Trash2, Home, Crosshair, Sun, Eye, EyeOff, Globe } from 'lucide-react'
import { useStore } from '@/store'
import { LAYERS, PRESETS } from '@/lib/catalog'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'

export function CommandMenu() {
  const open = useStore((s) => s.cmdOpen)
  const setOpen = useStore((s) => s.setCmdOpen)
  const targets = useStore((s) => s.targets)
  const layers = useStore((s) => s.layers)
  const ready = useStore((s) => s.ready)

  const run = (fn) => () => { setOpen(false); fn(useStore.getState()) }
  if (!ready) return null
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a science target, toggle a layer or run an action" className="top-[12vh] sm:max-w-xl">
      <Command>
      <CommandInput placeholder="Science targets, layers, actions..." />
      <CommandList className="max-h-[min(62vh,560px)]">
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Science targets">
          {targets.map((t) => (
            <CommandItem key={t.id} value={t.name} keywords={['target', 'science', 'site']} onSelect={run((s) => s.flyTo({ lon: t.lon, lat: t.lat, zoom: 15.5 }))} className="py-2">
              <MapPin className="text-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{t.name}</div>
                <div className="truncate text-[12px] text-muted-foreground">{t.sci}</div>
              </div>
              <button className="rounded-md border px-2 py-0.5 text-[12px] hover:bg-primary hover:text-primary-foreground" onClick={(e) => { e.stopPropagation(); run((s) => s.addStop(t, t.name, 30))() }}>Add to route</button>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Layers">
          {LAYERS.map((l) => (
            <CommandItem key={l.id} value={`layer ${l.name} ${l.source}`} onSelect={run((s) => s.setLayer(l.id, { on: !layers[l.id].on }))}>
              {layers[l.id].on ? <EyeOff /> : <Eye />}{layers[l.id].on ? 'Hide' : 'Show'}: {l.name}<CommandShortcut>{l.source}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Plan">
          {Object.entries(PRESETS).map(([k, p]) => <CommandItem key={k} value={`example ${p.label}`} onSelect={run((s) => s.loadPreset(k))}><Route />Load example: {p.label}</CommandItem>)}
          <CommandItem value="show whole route plan" onSelect={run((s) => s.fitPlan())}><Layers />Show whole route</CommandItem>
          <CommandItem value="whole mars planet globe" onSelect={run((s) => s.flyTo({ lon: 77.45, lat: 0, zoom: 0 }))}><Globe />Whole Mars</CommandItem>
          <CommandItem value="go to base" onSelect={run((s) => s.flyTo({ lon: s.base.lon, lat: s.base.lat, zoom: 15 }))}><Home />Go to base</CommandItem>
          <CommandItem value="move base" onSelect={run((s) => s.setPickBase(true))}><Crosshair />Move base...</CommandItem>
          <CommandItem value="shadows now sun" onSelect={run((s) => { s.setSunLTST(Math.round(s.mt.ltst * 4) / 4); s.setLayer('shade', { on: true }) })}><Sun />Show shadows for the current time</CommandItem>
          <CommandItem value="save export geojson" onSelect={run((s) => s.exportPlan())}><Download />Save plan as GeoJSON</CommandItem>
          <CommandItem value="clear stops" onSelect={run((s) => s.clearStops())}><Trash2 />Remove all stops</CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
