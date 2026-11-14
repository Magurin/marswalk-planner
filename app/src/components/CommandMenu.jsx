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
    <CommandDialog open={open} onOpenChange={setOpen} title="Поиск" description="Перейти к научной цели, переключить слой или выполнить действие" className="top-[12vh] sm:max-w-xl">
      <Command>
      <CommandInput placeholder="Научные цели, слои, действия..." />
      <CommandList className="max-h-[min(62vh,560px)]">
        <CommandEmpty>Ничего не найдено.</CommandEmpty>
        <CommandGroup heading="Научные цели">
          {targets.map((t) => (
            <CommandItem key={t.id} value={t.name} keywords={['цель', 'наука', 'место']} onSelect={run((s) => s.flyTo({ lon: t.lon, lat: t.lat, zoom: 15.5 }))} className="py-2">
              <MapPin className="text-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{t.name}</div>
                <div className="truncate text-[12px] text-muted-foreground">{t.sci}</div>
              </div>
              <button className="rounded-md border px-2 py-0.5 text-[12px] hover:bg-primary hover:text-primary-foreground" onClick={(e) => { e.stopPropagation(); run((s) => s.addStop(t, t.name, 30))() }}>В маршрут</button>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Слои">
          {LAYERS.map((l) => (
            <CommandItem key={l.id} value={`слой ${l.name} ${l.source}`} onSelect={run((s) => s.setLayer(l.id, { on: !layers[l.id].on }))}>
              {layers[l.id].on ? <EyeOff /> : <Eye />}{layers[l.id].on ? 'Скрыть' : 'Показать'}: {l.name}<CommandShortcut>{l.source}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="План">
          {Object.entries(PRESETS).map(([k, p]) => <CommandItem key={k} value={`пример ${p.label}`} onSelect={run((s) => s.loadPreset(k))}><Route />Загрузить пример: {p.label}</CommandItem>)}
          <CommandItem value="показать весь маршрут план" onSelect={run((s) => s.fitPlan())}><Layers />Показать весь маршрут</CommandItem>
          <CommandItem value="весь марс планета" onSelect={run((s) => s.flyTo({ lon: 77.45, lat: 0, zoom: 0 }))}><Globe />Весь Марс</CommandItem>
          <CommandItem value="к базе" onSelect={run((s) => s.flyTo({ lon: s.base.lon, lat: s.base.lat, zoom: 15 }))}><Home />К базе</CommandItem>
          <CommandItem value="перенести базу" onSelect={run((s) => s.setPickBase(true))}><Crosshair />Перенести базу...</CommandItem>
          <CommandItem value="тени сейчас солнце" onSelect={run((s) => { s.setSunLTST(Math.round(s.mt.ltst * 4) / 4); s.setLayer('shade', { on: true }) })}><Sun />Показать тени на текущее время</CommandItem>
          <CommandItem value="сохранить экспорт geojson" onSelect={run((s) => s.exportPlan())}><Download />Сохранить план в GeoJSON</CommandItem>
          <CommandItem value="очистить точки" onSelect={run((s) => s.clearStops())}><Trash2 />Удалить все точки</CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
