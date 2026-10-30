// Creates test GPX files in ./samples for the live demo race:
//   today-valid-run.gpx  - today's full distance, should be APPROVED
//   yesterday-run.gpx    - recorded yesterday, should be REJECTED (old run)
//   car-ride.gpx         - today, but at driving speed, should be REJECTED (vehicle)
// Run with: npm run sample-gpx   (re-run each day, since "today" changes)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DAY = 86_400_000;
const meta = JSON.parse(readFileSync(new URL('./demo-meta.json', import.meta.url)));
const start = Date.parse(`${meta.liveStart}T00:00:00Z`);
const now = Date.now();
const day = Math.floor((now - start) / DAY) + 1;
const dayStart = start + (day - 1) * DAY;

const CENTER = { lat: 40.7812, lon: -73.9665 }; // a loop around a park
const R_LAT = 0.0105;
const R_LON = 0.0068;
const LOOP_M = 2 * Math.PI * Math.sqrt(((R_LAT * 111_320) ** 2 + (R_LON * 84_300) ** 2) / 2);

function track(startMs, distanceM, kmh, noise = true) {
  const pts = [];
  let d = 0;
  let t = startMs;
  let k = 0;
  while (d < distanceM) {
    const wobble = noise ? 1 + 0.12 * Math.sin(k / 97) + 0.06 * (Math.random() - 0.5) : 1;
    d += ((kmh * wobble) / 3.6);
    t += 1000;
    k++;
    const a = (d / LOOP_M) * 2 * Math.PI;
    pts.push({
      t,
      lat: CENTER.lat + R_LAT * Math.sin(a) + (Math.random() - 0.5) * 0.00002,
      lon: CENTER.lon + R_LON * Math.cos(a) + (Math.random() - 0.5) * 0.00002,
      ele: 30 + 8 * Math.sin(a * 3),
      hr: Math.round(140 + 10 * Math.sin(k / 300) + Math.random() * 4),
    });
  }
  return pts;
}

const gpx = (name, type, pts) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="LLS sample generator" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${name}</name></metadata>
  <trk><name>${name}</name><type>${type}</type><trkseg>
${pts.map((p) => `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.ele.toFixed(1)}</ele><time>${new Date(p.t).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>`).join('\n')}
  </trkseg></trk>
</gpx>
`;

mkdirSync(new URL('../samples/', import.meta.url), { recursive: true });
const out = (f, s) => writeFileSync(new URL(`../samples/${f}`, import.meta.url), s);

// Valid run: finishes 2 minutes ago; pace adapts to fit inside today's window.
const dist = day * 1000 + 250;
const available = (now - 120_000 - dayStart - 60_000) / 1000;
const kmh = Math.max(11, (dist / available) * 3.6 * 1.15);
if (kmh > 19) console.warn(`Only ${Math.round(available / 60)} min of today's race day have passed (UTC). The valid sample needs a fast pace and may be flagged. Re-run this later in the UTC day for a cleaner sample.`);
const durMs = (dist / (kmh / 3.6)) * 1000;
out('today-valid-run.gpx', gpx(`Day ${day} run`, 'running', track(now - 120_000 - durMs, dist, kmh)));

out('yesterday-run.gpx', gpx(`Day ${day - 1} run`, 'running', track(dayStart - 6 * 3_600_000, dist, 11)));

const carStart = Math.max(dayStart + 30_000, now - 120_000 - durMs - 40 * 60_000);
out('car-ride.gpx', gpx('Totally a run', 'running', track(carStart, dist, 55)));

console.log(`Day ${day} of the demo race (${day} km due). Samples written to ./samples:`);
console.log(`  today-valid-run.gpx  ${(dist / 1000).toFixed(2)} km at ${kmh.toFixed(1)} km/h -> should be accepted`);
console.log('  yesterday-run.gpx    recorded yesterday       -> should be rejected (old run)');
console.log('  car-ride.gpx         55 km/h                  -> should be rejected (vehicle)');
