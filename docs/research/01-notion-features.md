# Notion 全功能盘点（2026）

> 调研日期：2026-07-02
> 来源：Notion 官方帮助中心 (notion.so/help)、开发者文档 (developers.notion.com)、Notion 2026 release notes、第三方深度测评
> 用途：为 Folio 提供完整功能蓝图与 MVP/v1/v2 范围划分依据

---

## 1. Blocks & 内容编辑

### 1.1 文本 Block 类型

| Block 类型 | 说明 | 关键 UX |
|------------|------|---------|
| **Paragraph** | 标准段落 | 默认 Block，支持全部 inline formatting |
| **Heading 1/2/3** | 三级标题 | 出现在页面 outline 中 |
| **Quote** | 引用块 | 左侧竖线 + 灰底 |
| **Callout** | 强调提示块 | 可自定义 icon + 9 种语义背景色 |
| **Bullet List** | 无序列表 | 支持 Tab/Shift+Tab 无限嵌套 |
| **Numbered List** | 有序列表 | 跨层级自动编号 |
| **To-do List** | 任务列表 | checkbox 切换状态 |
| **Toggle** | 折叠块 | chevron 控制，整块可包含子 block |
| **Code** | 代码块 | 语法高亮、复制按钮、语言选择 |
| **Divider** | 分割线 | 视觉分隔 |
| **Equation** | 数学公式 | LaTeX / KaTeX 渲染 |

### 1.2 媒体 / 嵌入 Block

| Block 类型 | 说明 |
|------------|------|
| **Image** | 拖拽/粘贴/上传，可调大小、加 alt |
| **Video** | 上传 MP4 或嵌入 YouTube/Vimeo |
| **Audio** | 上传或嵌入 SoundCloud/Spotify |
| **File** | 任意文件附件 |
| **Bookmark / Web Bookmark** | 链接预览卡，自动抓取 title/description/favicon |
| **Embed** | 通用 iframe 嵌入（Figma、Miro、Maps 等） |
| **PDF** | 内联 PDF 阅读器 |
| **HTML Block** (NEW 2026) | Agent 生成的交互式 HTML |

### 1.3 Slash（/）命令菜单

- **触发**：空行按 `/`
- **分类**：Basic blocks / Database / Media / Advanced / Actions / Date&time
- **交互**：模糊搜索、键盘导航（↑↓+Enter）、Recent 优先、按分类分组
- **筛选**：输入 `/head` 显示所有 heading

### 1.4 Block 操作

- 拖拽 handle（⋮⋮）重排
- Block-to-Page 转换
- 多列布局（Column block）
- Synced Block（跨页同步副本）
- Duplicate、Turn into、Color & Background
- Inline formatting：`**bold**` `*italic*` `` `code` `` `~~strike~~` `==highlight==`

---

## 2. Pages & 层级

### 2.1 页面树

- 无限嵌套的 sub-pages
- Breadcrumbs（顶部面包屑）
- Sidebar tree 展示
- Move to（重新挂父节点）

### 2.2 页面自定义

- Cover image（上传 / Unsplash）
- Emoji icon / 自定义图片 icon
- Full width 切换（仅桌面）
- Small text 切换（仅桌面）

### 2.3 页面属性

- Title（必有）
- Custom properties（任意数据库属性类型）
- 数据库页面继承父数据库 schema

### 2.4 页面关系

- **Relations**：跨数据库链接
- **Backlinks**：反向引用列表（自动生成）
- **Linked Databases**：同一数据库多处嵌入、不同 filter

### 2.5 页面管理

- Trash（30 天保留）
- Restore
- Page History（90 天版本回滚）
- Snapshot Diffs (NEW 2026)：可视化 side-by-side diff
- Page Analytics：浏览/编辑统计图
- Follow Page：订阅变更通知

---

## 3. Databases（杀手级功能）

### 3.1 视图类型（10 种）

| 视图 | 说明 |
|------|------|
| **Table** | 电子表格，行=页面 |
| **Board** | 看板（按 select/status 分组） |
| **Timeline / Gantt** | 甘特图，依赖箭头 |
| **Calendar** | 月/周/日视图 |
| **List** | 精简列表 |
| **Gallery** | 卡片网格（封面图为主） |
| **Form** (NEW 2026) | 对外收集表单 |
| **Chart** (NEW 2026) | 数据图表 |
| **Map** (NEW 2026) | 地图可视化 |
| **Dashboard** (NEW 2026) | 多 widget 复合视图 |

### 3.2 属性类型

