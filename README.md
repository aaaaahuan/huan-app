# huan-app

独立 macOS 桌面应用，基础阅读与 AI 独立。已实现设置、本地收藏、原页容器、分平台会话策略，以及 Readability 页面缓存和 Pi SDK + DeepSeek 工具式伴读。

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
| `src/main/settings` | 配置加载、校验、原子保存与文件选择 IPC |
| `src/main/bookmarks` | Markdown 解析、来源读取与最近成功副本 |
| `src/main/browser` | 原生网页容器、导航、页面状态与受限 IPC |
| `src/preload` | 暴露有限的 app、settings、bookmarks 与 browser API |
| `src/renderer/src/app` | React 应用外壳 |
| `src/renderer/src/components` | 无业务状态的图标、按钮、输入、下拉、标签页与截断文本 |
| `src/renderer/src/features/settings` | 设置表单、草稿、保存与取消 |
| `src/renderer/src/features/bookmarks` | 收藏列表、搜索、平台筛选、全量滚动与折叠 |
| `src/renderer/src/features/reader` | 阅读工具栏、原生容器定位与失败占位 |
| `src/shared/contracts` | 按功能定义通信契约 |

后续模块与数据格式见 [实施约定](docs/implementation-plan.md)。不提前创建空模块、插件框架或通用服务层。

收藏卡片统一为左侧平台图标、右侧单行标题与 URL，超出省略并通过原生 tooltip 提供全文。共享控件由 props 驱动，来源卡片、会话卡片和阅读空状态留在对应功能模块；IPC 与业务状态不进入通用组件。

根目录 `tsconfig.json` 作为编辑器的项目入口，引用 Node 与 Web 两套配置。`src/renderer/src/env.d.ts` 统一声明 `window.huanApp`；声明只提供类型，实际对象由 preload 注入。

跨模块导入使用 `@shared/*`、`@main/*`、`@renderer/*`；同目录导入保留相对路径。别名同时在 TypeScript 与 electron-vite 中配置，不能用来替代 `join()` 中的文件系统路径。IPC 通道统一定义在 `src/shared/ipc-channels.ts`，通过 `IPC_CHANNELS.browser.select` 等常量引用；参数类型保留在 contracts，来源校验与处理函数保留在对应功能模块。

## 数据与 Review

正常启动使用 `~/.huan-app/`。配置保存至 `~/.huan-app/settings.json`，首次无配置时三个来源均停用。启动读取启用来源，保存设置仅重读变更来源；关窗再打开不重读，不定时扫描。只读 Markdown 表格，不修改原笔记；选中收藏后加载远程网页并在本机提取正文，不自动发起 AI 请求。

最近成功的解析结果保存在 `~/.huan-app/bookmarks/last-success.json`。保持原文件行顺序，跨文件按 X、Reddit、YouTube 拼接，以平台 + URL 去重保留第一次。成功读取反映源端删除；有效空表清空对应来源。失败仅使用同一路径的有效副本，并明确提示，来源路径变更后不会挪用旧路径的数据。停用来源不展示，但不删除其已有副本。

列表支持标题/链接搜索、平台筛选、全量滚动展示、折叠和选择，不再分页。搜索与平台筛选位于同一行，空列表仅显示浅绿色书签图标，底部不显示来源状态；读取异常仍在应用顶部提示。这些界面状态保留在本轮运行中，退出后重置。搜索与折叠不改变选中项，刷新后条目不再存在则回空状态，不自动选中其他帖子。选中收藏通过 WebContentsView 加载原页，支持前进/后退、刷新/停止；切换其他收藏后返回会重新加载原始 URL。页面内跳转不会改变选中收藏。

Review：打开右上角设置，为平台选择符合四列格式的 Markdown 文件并启用；保存后点击收藏阅读原页。原页无应用 preload，不可调用文件或设置接口。下载、非 HTTP/HTTPS 主页面导航、权限请求和 POST 弹窗暂不支持，不保证各平台第三方登录流程兼容。当前记录见 [A5/A6 验收](docs/a5-a6-review.md)，历史清单见 [A4](docs/a4-review.md)、[A2/A3](docs/a2-a3-review.md) 与 [A1](docs/a1-review.md)。

## AI 伴读

