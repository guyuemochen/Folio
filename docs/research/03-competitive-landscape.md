# 本地优先笔记软件竞品全景（2026）

> 调研日期：2026-07-02
> 来源：各项目官网 / GitHub / Hacker News / r/selfhosted / r/obsidian / 2024-2026 技术博客
> 用途：为 Folio 提供差异化定位、技术栈选型、避免已知坑

---

## 执行摘要

本地优先知识管理赛道自 2024 年起已显著成熟，市场已围绕 **4 种主导范式** 收敛：

1. **块编辑器**（AppFlowy / AFFiNE / SiYuan）—— 最接近 Notion
2. **Markdown Vault**（Obsidian / Logseq）—— 面向开发者、强插件生态
3. **对象型系统**（Anytype / Capacities）—— 结构化、强类型
4. **传统层级**（Joplin / Trilium / Standard Notes）—— 更简单

**2026 关键变化**：CRDT 同步已成为标配，本地优先是用户预期，Notion 与开源替代品在功能上的差距收窄，但**可靠性与打磨度的差距反而扩大**。

---

## 1. 主要玩家分析

### 1.1 AppFlowy

**架构**：本地优先 + 可选云同步
- 桌面端 SQLite / Web 端 IndexedDB 本地存储
- AppFlowy Cloud（可自托管）用于多端同步与协作
- 默认 Offline-first

**技术栈**：
- 后端：Rust
- 前端：Flutter（跨平台原生）
- 编辑器：自研块编辑器（非 ProseMirror/Lexical）
- 存储：SQLite（桌面）、IndexedDB（Web）
- 同步：自研 WebSocket 协议（非 CRDT）
- 桌面壳：Flutter（原生，非 Electron）

**Notion 功能覆盖**：
- ✓ 块编辑、Inline 数据库（grid/board/calendar）、富文本、看板、日历、评论、AppFlowy Cloud RTC
- ✗ Database relations（部分）、Rollup、高级公式、Synced Block、Web Clipper、API 集成

**License**：AGPL-3.0

