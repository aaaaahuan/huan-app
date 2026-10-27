# 原生地形迁移架构（Phase 0）

参考基线：只读 huan-path `4e7f285c84967a1772757bb25f15ff61934f11aa`。目标分支 `feat/native-terrain`，最终运行时不依赖 Python、HTTP 服务或 iframe。本文区分当前脚手架与后续目标；Phase 0 不实现构建流程，不新增依赖，不写作品库。

## 当前状态与迁移方式

`bootstrap.ts` 继续调用 `service.ts` 的 `registerTerrain`；该文件成为兼容门面，原实现原样移到 `python-service.ts`。preload、Terrain.tsx、端口、进程生命周期、设置切换与 iframe 均保持原行为。新增通道只是预留常量，没有注册 handler，也不向 window.huanApp 暴露未完成方法。

本分支采用最终硬切换，不增加长期 feature flag：先补原生只读库与资源访问，再开发独立原生工作台和流水线；原生全链路验收后一次切换 bootstrap/preload/Terrain，删除 Python 启动器、root.ts 中 Python 路径探测与 loopback CSP。中途不能让新旧调度器同时写同一作品。设置 `settings.terrain.dataDir`、开发默认 terrain-data、安装默认 userData 的含义不变。

## 模块地图与目录

带「本期」的是 Phase 0 实际文件；其他是后续实施目标，避免用空实现冒充能力。

```text
src/shared/contracts/terrain.ts       # 本期：兼容状态类型、Zod 持久化结构、原生读写请求边界
src/main/terrain/
  service.ts                         # 本期：兼容门面；最终组装原生服务
  python-service.ts                  # 本期：原 service 原样搬迁，最终删除
  root.ts                            # 现有目录设置；最终仅保留原生数据根逻辑
  library.ts                         # 本期占位：枚举、summary、按 ID 读取、房屋判断保存
  assets.ts                          # 本期占位：作品资源安全解析与响应
  ipc.ts                             # 目标：可信 sender + Zod 校验，业务错误转中文结果
  pipeline/index.ts                  # 本期占位：队列、重试、锁、worker 生命周期
  pipeline/state.ts                  # 目标：8 阶段、原子 status、attempts、日志
  pipeline/tracks.ts                 # 目标：KML/KMZ、照片索引、canonical、轨迹归档
  pipeline/photos.ts                 # 目标：方向校正、缩略图、人工/OSM/视觉判断
  pipeline/export.ts                 # 目标：STL、彩色 3MF、校验、独立网页打包
  datasets/index.ts                  # 本期占位：DEM/WorldCover/OSM 获取与缓存
  datasets/network.ts                # 目标：代理、超时预算、来源记录、镜像降级
  datasets/raster.ts                 # 目标：拼接、裁剪、重投影、采样
  geometry/index.ts                  # 本期占位：网格、布尔与 GIS 数值适配边界
  geometry/terrain.ts                # 目标：地形、路线、地表分类
  geometry/features.ts               # 目标：水系、林区、房屋、海拔刻度
  overlays/index.ts                  # 本期占位：道路、聚落、地名，仅预览
src/workers/terrain.ts               # 目标：worker_threads 内执行 CPU/WASM 构建
src/renderer/src/features/terrain/
  Terrain.tsx / terrain.css          # 本期不改，最终切换原生入口
  native.ts                          # 本期占位：原生视图边界
  Workbench.tsx / WorkList.tsx        # 目标：导航、模糊搜索、上传/进度/预览选择
  UploadView.tsx / ProgressView.tsx   # 目标：上传、阶段明细、失败重试
  useTerrain.ts                      # 目标：轮询、目录修订、过期结果丢弃
  viewer/Viewer.tsx                   # 目标：Three 场景与资源释放
  viewer/features.ts / places.ts     # 目标：图层重组、地形遮挡与标签布局
  viewer/photos.ts                   # 目标：照片、房屋编辑
```

