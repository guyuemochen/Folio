# Folio MVP 产品需求文档（PRD）

| 字段 | 值 |
|------|----|
| 文档版本 | v1.0 |
| 状态 | Draft（待评审） |
| 创建日期 | 2026-07-02 |
| 作者 | Folio team |
| 目标读者 | 工程团队（实施）、设计团队（UX/UI）、PM（验收） |
| 上游文档 | [00-overview.md](../research/00-overview.md)、[01-notion-features.md](../research/01-notion-features.md)、[02-notion-design-spec.md](../research/02-notion-design-spec.md)、[03-competitive-landscape.md](../research/03-competitive-landscape.md) |
| 关联代码 | `src/`（待建）、`packages/database/`（待建） |

---

## 1. 执行摘要

### 1.1 一句话定位

> **Folio MVP 是一个本地优先的、功能对等 Notion 核心体验的桌面笔记软件**，用户安装即可用，所有数据存在本地 SQLite，无需注册账户、无需联网。

### 1.2 MVP 必交付的 4 件事

1. **完整 Block 编辑器**：TipTap 驱动，覆盖 Notion 全部基础 block（20+ 类型）+ slash 命令 + 拖拽 + Turn into + 键盘快捷键
2. **Table 数据库**：21 种属性中的 10 种核心属性 + filter/sort/group + Database Templates（Notion 的差异化护城河）
3. **完整页面树**：无限嵌套、sidebar、breadcrumb、cover/icon、收藏、回收站、版本历史（30 天）
4. **离线优先架构**：Tauri 2 + SQLite，零账户、零云端、零依赖。所有功能本地可用

### 1.3 MVP 不交付的 4 件事（明确边界）

1. **多设备同步**（v1）：MVP 是单机，所有同步层推迟到 v1
2. **协作功能**（v1）：评论、@mention、presence、分享权限
3. **Board/Calendar/Timeline 等高级视图**（v1）：MVP 只交付 Table 视图
4. **AI 功能**（v2）：可插拔 LLM 推迟到 v2
5. **移动端**（v1）：MVP 仅桌面（macOS + Windows + Linux）

### 1.4 成功指标（MVP 验收）

| 维度 | 指标 | 目标值 |
|------|------|--------|
| **功能完整性** | Notion 核心操作可重现比例 | ≥ 90%（按 01 文档 MVP 清单） |
| **性能** | 冷启动到可输入 | < 1.5s（M1/主流 PC） |
| **性能** | 10KB 页面打开到可编辑 | < 300ms |
| **性能** | Slash 命令面板渲染 | < 80ms |
| **性能** | 10,000 页库全局搜索 | < 500ms（首次索引后） |
| **稳定性** | 编辑过程崩溃率 | < 0.1% 会话 |
| **数据完整性** | 保存失败率 | < 0.01% 写入 |
| **包大小** | macOS dmg / Windows exe | < 30MB |
| **内存** | 空闲占用 | < 120MB |

---

## 2. 目标与非目标

### 2.1 目标（MVP 必达）

#### G1：本地优先的可靠性
- 所有数据写入本地 SQLite（WAL 模式），单文件可备份/迁移
- 任意操作 0 网络依赖；网络断开不影响任何核心功能
- 崩溃后重启数据零丢失（每次写入 fsync + WAL）

#### G2：Notion 级编辑体验
- Block 拖拽、Turn into、Duplicate、Color、Comment-ready 钩子
- Slash 命令模糊搜索 + Recent 优先 + 分类
- 全部 Notion 桌面端快捷键 1:1 兼容
- 完整 Notion 设计系统（02 文档 token 全量实现）

#### G3：Table 数据库的杀手级体验
- 10 种核心属性（覆盖 80% 用户场景）
- filter（AND/OR 嵌套）/ sort（多级）/ group（按 select/status）
- 行=页面（点击进入详情页）
- Database Templates（新建行的默认结构）
- Linked Database（同库多处引用、不同 filter）

#### G4：完整的页面与导航
- 无限嵌套的 page tree（数据库行也是 page）
- Sidebar 树状导航 + 收藏 + Recents + Trash
- Breadcrumb + 面包屑 hover 操作（刷新/复制链接/更多）
- 全局搜索（Cmd+K）+ 页内搜索（Cmd+F）

#### G5：开放的数据可移植性
- Markdown 双向同步（页面可导出 .md，.md 可导入还原）
- HTML 导出（单页 + 全 workspace）
- CSV 导入/导出（数据库）
- Notion Markdown/HTML 导入（迁移用户）

### 2.2 非目标（MVP 明确不做）

| # | 非目标 | 原因 | 何时考虑 |
|---|--------|------|---------|
| NG1 | 多设备同步 | 同步复杂度高，MVP 优先验证本地体验 | v1 |
| NG2 | 实时协作（评论/光标/分享） | 依赖同步层 | v1 |
| NG3 | Board/Calendar/Timeline 等视图 | Table 是基础，先打牢 | v1 |
| NG4 | Relation/Rollup/Formula | 复杂数据模型，先验证基础属性 | v1（Formula + Relation），v2（Rollup） |
| NG5 | AI 集成 | 依赖外部 LLM provider，且 MVP 价值密度低 | v2 |
| NG6 | 移动端 | Tauri 2 mobile 仍在成熟，桌面优先 | v1 末 |
| NG7 | Notion Sites（发布到 web） | 需要独立部署/域名体系 | v2 |
| NG8 | Plugin 系统 | 需要 API 稳定后再开放 | v2 |
| NG9 | 自托管 sync server | 依赖同步层 | v1 |
| NG10 | OCR、PDF 标注、白板等非核心 | 偏离 Notion 核心范式 | 不在路线图 |

### 2.3 假设与依赖

- **假设**：用户接受"单机优先、后续扩展同步"，类似 Obsidian 早期
- **假设**：用户能从 Notion Markdown 导入迁移（不要求 100% 还原）
- **依赖**：Tauri 2.x（≥ 2.0 GA）、TipTap v2、cr-sqlite 0.x、SQLite 3.45+
- **依赖**：用户 OS 为 macOS 12+ / Windows 10+ / Ubuntu 22.04+

---

## 3. 目标用户与画像

### 3.1 主画像

#### Persona A：知识工作者（主用户，60%）

> **李明，32 岁，产品经理**

- 当前用 Notion 管理产品文档、需求池、个人 wiki
- 痛点：
  - 公司不允许把内部数据放 Notion 云端
  - 数据被锁在 Notion，导出后格式残缺
  - 国内访问 Notion 偶尔卡顿
- 期待：本地存储、可离线、能从 Notion 一键迁移、UI 不重新学习

**对 Folio 的核心诉求**：UI/操作 1:1 像 Notion，但数据在我的硬盘上。

#### Persona B：独立开发者（30%）

> **张三，28 岁，全栈工程师**

- 当前用 Obsidian + 一堆插件（dataview/templater）搭建知识库
- 痛点：
  - Obsidian 没有原生数据库，dataview 学习曲线陡
  - 配置麻烦，更换设备要重装所有插件
  - 想要类 Notion 的块编辑，但不想要云端
- 期待：原生数据库、TypeScript-friendly、有 API、可脚本化

**对 Folio 的核心诉求**：Notion 块编辑 + 数据库 + 本地 Markdown 文件 + 开放 API。

#### Persona C：隐私敏感用户（10%）

> **王五，40 岁，律师**

- 拒绝任何 SaaS 工具
- 当前用 Joplin / Standard Notes
- 痛点：功能太简单，无数据库、无块编辑
- 期待：本地优先、零账户、可选 E2EE、开源可审计

**对 Folio 的核心诉求**：完全离线、可审计开源、数据不离开本机。

### 3.2 反画像（MVP 不服务）

- ❌ 需要 50+ 人实时协作的团队（用 Notion / Confluence）
- ❌ 需要企业 SSO/Audit 的组织（v2 才考虑）
- ❌ 重度移动端用户（v1 才有移动端）
- ❌ 需要 Notion Sites 发布公开网页的用户
- ❌ 需要 Notion Mail/Calendar 集成的用户

---

## 4. 用户故事

### 4.1 Block 编辑

**US-B01**：作为知识工作者，我想在空行按 `/` 弹出命令面板，模糊搜索块类型，按 Enter 插入，这样我不需要鼠标就能快速构建内容。

**US-B02**：作为知识工作者，我想选中多个块拖拽重排，看到清晰的 drop indicator（实线=兄弟、虚线=嵌套），这样我能直觉化重组文档结构。