**已知弱点**（GitHub issues）：
- 大数据集排序 bug [Issue #8575]
- 大数据库性能问题（卡顿、冻结）[Issue #8634]
- 嵌套 grid 数据丢失 [Issue #8651]
- 自托管复杂：5+ Docker 服务（app/cloud/GoTrue/PostgreSQL/Redis/MinIO）
- 移动端打磨不如桌面

---

### 1.2 Obsidian

**架构**：纯本地 Markdown vault
- 磁盘上纯 `.md` 文件
- 无原生云同步（用户用 iCloud/Git/Syncthing 或社区插件）

**技术栈**：
- 后端：Node.js（Electron runtime）
- 前端：Electron + React
- 编辑器：CodeMirror 6（基于 Lezer parser）
- 存储：纯文件系统
- 桌面壳：Electron

**Notion 功能覆盖**：
- ✓ 富文本（Markdown）、wiki-links、tags/properties（frontmatter）、导出、模板（插件）
- ✗ 块编辑、数据库、看板（仅插件）、RTC（仅插件）

**License**：核心闭源 + 个人免费；插件可 MIT/AGPL 等

**已知弱点**：
- 无原生数据库（依赖插件）
- 同步是 DIY、易坏
- 桌面优先，移动端次要
- 无开箱 RTC
- 大 vault（数千文件）性能退化

---

### 1.3 Logseq

**架构**：本地优先 Markdown/Org 文件
- 以 daily notes 为核心
- 官方 Logseq Sync（付费 $5/mo，多年仍 beta）
- Git-based 同步（社区插件）

**技术栈**：
- 后端：Clojure（数据模型）+ Rust（新同步引擎 rsapi）
- 前端：Electron（桌面）、React Native（移动）
- 编辑器：自研 outliner
- 存储：文件系统 + SQLite 索引
- 同步：rsapi（Rust）+ Git/Syncthing 替代

**Notion 功能覆盖**：
- ✓ 块编辑（outliner）、Linked references、Backlinks、Graph view、Properties、Templates、PDF 标注
- ✗ 数据库（DB 版本 beta 不稳定）、看板（插件）、RTC（DB 版本 alpha）

**License**：AGPL-3.0（社区版）+ 闭源同步

**已知弱点**（用户主要抱怨）：
- **同步严重不可靠**：macOS 启用同步崩溃 [Issue #12539]
- **数据丢失**：同步静默覆盖为旧数据 [Issue #12775]
- **性能**：2,000+ 页图谱需 4-10 分钟打开，基础操作 10+ 秒
- DB 版本等待多年未发布稳定版
- 移动端体验是次要

---

### 1.4 Anytype

**架构**：本地优先、P2P、对象型
- 设备本地优先存储
- 通过 any-sync 协议（私有 IPFS 网络）P2P 同步
- 默认 E2EE（零知识加密）
- 可选自托管备份节点

**技术栈**：
- 后端：Go（any-sync 协议）+ Rust（anytype-heart）
- 前端：Electron（桌面）、Swift（iOS）、Dart（Android）
- 编辑器：自研对象型编辑器
- 存储：本地对象存储 + IPFS
- 同步：any-sync（CRDT-based DAGs）
- 桌面壳：Electron（计划迁移）

**Notion 功能覆盖**：
- ✓ 对象型（强类型）、对象间关系、Pages/Tasks/Wikis/Databases、看板/日历、E2EE
- ✗ 块编辑（不同范式）、富文本（受限）、RTC（P2P 困难）

**License**：Any Source Available License 1.0（非 OSI 开源）

**已知弱点**：
- 应用体积大（300MB 压缩 / 600MB 解压，Electron bloat）[Issue #537]
- 学习曲线陡（对象型范式陌生）
- P2P 模型使 RTC 受限
- 社区与生态较小
- 数据格式可移植性较差

---

### 1.5 AFFiNE

**架构**：本地优先、可自托管、CRDT-based
- Blocks + 白板画布统一
- OctoBase 数据引擎（CRDT）
- 本地优先 + 可选云同步

**技术栈**：
- 后端：TypeScript/Node.js + Rust（OctoBase CRDT）
- 前端：React + BlockSuite
- 编辑器：BlockSuite（基于 CRDT）
- 存储：IndexedDB（本地）+ PostgreSQL（服务器）
- 同步：OctoBase CRDT
- 桌面壳：Electron

**Notion 功能覆盖**：
- ✓ 块编辑、白板/画布模式（差异化）、数据库（基础看板）、RTC（CRDT）、Edgeless 模式（块自由摆放在画布）
- ✗ 高级数据库视图、Relations、Rollups

**License**：MIT（非常宽松，可商用）

**已知弱点**：
- Pre-1.0，每周破坏性变更
- 自托管版本实验性
- 数据库功能基础（仅看板）
- 移动端不如桌面成熟

---

### 1.6 SiYuan / 思源笔记

**架构**：本地优先、块型、Markdown 兼容
- 块存为 JSON，导出为标准 Markdown
- 本地 SQLite + 可选云同步
- 可选 E2EE 同步

**技术栈**：
- 后端：Go
- 前端：TypeScript + 原生 JS
- 编辑器：自研块编辑器（WYSIWYG Markdown）
- 存储：SQLite（本地）
- 同步：S3 风格对象存储 + WebSocket
- 桌面壳：Electron + 原生移动 app

**Notion 功能覆盖**：
- ✓ 块级引用与双向链接、自定义属性、SQL 查询嵌入、Markdown WYSIWYG、PDF 标注
- ✗ RTC（非重点）、Notion 风格数据库

**License**：AGPL-3.0

**已知弱点**：
- 中文为主（英文支持次要）
- 无 RTC
- 数据库范式不同于 Notion
- 非中文社区较小

---

### 1.7 Joplin

**架构**：Markdown + SQLite、C/S 同步
- 笔记存为 Markdown 文件
- SQLite 存元数据与同步状态
- 可选 E2EE

**技术栈**：Node.js + SQLite；Electron（桌面）+ React Native（移动）；Joplin Server / WebDAV / Nextcloud / Dropbox / OneDrive 同步

**覆盖**：Markdown 笔记、E2EE、Web Clipper、跨平台
**不覆盖**：块编辑、数据库、看板（非 Notion 替代品，更接近 Evernote）

**License**：MIT

---

### 1.8 Trilium Notes

**架构**：层级型、SQLite-based、自托管
- 所有笔记在 SQLite
- 树形层级（无限嵌套）
- Note 克隆（同一笔记多处出现）

**技术栈**：Node.js + SQLite；Electron + Web UI

**覆盖**：层级组织、富链接、可脚本化、属性与自动化、知识图谱
**不覆盖**：块编辑、数据库、看板

**License**：AGPL-3.0
**弱点**：无移动 app（仅 Web PWA）、非块编辑、比一般笔记 app 复杂

---

### 1.9 其它

- **Capacities**：对象型、本地优先，**闭源、不可自托管**，技术栈未披露
- **RemNote**：outliner + 间隔重复，**非通用 Notion 替代品**
- **Standard Notes**：加密、简单、可自托管，**太简单**（无块编辑/数据库）
- **Notable / Boostnote / Zim**：老旧，已归档或非 Notion 范式

---

## 2. 技术栈调研

### 2.1 编辑器框架

| 工具 | 编辑器框架 | 备注 |
|------|-----------|------|
| AppFlowy | 自研（Flutter） | 从零构建 |
| AFFiNE | BlockSuite | 基于 CRDT |
| Obsidian | CodeMirror 6 | Lezer parser |
| Logseq | 自研（Clojure） | outliner 专用 |
| Anytype | 自研（对象型） | 完全不同范式 |
| SiYuan | 自研（TypeScript） | 块型 WYSIWYG Markdown |

**2026 编辑器格局**：
- **TipTap**：ProseMirror 封装，生态最大（100+ 扩展），MIT 核心 + 付费云
- **Lexical**：Meta 出品，React 优先，~22KB bundle，性能最佳
- **ProseMirror**：2016 起验证、学习曲线陡（NYT/Atlassian 在用）
- **Slate**：较老、React-only，Plate 基于 Slate

**Notion 克隆的主流选择**：ProseMirror / TipTap

### 2.2 存储

| 工具 | 存储 | 备注 |
|------|------|------|
| AppFlowy | SQLite（桌面）/ IndexedDB（Web） | 本地优先 |
| AFFiNE | IndexedDB（本地）/ PostgreSQL（服务器） | OctoBase CRDT |
| Obsidian | 纯文件系统（.md） | vault-based，最可移植 |
| Logseq | 文件系统 + SQLite 索引 | Markdown/Org |
| Anytype | 本地对象存储 + IPFS | P2P、DAG |
| SiYuan | SQLite | 本地块 |

**模式**：
- **纯文件**（Obsidian/Logseq）：最可移植、易 Git 同步，难做高级功能
- **SQLite**（AppFlowy/SiYuan/Joplin/Trilium）：易做复杂功能、可移植性弱
- **嵌入式 CRDT**（Anytype/AFFiNE）：同步最佳、实现复杂

### 2.3 同步机制

| 工具 | 同步方案 | 备注 |
|------|---------|------|
| AppFlowy | 自研 WebSocket | 非 CRDT、服务端合并 |
| AFFiNE | OctoBase CRDT | 无冲突、本地优先 |
| Obsidian | 依赖插件 | Git / GitHub API / iCloud / Syncthing |
| Logseq | rsapi（Rust，近似 CRDT） | Beta、已知数据丢失 bug |
| Anytype | any-sync（CRDT DAGs） | P2P、E2EE、复杂 |
| SiYuan | S3 风格 | 非 CRDT |
| Joplin | C/S | Joplin Server / WebDAV |
| Trilium | 内建 sync 服务器 | SQLite 同步 |

**CRDT 库 2026**：
- **Yjs**：协作编辑器事实标准、生态最大、有 TipTap/BlockNote/Lexical/ProseMirror 适配器
- **Automerge 3**：列式存储、文档体积 ~10x 小于 Yjs、JSON 形态
- **Loro 1.0**：Rust 核心、可移动树、富文本、快
- **Liveblocks**：托管 Yjs 平台（SaaS）

### 2.4 桌面壳

| 工具 | 壳 | Bundle 大小 |
|------|----|------------|
| AppFlowy | Flutter（原生） | ~51MB |
| AFFiNE | Electron | ~167MB |
| Obsidian | Electron | ~150-200MB |
| Logseq | Electron | ~150-200MB |
| Anytype | Electron | **~300MB（!）** |
| SiYuan | Electron | ~100MB |

**Tauri 2 vs Electron（2026）**：
- **Tauri 2**：5-40MB bundle、30-80MB 空闲内存、0.2-0.8s 启动、Rust 后端、系统 webview
- **Electron**：80-200MB bundle、200-400MB 空闲内存、1-3s 启动、Node.js 后端、捆绑 Chromium

**取舍**：
- Tauri 更轻、更快，但 Rust 学习曲线 + 系统 webview 不一致
- Electron 更重但一致、生态成熟、JS 团队更易上手

### 2.5 编程语言

AppFlowy（Rust + Dart）、AFFiNE（TS + Rust）、Obsidian（TS/Node）、Logseq（Clojure + Rust）、Anytype（Go + Rust + Swift + Dart）、SiYuan（Go + TS）、Joplin（Node.js/TS）、Trilium（TS/Node）

---

## 3. 现有克隆的常见 Gap

来自 GitHub issues、Reddit r/selfhosted / r/obsidian、Hacker News 讨论：

### 3.1 AppFlowy 抱怨
- 性能：大数据库卡顿、冻结 10-40 秒
- 数据库 bug：排序不正确、嵌套 grid 数据丢失
- 自托管复杂：5+ Docker 服务
- 数据库功能受限：无 relations、rollups、高级公式
- 插件生态小
- RTC 比 Notion 不成熟

### 3.2 Logseq 主要痛点
- **同步严重不可靠**：崩溃、数据丢失、静默覆盖为旧数据
- 性能：2,000+ 页图谱打开需 4-10 分钟
- DB 版本等待多年未发布稳定版
- 移动端是次要

### 3.3 AFFiNE 抱怨
- Pre-1.0，每周破坏性变更
- 自托管复杂（虽比 AppFlowy 简单）
- 数据库仅看板视图

### 3.4 Anytype 抱怨
- 应用体积大（300MB 压缩）
- 学习曲线陡（对象型范式）
- P2P 让 RTC 受限

### 3.5 跨工具共性抱怨（按重要性）

1. **数据库功能不完整**：无 relations、无 rollups/formulas、视图类型少（仅 grid/kanban）、排序筛选 bug
2. **同步不可靠**：Logseq 数据丢失、Obsidian DIY 同步、AppFlowy 同步延迟、CRDT 实践中 buggy
3. **RTC 弱**：多数无原生 RTC，AFFiNE 有但实验性
4. **UI/UX 不打磨**：大数据集性能差、移动端次要、Electron bloat、跨平台不一致
5. **AI 缺失或不成熟**：多数无原生 AI、需自托管 LLM、无 Notion AI 等价物
6. **插件生态小**：除 Obsidian 外，AppFlowy/AFFiNE/Logseq 都很小
7. **迁移困难**：Notion importer 部分功能（无 relations/formulas）、数据格式不兼容
8. **自托管复杂**：AppFlowy 5+ 容器、AFFiNE 3 容器
9. **移动端不对等**：桌面优先、移动端 webview 或次要
10. **文档与社区**：Obsidian 最好，其它较弱

---

## 4. 本地优先同步方案对比

### 4.1 Yjs CRDT
**优点**：生态成熟（TipTap/BlockNote/Lexical/ProseMirror 适配器）、生产验证、Web 友好、低延迟 RTC
**缺点**：仅 JS、大文档内存压力、CRDT 概念学习曲线
**Notion 块数据库适配**：极佳。文本块映射到 `Y.Text`；每页/数据库独立 Yjs doc

### 4.2 Automerge CRDT
**优点**：列式存储（文档 ~10x 小）、优秀 time-travel、Rust 核心、JSON 形态
**缺点**：单 op 开销高（~2x 慢于 Yjs）、生态小
**Notion 块数据库适配**：JSON 数据（databases/properties）契合度高

### 4.3 纯 SQLite + 自定义同步
**优点**：熟悉、灵活、无 CRDT 复杂度、可移植
**缺点**：冲突解决需自实现、RTC 难做、大数据集易复杂
**代表**：AppFlowy、SiYuan、Joplin、Trilium

### 4.4 纯 Markdown + Git/Syncthing/iCloud
**优点**：可移植、Git 历史、简单、透明
**缺点**：冲突解决（Git merge）、无 RTC、难做高级功能、大文件数慢
**代表**：Obsidian、Logseq、BoostNote-Neo

### 4.5 P2P / IPFS
**优点**：去中心化、隐私、Offline-first、无单点故障
**缺点**：复杂（NAT 穿透/peer 发现）、RTC 难、采用少
**代表**：Anytype（any-sync）、Paperus（Yjs + WebRTC）

### 4.6 S3 风格对象存储
**优点**：可扩展、可移植（MinIO/Wasabi/B2）、API 简单、可靠
**缺点**：无实时、需轮询、冲突解决需自实现
**代表**：SiYuan、AppFlowy（MinIO）、AFFiNE 生产部署

### 4.7 对比表

| 方案 | 实时 | 复杂度 | 隐私 | 离线 | 成熟度 |
|------|------|--------|------|------|--------|
| Yjs CRDT | ✅ 优秀 | 中 | 中 | ✅ 优秀 | 高 |
| Automerge | ✅ 良好 | 中 | 中 | ✅ 优秀 | 中 |
| SQLite + 自定义 | ⚠️ 难 | 中-高 | 高 | ✅ 良好 | 高 |
| Markdown + Git | ❌ 无 | 低 | 高 | ✅ 良好 | 极高 |
| P2P / IPFS | ⚠️ 可能 | 高 | ✅ 极佳 | ✅ 优秀 | 低-中 |
| S3 风格 | ❌ 无 | 中 | 中 | ⚠️ 部分 | 高 |

### 4.8 推荐

**对大多数用例选 Yjs CRDT**：生态成熟、生产验证、RTC 优秀。
**何时选 Automerge**：需要富 JSON 数据结构（不只文本）
**何时选 SQLite + 自定义**：有强理由避开 CRDT（实现更简）
**何时选 P2P**：隐私/去中心化是首要需求

---

## 5. 2026 现代栈推荐

### 5.1 桌面壳：Tauri 2（优于 Electron）

**理由**：
- Bundle 5-40MB（Electron 80-200MB）—— 10x 小
- 空闲内存 30-80MB（Electron 200-400MB）—— 5x 少
- 启动 0.2-0.8s（Electron 1-3s）
- 原生性能、强默认安全（capability-based）、原生 iOS/Android 支持

**取舍**：
- Rust 学习曲线
- 系统 webview 跨 OS 不一致（WebView2 vs WebKit vs Gecko）
- 生态比 Electron 小

**生态成熟度（2026）**：Tauri 2.0 GA 于 2024-10，已 18 个月成熟；活跃插件 `tauri-plugin-fs/shell/notification`；多个生产 app 在用。

**何时仍选 Electron**：
- 团队纯 JS、不愿学 Rust
- 需要跨平台完美渲染一致
- 需 Electron 成熟插件生态

### 5.2 编辑器框架：TipTap（优于 Lexical/ProseMirror）

**理由**：
- 最大生态（100+ 扩展）
- 继承 ProseMirror 验证过的引擎（NYT/Atlassian 在用）
- API 友好、学习曲线合理
- 框架无关（React/Vue/Svelte 都有绑定）
- Notion-ready：slash 命令、drag handle、块编辑扩展齐全
- Yjs 协作适配

**取舍**：
- MIT 核心 + 付费云（协作/AI $49-$999/mo）
- Bundle ~45KB（Lexical 22KB）
- 深度定制仍需理解 ProseMirror

**何时选 Lexical**：性能关键（移动/大文档）、React 优先、bundle 重要

### 5.3 同步层：Yjs CRDT（+ y-indexeddb 持久化）

**理由**：
- 2026 协作编辑器事实标准
- 生产验证、文档齐全
- TipTap/BlockNote/Lexical/ProseMirror 适配器
- 低延迟 RTC 优化
- `y-indexeddb` 本地持久化

**架构建议**：
- 每页/数据库 = 独立 Yjs doc
- `y-indexeddb` 本地持久化
- `y-websocket` 服务端协作
- 自托管：`y-websocket` 服务器 + WebSocket relay

**何时选 Automerge**：需要富 JSON 数据结构、time-travel 关键、Rust 核心性能

### 5.4 数据库：SQLite + cr-sqlite CRDT 层

**理由**：
- 嵌入式、本地模式无需外部 DB
- cr-sqlite 为 SQLite 加 CRDT 能力
- 单文件数据库、易备份迁移
- PKM 负载下足够快
- 2026 cr-sqlite 生产就绪

**架构**：
- `cr-sqlite` 表（pages、blocks、database 记录）
- 普通 SQLite 表（settings、user prefs）
- 通过 cr-sqlite merge 协议或自建 sync server

**替代**：ElectricSQL / PowerSync（双向 Postgres-SQLite 同步，适合团队部署）

### 5.5 文件存储（嵌入式媒体）：本地 FS + S3 兼容

**理由**：本地优先、可选云（MinIO/B2/Wasabi）、可移植、可扩展、API 简单

**架构**：
- 本地：`~/.local/share/Folio/media/`
- 云：S3 兼容 bucket（自托管 MinIO 或商业 provider）
- 后台同步上传/下载 + 冲突解决

### 5.6 可选 Sync Server 架构

**Option A：WebSocket Relay（简单）**
```
Folio clients ↔ y-websocket server ↔ y-indexeddb（服务端持久化）
```
- 单 WebSocket 服务器 relay
- 单 Docker 容器、最小基础设施
- 适合小团队（10-50 人）
- 不处理鉴权（需前置反向代理）

**Option B：完整 Sync Server（生产）**
```
clients ↔ API gateway（auth/rate limit）↔ Sync service（Yjs relay + persistence）↔ PostgreSQL（元数据）+ S3（媒体）
```
- 多服务、处理鉴权/多租户
- 适合大团队（50+ 人）
- 3-5 个 Docker 容器

**Option C：托管服务（最快）**
- Liveblocks / PartyKit
- 几天部署、无基础设施
- 月费、非开源（违背本地优先）

**推荐**：从 A 开始；扩展时迁移到 B；避免 C（违背本地优先）

### 5.7 推荐栈总结

| 层 | 技术 | 理由 |
|----|------|------|
| 桌面壳 | Tauri 2（Rust + webview） | Bundle 10x 小、内存 5x 少 |
| 编辑器框架 | TipTap（ProseMirror 封装） | 最大生态、Notion-ready 扩展 |
| 同步层 | Yjs CRDT + y-indexeddb | 事实标准、RTC 优秀 |
| 数据库 | SQLite + cr-sqlite CRDT | 本地优先、嵌入式、CRDT 支持 |
| 文件存储 | 本地 FS + S3 兼容 | 简单、可移植、可扩展 |
| Sync Server | y-websocket relay（单容器） | 最小基础设施 |
| 语言 | TS（前端）+ Rust（后端） | 类型安全、现代工具链、性能 |

### 5.8 Folio 差异化机会

1. **Tauri 2 for mobile**：同一代码库出原生 iOS/Android（多数竞品用 Electron 或独立原生）
2. **Yjs + cr-sqlite 混合**：CRDT 用于文本/块、SQLite 用于查询
3. **简单自托管**：单 Docker 容器 sync server（vs AppFlowy 5+ 服务）
4. **性能**：Tauri + Yjs 实现快启动 + 低内存
5. **Mobile-first**：真正的移动端对等（不像 Logseq/Obsidian 是次要）

---

## 6. Folio 战略定位

### 6.1 从竞品借鉴

| 竞品 | 借鉴点 |
|------|--------|
| AppFlowy | 块编辑与数据库模型（最接近 Notion）；本地优先 SQLite；Docker 自托管 |
| AFFiNE | CRDT 同步（比 AppFlowy 自研更可靠）；Edgeless 画布模式（差异化） |
| Obsidian | 插件生态；Graph view；Backlinks |
| Anytype | 对象型范式；默认 E2EE |
| SiYuan | 块级引用；SQL 查询嵌入 |

### 6.2 避免 / 做不同

**避免**：
- ❌ Electron bloat（用 Tauri）
- ❌ 复杂自托管（单容器，非 5+ 服务）
- ❌ 不可靠同步（用成熟 CRDT，非自研协议）
- ❌ 桌面优先思维（首日即设计移动对等）
- ❌ 巨型 app 体积（bundle 优化、lazy loading）

**做不同（竞争优势）**：
- ✅ **Mobile-first**：真正的原生 iOS/Android，非 webview
- ✅ **简单同步**：可靠、快、清晰状态指示
- ✅ **隐私默认**：E2EE、本地优先、可选云
- ✅ **性能**：亚秒级启动、大文档平滑滚动
- ✅ **开发者友好**：REST API、Webhooks、插件系统
- ✅ **迁移工具**：一键 Notion 导入（保留 relations）

### 6.3 Gap 分析：市场缺口

**2026 未被满足的需求**：
1. **可靠同步**：所有竞品都有同步问题（Logseq 数据丢失、AppFlowy 延迟）
2. **移动端对等**：桌面优先思维、移动端次要
3. **简单自托管**：AppFlowy 5+ Docker 太复杂
4. **性能**：所有工具在大数据集下都有性能问题
5. **AI 集成**：多数无原生 AI、或需自托管 LLM
6. **数据库完整性**：无开源工具达到 Notion 级数据库功能（relations、rollups、formulas）
7. **插件生态**：仅 Obsidian 有强生态
8. **RTC**：仅 AFFiNE 有成熟 RTC，但仍实验性

**Folio 差异化**：聚焦 Top 3 缺口：
1. **可靠同步**（CRDT + 清晰状态指示）
2. **移动端对等**（首日即原生 app）
3. **简单自托管**（单 Docker 容器）

---

## 7. 结论

本地优先 Notion 替代品赛道拥挤，但**没有任何开源工具解决了所有问题**：

- **AppFlowy**：最接近 Notion，但有性能问题与复杂自托管
- **AFFiNE**：创新（块+画布），但 Pre-1.0 不稳定
- **Obsidian**：开发者最爱，但无数据库、DIY 同步
- **Logseq**：同步坏掉、DB 版本等待多年
- **Anytype**：隐私优先，但学习曲线陡、P2P 限制

**Folio 的机会**：
- **2026 栈**：Tauri + TipTap + Yjs + cr-sqlite（现代、轻量、验证过）
- **聚焦**：可靠同步、移动对等、简单自托管
- **竞争优势**：原生性能、小 app 体积、开发者友好
- **市场定位**：想要 Notion 功能但不愿 SaaS 锁定与性能问题的团队

**下一步建议**：
1. 原型：最小可用 app（Tauri + TipTap + Yjs）
2. 同步可靠性优先于功能
3. 首日即设计移动 app（非次要）
4. 自托管保持简单（单 Docker 容器）
5. 性能持续测量（亚秒级启动、平滑滚动）

---

## 来源

- [Best Open Source Notion Alternative in 2026 — OSSAlt](https://ossalt.com/guides/notion-appflowy-affine-obsidian-2026)
- [PKM Tools 2026 — Chaos and Order](https://www.youngju.dev/blog/culture/2026-05-15-pkm-tools-2026-notion-obsidian-logseq-anytype-tana-capacities-heptabase-deep-dive.en)
- [AppFlowy Features](https://appflowy-io-appflowy.mintlify.app/features)
- [AppFlowy GitHub](https://github.com/AppFlowy-IO/AppFlowy/)
- [Anytype Protocol Overview](https://tech.anytype.io/any-sync/overview?id=protocol-explanation)
- [AFFiNE GitHub](https://github.com/toeverything/AFFiNE)
- [SiYuan GitHub](https://github.com/siyuan-note/siyuan)
- [Logseq Sync Issues — GitHub](https://github.com/logseq/logseq/issues/12539)
- [Logseq Alternatives 2026 — dEssence](https://dessence.ai/blog/logseq-alternatives-after-stalled-development-2026)
- [CRDT Engines 2026 — Chaos and Order](https://www.youngju.dev/blog/culture/2026-05-15-crdt-local-first-engines-2026-yjs-automerge-loro-replicache-liveblocks-deep-dive-en)
- [Tauri 2 vs Electron — Chaos and Order](https://www.youngju.dev/blog/culture/2026-05-14-tauri-2-rust-webview-desktop-mobile-electron-alternative-deep-dive-2026.en)
- [Lexical vs TipTap 2026 — Eddyter](https://eddyter.com/blogs/lexical-vs-tiptap-2026)
- [Self-Hosted Note-Taking 2026 — SelfHostWise](https://selfhostwise.com/posts/self-hosted-note-taking-in-2026-joplin-vs-standard-notes-vs-trilium-complete-guide/)
- [Trilium vs Joplin — selfhosting.sh](https://selfhosting.sh/compare/joplin-vs-trilium/)
- [AppFlowy vs AFFiNE — selfhosting.sh](https://selfhosting.sh/compare/affine-vs-appflowy/)
- [Paperus GitHub — P2P Notion Alternative](https://github.com/Naridon-Inc/paperus)
- [Cept GitHub — Git-backed Notion Clone](https://github.com/nsheaps/cept)
- [LibreDiary GitHub — Self-Hosted Notion Alternative](https://github.com/Akaal-Creatives/LibreDiary)
