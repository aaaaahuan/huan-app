# AI 每轮可观测性

日期：2026-10-15。

## 展示与统计单位

每次伴读提问或翻译提交对应一个 Run。伴读在回答下方显示紧凑统计，翻译在结果区底部显示；展开后可查看分类明细和统计说明。准备阶段失败的伴读请求在输入区显示“上次请求用量”。运行结束后发布统计；翻译停止或修改原文后仍可接收同请求的指标，译文继续按取消和草稿版本规则处理。

默认展示示例：`2,537 tokens · 6.1 s`。工具循环可能产生多次模型请求，本轮统计覆盖这些请求的全部用量，模型重复处理历史和工具结果也会产生新的输入 tokens。

## 口径

PiAdapter 使用 Harness 的 `message_end.runId / entryId` 识别本轮 assistant，再按已提交的 `usage.row.entryId` 关联用量，按 row ID 去重。每轮创建独立收集器；`usage.totals` 是 Session 历史累计，用本轮 row 聚合得到单次 Run 的指标。

- `input`：Pi 标准化的未缓存输入 tokens。
- `cacheRead / cacheWrite`：缓存读取 / 写入 tokens。界面“输入（含缓存）”为这两项与 input 的合计。
- `output`：全部输出 tokens，包括工具调用和推理输出。
- `reasoning`：output 的可选子集；在明细中展示，totalTokens 沿用 Pi 回执总数。
- `modelRequests`：本轮成功记录 `model.request_prepared` 的次数，表示应用准备的模型请求数量，服务商实际受理和计费以服务商回执为准。
- `durationMs`：共享 AgentHandle.execute 参数校验通过后开始，至模型 / 工具执行得到最终回执的单调时钟耗时。包含记录初始化、模型加载 / 排队、材料准备、授权和工具等待；最终 journal / summary 的落盘收尾位于测量之后。

当前 DeepSeek 与 Qwen 都使用 Pi 0.87.1 的 openai-completions 适配器。它在收到服务端 usage 后设置 reasoning（含 0），初始未知 usage 为未带 reasoning 的全零对象；结合非零计数辨识已报告用量。未来更换 Provider 或升级 SDK 时应重新核对这一映射。

用量状态分为：

- `complete`：本轮全部已记录模型请求都取得用量回执。
- `partial`：已取得部分请求的用量，界面明确显示“部分已知”。
- `unavailable`：尚无已报告用量；界面显示“Token用量未知”，零请求显示“未调用模型”。服务端明确报告全零时，正常展示 0 tokens。

在线 / 离线共用同一条统计链路。token 统计表示模型报告的计算用量，费用可另行基于服务商账单核对。

## 逐次请求阶段计时

翻译和伴读共用 Provider 层的计时器。每次 SDK stream 调用持有独立的 `requestSeq`，与 `runId` 共同关联请求参数、阶段事件及最终统计；工具调用后再次请求模型会产生下一组计时。现有模型、输出预算、超时、重试和消息管理保持原有行为。

`metrics.requestTimings` 为可选数组，展开用量明细后按请求展示：

| 字段 | 客户端观测口径 |
| --- | --- |
| `startedAt` | 即将调用 fetch 时的墙钟时间，用于定位请求；未发出为 null |
| `durationMs` | fetch 开始至 SDK 流终态的单调时钟耗时；未发出为 null |
| `httpResponseMs / httpStatus` | fetch 返回 Response 时的耗时和状态码，包含连接、服务端等待及响应头传输 |
| `firstContentMs` | 请求开始至首个非空正文、思考或工具调用内容；SSE keepalive 和 SDK start 不算内容 |
| `firstTextMs` | 请求开始至首个非空正文增量，即正文首字耗时 |
| `generationMs` | 首个正文至最后正文的客户端输出区间；只有一个正文片段时可以为 0 |
| `streamTailMs` | 最后正文至 SDK 流终态的时间，包含尾部 usage / 流收尾等待 |
| `status` | 单次模型请求的 completed、failed 或 aborted，不等同于整个 Run 的终态 |

时间差使用 `performance.now()`，取非负整数毫秒。未到达的阶段保持 null；例如已建立 HTTP 响应但首字前取消，仍保存已等待的 `durationMs`、HTTP 时间和状态，正文相关字段保持 null。首内容和正文首字分别记录，便于区分工具 / 思考输出与最终正文。它们是客户端观测数据，不代表服务端纯计算耗时，也不能独立区分服务端排队与链路缓冲。

