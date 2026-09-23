# A0 Review

## 最新确认

后续按用户要求移除整个 scripts 目录与 `check:boundaries` 命令；当前 `pnpm check` 只含类型检查、Lint 和构建。下方边界扫描结果属于移除前的历史记录。

用户已在普通桌面会话中打开验证，确认运行正常。下方 SIGABRT 是当时自动化执行环境中的历史记录，不能据此继续认定用户桌面启动失败。按用户要求移除测试文件、测试框架、测试配置、脚本与专用 profile 入口；保留类型检查、Lint、构建、静态边界检查和人工 Review。图标改用之前确认的设计，不重新生成。

本轮整理验证：`pnpm check` 和 `pnpm pack:arm64` 通过；依赖清单与锁文件已无 Vitest/Playwright，旧测试报告已清除。打包后的 Info.plist 指向 icon.icns，应用资源目录已包含从 build/icon.png 转换的图标。桌面应用替换须先退出正在运行的实例；打包成功不代表已经替换桌面版本。

统一名称与目录，移除 SQLite 及无用后台探针，保留最小窗口/IPC 验证。旧数据与旧桌面应用不删除；设置、收藏和 AI 尚未实现。

## 测试结果

环境：2026-09-21，macOS 14.7.8 / arm64，Node 24.16.0，pnpm 10.12.1，Electron 44.4.3。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | 通过，锁文件与依赖一致 |
| `pnpm check` | 通过：类型、Lint、4 项单测、构建、边界检查 |
| `pnpm pack:arm64` | 通过，生成 huan-app.app；未签名公证 |
| `pnpm test:e2e` | 未通过，Electron 原生启动 SIGABRT，未到界面断言 |
| 代码静态 Review | 未发现需修改问题；不替代运行验收 |
| SQLite / 旧工程命名检查 | src、out、依赖锁文件及打包配置无残留引用 |

新包已复制至 `/Users/bytedance/Desktop/huan-app.app`，旧 `伴读.app` 未删除。Intel、macOS 13 和最终签名公证均未验证。

S0 的 SIGABRT 仍然存在，移除 SQLite 后依然发生，不能认定由数据库导致，也未证实是当前工具环境限制。当前交付状态为「代码调整完成，运行验收阻塞」，不进入 A1。

## 用户 Review

1. 双击新的 huan-app.app，确认窗口名称与「应用连接正常」。
2. 点击「重新检查连接」，确认正常返回；收藏和 AI 应明确显示尚未接入。
3. 关闭窗口后从 Dock 恢复，再通过 Cmd+Q 退出。
4. 如果无法启动，请保留系统提示或崩溃现象；不可关闭系统或 Electron 安全机制规避。

本轮仅修改新工程；未修改 Obsidian 原始收藏与旧 huan-cli，也未提交 Git commit。