**US-B03**：作为知识工作者，我想右键块看到「Duplicate / Turn into / Color / Copy link / Comment / Move to」菜单，所有操作有快捷键，这样 power user 操作飞快。

**US-B04**：作为知识工作者，我想粘贴 URL 自动变 bookmark、粘贴图片自动上传、粘贴 Markdown 自动转换，这样我从浏览器/其它工具迁移无摩擦。

**US-B05**：作为知识工作者，我想用 `Cmd+B/I/U/E` 加粗/斜体/下划线/行内代码，`Cmd+Shift+1/2/3` 切换 H1/H2/H3，`Cmd+D` 复制块，这些快捷键和 Notion 完全一致，这样我迁移过来零学习成本。

### 4.2 Page 与导航

**US-P01**：作为知识工作者，我想在 sidebar 看到完整的页面树（含数据库），可拖拽重排、右键 move to / duplicate / trash，这样我能组织上百个页面。

**US-P02**：作为知识工作者，我想给每个页面加封面图和 emoji icon，从 Unsplash 选或上传，这样我的页面有视觉识别度。

**US-P03**：作为知识工作者，我想在 breadcrumb 上 hover 看到「刷新/页面 icon/复制链接/更多」icon，点击 icon 打开 emoji 选择器，点击面包屑跳转父页，这样导航高效。

**US-P04**：作为知识工作者，我想按 `Cmd+K` 打开全局搜索，输入关键词模糊匹配所有页面标题和正文，按方向键 + Enter 跳转，这样在百页库中找东西 < 1s。

**US-P05**：作为知识工作者，我想右键页面「Move to Trash」，30 天内可在 Trash 还原，这样误删不致命。

### 4.3 Table 数据库

**US-D01**：作为产品经理，我想在任意页面输入 `/table` 创建数据库，自动打开 Table 视图，看到 Title 列 + 「+ New」按钮，这样 5 秒内开始建模。

**US-D02**：作为产品经理，我想给数据库加属性：Text / Number / Select / Multi-select / Date / Person / Checkbox / URL / Status / Files，每个属性可设默认值，这样我能表达任何业务实体。

**US-D03**：作为产品经理，我想点击列头排序（升/降）、点击筛选图标添加复杂 filter（属性 + 操作符 + 值 + AND/OR 嵌套），filter 可命名保存为 view，这样不同视角看同一份数据。

**US-D04**：作为产品经理，我想点击行打开详情页（行 = page），在详情页加任意 block（文档、图片、子数据库），这样每个需求/任务都有完整上下文。

**US-D05**：作为产品经理，我想为数据库定义 Template（如「Bug 模板」包含复现步骤 + 影响范围 + 优先级），新建行时选模板，这样团队录入标准化。

**US-D06**：作为产品经理，我想在另一个页面嵌入「Linked Database」（同源数据 + 不同 filter/sort/view），这样首页 dashboard 显示「我的任务」、需求页显示「本需求下的 bug」。

### 4.4 导入导出

**US-I01**：作为从 Notion 迁移的用户，我想「File → Import → Notion Markdown Zip」选择 Notion 导出的 Markdown 压缩包，自动还原页面树 + 部分属性（已支持的属性类型），这样 1 小时内完成迁移。

**US-I02**：作为备份需求用户，我想「File → Export → Markdown / HTML / CSV」一键导出整个 workspace 为带 sitemap 的静态站点，这样我能在浏览器直接浏览备份。

### 4.5 离线与性能

**US-O01**：作为通勤用户，我想在飞机上断网继续编辑，所有操作正常，联网后不丢失任何变更，这样移动办公无忧。

**US-O02**：作为大库用户（10,000+ 页），我想侧边栏/搜索/打开页都在 500ms 内响应，这样大数据集不卡顿。

---

## 5. 功能需求详述（MVP 范围）

> 本章节是工程实施依据。每个功能模块包含：范围 / 详述 / 验收点 / 依赖。

### 5.1 Block 系统

#### 5.1.1 支持的 Block 类型（MVP 必交付，20 种）

| 类别 | Block 类型 | Notion 等价 |
|------|-----------|-------------|
| 文本 | paragraph、heading1、heading2、heading3、quote、callout、bulletedListItem、numberedListItem、toDoList、toggle | 全部 1:1 |
| 代码 | code（含语言选择 + 语法高亮 + 复制按钮） | 1:1 |
| 分隔 | divider、equation（KaTeX） | 1:1 |
| 媒体 | image（本地上传 + URL）、bookmark、embed（iframe 白名单） | 部分简化 |
| 高级 | table（简单表格，非数据库）、column（多列布局） | 1:1 |
| 转换 | 子页面（page，inline 创建子页） | 1:1 |

**MVP 不交付**：video、audio、file upload、PDF、synced block、AI block、HTML block

#### 5.1.2 Slash 命令

- **触发**：空行 `/` 或空段任意位置 `/`
- **UI**：popover 280×320px，12px radius，多层 shadow（02 文档定义）
- **分类**：Basic / Database / Media / Advanced（tab 切换 + 默认 All）
- **Recent**：最近 5 个使用过的块类型，置顶
- **搜索**：fuzzy match，输入 `head` 显示 H1/H2/H3
- **导航**：↑↓ + Enter，Escape 关闭，点击外部关闭
- **选中样式**：#dcecfa 淡蓝

**验收**：输入到面板渲染 < 80ms；键盘完全可用；选中后清 query + 转换块类型

#### 5.1.3 块操作菜单（右键 / drag handle）

菜单项（含快捷键）：
1. Delete（⌫ 或 Cmd/Ctrl+Delete）
2. Duplicate（Cmd/Ctrl+D）
3. Turn into → 子菜单（10 种文本类型互转）
4. Color → 9 色 grid（含 6 高亮 + 9 文字色）
5. Copy link to block
6. Comment（MVP 仅占位，v1 实现）
7. Move to → workspace 选择器

**验收**：菜单 220px 宽，36px item 高，hover #e6f0fa；所有项有键盘等价

#### 5.1.4 拖拽重排

- **handle**：⋮⋮ 六点，hover 显示（100ms 渐入），选中时始终显示
- **drop indicator**：蓝色水平线，实线=兄弟 drop，虚线=嵌套子 drop
- **嵌套阈值**：距 list item 左缘 28px 触发嵌套
- **多选拖拽**：左侧 24px 拖框选多块，drag handle 在首个选中块
- **自动滚动**：靠近页边按速度递增
- **列分割**：拖到另一块侧面，蓝色竖线指示，松开创建两列

#### 5.1.5 键盘快捷键（Notion 1:1 兼容）

| 快捷键 | 动作 |
|--------|------|
| Cmd/Ctrl+E | 行内代码 |
| Cmd/Ctrl+B / I / U | 加粗 / 斜体 / 下划线 |
| Cmd/Ctrl+Shift+S | 删除线 |
| Cmd/Ctrl+Shift+1/2/3 | 转 H1/H2/H3 |
| Cmd/Ctrl+D | 复制块 |
| Cmd/Ctrl+Delete | 删除块 |
| Cmd/Ctrl+K | 插入链接 |
| Cmd/Ctrl+Shift+K | 移除链接 |
| Cmd/Ctrl+/ | 打开命令面板（同 /） |
| Cmd/Ctrl+Z / Shift+Z | 撤销 / 重做 |
| Tab / Shift+Tab | 缩进 / outdent |
| Mod+Shift+↑/↓ | 块上移 / 下移 |
| Cmd/Ctrl+N | 新建页面 |
| Cmd/Ctrl+Shift+N | 新建子页面 |
| Cmd/Ctrl+K | 全局搜索 |
| Cmd/Ctrl+F | 页内搜索 |
| Cmd/Ctrl+\ | 切换 sidebar |
| Enter | 新块（默认 paragraph） |
| Backspace（空块） | 删除块 + 光标上移 |

#### 5.1.6 粘贴智能

- URL → bookmark（fetch OG metadata）
- 图片二进制 → image block（存本地 media/）
- YouTube URL → embed
- Markdown 文本 → 对应块（02 文档第 7.5 节）
- HTML → 剥离格式 + 转 block 结构
- 表格 HTML → 简单 table block（非数据库）

#### 5.1.7 内容格式（inline）

- Bold / Italic / Underline / Strikethrough / Code / Link
- 文字色（9 种）+ 高亮色（6 种）+ 默认（移除）
- 字号仅 paragraph 默认；H1/2/3 由块类型决定

---

### 5.2 Page 系统

#### 5.2.1 数据模型（详见 §8）

