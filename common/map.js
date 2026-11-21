// =====================================================================
// dawa4u maps — Leaflet + OpenStreetMap (free, no API key).
// To use another map style (MapTiler, Carto, Mapbox…), set MAP_TILES and
// MAP_ATTRIBUTION in common/config.js.
// =====================================================================
import { sb } from './api.js';

const cfg = window.D4U_CONFIG || {};
// Default: OpenStreetMap's own tiles (free, no API key — CARTO now needs a key and shows "API KEY REQUIRED").
// In dark mode the same tiles are recoloured dark with a CSS filter, so one tile source serves both themes.
// For heavy traffic, set MAP_TILES (+ MAP_ATTRIBUTION) in common/config.js to a keyed provider (MapTiler, Ola Maps…).
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const tilesNow = () => cfg.MAP_TILES || OSM_TILES;
const isDark = () => !(window.d4uTheme && window.d4uTheme.current() === 'light');
const MAPS = new Set();
const paint = map => { try { map.getContainer().classList.toggle('d4u-dark-map', isDark() && !cfg.MAP_TILES); } catch { MAPS.delete(map); } };
window.addEventListener('d4u-theme', () => MAPS.forEach(paint));
(() => { // dark-mode map colouring, added once whatever loads first
  if (document.getElementById('d4u-dark-map-css')) return;
  const st = document.createElement('style'); st.id = 'd4u-dark-map-css';
  st.textContent = '.d4u-dark-map .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.88) saturate(.55)}';
  document.head.appendChild(st);
})();
const ATTR = cfg.MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const INDIA = [22.97, 78.65];
const base = new URL('./vendor/leaflet/', import.meta.url).href;

let loading;
/** Loads Leaflet once (script + styles) and returns window.L */
export function loadMaps() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) loading = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'leaflet.css'; document.head.appendChild(css);
    const st = document.createElement('style');
    st.textContent = `.d4u-pin{display:flex;align-items:center;justify-content:center;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);color:#fff;font:800 12px Inter,system-ui,sans-serif}
      .d4u-pin.rider{transition:transform .9s linear}.leaflet-container{font-family:Inter,system-ui,sans-serif;background:var(--map-bg,#0E1A0B)}.leaflet-control-attribution{background:color-mix(in srgb,var(--card,#13230F) 80%,transparent)!important;color:var(--mute,#A7B39F)}.leaflet-control-attribution a{color:var(--em-text,#8DCB7B)}
      .d4u-mapbtn{position:absolute;z-index:500;background:var(--card);border:0;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.4);padding:8px 12px;font:700 13px Inter,system-ui,sans-serif;color:var(--em-text,#8DCB7B);background:var(--card,#13230F);cursor:pointer}`;
    document.head.appendChild(st);
    const s = document.createElement('script'); s.src = base + 'leaflet.js';
    s.onload = () => res(window.L); s.onerror = () => rej(new Error('Map could not load'));
    document.head.appendChild(s);
  });
  return loading;
}

const svg = {
  store: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  home: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#13230F" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7v9H3z"/></svg>',
  bike: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h3l3-7h4l2 7M12 10 10 6H7"/></svg>'
};
/** Round map markers in the dawa4u colours: kind = 'pharmacy' | 'home' | 'rider' | text */
export function pinIcon(L, kind, label) {
  const k = { pharmacy: ['#2C6420', svg.store, 34], home: ['#F1ECD6', svg.home, 34], rider: ['#E5CD82', svg.bike, 40] }[kind] || ['#15370D', label || '', 30];
  return L.divIcon({ className: '', html: `<div class="d4u-pin ${kind}" style="width:${k[2]}px;height:${k[2]}px;background:${k[0]}">${k[1]}</div>`, iconSize: [k[2], k[2]], iconAnchor: [k[2] / 2, k[2] / 2] });
}

/** Makes a map inside `el`. Returns { L, map }. */
export async function makeMap(el, { center = INDIA, zoom = 5, interactive = true } = {}) {
  const L = await loadMaps();
  if (el._d4uMap) { el._d4uMap.remove(); }
  const map = L.map(el, { zoomControl: interactive, dragging: interactive, scrollWheelZoom: interactive, attributionControl: true }).setView(center, zoom);
  L.tileLayer(tilesNow(), { maxZoom: 19, attribution: ATTR }).addTo(map);
  MAPS.add(map); paint(map);
  el._d4uMap = map;
  setTimeout(() => map.invalidateSize(), 50);
  return { L, map };
}

