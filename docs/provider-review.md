# 统一 Provider 与在线／离线切换

日期：2026-10-07。范围：开发态，复用现有 Qwen 权重与 llama.cpp b11429；不是模型质量或速度的新一轮基准。

## 实现边界

- 顶部切换在线／离线；在线候选目前只有 DeepSeek Flash，默认在线，选择保存到既有 settings v1 的可选默认字段 `model`。
- 聊天仍为同一个 Pi Agent，会话、工具、流式文本、停止和笔记审批不分叉；翻译仅进行一次独立调用，不带聊天历史或工具。
- 主进程冻结本轮目标和认证，Worker 使用共享 Provider 适配。聊天和翻译共享一个 Worker、一个驻留本地进程，单 slot 排队；没有额外代理、下载器、依赖或权重打包。
- 本地 Provider 标识为 `Qwen-3.5-4B-local`，模型 ID 仍为 `Qwen3.5-4B`，不改变已有权重文件或路径。
- 模型切换只作用于下一请求，不清历史或草稿；保存期间新提交及快捷键均受保护，停止仍可用。离线历史交给在线模型前需明确确认，无静默云回退。
- 离线只控制 AI 推理；浏览网站和获取字幕仍需网络。外部模型路径和启动预热保持原约定，打包态仍需显式配置包外路径。

## 已完成验证

真实 llama-server 由本次开发应用启动，直接导入同一 Provider 源码验证，不使用模型 mock、不新增测试文件或脚本，不读取用户笔记，也不输出认证令牌。

| 场景 | 结果 |
| --- | --- |
| 独立翻译 | `Could you give me a hand?` → `能帮帮我吗？`，stopReason=stop，收到 5 个文本增量；该次约 1.27 秒，仅单样本观察 |
| Pi 工具闭环 | 使用只返回公开测试事实的 `lookup_demo`，模型实际调用 1 次工具并回复 `示范鸟是猫头鹰。`，stopReason=stop，7 个文本增量 |
| 连续对话 | 同一 Agent 记住公开测试事实中的鸟名，下一轮正确回答 `小松`，stopReason=stop |
| 流式停止与恢复 | 收到 5 个文本增量后 AbortSignal 取消，stopReason=aborted；后续新请求正确返回 `OK` |
| 单 slot 排队取消 | 长请求生成时提交第二请求；第二请求尚无响应头时取消，两条请求均确认 aborted，没有等待 SDK 超时 |
| 在线注册 | 校验内置 DeepSeek Flash、openai-completions 及官方 baseUrl；没有发起云端调用，此项不是在线问答验收 |

验证发现默认 Node HTTP 连接池复用时，工具调用后的第二次请求可能出现 ECONNRESET；本地 transport 改为 `agent:false`，每次新连接，不自动重试。保留 `node:http` 流式 Response，只绑定调用者 AbortSignal，不继承 fetch 响应头等待上限或云端 SDK 预算。本地聊天与翻译均使用 `max_tokens=-1`，没有新增本地输出限制。

只读审查发现并修复：迟到模型配置读取覆盖新选择、本地聊天无意继承在线输出限制、切换保存期间旧离线标签可能对应新在线请求。最终复核未发现必须修复的新缺陷。

`pnpm check` 通过 TypeScript、ESLint、生产构建；`git diff --check` 无空白错误。保留已有 Zod Rollup 注释告警，未新增测试框架、依赖或模型文件。

## 待验证边界

当前 Mac 锁屏，native computer-use 无法操作开发窗口；已请求用户解锁。界面切换、实际 IPC 聊天与翻译、在途切换、离线历史转云确认、云端请求以及正常退出清理尚不能宣称完成本轮实机验收。本次启动的开发服务器、Electron 和模型进程已通过精确 PID 终止并核对不存在；这不是 Cmd+Q 正常退出验收，未修改用户设置、凭据或笔记。

未模拟系统断网、完整 262K 上下文、超长排队、Metal 致命故障、Intel 或打包版。小模型与 DeepSeek 的答案和工具选择质量不等价；相同 Agent 和工具接口不构成相同回答质量保证。

## 2026-10-14 离线启动修复

实际打包版的失败 Run 在 `model.selected` 之前结束，日志中的原因是缺少 `HUAN_MODEL_PATH` 和 `HUAN_LLAMA_SERVER_PATH`。Finder 启动的安装包没有开发默认路径，原实现仅支持启动环境提供路径；翻译结果又遗漏原始 warning，仅显示 `EXECUTION_FAILED`。此外，工程移入 `llm/huan/huan-app` 后，同级 `../model` 也与本机资源位置不符。

在既有 AI 设置中增加本地权重、llama-server 两条路径，沿用 settings 原子保存、修订校验与草稿机制。新程序路径保存前通过原生对话框确认执行，默认取消。启动按环境变量、已保存路径、开发默认目录的顺序解析；开发默认目录兼容 `../model` 和 `../../model`。显式路径出错时反馈该路径，配置修正后下一次请求可以重试；已驻留模型保持原进程，换路径通过 Cmd+Q 重启。翻译失败优先展示具体 warning。

已直接从当前 TypeScript 源码执行内存构建验证，使用真实 Qwen 权重和 llama-server，仅模拟 Electron 的路径 / 状态发布环境，保留当前桌面 App 及用户草稿：

- 模拟打包态缺少路径时返回设置操作提示；修正为外部路径后，同一 runtime 重试成功并就绪。
- 当前 AgentHandle / PiAdapter 完成离线翻译 `Hello, world!` → `你好，世界！`，收到 4 个文本增量，stopReason=stop，执行记录完整。验证记录写入临时目录，启动的模型进程已清理。
- 旧设置缺少 localModel 字段时兼容默认值；路径 trim、NUL / 超长 / 未知字段拒绝正常。IPC 拒绝相对路径；新程序确认取消时保持设置，确认允许后保存，既有笔记授权流程保留。

`pnpm check` 与 `pnpm pack:arm64` 均通过，独立审查未发现功能 / 安全问题；核对新版 app.asar 已包含路径设置、程序执行确认和翻译 warning 修复。

用户确认已保留草稿并允许替换后，旧桌面进程以 SIGTERM 结束，安装包备份到 `.cache/app-backups/huan-app-before-offline-fix-20261014-1506.app`，新版复制到桌面并核对 app.asar SHA-256 与构建产物一致。窗口自动化在完整路径、bundle ID 和应用清单读取上持续超时；因此使用既有 createSettingsStore 原子保存用户授权的两条本地路径，并选择离线模式。原配置备份到 `~/.huan-app/settings-before-offline-fix-20261014-1513.json`，重新读取后核对其余设置一致，整个操作未访问凭据明文。

新版桌面进程在未提供 HUAN_MODEL_PATH / HUAN_LLAMA_SERVER_PATH 的环境下重启，从已保存设置启动自身的 llama-server 子进程，健康检查返回 status=ok。独立伴读后端借用该驻留模型读取公开示例材料：实际调用 read_page 一次，返回猫头鹰 / 小松，收到 52 个文本增量，Run completed 且执行记录完整。验证数据与 Pi Session 保存在临时目录。

额外质量观察：故意在第二轮移除整个材料目录后，Qwen 拒答名字追问；核对第二轮请求仍包含第一轮的 tool 和 assistant 证据，确认不是历史丢失。这是该条件下的模型回答边界，不代表正常同页续问失效。

桌面安装包替换、配置持久化、实际本地进程加载和后端工具调用已验证；新版 GUI 设置点击、真实界面聊天 / 翻译请求及 Cmd+Q 正常退出仍未通过 Computer Use 验收。
