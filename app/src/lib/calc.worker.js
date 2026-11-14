// Heavy terrain searches off the main thread: the reach fields around the base and the auto planner.
import { Terrain } from './terrain.js'
import { reachFields, autoPlan } from './reach.js'

let terrain = null
const queue = []

const run = ({ id, type, args }) => {
  try {
    if (type === 'reach') {
      const r = reachFields(terrain, args.base, args.p)
      self.postMessage({ id, value: r }, [r.tOut.buffer, r.eOut.buffer, r.tBack.buffer, r.eBack.buffer])
    } else if (type === 'autoplan') {
      const value = autoPlan(terrain, args.base, args.cands, args.p, { ...args.opts, onProgress: (f) => self.postMessage({ id, progress: f }) })
      self.postMessage({ id, value })
    }
  } catch (e) {
    self.postMessage({ id, error: e.message })
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    terrain = await Terrain.load(data.args.url)
    while (queue.length) run(queue.shift())
    return
  }
  if (!terrain) queue.push(data)
  else run(data)
}
