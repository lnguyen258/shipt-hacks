'use client';

/**
 * MapLibre map (OSM roads + buildings, City of Birmingham neighborhoods, Shipt HQ landmark),
 * themed with the warm "paper & wood" palette from the front-end kit.
 * Click a district to limit the quests shown to it; click it again (or the chip) to clear.
 */
import { useEffect, useRef, useState } from 'react';
import type { Map as MLMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';
import type { QuestDTO, SponsorDTO } from '@/lib/contracts';
import { CATEGORY_META } from '@/lib/constants';

export interface AreaSel { name: string; raw: string }
export interface QuestMapProps {
  quests: QuestDTO[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  revealedDistricts?: string[];
  userLocation?: { lat: number; lng: number } | null;
  sponsors?: SponsorDTO[];
  className?: string;
  /** Currently selected district (controlled by the page so the sidebar and chip can clear it). */
  area?: AreaSel | null;
  onAreaSelect?: (a: AreaSel | null) => void;
  /** questId -> district name, so the page can filter its list the same way the map does. */
  onQuestAreas?: (m: Record<string, string>) => void;
}

// Warm theme (values from components/ui/cozy.css)
const T = {
  bg: '#eef3df', // pale avocado-white ground
  roadCasing: '#b7c796', roads: ['#ffffff', '#ffffff', '#fbfdf4', '#f6f9ea', '#f1f5e1'],
  bldLow: '#f8faef', bldMid: '#bfd391', bldHigh: '#86a24a', bldLine: '#8aa05a',
  hood: '#7f9a4a', hoodHover: '#8fb23a', hoodSel: '#4e6b1f',
};
const BOUNDS = { west: -86.92, south: 33.43, east: -86.70, north: 33.62 };
const SHIPT_HEIGHT = 78;

type Pt = [number, number];
interface Area { raw: string; name: string; polys: Pt[][][]; rects: { w: number; s: number; e: number; n: number }[] }

const inRing = (x: number, y: number, ring: Pt[]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const fixName = (n: string) => n.replace(/Hghts|Hgts/g, 'Heights').replace(/Hghlands/g, 'Highlands').replace(/Prk/g, 'Park').replace(/\bHts\b/g, 'Heights').replace(/\bVlg\b/g, 'Village').replace(/\bNo\b\.?/g, 'North').replace(/\bSo\b\.?/g, 'South').replace(/\bBham\b/g, 'Birmingham').replace(/\bPk\b/g, 'Park');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const bang = (q: QuestDTO) => (q.myStatus === 'COMPLETED' ? '✓' : q.myStatus === 'ACCEPTED' || q.myStatus === 'CHECKED_IN' ? '▶' : q.spotsLeft === 0 ? '•' : '!');
const pinClass = (q: QuestDTO, sel: boolean) =>
  'qpin' + (q.myStatus === 'COMPLETED' ? ' done' : q.myStatus === 'ACCEPTED' || q.myStatus === 'CHECKED_IN' ? ' mine' : q.spotsLeft === 0 ? ' full' : '') + (sel ? ' sel' : '');

export default function QuestMap({ quests, selectedId, onSelect, area, onAreaSelect, onQuestAreas, className }: QuestMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mlRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const areasRef = useRef<Area[]>([]);
  const membership = useRef<Record<string, string>>({});
  const cb = useRef({ onSelect, onAreaSelect, onQuestAreas, area, selectedId });
  cb.current = { onSelect, onAreaSelect, onQuestAreas, area, selectedId };
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [hover, setHover] = useState('');

  // ---- build the map once ----
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled || !host.current) return;
        mlRef.current = ml;
        const load = (u: string) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); });
        const [roads, buildings, hoods, shipt] = await Promise.all([load('/data/roads.json'), load('/data/buildings.json'), load('/data/neighborhoods.json'), load('/data/shipt.json')]);
        if (cancelled || !host.current) return;

        const sp: Pt[] = shipt.polygon;
        const spBox = sp.reduce((b, [x, y]) => ({ w: Math.min(b.w, x), e: Math.max(b.e, x), s: Math.min(b.s, y), n: Math.max(b.n, y) }), { w: 1e9, e: -1e9, s: 1e9, n: -1e9 });
        const underShipt = (b: { p: Pt[] }) => {
          const cx = b.p.reduce((a, p) => a + p[0], 0) / b.p.length, cy = b.p.reduce((a, p) => a + p[1], 0) / b.p.length;
          return inRing(cx, cy, sp) || (cx >= spBox.w && cx <= spBox.e && cy >= spBox.s && cy <= spBox.n);
        };
        const roadsGJ = { type: 'FeatureCollection', features: roads.filter((r: { c: Pt[] }) => r.c.length > 1).map((r: { c: Pt[]; k: number }) => ({ type: 'Feature', properties: { k: r.k }, geometry: { type: 'LineString', coordinates: r.c } })) };
        const bldGJ = { type: 'FeatureCollection', features: buildings.filter((b: { p: Pt[] }) => !underShipt(b)).map((b: { p: Pt[]; h?: number }) => ({ type: 'Feature', properties: { h: Math.max(5, Math.min(220, b.h || 8)) }, geometry: { type: 'Polygon', coordinates: [b.p] } })) };

        map = new ml.Map({
          container: host.current,
          style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': T.bg } }] },
          center: [-86.81, 33.52], zoom: 11.2, pitch: 50, bearing: -15, minZoom: 10, maxZoom: 18.5, maxPitch: 75,
          maxBounds: [[BOUNDS.west - 0.02, BOUNDS.south - 0.02], [BOUNDS.east + 0.02, BOUNDS.north + 0.02]],
          antialias: false, fadeDuration: 0, attributionControl: false,
        });
        const m = map;
        mapRef.current = m;
        m.addControl(new ml.AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors · City of Birmingham GIS' }));

        m.on('load', () => {
          if (cancelled) return;
          // Soft satellite underlay: desaturated + washed toward the avocado palette, so the ground (trees, parks,
          // water, parking lots) reads as real while the stylised roads/buildings stay on top.
          m.addSource('sat', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18 });
          m.addLayer({ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.45, 'raster-contrast': -0.15, 'raster-brightness-min': 0.12, 'raster-brightness-max': 0.98, 'raster-hue-rotate': 12, 'raster-fade-duration': 0 } });
          m.setLight({ anchor: 'viewport', position: [1.4, 210, 55], intensity: 0.45, color: '#fff6df' });
          m.addSource('roads', { type: 'geojson', data: roadsGJ as never });
          m.addSource('bld', { type: 'geojson', data: bldGJ as never });
          m.addSource('hoods', { type: 'geojson', data: hoods });
          const byClass = (...v: (number | string)[]) => ['match', ['get', 'k'], 0, v[0], 1, v[1], 2, v[2], 3, v[3], v[4]] as never;
          m.addLayer({ id: 'roads-glow', type: 'line', source: 'roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': T.roadCasing, 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, byClass(2.6, 2.1, 1.6, 1.2, 0.9), 17, byClass(9, 7.5, 6.2, 5, 3.6)] as never } });
          m.addLayer({ id: 'roads', type: 'line', source: 'roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': byClass(...T.roads), 'line-opacity': 0.88, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, byClass(1.5, 1.2, 0.9, 0.6, 0.45), 17, byClass(6, 5, 4, 3, 2)] as never } });
          m.addLayer({ id: 'bld-line', type: 'line', source: 'bld', paint: { 'line-color': T.bldLine, 'line-width': 0.5, 'line-opacity': 0.35 } });
          m.addLayer({ id: 'bld', type: 'fill-extrusion', source: 'bld', paint: {
            'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0,
            'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], 5, T.bldLow, 30, T.bldMid, 90, T.bldHigh] as never,
            'fill-extrusion-opacity': 0.9, 'fill-extrusion-vertical-gradient': true } });
          m.addLayer({ id: 'hood-base', type: 'line', source: 'hoods', paint: { 'line-color': T.hood, 'line-width': 1.4, 'line-opacity': 0.55 } });
          // hover
          m.addLayer({ id: 'hood-fill', type: 'fill', source: 'hoods', filter: ['==', 'NAME', ''], paint: { 'fill-color': T.hoodHover, 'fill-opacity': 0.14 } });
          m.addLayer({ id: 'hood-line', type: 'line', source: 'hoods', filter: ['==', 'NAME', ''], paint: { 'line-color': T.hoodHover, 'line-width': 2.2, 'line-opacity': 0.9 } });
          // selected
          m.addLayer({ id: 'sel-fill', type: 'fill', source: 'hoods', filter: ['==', 'NAME', ''], paint: { 'fill-color': T.hoodSel, 'fill-opacity': 0.2 } });
          m.addLayer({ id: 'sel-line', type: 'line', source: 'hoods', filter: ['==', 'NAME', ''], paint: { 'line-color': T.hoodSel, 'line-width': 3.5, 'line-opacity': 1 } });

          m.addSource('shipt', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [sp] } } });
          m.addLayer({ id: 'shipt-glow', type: 'line', source: 'shipt', paint: { 'line-color': '#16b364', 'line-width': 14, 'line-blur': 8, 'line-opacity': 0.5 } });
          m.addLayer({ id: 'shipt-bld', type: 'fill-extrusion', source: 'shipt', paint: { 'fill-extrusion-height': SHIPT_HEIGHT, 'fill-extrusion-base': 0, 'fill-extrusion-color': '#16b364', 'fill-extrusion-opacity': 0.95, 'fill-extrusion-vertical-gradient': true } });
          m.addLayer({ id: 'shipt-line', type: 'line', source: 'shipt', paint: { 'line-color': '#fffdf6', 'line-width': 2 } });
          const el = document.createElement('div');
          el.className = 'landmark';
          el.innerHTML = '<div class="badge"><img src="/assets/shipt-logo.svg" alt="Shipt"></div><div class="stem"></div><div class="ring"></div>';
          el.title = shipt.name;
          el.onclick = (e) => { e.stopPropagation(); m.flyTo({ center: [shipt.lon, shipt.lat], zoom: 16.3, pitch: 62, duration: 2200 }); };
          new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([shipt.lon, shipt.lat]).addTo(m);

          areasRef.current = hoods.features.map((f: { geometry: { type: string; coordinates: Pt[][][] | Pt[][] }; properties: { NAME: string } }) => {
            const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Pt[][][];
            const rects = polys.map((p) => { let w = 1e9, s = 1e9, e = -1e9, n = -1e9; for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); } return { w, s, e, n }; });
            return { raw: f.properties.NAME, name: fixName(f.properties.NAME), polys, rects };
          });
          const areaAt = (lon: number, lat: number): Area | null => {
            for (const a of areasRef.current) for (let k = 0; k < a.polys.length; k++) {
              const r = a.rects[k];
              if (lon < r.w || lon > r.e || lat < r.s || lat > r.n) continue;
              if (inRing(lon, lat, a.polys[k][0])) return a;
            }
            return null;
          };
          let current: Area | null = null;
          m.on('mousemove', (e) => {
            const a = areaAt(e.lngLat.lng, e.lngLat.lat);
            if (a === current) return;
            current = a;
            const f = ['==', 'NAME', a ? a.raw : ''] as never;
            m.setFilter('hood-fill', f); m.setFilter('hood-line', f);
            setHover(a ? a.name : '');
          });
          m.on('click', (e) => {
            if (cb.current.selectedId) { cb.current.onSelect?.(null); return; } // click outside the popup closes it
            const a = areaAt(e.lngLat.lng, e.lngLat.lat);
            if (!a) return;
            const cur = cb.current.area;
            if (cur && cur.raw === a.raw) { cb.current.onAreaSelect?.(null); return; }
            cb.current.onAreaSelect?.({ name: a.name, raw: a.raw });
            cb.current.onSelect?.(null);
            const r = a.rects.reduce((b, x) => ({ w: Math.min(b.w, x.w), s: Math.min(b.s, x.s), e: Math.max(b.e, x.e), n: Math.max(b.n, x.n) }), { w: 1e9, s: 1e9, e: -1e9, n: -1e9 });
            m.fitBounds([[r.w, r.s], [r.e, r.n]], { padding: { top: 90, left: 40, right: 40, bottom: 120 }, maxZoom: 15, pitch: 50, duration: 900 });
          });
          setReady(true);
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Map failed to load');
      }
    })();
    return () => {
      cancelled = true;
      markers.current.forEach((mk) => mk.remove());
      markers.current.clear();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ---- which district each quest sits in (shared with the page) ----
  useEffect(() => {
    if (!ready) return;
    const next: Record<string, string> = { ...membership.current };
    const inR = (lon: number, lat: number) => {
      for (const a of areasRef.current) for (let k = 0; k < a.polys.length; k++) {
        const r = a.rects[k];
        if (lon < r.w || lon > r.e || lat < r.s || lat > r.n) continue;
        if (inRing(lon, lat, a.polys[k][0])) return a.name;
      }
      return '';
    };
    for (const q of quests) if (!(q.id in next)) next[q.id] = inR(q.lng, q.lat);
    membership.current = next;
    cb.current.onQuestAreas?.(next);
  }, [quests, ready]);

  // ---- quest pins (diffed by id, hidden outside the selected district) ----
  useEffect(() => {
    const map = mapRef.current, ml = mlRef.current;
    if (!ready || !map || !ml) return;
    const seen = new Set<string>();
    for (const q of quests) {
      seen.add(q.id);
      let mk = markers.current.get(q.id);
      const color = CATEGORY_META[q.category].color;
      if (!mk) {
        const el = document.createElement('div');
        el.innerHTML = `<div class="stem"></div><div class="ring"></div><div class="fl"><div class="hex"><i>${CATEGORY_META[q.category].emoji}</i></div><div class="bang"></div></div><div class="lbl">${esc(q.title)}</div>`;
        el.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onSelect?.(q.id); });
        mk = new ml.Marker({ element: el, anchor: 'center' }).setLngLat([q.lng, q.lat]).addTo(map);
        markers.current.set(q.id, mk);
      }
      const el = mk.getElement();
      el.style.setProperty('--c', color);
      el.className = `maplibregl-marker ${pinClass(q, q.id === selectedId)}`;
      (el.querySelector('.bang') as HTMLElement).textContent = bang(q);
      const hidden = !!area && membership.current[q.id] !== area.name;
      el.style.display = hidden ? 'none' : '';
    }
    markers.current.forEach((mk, id) => { if (!seen.has(id)) { mk.remove(); markers.current.delete(id); } });
  }, [quests, selectedId, ready, area]);

  // ---- selected district outline follows the page state ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const f = ['==', 'NAME', area ? area.raw : ''] as never;
    map.setFilter('sel-fill', f); map.setFilter('sel-line', f);
    if (!area) map.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: 0 }, duration: 400 });
  }, [area, ready]);

  // ---- fly to the selected quest ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const q = selectedId ? quests.find((x) => x.id === selectedId) : null;
    if (q) map.flyTo({ center: [q.lng, q.lat], zoom: Math.max(map.getZoom(), 15.8), pitch: 60, duration: 1200, padding: { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * 0.4) } });
    else map.easeTo({ padding: { top: 0, left: 0, right: 0, bottom: 0 }, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  return (
    <div className={className}>
      <div ref={host} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', background: T.bg }} />
      {!ready && !error && <div className="rpgb-maphint">Loading the city…</div>}
      {error && <div className="rpgb-maphint">Map data failed to load: {error}</div>}
      {hover && !area && <div className="rpgb-area"><span>Click to filter</span>{hover}</div>}
    </div>
  );
}