/** Distance in km between two {lat,lng} points */
export function km(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Rough minutes for a city bike ride (road distance ≈ 1.3 × straight line, 20 km/h) */
export const rideMinutes = d => d == null ? null : Math.max(1, Math.round(d * 1.3 / 20 * 60));

/** Phone/browser GPS once */
export function myLocation() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => rej(new Error(e.code === 1 ? 'Allow location access in your browser settings' : 'Could not get your location')), { enableHighAccuracy: true, timeout: 15000 });
  });
}

/** Address search + reverse lookup with OpenStreetMap Nominatim (light use only; swap for a paid geocoder at scale) */
export async function searchPlace(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&addressdetails=1&limit=5&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } });
  return (await r.json()).map(x => ({ lat: +x.lat, lng: +x.lon, name: x.display_name, pin: x.address && x.address.postcode }));
}
export async function placeAt(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
    const x = await r.json(), a = x.address || {};
    const line = [a.house_number, a.road, a.neighbourhood || a.suburb, a.city || a.town || a.village].filter(Boolean).join(', ');
    return { line: line || x.display_name || '', pin: (a.postcode || '').replace(/\s/g, '') };
  } catch { return { line: '', pin: '' }; }
}

/**
 * Location picker: map + draggable pin + "Use my location" + search box.
 * onChange({lat,lng,line,pin}) is called whenever the pin moves.
 */
export async function locationPicker(el, { lat, lng, onChange, search = true } = {}) {
  el.style.position = 'relative';
  el.innerHTML = `<div class="d4u-mapbox" style="position:absolute;inset:0;border-radius:inherit"></div>
    ${search ? `<input class="d4u-mapsearch" placeholder="Search area, street, landmark" style="position:absolute;z-index:500;top:10px;left:10px;right:10px;width:calc(100% - 20px);box-sizing:border-box;border:1px solid var(--line,#2A3F25);border-radius:10px;padding:10px 12px;font:14px Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);background:var(--card,#13230F);color:var(--ink,#F1ECD6)">
    <div class="d4u-results" style="position:absolute;z-index:600;top:50px;left:10px;right:10px;background:var(--card);border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.2);display:none;max-height:180px;overflow:auto;font:13px Inter,system-ui,sans-serif"></div>` : ''}
    <button type="button" class="d4u-mapbtn d4u-locate" style="bottom:12px;right:12px">◎ Use my location</button>`;
  const has = lat != null && lng != null;
  const { L, map } = await makeMap(el.querySelector('.d4u-mapbox'), { center: has ? [lat, lng] : INDIA, zoom: has ? 16 : 5 });
  if (search && map.zoomControl) map.zoomControl.setPosition('bottomleft');
  const marker = L.marker(has ? [lat, lng] : INDIA, { draggable: true, icon: pinIcon(L, 'home') });
  if (has) marker.addTo(map);
  let t;
  const moved = (p, zoom) => {
    if (!map.hasLayer(marker)) marker.addTo(map);
    marker.setLatLng([p.lat, p.lng]); if (zoom) map.setView([p.lat, p.lng], 17);
    clearTimeout(t); t = setTimeout(async () => onChange && onChange({ lat: p.lat, lng: p.lng, ...(await placeAt(p.lat, p.lng)) }), 400);
  };
  marker.on('dragend', () => { const p = marker.getLatLng(); moved({ lat: p.lat, lng: p.lng }); });
  map.on('click', e => moved({ lat: e.latlng.lat, lng: e.latlng.lng }));
  el.querySelector('.d4u-locate').onclick = async ev => {
    const b = ev.currentTarget; b.textContent = 'Finding you…';
    try { moved(await myLocation(), true); b.textContent = '◎ Use my location'; } catch (e) { b.textContent = e.message; setTimeout(() => { b.textContent = '◎ Use my location'; }, 3000); }
  };
  const box = el.querySelector('.d4u-mapsearch'), res = el.querySelector('.d4u-results');
  if (box) {
    let st;
    box.oninput = () => { clearTimeout(st); if (box.value.trim().length < 3) { res.style.display = 'none'; return; }
      st = setTimeout(async () => { try { const list = await searchPlace(box.value.trim());
        res.innerHTML = list.map((x, i) => `<div data-i="${i}" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #2A3F25">${x.name.replace(/</g, '&lt;')}</div>`).join('') || '<div style="padding:9px 12px;color:#4B5563">No match — drag the pin instead</div>';
        res.style.display = 'block'; res.onclick = e => { const d = e.target.closest('[data-i]'); if (!d) return; const x = list[+d.dataset.i]; res.style.display = 'none'; box.value = ''; moved(x, true); };
      } catch { res.style.display = 'none'; } }, 450); };
  }
  return { map, set: p => moved(p, true) };
}

