// Promise wrapper around calc.worker.js. A newer request of the same kind supersedes an older one still running.
let worker = null, seq = 0
const pending = new Map()
const latest = {}

function get() {
  if (worker) return worker
  worker = new Worker(new URL('./calc.worker.js', import.meta.url), { type: 'module' })
  worker.postMessage({ type: 'init', args: { url: new URL('data/jezero_dem', document.baseURI).href } })
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id)
    if (!p) return
    if (data.progress != null) return p.onProgress?.(data.progress)
    pending.delete(data.id)
    if (data.error) p.reject(new Error(data.error))
    else p.resolve(latest[p.type] === data.id ? data.value : null) // null: a newer request replaced this one
  }
  return worker
}

export function calc(type, args, onProgress) {
  const id = ++seq
  latest[type] = id
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, type })
    get().postMessage({ id, type, args })
  })
}
