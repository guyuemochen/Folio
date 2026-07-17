# Troubleshooting — 问题排查记录

开发过程中遇到的「非显而易见」的 Bug：现象、根因、修复方案、验证方式与影响范围。
每条记录都应能让后来者在不重新调试的情况下理解「为什么会坏」和「为什么这么修」。

---

## #1 Tauri webview 中 HTML5 拖放显示禁止图标（无法拖动）

**影响功能**：数据库视图行拖动排序、侧边栏收藏夹拖动排序。
**首次发现**：实现 DatabaseView 行拖动（`feat/database-row-drag-reorder`）时。

### 现象

在 DatabaseView 中按住行拖动手柄（⋮⋮）拖动时，鼠标立刻变成「禁止」图标（🚫 / no-drop），无法完成拖放。
在纯浏览器（`pnpm dev`，无 Tauri 外壳）里一切正常；只有在真实 Tauri webview（`pnpm tauri dev` / 打包后的 app）里复现。

侧边栏「收藏夹拖动排序」存在同样的潜在问题——它也只在浏览器里能用，从未在真实 webview 里被验证过。

### 根因

**Tauri v2 的窗口配置 `dragDropEnabled` 默认值为 `true`。**

当该选项为 `true` 时，Tauri 会启用**原生**拖放处理器（用于接收操作系统层面的文件拖入，并通过 `tauri://drag-enter` / `tauri://drag-over` / `tauri://drag-drop` / `tauri://drag-leave` 事件下发）。副作用是：**webview 内的 HTML5 拖放事件（`dragstart` / `dragover` / `drop` 等）被原生层抑制**——`dragstart` 能触发，但后续的 `dragover` / `drop` 不再送达 JS。

结果就是：拖拽「启动」了，但没有任何 JS 侧的 drop 目标调用 `preventDefault()`，浏览器/webview 便显示禁止图标。任何在 HTML5 层面（`dataTransfer`、`preventDefault` 时机、`draggable` 元素类型、`setDragImage`……）的调试都不会生效，因为事件根本到不了 JS。

> 命名变迁：Tauri v1 里这个选项叫 `fileDropEnabled`，v2 改名为 `dragDropEnabled`（位于 `app.windows[]` 下）；对应的运行时方法 `disable_file_drop_handler` 也改名为 `disable_drag_drop_handler`。

### 修复

在 `src-tauri/tauri.conf.json` 的窗口配置里显式关闭原生拖放：

```jsonc
{
  "app": {
    "windows": [
      {
        // …其它窗口配置…
        "dragDropEnabled": false
      }
    ]
  }
}
```

关闭前已确认：**全代码库（Rust + 前端）没有任何地方依赖原生拖放**。文件附加（`api.attachFile`）走的是 `@tauri-apps/plugin-dialog` 的文件选择器，不是拖放。因此关闭它不会破坏任何现有功能。

> 如果将来需要「拖文件到窗口」的功能，有两个选择：
> 1. 把 `dragDropEnabled` 重新设回 `true`，改用 Tauri 的原生拖放事件（`tauri://drag-drop`）接收文件，并放弃 webview 内的 HTML5 拖放；
> 2. 保持 `dragDropEnabled: false`，用 `<input type="file">` 或隐藏窗口 + 原生对话框的方式接收文件，保留 HTML5 拖放。

### 验证

1. **完全重启** `pnpm tauri dev`——`tauri.conf.json` 的改动不会被 Vite HMR 热更新，必须杀掉 Tauri 进程重新启动（Rust 会重新编译、用新配置重建窗口）。
2. 打开任意数据库页面，拖动行的 ⋮⋮ 手柄到另一行：应显示 `move` 光标 + accent 色顶部指示线，松开后行重排并持久化。
3. 侧边栏「收藏夹」区域，拖动一项到另一项的位置：应能重排。

### 影响范围 / 附带修复

- **本次目标**：DatabaseView 行拖动排序得以在真实 webview 中工作。
- **附带修复**：侧边栏收藏夹拖动排序（之前在真实 webview 里其实是坏的，只是没人发现）。

### 教训

- 「在浏览器里能用、在 Tauri webview 里不能用」是 Tauri 项目的典型信号——优先怀疑 webview 与浏览器的能力差异（原生事件拦截、CSP、协议差异等），而不是业务代码。
- 遇到「拖放显示禁止图标」且 HTML5 层调试无效时，第一反应应是 `dragDropEnabled`，而不是继续在 `dataTransfer` / `preventDefault` 上打转。

---

## 模板

新增条目时复制以下结构：

```markdown
## #N 一句话标题

**影响功能**：xxx。
**首次发现**：xxx（分支 / 版本 / 场景）。

### 现象
可复现步骤 + 期望 vs 实际。

### 根因
为什么会坏。引用相关文档 / 源码 / 协议规范。

### 修复
改了什么、为什么这么改。代码片段 / 配置 diff。

### 验证
如何确认修好（命令、操作步骤）。

### 影响范围 / 附带修复
是否波及其它功能、是否顺手修了别的问题。

### 教训
一句话总结，帮助下次更快定位同类问题。
```
