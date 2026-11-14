// Static catalog: science targets, demo plans and map layer definitions.

// Positions are not typed in: each target is placed at Perseverance's localized position on the given sol.
export const TARGETS = [
  { id: 'oeb', sol: 13, name: 'Место посадки «Октавия Батлер»', sci: 'Здесь сел Perseverance. Под ногами формация Мааз - базальтовая лава, которая покрывает дно кратера. Ровная и хорошо изученная площадка, естественное место для базы.' },
  { id: 'citadelle', sol: 199, name: 'Гряда Цитадель (Рошетт)', sci: 'Около 190-196 сола здесь пробурили первые керны миссии: базальт с солями. Это магматическая порода, по которой можно датировать историю кратера.' },
  { id: 'seitah', sol: 286, name: 'Южная Сеита', sci: 'Богатая оливином магматическая порода, позже изменённая водой до карбонатов. Между грядами лежит песчаная рябь, поэтому ступать нужно осторожно.' },
  { id: 'threeforks', sol: 693, name: 'Склад образцов Three Forks', sci: 'В декабре 2022 - январе 2023 здесь оставили на поверхности десять запечатанных пробирок с образцами как резервный склад. Цель для их сбора пилотируемой экспедицией.' },
  { id: 'wildcat', sol: 502, name: 'Гряда Wildcat, фронт дельты', sci: 'Тонкозернистый аргиллит с сульфатами, где SHERLOC на тот момент нашёл больше всего органики. Лучшая порода для сохранения биосигнатур.' },
  { id: 'nukshak', sol: 565, name: 'Мыс Нукшак, подножие дельты', sci: 'Основание уступа дельты: самые древние донные осадки озера. Слоистые песчаники и алевролиты записали первое заполнение озера водой.' },
  { id: 'belva', sol: 770, name: 'Вал кратера Белва', sci: 'Небольшой ударный кратер на вершине конуса выноса. В его стенках видны наклонные слои песчаника - естественный разрез недр дельты.' },
  { id: 'fantop', sol: 899, name: 'Валуны верхнего конуса выноса', sci: 'Окатанные валуны, принесённые поздними мощными паводками. Каждый из них - образец водосбора за пределами кратера.' },
  { id: 'margin', sol: 1000, name: 'Краевая единица', sci: 'Порода с карбонатами и оливином вдоль внутреннего края кратера, возможно древний берег озера. Карбонаты хорошо сохраняют биосигнатуры.' },
  { id: 'brightangel', sol: 1219, name: 'Брайт-Энджел (Чейава-Фоллс)', sci: 'Светлый аргиллит в долине Неретва. На камне Чейава-Фоллс видны «леопардовые пятна» - следы химических реакций рядом с органикой. Возможная биосигнатура и главный приоритет для отбора проб.' },
  { id: 'lookout', sol: 1354, name: 'Холм Лукаут, гребень вала', sci: 'Вершина вала Езеро после подъёма примерно на 500 м. Вид внутрь кратера и на плато Нили; породы вала старше озера.' },
  { id: 'witchhazel', sol: 1416, name: 'Холм Уич-Хейзел', sci: 'Слоистое обнажение на внешнем склоне вала. Здешние породы могут быть одними из самых древних, из которых брали пробы на Марсе, включая глинистые слои.' },
]

export const PRESETS = {
  floor: { label: 'Петля по дну кратера', base: 'oeb', stops: [['citadelle', 30], ['seitah', 40]] },
  delta: { label: 'Петля у фронта дельты', base: 'threeforks', stops: [['wildcat', 45], ['nukshak', 30]] },
}

