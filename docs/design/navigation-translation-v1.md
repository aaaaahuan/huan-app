# 左侧导航与翻译页原型 v1

日期：2026-10-06。范围：设计原型，不修改应用代码，不表示翻译能力已经接入。

## 设计决策

- 全局左侧导航独立于阅读页内部的收藏列表；阅读页保留现有收藏、阅读与 AI 伴读结构。
- 第一版只有“阅读”“翻译”两个系统入口，设置置底，不提前增加独立聊天等功能。
- 当前原型展示翻译页的已完成状态：英语/中文切换、原文/译文双栏、翻译按钮与复制。
- 沿用现有浅绿纸张背景、深绿文字、细边框和圆角；标题延续宋体，正文延续苹方。
- “离线 · Qwen3.5-4B”为示意状态；实际实现仍须处理模型未下载、加载、失败、取消与过期结果。
- 首版不加入 OCR、字幕、历史记录、词典和复杂模型设置。

## 产物

原型图片：`navigation-translation-v1.png`。使用内置 image_gen 做图工具，未使用 Figma。
图片是视觉沟通稿，不是可执行页面或生产组件规范。

## 完整生成提示词

```text
Use case: ui-mockup
Asset type: one high-fidelity desktop app prototype screenshot for huan-app, not a website and not a marketing poster.
Primary request: Design a minimal, intuitive macOS desktop app with a persistent left global navigation and a very simple Chinese-English translation page selected. Produce one flat, pixel-sharp full application window, landscape 1440x900 composition, frontal orthographic view. No surrounding desk, laptop, mockup device, labels outside the window, or perspective.

Established style to preserve, based on actual huan-app CSS: warm off-white/pale sage paper background #f6f8f4 with an extremely subtle pale green radial gradient at upper right #e7f0e9; sidebar #fcfdf9; ink dark forest green #293d36; muted text #7e907e; thin sage borders #dfe7df; selected item #e7f0e6 with border #bdd3be and a restrained 3px green left accent #6b9475; primary button #496f56 with white text. Existing body typography resembles PingFang SC, Chinese page heading Songti SC serif, medium weight. Small 7-11px corner radii, no heavy shadows, no glassmorphism, no glossy effects. This is a quiet practical reading tool, not a futuristic AI dashboard.

Composition:
1. A slim macOS title bar 40px high across the whole window. Three small macOS traffic lights top left; tiny centered title "huan-app". Very restrained hairline bottom border.
2. Persistent 176px-wide full-height left navigation under title bar, separated from main content by a thin vertical line. At top a small text-only wordmark "huan" in dark green, no invented elaborate logo. Two generously spaced nav rows with slim monochrome outline icons and visible text: book outline + "阅读"; language A/文 icon + "翻译". The "翻译" row is selected with pale green rounded background, dark green text and subtle left accent. At the very bottom a small gear icon + "设置". Do not show bookmark lists, reading subpanels, chats, extra modules, placeholder disabled nav items, stats or notifications.
3. The main translation workspace fills the rest. Content begins roughly 72px to right of sidebar, 60px below title bar, about 1050px wide. A restrained 28px Chinese serif heading "翻译", beneath it small muted subtitle "输入文字，立即翻译。". At upper right aligned with heading a tiny green dot and "离线 · Qwen3.5-4B", plain text not a large pill. This is illustrative prototype UI, not a measured performance display.
4. Below heading/subtitle, a compact horizontal language toolbar: understated bordered dropdown "英语", one small two-way swap arrows icon button, understated bordered dropdown "中文". No mode tabs or advanced controls.
5. Below language toolbar, two equal-width large text panels side by side, spaced 20px, each about 300px high, radius 10px, hairline sage border. Left input background nearly white, right output background the palest sage white. Panel top-left labels "原文" and "译文" in small muted Chinese text. Left panel top-right has a small clear x icon. Right panel top-right has small copy outline icon and label "复制". Both panel bodies have comfortable 24px padding. Left text exactly "Could you give me a hand?" in 18px normal sans serif, right translated text exactly "你能帮我一下吗？" in 20px dark green Chinese sans serif. Lots of empty space within text panels, no huge text or decorative quotes.
6. Below left panel one compact green button "翻译", about 94x36px, not full width; beside it muted shortcut hint "⌘ Enter". Below panels at far right small muted footer "仅在本机处理". The bottom half of remaining workspace is clean airy negative space without extra cards.
Text must be accurately rendered exactly as supplied, readable Chinese. Visual hierarchy must be subtle, clear and consistent with a calm existing desktop reading app. No Figma, no annotation arrows, no watermarks, no extra feature blocks, no purple, no dark theme, no gradients on buttons, no oversized branding, no promotional slogan.
```
