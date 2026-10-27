// readRasters 不传 pool：当前线程已隔离整个任务，无需嵌套解码线程。
// 上游 web-worker 在任意 Node worker import 时会把 workerData 当自己的启动协议。
// 构建时仅替换此可选 Pool 后端，避免导入副作用；误用 Pool 时明确失败。
export default class UnsupportedRasterPool {
  constructor() { throw new Error('地形 worker 内不支持 GeoTIFF Pool；请使用当前线程解码'); }
}