事件日志新增 `model.request_progress`（started、headers、first_content、first_text）和 `model.request_settled`。progress 的 `data.at` 是实际观测墙钟时间，`elapsedMs` 为从请求开始的单调时钟差；journal 外层 `at` 是入队后实际落盘时间。正文增量只在内存更新最后正文时间，关键阶段异步入队，终态前等待记录完成。最终计时同时保存在独立请求事件、summary 的 `requestTimings` 以及 Run 的 `metrics.requestTimings`；记录写入异常仍保留已采集的内存统计并沿用 record partial 机制。

新增字段和事件沿用 schemaVersion 1。旧 journal / metrics 不含逐次计时时仍可正常重放和展示；历史缺失阶段不追补。进程意外退出时可从已保存的 progress 定位最后阶段，未保存的请求终态耗时保持未知。

## 持久化

共享 ExecutionResult 返回 metrics，业务层投影至 ChatEntry / TranslationResult。Run 事件日志的 `run.settled.data.metrics` 和 `<runId>.summary.json.metrics` 保存相同快照：

```json
{
  "durationMs": 6056,
  "modelRequests": 2,
  "usageStatus": "complete",
  "usage": {
    "input": 2478,
    "output": 59,
    "cacheRead": 0,
    "cacheWrite": 0,
    "reasoning": 0,
    "totalTokens": 2537
  }
}
```

指标沿用 schemaVersion 1 的可选字段，旧 journal 正常重放。Token / 毫秒计数经非负安全整数校验，指标投影和 inspectRun 采用深拷贝。写入失败时保留内存指标并沿用 record partial 提示。进程中断且尚未写入最终 metrics 时，该轮统计保持缺失；恢复时的 endedAt 用于恢复状态，真实耗时以已持久化 durationMs 为准。

## 2026-10-15 阶段计时验证

使用真实 Pi Harness / SDK 和内存模拟 HTTP / SSE 响应，临时独立 record 目录，未读取用户密钥或发起云模型请求。正常输出、响应头前取消、首字前取消、输出中取消、HTTP 503、网络失败、先思考后正文、工具调用后再次请求，共 8 组场景通过。逐次事件、执行结果、summary 和存储重启重放保持一致，多请求序号为 1 / 2，Token 用量与终态继续保留。

独立检查通过旧 metrics 重放、合法 0 ms、6 类非法计时拒绝、写盘失败回调与内存指标保留、深拷贝。React SSR 验证旧记录、无首字取消、未发出、无响应及 0 ms；Computer Use 在本地预览中验证明细展开、300 px 窄栏和旧数据布局。预览使用实际组件与样例数据，不代表真实桌面翻译请求验收。

`pnpm check` 和独立代码审查通过。模型参数保持原值；本次仅更新源码与构建，桌面安装包沿用上一次交付版本。

## 2026-10-14 用量验证与桌面交付

本轮直接运行现有 TypeScript 源码和真实 Qwen / llama-server，验证记录位于临时目录，使用公开示例材料，当前用户配置与笔记保持原样。

| 场景 | 结果 |
| --- | --- |
| 翻译 | 1 次请求，input 61 / output 5 / total 66，1,762 ms，complete |
| 伴读工具闭环 | 实际 read_page；2 次请求，total 2,537，6,056 ms，complete；逐字段与本轮 assistant 用量相符 |
| 下一轮 | total 1,535，2,980 ms，等于该轮回执合计，未重复累计此前轮次 |
| 工具读取后停止 | 2 次请求，已报告 total 1,214，5,499 ms，partial |
| 模型准备失败 | 0 次请求，45 ms，unavailable |
| journal / summary 重放 | 5 个终态的 metrics 与 ExecutionResult 一致，重启记录存储后保持一致 |
| 记录边界 | 旧记录、深拷贝、非法计数拒绝通过临时数据检查 |
| UI 标记 | SSR 核对含缓存输入、推理子集、部分 / 未知 / 零请求 / 明确全零，以及原生 details / summary |

以上数值为单次本机样例，用于核对统计链路。`pnpm check`、`pnpm pack:arm64` 和独立代码审查通过；已核对打包产物包含 metrics 收集与记录校验。

开发版实际启动成功；Computer Use 连接 Electron 超时，窗口点击和视觉验收仍待完成。本轮启动的验证模型、开发服务器及 Electron 已按精确 PID 清理。线上服务尚未发送本轮验证请求，新版构建位于 `release/mac-arm64/huan-app.app`。

用户确认已保留内容并允许退出后，旧桌面安装包备份到 `.cache/app-backups/huan-app-before-observability-20261014-162135.app`，新版替换 `/Users/bytedance/Desktop/huan-app.app` 并重启。已核对 app.asar SHA-256 与本次构建一致、包含 metrics 代码；沿用现有配置启动的本地模型健康检查返回 status=ok。用户设置与凭据保持原样。
