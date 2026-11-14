// Terrain engine on the MRO CTX 20 m DTM: elevation, slope, sun shadows, line-of-sight and least-time routing.
export const M_PER_DEG = (3396190 * Math.PI) / 180;
const D2R = Math.PI / 180;

export const SLOPE_CLASSES = [
  { max: 5, color: [46, 204, 113], label: '0-5°', note: 'easy going' },
  { max: 10, color: [163, 217, 82], label: '5-10°', note: 'moderate' },
  { max: 15, color: [255, 209, 59], label: '10-15°', note: 'slow, watch your footing' },
  { max: 20, color: [255, 140, 40], label: '15-20°', note: 'at the suit limit' },
  { max: 30, color: [235, 59, 59], label: '20-30°', note: 'not on foot' },
  { max: 91, color: [176, 48, 190], label: 'over 30°', note: 'cliff, scarp' },
];
export const slopeClass = (deg) => SLOPE_CLASSES.findIndex((c) => deg < c.max);

export class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const key = k.pop(), val = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    return top;
  }
}

export class Terrain {
  static async load(base) {
    const [meta, buf] = await Promise.all([
      fetch(`${base}.json`).then((r) => r.json()),
      fetch(`${base}.u16`).then((r) => r.arrayBuffer()),
    ]);
    return new Terrain(meta, new Uint16Array(buf));
  }

  constructor(meta, raw) {
    this.meta = meta;
    const W = (this.W = meta.width), H = (this.H = meta.height);
    this.lat0 = (meta.north + meta.south) / 2;
    this.dx = meta.cell_m * Math.cos(this.lat0 * D2R); // true ground size of a cell, east-west
    this.dy = meta.cell_m;
    const z = (this.z = new Float32Array(W * H));
    for (let i = 0; i < z.length; i++) z[i] = raw[i] === meta.nodata ? NaN : raw[i] * meta.scale + meta.offset;
    // Horn gradients (rise per metre toward east and toward north) and slope in degrees
    const gx = (this.gx = new Float32Array(W * H)), gy = (this.gy = new Float32Array(W * H));
    const sl = (this.slope = new Float32Array(W * H));
    for (let r = 0; r < H; r++) {
      const ru = Math.max(0, r - 1), rd = Math.min(H - 1, r + 1);
      for (let c = 0; c < W; c++) {
        const cl = Math.max(0, c - 1), cr = Math.min(W - 1, c + 1);
        const a = z[ru * W + cl], b = z[ru * W + c], cc = z[ru * W + cr];
        const d = z[r * W + cl], f = z[r * W + cr];
        const g = z[rd * W + cl], h = z[rd * W + c], k = z[rd * W + cr];
        const ex = (cc + 2 * f + k - (a + 2 * d + g)) / (8 * this.dx);
        const en = (a + 2 * b + cc - (g + 2 * h + k)) / (8 * this.dy);
        const i = r * W + c;
        gx[i] = ex; gy[i] = en;
        sl[i] = Math.atan(Math.hypot(ex, en)) / D2R;
      }
    }
    this.bounds = [[meta.south, meta.west], [meta.north, meta.east]];
  }

  col(lon) { return ((lon - this.meta.west) / (this.meta.east - this.meta.west)) * this.W - 0.5; }
  row(lat) { return ((this.meta.north - lat) / (this.meta.north - this.meta.south)) * this.H - 0.5; }
  lon(c) { return this.meta.west + ((c + 0.5) / this.W) * (this.meta.east - this.meta.west); }
  lat(r) { return this.meta.north - ((r + 0.5) / this.H) * (this.meta.north - this.meta.south); }
  inside(lon, lat) { const c = this.col(lon), r = this.row(lat); return c >= 0 && r >= 0 && c <= this.W - 1 && r <= this.H - 1; }

