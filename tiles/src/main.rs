//! Caching tile proxy for NASA Mars Trek.
//!
//! trek.nasa.gov serves tiles over HTTP/1.1 only, without Cache-Control, at
//! 1-4 s per tile. The browser opens at most 6 connections per host, so a map
//! with four stacked layers waits tens of seconds. This proxy:
//!   - keeps every tile on disk forever (tiles are immutable),
//!   - remembers 404s, so out-of-coverage tiles are answered instantly,
//!   - merges concurrent requests for the same tile into one upstream fetch,
//!   - fetches upstream over many parallel connections,
//!   - warms the cache for the Jezero area in the background (see prefetch.rs),
//!   - answers with `Cache-Control: immutable`, so the browser never asks twice.
//!
//! GET /trek/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.{png|jpg}
//! GET /health

mod prefetch;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering::Relaxed},
    },
    time::Duration,
};

use axum::{
    Router,
    extract::{Path, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use bytes::Bytes;
use futures::future::{BoxFuture, FutureExt, Shared};
use tokio::sync::Semaphore;

const UPSTREAM: &str = "https://trek.nasa.gov/tiles/Mars/EQ";

#[derive(Clone)]
pub enum Tile {
    Hit(Bytes),
    Missing,
}

type Fetch = Shared<BoxFuture<'static, Result<Tile, String>>>;

#[derive(Default)]
pub struct Stats {
    pub disk_hits: AtomicU64,
    pub upstream_ok: AtomicU64,
    pub upstream_404: AtomicU64,
    pub upstream_err: AtomicU64,
    pub prefetch_total: AtomicU64,
    pub prefetch_done: AtomicU64,
}

pub struct App {
    client: reqwest::Client,
    cache_dir: PathBuf,
    inflight: Mutex<HashMap<String, Fetch>>,
    /// Upstream slots for tiles the browser is waiting on.
    live: Arc<Semaphore>,
    /// Separate, smaller pool for background warm-up, so it never starves the map.
    background: Arc<Semaphore>,
    pub stats: Stats,
}

#[derive(Clone, Copy)]
pub enum Priority {
    Live,
    Background,
}

impl App {
    fn path_for(&self, key: &str) -> PathBuf {
        self.cache_dir.join(key)
    }

    fn missing_marker(&self, key: &str) -> PathBuf {
        self.cache_dir.join(format!("{key}.404"))
    }

    pub async fn is_cached(&self, key: &str) -> bool {
        tokio::fs::try_exists(self.path_for(key)).await.unwrap_or(false)
            || tokio::fs::try_exists(self.missing_marker(key)).await.unwrap_or(false)
    }

    async fn from_disk(&self, key: &str) -> Option<Tile> {
        if let Ok(b) = tokio::fs::read(self.path_for(key)).await {
            return Some(Tile::Hit(b.into()));
        }
        if tokio::fs::try_exists(self.missing_marker(key)).await.unwrap_or(false) {
            return Some(Tile::Missing);
        }
        None
    }

    pub async fn get(self: &Arc<Self>, key: String, prio: Priority) -> Result<Tile, String> {
        if let Some(t) = self.from_disk(&key).await {
            self.stats.disk_hits.fetch_add(1, Relaxed);
            return Ok(t);
        }
        let fut = {
            let mut map = self.inflight.lock().unwrap();
            map.entry(key.clone())
                .or_insert_with(|| {
                    let app = self.clone();
                    let k = key.clone();
                    // Own task, not driven by the waiters: Leaflet cancels tile requests on
                    // pan and zoom, and a fetch nobody polls any more would keep its upstream
                    // slot forever, until every slot is stuck and nothing new loads.
                    // The task removes itself only after this lock is released.
                    let task = tokio::spawn(async move {
                        let r = app.fetch_and_store(&k, prio).await;
                        app.inflight.lock().unwrap().remove(&k);
                        r
                    });
                    async move { task.await.unwrap_or_else(|e| Err(e.to_string())) }
                        .boxed()
                        .shared()
                })
                .clone()
        };
        fut.await
    }

    async fn fetch_and_store(&self, key: &str, prio: Priority) -> Result<Tile, String> {
        let sem = match prio {
            Priority::Live => &self.live,
            Priority::Background => &self.background,
        };
        let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
        // Another request may have finished this tile while we queued.
        if let Some(t) = self.from_disk(key).await {
            return Ok(t);
        }
        let url = format!("{UPSTREAM}/{key}");
        let mut last_err = String::new();
        for attempt in 0..3u32 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(400 * 2u64.pow(attempt))).await;
            }
            match self.client.get(&url).send().await {
                Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => {
                    self.stats.upstream_404.fetch_add(1, Relaxed);
                    write_atomic(&self.missing_marker(key), b"").await;
                    return Ok(Tile::Missing);
                }
                Ok(r) if r.status().is_success() => match r.bytes().await {
                    Ok(b) => {
                        self.stats.upstream_ok.fetch_add(1, Relaxed);
                        write_atomic(&self.path_for(key), &b).await;
                        return Ok(Tile::Hit(b));
                    }
                    Err(e) => last_err = e.to_string(),
                },
                Ok(r) => last_err = format!("upstream status {}", r.status()),
                Err(e) => last_err = e.to_string(),
            }
        }
        self.stats.upstream_err.fetch_add(1, Relaxed);
        Err(last_err)
    }
}

