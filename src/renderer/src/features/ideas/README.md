# 灵感大脑

顶部「灵感大脑」Tab；光纤轮廓只含两个大脑半球，没有小脑或脑干，无实体表面。

- 一条记录对应一个光点；两端使用同一 `brain.json` 和 FNV-1a 定位规则，记录排序不影响位置。
- `Enter` 记录、`Shift + Enter` 换行；中文输入法组合期间的回车不提交。
- 写入确认后清空原文并点亮新节点；保存期间新输入的草稿保留。未发出的内容通过主进程串行原子写入 userData/ideas/draft.json，重试 UUID 跨重开保留；退出前等待写入队列完成。界面使用内存会话，因此不依赖 localStorage 持久化。
- 初次读取、窗口聚焦及可见页面每 10 秒重读文件；没有记录时仅展示淡光纤框架。

## 共享文件

固定目录：`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/huan-space/project/huan-project/huan-idea`。
唯一可见记录文件：`灵感.md`。首次提交时创建，格式如下：

```markdown
| 灵感 | 时间戳 |
| --- | --- |
| 第一行<br>第二行，竖线 &#124; 自动转义 | 2026-11-07 12:34:56 |
```

时间统一为 Asia/Shanghai，精确到秒；不添加标签、YAML 或额外笔记。`&`、`<`、`>` 与竖线会编码，多行使用 `<br>`，读取时还原。

文件操作经过 Swift `NSFileCoordinator`，共享文件原子替换；已有 iCloud 未解决版本按行的最大重数合并，成功落盘后才标记版本已解决。无法识别的表头/行导致操作失败，保留原文件与输入，不静默覆盖。

本机 userData/ideas 中的回执保存提交 UUID、原行及目标重数，先持久化回执再写 Markdown；同一请求重试与崩溃恢复不会重复追加。这些是应用内部数据，不写入 Obsidian。不同目标目录使用独立回执命名空间，已经完成的回执不会恢复用户在 Obsidian 主动删除的记录。

iCloud 的实际上传/下载由系统管理，应用确认的是本机保存，不表示另一设备已同步。在完全离线并发的冲突版本中，同秒、完全相同的文本没有额外记录 ID 可供区分，合并保留最大重数而不把同一行无条件相加。

## 构建与维护

`pnpm dev` / `pnpm build` 在构建时用 Xcode Swift 编译 universal2 helper，打包时将 `out/native/idea-store` 解包；最终用户无需 Swift 工具链。未新增 npm 依赖。

`native/ideas/IdeaTable.swift` 与 iOS 的 `Ideas/IdeaTable.swift` 必须逐字一致；形状资源与 iOS 的 `Resources/idea-brain.json` 必须一致。

形体数据改编自 Innerscene 的 [CC0 Brain](https://www.innerscene.com/tools/library/3d-parts/brain-10d8f88f)，仅导出 `Left cerebral hemisphere with sculpted gyri` 与 `Right cerebral hemisphere with sculpted gyri`，并抽取光纤路径；不包括其他三个结构。

开发验收可设置 `HUAN_APP_REVIEW_USER_DATA`（独立应用数据与浏览器会话）和 `HUAN_IDEA_TEST_DIRECTORY`（既有测试目录）。二者在打包应用中均忽略。