Title / Rich text / Number / Select / Multi-select / Status / Date / Person / Files / Checkbox / URL / Email / Phone / **Created time** / **Created by** / **Last edited time** / **Last edited by** / ID / **Formula (2.0)** / **Relation** / **Rollup**

### 3.3 数据库特性

- **Filters**：复杂 AND/OR 逻辑，view 独立
- **Sorts**：多级排序
- **Groups**：分组折叠 + 计数徽章
- **Database Templates**：新建行的默认结构
- **Automations** (NEW 2026)：触发器驱动工作流
- **Subscriptions**：变更订阅
- **Formula 2.0**：增强语法，可引用 relation
- **Synced Databases**：跨 workspace 单向同步
- **Sub-items & Dependencies**：父子任务 + Gantt 依赖线
- **AI Autofill** (NEW 2026)：AI 填充属性
- **Granular Permissions** (NEW 2026)：「Can create pages」细粒度权限

### 3.4 视图特有功能

| 视图 | 独有功能 |
|------|---------|
| Table | 单元格拖拽、列宽调整、批量选、CSV 导出 |
| Board | 卡片封面、紧凑/大卡片切换、分组折叠 |
| Timeline | Gantt 条、日期范围编辑、依赖可视化、缩放级别 |
| Calendar | 日/周/月/季/年、重复事件、事件拖拽 |
| Gallery | 卡片纵横比、网格间距、属性显示自定义 |
| List | 极简显示、可展开行、inline 编辑 |
| Form | 自定义品牌、必填字段、提交通知、Google Sheets 同步 |
| Chart | 图表类型选择、数据源配置、颜色主题 |
| Map | 位置聚合、自定义 pin、缩放控制 |
| Dashboard | Widget 布局、多视图嵌入、KPI 卡 |

---

## 4. 实时协作

### 4.1 评论

- Inline Comments（选中文字评论，可 resolve）
- Page-Level Comments（标题上方顶层讨论）
- Discussion Threads（嵌套回复、@mention、emoji 反应）

### 4.2 提及

- `@user`：通知 workspace 成员
- `@page`：链接到其它页面（面包屑可见）
- `@date`：日期 tag
- `@remind tomorrow / 7pm / Wed at 1pm`：行内提醒

### 4.3 分享与权限

| 范围 | 权限级别 |
|------|---------|
| **Workspace** | Owner / Admin / Member / Guest |
| **Page-Level** | Full access / Can edit / Can comment / Can view |
| **Public Link** | Can view / Can edit，可设过期、允许复制为模板 |
| **Invited Emails** | 邮件邀请 + 单独权限 |
| **Guest** | 仅能访问显式分享的页面 |

### 4.4 Presence & 通知

- 实时光标 + 头像
- 页面在线成员指示
- Inbox（红点：mention / 灰点：页面变更）
- 桌面/移动推送、邮件兜底

### 4.5 Suggestions Mode

- 非破坏性建议编辑，accept/reject 流程

---

## 5. AI 功能

### 5.1 核心 AI 入口

- **AI Chat**：Cmd/Ctrl+K → "Chat with Notion AI"
- **Inline AI**：选中文字浮菜单（Edit/Summarize/Translate）
- **AI Block**：`/ai` 命令

### 5.2 能力清单

- Q&A（基于 workspace + 连接 app 回答）
- Autofill（自动填数据库属性）
- Summarize / Translate / Draft / Improve Writing / Continue Writing
- Meeting Notes（录音转写、说话人标签、自动摘要）
- Enterprise Search（跨 Slack/Teams/Drive/Jira/GitHub/Gmail 等）
- Notion Agent（多步骤任务、可读 workspace 数据）

### 5.3 Custom Agents (2026)

- 自定义 prompt
- Agent Tools（JS/Python via Workers）
- Agent Skills（可分享的工作流包）
- Relation-Aware Autofill（跨 relation 一层）
- 50 页上下文窗口

### 5.4 External Agents (NEW 2026)

- 外部 Agent 接入（Claude、Cursor、Decagon）
- Agent Orchestration（多 agent 编排）
- Agent SDK（嵌入 CRM/Teams/Discord）
- Webhook Triggers（任何 app 触发 Notion）

### 5.5 数据合规

- Enterprise：Zero Data Retention
- 其它：30 天对话保留
- Enterprise：AI Agent Audit Log

---

## 6. 模板 & 市场

- **Gallery Templates**：notion.com/templates，上千社区模板
- **Database Templates**：新建行的预填结构，可设默认
- **Page Button Templates**：`/button` 触发模板插入
- **Template Variables**：`@variable` / `@today` / `@now` / `@me`
- **Public Page Duplication**：公开页一键复制为模板

