import { useEffect, useRef } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Sample } from './ActivityCharts';
import { cssVar, onThemeChange, resolvedTheme } from './theme';

// OpenStreetMap's own tiles: free and keyless. (CARTO's dark/light tiles were tried and now demand an API key.)
// The dark theme darkens these same tiles with a CSS filter (see .map.dark in global.css).
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The route on a map, with a marker that follows the chart cursor and a
 * cursor that follows the mouse over the route. Tiles are OpenStreetMap's,
 * darkened by a filter in the dark theme; without a connection the track
 * still draws on a blank background. `height` may be a CSS length, so a pinned map can fill its column.
 */
export function RouteMap({ samples, hover, onHover, height = 320 }: { samples: Sample[]; hover: number | null; onHover: (i: number | null) => void; height?: number | string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const pts = samples.map((s, i) => ({ i, lat: s.lat, lng: s.lng })).filter((p): p is { i: number; lat: number; lng: number } => typeof p.lat === 'number' && typeof p.lng === 'number' && !(p.lat === 0 && p.lng === 0));

  useEffect(() => {
    if (!el.current || pts.length < 2) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    el.current.classList.toggle('dark', resolvedTheme() === 'dark');
    const latlngs = pts.map((p) => [p.lat, p.lng] as [number, number]);
    const halo = cssVar('--bg') || '#0A1220';
    L.polyline(latlngs, { color: halo, weight: 7, opacity: 0.55, interactive: false }).addTo(m);   // a halo under the track so it reads on any tile
    const line = L.polyline(latlngs, { color: cssVar('--accent') || '#20D6B5', weight: 3.5, opacity: 0.95 }).addTo(m);
    L.circleMarker(latlngs[0], { radius: 5, color: '#fff', weight: 2, fillColor: cssVar('--good') || '#34C77B', fillOpacity: 1 }).addTo(m).bindTooltip('Start');
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#fff', weight: 2, fillColor: cssVar('--bad') || '#F0506E', fillOpacity: 1 }).addTo(m).bindTooltip('Finish');
    const box = el.current;
    const offTheme = onThemeChange((t) => { box.classList.toggle('dark', t === 'dark'); line.setStyle({ color: cssVar('--accent') }); });
    // A pinned map changes size with the window; keep Leaflet's idea of it current.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    m.fitBounds(line.getBounds(), { padding: [18, 18] });
    setTimeout(() => { m.invalidateSize(); m.fitBounds(line.getBounds(), { padding: [18, 18] }); }, 50);
    marker.current = L.circleMarker(latlngs[0], { radius: 7, color: '#fff', weight: 2, fillColor: cssVar('--today') || '#FF8A1E', fillOpacity: 1, interactive: false }).addTo(m);
    marker.current.setStyle({ opacity: 0, fillOpacity: 0 });
    // Mouse over the map: pick the nearest point of the route, within a few screen pixels of it.
    const nearest = (latlng: L.LatLng, within: number) => {
      const mp = m.latLngToLayerPoint(latlng);
      let best = -1, bestD = within * within;
      for (const p of pts) { const q = m.latLngToLayerPoint([p.lat, p.lng]); const dx = q.x - mp.x, dy = q.y - mp.y; const d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = p.i; } }
      return best;
    };
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (!touch) {
      m.on('mousemove', (e: L.LeafletMouseEvent) => { const i = nearest(e.latlng, 14); onHover(i >= 0 ? i : null); });
      m.on('mouseout', () => onHover(null));
    }
    // A tap (or click) on or near the route jumps the charts there and leaves the marker in place.
    m.on('click', (e: L.LeafletMouseEvent) => { const i = nearest(e.latlng, 28); if (i >= 0) onHover(i); });
    map.current = m;
    return () => { offTheme(); ro.disconnect(); m.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples]);

  useEffect(() => {
    const mk = marker.current;
    if (!mk) return;
    const s = hover != null ? samples[hover] : null;
    if (s && typeof s.lat === 'number' && typeof s.lng === 'number') { mk.setLatLng([s.lat, s.lng]); mk.setStyle({ opacity: 1, fillOpacity: 1 }); }
    else mk.setStyle({ opacity: 0, fillOpacity: 0 });
  }, [hover, samples]);

  if (pts.length < 2) return null;
  return <div ref={el} class="map" style={`height:${typeof height === 'number' ? `${height}px` : height};border-radius:var(--radius);overflow:hidden;border:1px solid var(--line)`} />;
}
