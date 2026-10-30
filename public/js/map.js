// Thin wrapper around Leaflet + OpenStreetMap tiles (dark-styled with a CSS filter).
let loading;
function loadLeaflet() {
  return (loading ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    // Subresource integrity: the browser refuses the file if the CDN copy is ever tampered with.
    css.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
    css.crossOrigin = 'anonymous';
    document.head.append(css);
    const style = document.createElement('style');
    style.textContent = '.leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9)}.leaflet-container{background:#1a1c21;font-family:inherit}';
    document.head.append(style);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.L);
    s.onerror = reject;
    document.head.append(s);
  }));
}

export async function createMap(el, { center = [20, 0], zoom = 2 } = {}) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return { L, map };
}

export async function drawTrack(el, track) {
  if (!track?.length) { el.innerHTML = '<p class="muted center" style="padding:2rem">No GPS track</p>'; return; }
  const { L, map } = await createMap(el);
  const line = L.polyline(track, { color: '#fc4c02', weight: 3.5, opacity: .95 }).addTo(map);
  L.circleMarker(track[0], { radius: 6, color: '#74c493', fillOpacity: 1 }).addTo(map);
  L.circleMarker(track[track.length - 1], { radius: 6, color: '#e2be45', fillOpacity: 1 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [20, 20] });
  return map;
}
