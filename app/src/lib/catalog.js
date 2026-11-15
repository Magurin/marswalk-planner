// Static catalog: science targets, demo plans and map layer definitions.

// Positions are not typed in: each target is placed at Perseverance's localized position on the given sol.
export const TARGETS = [
  { id: 'oeb', sol: 13, name: 'Octavia E. Butler landing site', sci: 'Where Perseverance touched down. Underfoot is the Máaz formation, basaltic lava that paves the crater floor. Flat, well-studied ground and a natural spot for a base.' },
  { id: 'citadelle', sol: 199, name: 'Citadelle ridge (Rochette)', sci: 'Around sols 190-196 the mission drilled its first cores here: basalt with salts. An igneous rock that can date the history of the crater.' },
  { id: 'seitah', sol: 286, name: 'South Séítah', sci: 'Olivine-rich igneous rock, later altered by water into carbonates. Sand ripples lie between the ridges, so step carefully.' },
  { id: 'threeforks', sol: 693, name: 'Three Forks sample depot', sci: 'In December 2022 - January 2023 ten sealed sample tubes were left on the surface here as a backup depot. A target for collection by a crewed mission.' },
  { id: 'wildcat', sol: 502, name: 'Wildcat Ridge, delta front', sci: 'Fine-grained mudstone with sulfates, where SHERLOC found the most organics to date. The best kind of rock for preserving biosignatures.' },
  { id: 'nukshak', sol: 565, name: 'Cape Nukshak, delta base', sci: 'The foot of the delta scarp: the oldest lakebed sediments. Layered sandstones and siltstones recorded the lake first filling with water.' },
  { id: 'belva', sol: 770, name: 'Belva crater rim', sci: 'A small impact crater on top of the fan. Its walls expose inclined sandstone layers - a natural cross-section of the delta interior.' },
  { id: 'fantop', sol: 899, name: 'Upper fan boulders', sci: 'Rounded boulders carried in by late, powerful floods. Each one is a sample of the watershed beyond the crater.' },
  { id: 'margin', sol: 1000, name: 'Margin unit', sci: 'Carbonate- and olivine-bearing rock along the inner edge of the crater, possibly an ancient lakeshore. Carbonates preserve biosignatures well.' },
  { id: 'brightangel', sol: 1219, name: 'Bright Angel (Cheyava Falls)', sci: 'Light-toned mudstone in Neretva Vallis. The Cheyava Falls rock shows "leopard spots" - traces of chemical reactions next to organics. A potential biosignature and the top sampling priority.' },
  { id: 'lookout', sol: 1354, name: 'Lookout Hill, rim crest', sci: 'The top of the Jezero rim after a climb of about 500 m. Views into the crater and across Nili Planum; the rim rocks predate the lake.' },
  { id: 'witchhazel', sol: 1416, name: 'Witch Hazel Hill', sci: 'A layered outcrop on the outer slope of the rim. These may be among the oldest rocks ever sampled on Mars, including clay-bearing layers.' },
]

export const PRESETS = {
  floor: { label: 'Crater floor loop', base: 'oeb', stops: [['citadelle', 30], ['seitah', 40]] },
  delta: { label: 'Delta front loop', base: 'threeforks', stops: [['wildcat', 45], ['nukshak', 30]] },
}

