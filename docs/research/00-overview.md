# Folio 产品调研总览

> 调研日期：2026-07-02
> 项目目标：构建一个**本地优先**的、**功能完整对等 Notion** 的桌面笔记软件
> 本文档是后续设计/技术选型/实施的入口，详细内容见同目录 `01-03` 三份子文档

---

## 0. 阅读顺序

| 文档 | 内容 | 用途 |
|------|------|------|
| **00-overview.md**（本文档） | 三份调研的综合执行摘要 + 差异化定位 | 决策者快速理解全貌 |
| **01-notion-features.md** | Notion 全功能盘点（12 大类） | 产品功能蓝图、MVP/v1/v2 范围 |
| **02-notion-design-spec.md** | Notion 页面设计与交互规范 | 设计系统 token、CSS 变量、组件库基准 |
| **03-competitive-landscape.md** | 竞品全景与技术栈调研 | 差异化、避坑、技术选型 |

---

## 1. Notion 是什么（30 秒版）

Notion 是一个**一体化工作空间**，把笔记、文档、数据库、看板、日历、wiki、CRM、项目管理、AI 助手融为一体。其设计哲学：

- **万物皆 Block** —— 每段文字、图片、数据库、embed 都是一个可拖拽、可转换、可嵌套的块
- **万物皆 Page** —— 数据库的每一行也是页面，页面里可以再放数据库，无限嵌套
- **数据库是杀手级功能** —— 一个数据集可同时以 Table / Board / Calendar / Timeline / Gallery / List / Form / Chart / Map / Dashboard 10 种视图呈现
- **Slash 命令 + 拖拽 + Markdown** —— 三位一体的输入范式，让 power user 飞速操作
- **协作是一等公民** —— 评论、@mention、实时光标、共享、权限、版本历史全部原生

详见 [`01-notion-features.md`](./01-notion-features.md)。

---

## 2. Notion 的页面设计与逻辑

### 2.1 信息架构（三层）

```
┌─────────────────────────────────────────────────────────┐
│  Sidebar (240px)  │       Top Bar (44px)               │
│  ┌─────────────┐  │  [Workspace]/[Team]/[Page]   ⭐ ⋯ 💬│
│  │ Pages tab   │  ├───────────────────────────────────┤
│  │  - Team A   │  │                                   │
│  │   - Page 1  │  │   Cover Image (full-width)        │
│  │   - Page 2  │  │   📄 Page Title (40px)            │
│  │  - Shared   │  │                                   │
│  │  - Private  │  │   [Block content max 860px]       │
│  │             │  │   • paragraph                     │
│  │ Inbox (3)   │  │   • heading                       │
│  │ Agent chats │  │   • callout                       │
│  │ Meetings    │  │   • database (table view)         │
│  └─────────────┘  │   • ...                           │
└─────────────────────────────────────────────────────────┘
```

- **第一层 Sidebar**：workspace / teamspace / 私有 / 收藏 / 回收站，2026 起采用 4 tab 结构（Pages / Inbox / Agent chats / Meetings）
- **第二层 Page**：cover + icon + title + 内容，内容默认最大 860px，可切换 small（640）/ full width
- **第三层 Block**：所有内容都是块；块可嵌套、可转类型、可拖拽、可跨页同步（Synced Block）

### 2.2 关键设计原则

1. **极简留白**：纯白背景 + 暖灰（#f6f5f4）section + 4-8px 垂直节奏
2. **暖色基调**：所有"灰"都偏暖（#f7f6f3、#615d59、rgba(0,0,0,0.95)），避免冰冷感
3. **Hover 触发 UI**：drag handle（⋮⋮）、操作按钮、列重排 handle 都只在 hover 时显示，减少视觉噪音
4. **键盘优先**：slash 命令、Tab 缩进、Mod+K 全局命令面板、20+ 快捷键覆盖核心操作
5. **多层柔和阴影**：所有 popover/modal 都用 4 层、每层 opacity ≤ 0.05 的阴影，模拟物理纸张漂浮
6. **结构化色彩**：9 种语义色（Gray/Brown/Orange/Yellow/Green/Blue/Purple/Pink/Red）覆盖 callout、tag、status 等

### 2.3 排版尺度（关键值）

