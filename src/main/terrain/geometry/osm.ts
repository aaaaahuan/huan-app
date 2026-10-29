import proj4 from 'proj4';
import { z } from 'zod';
import type { Bounds } from '../pipeline/tracks';
import type { HeightGrid } from './terrain';
import type { OsmDocument } from '../datasets/overpass';
import type { FeatureConfig } from '../config';

const point = z.object({ lon: z.number().finite().min(-180).max(180), lat: z.number().finite().min(-90).max(90) });
const geometry = z.array(point);
const member = z.object({ type: z.string(), role: z.string().optional(), geometry: geometry.optional() });
const shapeElement = z.object({ type: z.string(), geometry: geometry.optional(), members: z.array(member).optional() });
type Kind = 'river' | 'stream' | 'lake' | 'water_polygon' | 'forest' | 'glacier';
export interface OsmMasks { river: Uint8Array; lakes: Uint32Array[]; forest: Uint8Array; snow: Uint8Array; report: Record<string, unknown> }

// GEOS 对象仅存活于单次 worker 构建；所有拥有的指针在 finally 释放，借用子几何不释放。
export async function osmMasks(raw: OsmDocument, grid: HeightGrid, bounds: Bounds, zone: number, south: boolean, cfg: FeatureConfig): Promise<OsmMasks> {
  const { default: initGeos } = await import('geos-wasm');
  const geos = await initGeos({ errorHandler: message => { throw new Error(`OSM 拓扑运算失败：${message}`); } });
  const owned = new Set<number>(), reader = geos.GEOSWKTReader_create();
  const own = (p: number) => { if (!p) throw new Error('GEOS 未返回有效几何'); owned.add(p); return p; };
  const wkt = (text: string) => {
    const n = Buffer.byteLength(text) + 1, p = geos.Module._malloc(n);
    try { geos.Module.stringToUTF8(text, p, n); return own(geos.GEOSWKTReader_read(reader, p)); }
    finally { geos.Module._free(p); }
  };
  const projection = proj4('EPSG:4326', `+proj=utm +zone=${zone} ${south ? '+south' : ''} +datum=WGS84 +units=m +no_defs`);
  const line = (points: z.infer<typeof geometry>) => points.map(p => projection.forward([p.lon, p.lat]));
  const coords = (points: number[][]) => points.map(p => p.join(' ')).join(',');
  function polygonize(lines: number[][][]) {
    if (!lines.length) return wkt('POLYGON EMPTY');
    const multi = wkt(`MULTILINESTRING (${lines.map(l => `(${coords(l)})`).join(',')})`);
    const union = own(geos.GEOSUnaryUnion(multi)), p = geos.Module._malloc(4);
    try { geos.Module.HEAP32[p / 4] = union; return own(geos.GEOSUnaryUnion(own(geos.GEOSPolygonize(p, 1)))); }
    finally { geos.Module._free(p); }
  }
  const groups: Record<Kind, number[]> = { river: [], stream: [], lake: [], water_polygon: [], forest: [], glacier: [] };
  const counts: Partial<Record<Kind, number>> = {}, skipped: { type: string; id: number; reason: string }[] = [];
  try {
    const clip = wkt(`POLYGON ((${bounds[0]} ${bounds[1]},${bounds[2]} ${bounds[1]},${bounds[2]} ${bounds[3]},${bounds[0]} ${bounds[3]},${bounds[0]} ${bounds[1]}))`);
    for (const el of raw.elements) {
      const t = el.tags ?? {};
      const kind: Kind | undefined = el.type === 'way' && (t.waterway === 'river' || t.waterway === 'stream') ? t.waterway
        : t.natural === 'water' ? ['river', 'stream', 'canal'].includes(t.water) ? 'water_polygon' : 'lake'
          : t.landuse === 'forest' || t.natural === 'wood' ? 'forest' : t.natural === 'glacier' ? 'glacier' : undefined;
      if (!kind) continue;
      counts[kind] = (counts[kind] ?? 0) + 1;
      const e = shapeElement.parse(el); let shape = 0;
      if (e.type === 'way') {
        const points = line(e.geometry ?? []);
        if ((kind === 'river' || kind === 'stream') && points.length >= 2) shape = wkt(`LINESTRING (${coords(points)})`);
        else if (points.length >= 4 && points[0].every((v, i) => v === points[points.length - 1][i])) {
          const ring = wkt(`LINESTRING (${coords(points)})`);
          if (geos.GEOSisRing(ring) === 1) shape = wkt(`POLYGON ((${coords(points)}))`);
        }
      } else if (e.type === 'relation') {
        const outer: number[][][] = [], inner: number[][][] = [];
        for (const m of e.members ?? []) if (m.type === 'way' && (m.geometry?.length ?? 0) >= 2) (m.role === 'inner' ? inner : outer).push(line(m.geometry ?? []));
        if (outer.length) shape = own(geos.GEOSDifference(polygonize(outer), polygonize(inner)));
      }
      if (!shape || geos.GEOSisEmpty(shape) === 1) { skipped.push({ type: el.type, id: el.id, reason: 'No usable line/closed polygon; point water cannot define a lake area' }); continue; }
      if (geos.GEOSisValid(shape) !== 1) shape = own(geos.GEOSBuffer(shape, 0, 16));
      shape = own(geos.GEOSIntersection(shape, clip));
      if (geos.GEOSisEmpty(shape) !== 1) groups[kind].push(shape);
    }
    function mask(shapes: number[]) {
      const result = new Uint8Array(grid.width * grid.height), p = geos.Module._malloc(8);
      try {
        for (const shape of shapes) {
          const prepared = geos.GEOSPrepare(shape);
          const limits = [geos.GEOSGeom_getXMin, geos.GEOSGeom_getYMin, geos.GEOSGeom_getXMax, geos.GEOSGeom_getYMax].map(fn => { fn(shape, p); return geos.Module.getValue(p, 'double'); });
          const index = (v: number, axis: number) => (v - bounds[axis]) / (bounds[axis + 2] - bounds[axis]) * ((axis ? grid.height : grid.width) - 1);
          try {
            for (let y = Math.max(0, Math.ceil(index(limits[1], 1))); y <= Math.min(grid.height - 1, Math.floor(index(limits[3], 1))); y++) for (let x = Math.max(0, Math.ceil(index(limits[0], 0))); x <= Math.min(grid.width - 1, Math.floor(index(limits[2], 0))); x++) {
              const px = bounds[0] + x * (bounds[2] - bounds[0]) / (grid.width - 1), py = bounds[1] + y * (bounds[3] - bounds[1]) / (grid.height - 1);
              const hit = geos.GEOSPreparedIntersectsXY(prepared, px, py);
              if (hit === 2) throw new Error('OSM 掩膜查询失败');
              if (hit) result[y * grid.width + x] = 1;
            }
          } finally { geos.GEOSPreparedGeom_destroy(prepared); }
        }
      } finally { geos.Module._free(p); }
      return result;
    }
    function polygons(shape: number): number[] {
      if (geos.GEOSGeomTypeId(shape) === 3) return [shape];
      return Array.from({ length: geos.GEOSGetNumGeometries(shape) }, (_, i) => geos.GEOSGetGeometryN(shape, i)).flatMap(child => child === shape ? [] : polygons(child));
    }
    const rivers = [...groups.river.map(g => own(geos.GEOSBuffer(g, cfg.rivers.river_width_mm / 2 / grid.scale, 16))), ...groups.stream.map(g => own(geos.GEOSBuffer(g, cfg.rivers.stream_width_mm / 2 / grid.scale, 16))), ...groups.water_polygon];
    return { river: mask(rivers), lakes: groups.lake.flatMap(polygons).map(p => { const m = mask([p]), indices: number[] = []; for (let i = 0; i < m.length; i++) if (m[i]) indices.push(i); return Uint32Array.from(indices); }), forest: mask(groups.forest), snow: mask(groups.glacier), report: { source_counts: counts, clipped_counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), skipped_osm: skipped, topology: 'GEOS 3.13; polygonize(unary_union(outer)) minus inner; buffer(0); crop before river buffer; vertex-centre intersects masks' } };
  } finally { for (const p of owned) geos.GEOSGeom_destroy(p); geos.GEOSWKTReader_destroy(reader); }
}