  sample(arr, lon, lat) {
    const c = this.col(lon), r = this.row(lat);
    if (!(c >= 0 && r >= 0 && c <= this.W - 1 && r <= this.H - 1)) return NaN;
    const c0 = Math.min(this.W - 2, Math.floor(c)), r0 = Math.min(this.H - 2, Math.floor(r));
    const fc = c - c0, fr = r - r0, i = r0 * this.W + c0;
    return (arr[i] * (1 - fc) + arr[i + 1] * fc) * (1 - fr) + (arr[i + this.W] * (1 - fc) + arr[i + this.W + 1] * fc) * fr;
  }
  elevAt(lon, lat) { return this.sample(this.z, lon, lat); }
  slopeAt(lon, lat) { return this.sample(this.slope, lon, lat); }

  static dist(a, b) { // metres between [lon, lat] pairs, local flat approximation (fine at EVA scale)
    const x = (b[0] - a[0]) * M_PER_DEG * Math.cos(((a[1] + b[1]) / 2) * D2R), y = (b[1] - a[1]) * M_PER_DEG;
    return Math.hypot(x, y);
  }

  canvas(fill) {
    const cv = document.createElement('canvas');
    cv.width = this.W; cv.height = this.H;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(this.W, this.H);
    fill(img.data);
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  slopeCanvas() {
    return this.canvas((px) => {
      for (let i = 0; i < this.slope.length; i++) {
        const s = this.slope[i];
        if (!(s >= 0)) continue;
        const k = slopeClass(s), col = SLOPE_CLASSES[k].color;
        px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2];
        px[i * 4 + 3] = k === 0 ? 40 : 150 + k * 15;
      }
    });
  }

  // The plain arrays shadePixels needs, in a form that can be posted to a worker.
  shadeGrid() {
    const { W, H, z, gx, gy, dx, dy } = this;
    return { W, H, z, gx, gy, dx, dy, zmax: this.meta.max };
  }

  shadeCanvas(sun) {
    return this.canvas((px) => shadePixels(this.shadeGrid(), sun, px));
  }

  // Is this point in the shadow of the terrain (or is the sun down)? null outside the model.
  inShadow(lon, lat, sun) {
    const c = Math.round(this.col(lon)), r = Math.round(this.row(lat));
    if (c < 0 || r < 0 || c >= this.W || r >= this.H) return null;
    const z0 = this.z[r * this.W + c];
    if (!(z0 === z0)) return null;
    if (sun.u <= 0) return true;
    return castShadow(this.shadeGrid(), c, r, z0, sun);
  }

  // Radio line-of-sight from a mast at the base to a suit antenna. vis: 0 unknown, 1 visible, 2 blocked.
  viewshed(lon, lat, mastM = 10, suitM = 1.8, radiusM = 12000) {
    const { W, H, z, dx, dy } = this;
    const c0 = Math.round(this.col(lon)), r0 = Math.round(this.row(lat));
    const vis = new Uint8Array(W * H);
    if (c0 < 0 || r0 < 0 || c0 >= W || r0 >= H) return { vis, radiusM, lon, lat };
    const zb = z[r0 * W + c0] + mastM;
    const R = Math.round(radiusM / dx);
    vis[r0 * W + c0] = 1;
    const ray = (tc, tr) => {
      const n = Math.max(Math.abs(tc), Math.abs(tr));
      const sc = tc / n, sr = tr / n;
      let maxG = -Infinity;
      for (let s = 1; s <= n; s++) {
        const c = Math.round(c0 + sc * s), r = Math.round(r0 + sr * s);
        if (c < 0 || r < 0 || c >= W || r >= H) return;
        const d = Math.hypot(sc * s * dx, sr * s * dy);
        if (d > radiusM) return;
        const i = r * W + c, zz = z[i];
        if (!(zz === zz)) return;
        if ((zz + suitM - zb) / d >= maxG) vis[i] = 1; else if (vis[i] === 0) vis[i] = 2;
        const g = (zz - zb) / d;
        if (g > maxG) maxG = g;
      }
    };
    for (let t = -R; t <= R; t++) { ray(t, -R); ray(t, R); ray(-R, t); ray(R, t); }
    return { vis, radiusM, lon, lat };
  }

