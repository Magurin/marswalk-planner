"""Prepare offline snapshots for the Marswalk planner.

Inputs (all public NASA / USGS products):
  - data/raw/jezero_ctx_dtm_20m.tif  MRO CTX stereo DTM, 20 m/px, tied to MGS MOLA (USGS Astrogeology, Mars 2020 TRN)
  - Mars 2020 rover + Ingenuity localization (mars.nasa.gov MMGIS feeds)
  - M2020 MEDA and MSL REMS weather feeds (mars.nasa.gov)

Outputs go to web/data/. The app also tries the live feeds at runtime and
falls back to these snapshots when offline.
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


if __name__ == "__main__":
    steps = sys.argv[1:] or ["dem", "rover", "weather"]
    for s in steps:
        {"dem": dem, "rover": rover, "weather": weather}[s]()