| 角色 | 字号/字重/行高 |
|------|---------------|
| 页面标题 | 40px / 600 / 1.2 |
| H1/H2/H3 | 40/32/24px |
| Body | 16px / 400 / 1.5 |
| Caption | 14px / 400 / 1.5 |
| Small | 12px / 400 / 1.33 |
| Code | JetBrains Mono 13-14px |

### 2.4 关键交互模式

- **Slash 命令**：280×320px popover，模糊搜索 + 上下文分组 + Recent 优先
- **拖拽**：6 点 handle（⋮⋮），实线 drop = 兄弟，虚线 drop = 嵌套子，距左缘 28px 触发嵌套
- **粘贴智能**：URL → bookmark、图片 → image、YouTube → embed、表格 → database view
- **多 view 数据库**：同一份数据，N 个命名视图（filter/sort/group/layout 各自独立）

详见 [`02-notion-design-spec.md`](./02-notion-design-spec.md)，包含完整可用的 CSS 变量定义。

---

## 3. Notion 的全功能矩阵（简化）

### 3.1 核心（任何 Notion 替代品必须实现）

| 域 | 功能 |
|----|------|
| **Blocks** | Paragraph / H1-3 / Quote / Callout / Bulleted / Numbered / To-do / Toggle / Code / Divider / Equation / Image / Video / Audio / File / Bookmark / Embed / PDF |
| **Slash 命令** | `/` 触发、模糊搜索、分类、Recent |
| **Block 操作** | Drag handle / Turn into / Duplicate / Color / Comment / Copy link / Move to |
| **Pages** | 无限嵌套、cover、icon、breadcrumb、Trash(30d)、History(90d)、Backlinks |
| **Databases** | Table 视图 + 18 种属性类型（含 Relation、Rollup、Formula 2.0）+ filter/sort/group + Database Templates |
| **搜索** | Cmd+K 全局搜索 + 页内 Cmd+F |
| **导入/导出** | Markdown / HTML / CSV |
| **Offline** | 桌面本地存储 |

### 3.2 增强（差异化竞争点）

| 域 | 功能 |
|----|------|
| **Databases 多视图** | Board / Calendar / Timeline / Gallery / List |
| **Formula 2.0** | 跨 relation 引用、JS-like 语法 |
| **协作** | Inline comments / @mention / Presence cursors / 分享 / 权限 |
| **模板系统** | Template Gallery / Database Templates / `/button` |
| **Embeds** | YouTube / Figma / Drive / PDF 等主流平台 |
| **移动端** | iOS / Android 原生 |

### 3.3 高级（v2 才考虑）

| 域 | 功能 |
|----|------|
| **AI** | Q&A / Autofill / Summarize / Translate / Draft / Improve / Meeting Notes |
| **新视图** | Form / Chart / Map / Dashboard（2026 新增） |
| **Automations** | 触发器驱动工作流 |
| **API/SDK** | REST API / OAuth / Webhooks / MCP |
| **Workers** | 托管 JS/Python 运行时（2026 新增） |
| **Notion Sites** | 一键发布到 web、自定义域名 |
| **Custom Agents** | 自定义 AI prompt + 工具 |
| **External Agents** | 接入 Claude / Cursor 等外部 Agent |

### 3.4 不在 Folio 范围内

- Notion Mail / Notion Calendar（独立 app）
- Enterprise SSO / Audit Log / Advanced Security
- 100+ connector 的完整 marketplace
- Sub-items with dependencies、复杂 rollup 链

详见 [`01-notion-features.md`](./01-notion-features.md) 的 MVP / V1 / V2 划分。

---

## 4. Folio 与 Notion 的差异化定位

### 4.1 核心定位

> **Folio = "Notion 的功能对等 + 本地优先的隐私与性能 + 开源自托管"**

我们的目标用户：
- 不愿把所有数据交给 SaaS 的个人/团队
- 在意启动速度、内存占用、大数据集性能
- 需要在公司内网/私有云部署
- 希望对工具拥有完全控制权（插件、API、数据格式）

### 4.2 与 Notion 的核心区别

