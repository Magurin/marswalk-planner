"""Prepare offline snapshots for the Marswalk planner.

Inputs (all public NASA / USGS products):
  - data/raw/jezero_ctx_dtm_20m.tif  MRO CTX stereo DTM, 20 m/px, tied to MGS MOLA (USGS Astrogeology, Mars 2020 TRN)
  - Mars 2020 rover + Ingenuity localization (mars.nasa.gov MMGIS feeds)
  - M2020 MEDA and MSL REMS weather feeds (mars.nasa.gov)
  - data/raw/jezero_themis_ti.tif    THEMIS-derived thermal inertia of Jezero, 100 m/px (Edwards & Buz 2021, Zenodo 4931348)
  - data/raw/jezero_hirise_dtm_1m.tif  MRO HiRISE stereo DTM mosaic, 1 m/px (USGS Astrogeology, Mars 2020 TRN)

Outputs of dem, rover and weather go to web/data/. The app also tries the live feeds at runtime and
falls back to these snapshots when offline. The ground and fine steps write straight to app/public/data/.
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "data"
OUT.mkdir(parents=True, exist_ok=True)

R_MARS = 3396190.0
M_PER_DEG = R_MARS * np.pi / 180.0

FEEDS = {
    "waypoints": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json",
    "traverse": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json",
    "heli": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/m20_heli_waypoints.json",
    "meda": "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json",
    "rems": "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "marswalk-planner"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def dem():
    src = rasterio.open(RAW / "jezero_ctx_dtm_20m.tif")
    a = src.read(1).astype(np.float64)
    nod = src.nodata
    bad = ~np.isfinite(a) | (a == nod) | (a < -1e5)
    offset = -3000.0
    scale = 0.05  # 5 cm quantization
    q = np.round((a - offset) / scale)
    q[bad] = 0
    q = np.clip(q, 0, 65535).astype("<u2")
    q.tofile(OUT / "jezero_dem.u16")
    b = src.bounds
    meta = {
        "source": "MRO CTX stereo DTM (JEZ_ctx_B_soc_008), 20 m/px, MOLA-referenced, USGS Astrogeology",
        "width": src.width,
        "height": src.height,
        "west": b.left / M_PER_DEG,
        "east": b.right / M_PER_DEG,
        "south": b.bottom / M_PER_DEG,
        "north": b.top / M_PER_DEG,
        "cell_m": src.res[0],
        "offset": offset,
        "scale": scale,
        "nodata": 0,
        "min": float(a[~bad].min()),
        "max": float(a[~bad].max()),
    }
    (OUT / "jezero_dem.json").write_text(json.dumps(meta, indent=1))
    print("dem", meta)


def r6(c):
    return [round(c[0], 6), round(c[1], 6)]


def rover():
    wp = get(FEEDS["waypoints"])
    pts = []
    for f in wp["features"]:
        p = f["properties"]
        pts.append({
            "sol": p["sol"], "lon": round(p["lon"], 6), "lat": round(p["lat"], 6),
            "elev": round(p["elev_geoid"], 1), "tilt": round(p.get("tilt") or 0, 1),
            "yaw": round(p.get("yaw") or 0, 1), "km": p.get("dist_km"),
            "note": p.get("Note") or "",
        })
    tr = get(FEEDS["traverse"])
    segs = []
    for f in tr["features"]:
        g = f["geometry"]
        lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for ln in lines:
            segs.append({"sol": f["properties"].get("sol"), "c": [r6(c) for c in ln]})
    he = get(FEEDS["heli"])
    flights = []
    for f in he["features"]:
        p = f["properties"]
        flights.append({
            "flight": p.get("Flight"), "sol": p.get("Sol"), "lon": round(p["Lon"], 6), "lat": round(p["Lat"], 6),
            "elev": p.get("Elev_Geoid"), "dist_m": p.get("Dist_m"), "alt_m": p.get("Max_Alt_m"),
            "dur_s": p.get("Duration_s"),
        })
    json.dump({"waypoints": pts, "traverse": segs, "heli": flights}, open(OUT / "m20.json", "w"), separators=(",", ":"))
    print("rover", len(pts), "waypoints,", len(segs), "segments,", len(flights), "flights, last sol", pts[-1]["sol"])


def weather():
    meda = get(FEEDS["meda"])
    rems = get(FEEDS["rems"])

    def num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    soles = [{
        "sol": int(s["sol"]), "date": s["terrestrial_date"], "ls": num(s["ls"]),
        "tmin": num(s["min_temp"]), "tmax": num(s["max_temp"]), "p": num(s["pressure"]),
        "gmin": num(s["min_gts_temp"]), "gmax": num(s["max_gts_temp"]),
        "op": s.get("atmo_opacity"), "uv": s.get("local_uv_irradiance_index"),
        "rise": s.get("sunrise"), "set": s.get("sunset"),
    } for s in rems["soles"]]
    json.dump({"meda": meda, "rems": soles}, open(OUT / "weather.json", "w"), separators=(",", ":"))
    print("weather: meda", len(meda["sols"]), "sols, rems", len(soles), "sols, newest", soles[0]["date"])


APP = ROOT / "app" / "public" / "data"


def ctx_grid():
    """The 20 m CTX grid every other layer is resampled to: (transform, width, height)."""
    src = rasterio.open(RAW / "jezero_ctx_dtm_20m.tif")
    return src.transform, src.width, src.height


def add_layer(name, info):
    meta_path = APP / "jezero_dem.json"
    meta = json.loads(meta_path.read_text())
    meta.setdefault("layers", {})[name] = info
    meta_path.write_text(json.dumps(meta, indent=1))


def ground():
    """Thermal inertia on the CTX grid, one byte per cell: TI / 4, 0 where unknown."""
    tr, W, H = ctx_grid()
    src = rasterio.open(RAW / "jezero_themis_ti.tif")
    ti = src.read(1).astype(np.float64)
    # Centres of the CTX cells in the map projection both rasters share (equirectangular, metres).
    xs = tr.c + (np.arange(W) + 0.5) * tr.a
    ys = tr.f + (np.arange(H) + 0.5) * tr.e
    # Bilinear between the centres of the 100 m pixels, ignoring empty ones: a 100 m staircase in the map would
    # become a staircase in every route that leans away from loose ground.
    fx = (xs - src.transform.c) / src.transform.a - 0.5
    fy = (ys - src.transform.f) / src.transform.e - 0.5
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    wx, wy = fx - x0, fy - y0
    num, den = np.zeros((H, W)), np.zeros((H, W))
    for dy, ky in ((0, 1 - wy), (1, wy)):
        for dx, kx in ((0, 1 - wx), (1, wx)):
            r, c = y0 + dy, x0 + dx
            ok = ((r >= 0) & (r < src.height))[:, None] & ((c >= 0) & (c < src.width))[None, :]
            v = ti[np.clip(r, 0, src.height - 1)[:, None], np.clip(c, 0, src.width - 1)[None, :]]
            k = ky[:, None] * kx[None, :] * (ok & (v > 0))
            num += k * v
            den += k
    out = np.where(den > 0.25, num / np.maximum(den, 1e-9), 0)
    known = out > 0
    q = np.where(known, np.clip(np.round(out / 4), 1, 255), 0).astype("u1")
    q.tofile(APP / "jezero_ti.u8")
    info = {
        "file": "jezero_ti.u8", "scale": 4, "median": float(np.median(out[known])),
        "source": "THEMIS-derived thermal inertia of Jezero Crater, 100 m/px, Edwards & Buz (2021), doi:10.5281/zenodo.4931348",
    }
    add_layer("ti", info)
    print("ground", info, "coverage %.1f%%" % (100 * known.mean()), "percentiles 5/25/50/75/95", np.percentile(out[known], [5, 25, 50, 75, 95]).round())


def fine():
    """Step-scale slope inside each CTX cell, from the 1 m HiRISE DTM: one byte per cell, half degrees, 255 where unknown.

    The 1 m model is averaged to 2 m posts (its own noise is a few decimetres), slopes are taken between neighbouring
    posts, and a cell keeps the median of its hundred values: the slope under a typical step there. The 20 m model
    smooths a boulder field, a dune field or a small crater into a gentle average; this number does not.
    """
    from rasterio.windows import Window
    tr, W, H = ctx_grid()
    hi = rasterio.open(RAW / "jezero_hirise_dtm_1m.tif")
    G, K = 2, 10  # post spacing in metres, posts per cell side
    ox = round(tr.c - hi.bounds.left)  # HiRISE column of the west edge of CTX column 0
    oy = round(hi.bounds.top - tr.f)   # HiRISE row of the north edge of CTX row 0
    c_lo, c_hi = int(np.ceil(-ox / 20)), (hi.width - ox) // 20
    r_lo, r_hi = int(np.ceil(-oy / 20)), (hi.height - oy) // 20
    out = np.full((H, W), 255, "u1")
    BAND = 100
    for r0 in range(r_lo, r_hi, BAND):
        r1 = min(r_hi, r0 + BAND)
        # One post of margin above and below, so the slope at the edge of the band has both neighbours.
        y0, y1 = max(0, r0 * 20 + oy - G), min(hi.height, r1 * 20 + oy + G)
        top, bottom = (r0 * 20 + oy - y0) // G, (y1 - (r1 * 20 + oy)) // G
        a = hi.read(1, window=Window(c_lo * 20 + ox, y0, (c_hi - c_lo) * 20, y1 - y0)).astype(np.float64)
        a[~np.isfinite(a) | (a < -1e5)] = np.nan
        posts = a.reshape(a.shape[0] // G, G, a.shape[1] // G, G).mean(axis=(1, 3))
        dy, dx = np.gradient(posts, float(G))
        sl = np.degrees(np.arctan(np.hypot(dx, dy)))[top:posts.shape[0] - bottom]
        cells = sl.reshape(sl.shape[0] // K, K, sl.shape[1] // K, K).transpose(0, 2, 1, 3).reshape(sl.shape[0] // K, sl.shape[1] // K, K * K)
        enough = np.isfinite(cells).mean(axis=2) >= 0.5
        with np.errstate(all="ignore"):
            med = np.nanmedian(cells, axis=2)
        q = np.where(enough, np.clip(np.round(med * 2), 0, 254), 255).astype("u1")
        out[r0:r1, c_lo:c_hi] = q
        print("fine rows", r0, "-", r1, flush=True)
    out.tofile(APP / "jezero_fine.u8")
    info = {
        "file": "jezero_fine.u8", "scale": 0.5,
        "source": "MRO HiRISE stereo DTM mosaic (JEZ_hirise_soc_006), 1 m/px, USGS Astrogeology: median slope between 2 m posts in each 20 m cell",
    }
    add_layer("fine", info)
    known = out != 255
    print("fine", info, "coverage %.1f%%" % (100 * known.mean()), "percentiles 50/90/99 deg", np.percentile(out[known], [50, 90, 99]) / 2)


if __name__ == "__main__":
    steps = sys.argv[1:] or ["dem", "rover", "weather"]
    for s in steps:
        {"dem": dem, "rover": rover, "weather": weather, "ground": ground, "fine": fine}[s]()
