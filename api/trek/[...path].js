// Production tile cache: proxies NASA Trek tiles and marks them immutable, so Vercel's CDN keeps each tile
// after the first request and later views never touch trek.nasa.gov. Trek itself sends no Cache-Control,
// which is why a plain rewrite in vercel.json would not be cached.
const UPSTREAM = 'https://trek.nasa.gov/tiles/Mars/EQ'
// Layer/1.0.0/default/default028mm/z/y/x.ext - nothing else is forwarded.
const TILE = /^\/[A-Za-z0-9_.-]+\/1\.0\.0\/default\/default028mm\/\d{1,2}\/\d{1,7}\/\d{1,7}\.(jpg|png)$/

export default {
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    const path = new URL(req.url).pathname.replace(/^\/api\/trek/, '')
    if (!TILE.test(path)) return new Response('Not a tile path', { status: 400 })
    const r = await fetch(UPSTREAM + path).catch(() => null)
    if (!r) return new Response('Upstream unreachable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
    const headers = { 'Content-Type': r.headers.get('Content-Type') ?? 'application/octet-stream' }
    // Tiles never change, so a good one is cached for a year; a missing tile for a day; upstream failures not at all.
    headers['Cache-Control'] = r.ok
      ? 'public, max-age=86400, s-maxage=31536000, immutable'
      : r.status === 404 ? 'public, s-maxage=86400' : 'no-store'
    return new Response(r.body, { status: r.status, headers })
  },
}
