# 3d工作台

未指定自定义目录时，模型库读取 `/Users/huan/Desktop/workspace/huan/huan-model/models/3d-model` 的直接子目录。左侧以目录名展示收藏及总文件大小（包含压缩包、图片和辅助文件），仅支持选择，不提供创建、编辑、删除或导出操作。重新进入页面会重新读取目录。

右侧递归枚举 STL、3MF、OBJ、GLB、GLTF、Blend，单次仅加载一个文件；多个文件通过下拉菜单切换。支持拖动旋转、滚轮缩放和右键平移。GLTF 仅支持内嵌资源，外置贴图或缓冲应先打包为 GLB；OBJ 使用网格，不加载外部 MTL。压缩包不作为可预览模型。

Blend 通过本机 `/Applications/Blender.app` 后台导出 GLB，禁用内嵌脚本，超时两分钟。预览缓存在应用 userData/huan-studio 目录，以源文件路径、大小、修改时间区分，不修改源文件。初次加载可能较慢。

所选模型所在目录的 `pic/` 存放实物照片（JPG、PNG、WebP、GIF）。有照片时右上显示缩略图，点击展开全部照片，再点击照片用弹窗放大，Escape 关闭；没有照片时隐藏入口。例如 `angel-wings/pic/成品.jpg`，或者嵌套模型 `project/stl/model.stl` 对应 `project/stl/pic/`。

文件读取只在主进程进行，IPC 校验可信来源及路径边界，不允许符号链接越界。页面使用现有 Three.js，不新增依赖；切换模型和离开工作台释放场景资源。图片经主进程读取为 data URL，生产 CSP 仅增加本地 data/blob 图片支持。

原掌心草模的生成源及素材仍保留，历史素材来源：Innerscene 的 Posable anatomical right hand，CC0 1.0。该固定草模不再作为当前展示入口。
