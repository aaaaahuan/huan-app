// Phase 5 对照只读 huan-path/build_model.py：
// 1. “Pixel centers match the vertices”：UTM grid、GDAL bilinear/nearest parity 与 terrain_crop。
// 2. “Densify the ordered coordinate samples”：路线加密、cKDTree 距离场、底座/高度夸张。
// 3. “Data-derived feature masks”：Shapely polygonize/union/clip、地表组合及路线净距。
// 4. feature_engine / elevation_scale：实体布尔、房屋与刻度；保留面来源及颜色。
// 5. 导出 STL/彩色 3MF 后重新读取，检查尺寸、闭合性、体积与材质。
// boxSmoke 仅验证 WASM 工具链，绝不能作为任务地形产物。
export const TERRAIN_PENDING = '已完成轨迹解析与数据集获取尝试；待实现 DEM 地形网格、路线/地表/房屋/刻度及 STL/3MF 导出';