每个 page 包含：
- id（UUID v4）
- parent_id（page 或 database，可空=顶层）
- parent_type（'page' / 'database' / 'workspace'）
- title（富文本，存为 JSON）
- icon（emoji 或 file ref）
- cover（file ref）
- properties（JSON，仅 database 子页面有效）
- content（block 树根 ID 列表）
- created_at / updated_at / created_by / updated_by
- is_archived / is_trashed / trashed_at
- full_width / small_text（用户偏好）

#### 5.2.2 页面 chrome

- **Top bar**：44px 高（桌面），透明 → 滚动时 rgba(255,255,255,0.95)
- **Breadcrumb**：左对齐，hover 显示 4 个 icon（刷新/页面 icon/复制链接/更多）
- **Action cluster**：右对齐，Share（占位）/ More（⋯）/ Favorite（⭐）/ Comments（💬 占位）
- **Cover**：全宽，1500px+ 推荐，可上传或选 Unsplash
- **Icon**：emoji picker 或自定义图，40px 显示，180×180 picker
- **Title**：40px / 600 / 1.2，placeholder "Untitled"
- **Content**：max-width 860px（可切 small/full）

#### 5.2.3 页面树与 sidebar

- **Sidebar 结构**：
  ```
  [Workspace Switcher]
  Search (Cmd+K)
  ─────────
  Favorites（可拖入）
  ─────────
  Recents（最近 10）
  ─────────
  Teamspaces（MVP 只有 default）
    └─ Page Tree（无限嵌套）
  ─────────
  Trash
  ─────────
  Settings / About
  ```
- **页面树交互**：
  - chevron（▸▾）展开/收起
  - 拖拽重排
  - 右键：New subpage / Rename / Duplicate / Move to / Favorite / Trash
  - 当前页：粗体 + #e6f0fa 背景
  - hover：#f7f6f3 背景
  - 每级缩进 16px

#### 5.2.4 Trash & History

- **Trash**：删除页移入 Trash（保留 parent_id），30 天后自动物理删除（后台 cron）
- **Restore**：Trash 中右键 Restore，恢复原 parent；若 parent 已删，恢复到 workspace root
- **Permanent Delete**：Trash 中右键 Delete forever
- **Page History**（简化版）：
  - 每次 save 创建快照（debounce 5s）
  - 保留 30 天
  - 用户可查看快照、恢复（覆盖当前）
  - MVP 不做 diff（v1 加 snapshot diff）

---

### 5.3 Table 数据库（MVP 核心）

#### 5.3.1 数据库创建

- 入口 1：slash `/table` / `/database`
- 入口 2：sidebar 右键 New database
- 入口 3：现有 page 内菜单 Insert database
- 创建即打开 Table 视图，默认列：Title（必有）

#### 5.3.2 属性类型（MVP 10 种）

| 类型 | 说明 | 编辑 UI |
|------|------|---------|
| **title** | 必有，单列，富文本 | inline 编辑 |
| **rich_text** | 多行富文本 | 弹出编辑 |
| **number** | 数值，支持格式（整数/小数/百分比/货币 5 种） | inline 数字输入 |
| **select** | 单选下拉，预定义选项 + 颜色 | dropdown + 颜色 dot |
| **multi_select** | 多选 tags | dropdown 多选 |
| **status** | 类似 select，但带 progress 语义（To do/In progress/Done） | dropdown + 颜色 |
| **date** | 日期 + 时间（可关）+ 时区 | datepicker |
| **person** | 用户（MVP 仅本机用户） | 简化为单选「Me」 |
| **checkbox** | 布尔 | checkbox 切换 |
| **url** | URL，自动 linkify | inline 输入 + 校验 |

**MVP 不交付**：email / phone / files / created_time / created_by / last_edited_time / last_edited_by / id / formula / relation / rollup（v1 加 formula + relation；v2 加 rollup 与自动字段）

#### 5.3.3 Table 视图 UI

- **表头行**：40px 高，#f7f6f3，hover 显示 sort（↑↓）+ filter（漏斗）+ 列重排 handle（⋮⋮）
- **列操作**：点击列头 → 菜单（Rename / Edit property / Duplicate / Delete / Sort / Filter / Hide）
- **列宽**：拖拽边缘调整，状态存 view 配置
- **Body 行**：min 40px 高，hover #e6f0fa，点击行打开详情页
- **行多选**：Shift+点击 选多行；右键菜单：Delete / Duplicate / Export CSV
- **"+ New" 按钮**：表格右上，Notion 蓝 pill，点击添加「Untitled」新行
- **空状态**：表格 body 居中显示「+ New」按钮（无文字）
- **View Tabs**：表头之上，MVP 只支持单 view（v1 加多 view），但 UI 已实现 tab 容器

#### 5.3.4 Filter 系统

- **Filter bar**：表头之下，36px 高，白底 + border-bottom
- **Filter chip**：pill 状 20px 高，文字「property operator value」，× 移除
- **添加 filter**：点击 + Add filter
- **Filter 编辑器**：modal 600px 宽
  - 顶层：AND / OR 切换
  - 每条 filter：属性选择 + 操作符选择（依属性类型变化）+ 值输入
  - 嵌套：支持 AND/OR 嵌套（最多 2 层）
- **操作符**（按类型）：
  - text: contains / does not contain / starts with / ends with / is empty / is not empty
  - number: = / ≠ / > / < / ≥ / ≤ / is empty / is not empty
  - select / status: is / is not / is empty / is not empty（可多选）
  - date: is / is before / is after / is within / is empty / is not empty
  - checkbox: is checked / is unchecked
  - url: is / is not / contains / starts with / ends with

#### 5.3.5 Sort 系统

- 多级排序，每级：属性 + asc/desc
- UI：列头点击切换 asc → desc → 清除；或 view 菜单 Sort 设置多级
- 状态存 view

#### 5.3.6 Group 系统

- 按 select / multi_select / status 属性分组
- UI：每组带 header（属性值 + 计数徽章）+ 4px 左色条
- 组可折叠
- 拖拽行跨组（更新属性）
- 状态存 view

#### 5.3.7 Database Templates

- 每个 database 可定义 N 个 Template（名称 + icon + 默认 property 值 + 默认 content）
- 新建行 → 选 Template 或空白
- 可设默认 Template（+ New 直接用）
- Template 编辑：等同于编辑普通页（同样支持所有 block）

#### 5.3.8 Linked Database

- 入口：slash `/linked-database` 或 drag 现有 database 到另一页
- 实质：在 page 的 content 中插入 `database_view` block，引用源 database + 自带 view 配置
- 行为：与源 database 数据双向同步，但 filter/sort/group/view 独立
- UI：表头显示「🔗 linked」徽章

#### 5.3.9 数据库行 = 页面

- 点击行打开详情页（同普通 page chrome）
- **详情页与普通 page chrome 不同**（决议 Q5-B）：
  - 顶部 80px 高 property 面板（横向排列所有 property 输入控件，每项 200-300px 宽）
  - property 面板 sticky（向下滚动时保持可见）
  - 面板下方为标准 content 区（所有 block 类型）
  - 面板可折叠（点击 chevron 收起）
- 可在 content 区再嵌套子 database（无限）
- **不**完全复用普通 page chrome —— property 面板是行页面的差异化 UI

---

### 5.4 全局搜索（Cmd+K）

#### 5.4.1 索引

- 后台 SQLite FTS5 全文索引（pages.title + blocks.text + database property values）
- 索引触发：写入后 debounce 500ms 增量更新
- 首次启动：全量构建索引（10,000 页 < 30s）

#### 5.4.2 搜索 UI

- **触发**：Cmd/Ctrl+K（全局，任何上下文）
- **UI**：居中 modal 480px 宽，max-height 600px
- **输入框**：顶部，48px 高，placeholder「Search pages and content...」
- **结果分组**：
  - Recent（无 query 时显示最近 10 个浏览页）
  - Pages（按 title 匹配）
  - Content（按正文匹配，显示片段 + 高亮）
  - Database rows（按属性值匹配）
- **结果 item**：36px 高，左 icon（页面 icon / 类型 icon）+ 标题 + 路径面包屑（小灰字）+ 右侧操作提示
- **键盘**：↑↓ + Enter / Cmd+Enter 新窗口打开（MVP 不支持多窗口，留给 v1）/ Escape 关闭
- **排序选项**：Best match / Last edited / Created（默认 Best match）

#### 5.4.3 页内搜索（Cmd+F）

- 顶部下拉条，输入即高亮所有匹配
- ↑↓ 切换匹配项，Enter 下一个
- 替换（Replace / Replace All）：MVP 暂不交付（v1 加）

