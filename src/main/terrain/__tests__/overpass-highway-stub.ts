import type { Bounds } from '../pipeline/tracks';

// Long primary way densified past roads.ts 18e6 float safety cap.
export async function overpass(_root: string, _bounds: Bounds, kind = 'natural') {
  if (kind !== 'highway') return { doc: { elements: [] }, source: { available: true, stub: true } };
  const geometry = Array.from({ length: 3 }, (_, i) => ({ lon: 120 + i * 0.5, lat: 30 }));
  return {
    doc: { elements: [{ type: 'way', id: 1, tags: { highway: 'motorway' }, geometry }] },
    source: { available: true, stub: true }
  };
}
