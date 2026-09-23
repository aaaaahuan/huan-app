// 为页面的 window.huanApp 提供类型提示；真正的对象由 preload 注入。
import type { HuanAppAPI } from '@shared/contracts/app';
declare global {
  interface Window {
    // 声明仅供应用自己的 React 页面使用；远程网页不注入此对象。
    readonly huanApp: HuanAppAPI;
  }
}