main 管理目录、网络、任务及 Electron 能力；worker 只接受主进程确定的任务目录与结构化配置，不直接暴露给 renderer。默认最多两个活动任务（对应 Python executor），同一作品重试、导入与编辑互斥。配置变更先停止/等待旧 worker，丢弃旧目录修订结果；退出中断写入时必须保留最近有效 status。复用 settings 的校验与原子替换原则；worker 打包入口、WASM 位置和安装包 asar 资源需在引入时配置验证。

## IPC 与资源取代 HTTP

统一前缀 `huan-app:terrain:`。所有未来 handler 经 bootstrap 注入的 assertTrusted 验证主窗口主 frame，再解析 Zod 入参；preload 使用固定方法，不提供任意通道或任意本机路径访问。Phase 0 只保留已接通的 ensure/autoRoot。

| HTTP / 行为 | 原生通道（本期预留） | 目标语义 |
| --- | --- | --- |
| health / 初始化 | ensure、status、autoRoot | ensure 未来初始化原生服务；status 无启动副作用，返回服务就绪/忙碌/错误；当前 ensure 仍返回 iframe URL |
| GET /api/jobs | listJobs | 无参数；返回 summary 数组及损坏条目的诊断，按 ID 逆序 |
| GET /api/jobs/:id | getJob | `{id}`，返回 summary，供 1 秒进度轮询；列表 5 秒刷新 |
| POST /api/jobs | upload | `{filename, content: Uint8Array, defer?}`，最大 150,000,000 字节、非空 KML/KMZ；主进程复核，任务内暂存；不接受源文件路径 |
| POST /api/jobs/:id/retry | retry | `{id}`；快照旧状态至 attempts，复位阶段，拒绝活动任务 |
| GET/POST houses | getHouses、saveHouses | `{id}` / `{id, points}`；照片索引完整且唯一，布尔或 uncertain，reason 最长 500，source=manual；保存后提示重建应用 |
| POST roads | importRoads | `{id, filename, content}`，最大 50,000,000 字节 JSON/GeoJSON/OSM/XML；支持 defer 后导入再启动；失败提示但继续作品生成 |
| 下载 /models | openModelsDir、exportModel | `{id}` / `{id, format: stl\|3mf}`；shell 打开已校验目录，或原生另存为对话框；无任意输出路径参数 |
| /jobs/:id/web/*、models/* | 专用只读 terrain 协议 | 不把 HTML/JS 当特权应用执行；原生 viewer 仅读资产；导出独立网页仍可包含受控模板 |

原生操作返回 `{ok:true,...}` 或 `{ok:false,message}`；upload/retry 返回持久化 status；getJob 返回 summary。房屋/道路详细响应 schema 在实施阶段按原文件格式补齐，不虚构空数据。status 不复用旧 TerrainStatus（旧类型专门描述 Python URL）。本期不扩展 TerrainAPI，避免向 renderer 承诺不存在的能力。

专用协议建议 `terrain://jobs/<id>/web/<relative>`，app ready 前声明，只在 UI session 注册，允许 GET；协议需检查可信 UI 来源上下文并仅提供当前数据根内 completed 作品的白名单资源。先校验 ID，再 realpath 验证文件及基目录均在当前 jobs 根内，拒绝 symlink 越界、编码分隔符、遍历、其他目录与非白名单后缀。返回精确 MIME/nosniff，不提供脚本执行入口；生产 CSP 仅为资源添加必要的 terrain scheme，不放开远程脚本或特权 UI。metadata 内相对路径按所属资源解析，不信任绝对路径、旧 preview_url 或 file URL。大二进制通过流响应而非 IPC 拷贝；上传复制峰值与取消后的临时文件清理需专项验证。

## 已有作品兼容

直接枚举数据根 `jobs/*/status.json`，不调用 create_job、不自动导入参考库、不要求重建。状态字段保留 snake_case 与 Unix 秒；阶段固定 parse/dem/terrain/features/photos/scale/export/preview。支持省略或 null 的耗时、迁入作品 origin、旧 worker_pid（仅诊断，不能据此终止进程）。Zod 对持久化对象允许未知字段，避免后续保存丢失旧元数据；入参则严格校验。

summary 按 app/library.py：先复制 status；name 依次取 status.name、metadata.route_info.name、filename；date 来自 route_info.date；photo_count 来自 photos.total；house_count 来自 houses.placed_points 长度；uncertain_houses 统计 data/photo_houses.json 的 uncertain；house_method 来自其 method。缺失或 JSON 损坏的可选 metadata/houses 采用参考默认值；必需 status 损坏须显示诊断，不能隐藏整个列表。web/metadata.json、网格 bin、照片、GLB 与 models/terrain.stl、terrain.3mf 直接读取；缺少可选图层显示不可用，缺少必要网格明确失败，不能要求用户重建才能查看一份原来可用的作品。

启动恢复应区分本次原生任务与遗留状态；对中断的 queued/running 给出可重试状态，不因不可靠旧 PID 判断杀进程。completed 永不自动改写。迁入作品 preserve_imported_assets、原比例、人工判断和照片日期警告在重试时仍保留。

## 几何与数据技术选型

以下是实施方案，尚未安装或验证软件包版本，不代表数值等价已成立。

- 首选 manifold-3d WASM：与 Python manifold3d 同库家族，用于房屋/地形/刻度实体布尔及封闭性校验；保持面来源与材质索引，显式释放 WASM 对象。不能用 three 的可视网格替代可打印实体。
- geotiff：计划解码真实 Copernicus GLO-30 与 ESA WorldCover；不把 TIFF 解码等同于 rasterio/GDAL。需自行实现与基线一致的像元中心、NODATA、拼接、bilinear DEM 和 nearest 分类重投影。裁剪 TIFF 输出是否需额外编码器由实际产物兼容验证决定。
- proj4：计划 WGS84 ↔ 按轨迹选定的 UTM，与 app/tracks.py 的 CRS 规则一致，不加 GCJ 偏移；验证轴序、边界和毫米比例。
- Shapely 等价层优先评估 GEOS WASM（例如 geos-wasm），因为基线依赖 polygonize/unary_union/buffer(0)/difference/距离与投影净距，简单点在多边形或单一 clipping 包不足。隔离在 geometry 边界，先验证 multipolygon 孔洞/修复/精度再定依赖，必要时才增加 polygon-clipping；不自行近似替换拓扑操作。
- scipy/numpy 等价数值操作用 TypedArray 实现确定性的距离场、KD 查找、采样与网格索引；严格对比 distance_transform_edt/map_coordinates 的边界规则。STL writer、3MF ZIP/XML 与读取校验独立于渲染；ZIP、XML、图片 EXIF/缩放所需包按实际解析需求通过 pnpm 添加。Three 仅用于 renderer 预览，原参考 vendor 不直接混入仓库。

网络完全保留 datasets.py 的策略：Copernicus DEM GLO-30、ESA WorldCover 2021，真实缓存、来源与许可记录。Overpass 服务端 90 秒、单次客户端 105 秒、镜像共享 240 秒，道路/聚落另留 60 秒 OSM API；剩余不足 20 秒停止尝试；只有完整 105 秒耗尽才降级，成功后解除，本进程内稳定排序。普通镜像 kumi/private.coffee/overpass-api.de，道路与聚落另含 maps.mail.ru；缓存键继续使用旧 `[timeout:25]` 文本 SHA256 前 24 位。主 API /map 面积超限或 HTTP 400 分块（深度上限 12），节点/way 去重，509 普通失败。**/map 回退丢弃 relations**，聚落面积可能不完整，沿用来源与警告，不拼造缺失区域。

代理策略需复刻 config 优先、环境及 macOS 系统代理回退、off 直连与回环直连；凭据不能进 argv、日志或作品配置。参考使用 curl，原生阶段评估 Electron net/session 与代理兼容，不能误认为 Node fetch 自动跟随系统代理。失败按参考阶段决定终止或带 warning 降级，绝不伪造 DEM、OSM 或按海拔猜雪线。network 配置不写进作品 config。

## UI 对齐

React 直接组合工作台及 viewer，不加载保存作品中的脚本。导航搜索严格复刻 NFKC、小写、移除空白、前缀/子串/字符顺序分级、同分保持原顺序，并处理输入法；收起清除筛选。新建入口仅工具栏「＋ 新建作品」、brand、默认上传视图，侧栏不新增按钮。中文加载/空/失败提示、焦点与键盘操作沿用组件库，无状态公共控件放 components。

viewer 对齐 web/features.js 的地表组合顺序、路线间隙、河流/湖泊、林区/草地/冰雪、房屋、海拔刻度和照片；道路宽度按视距调整、仅预览；居民区覆盖避让水/路线/房屋，地名最多 400、等级/人口排序。places.js 的 anchor→camera 地形射线遮挡与 120ms 节流、镜头停止补算、标签防重叠及切换地表后的重新锚定要原样迁移。图层加载失败显示禁用与原因。图层开关不修改 STL/3MF；道路/聚落刷新不能改打印文件。保留照片人工判断、可选视觉 API 与 OSM 附近建筑推断，未配置视觉服务不暗中调用远端。

## 验证计划

本期只做类型检查、针对改动文件的 lint 与构建验证，不新增测试框架、脚本或依赖。后续按仓库 AGENTS.md 默认通过直接启动应用与 computer-use 自主验收；下列 unit 粒度检查先以临时执行方式完成，若要持久化测试套件另行明确范围。

1. unit 粒度：Zod 接受真实旧 status/summary、拒绝非法 ID/字节数；summary 默认值；路径遍历/符号链接；搜索排名；原子替换故障；超时预算/降级排序；OSM 缺节点/relations/孔洞；像元中心、NODATA 与投影采样。临时夹具/假网络仅验证失败分支，不作为产品假地形来源。
2. 一次完整 parity build：选一份小轨迹，记录输入 hash、基线 commit、同一真实数据快照与配置。Python 仅作为开发比对工具，代码只读，以 /tmp 下独立 jobs/tracks/cache 工作副本构建；先审计其硬编码 ROOT/cache 路径，必要时把源码复制到临时目录运行，绝不在参考目录运行会落盘的 import。TS 用另一临时根，不接触真实 terrain-data/jobs。
3. 对比阶段/警告、路线/投影/边界、分类栅格、照片与房屋点、图层长度、尺寸/体积、封闭性/绕序/底面、房屋路线净距、3MF 材质及序列化后独立读取校验。浮点容差先按基线采样误差明确记录，不能以文件字节不相同直接判断失败，也不能放宽容差掩盖拓扑变化。
4. Electron 验收旧完成作品无需重建、新上传/重试/取消选择/目录快速切换、各层开关、地名遮挡、房屋编辑、道路导入失败继续生成、下载、退出和安装包离线启动。只读快照检查真实库未改动；所有会生成作品的验证使用临时 settings/dataDir。

## 后续实施顺序

1. Phase 1：原生只读 library + assets 安全边界与契约，临时旧作品夹具验收；保持现有入口，不触发 Python 或写真实库。
2. Phase 2：原生工作台/Three viewer、旧资源兼容、搜索/图层/遮挡；通过开发独立入口验收后准备切换。
3. Phase 3：轨迹/照片、安全 ZIP/XML、状态与 worker 调度、真实数据下载/缓存/代理；在临时根完成各阶段，不先造假网格打通 UI。
4. Phase 4：几何/WASM、地表/路线/房屋/刻度、STL/彩色 3MF、网页导出与小轨迹 parity build。
5. Phase 5：房屋/道路编辑补齐、聚落/标注、异常恢复及打包验收；一次硬切，移除 Python/HTTP/iframe 依赖，确认无 Python 环境仍可完整使用。

主要风险：GDAL/GEOS/scipy 的数值等价、WASM 打包和内存、旧 metadata 版本差异、系统代理、导出网页的本地资源与许可、视觉 API 当前配置边界。依赖具体版本、误差阈值与大上传传输方式必须在相应阶段实测定案，不阻塞本期脚手架。
