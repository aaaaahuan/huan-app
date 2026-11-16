// 预览与无路径导出共用地表合成规则，避免两者高度不一致。
export interface PreviewLayers { base: Float32Array; classes: Uint8Array; distance: Float32Array; forest?: Float32Array; rivers?: Float32Array; houses?: Float32Array; routeGap?: Uint8Array }
export function composePreview(layers: PreviewLayers, state: Record<string, boolean>) {
  const { base, classes, distance, forest, rivers, houses, routeGap } = layers;
  const z = new Float32Array(base.length), preClass = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    let surface = base[i], id = 0;
    if (state.forest) { surface += forest?.[i] || 0; if (classes[i] === 2) id = 2; }
    if (state.rivers && classes[i] === 1) { surface = base[i] + (rivers?.[i] || 0); id = 1; }
    if (state.grass && classes[i] === 5) id = 5;
    if (state.snow && classes[i] === 3) id = 3;
    if (state.houses && (houses?.[i] ?? 0) > 0) { surface = Math.max(surface, houses![i]); id = 6; }
    const weight = state.track === false || (state.houses && routeGap?.[i]) ? 0 : Math.max(0, Math.min(1, (.85 - distance[i]) / .13));
    z[i] = surface + weight * (Math.max(base[i], surface) - surface + .8); preClass[i] = id;
  }
  return { z, preClass };
}