export const LAYER_GROUPS = [
  {
    title: 'Орбитальные снимки',
    // Opaque images of the same ground: stacked, the top one hides the rest, so one at a time.
    exclusive: true,
    layers: [
      { id: 'mola', name: 'Цветная карта высот', source: 'MGS MOLA', desc: 'Высоты по данным лазерного альтиметра, 463 м. Синий - низко, красный - высоко.', opacity: 0.45 },
      { id: 'themisDay', name: 'Дневной ИК-снимок', source: 'Odyssey THEMIS', desc: 'Температура поверхности после полудня, 100 м.', opacity: 0.7 },
      { id: 'themisNight', name: 'Ночной ИК-снимок', source: 'Odyssey THEMIS', desc: 'Светлое - каменистый грунт, который держит тепло. Тёмное - рыхлая пыль или песок.', opacity: 0.7 },
    ],
  },
  {
    title: 'Анализ рельефа',
    layers: [
      { id: 'slope', name: 'Опасные уклоны', source: 'MRO CTX DTM', desc: 'Сложность пешего пути по стереомодели рельефа 20 м.', opacity: 0.6, on: true },
      { id: 'shade', name: 'Солнце и тени', source: 'MRO CTX DTM', desc: 'Тени от рельефа на время, выбранное ползунком Солнца.', opacity: 0.85 },
      { id: 'los', name: 'Радиотень', source: 'MRO CTX DTM', desc: 'С фиолетовых участков не видно мачту связи на базе.', opacity: 0.8 },
      { id: 'reach', name: 'Зона достижимости', source: 'Модель выхода', desc: 'Куда можно дойти от базы, поработать на месте и вернуться, уложившись в ресурс скафандра, световой день и кислород с резервом. Считается по реальному рельефу, а не по прямой.', opacity: 0.8 },
      { id: 'ring', name: 'Предел удаления', source: 'Правила выхода', desc: 'Пунктирное кольцо: максимальное расстояние от базы по прямой.', on: true, vector: true },
    ],
  },
  {
    title: 'Миссии на поверхности',
    layers: [
      { id: 'track', name: 'Путь Perseverance', source: 'Mars 2020', desc: 'Маршрут ровера и его последняя известная позиция.', on: true, vector: true },
      { id: 'heli', name: 'Полёты Ingenuity', source: 'Mars 2020', desc: 'Площадки посадки вертолёта и место, где он остался.', vector: true },
      { id: 'targets', name: 'Научные цели', source: 'Mars 2020', desc: 'Ключевые места, изученные ровером на месте. Нажмите на цель, чтобы спланировать визит.', on: true, vector: true },
    ],
  },
]
export const LAYERS = LAYER_GROUPS.flatMap((g) => g.layers)
// Layer id -> the other layers of its exclusive group, switched off when it is switched on.
export const EXCLUSIVE = Object.fromEntries(LAYER_GROUPS.filter((g) => g.exclusive).flatMap((g) => g.layers.map((l) => [l.id, g.layers.filter((o) => o.id !== l.id).map((o) => o.id)])))

export const SOURCES = [
  ['MRO HiRISE', 'ортомозаика Езеро с разрешением 25 см'],
  ['MRO CTX', 'мозаика 6 м и стереомодель рельефа 20 м'],
  ['MGS MOLA', 'глобальная лазерная альтиметрия, опорные высоты'],
  ['Mars Odyssey THEMIS', 'дневные и ночные тепловые ИК-снимки'],
  ['Орбитальные аппараты Viking', 'глобальная цветная мозаика'],
  ['Mars 2020 Perseverance', 'маршрут, наземные данные, погода MEDA'],
  ['Mars 2020 Ingenuity', 'журнал полётов и площадки посадки'],
  ['MSL Curiosity REMS', 'многолетний ряд сезонной погоды'],
]

// Named places shown when the map is zoomed out to the whole planet.
export const LANDMARKS = [
  { id: 'jezero', lat: 18.44, lon: 77.45, name: 'Кратер Езеро', sub: 'Perseverance, район выхода', main: true },
  { id: 'gale', lat: -4.59, lon: 137.44, name: 'Кратер Гейл', sub: 'Curiosity, метеоданные REMS' },
  { id: 'olympus', lat: 18.65, lon: -133.8, name: 'Гора Олимп' },
  { id: 'valles', lat: -13.9, lon: -59.2, name: 'Долины Маринер' },
  { id: 'hellas', lat: -42.4, lon: 70.5, name: 'Равнина Эллада' },
  { id: 'utopia', lat: 46.7, lon: 117.5, name: 'Равнина Утопия' },
  { id: 'isidis', lat: 6, lon: 90, name: 'Равнина Исиды' },
]