---

### 5.5 导入 / 导出

#### 5.5.1 导入

| 格式 | 实现 |
|------|------|
| **Notion Markdown Zip** | 解压 → 解析目录树为 page tree → 每个 .md 转 block 树（含 frontmatter → properties）→ 引用的图片复制到 media/ |
| **Markdown 单文件** | 同上，单页导入 |
| **HTML** | 用 cheerio 解析，DOM → block 树 |
| **CSV** | 创建 database，每行一页，列名 → property |

**约束**：
- 大于 100MB 的 zip 拒绝
- 单次最多 1000 页
- 不支持的 property 类型忽略 + 警告日志

#### 5.5.2 导出

| 格式 | 范围 | 实现 |
|------|------|------|
| **Markdown** | 单页 / 全 workspace | 递归导出，含 sitemap.md、media 文件夹 |
| **HTML** | 单页 / 全 workspace | 含 CSS、可浏览器直接打开、sitemap.html |
| **CSV** | 单 database | 行 = 行，列 = property |
| **Folio Backup** | 全 workspace | SQLite 单文件 + media zip，可一键还原（用于迁移设备） |

---

### 5.6 Offline 与持久化

#### 5.6.1 持久化策略

- **存储位置**（决议 Q7-B：用户可自定义）：
  - **默认位置**（首次启动自动创建）：
    - macOS: `~/Library/Application Support/Folio/`
    - Windows: `%APPDATA%\Folio\`
    - Linux: `~/.local/share/Folio/`
  - **自定义位置**：用户可在 Settings → General → Storage Location 切换
    - 切换流程：选目标目录 → 验证可写 → 关闭 db → 复制数据 → 切换 → 重启
    - 自定义位置需满足：可写、剩余空间 > 当前数据大小 × 1.5、非系统目录
    - 支持外接硬盘 / 网络盘（但警告 I/O 性能可能受影响）
  - **路径持久化**：实际位置记录在 `%APPDATA%/Folio-path.txt`（永远在 OS 默认位置，作为指针）
  - 数据所有权承诺：用户可随时把整个数据目录拷贝到任意位置直接打开
- **数据库**：`data.db`（SQLite WAL 模式，单文件）
- **媒体**：`media/<sha256>.<ext>`（去重）
- **索引**：`index.db`（FTS5，可与主库合并）
- **配置**：`config.json`（用户偏好）+ `keymap.json`（自定义快捷键）

#### 5.6.2 写入策略

- 每次块编辑：TipTap transaction → 增量更新 SQLite（debounce 200ms）
- 索引更新：debounce 500ms
- 关键操作（保存、删除、移动）：同步 fsync + WAL checkpoint
- 自动备份：每日 03:00 全量备份到 `backups/YYYY-MM-DD.db.bak`，保留 7 份

#### 5.6.3 数据完整性

- WAL 模式 + `PRAGMA synchronous = FULL`（牺牲一些性能换可靠性）
- 启动时 `PRAGMA integrity_check`，失败则提示用户从最近备份恢复
- 每次写入返回 rowid，前端验证写入成功

---

## 6. 信息架构

### 6.1 应用导航层级

```
┌────────────────────────────────────────────────────────────────────┐
│ Tauri Window (1024×768 min)                                        │
├──────────┬─────────────────────────────────────────────────────────┤
│          │ Top Bar (44px)                                          │
│ Sidebar  │ [Breadcrumb]                            [⭐][⋯][💬]    │
│ (240px)  ├─────────────────────────────────────────────────────────┤
│          │                                                         │
│ Search   │ Cover Image (full-width)                                │
│ ─────    │                                                         │
│ Favorite │ 📄 Page Title (40px)                                    │
│  - Page1 │                                                         │
│  - Page2 │ ┌─────────────────────────────────────────────────────┐│
│ ─────    │ │ Content Area (max 860px, centered)                  ││
│ Recents  │ │                                                     ││
│  - ...   │ │ [Block] [Block] [Block] ...                         ││
│ ─────    │ │                                                     ││
│ Pages    │ │ • drag handle ⋮⋮ on hover                           ││
│  ├─ Doc  │ │ • slash command /                                   ││
│  │  └─ . │ │ • table database inline                             ││
│  └─ DB   │ │                                                     ││
│ ─────    │ └─────────────────────────────────────────────────────┘│
│ Trash    │                                                         │
│ Settings │                                                         │
└──────────┴─────────────────────────────────────────────────────────┘
```

### 6.2 路由设计（前端 React Router）

```
/                              → 重定向到最近打开的页 或 workspace root
/page/:pageId                  → 普通页
/page/:pageId?block=:blockId   → 普通页 + 滚动到块
/database/:pageId              → 数据库详情页（table view）
/database/:pageId/row/:rowId   → 数据库行详情页（同普通页 chrome）
/search                        → 全局搜索 modal（覆盖任意路由）
/trash                         → 回收站
/settings/:tab                 → 设置（general/shortcuts/about）
```

### 6.3 设置面板

MVP 仅 4 个 tab：
1. **General**：workspace 名 / 默认页宽 / 主题（light/dark/system）/ 默认 emoji / **存储位置**（显示当前路径 + 「Change Location」按钮，决议 Q7-B）/ **字体重载**（切换 CJK 字体源：内置/系统）
2. **Shortcuts**：所有快捷键列表 + 可自定义（v1）
3. **Import / Export**：导入按钮、导出按钮、备份/恢复
4. **About**：版本号、开源链接、问题反馈、**字体许可信息**（决议 Q6-A）

---

## 7. 技术架构

### 7.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri 2 Process                                              │
│ ┌────────────────────────┐  ┌──────────────────────────────┐│
│ │ Webview (Chromium/WebKit)│  │ Rust Core (tauri::app)       ││
│ │ ──────────────────────  │  │ ──────────────────────────   ││
│ │ React 19                │  │ SQLite (rusqlite)            ││
│ │ TipTap v2 (ProseMirror) │  │ FTS5                         ││
│ │ Tailwind v4             │  │ File I/O                     ││
│ │ Zustand                 │  │ Backup scheduler             ││
│ │ TanStack Query          │  │ Auto-updater                 ││
│ │ React Router            │  │                              ││
│ └──────────┬─────────────┘  └──────────┬───────────────────┘│
│            │ Tauri IPC (invoke)        │                    │
│            └─────────────┬─────────────┘                    │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
                SQLite + media/ on disk
```

### 7.2 前端职责

- 渲染 UI（TipTap 编辑器、sidebar、modal、popover）
- 用户输入处理（键盘、鼠标、拖拽）
- optimistic update（先更新 UI，后等待 Rust 确认）
- 本地状态（Zustand store：当前页、sidebar 状态、theme）
- 服务端状态（TanStack Query：从 Rust 拉取的数据）

### 7.3 Rust 后端职责

- SQLite CRUD（pages / blocks / databases / properties）
- FTS5 索引管理
- 文件 I/O（media 上传/读取、备份、导入导出）
- Tauri command handler（前端通过 invoke 调用）
- 后台任务（备份、垃圾回收、索引重建）

### 7.4 通信协议

前端 → 后端：`tauri.invoke('command_name', { args })`
后端 → 前端：`tauri.events.emit('event_name', payload)`（用于通知，如「索引重建完成」）

所有 command 走 capability-based 权限系统（Tauri 2 默认）。

---

## 8. 数据模型（SQLite Schema）

### 8.1 核心表