---

## 7. 集成 & 嵌入

### 7.1 内置 Embeds

Google Drive / Figma / YouTube / Vimeo / Google Maps / Twitter/X / GitHub Gist / PDF / Spotify / SoundCloud / Loom / Typeform / Miro / CodePen

### 7.2 API & SDK

- REST API（pages / databases / users / comments）
- 版本化端点（2026-03-11 当前版本）
- Rate Limits
- OAuth 2.0、Personal Access Tokens
- Internal Connections（单 workspace）/ Public Connections（多 workspace）
- Capabilities System（细粒度能力）
- Markdown API（专为 agent 兼容设计）

### 7.3 Webhooks

- Event Subscriptions：`page.created`、`page.updated`、`data_source.schema_updated` 等
- Verification Token + HMAC-SHA256 签名校验
- Bidirectional Webhooks (NEW 2026)：任意 app → Notion

### 7.4 Notion MCP（Model Context Protocol）

- Meeting Notes API
- Block Comments API
- Database CRUD（token 效率提升 91%）
- Connectors：Slack / Drive / GitHub / Jira / Mercury / Mixpanel / Miro / Box / ClickHouse

### 7.5 Workers (NEW 2026)

- 托管 JS/Python 运行时
- CLI 部署（`curl -fsSL https://ntn.dev | bash`）
- 用于：Agent Tools、Database Sync、自定义 Connector

---

## 8. 搜索 & 导航

- **Global Search**（Cmd/Ctrl+K）：模糊匹配、Recent 优先、相关性排序、键盘导航、Hover Preview、多种 Sort
- **Jump-to**：`@today`、`@last Tuesday`、`home`、`settings`
- **In-Page Search**（Cmd/Ctrl+F）：桌面可 Replace
- **AI Search**（Business/Enterprise）：自然语言查询、跨连接 app
- **导航辅助**：Favorites、Recents、Sidebar Tree、Breadcrumbs

---

## 9. Sidebar & Workspace

### 9.1 结构

- Workspaces（隔离环境）
- Switch Workspace
- Teamspaces（按团队/功能分组）
- Favorites / Shared / Private / Archive / Trash
- Sidebar 4 tab（2026-03）：Pages / Agent chats / Meetings / Inbox

### 9.2 Teamspace

- 创建 / 设默认 / 权限 / 成员管理 / Archive

### 9.3 Settings 分类

General / Members / Security（2FA、SSO、Content Search）/ Connections（统一 API/Webhook/Automation）/ Notion AI / Offline / Automations

### 9.4 角色

Workspace Owner / Admin / Member / Guest

### 9.5 Billing

Free / Plus / Business / Enterprise
Notion Credits（AI/Workers 按量付费）

---

## 10. 导入 / 导出

### 10.1 导入

- 格式：CSV、Markdown、HTML、Notion-to-Notion
- 集成：Evernote、Google Docs、OneNote、Asana、Trello、Word、Confluence
- 属性映射、合并选项、批量上传、进度指示

### 10.2 导出

- 格式：Markdown、HTML、CSV、PDF（Business/Enterprise）
- 全 workspace 导出、含 sub-pages、含附件、生成 sitemap
- 限制：私有页不导出、relations 变 URL、复杂 block 可能丢失

---

## 11. Mobile & Desktop

### 11.1 桌面应用（Mac & Windows）

- 多 tab、Command Search、Push Notification、Offline Mode、自动更新、完整快捷键、Deep Linking

### 11.2 移动应用（iOS & Android）

- Offline Mode、Mobile AI、Touch UI、单列布局、相机捕获、语音输入 (NEW 2026)、Push Notification

### 11.3 桌面 vs 移动差异

| 功能 | 桌面 | 移动 |
|------|------|------|
| 多 block 选择 | ✓ | ✗ |
| 导入数据 | ✓ | ✗ |
| 账户/安全/计费设置 | ✓ | ✗ |
| 列布局 | ✓ | 折叠为单列 |
| Hover states | ✓ | ✗ |
| 页面宽度样式 | ✓ | ✗ |

### 11.4 Offline 能力

- 单页手动下载、自动下载（付费）、离线编辑、后台同步、Offline Manager、部分 block 仍需联网

### 11.5 快捷键分类

Navigation（Cmd+K / Cmd+P / Cmd+\）/ Editing（Cmd+/ / Cmd+B / Cmd+I）/ Blocks（Enter / Backspace / Cmd+D）/ Pages（Cmd+N / Cmd+Shift+N）/ Search（Cmd+F / Cmd+Shift+K）

