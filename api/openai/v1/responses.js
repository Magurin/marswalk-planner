// Production twin of the Vite dev proxy: forwards the assistant's request to OpenAI and adds the key server-side.
// Set OPENAI_API_KEY in the Vercel project settings; without it the assistant reports that it is not configured.
export default {
  async fetch(req) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    const key = process.env.OPENAI_API_KEY
    if (!key) return Response.json({ error: { message: 'OPENAI_API_KEY is not set on the server' } }, { status: 503 })
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: await req.text(),
    })
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') ?? 'application/json' } })
  },
}