```sql
-- 工作空间（MVP 单 workspace，但 schema 留扩展空间）
CREATE TABLE workspace (
    id          TEXT PRIMARY KEY,           -- UUID v4
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,           -- unix ms
    schema_version INTEGER NOT NULL DEFAULT 1
);

-- 页面（含数据库）
CREATE TABLE page (
    id          TEXT PRIMARY KEY,           -- UUID v4
    workspace_id TEXT NOT NULL REFERENCES workspace(id),
    parent_id   TEXT REFERENCES page(id),   -- 自引用；NULL = 顶层
    parent_type TEXT NOT NULL CHECK (parent_type IN ('workspace', 'page', 'database')),
    type        TEXT NOT NULL CHECK (type IN ('page', 'database')),  -- 数据库也是 page
    title       TEXT NOT NULL DEFAULT '',   -- 富文本 JSON
    icon        TEXT,                       -- emoji 或 file_id
    cover       TEXT,                       -- file_id
    properties  TEXT,                       -- JSON: database schema 定义（仅 type='database'）
    full_width  INTEGER NOT NULL DEFAULT 0,
    small_text  INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    is_trashed  INTEGER NOT NULL DEFAULT 0,
    trashed_at  INTEGER,
    created_at  INTEGER NOT NULL,
    created_by  TEXT NOT NULL DEFAULT 'local',
    updated_at  INTEGER NOT NULL,
    updated_by  TEXT NOT NULL DEFAULT 'local'
);

CREATE INDEX idx_page_parent ON page(parent_id, parent_type);
CREATE INDEX idx_page_workspace ON page(workspace_id);
CREATE INDEX idx_page_trashed ON page(is_trashed, trashed_at);

-- 块（每个 block 一行）
CREATE TABLE block (
    id          TEXT PRIMARY KEY,           -- UUID v4
    page_id     TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    parent_block_id TEXT REFERENCES block(id),  -- NULL = page 顶层
    type        TEXT NOT NULL,              -- 'paragraph' / 'heading1' / ... / 'database_view'
    content     TEXT NOT NULL,              -- JSON: 自定义 schema（见 §8.4）
    props       TEXT NOT NULL DEFAULT '{}', -- JSON: 块特有属性（如 callout.icon、code.language）
    order       REAL NOT NULL,              -- 排序键（fractional indexing）
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_block_page ON block(page_id, parent_block_id, order);
CREATE INDEX idx_block_type ON block(page_id, type);

-- 数据库 schema（page.type='database' 的属性定义）
CREATE TABLE database_property (
    id          TEXT PRIMARY KEY,
    database_id TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,              -- 'title'/'rich_text'/'number'/...
    options     TEXT,                       -- JSON: select/status 选项 [{ value, color }]
    number_format TEXT,                     -- 'integer'/'percent'/'currency' 等
    is_required INTEGER NOT NULL DEFAULT 0,
    order       REAL NOT NULL,
    UNIQUE(database_id, name)
);

CREATE INDEX idx_dbprop_database ON database_property(database_id, order);

-- 数据库行属性值（page.parent_type='database' 时）
CREATE TABLE page_property (
    page_id     TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    property_id TEXT NOT NULL REFERENCES database_property(id) ON DELETE CASCADE,
    value       TEXT,                       -- JSON: 依类型不同
    PRIMARY KEY (page_id, property_id)
);

CREATE INDEX idx_pageprop_value ON page_property(property_id, value);

-- 数据库视图（Linked Database 是同源 + 不同 view）
CREATE TABLE database_view (
    id          TEXT PRIMARY KEY,
    database_id TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT 'Table',
    type        TEXT NOT NULL DEFAULT 'table',  -- MVP 仅 'table'
    filter      TEXT,                       -- JSON: filter 树
    sort        TEXT,                       -- JSON: [{ property, direction }]
    group       TEXT,                       -- JSON: { property, hidden_groups: [] }
    hidden_properties TEXT,                 -- JSON: [property_id]
    column_widths TEXT,                     -- JSON: { property_id: pixels }
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);

CREATE INDEX idx_dbview_database ON database_view(database_id);

-- 数据库模板
CREATE TABLE database_template (
    id          TEXT PRIMARY KEY,
    database_id TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    icon        TEXT,
    default_property_values TEXT,           -- JSON
    content_blocks TEXT,                    -- JSON: block 树模板
    is_default  INTEGER NOT NULL DEFAULT 0
);

-- 文件（图片、附件等）
CREATE TABLE file (
    id          TEXT PRIMARY KEY,           -- UUID v4
    sha256      TEXT NOT NULL UNIQUE,       -- 去重键
    ext         TEXT NOT NULL,              -- 扩展名
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE INDEX idx_file_sha ON file(sha256);

-- 页面历史快照
CREATE TABLE page_snapshot (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES page(id) ON DELETE CASCADE,
    snapshot    TEXT NOT NULL,              -- JSON: 完整页面 + blocks 状态
    created_at  INTEGER NOT NULL
);

CREATE INDEX idx_snapshot_page ON page_snapshot(page_id, created_at DESC);

-- 用户偏好（设置）
CREATE TABLE preference (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                     -- JSON
);

-- 元数据
CREATE TABLE schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- 例：schema_version、installed_at、last_backup_at
```

### 8.2 全文索引（FTS5）

```sql
-- 页面标题 + 内容的全文索引
CREATE VIRTUAL TABLE page_fts USING fts5(
    page_id UNINDEXED,
    title,
    content,
    tokenize = 'porter unicode61'
);

-- 触发器：page 更新时同步 FTS
CREATE TRIGGER page_ai AFTER INSERT ON page BEGIN
    INSERT INTO page_fts(page_id, title, content)
    VALUES (new.id, new.title, '');
END;

CREATE TRIGGER block_ai AFTER INSERT ON block BEGIN
    UPDATE page_fts SET content = content || ' ' || new.content
    WHERE page_id = new.page_id;
END;

-- （类似 UPDATE/DELETE 触发器省略）
```

### 8.3 v1 扩展预留

- `sync_state` 表：每行带 `last_synced_at`、`revision`（为 v1 CRDT 同步预留）
- `user` 表：MVP 单用户（local），v1 多用户协作
- `comment` 表：v1 评论
- `automation` 表：v2 自动化

### 8.4 Block Content 自定义 Schema（决议 Q1-B）

> **决议**：不使用 TipTap/ProseMirror 原生 JSON，使用**前向兼容的中间层 schema**。
> 代价：开发期需写 TipTap ↔ 中间 schema 双向转换层（约 500 行 TS）。
> 收益：未来切换编辑器（Lexical / BlockSuite）或升级 TipTap 主版本时，存量数据零迁移。

#### 8.4.1 设计原则

1. **字段名稳定**：一旦发布不可改名，新增字段必须有默认值
2. **类型显式**：所有字段有明确 type，避免隐式推断
3. **版本号字段**：每个 block content 含 `schema_version`，迁移时按版本号升级
4. **JSON 子集**：仅用 JSON 标准类型（string/number/bool/null/array/object），无 Date/undefined

#### 8.4.2 Schema 结构（MVP）

```typescript
// 所有 block content 的顶层结构
interface BlockContent {
  schema_version: 1;              // 当前版本号，未来升级时递增
  type: BlockContentType;         // 与 block.type 一致，冗余但便于反序列化
  data: BlockContentData;         // 类型相关数据
}

type BlockContentType =
  | 'text'                        // paragraph / heading1-3 / quote / toggle / callout
  | 'list_item'                   // bulleted / numbered / to_do
  | 'code'
  | 'equation'
  | 'divider'
  | 'image'
  | 'bookmark'
  | 'embed'
  | 'table_simple'                // 简单表格（非数据库）
  | 'database_view'               // 引用 database + view_id
  | 'column_layout';              // 多列布局容器

// 文本类（最常见）
interface TextContent {
  schema_version: 1;
  type: 'text';
  data: {
    text: RichText[];             // 富文本段（每段同样式）
  };
}

interface RichText {
  text: string;
  marks: TextMark[];              // 空数组 = 无样式
}

interface TextMark {
  type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'link' | 'color' | 'highlight';
  attrs?: {
    url?: string;                 // for 'link'
    color?: ColorName;            // for 'color'，9 种语义色
    highlight?: HighlightName;    // for 'highlight'，6 种高亮色
  };
}

// list item
interface ListItemContent {
  schema_version: 1;
  type: 'list_item';
  data: {
    text: RichText[];
    checked?: boolean;            // 仅 to_do
    children?: BlockContent[];    // 嵌套子项（递归）
  };
}

// code
interface CodeContent {
  schema_version: 1;
  type: 'code';
  data: {
    code: string;
    language: string;             // 语言 ID（如 'typescript'、'rust'）
  };
}

// image
interface ImageContent {
  schema_version: 1;
  type: 'image';
  data: {
    file_id: string;              // 引用 file 表
    alt?: string;
    caption?: RichText[];
    width?: number;               // 像素，可空 = 自适应
  };
}

// bookmark
interface BookmarkContent {
  schema_version: 1;
  type: 'bookmark';
  data: {
    url: string;
    title?: string;               // 抓取的 OG title
    description?: string;
    favicon_url?: string;
    image_file_id?: string;       // 抓取的 OG image（落地到 file 表）
  };
}

// database_view（引用 + 视图）
interface DatabaseViewContent {
  schema_version: 1;
  type: 'database_view';
  data: {
    database_id: string;          // 引用源数据库
    view_id: string;              // 引用 database_view 表的某个 view
    is_linked: boolean;           // true = linked database
  };
}
```