### 11.6 Quick Capture

- 桌面：Command Search → "Quick capture"
- iOS：Home widget、Siri、Action Button
- Android：Home widget、Quick Settings tile

---

## 12. 其它重要功能

### 12.1 Saved Views

- 每个 view 保存 filter/sort/group/layout 配置
- 同库多视角、命名、view 权限

### 12.2 Scheduled Reminders

- Inline `@remind`、Date 属性提醒
- 提前 N 分钟提醒、@Today 高亮（红色）

### 12.3 Notion Sites（发布到 Web）

- 一键发布、自定义域名（含 SSL）、站点定制（favicon/nav/OG/theme）、SEO、站点搜索、Notion 水印开关、链接过期、允许复制、Google Analytics、5 个免费 notion.site 子域、实时更新

### 12.4 Notion Calendar（独立 app）

- 原生日历应用、与 Notion 数据库日历视图同步、Outlook 双向同步 (NEW 2026)、AI 排程

### 12.5 Notion Mail（独立 app）

- 原生邮件应用、AI 邮件分类、Outlook 集成、邮件转 Notion

### 12.6 Notion Projects

- 项目模板、Tasks 数据库（含依赖/sub-items）、Projects 数据库

### 12.7 其它集成

WhatsApp、Salesforce、Box、ClickHouse、Mixpanel、Miro、Mercury

### 12.8 其它

- Page Analytics、Page History、Math Equations（LaTeX）、Web Clipper、Plan Mode (NEW 2026)、Merge Cells（简单表格，NEW 2026）

---

## MVP / V1 / V2 范围建议（Folio）

### MVP 必备
1. **Blocks**：全部文本 block + slash 命令 + drag handle + 基础格式化
2. **Pages**：页面树、cover/icon、breadcrumb、基础属性
3. **Databases**：Table 视图 + 核心属性（text/number/select/multi-select/date/person/checkbox/URL/relation/rollup）+ 基础 filter/sort
4. **协作**：基础评论 + @mention + 简单分享
5. **搜索**：全局搜索（Cmd+K）+ 页内搜索 + sidebar tree
6. **导入/导出**：Markdown/HTML/CSV
7. **Offline**：桌面离线编辑（简化版）

### V1 扩展
1. **Databases**：Board / Calendar / Timeline / Gallery / List 视图 + Database Templates + Formulas
2. **协作**：Presence cursors + inline comments + 通知
3. **搜索**：基础 AI 搜索 + Favorites + Recents
4. **Pages**：Page History、Trash/Restore、Backlinks
5. **模板**：Template Gallery + Button Templates
6. **移动应用**：iOS/Android
7. **Embeds**：基础嵌入（YouTube/Figma/Drive）

### V2 高级
1. **AI**：基础 AI Chat、AI Autofill、简单 Q&A
2. **Databases**：Form / Chart / Map / Dashboard 视图、Automations、Synced Databases
3. **协作**：Suggestions Mode、细粒度权限
4. **集成**：API/SDK、Webhooks、基础 connectors
5. **发布**：Notion Sites（公开链接、自定义域名）
6. **Saved Views、Reminders、Page Analytics**
7. **Developer Platform**：Workers、Custom Agents、External Agents

### 不在范围内（复杂度过高）
- 完整 Notion AI（Enterprise Search、Custom Agents）
- Notion Mail & Calendar（独立 app）
- 企业特性（SSO、Audit Log、Advanced Security）
- 完整 marketplace（100+ connectors）
- 高级数据库功能（Sub-items with dependencies、复杂 rollups）
- Mobile AI（语音输入、Home widget）

---

## 实施注意事项（本地优先）

### 技术考虑
1. **数据模型**：Block-based AST（参考 Notion）
2. **同步**：CRDT 实现实时协作
3. **Offline**：本地优先 + 可选云同步（SQLite + WebSocket）
4. **搜索**：全文搜索（Lunr.js / FlexSearch），AI 增强（可选）
5. **Databases**：properties 与 page content 分离的数据模型
6. **Embeds**：iframe + 安全约束 + oEmbed
7. **导出**：HTML 静态站点生成、Markdown 库

### 性能目标
- Slash menu 渲染：< 100ms
- 页面加载（10KB）：< 500ms
- 实时同步延迟：< 200ms
- 搜索（10,000 页）：< 300ms
- Offline 冲突解决：< 1s

### UX 优先级
1. 键盘优先（power user 期望）
2. Slash 命令可发现性
3. 直觉化拖拽
4. 亚秒级实时协作
5. 无缝 online/offline 切换