/** Watch one rider's live position (realtime + 6-second safety poll). cb({lat,lng,heading,updated_at}|null). Returns stop(). */
export function watchRider(riderId, cb) {
  let stop = false;
  const load = async () => {
    if (stop || document.hidden) return;
    const { data } = await sb.from('rider_locations').select('*').eq('rider_id', riderId).maybeSingle();
    if (!stop) cb(data || null);
  };
  load();
  const ch = sb.channel('rider-' + riderId + Math.random().toString(36).slice(2))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations', filter: 'rider_id=eq.' + riderId }, p => !stop && p.new && cb(p.new))
    .subscribe();
  const t = setInterval(load, 6000);
  return () => { stop = true; clearInterval(t); sb.removeChannel(ch); };
}

/**
 * Live tracking map for one order: pharmacy pin, home pin, rider marker (moves live).
 * Returns { update(order), stop() }. onEta(minutes|null, kmLeft|null) gives a GPS-based ETA once the rider has the parcel.
 */
export async function trackingMap(el, order, { onEta } = {}) {
  const pick = order.pickup_lat != null ? { lat: order.pickup_lat, lng: order.pickup_lng } : null;
  const drop = order.drop_lat != null ? { lat: order.drop_lat, lng: order.drop_lng } : null;
  const { L, map } = await makeMap(el, { center: drop ? [drop.lat, drop.lng] : pick ? [pick.lat, pick.lng] : INDIA, zoom: drop || pick ? 14 : 5 });
  if (pick) L.marker([pick.lat, pick.lng], { icon: pinIcon(L, 'pharmacy') }).addTo(map).bindTooltip(order.pharmacy_name || 'Pharmacy');
  if (drop) L.marker([drop.lat, drop.lng], { icon: pinIcon(L, 'home') }).addTo(map).bindTooltip(order.address_label || 'You');
  const line = pick && drop ? L.polyline([[pick.lat, pick.lng], [drop.lat, drop.lng]], { color: '#15370D', weight: 3, dashArray: '6 8', opacity: .7 }).addTo(map) : null;
  const pts = [pick, drop].filter(Boolean).map(p => [p.lat, p.lng]);
  if (pts.length === 2) map.fitBounds(pts, { padding: [50, 50], maxZoom: 16 });
  let rider = null, stopWatch = null, cur = order, fitted = false;
  const onPos = pos => {
    if (!pos) return;
    if (!rider) rider = L.marker([pos.lat, pos.lng], { icon: pinIcon(L, 'rider'), zIndexOffset: 1000 }).addTo(map).bindTooltip(cur.rider_name || 'Rider');
    else rider.setLatLng([pos.lat, pos.lng]);
    if (!fitted) { fitted = true; map.fitBounds([...pts, [pos.lat, pos.lng]], { padding: [50, 50], maxZoom: 16 }); }
    const target = cur.status === 'picked' ? drop : pick;
    const d = km(pos, target);
    if (onEta) onEta(cur.status === 'picked' ? rideMinutes(d) : null, d);
  };
  const update = o => {
    cur = o;
    if (o.rider_id && !stopWatch && ['accepted', 'packed', 'picked'].includes(o.status)) stopWatch = watchRider(o.rider_id, onPos);
    if ((!o.rider_id || ['delivered', 'cancelled'].includes(o.status)) && stopWatch) { stopWatch(); stopWatch = null; if (rider) { rider.remove(); rider = null; } }
    if (line) line.setStyle({ dashArray: o.status === 'picked' ? null : '6 8' });
  };
  update(order);
  return { update, stop: () => { if (stopWatch) stopWatch(); map.remove(); el._d4uMap = null; }, map };
}

/** Rider phone: send GPS to the server every ~10 s while active. Returns stop(). */
export function shareLocation(onError) {
  if (!navigator.geolocation) { onError && onError(new Error('GPS not available on this phone')); return () => {}; }
  let last = 0, lastPos = null;
  const send = p => {
    lastPos = p; const now = Date.now(); if (now - last < 10000) return; last = now;
    sb.rpc('rider_ping', { p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_accuracy: p.coords.accuracy, p_heading: p.coords.heading }).then(({ error }) => error && onError && onError(error));
  };
  const id = navigator.geolocation.watchPosition(send, e => onError && onError(new Error(e.code === 1 ? 'Allow location access so customers can track you' : 'GPS signal lost')), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  const keep = setInterval(() => { if (lastPos) { last = 0; send(lastPos); } }, 30000);   // re-send even when standing still
  return () => { navigator.geolocation.clearWatch(id); clearInterval(keep); };
}
