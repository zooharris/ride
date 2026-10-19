import { useEffect, useRef } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Sample } from './ActivityCharts';

/**
 * The route on a map, with a marker that follows the chart cursor and a
 * cursor that follows the mouse over the route. Tiles come from
 * OpenStreetMap, the one outside service this needs; without a connection
 * the track still draws on a blank background.
 */
export function RouteMap({ samples, hover, onHover, height = 320 }: { samples: Sample[]; hover: number | null; onHover: (i: number | null) => void; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const pts = samples.map((s, i) => ({ i, lat: s.lat, lng: s.lng })).filter((p): p is { i: number; lat: number; lng: number } => typeof p.lat === 'number' && typeof p.lng === 'number' && !(p.lat === 0 && p.lng === 0));

  useEffect(() => {
    if (!el.current || pts.length < 2) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    const latlngs = pts.map((p) => [p.lat, p.lng] as [number, number]);
    L.polyline(latlngs, { color: '#000', weight: 7, opacity: 0.25, interactive: false }).addTo(m);   // a soft shadow under the track so it reads on any tile
    const line = L.polyline(latlngs, { color: '#f0a33a', weight: 3.5, opacity: 0.95 }).addTo(m);
    L.circleMarker(latlngs[0], { radius: 5, color: '#fff', weight: 2, fillColor: '#2fbf71', fillOpacity: 1 }).addTo(m).bindTooltip('Start');
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#fff', weight: 2, fillColor: '#e5484d', fillOpacity: 1 }).addTo(m).bindTooltip('Finish');
    m.fitBounds(line.getBounds(), { padding: [18, 18] });
    setTimeout(() => { m.invalidateSize(); m.fitBounds(line.getBounds(), { padding: [18, 18] }); }, 50);
    marker.current = L.circleMarker(latlngs[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#f0a33a', fillOpacity: 1, interactive: false }).addTo(m);
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
    return () => { m.remove(); map.current = null; marker.current = null; };
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
  return <div ref={el} class="map" style={`height:${height}px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line)`} />;
}