| 维度 | Notion | **Folio** |
|------|--------|--------------|
| **数据存储** | 云端专有 | **本地优先（SQLite + cr-sqlite CRDT），可选云同步** |
| **同步模型** | 中心化服务器 | **Yjs CRDT + y-websocket relay，P2P 友好** |
| **离线能力** | 受限（需手动下载页） | **默认离线工作，云同步可选** |
| **隐私** | 数据在 Notion 服务器 | **默认 E2EE，零知识加密可选** |
| **桌面壳** | Electron | **Tauri 2（bundle 5-40MB vs 80-200MB，内存 30-80MB vs 200-400MB）** |
| **开源** | 闭源 SaaS | **MIT 开源** |
| **自托管** | 不支持 | **单 Docker 容器 sync server** |
| **数据可移植** | 受限导出 | **SQLite 单文件 + Markdown 双向同步** |
| **AI** | 内置（云端 LLM） | **可插拔：BYO Key（OpenAI/Claude/本地 Ollama）** |
| **价格** | $10-25/人/月 | **免费 + 自托管** |

### 4.3 我们要复制 Notion 的什么

✅ **全部核心功能**：blocks / pages / databases（多视图 + relation + rollup + formula）/ slash / 协作 / 搜索 / 模板
✅ **完整设计系统**：直接复刻 Notion 的 token、配色、间距、交互模式（02 文档已给出可粘贴的 CSS 变量）
✅ **键盘优先范式**：所有 Notion 快捷键 1:1 兼容
✅ **数据库的"杀手锏"**：10 种视图（v2 完整）、Formula 2.0、Relation、Rollup

### 4.4 我们要超越 Notion 的什么

🚀 **性能**：Tauri + 原生 Rust 后端，亚秒级启动、平滑滚动大文档
🚀 **同步可靠性**：Yjs CRDT 保证无冲突合并（Notion 同步偶尔有冲突）
🚀 **数据所有权**：SQLite 单文件 + Markdown 双向同步，永远不锁死
🚀 **AI 灵活性**：可插拔 LLM，支持本地 Ollama 完全离线 AI（Notion 强制云端）
🚀 **自托管简单**：单容器 sync server（vs AppFlowy 5+ 容器）
🚀 **移动对等**：Tauri 2 移动端，首日即原生 iOS/Android（不是 webview 次要）

### 4.5 我们要避免 Notion 的什么

❌ **云端锁定**：所有数据可一键完整导出
❌ **大 bundle**：拒绝 Electron
❌ **付费墙**：核心功能全部免费
❌ **不可自托管**：开源 + 单容器
❌ **学习曲线陡峭的新范式**：保持 Notion 用户即开即用（不像 Anytype 的对象型）

### 4.6 与竞品的差异化（vs AppFlowy / AFFiNE / Logseq / Obsidian）

详见 [`03-competitive-landscape.md`](./03-competitive-landscape.md)。简表：

| 维度 | Folio 优势 |
|------|--------------|
| vs **AppFlowy** | 单容器自托管（vs 5+ 容器）、CRDT 同步（vs 自研协议）、Notion 级数据库（vs 简化版） |
| vs **AFFiNE** | 稳定 API（vs Pre-1.0）、专注 Notion 范式（vs 画布+文档分裂） |
| vs **Logseq** | 可靠同步（vs 多年 beta 数据丢失）、Notion 数据库（vs 简化） |
| vs **Obsidian** | 原生数据库（vs 依赖插件）、原生 RTC（vs DIY） |
| vs **Anytype** | 简单 Notion 范式（vs 学习曲线陡的对象型）、小 bundle（vs 300MB） |

---

## 5. 推荐技术栈（2026 现代组合）

| 层 | 技术 | 理由 |
|----|------|------|
| 桌面壳 | **Tauri 2**（Rust + 系统 webview） | Bundle 10x 小、内存 5x 少、原生性能、含移动端 |
| 前端框架 | **React 19 + TypeScript 5.x** | 生态最大、Tauri 兼容、TipTap 集成成熟 |
| 编辑器 | **TipTap v2**（基于 ProseMirror） | 最大扩展生态（100+）、Notion-ready 扩展齐全、Yjs 协作适配 |
| 状态管理 | **Zustand + TanStack Query** | 轻量、CRDT 友好、避免 Redux 模板 |
| 样式 | **Tailwind CSS v4 + CSS 变量** | 02 文档已给出全部 token、原子化、设计系统一致 |
| 持久化 | **SQLite + cr-sqlite** | 嵌入式、CRDT 支持、单文件可备份 |
| 协作同步 | **Yjs + y-indexeddb + y-websocket** | 事实标准、TipTap 适配、低延迟 RTC |
| 文件存储 | **本地 FS + S3 兼容**（MinIO/B2/Wasabi） | 简单、可移植、可扩展 |
| 自托管服务 | **单 Docker 容器**（y-websocket relay + 反向代理） | 最小基础设施 |
| AI 集成 | **可插拔 LLM provider**（OpenAI / Anthropic / Ollama 本地） | 灵活、隐私优先、可离线 |
| 测试 | **Vitest + Playwright** | 单元 + E2E |
| 构建 | **Vite + Tauri CLI** | 极快 HMR + 一致构建产物 |
| 包管理 | **pnpm** | 节省磁盘、workspace 友好 |