#### 8.4.3 TipTap ↔ 中间 Schema 转换

- **编辑期**：TipTap 内部用自己的 ProseMirror schema，正常工作
- **保存期**：TipTap `editor.getJSON()` → 转换函数 → 中间 schema → SQLite `block.content`
- **加载期**：SQLite `block.content` → 中间 schema → 转换函数 → TipTap `editor.commands.setContent()`
- **测试**：往返测试（load → save → load 必须等价）

#### 8.4.4 版本迁移机制

当 schema 升级（如 v1 → v2）：
1. 新代码识别 `schema_version < 2` 的记录
2. 应用迁移函数（同步函数，输入旧 JSON 输出新 JSON）
3. 写回 + 更新 `schema_version`
4. 后台 job 批量迁移（避免启动时阻塞）
5. 全部迁移完成后，旧代码仍可读（向后兼容窗口 ≥ 1 个 major version）

#### 8.4.5 实施约束

- 转换层代码集中在 `packages/editor/src/schema-converter.ts`，约 500 行
- 单元测试覆盖率 ≥ 95%
- 必须包含「TipTap JSON → schema → TipTap JSON」往返测试 50+ 用例
- 所有 20 种 block 类型在 §5.1.1 中明确，schema 必须覆盖全部

---

## 9. 前后端接口（Tauri Commands）

> 命名规范：`<domain>_<action>`（snake_case），返回 `Result<T, Error>`。

### 9.1 Page commands

```ts
// 创建页（指定 parent 或顶层）
createPage(args: {
  parentId?: string;
  parentType: 'workspace' | 'page' | 'database';
  title?: string;
  templateId?: string;  // 若为 database 行且选模板
}): Promise<Page>;

// 获取页（含完整 block 树）
getPage(pageId: string): Promise<PageWithBlocks>;

// 更新页元数据
updatePageMeta(pageId: string, patch: Partial<PageMeta>): Promise<void>;

// 移动页（改 parent）
movePage(pageId: string, newParentId: string | null, newParentType: string): Promise<void>;

// 移到回收站
trashPage(pageId: string): Promise<void>;
restorePage(pageId: string): Promise<void>;
deletePagePermanently(pageId: string): Promise<void>;

// 列出子页（用于 sidebar）
listChildPages(parentId: string | null): Promise<PageSummary[]>;

// 列出收藏 / 最近
listFavorites(): Promise<PageSummary[]>;
listRecents(limit: number): Promise<PageSummary[]>;
toggleFavorite(pageId: string, favorited: boolean): Promise<void>;
```

### 9.2 Block commands

```ts
// 在 page 中插入块
insertBlock(args: {
  pageId: string;
  parentBlockId?: string;  // 默认 page root
  afterBlockId?: string;   // 插入位置（NULL = 父块第一个）
  type: BlockType;
  content?: BlockContent;
  props?: BlockProps;
}): Promise<Block>;

// 更新块（content 或 props）
updateBlock(blockId: string, patch: BlockPatch): Promise<void>;

// 删除块（含子树）
deleteBlock(blockId: string): Promise<void>;

// 移动块（拖拽重排）
moveBlock(args: {
  blockId: string;
  newParentBlockId?: string;
  newPageId?: string;       // 跨页移动
  afterBlockId?: string;
}): Promise<void>;

// 转换块类型
transformBlock(blockId: string, newType: BlockType): Promise<void>;

// 复制块（含子树，生成新 id）
duplicateBlock(blockId: string): Promise<Block>;
```

### 9.3 Database commands

```ts
// 创建数据库（创建 page + properties + 默认 view）
createDatabase(args: {
  parentId?: string;
  name: string;
  properties: PropertyDef[];
}): Promise<Page>;  // database 也是 page

// 加属性
addProperty(databaseId: string, def: PropertyDef): Promise<database_property>;
updateProperty(propertyId: string, patch: PropertyPatch): Promise<void>;
deleteProperty(propertyId: string): Promise<void>;
reorderProperties(databaseId: string, orderedIds: string[]): Promise<void>;

// 加行
addDatabaseRow(databaseId: string, templateId?: string): Promise<Page>;
updateRowProperty(pageId: string, propertyId: string, value: PropertyValue): Promise<void>;

// 查询（应用 view 的 filter/sort/group）
queryDatabase(args: {
  databaseId: string;
  viewId?: string;          // 用 view 配置；否则用默认
  filterOverride?: FilterTree;
  sortOverride?: Sort[];
}): Promise<Row[]>;

// View 操作
createView(databaseId: string, view: DatabaseViewInput): Promise<database_view>;
updateView(viewId: string, patch: ViewPatch): Promise<void>;
deleteView(viewId: string): Promise<void>;
listViews(databaseId: string): Promise<database_view[]>;

// Template 操作
createTemplate(databaseId: string, template: TemplateInput): Promise<database_template>;
// ...
```

### 9.4 Search commands

```ts
search(args: {
  query: string;
  limit?: number;            // 默认 50
  scopes?: ('pages' | 'content' | 'database_rows')[];
}): Promise<SearchResult[]>;

searchInPage(pageId: string, query: string): Promise<BlockMatch[]>;

rebuildIndex(): Promise<void>;  // 后台执行，进度通过事件通知
```

### 9.5 File commands

```ts
// 上传文件（去重 + 落地到 media/）
uploadFile(args: { bytes: number[]; ext: string; mimeType: string }): Promise<file>;

// 获取文件 URL（Tauri 会转换为 asset://协议）
getFileUrl(fileId: string): Promise<string>;

// 删除未引用文件（GC，由后台定期执行）
garbageCollectFiles(): Promise<{ removed: number }>;
```

### 9.6 Import / Export

```ts
importFromNotionZip(zipPath: string, onProgress?: ProgressCb): Promise<ImportResult>;
importMarkdown(mdPath: string, parentId?: string): Promise<Page>;
importHtml(htmlPath: string, parentId?: string): Promise<Page>;
importCsv(csvPath: string, parentId: string): Promise<Page>;  // 创建 database

exportPage(pageId: string, format: 'markdown' | 'html'): Promise<string>;  // 返回导出目录
exportWorkspace(format: 'markdown' | 'html'): Promise<string>;
exportDatabase(databaseId: string): Promise<string>;  // CSV
createBackup(): Promise<string>;  // 返回 .db.bak 路径
restoreBackup(backupPath: string): Promise<void>;
```

### 9.7 Events（后端 → 前端）

```ts
// 索引重建进度
on('index:progress', payload: { processed: number; total: number });
on('index:done', payload: { durationMs: number });

// 文件 GC 完成
on('file:gc-done', payload: { removed: number });

// 备份完成
on('backup:done', payload: { path: string; sizeBytes: number });

// 数据库变更通知（用于全局 UI 同步，如 sidebar 计数）
on('page:created', payload: { pageId: string; parentId: string });
on('page:trashed', payload: { pageId: string });
on('page:restored', payload: { pageId: string });
```

---

## 10. 非功能需求

### 10.1 性能

| 场景 | 目标 | 测量方式 |
|------|------|---------|
| 冷启动到可输入 | < 1.5s | Playwright 自动化，从启动到输入光标可见 |
| 打开 10KB 页面 | < 300ms | 从 click 到所有块渲染完成 |
| Slash 命令面板渲染 | < 80ms | 从按键到面板 visible |
| 全局搜索（10k 页） | < 500ms P95 | 从 Enter 到结果展示 |
| 单块编辑延迟 | < 16ms | 从按键到字符显示（60fps） |
| 拖拽 100 块重排 | < 100ms | 从 drop 到所有块就位 |
| 数据库 1000 行渲染 | < 500ms | 从 query 到表格渲染完 |
| 数据库 10k 行筛选 | < 1s | 从应用 filter 到结果出 |

### 10.2 可靠性

- 数据写入失败率：< 0.01%（含 WAL fsync）
- 崩溃后 0 数据丢失（每次关键操作 fsync）
- 自动备份每日 1 次，保留 7 天
- 启动时 integrity_check，失败提示恢复

### 10.3 安全

- 数据本地存储，无任何网络上报（除用户主动检查更新）
- 自动更新走 GitHub Releases，签名校验
- 不收集任何遥测（MVP 完全离线）

### 10.4 可访问性（a11y）

- 所有交互元素键盘可达（Tab 顺序合理）
- 焦点环可见（02 文档定义）
- ARIA 标签完整（编辑器、modal、popover）
- 支持 `prefers-reduced-motion`（关闭动画）
- 支持 `prefers-color-scheme`（自动 dark mode）
- 颜色对比度 WCAG AA（4.5:1 文字、3:1 大字号）

