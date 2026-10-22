// 服务地址仅由主进程提供；嵌入页面自行复用原有同源上传与预览接口。
export type TerrainStatus = { ok: true; url: string } | { ok: false; message: string };
export interface TerrainAPI { autoRoot(): Promise<string>; ensure(): Promise<TerrainStatus> }