详见 [`03-competitive-landscape.md`](./03-competitive-landscape.md) 第 5 节。

---

## 6. 路线图建议

### MVP（3-4 个月）

聚焦"能用的本地 Notion"：

1. **Tauri 2 + React + TipTap + SQLite 脚手架**
2. **核心 Block 编辑**：Paragraph / H1-3 / List / To-do / Toggle / Code / Quote / Callout / Divider / Image / Bookmark
3. **Slash 命令 + 块拖拽 + Turn into + Duplicate + Color**
4. **页面树 + Sidebar + Breadcrumb + Cover + Icon**
5. **Table 数据库** + 10 种基础属性 + filter/sort
6. **全局搜索（Cmd+K）+ 页内搜索**
7. **Markdown 导入/导出 + HTML 导出**
8. **完整 Notion 设计 token 实现**（02 文档）
9. **完整快捷键集**（02 文档第 5.5 节）
10. **离线优先**（默认本地，无云）

### V1（再 3-4 个月）

1. **Board / Calendar / Gallery / List 视图**
2. **Timeline / Gantt 视图 + 依赖**
3. **Formula 2.0 + Relation + Rollup**
4. **Yjs 同步 + 单容器 sync server**
5. **基础评论 + @mention + 收藏 + Recents**
6. **Page History（90 天）+ Trash + Restore + Backlinks**
7. **Template Gallery + Database Templates**
8. **基础 Embed（YouTube / Figma / Drive / PDF）**
9. **iOS / Android（Tauri 2 mobile）**

### V2（再 6 个月）

1. **可插拔 AI**（OpenAI / Claude / Ollama）
2. **AI Q&A + Autofill + Summarize + Translate + Draft**
3. **Form / Chart / Dashboard 视图**
4. **Automations + Webhooks + REST API + OAuth**
5. **Notion Sites（发布到 web + 自定义域名）**
6. **Presence cursors + Suggestions Mode**
7. **Plugin 系统**（参考 Obsidian/VSCode 扩展模型）

---

## 7. 当前调研结论

### 7.1 市场机会

**没有任何开源工具同时解决了**：
1. Notion 级的完整数据库功能（含 relation/rollup/formula）
2. 可靠的 CRDT 同步
3. 简单的自托管
4. 真正的移动对等
5. 现代轻量桌面栈（Tauri，非 Electron）

**Folio 切入点**：用 2026 现代栈（Tauri + TipTap + Yjs + cr-sqlite）一次性解决上述 5 个缺口。

### 7.2 风险

| 风险 | 缓解 |
|------|------|
| TipTap + Yjs 集成复杂 | TipTap 官方有 `y-prosemirror` 适配，文档齐全 |
| Tauri 2 系统 webview 不一致 | 接受取舍；用 Playwright 跨浏览器测试 |
| cr-sqlite 学习曲线 | MVP 先用纯 SQLite，V1 加 CRDT 层 |
| Notion 数据库功能庞大 | 严格按 MVP/v1/v2 分阶段，避免一次性铺开 |
| 移动端 Tauri 2 mobile 仍较新 | 移动端延后到 v1 末，先验证桌面 |

### 7.3 下一步建议

1. **创建 PRD**（基于 01 文档的 MVP 范围）
2. **搭建脚手架**（Tauri 2 + React + TipTap + SQLite）
3. **实现 Block 编辑 MVP**（最高优先级，2-3 周）
4. **实现 Table 数据库**（核心差异化，2-3 周）
5. **完整设计系统实现**（02 文档 token → CSS/Tailwind）
6. **持续验证**（每周 demo，每月 milestone）

---

**文档总字数**：约 50,000 字
**调研覆盖**：Notion 官方文档 + 12 个开源竞品 + 2026 技术栈调研
**下一步**：等待用户对差异化定位与路线图的反馈，准备进入 PRD 编写阶段