设置新增“AI 伴读”：内置唯一模型 DeepSeek Flash（`deepseek-flash`），固定官方 Chat Completions 端点。输入 API Key 后点击“保存设置”；不会读取 Pi CLI 认证、环境 Key 或用户扩展。Key 用 Electron safeStorage 加密保存为 `~/.huan-app/key-<UUID>.bin`，设置只保存引用。替换/清除 Key 不清空聊天，在途请求保留自身认证。未签名构建的 Keychain 行为需实机验证。

页面提取与 AI 独立：`page-host.ts` 监听完整导航和站内切页，加载后等待 1.5 秒，用 `readability.ts` 在隔离世界读取 DOM 副本；空结果每隔 1.5 秒重试，最多 4 次。中间视图关闭后台节流。X、Reddit 和微信文章详情页共用 Readability，YouTube 及其他页面暂不处理。不下载图片、识别视频、自动滚动或抓取外链；Readability 是尽力识别，不能保证正文完整或排除所有评论。

`page-store.ts` 在主进程保存最多 20 页、每页最多 40,000 字符的快照，超限淘汰最早记录。每次有效导航创建独立页面 ID，异步结果需匹配导航才能入库。状态区分加载中、已提取、不可用和不支持；页面关闭清当前指针，退出清内存。不向日志输出提取的正文。

聊天固定为独立会话，切换收藏不重建组件或 Agent。每次发送时冻结页面快照，经版本 2 授权后传入本机 Worker；旧版仅当前页的授权不能代替新授权。DeepSeek 先收到页面目录，按需调用唯一只读工具 `read_page` 获取正文片段；工具只能读本轮快照，不访问文件、浏览器或网络。UI 显示工具实际读取的页面来源。无页面、读取失败或拒绝授权仍可正常聊天，模型不得猜测当前帖子；快照更新在下一次发送时生效。

Pi Agent Core / Pi AI 0.87.1 运行于按需启动的 utilityProcess，API Key 仅在当前请求期间引用。每次工具最多返回 12,000 字符，通过 nextOffset 继续；每轮最多 8 次工具读取、10 次模型响应。发送前模型历史及新消息的序列化字符上限为 120,000，本轮上下文达到 240,000 时停止，不静默删除历史。聊天最多 60 回合，生成 180 秒后请求停止；SDK 网络请求不自动重试，每次输出上限 8,192 tokens。达到限制需缩小问题或新开对话。

停止和新开对话沿用 Run 生命周期及实例隔离。停止等待 Worker 收尾，失败回合不写入模型历史；停止回合仅保留问题和部分文本，不留下孤立工具调用。新开对话不清页面缓存或 API Key。消息以纯文本展示，不执行模型 HTML。退出不恢复历史；Worker 崩溃后保留 UI 记录，但需要新开对话。连接测试可能计费，不发送页面内容。

静态检查或成功打包不代表真实网站正文提取、付费模型问答和停止已验收通过。

## 登录与隐私

设置中的“登录与隐私”按平台提供“仅本次运行 / 重启后保留”。旧配置自动兼容为内存模式，不自动保存登录态。模式在本轮启动时固定，保存更改后需 Cmd+Q 完全退出重启（关窗不算）；不迁移两种模式间的 Cookie。切换至内存模式不会删除此前的持久会话，需要使用“清除会话”单独移除。

内存分区为 `huan-app-reader-<platform>`，持久分区为 `persist:huan-app-reader-<platform>`，数据目录为 `~/.huan-app/`。同平台页面复用，跨平台隔离，包括从该平台跳出的页面。登录按原站流程处理，应用不采集密码、不导入系统浏览器 Cookie，不提供账号切换；即使保存会话，平台仍可能要求重新验证。

清除操作需要原生确认，取消不改数据；确认后先关闭当前受影响网页，再清除该平台内存与持久分区的网站数据、缓存和 HTTP 认证缓存。清除期间导航串行等待，避免页面重新写回数据。选中收藏保留，点击刷新重新加载；其他平台及收藏副本不受影响。此操作不代表注销服务器上的账号会话。

每步暂停等待用户 Review。测试证据见 [A0 记录](docs/a0-review.md)，旧 S0 记录仅保留为历史。
