// Mars solar time and sun geometry after Allison & McEwen (2000), the algorithm behind NASA GISS Mars24.
const D2R = Math.PI / 180;
const sin = (d) => Math.sin(d * D2R);
const cos = (d) => Math.cos(d * D2R);
const mod = (a, n) => ((a % n) + n) % n;

const PBS = [
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095],
];
const TAI_UTC = 37; // leap seconds, valid since 2017
const M20_SOL0_MSD = 52304; // calibrated so the landing (2021-02-18 20:55 UTC) falls on sol 0

export function marsTime(date, lonE, lat) {
  const jdUT = date.getTime() / 86400000 + 2440587.5;
  const jdTT = jdUT + (TAI_UTC + 32.184) / 86400;
  const dt = jdTT - 2451545.0;
  const M = mod(19.3871 + 0.52402073 * dt, 360);
  const aFMS = mod(270.3871 + 0.524038496 * dt, 360);
  let pbs = 0;
  for (const [A, tau, phi] of PBS) pbs += A * cos((0.985626 * dt) / tau + phi);
  const nuM = (10.691 + 3.0e-7 * dt) * sin(M) + 0.623 * sin(2 * M) + 0.05 * sin(3 * M) + 0.005 * sin(4 * M) + 0.0005 * sin(5 * M) + pbs;
  const ls = mod(aFMS + nuM, 360);
  const eot = 2.861 * sin(2 * ls) - 0.071 * sin(4 * ls) + 0.002 * sin(6 * ls) - nuM; // degrees
  const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const mtc = mod(24 * msd, 24);
  const lmst = mod(mtc + lonE / 15, 24);
  const ltst = mod(lmst + eot / 15, 24);
  const decl = Math.asin(0.42565 * sin(ls)) / D2R + 0.25 * sin(ls);
  const cosH0 = -Math.tan(lat * D2R) * Math.tan(decl * D2R);
  const H0 = Math.acos(Math.max(-1, Math.min(1, cosH0))) / D2R;
  return {
    msd, mtc, lmst, ltst, ls, eot, decl,
    sunrise: 12 - H0 / 15, sunset: 12 + H0 / 15, // local true solar time, geometric horizon
    sol: Math.floor(msd + lonE / 360) - M20_SOL0_MSD,
    sun: sunAt(ltst, decl, lat),
  };
}

// Sun direction for a local true solar time. Returns elevation, azimuth (clockwise from north) and an east/north/up unit vector.
export function sunAt(ltst, decl, lat) {
  const H = 15 * (ltst - 12);
  const e = -cos(decl) * sin(H);
  const n = cos(lat) * sin(decl) - sin(lat) * cos(decl) * cos(H);
  const u = sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(H);
  return { el: Math.asin(u) / D2R, az: mod(Math.atan2(e, n) / D2R, 360), e, n, u };
}

export function seasonName(ls, north = true) {
  // Season of the chosen hemisphere, in Russian: early / middle / late part of it.
  const seasons = north ? [0, 1, 2, 3] : [2, 3, 0, 1];
  const NAMES = [
    ['early spring', 'mid spring', 'late spring'],
    ['early summer', 'mid summer', 'late summer'],
    ['early autumn', 'mid autumn', 'late autumn'],
    ['early winter', 'mid winter', 'late winter'],
  ];
  return NAMES[seasons[Math.floor(ls / 90) % 4]][Math.floor((ls % 90) / 30)];
}

export function fmtH(h) {
  h = mod(h, 24);
  let m = Math.round(h * 60);
  if (m === 1440) m = 0;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDur(hours) {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
