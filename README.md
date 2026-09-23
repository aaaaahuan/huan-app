# huan-app

独立 macOS 桌面应用，基础阅读与 AI 分开建设。当前为 A0 工程调整，等待 Review；设置、Obsidian 收藏读取、原页和 AI 尚未接入。

## 开发与验证

开发需要 macOS、Node 24.16.0、pnpm 10.12.1；首次安装需要下载 Electron。最终用户不需要 Node 或 pnpm。

```sh
nvm use
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install --frozen-lockfile
pnpm dev
# 退出开发应用后执行
pnpm check
pnpm pack:arm64
```

产物：`release/mac-arm64/huan-app.app`。Intel 使用 `pnpm pack:x64`，需真机另行验收。当前未签名、未公证，不用于公开发行。图标使用已确认的原设计 `build/icon.png`，由 electron-builder 转换为 macOS 图标资源。

当前不引入自动化测试框架。`pnpm check` 仅执行类型检查、Lint 和生产构建；运行行为通过每步人工 Review 验证。

`pnpm build` 仅生成 `out/`。`pnpm pack:arm64` 先执行 build，再由 electron-builder 按 `electron-builder.yml` 将编译结果、运行依赖、Electron 和图标打包到 `release/mac-arm64/huan-app.app`。`--dir` 只生成应用包，不生成 DMG/ZIP，也不自动复制到桌面。

生产模式加载 `app://ui/index.html`，不依赖开发服务器或 huan-cli。主进程编译为 `out/main/index.js`，preload 为 `out/preload/index.js`。

## 工程边界

| 路径 | 职责 |
| --- | --- |
| `src/main/index.ts` | 应用启动入口 |
| `src/main/app` | 窗口、生命周期、资源协议与 IPC 安全 |
| `src/preload` | 当前仅暴露 `window.huanApp.app.getStatus()` |
| `src/renderer/src/app` | React 应用外壳 |
| `src/shared/contracts` | 按功能定义通信契约 |

后续模块与数据格式见 [实施约定](docs/implementation-plan.md)。不提前创建空模块、插件框架或通用服务层。

## 数据与 Review

正常启动使用 `~/.huan-app/`。A0 不创建数据库、不读取收藏、不运行后台业务进程。旧 Companion 目录与旧桌面应用不自动迁移或删除。

Review：确认标题为 huan-app，显示「应用连接正常」；重新检查连接有效；关闭窗口后 Dock 可以恢复，Cmd+Q 才退出。此页面不代表收藏、登录或 AI 已实现。

每步暂停等待用户 Review。测试证据见 [A0 记录](docs/a0-review.md)，旧 S0 记录仅保留为历史。