  viewshedCanvas(vs) {
    return this.canvas((px) => {
      for (let i = 0; i < vs.vis.length; i++) {
        if (vs.vis[i] === 2) { px[i * 4] = 120; px[i * 4 + 1] = 40; px[i * 4 + 2] = 160; px[i * 4 + 3] = 135; }
      }
    });
  }

  losAt(vs, lon, lat) {
    if (!vs) return null;
    const c = Math.round(this.col(lon)), r = Math.round(this.row(lat));
    if (c < 0 || r < 0 || c >= this.W || r >= this.H) return null;
    const v = vs.vis[r * this.W + c];
    return v === 0 ? null : v === 1;
  }

  // Connected areas of ground that can be walked (slope within the limit, elevation known): a label above zero per cell.
  // A path can only join two cells with the same label. The start and the goal themselves may be steeper, see route().
  // Kept for the last slope limit asked for; a full pass over the grid takes about a tenth of a second.
  walkable(maxSlope) {
    if (this._comp?.maxSlope === maxSlope) return this._comp.labels;
    const { W, H, z, slope } = this, n = W * H;
    const labels = new Int32Array(n), stack = new Int32Array(n);
    const open = (i) => labels[i] === 0 && z[i] === z[i] && slope[i] <= maxSlope;
    let next = 0;
    for (let s = 0; s < n; s++) {
      if (!open(s)) continue;
      let top = 0;
      labels[s] = ++next; stack[top++] = s;
      while (top) {
        const i = stack[--top], c = i % W, r = (i / W) | 0;
        for (let dr = -1; dr <= 1; dr++) {
          const r2 = r + dr;
          if (r2 < 0 || r2 >= H) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const c2 = c + dc;
            if (c2 < 0 || c2 >= W) continue;
            const j = r2 * W + c2;
            if (open(j)) { labels[j] = next; stack[top++] = j; }
          }
        }
      }
    }
    this._comp = { maxSlope, labels };
    return labels;
  }

  // Least-time path between two [lon, lat] points with A* on the 20 m grid.
  // speed(grade) gives m/s for a signed grade (rise over run); cells steeper than maxSlope are closed.
  route(a, b, { speed, vmax, maxSlope = 20, hazard = 1.5, limit = 900000 }) {
    const { W, H, z, slope, dx, dy } = this;
    const ca = Math.round(this.col(a[0])), ra = Math.round(this.row(a[1]));
    const cb = Math.round(this.col(b[0])), rb = Math.round(this.row(b[1]));
    const ok = (c, r) => c >= 0 && r >= 0 && c < W && r < H;
    if (!ok(ca, ra) || !ok(cb, rb)) return null;
    const start = ra * W + ca, goal = rb * W + cb;
    if (start === goal) return [a, b];
    // No way through at all (a stop on the floor of a small crater ringed by steep walls): answer at once.
    // Without this the search would visit every cell it can reach, the better part of a second, before giving up.
    // The labels are prepared in idle time (see the store); until they are ready the search simply runs as before.
    const comp = this._comp?.maxSlope === maxSlope ? this._comp.labels : null;
    if (comp) {
      const near = (i) => {
        const out = [];
        if (comp[i] > 0) out.push(comp[i]);
        else for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const c = (i % W) + dc, r = ((i / W) | 0) + dr;
          if (ok(c, r) && comp[r * W + c] > 0) out.push(comp[r * W + c]);
        }
        return out;
      };
      const cs = near(start), cg = near(goal);
      if (!cs.some((k) => cg.includes(k))) return null;
    }
    const g = (this._g ||= new Float32Array(W * H)); g.fill(Infinity);
    const from = (this._from ||= new Int32Array(W * H));
    const closed = (this._closed ||= new Uint8Array(W * H)); closed.fill(0);
    const dd = Math.hypot(dx, dy);
    const nb = [[1, 0, dx], [-1, 0, dx], [0, 1, dy], [0, -1, dy], [1, 1, dd], [1, -1, dd], [-1, 1, dd], [-1, -1, dd]];
    const h = (i) => Math.hypot(((i % W) - cb) * dx, (((i / W) | 0) - rb) * dy) / vmax;
    const heap = new Heap();
    g[start] = 0; from[start] = -1; heap.push(h(start), start);
    let n = 0, found = false;
    while (heap.size) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === goal) { found = true; break; }
      if (++n > limit) break;
      const c = i % W, r = (i / W) | 0, zi = z[i];
      for (const [dc, dr, d] of nb) {
        const c2 = c + dc, r2 = r + dr;
        if (!ok(c2, r2)) continue;
        const j = r2 * W + c2;
        if (closed[j]) continue;
        const zj = z[j], sj = slope[j];
        if (!(zj === zj)) continue;
        if (sj > maxSlope && j !== goal) continue;
        const pen = 1 + hazard * (sj / maxSlope) * (sj / maxSlope);
        const t = g[i] + (d / speed((zj - zi) / d)) * pen;
        if (t < g[j]) { g[j] = t; from[j] = i; heap.push(t + h(j), j); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => [this.lon(i % W), this.lat((i / W) | 0)]);
    pts[0] = a; pts[pts.length - 1] = b;
    return simplify(pts, 6);
  }
}