### 10.5 国际化

- MVP 仅中文 + 英文
- UI 字符串走 i18next，预留扩展
- CJK 字体回退完整（02 文档第 2.1 节）
- 日期/数字格式依系统 locale

### 10.6 包大小与启动（决议 Q6-A：含 CJK 字体）

> **决议**：安装包内置 Inter（拉丁）+ JetBrains Mono（代码）+ Noto Sans CJK（中日韩，subset）。
> 字体许可：Inter（OFL）、JetBrains Mono（OFL）、Noto Sans CJK（OFL）—— 均可商业分发。

**字体体积预估**：
- Inter Variable（含 latin/latin-ext/cyrillic/greek）：~800KB（subset 到实际字符可降到 ~200KB）
- JetBrains Mono Variable：~400KB（subset ~150KB）
- Noto Sans CJK（subset 到常用 8000 汉字）：~12MB（精简前 ~30MB）
- 字体总占用：约 12-15MB

**包大小目标（已含字体）**：

| 平台 | 包大小上限 | 启动时间上限 | 字体策略 |
|------|----------|------------|---------|
| macOS .dmg | 50MB | 1.5s | 内置（含 Noto CJK subset，macOS 系统有 PingFang 可选回退） |
| Windows .exe | 55MB | 2s | 内置（含 Noto CJK subset，Windows 系统有 YaHei 可选回退） |
| Linux .AppImage | 60MB | 1.5s | 内置（Linux 系统 CJK 字体不可靠，必须内置） |

**优化策略**：
1. 字体子集化：构建期用 `fonttools pyftsubset` 保留常用 8000 汉字 + 全 ASCII
2. Variable Font：单文件覆盖所有字重（Inter/JetBrains Mono）
3. WOFF2 格式：比 TTF 小 ~30%
4. 用户可在 Settings 切换「使用系统字体」卸载内置（节省磁盘但破坏一致性）

**回退**：若 Q6 在内测中被反馈包过大，可改为「下载时可选不含 CJK 字体版本」（双安装包），但 MVP 默认含字体。

### 10.7 浏览器/webview 兼容

- 系统 webview：macOS WKWebView (Safari 16+)、Windows WebView2 (Chromium 110+)、Linux WebKitGTK 2.42+
- 不支持 IE、不支持 Firefox（系统 webview 不基于它）

---

## 11. 验收标准

### 11.1 Block 系统

**AC-B01** Slash 命令
- [ ] 空行按 `/` 弹出面板，280×320px，含 4 tab
- [ ] 输入 `head` 实时筛选出 H1/H2/H3
- [ ] ↑↓ + Enter 键盘完全可用，hover #dcecfa
- [ ] Recent 显示最近 5 个
- [ ] Escape 关闭，点击外部关闭
- [ ] 选中后块类型转换 + `/query` 文本清除

**AC-B02** 拖拽重排
- [ ] drag handle ⋮⋮ hover 100ms 渐入
- [ ] 选中块时 handle 始终显示
- [ ] drop 实线 = 兄弟、虚线 = 嵌套
- [ ] list item 距左 28px 触发嵌套
- [ ] 跨页拖拽可用（v1 验证）
- [ ] 拖到块侧边出现列分割蓝线

**AC-B03** 全部快捷键可工作（02 文档第 5.5 节 20+ 项）

**AC-B04** 粘贴智能
- [ ] 粘贴 URL 自动转 bookmark，fetch OG metadata
- [ ] 粘贴图片二进制自动上传 + 转 image block
- [ ] 粘贴 YouTube URL 转 embed
- [ ] 粘贴 Markdown 文本按 02 文档第 7.5 节转换

### 11.2 Page 系统

**AC-P01** Sidebar 页面树
- [ ] 显示完整嵌套树
- [ ] chevron 展开收起 + 持久化
- [ ] 拖拽重排
- [ ] 右键菜单完整（6 项）
- [ ] 当前页 #e6f0fa 背景 + 粗体
- [ ] hover #f7f6f3

**AC-P02** Trash & History
- [ ] 删除页进 Trash（保留 parent_id）
- [ ] Trash 中可 Restore（恢复原位）
- [ ] Restore 父页已删时恢复到 root
- [ ] Trash 30 天后自动物理删除
- [ ] History 快照每 5s debounce 创建
- [ ] 可查看快照列表
- [ ] 可恢复快照（覆盖当前）

### 11.3 Table 数据库

**AC-D01** 创建数据库 < 1s（slash 到 Table 视图打开）

**AC-D02** 10 种属性全部可创建、编辑、删除、重排

**AC-D03** Filter 系统
- [ ] AND/OR 嵌套 2 层
- [ ] 操作符依属性类型变化
- [ ] 多 filter 同时生效
- [ ] filter chip 可单独删除
- [ ] filter 配置存 view

**AC-D04** Sort 多级 + asc/desc

**AC-D05** Group 按 select/status
- [ ] 组头显示属性值 + 计数
- [ ] 4px 左色条
- [ ] 组可折叠
- [ ] 拖行跨组更新属性

**AC-D06** Database Templates
- [ ] 可创建多模板
- [ ] 设默认模板
- [ ] 新建行选模板或空白
- [ ] 模板含 property 默认值 + content

**AC-D07** Linked Database
- [ ] 可在任意页插入 linked db
- [ ] 数据与源 db 双向同步
- [ ] view 配置独立
- [ ] 表头显示 🔗 徽章

**AC-D08** 行 = 页面
- [ ] 点击行打开详情页
- [ ] 详情页有 property 面板 + content 区
- [ ] 可嵌套子数据库

### 11.4 搜索

**AC-S01** 全局搜索 Cmd+K
- [ ] 480px modal，max-height 600px
- [ ] fuzzy match 标题 + 正文
- [ ] 10k 页 < 500ms
- [ ] 结果分组（Recent/Pages/Content/Database rows）
- [ ] 键盘 ↑↓ + Enter
- [ ] Cmd+Enter 新窗口（v1）

**AC-S02** 索引
- [ ] 写入 debounce 500ms 增量更新
- [ ] 首次启动全量构建 < 30s（10k 页）
- [ ] 进度通过事件通知

### 11.5 导入导出

**AC-I01** Notion Markdown zip 导入
- [ ] 解析目录树为 page tree
- [ ] .md 转 block 树
- [ ] frontmatter 转 properties
- [ ] 图片复制到 media/
- [ ] 不支持的 property 警告但不中断

**AC-I02** 导出
- [ ] 单页 Markdown
- [ ] 单页 HTML（含 CSS）
- [ ] 全 workspace Markdown（含 sitemap.md）
- [ ] database CSV
- [ ] Folio Backup（.db.bak）

### 11.6 性能 / 稳定性

**AC-N01** 冷启动 < 1.5s
**AC-N02** 10KB 页打开 < 300ms
**AC-N03** Slash < 80ms
**AC-N04** 搜索 < 500ms（10k 页）
**AC-N05** 持续编辑 1 小时无崩溃
**AC-N06** 强制 kill 后重启 0 数据丢失

---

## 12. 风险与缓解

### 12.1 技术风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| TipTap + 拖拽 + 数据库视图集成复杂 | 高 | 高 | 第 1 周做 spike：TipTap + dnd-kit + table view 最小可运行原型 |
| SQLite 大数据集性能（10k+ 页） | 中 | 高 | 用 FTS5 + 合理索引；预测试 100k 页 benchmark |
| Tauri 2 系统 webview 差异 | 中 | 中 | 接受取舍；Playwright 跨 webview 测试；不依赖 Chromium-only API |
| WAL 模式 + fsync 性能影响 | 中 | 中 | benchmark 测试；必要时降级 `synchronous=NORMAL` + 应用层 fsync |
| ProseMirror schema 升级破坏存量数据 | 中 | 高 | block content JSON 设计前向兼容；schema_version 字段 + 迁移脚本 |

### 12.2 产品风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| MVP 范围过大无法 3-4 月完成 | 高 | 高 | 严格按 §5 优先级；剪枝到「能用的本地 Notion」 |
| 用户期待同步但 MVP 没有 | 高 | 中 | 安装时明确提示「单机版本」；v1 路线图可见 |
| 与 Notion 导入兼容性不完美 | 中 | 中 | 明确文档化「已知不支持项」；社区反馈优先排期 |
| Notion 用户因 UI 不一致放弃 | 中 | 高 | 严格按 02 文档实现；每周对比 Notion 截图 QA |