/// Write via a temp file and rename, so a crash never leaves a half tile in the cache.
async fn write_atomic(path: &std::path::Path, data: &[u8]) {
    if let Some(dir) = path.parent() {
        let _ = tokio::fs::create_dir_all(dir).await;
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    if tokio::fs::write(&tmp, data).await.is_ok() && tokio::fs::rename(&tmp, path).await.is_err() {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
}

/// Accept only `layer/.../z/y/x.png|jpg` made of safe characters.
fn valid_key(key: &str) -> bool {
    let ext_ok = key.ends_with(".png") || key.ends_with(".jpg") || key.ends_with(".jpeg");
    ext_ok
        && key.len() < 300
        && key.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
        && key.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-/".contains(&c))
}

fn content_type(key: &str) -> &'static str {
    if key.ends_with(".png") { "image/png" } else { "image/jpeg" }
}

async fn tile(State(app): State<Arc<App>>, Path(key): Path<String>) -> Response {
    if !valid_key(&key) {
        return (StatusCode::BAD_REQUEST, "bad tile path").into_response();
    }
    let mut res = match app.get(key.clone(), Priority::Live).await {
        Ok(Tile::Hit(b)) => {
            let mut r = b.into_response();
            r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type(&key)));
            r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
            r
        }
        Ok(Tile::Missing) => {
            let mut r = StatusCode::NOT_FOUND.into_response();
            r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400"));
            r
        }
        Err(e) => {
            eprintln!("upstream failed for {key}: {e}");
            let mut r = (StatusCode::BAD_GATEWAY, e).into_response();
            r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            r
        }
    };
    res.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    res
}

async fn health(State(app): State<Arc<App>>) -> Response {
    let s = &app.stats;
    let pairs = [
        ("disk_hits", s.disk_hits.load(Relaxed)),
        ("upstream_ok", s.upstream_ok.load(Relaxed)),
        ("upstream_404", s.upstream_404.load(Relaxed)),
        ("upstream_err", s.upstream_err.load(Relaxed)),
        ("prefetch_total", s.prefetch_total.load(Relaxed)),
        ("prefetch_done", s.prefetch_done.load(Relaxed)),
    ];
    let body = pairs.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect::<Vec<_>>().join(",");
    (
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        format!("{{\"ok\":true,{body}}}"),
    )
        .into_response()
}

struct Args {
    port: u16,
    cache: PathBuf,
    prefetch: bool,
    hirise_max: u8,
    /// Upstream connections for the background warm-up. Trek handles ~32-48 well (measured).
    warm_conns: usize,
}

fn parse_args() -> Args {
    let mut a = Args {
        port: 8787,
        cache: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("cache"),
        prefetch: true,
        hirise_max: 15,
        warm_conns: 32,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--port" => a.port = it.next().and_then(|v| v.parse().ok()).expect("--port <n>"),
            "--cache" => a.cache = it.next().map(PathBuf::from).expect("--cache <dir>"),
            "--no-prefetch" => a.prefetch = false,
            "--hirise-max" => a.hirise_max = it.next().and_then(|v| v.parse().ok()).expect("--hirise-max <zoom>"),
            "--warm-conns" => a.warm_conns = it.next().and_then(|v| v.parse().ok()).filter(|&n| n > 0).expect("--warm-conns <n>"),
            "-h" | "--help" => {
                println!("marswalk-tiles [--port 8787] [--cache DIR] [--no-prefetch] [--hirise-max 15] [--warm-conns 32]");
                std::process::exit(0);
            }
            other => panic!("unknown argument {other}"),
        }
    }
    a
}

#[tokio::main]
async fn main() {
    let args = parse_args();
    let client = reqwest::Client::builder()
        .user_agent("marswalk-tiles/0.1")
        .pool_max_idle_per_host(64)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("http client");
    let app = Arc::new(App {
        client,
        cache_dir: args.cache.clone(),
        inflight: Mutex::new(HashMap::new()),
        live: Arc::new(Semaphore::new(24)),
        background: Arc::new(Semaphore::new(args.warm_conns)),
        stats: Stats::default(),
    });

    if args.prefetch {
        tokio::spawn(prefetch::run(app.clone(), args.hirise_max, args.warm_conns));
    }

    let router = Router::new()
        .route("/trek/{*key}", get(tile))
        .route("/health", get(health))
        .with_state(app);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], args.port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    println!("marswalk-tiles on http://{addr}  cache {}", args.cache.display());
    axum::serve(listener, router).await.expect("serve");
}

#[cfg(test)]
mod tests {
    use super::valid_key;

    #[test]
    fn keys() {
        assert!(valid_key("Jezero_CTX_BlockAdj_dd/1.0.0/default/default028mm/10/280/1550.png"));
        assert!(!valid_key("../secret.png"));
        assert!(!valid_key("a//b.png"));
        assert!(!valid_key("a/b.txt"));
        assert!(!valid_key("a/b c.png"));
    }
}
