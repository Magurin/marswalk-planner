//! Background warm-up of the tiles the planner shows around Jezero.
//!
//! Mirrors the layers in app/src/components/MapView.jsx. Grid is Leaflet's
//! L.CRS.EPSG4326: at zoom z there are 2^(z+1) columns and 2^z rows,
//!   x = floor((lon / 180 + 1) * 2^z),  y = floor((0.5 - lat / 180) * 2^z).
//! Jobs run lowest zoom first, nearest to the site first, so the wide view is
//! ready within seconds and detail fills in after.

use std::sync::{Arc, atomic::Ordering::Relaxed};

use futures::StreamExt;

use crate::{App, Priority};

const SITE: (f64, f64) = (77.45, 18.445); // lon, lat
const WORLD: [f64; 4] = [-180.0, -90.0, 180.0, 90.0];
const REGION: [f64; 4] = [70.0, 12.0, 85.0, 25.0];
const CTX_BLOCK: [f64; 4] = [75.154, 15.906, 78.872, 19.445];
const CTX_6M: [f64; 4] = [77.1605, 18.2111, 77.6991, 18.7211];
const HIRISE: [f64; 4] = [77.223, 18.3068, 77.5839, 18.6693];

struct Plan {
    id: &'static str,
    ext: &'static str,
    zooms: std::ops::RangeInclusive<u8>,
    bbox: [f64; 4], // west, south, east, north
}

fn plans(hirise_max: u8) -> Vec<Plan> {
    vec![
        Plan { id: "Mars_Viking_MDIM21_ClrMosaic_global_232m", ext: "jpg", zooms: 0..=4, bbox: WORLD },
        Plan { id: "Mars_Viking_MDIM21_ClrMosaic_global_232m", ext: "jpg", zooms: 5..=7, bbox: REGION },
        Plan { id: "Jezero_CTX_BlockAdj_dd", ext: "png", zooms: 5..=10, bbox: CTX_BLOCK },
        Plan { id: "JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0", ext: "png", zooms: 8..=13, bbox: CTX_6M },
        Plan { id: "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", ext: "png", zooms: 12..=hirise_max, bbox: HIRISE },
        // Overlays from the layer panel: whole planet for the zoomed-out view, the wider
        // region up to their native zoom, so zooming out from Jezero shows no holes.
        Plan { id: "Mars_MGS_MOLA_ClrShade_merge_global_463m", ext: "jpg", zooms: 0..=4, bbox: WORLD },
        Plan { id: "Mars_MGS_MOLA_ClrShade_merge_global_463m", ext: "jpg", zooms: 5..=7, bbox: REGION },
        Plan { id: "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", ext: "png", zooms: 0..=4, bbox: WORLD },
        Plan { id: "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", ext: "png", zooms: 5..=9, bbox: REGION },
        Plan { id: "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", ext: "png", zooms: 0..=4, bbox: WORLD },
        Plan { id: "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", ext: "png", zooms: 5..=9, bbox: REGION },
    ]
}

fn col(lon: f64, z: u8) -> u32 {
    let n = 1u64 << (z + 1);
    (((lon / 180.0 + 1.0) * (1u64 << z) as f64).floor() as i64).clamp(0, n as i64 - 1) as u32
}

fn row(lat: f64, z: u8) -> u32 {
    let n = 1u64 << z;
    (((0.5 - lat / 180.0) * n as f64).floor() as i64).clamp(0, n as i64 - 1) as u32
}

struct Job {
    z: u8,
    dist: u64,
    key: String,
}

fn jobs(hirise_max: u8) -> Vec<Job> {
    let mut out = Vec::new();
    for p in plans(hirise_max) {
        let [w, s, e, n] = p.bbox;
        for z in p.zooms.clone() {
            let (cx, cy) = (col(SITE.0, z) as i64, row(SITE.1, z) as i64);
            for y in row(n, z)..=row(s, z) {
                for x in col(w, z)..=col(e, z) {
                    let (dx, dy) = (x as i64 - cx, y as i64 - cy);
                    out.push(Job {
                        z,
                        dist: (dx * dx + dy * dy) as u64,
                        key: format!("{}/1.0.0/default/default028mm/{z}/{y}/{x}.{}", p.id, p.ext),
                    });
                }
            }
        }
    }
    out.sort_by_key(|j| (j.z, j.dist));
    out
}

pub async fn run(app: Arc<App>, hirise_max: u8, conns: usize) {
    let all = jobs(hirise_max);
    let total = all.len() as u64;
    app.stats.prefetch_total.store(total, Relaxed);
    println!("prefetch: {total} tiles planned (HiRISE up to z{hirise_max}, {conns} connections)");

    // Twice the upstream slots, so disk checks never leave a slot idle.
    futures::stream::iter(all)
        .for_each_concurrent(conns * 2, |job| {
            let app = app.clone();
            async move {
                if !app.is_cached(&job.key).await {
                    let _ = app.get(job.key, Priority::Background).await;
                }
                let done = app.stats.prefetch_done.fetch_add(1, Relaxed) + 1;
                if done % 500 == 0 || done == total {
                    println!("prefetch: {done}/{total} (z{})", job.z);
                }
            }
        })
        .await;
    println!("prefetch: done");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_matches_trek() {
        // Verified by hand against trek.nasa.gov (all return 200).
        assert_eq!((col(SITE.0, 10), row(SITE.1, 10)), (1464, 407));
        assert_eq!((col(SITE.0, 14), row(SITE.1, 14)), (23433, 6513));
        assert_eq!((col(180.0, 0), row(-90.0, 0)), (1, 0));
    }

    #[test]
    fn plan_size_is_sane() {
        let n = jobs(15).len();
        assert!(n > 1_000 && n < 30_000, "{n}");
    }
}
