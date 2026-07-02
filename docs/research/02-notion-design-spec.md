# Notion 页面设计与交互规范（2026）

> 调研日期：2026-07-02
> 来源：[Notion Help Center](https://www.notion.com/help)、[Notion Docs](https://developers.notion.com)、[DesignMD](https://designmd.cc/benchmarks/notion)、[SeedFlip](https://seedflip.co/blog/notion-design-system)、[Paul Velleux: Updating the design of Notion pages](https://www.notion.com/blog/updating-the-design-of-notion-pages)
> 用途：为 Folio 提供设计系统的"single source of truth"——CSS 变量、组件库、间距、配色、交互细节全部以本规范为基准

---

## 1. 信息架构

### 1.1 Sidebar 布局

**桌面默认（≥1024px）**：
- 宽度：240px（展开）+ 56-72px 折叠 rail 选项
- 位置：左侧固定，全高
- Z-index：200（在内容之上、modal 之下）
- 结构：4 tab 系统（Notion 3.4 引入，2026-03）：
  - **Pages**：workspace 导航
  - **Agent chats**：AI 对话
  - **Meetings**：会议
  - **Inbox**：mention/评论
- 每个 section 可折叠分组（Teamspaces、Shared、Private）
- 点击 section 名折叠/展开
- 可拖拽重排

**可折叠 Rail（768-1023px）**：
- 宽度：64px（仅图标）
- 图标 hover 时显示 tooltip（200ms 延迟）
- 通过 56px 高的汉堡菜单触发导航

**移动端（<768px）**：
- 默认隐藏
- 从左滑入 drawer + 暗色遮罩（rgba(0,0,0,0.5)）
- drawer 宽：280px
- 动画：200ms ease-in-out，transform origin left
- 关闭：点击遮罩、右滑、关闭按钮

**视觉层级**：
- **当前页**：粗体（600）、淡蓝背景（#e6f0fa）
- **Hover**：暖灰背景（#f7f6f3）
- **嵌套页**：每级 16px 缩进，chevron（▸ / ▾）展示树结构

### 1.2 页面 Chrome

**Top Bar**：
- 高度：44px（桌面）、48px（移动）
- 滚动时背景：rgba(255,255,255,0.95) 透明白
- Border-bottom：1px solid rgba(0,0,0,0.08)
- 过渡：150ms ease-out

**左侧面包屑**：
- 结构：`[Workspace] / [Team] / [Page Name]`
- Hover 面包屑项时显示 icons：
  - 🔄 刷新（左）
  - 📄 页面 icon（左中）
  - 📎 复制链接（右中）
  - ⋯ 更多菜单（右）
- icon 之间 8px 间隔
- 点击页面 icon 打开 emoji 选择器（180×180px popover，12px radius）
- 点击面包屑跳转父页

**右侧操作簇**：
- 元素（左到右）：Share 按钮 / More 菜单（⋯）/ 收藏星（⭐）/ 评论 icon（💬）
- 间距：8px
- Share：Notion 蓝（#0075de），pill（9999px radius），32px 高
- 收藏星：默认空心，点击填充黄色（#ffb110），200ms scale 动画
- 评论徽章：红色 pill（#e03e31）+ 数字（0-99+），14px radius，最小 24px

### 1.3 折叠/展开模式

- **Sidebar**：折叠 rail 模式点击 section 名展开，状态存 localStorage；200ms ease-in-out 宽度过渡
- **Block Toggles**：点击 toggle 头（▶/▼）展开/收起；箭头旋转 90deg；150ms ease-out；高度从 0 到 auto（用 max-height 性能约束）；折叠状态存块属性
- **Database Properties**：点击 Properties 头折叠右侧面板；200ms ease-out 向右滑

### 1.4 Hover 触发的 UI

**Block Handle**：
- 拖拽 handle（⋮⋮）在左侧 hover 时出现，距内容左 24px
- 透明度 0→1 过渡 100ms ease-out
- Hover 时光标变 grab
- 块被选中时始终可见

**选中工具栏（bubble menu）**：
- 选中文字时浮出
- 选项：Bold / Italic / Underline / Strikethrough / Code / Link / Color / Delete
- 高度 36px，padding 4px，radius 12px
- 锚定选区，4px 垂直偏移
- 12px 等边三角形箭头指向选区
- 点击外部 / 5s 不活动 / 选区清空时消失

---

## 2. 排版

### 2.1 字体系统

**主字体**：NotionInter（Inter 定制变体）
- Fallback：`Inter, -apple-system, system-ui, 'Segoe UI', Helvetica, Arial, sans-serif`
- 许可：Notion 定制包；Inter 开源（SIL OFL）

**CJK 字体回退**：
- 中文：PingFang SC（macOS）、Microsoft YaHei（Windows）
- 日文：Noto Sans JP、Hiragino Kaku Gothic ProN
- 韩文：Noto Sans KR、Apple SD Gothic Neo

**代码字体**：
- 主：JetBrains Mono
- Fallback：`'SF Mono', 'Fira Code', 'Roboto Mono', Consolas, monospace`

### 2.2 各 Block 字号

| 角色 | 字号 | 字重 | 行高 | 字间距 | 用途 |
|------|------|------|------|--------|------|
| Display XL | 64px | 700 | 1.0 | -2.125px | Hero 标题（营销） |
| Display LG | 54px | 700 | 1.04 | -1.875px | 章节标题（营销） |
| Heading 1 | 40px | 600 | 1.2 | -0.02em | 页面标题 |
| Heading 2 | 32px | 600 | 1.3 | -0.01em | 章节标题 |
| Heading 3 | 24px | 500 | 1.4 | normal | 子章节 |
| Body | 16px | 400 | 1.5 | normal | 段落、默认 |
| Caption | 14px | 400 | 1.5 | normal | UI 标签、帮助文 |
| Small | 12px | 400 | 1.33 | 0.125px | 微标签、元数据 |
| Code Inline | 14px | 400 | 1.5 | normal | 行内代码 |
| Code Block | 13px | 400 | 1.4 | normal | 代码块 |

### 2.3 页面标题

- 字号：40px（桌面）、32px（移动）
- 字重：600（semi-bold）
- 行高：1.2
- 字间距：-0.02em（桌面）、normal（移动）
- 颜色：rgba(0,0,0,0.95)（Notion Black）
- 标题下方 8px 垂直 margin

### 2.4 字重尺度

| 字重 | 用途 |
|------|------|
| 400 | 正文、描述、中性 UI |
| 500 | 强调、导航标签、按钮文字 |
| 600 | 标题、semi-bold 标签、active 状态 |
| 700 | Display 标题、营销文案、加粗 |

### 2.5 行高

- Display：1.0-1.1（大字号收紧）
- Headings：1.2-1.3（中等收紧）
- Body：1.5（阅读舒适）
- Code：1.4-1.5

---

## 3. 配色与主题

### 3.1 浅色模式（默认）

**Surface 系统**：
- 页面背景：纯白（#ffffff）
- 卡片 surface：纯白（#ffffff）
- Off-white section：暖白（#f6f5f4）—— **黄色基调，对暖度至关重要**
- Sidebar 背景：#f7f6f3（比页面略暖）
- Hover 背景：#f7f6f3
- Active/Selected 背景：#e6f0fa（淡蓝 tint）

**文字系统**：
- Primary：Notion Black（rgba(0,0,0,0.95)）—— 95% 不透明，软而不损可读性
- Secondary：Warm Gray 500（#615d59）
- Tertiary：Warm Gray 300（#a39e98）
- Placeholder：#c3c2bf
- 深色背景上（hero）：Off-White（#f6f5f4）
- 深色背景上（卡片）：纯白（#ffffff）

**边框与线**：
- Hairline border：rgba(0,0,0,0.08) —— "耳语"细，几乎不可见
- Strong border：rgba(0,0,0,0.16)
- Divider：rgba(55, 53, 47, 0.09) —— 暖灰
- Input border：rgba(0,0,0,0.1) → 聚焦 rgba(35, 131, 226, 0.5)

**Focus Ring**：
- 颜色：rgba(35, 131, 226, 0.35) —— 蓝 35% 不透明
- Offset：2px
- 过渡：150ms ease-out

### 3.2 深色模式

**Surface 系统**：
- 页面背景：Midnight Canvas（#02093a）—— 深海军蓝 hero
- 卡片 surface：Periwinkle Surface（#455dd3）
- Section 背景：Charcoal（#31302e）
- Hover 背景：rgba(255,255,255,0.08)
- Active 背景：rgba(255,255,255,0.12)

**文字系统**：
- Primary：Off-White（#ffffff）
- Secondary：Muted（#a4a097）
- Tertiary：Dim（#787774）

### 3.3 Accent 配色系统

**Notion Blue（主 accent）**：
- Primary：#0075de —— 链接、CTA、交互元素
- Hover：#1B6EC2
- Light：#62aef0 —— 交互 accent、highlight
- Muted BG：rgba(35, 131, 226, 0.08)

**Secondary accents（状态色）**：
- Teal：#2a9d99（成功）
- Green：#1aae39（确认）
- Orange：#dd5b00（警告）
- Pink：#ff64c8（装饰）
- Purple：#391c57（高级功能）
- Brown：#523410（土色）
- Red：#e03e31（错误）
- Amber：#ffb110（收藏、关注）

### 3.4 语义色（Callout & Highlight）

**Callout 背景色（浅色模式，低不透明度）**：

| 名称 | 文字色 | 背景色 | Select 色 |
|------|--------|--------|-----------|
| Gray | #615d59 | #f7f6f3 | #a39e98 |
| Brown | #9c7054 | #fcf8f5 | #c9b5a8 |
| Orange | #ff6d00 | #fff5ed | #ffaf80 |
| Yellow | #ffb110 | #fef7d6 | #ffcc00 |
| Green | #1aae39 | #d9f3e1 | #66d66b |
| Blue | #0075de | #dcecfa | #5da3f0 |
| Purple | #391c57 | #e6e0f5 | #9b7fdb |
| Pink | #ff64c8 | #f4dfeb | #ff9bd6 |
| Red | #e03e31 | #fbe4e4 | #ff7b7b |

**文字高亮色（6 种默认）**：
1. 默认（无）：透明
2. Yellow：#fef3c7（0.6 不透明）
3. Green：#d1fae5（0.6）
4. Blue：#dbeafe（0.6）
5. Purple：#f3e8ff（0.6）
6. Red：#fee2e2（0.6）
7. Orange：#ffedd5（0.6）

---

## 4. 间距与布局

### 4.1 页面内容最大宽度

| 模式 | 宽度 | 触发 |
|------|------|------|
| Small | 640px | 用户选择（⋯ → Small width） |
| Default | 860px | 默认 |
| Full Width | 100%（最大 1200px） | ⋯ 菜单切换 |

### 4.2 块周围 padding

**页面级**：
- 桌面：左右 96px
- 平板：左右 48px
- 移动：左右 16px

**块级**：
- 上下：8px（默认），相邻 list item 时 4px
- **邻接规则**（2026 设计更新）：list item（bullets/numbered/toggles/checklists）与同类相邻时用 4px gap，paragraph 保持 8px

**数据库 padding**：
- Inline database：上下 16px，左右 0（全宽）
- Full-page database：上下 24px，左右 0

### 4.3 块垂直节奏

- 基础 gap：8px
- 紧凑 list gap：4px（邻接规则）
- 章节 gap：24-32px（主要内容章节之间）
- 文档节奏：48px（主要章节之间，指导值）

### 4.4 缩进步长（嵌套）

| 级别 | 缩进 | 用途 |
|------|------|------|
| 0 | 0px | 顶层 |
| 1 | 24px | 第一层（list in list） |
| 2 | 48px | 第二层 |
| 3 | 72px | 第三层（实用上限） |
| 4+ | 96px+ | 极少，复杂结构 |

**键盘缩进**：
- Tab：缩进（向右嵌套）
- Shift+Tab：outdent（向左）
- Mod-Shift-Right/Left：键盘重排

### 4.5 列 gap

- 两列布局：24px 水平 gap；拖拽块到另一个块的侧面创建；蓝色竖线指示分割位置
- 三列布局：16px 间距；拖拽到中间列右缘创建

### 4.6 Sidebar 宽度与可调

- 默认展开：240px
- 折叠 rail：64px
- 移动 drawer：280px
- 可调：右侧 4px 拖拽 handle；范围 180-320px；状态存 localStorage；松开时 150ms ease-out

---

## 5. 块交互模式

### 5.1 Drag Handle

**视觉**：
- 符号：⋮⋮（六点握把）
- 位置：距内容左 24px，垂直居中
- 透明度：0 → 1 hover（100ms ease-out）
- 光标：grab
- 尺寸：16px 高 × 12px 宽

**行为**：
- 点击：打开块上下文菜单
- 拖拽：启动块重排
- 自动滚动：靠近页面边缘时按速度递增
- Drop indicator：蓝色水平线（实线 = 兄弟，虚线 = 嵌套子）
- 嵌套阈值：距 list item 左缘 28px 才触发嵌套 drop

### 5.2 选中工具栏

- **触发**：选中文字 → 浮出 bubble menu
- **定位**：选区上下方，4px 偏移，箭头指向选区
- **高度**：36px，padding 4px
- **Radius**：12px
- **选项（左到右）**：
  1. Bold（B）— Cmd/Ctrl+B
  2. Italic（I）— Cmd/Ctrl+I
  3. Underline（U）— Cmd/Ctrl+U
  4. Strikethrough（S）— Cmd/Ctrl+Shift+S
  5. Code（⌘E）— Cmd/Ctrl+E
  6. Link（🔗）— Cmd/Ctrl+K
  7. Color（🎨）— 打开 7 色 grid
  8. Delete（🗑️）— Cmd/Ctrl+Delete
- **消失**：点击外部 / 5s 不活动 / 选区清空

### 5.3 Slash 命令面板 UX

- **触发**：行首按 `/`（或空段任意位置）
- **视觉**：
  - Popover：280px 宽，max-height 320px
  - Radius：12px
  - 多层 shadow（见下文）
  - 光标下方，与文字起始左对齐
  - 12px 等边三角形箭头指向光标
- **内容结构**：
  ```
  1. "Basic blocks" header
  2. 列表：Paragraph / H1 / H2 / H3 / Bulleted / Numbered / To-do / Toggle / Quote / Callout / Divider / Code
  3. "Database"（输入 /data 触发）：Table / Board / Calendar / Timeline / Gallery
  4. "Embed & media"（输入 /embed 触发）：Image / Video / File / PDF / Bookmark / Embed
  ```
- **行为**：
  - 模糊搜索：`/head` 显示所有 heading
  - 方向键 + Enter 选择
  - Escape / 点击外部关闭
  - 选中项：#dcecfa 淡蓝背景
  - 应用后清除 `/query` 并转换块类型
- **Tab 分类**（Recent / All / Media / Database）：
  - 顶部 3 个 tab，32px 高
  - 默认 "All"
  - "Recent" 显示最近 5 个使用过的块

### 5.4 块菜单（右键或 ⋮⋮）

- **触发**：右键块 或 点击 drag handle
- **菜单项**：
  1. Delete — Cmd/Ctrl+Delete
  2. Duplicate — Cmd/Ctrl+D
  3. Turn into → 子菜单（H1/H2/H3/Paragraph 等）
  4. Color → 7 色 grid
  5. Copy link to block — 复制 `URL#block-id`
  6. Comment — 给块加评论
  7. Move to — 打开 workspace 选择器
  8. Delete permanently（在 trash 中时）
- **视觉**：220px 宽，8px radius，多层 shadow；item 高 36px，左右 8px padding；hover 时 #e6f0fa

### 5.5 键盘快捷键

| 快捷键 | 动作 |
|--------|------|
| Cmd/Ctrl+E | 行内代码 |
| Cmd/Ctrl+B | 加粗 |
| Cmd/Ctrl+I | 斜体 |
| Cmd/Ctrl+U | 下划线 |
| Cmd/Ctrl+Shift+1 | 转 H1 |
| Cmd/Ctrl+Shift+2 | 转 H2 |
| Cmd/Ctrl+Shift+3 | 转 H3 |
| Cmd/Ctrl+D | 复制块 |
| Cmd/Ctrl+Delete | 删除块 |
| Cmd/Ctrl+/ | 打开命令面板（同 `/`） |
| Cmd/Ctrl+K | 插入链接 |
| Cmd/Ctrl+Shift+K | 移除链接 |
| Tab | 缩进（向右嵌套） |
| Shift+Tab | outdent（向左） |
| Mod-Shift-Up | 块上移（键盘重排） |
| Mod-Shift-Down | 块下移（键盘重排） |
| Cmd/Ctrl+Z | 撤销 |
| Cmd/Ctrl+Shift+Z | 重做 |

**全局命令面板（Cmd/Ctrl+K）**：
- 360×480px max
- 顶部搜索栏（12px 高）
- 下方最近命令
- 方向键 + Enter 选择
- Escape 关闭

---

## 6. 数据库视图 UX

### 6.1 Table View

- **表头行**：高 40px；背景 #f7f6f3；border-bottom 1px；hover 显示排序（↑/↓）、列重排 handle（⋮⋮）、filter 按钮
- **Sticky Filter Bar**（filter 应用时）：高 36px；白底；border-bottom；pill 状 filter chip（20px 高，× 移除）；"+ Add filter" 按钮
- **Body 行**：高 Auto（最小 40px）；hover #e6f0fa；点击打开行页面；checkbox for to-do；cell hover 显示编辑铅笔
- **"+ New" 按钮**：表格右上；Notion 蓝；pill；32px 高，padding 8px 16px；点击添加 "Untitled" 新行
- **View Tabs**：表头之上；active tab 粗体 + 2px 蓝下划线；hover 淡蓝背景

### 6.2 Board View（看板）

- **列**：按属性（如 Status）分组；每列 280px 最小宽，可调；列间 16px；4px 左边色条（属性色）；header 36px 高 + 计数 pill 徽章
- **卡片**：宽 100%，最小 80px 高；白底；1px 边框；8px radius；12px padding；hover 抬升阴影 + grab 光标；可选封面图 120px 高
- **拖拽跨列**：蓝色 drop indicator；drop 后更新分组属性
- **列底部"+ 按钮"：灰色虚线边框，36px 高，添加到该组

### 6.3 Calendar View

- **月格**：7 列（周日-周六）× 6 行（周）；单元格高 120px（桌面）/ 80px（平板）/ 60px（移动）；border 1px；日期数字 12px 左上；hover #e6f0fa
- **All-Day 事件**：单元格顶部水平条；24px 高；属性色 tint；事件名 14px 截断
- **导航**：月份名（左）+ 上/下月箭头（12px 高）+ "Today" pill（24px 高）
- **拖拽改期**：拖到其它日；蓝色 drop indicator；drop 更新日期属性

### 6.4 Gallery View

- **卡片网格**：自动列（最小 200px/卡）；gap 16px
- **卡片**：白底；1px 边框；12px radius；16px padding；hover 抬升阴影；可选封面图 180px 高，8px radius；标题 20px bold；最多 3 个可见属性
- **"+ New" 按钮**：右下角；Notion 蓝；FAB 风格，48×48px 圆形

### 6.5 Timeline View（Gantt）

- **Gantt 条**：水平条横跨开始/结束日期；28px 高；属性色 tint；4px radius；左右各 4px 调整 handle（col-resize）；hover 深化 tint + 显示名称
- **依赖箭头**：曲线连接依赖项；末端 12px 三角箭头；灰（#615d59）；hover 蓝（#0075de）
- **左侧表面板**：320px 宽；#f7f6f3 底；全高；顶右 << / >> 折叠按钮；列同 table view
- **顶部时间轴**：水平尺 + 日期标记；缩放：Day/Week/Month/Quarter/Year（下拉）；水平滚动

---

## 7. 光标、选择、编辑

### 7.1 Caret 行为

- 闪烁率：530ms（系统默认）
- 宽度：2px
- 颜色：Notion Black（rgba(0,0,0,0.95)）
- 位置：字符间，点击时吸附词边界
- 高度：当前行行高

### 7.2 三击选行

- 段落三击：选中整行
- 代码块三击：选中整块
- list item 三击：选中整 item

### 7.3 拖拽选多块

- 块左缘（24px）hover
- 点击向下拖
- 蓝色选择矩形围绕选中块
- 选中块：#e6f0fa 淡蓝背景
- drag handle（⋮⋮）出现在首个选中块

### 7.4 拖拽重排

- **Drag handle**：点击拖块
- **Drop indicator**：蓝色水平线
  - 实线：drop 为兄弟（同级）
  - 虚线：drop 为嵌套子（缩进）
- **嵌套阈值**：距 list item 左缘 28px 才嵌套
- **自动滚动**：靠近页边按速度递增
- **列分割**：拖块到另一块侧面创建列；蓝色竖线指示分割位置；松开创建两列

### 7.5 粘贴处理

**Markdown 粘贴**：
- `* item` → bullet list
- `1. item` → numbered list
- `# H1`、`## H2`、`### H3` → heading
- `` `code` `` → 行内代码
- 三反引号 → 代码块
- `**bold**` → 加粗
- `*italic*` → 斜体
- `[text](url)` → 链接

**HTML 粘贴**：
- 剥离格式（保留 bold/italic/links）
- block 结构转 Notion 块
- inline 元素转 inline 格式

**纯文本粘贴**：
- 无格式
- 单 paragraph 块

**智能粘贴**：
- URL → 自动创建 bookmark block
- 图片 → 创建 image block
- YouTube URL → 创建 embed
- 表格 → 创建 database view（如果结构匹配）

---

## 8. Modal / Popover / Toast

### 8.1 Modal Stack

- **Z-index**：1000（最低）→ 2000（最高）堆叠
- **遮罩**：rgba(0,0,0,0.4) 暗色 scrim
- **动画**：150ms ease-out，fade-in + scale（0.95 → 1）
- **尺寸**：Small 400px / Medium 600px / Large 800px
- **Padding**：24px
- **Radius**：12px
- **Header**：20px bold 标题 + × 关闭按钮（20px 高，右上）
- **Footer**：主/次按钮，右对齐

### 8.2 Popover 定位

- **Portal**：渲染到 body（脱离父级）
- **定位**：基于 `getBoundingClientRect()`
- **偏移**：距 trigger 4px
- **箭头**：12px 等边三角，指向 trigger
- **位置**：auto（基于视口空间，上下左右自适应）
- **Max-Width**：280px（小）/ 360px（中）/ 480px（大）
- **Max-Height**：320px + 滚动
- **Padding**：12px
- **Radius**：12px

**多层 shadow（关键 — Folio 设计 token 必须复刻）**：
```
box-shadow:
  0px 4px 18px rgba(0,0,0,0.04),
  0px 2.025px 7.84688px rgba(0,0,0,0.027),
  0px 0.8px 2.925px rgba(0,0,0,0.05),
  0px 0.175px 1.04062px rgba(0,0,0,0.013);
```

### 8.3 Toast 通知

- **位置**：右下（桌面）、顶部居中（移动）
- **尺寸**：Auto（最大 400px 宽）
- **高度**：48px
- **Padding**：12px 16px
- **Radius**：8px
- **背景**：白
- **边框**：1px solid rgba(0,0,0,0.08)
- **Shadow**：同 popover
- **动画**：底部滑入 200ms ease-out，3-5s 后淡出
- **Icon**：16px（成功 ✓ / 错误 ⚠ / 信息 ℹ）
- **文字**：14px，单行
- **Action**：可选 Undo 按钮，pill 状 16px 高
- **类型**：
  - 成功：绿 icon（#1aae39）—— "Saved"、"Copied"
  - 错误：红 icon（#e03e31）—— "Failed"、"Error"
  - 信息：蓝 icon（#0075de）—— "Updated"、"Deleted"

### 8.4 命令面板外观

- **尺寸**：360×480px max
- **搜索栏**：12px 高，4px radius，浅灰背景（#f7f6f3）
- **结果**：可滚动，max-height 400px
- **Item**：36px 高，8px padding
- **选中**：#e6f0fa
- **快捷键提示**：12px 灰（Cmd+K）

---

## 9. 空状态与加载

### 9.1 空块 placeholder

- 文字："Press '/' for commands"
- 颜色：#a39e98（tertiary text）
- 位置：块左上，4px top padding
- 消失：输入第一个字符时

### 9.2 空数据库

- 仅"+ New" 按钮（无文字消息）
- 按钮：Notion 蓝，pill，32px 高
- 位置：表格 body 居中
- 点击添加首行 "Untitled"

### 9.3 空页状态

- 内容：
  1. "Type '/' for commands" placeholder
  2. 三个模板建议（卡片）：
     - 📝 Meeting Notes
     - ✅ Task List
     - 📅 Calendar
  3. "Or just start typing"（12px 灰）
- 模板卡片：200px 宽，24px padding，12px radius
- 点击：应用模板到页面

### 9.4 Skeleton 加载器

- **形状**：镜像最终布局（card=list 卡片、table=table）
- **颜色**：#f7f6f3（浅灰）
- **动画**：shimmer 效果（opacity 0.5 → 0.7 → 0.5），1.5s 周期
- **时长**：最小 300ms（避免闪烁）
- **无障碍**：`aria-busy="true"`、检查 `prefers-reduced-motion`

**加载层级**：
1. **Skeleton**：可预测布局（list/card/table）—— 500ms+ 使用
2. **Progress Bar**：determinate（上传真实 %）或 indeterminate（API 调用）
3. **Spinner**：未知布局或微小行内等待（<200ms）

### 9.5 同步指示器

- **Icon**：⚡（闪电）或 ☁️（云）
- **位置**：sidebar 右上（用户头像旁）
- **颜色**：
  - 已同步：灰（#615d59）
  - 同步中：橙（#ff6d00）
  - 离线：绿（#1aae39）
- **行为**：有待同步变更时出现，成功后消失

---

## 10. 响应式行为

### 10.1 桌面宽（≥1280px）

- Sidebar：展开 240px
- 内容：居中 860px 默认
- 列：多列网格（3-4 列）
- Modal：Large 800px
- 字号：全尺寸（40px H1，16px body）

### 10.2 桌面窄（1024-1279px）

- Sidebar：折叠 rail 64px 或 overlay
- 内容：居中 860px
- 列：2-3 列，gutter 收紧到 16px
- Modal：Medium 600px
- 字号：全尺寸

### 10.3 平板（768-1023px）

- Sidebar：折叠 rail 或隐藏（drawer）
- 内容：全宽，16px padding
- 列：折叠为 2 列
- Modal：Medium 600px
- 字号：缩小 10%（36px H1，14px body）

### 10.4 移动（<768px）

- Sidebar：隐藏，drawer 280px
- 内容：全宽，16px padding
- 列：单列垂直堆叠
- Modal：全屏（100vw × 100vh）
- 字号：缩小 15%（32px H1，14px body）
- Toast：顶部居中

**具体断点**：
- xs：374-375px（小手机）
- sm：440px（手机横屏）
- md：668-712px（大手机/小平板）
- lg：768-840px（平板）
- xl：1032-1080px（小桌面）
- 2xl：1200-1280px（标准桌面）
- 3xl：1440px（宽桌面）
- 4xl：1800-1900px（超宽）

---

## 11. 设计 Token 总表

### Spacing（4px 基础单位）

```
4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 64, 80, 96, 120, 160 px
```

### Radius

| 值 | 用途 |
|----|------|
| 4px | 按钮、输入框 |
| 8px | 工具栏、toast |
| 12px | 卡片、modal、popover |
| 16px | 大卡片 |
| 9999px | pill |

### Typography

```
Display: 64px / 700 / 1.0 / -2.125px
H1:      40px / 600 / 1.2 / -0.02em
H2:      32px / 600 / 1.3 / -0.01em
H3:      24px / 500 / 1.4 / normal
Body:    16px / 400 / 1.5 / normal
Caption: 14px / 400 / 1.5 / normal
Small:   12px / 400 / 1.33 / 0.125px
```

### Colors

```
背景：#ffffff（页面）、#f6f5f4（off-white section）、#f7f6f3（sidebar）
文字：rgba(0,0,0,0.95)（primary）、#615d59（secondary）、#a39e98（tertiary）
Accent：#0075de（Notion Blue）
Focus ring：rgba(35, 131, 226, 0.35)
Border：rgba(0,0,0,0.08)（hairline）、rgba(0,0,0,0.16)（strong）
```

### Durations

```
100ms：opacity
150ms：ease-out transitions
200ms：animations
300ms+：skeleton 最小时长
```

### Shadows

多层 shadow，单层 opacity ≤ 0.05（见 popover shadow）

### Widths

```
页面：640px（small）、860px（default）、100% max 1200px（full）
Sidebar：240px（展开）、64px（rail）、280px（drawer）
Modal：400px（small）、600px（medium）、800px（large）
```

---

## 12. 设计系统实施建议（Folio）

将上述 token 转化为代码：

### CSS 变量

```css
:root {
  /* Colors - surface */
  --ln-color-bg-page: #ffffff;
  --ln-color-bg-section: #f6f5f4;
  --ln-color-bg-sidebar: #f7f6f3;
  --ln-color-bg-hover: #f7f6f3;
  --ln-color-bg-active: #e6f0fa;

  /* Colors - text */
  --ln-color-text-primary: rgba(0, 0, 0, 0.95);
  --ln-color-text-secondary: #615d59;
  --ln-color-text-tertiary: #a39e98;
  --ln-color-text-placeholder: #c3c2bf;

  /* Colors - accent */
  --ln-color-accent: #0075de;
  --ln-color-accent-hover: #1b6ec2;
  --ln-color-accent-light: #62aef0;
  --ln-color-focus-ring: rgba(35, 131, 226, 0.35);

  /* Borders */
  --ln-border-hairline: rgba(0, 0, 0, 0.08);
  --ln-border-strong: rgba(0, 0, 0, 0.16);
  --ln-divider: rgba(55, 53, 47, 0.09);

  /* Typography */
  --ln-font-sans: 'Inter', -apple-system, system-ui, 'Segoe UI', 'PingFang SC',
    'Microsoft YaHei', 'Noto Sans JP', 'Noto Sans KR', Helvetica, Arial, sans-serif;
  --ln-font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Roboto Mono', Consolas,
    monospace;

  --ln-text-h1: 600 40px/1.2 var(--ln-font-sans);
  --ln-text-h2: 600 32px/1.3 var(--ln-font-sans);
  --ln-text-h3: 500 24px/1.4 var(--ln-font-sans);
  --ln-text-body: 400 16px/1.5 var(--ln-font-sans);
  --ln-text-caption: 400 14px/1.5 var(--ln-font-sans);
  --ln-text-small: 400 12px/1.33 var(--ln-font-sans);

  /* Radius */
  --ln-radius-sm: 4px;
  --ln-radius-md: 8px;
  --ln-radius-lg: 12px;
  --ln-radius-xl: 16px;
  --ln-radius-pill: 9999px;

  /* Spacing scale (4px base) */
  --ln-space-1: 4px;
  --ln-space-2: 8px;
  --ln-space-3: 12px;
  --ln-space-4: 16px;
  --ln-space-5: 20px;
  --ln-space-6: 24px;
  --ln-space-7: 28px;
  --ln-space-8: 32px;
  --ln-space-10: 40px;
  --ln-space-12: 48px;
  --ln-space-16: 64px;
  --ln-space-20: 80px;
  --ln-space-24: 96px;

  /* Layout widths */
  --ln-page-max-width: 860px;
  --ln-page-max-width-small: 640px;
  --ln-page-max-width-full: 1200px;
  --ln-sidebar-width: 240px;
  --ln-sidebar-rail-width: 64px;
  --ln-sidebar-drawer-width: 280px;

  /* Durations */
  --ln-duration-fast: 100ms;
  --ln-duration-base: 150ms;
  --ln-duration-slow: 200ms;
  --ln-easing: ease-out;

  /* Shadows */
  --ln-shadow-popover:
    0 4px 18px rgba(0, 0, 0, 0.04),
    0 2.025px 7.84688px rgba(0, 0, 0, 0.027),
    0 0.8px 2.925px rgba(0, 0, 0, 0.05),
    0 0.175px 1.04062px rgba(0, 0, 0, 0.013);
}

[data-theme='dark'] {
  --ln-color-bg-page: #02093a;
  --ln-color-bg-section: #31302e;
  --ln-color-bg-sidebar: #02093a;
  --ln-color-bg-hover: rgba(255, 255, 255, 0.08);
  --ln-color-bg-active: rgba(255, 255, 255, 0.12);
  --ln-color-text-primary: #ffffff;
  --ln-color-text-secondary: #a4a097;
  --ln-color-text-tertiary: #787774;
}
```

### Tailwind 配置（推荐）

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        bg: { page: 'var(--ln-color-bg-page)', section: 'var(--ln-color-bg-section)', sidebar: 'var(--ln-color-bg-sidebar)', hover: 'var(--ln-color-bg-hover)', active: 'var(--ln-color-bg-active)' },
        text: { primary: 'var(--ln-color-text-primary)', secondary: 'var(--ln-color-text-secondary)', tertiary: 'var(--ln-color-text-tertiary)' },
        accent: { DEFAULT: 'var(--ln-color-accent)', hover: 'var(--ln-color-accent-hover)', light: 'var(--ln-color-accent-light)' },
      },
      fontFamily: { sans: 'var(--ln-font-sans)', mono: 'var(--ln-font-mono)' },
      borderRadius: { sm: 'var(--ln-radius-sm)', md: 'var(--ln-radius-md)', lg: 'var(--ln-radius-lg)', xl: 'var(--ln-radius-xl)' },
      // ...
    },
  },
};
```
