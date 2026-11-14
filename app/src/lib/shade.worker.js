// Sun shadows off the main thread: the map stays responsive while the time slider is dragged.
import { shadePixels } from './terrain.js'

let grid = null
self.onmessage = ({ data }) => {
  if (data.grid) grid = data.grid
  if (!data.sun || !grid) return
  const px = shadePixels(grid, data.sun, new Uint8ClampedArray(grid.W * grid.H * 4))
  self.postMessage({ px }, [px.buffer])
}
