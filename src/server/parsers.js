// Parsers for the activity file formats every major tracker can export:
//   GPX  - Strava, Garmin, Coros, Suunto, Polar, Apple Health exporters, most apps
//   TCX  - Garmin Connect, Polar, TrainingPeaks
//   FIT  - native format of Garmin / Coros / Wahoo / Suunto watches
// Each returns { sport, device, points: [{ t, lat, lon, ele, hr, cad }] } with t in unix ms.

import { HttpError } from './util.js';

const num = (s) => (s === undefined || s === null || s === '' ? null : Number(s));

function normalizeSport(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toLowerCase();
  if (/run|jog|trail/.test(s) || s === '9') return 'running'; // Strava GPX exports use type 9 for runs
  if (/walk|hik/.test(s)) return 'walking';
  if (/bik|cycl|ride|ebike/.test(s)) return 'cycling';
  if (/swim/.test(s)) return 'swimming';
  if (/ski|row|kayak|drive|motor|car/.test(s)) return 'other';
  return null;
}

export function parseGPX(text) {
  const sport = normalizeSport((text.match(/<trk>[\s\S]*?<type>([^<]+)<\/type>/) || [])[1]);
  const device = (text.match(/<gpx[^>]*creator="([^"]+)"/) || [])[1] || null;
  const points = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    const body = m[2];
    const lat = num((attrs.match(/lat="([^"]+)"/) || [])[1]);
    const lon = num((attrs.match(/lon="([^"]+)"/) || [])[1]);
    const time = (body.match(/<time>([^<]+)<\/time>/) || [])[1];
    if (lat === null || lon === null || !time) continue;
    points.push({
      t: Date.parse(time),
      lat,
      lon,
      ele: num((body.match(/<ele>([^<]+)<\/ele>/) || [])[1]),
      hr: num((body.match(/<(?:\w+:)?hr>(\d+)<\/(?:\w+:)?hr>/) || [])[1]),
      cad: num((body.match(/<(?:\w+:)?cad>(\d+)<\/(?:\w+:)?cad>/) || [])[1]),
    });
  }
  return { sport, device, points };
}

export function parseTCX(text) {
  const sport = normalizeSport((text.match(/<Activity\s+Sport="([^"]+)"/) || [])[1]);
  const device = (text.match(/<Creator[\s\S]*?<Name>([^<]+)<\/Name>/) || [])[1] || null;
  const points = [];
  const re = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    const time = (b.match(/<Time>([^<]+)<\/Time>/) || [])[1];
    const lat = num((b.match(/<LatitudeDegrees>([^<]+)</) || [])[1]);
    const lon = num((b.match(/<LongitudeDegrees>([^<]+)</) || [])[1]);
    if (!time || lat === null || lon === null) continue;
    points.push({
      t: Date.parse(time),
      lat,
      lon,
      ele: num((b.match(/<AltitudeMeters>([^<]+)</) || [])[1]),
      hr: num((b.match(/<HeartRateBpm>\s*<Value>(\d+)<\/Value>/) || [])[1]),
      cad: num((b.match(/<(?:\w+:)?(?:Cadence|RunCadence)>(\d+)</) || [])[1]),
    });
  }
  return { sport, device, points };
}

// ---- FIT (binary) ---------------------------------------------------------
const FIT_EPOCH_S = 631_065_600; // 1989-12-31T00:00:00Z
const SEMI = 180 / 2 ** 31;
const FIT_SPORTS = { 1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 17: 'walking' };

function readField(view, offset, baseType, size, little) {
  const t = baseType & 0x1f;
  switch (t) {
    case 0x00: case 0x02: case 0x0a: case 0x0d: { // enum, uint8, uint8z, byte
      if (size !== 1) return null;
      const v = view.getUint8(offset);
      return v === 0xff || (t === 0x0a && v === 0) ? null : v;
    }
    case 0x01: { if (size !== 1) return null; const v = view.getInt8(offset); return v === 0x7f ? null : v; }
    case 0x03: { if (size !== 2) return null; const v = view.getInt16(offset, little); return v === 0x7fff ? null : v; }
    case 0x04: case 0x0b: { if (size !== 2) return null; const v = view.getUint16(offset, little); return v === 0xffff || (t === 0x0b && v === 0) ? null : v; }
    case 0x05: { if (size !== 4) return null; const v = view.getInt32(offset, little); return v === 0x7fffffff ? null : v; }
    case 0x06: case 0x0c: { if (size !== 4) return null; const v = view.getUint32(offset, little); return v === 0xffffffff || (t === 0x0c && v === 0) ? null : v; }
    case 0x08: { if (size !== 4) return null; const v = view.getFloat32(offset, little); return Number.isFinite(v) ? v : null; }
    case 0x09: { if (size !== 8) return null; const v = view.getFloat64(offset, little); return Number.isFinite(v) ? v : null; }
    default: return null; // strings, 64-bit ints, arrays: not needed here
  }
}

export function parseFIT(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 14) throw new HttpError(400, 'FIT file is too small.');
  const headerSize = view.getUint8(0);
  const dataSize = view.getUint32(4, true);
  const sig = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (sig !== '.FIT') throw new HttpError(400, 'Not a valid FIT file.');

  const end = Math.min(headerSize + dataSize, buffer.byteLength);
  const defs = {};
  const points = [];
  let sport = null;
  let manufacturer = null;
  let lastTs = 0;
  let pos = headerSize;

  while (pos < end) {
    const header = view.getUint8(pos++);
    let localType;
    let compressedOffset = null;

    if (header & 0x80) {
      localType = (header >> 5) & 0x03;
      compressedOffset = header & 0x1f;
    } else if (header & 0x40) {
      localType = header & 0x0f;
      const hasDev = header & 0x20;
      const little = view.getUint8(pos + 1) === 0;
      const globalNum = view.getUint16(pos + 2, little);
      const n = view.getUint8(pos + 4);
      pos += 5;
      const fields = [];
      for (let i = 0; i < n; i++, pos += 3) {
        fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1), type: view.getUint8(pos + 2) });
      }
      let devSize = 0;
      if (hasDev) {
        const nd = view.getUint8(pos++);
        for (let i = 0; i < nd; i++, pos += 3) devSize += view.getUint8(pos + 1);
      }
      defs[localType] = { globalNum, little, fields, devSize };
      continue;
    } else {
      localType = header & 0x0f;
    }

    const def = defs[localType];
    if (!def) throw new HttpError(400, 'Corrupt FIT file (missing definition).');
    const values = {};
    for (const f of def.fields) {
      values[f.num] = readField(view, pos, f.type, f.size, def.little);
      pos += f.size;
    }
    pos += def.devSize;

    if (values[253] != null) lastTs = values[253];
    else if (compressedOffset !== null) {
      const base = lastTs & ~0x1f;
      lastTs = compressedOffset >= (lastTs & 0x1f) ? base + compressedOffset : base + compressedOffset + 0x20;
      values[253] = lastTs;
    }

    if (def.globalNum === 20) { // record
      if (values[0] == null || values[1] == null || values[253] == null) continue;
      const altRaw = values[78] ?? values[2];
      points.push({
        t: (values[253] + FIT_EPOCH_S) * 1000,
        lat: values[0] * SEMI,
        lon: values[1] * SEMI,
        ele: altRaw == null ? null : altRaw / 5 - 500,
        hr: values[3] ?? null,
        cad: values[4] ?? null,
      });
    } else if ((def.globalNum === 18 || def.globalNum === 12) && values[5] != null && sport === null) {
      sport = FIT_SPORTS[values[5]] || 'other'; // session / sport message
    } else if (def.globalNum === 0 && values[1] != null) {
      manufacturer = values[1]; // file_id
    }
  }
  return { sport, device: manufacturer != null ? `FIT manufacturer #${manufacturer}` : null, points };
}

export function parseActivityFile(filename, buffer) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  let parsed;
  if (ext === 'fit') parsed = parseFIT(buffer);
  else if (ext === 'gpx' || ext === 'tcx') {
    const text = new TextDecoder().decode(buffer);
    parsed = ext === 'gpx' ? parseGPX(text) : parseTCX(text);
  } else {
    throw new HttpError(400, 'Unsupported file type. Upload a .gpx, .tcx or .fit file.');
  }
  parsed.points = parsed.points.filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  return { ...parsed, format: ext };
}