### 12.3 时间风险

- 若 4 个月无法完成 → 砍 §5.5 导入（保留导出）、砍 §5.3.6 Group、砍 Page History
- 若仍超期 → 把 Table 数据库简化（不交 filter 嵌套，只交 AND）

---

## 13. 里程碑

### 13.1 MVP 内部里程碑（16 周）

| 周次 | 里程碑 | 验收 |
|------|--------|------|
| W1-2 | M1：脚手架 + 设计系统 | Tauri 2 + React + TipTap 跑起来；CSS 变量全量；登录空白页可显示 |
| W3-5 | M2：Block 编辑器 | §5.1 全部 AC 通过；可创建/编辑/拖拽 20 种 block |
| W6-7 | M3：Page 系统 + Sidebar | §5.2 全部 AC 通过；页面树 + Trash + History |
| W8-11 | M4：Table 数据库 | §5.3 全部 AC 通过；10 属性 + filter/sort/group + Templates + Linked DB |
| W12 | M5：搜索 | §5.4 全部 AC 通过；FTS5 索引 + Cmd+K |
| W13 | M6：导入导出 | §5.5 全部 AC 通过 |
| W14 | M7：性能优化 + a11y + i18n | §10 全部目标达成 |
| W15 | M8：内测 + bug 修复 | 5 名内测用户使用 1 周；P0 bug 全修 |
| W16 | M9：发布 v0.1.0 | 三平台安装包；README + Demo 视频 |

### 13.2 团队配置（建议）

| 角色 | 人数 | 主要负责 |
|------|------|---------|
| 全栈工程师（Tauri + React） | 2 | M1-M5 主力 |
| Rust 工程师 | 1 | SQLite schema、commands、文件 I/O |
| 前端工程师（TipTap + UI） | 1 | 编辑器深度、设计系统实现 |
| 设计师（兼职） | 0.5 | 视觉走查、icon、营销素材 |
| PM（兼） | 0.2 | 验收、用户反馈 |

**总计**：4-5 人 × 16 周 ≈ 64-80 人周。

### 13.3 单人开发 fallback

若只有 1-2 人，砍范围到「能用」版本：
- 不做：Page History、Database Templates、Linked DB、Group、Notion 导入
- 保留：Block 编辑（10 种核心）+ Table 数据库（5 属性 + filter 单层 + sort）+ Markdown 导出
- 周期延长到 24 周

---

## 14. 出 MVP 范围（路线图指针）

> 详细功能清单见 [01-notion-features.md §13](../research/01-notion-features.md)

### v1（MVP + 6 个月）

1. **多设备同步**：Yjs CRDT + y-websocket + 单容器 sync server
2. **协作**：评论、@mention、presence cursors、Suggestions Mode
3. **多视图**：Board / Calendar / Timeline / Gallery / List
4. **Formula 2.0 + Relation**（不含 Rollup）
5. **移动端**：iOS / Android（Tauri 2 mobile）
6. **Snapshot Diff**：History 可视化对比
7. **E2EE 同步选项**

### v2（v1 + 12 个月）

1. **AI 集成**：可插拔 LLM provider（OpenAI/Claude/Ollama 本地）
   - Q&A / Autofill / Summarize / Translate / Draft
2. **新视图**：Form / Chart / Map / Dashboard
3. **Rollup + 自动字段**（created_time / last_edited_by 等）
4. **Automations + Webhooks + REST API + OAuth**
5. **Plugin 系统**（参考 Obsidian/VSCode 扩展）
6. **Notion Sites**：发布到 web、自定义域名
7. **Custom Agents + External Agents**

### 不在路线图

- Notion Mail / Calendar（独立 app 范畴）
- 企业 SSO / Audit Log（非本地优先目标用户）
- 100+ connector 的完整 marketplace（重运营）

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| Block | 内容最小单元，可拖拽/转换/嵌套 |
| Page | 包含 block 树的容器；database 也是 page |
| Database | 一种特殊 page，有 schema（properties）+ 多个 view |
| Database Row | database 的子 page，每行 = 一页 |
| View | 数据库的呈现配置（filter/sort/group/layout），可命名保存 |
| Linked Database | 在另一页引用源 database，配置独立的 view |
| Template | 数据库行的预填结构（property 默认值 + content 默认 block） |
| Workspace | 顶层容器（MVP 单 workspace） |
| Snapshot | 页面历史快照（JSON） |

## 附录 B：参考文档

- [Notion 全功能盘点](../research/01-notion-features.md)
- [Notion 设计规范](../research/02-notion-design-spec.md)（设计系统 token 来源）
- [竞品调研](../research/03-competitive-landscape.md)（技术栈选型依据）
- [Folio 调研总览](../research/00-overview.md)

## 附录 C：决议记录（已固化）

> 决议日期：2026-07-02
> 决议方式：按 PRD v1.0「当前倾向」全部采纳
> 状态：所有决议已反映在 PRD 主体章节，可进入工程实施

| # | 问题 | 决议 | 影响章节 | 依据 |
|---|------|------|---------|------|
| **Q1** | Block content schema | **B：自定义中间层 schema**（带 `schema_version` + 双向转换层） | §8.4（新增）、§8.1 block.content 字段 | 长期前向兼容；可平滑切换编辑器 |
| **Q2** | MVP sidebar teamspace | **A：单 teamspace**（多 teamspace 推迟 v1） | §6.1、§6.3 | MVP 简化，避免 sidebar 复杂度 |
| **Q3** | Page History diff | **A：仅快照**（diff 推迟 v1） | §5.2.4 | MVP 复杂度可控 |
| **Q4** | 全局搜索 AI 重排 | **A：仅 FTS5**（AI 重排推迟 v2） | §5.4 | AI 集成本就是 v2 范围 |
| **Q5** | 数据库行详情页 | **B：加 property 面板**（顶部 80px sticky，可折叠） | §5.3.9 | property 是行页面的核心 UI |
| **Q6** | 安装包内置字体 | **A：含 CJK 字体**（Inter + JetBrains Mono + Noto Sans CJK subset） | §10.6、§6.3 About | 一致性优先；Linux 系统 CJK 不可靠 |
| **Q7** | 自定义 workspace 存储位置 | **B：可选**（默认 OS 标准路径 + 用户可切换） | §5.6.1、§6.3 General | 数据所有权是 Folio 核心承诺 |

### C.1 决议带来的范围调整

- **包大小上限调整**：30MB → 50-60MB（Q6 含字体的直接代价，§10.6 已更新）
- **数据模型新增 §8.4**：自定义 schema 设计与迁移机制（Q1 的实现细节）
- **设置面板 General tab 扩展**：存储位置 + 字体重载（Q7 关联）
- **数据库行详情页 UI 调整**：增加 80px property 面板（Q5 关联，影响 §5.3.9 + 设计系统）

### C.2 仍待决议（v1 之前需明确）

| # | 问题 | 何时决议 |
|---|------|---------|
| Q8 | TipTap 主版本绑定策略（锁版本 vs 跟随最新） | M1 脚手架期 |
| Q9 | 自动更新通道（stable / beta / nightly） | M9 发布前 |
| Q10 | 崩溃日志收集策略（完全不收集 vs 用户主动上报） | M8 内测前 |
| Q11 | macOS 公证 / Windows 代码签名预算 | M9 发布前 |

### C.3 M9 决议（2026-07 补）

- **License**：**AGPL-3.0-or-later**。开源宽松（个人/开源自由使用）+ 商用严格（分发修改版或提供网络服务须开源衍生品，或另签商业许可）。注：AGPL §13 网络条款只对网络服务生效，纯本地使用无约束。
- **Q9 自动更新通道**：**stable / beta / nightly 三通道**。CI 用 **GitHub Actions**（代码主仓库在 GitLab，镜像到 GitHub 出包），更新 JSON 托管在 **GitHub Releases** 的 rolling tag（`stable-latest` / `beta-latest` / `nightly-latest`）。更新包用 **Tauri minisign 自生成密钥**签名（区别于 OS 级代码签名）。检查频率：仅用户主动触发，符合 §10.3「除用户主动检查更新」白名单。
- **Q11 OS 代码签名 / macOS 公证**：**仍待决议**。需 Apple Developer 账号（$99/yr）+ Windows 代码签名证书（~$200/yr）。M9 先发**未签名 OS 包**（用户首次启动需手动信任 / 关闭 Gatekeeper / SmartScreen），正式签名延后到有预算时。

---

**文档结束** — PRD v1.0 已决议固化，可进入工程实施（脚手架搭建）。