// March from cell (c, r) toward the sun until the ray clears the highest point of the model.
function castShadow({ W, H, z, dx, dy, zmax }, c, r, z0, sun) {
  const hlen = Math.hypot(sun.e, sun.n) || 1e-6;
  const tanEl = sun.u / hlen;
  const sc = sun.e / hlen / dx, sr = -sun.n / hlen / dy; // grid step per metre toward the sun
  // A NaN anywhere would never meet the exit tests below and loop forever.
  if (!Number.isFinite(tanEl + sc + sr + z0)) return false;
  for (let d = 30; d < 1e7; d *= 1.18) {
    const need = z0 + d * tanEl;
    if (need > zmax) return false;
    const cc = Math.round(c + sc * d), rr = Math.round(r + sr * d);
    if (!(cc >= 0 && rr >= 0 && cc < W && rr < H)) return false;
    if (z[rr * W + cc] > need + 1.5) return true;
  }
  return false;
}

// Hillshade with cast shadows for a sun unit vector (east, north, up), written as RGBA into px.
// Takes about 0.3 s for the Jezero grid, so the map runs it in a worker (shade.worker.js).
export function shadePixels(grid, sun, px) {
  const { W, H, z, gx, gy } = grid;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c, z0 = z[i];
      if (!(z0 === z0)) continue;
      let a;
      if (sun.u <= 0) a = 0.8;
      else {
        if (castShadow(grid, c, r, z0, sun)) a = 0.72;
        else {
          const nrm = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i] + 1);
          const ill = Math.max(0, (-gx[i] * sun.e - gy[i] * sun.n + sun.u) / nrm);
          a = 0.62 * (1 - Math.min(1, ill));
        }
      }
      px[i * 4] = 8; px[i * 4 + 1] = 12; px[i * 4 + 2] = 30; px[i * 4 + 3] = a * 255;
    }
  }
  return px;
}

// Douglas-Peucker in local metres
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const k = Math.cos(pts[0][1] * D2R) * M_PER_DEG;
  const X = pts.map((p) => [p[0] * k, p[1] * M_PER_DEG]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [x0, y0] = X[i0], [x1, y1] = X[i1];
    const L = Math.hypot(x1 - x0, y1 - y0) || 1e-9;
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((x1 - x0) * (y0 - X[i][1]) - (x0 - X[i][0]) * (y1 - y0)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