export const LAYER_GROUPS = [
  {
    title: 'Orbital imagery',
    // Opaque images of the same ground: stacked, the top one hides the rest, so one at a time.
    exclusive: true,
    layers: [
      { id: 'mola', name: 'Color elevation map', source: 'MGS MOLA', desc: 'Elevation from the laser altimeter, 463 m. Blue is low, red is high.', opacity: 0.45 },
      { id: 'themisDay', name: 'Daytime infrared', source: 'Odyssey THEMIS', desc: 'Afternoon surface temperature, 100 m.', opacity: 0.7 },
      { id: 'themisNight', name: 'Nighttime infrared', source: 'Odyssey THEMIS', desc: 'Bright is rocky ground that holds heat. Dark is loose dust or sand.', opacity: 0.7 },
    ],
  },
  {
    title: 'Terrain analysis',
    layers: [
      { id: 'slope', name: 'Hazardous slopes', source: 'MRO CTX + HiRISE DTM', desc: 'How hard the ground is to walk. From the 20 m CTX terrain model, sharpened by the 1 m HiRISE model where it exists: a cell is as steep as the scarps and boulder fields inside it.', opacity: 0.6, on: true },
      { id: 'ground', name: 'Loose ground', source: 'Odyssey THEMIS', desc: 'Brown is sand and dust, where every step costs more energy. From thermal inertia: loose ground cools fast at night, rock and crusted soil stay warm. 100 m.', opacity: 0.75 },
      { id: 'shade', name: 'Sun and shadows', source: 'MRO CTX DTM', desc: 'Terrain shadows at the time set by the Sun slider.', opacity: 0.85 },
      { id: 'los', name: 'Radio shadow', source: 'MRO CTX DTM', desc: 'Purple areas have no line of sight to the base comms mast.', opacity: 0.8 },
      { id: 'reach', name: 'Reach map', source: 'EVA model', desc: 'Where you can walk from the base, work on site and return within suit endurance, daylight and oxygen with a reserve. Computed over real terrain, not in a straight line.', opacity: 0.8 },
      { id: 'ring', name: 'Walk-back limit', source: 'EVA rules', desc: 'Dashed ring: the maximum straight-line distance from the base.', on: true, vector: true },
    ],
  },
  {
    title: 'Surface missions',
    layers: [
      { id: 'track', name: 'Perseverance traverse', source: 'Mars 2020', desc: 'The rover path and its last known position.', on: true, vector: true },
      { id: 'heli', name: 'Ingenuity flights', source: 'Mars 2020', desc: 'Helicopter landing sites and where it came to rest.', vector: true },
      { id: 'targets', name: 'Science targets', source: 'Mars 2020', desc: 'Key sites the rover studied up close. Click a target to plan a visit.', on: true, vector: true },
    ],
  },
]
export const LAYERS = LAYER_GROUPS.flatMap((g) => g.layers)
// Layer id -> the other layers of its exclusive group, switched off when it is switched on.
export const EXCLUSIVE = Object.fromEntries(LAYER_GROUPS.filter((g) => g.exclusive).flatMap((g) => g.layers.map((l) => [l.id, g.layers.filter((o) => o.id !== l.id).map((o) => o.id)])))

export const SOURCES = [
  ['MRO HiRISE', '25 cm orthomosaic and 1 m stereo terrain model of Jezero'],
  ['MRO CTX', '6 m mosaic and 20 m stereo terrain model'],
  ['MGS MOLA', 'global laser altimetry, reference elevations'],
  ['Mars Odyssey THEMIS', 'daytime and nighttime thermal infrared, thermal inertia (ground firmness)'],
  ['Viking orbiters', 'global color mosaic'],
  ['Mars 2020 Perseverance', 'traverse, ground data, MEDA weather'],
  ['Mars 2020 Ingenuity', 'flight log and landing sites'],
  ['MSL Curiosity REMS', 'multi-year seasonal weather record'],
  ['MSL Curiosity RAD', 'radiation dose rate on the surface'],
]

// Named places shown when the map is zoomed out to the whole planet.
export const LANDMARKS = [
  { id: 'jezero', lat: 18.44, lon: 77.45, name: 'Jezero Crater', sub: 'Perseverance, EVA area', main: true },
  { id: 'gale', lat: -4.59, lon: 137.44, name: 'Gale Crater', sub: 'Curiosity, REMS weather' },
  { id: 'olympus', lat: 18.65, lon: -133.8, name: 'Olympus Mons' },
  { id: 'valles', lat: -13.9, lon: -59.2, name: 'Valles Marineris' },
  { id: 'hellas', lat: -42.4, lon: 70.5, name: 'Hellas Planitia' },
  { id: 'utopia', lat: 46.7, lon: 117.5, name: 'Utopia Planitia' },
  { id: 'isidis', lat: 6, lon: 90, name: 'Isidis Planitia' },
]
