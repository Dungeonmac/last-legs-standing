// Self-check for the activity parsers and anti-cheat scoring. Run: node scripts/test-parsers.mjs
import assert from 'node:assert/strict';
import { parseFIT, parseGPX } from '../src/server/parsers.js';
import { computeMetrics, assessRun } from '../src/server/analyze.js';

// ---- build a small FIT file: file_id, sport=running, 600 records at 1 s, one compressed-timestamp record
const FIT_EPOCH_S = 631_065_600;
const start = Math.floor(Date.UTC(2026, 9, 29, 12, 0, 0) / 1000) - FIT_EPOCH_S;
const bytes = [];
const u8 = (v) => bytes.push(v & 0xff);
const u16 = (v) => { u8(v); u8(v >> 8); };
const u32 = (v) => { u16(v & 0xffff); u16((v >>> 16) & 0xffff); };
const def = (local, global, fields) => {
  u8(0x40 | local); u8(0); u8(0); u16(global); u8(fields.length);
  for (const [num, size, type] of fields) { u8(num); u8(size); u8(type); }
};
def(0, 0, [[0, 1, 0x00], [1, 2, 0x84]]); // file_id: type, manufacturer
u8(0); u8(4); u16(1);                     // activity file, Garmin
def(1, 12, [[0, 1, 0x00]]);               // dummy msg using field 0 only (ignored)
def(2, 18, [[5, 1, 0x00]]);               // session: sport
u8(2); u8(1);                             // running
def(3, 20, [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [3, 1, 0x02]]);
const SEMI = 2 ** 31 / 180;
for (let i = 0; i < 600; i++) {
  u8(3); u32(start + i);
  const lat = 40.78 + i * 0.000025 * (1 + 0.15 * Math.sin(i / 37));
  bytes.push(...new Uint8Array(new Int32Array([Math.round(lat * SEMI)]).buffer));
  bytes.push(...new Uint8Array(new Int32Array([Math.round(-73.96 * SEMI)]).buffer));
  u16((30 + 500) * 5); u8(140 + (i % 10));
}
// compressed timestamp header (local type 3 only has 2 bits -> use a type-1 style record definition)
def(1, 20, [[0, 4, 0x85], [1, 4, 0x85]]);
u8(0x80 | (1 << 5) | ((start + 600) & 0x1f));
bytes.push(...new Uint8Array(new Int32Array([Math.round((40.78 + 600 * 0.000025) * SEMI)]).buffer));
bytes.push(...new Uint8Array(new Int32Array([Math.round(-73.96 * SEMI)]).buffer));

const header = [14, 0x20, 0, 0, ...new Uint8Array(new Uint32Array([bytes.length]).buffer), 0x2e, 0x46, 0x49, 0x54, 0, 0];
const fit = new Uint8Array([...header, ...bytes, 0, 0]).buffer;
const parsed = parseFIT(fit);
assert.equal(parsed.sport, 'running');
assert.equal(parsed.points.length, 601);
assert.equal(parsed.points[0].t, (start + FIT_EPOCH_S) * 1000);
assert.equal(parsed.points[600].t, (start + 600 + FIT_EPOCH_S) * 1000, 'compressed timestamp');
assert.ok(Math.abs(parsed.points[0].lat - 40.78) < 1e-6);
assert.equal(parsed.points[0].ele, 30);
assert.equal(parsed.points[0].hr, 140);
const m = computeMetrics(parsed.points);
assert.ok(m.distance_m > 1600 && m.distance_m < 2100, `distance ${m.distance_m}`); // wobbling synthetic track
console.log(`FIT ok: ${parsed.points.length} points, ${(m.distance_m / 1000).toFixed(2)} km, ${m.moving_s}s moving`);

// ---- GPX with lon before lat and namespaced hr
const gpx = `<gpx><trk><type>running</type><trkseg>
  <trkpt lon="-73.9" lat="40.7"><ele>5</ele><time>2026-10-29T10:00:00Z</time><extensions><ns3:TrackPointExtension><ns3:hr>150</ns3:hr></ns3:TrackPointExtension></extensions></trkpt>
  <trkpt lon="-73.9" lat="40.701"><time>2026-10-29T10:00:30Z</time></trkpt></trkseg></trk></gpx>`;
const g = parseGPX(gpx);
assert.equal(g.points.length, 2);
assert.equal(g.points[0].hr, 150);
assert.equal(g.sport, 'running');
console.log('GPX ok');

// ---- verdicts
const window = { start: Date.UTC(2026, 9, 29), end: Date.UTC(2026, 9, 30) };
const ok = assessRun({ metrics: m, sport: 'running', source: 'fit', window, now: window.end - 1000 });
assert.equal(ok.status, 'approved', JSON.stringify(ok.flags));
const bike = assessRun({ metrics: m, sport: 'cycling', source: 'fit', window, now: window.end - 1000 });
assert.equal(bike.status, 'rejected');
const old = assessRun({ metrics: m, sport: 'running', source: 'fit', window: { start: window.end, end: window.end + 86_400_000 }, now: window.end + 5000 });
assert.equal(old.status, 'rejected');
assert.ok(old.flags.some((f) => f.code === 'WRONG_DAY'));
console.log('Verdicts ok: approved / cycling rejected / old run rejected');
