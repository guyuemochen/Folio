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

## #2 RGL v2 仪表盘 widget 无法拖动 / 调整大小（`process is not defined`）

**影响功能**：数据库 Dashboard 视图的 widget 拖动排序、resize、删除按钮（实际是整个 react-draggable 事件链）。
**首次发现**：接入 Dashboard 视图（`feat/database-dashboard` 或后续修复）时。

### 现象

Dashboard 视图里的 widget 能正常添加、渲染，但**点击 widget header 拖动 / 拖动右下角 resize handle 都没有任何反应**——widget 不跟随鼠标移动，layout 也不更新。

在独立 HTML 测试页（用 esm.sh CDN 加载同一个 RGL v2.2.3 + React 19）里能正常拖动；只有走 Folio 自己的 Vite dev server（进而也是 Tauri webview 加载的代码）时不工作。

### 根因

**`react-draggable`（RGL 的拖拽核心依赖）的 `log()` 函数无条件访问 `process.env.DRAGGABLE_DEBUG`，但 Vite dev server 在浏览器/webview 运行时不提供 `process` 全局。**

源码（`react-draggable/build/cjs/Draggable.js`）：
```js
// lib/utils/log.ts
function log(...args) {
  if (process.env.DRAGGABLE_DEBUG) console.log(...args);  // ← 此行抛 ReferenceError
}
```

`DraggableCore.handleDragStart` 在 `onMouseDown` 的第一行就调用 `log(...)`：

```
mousedown
  → DraggableCore.onMouseDown
    → DraggableCore.handleDragStart
      → log("DraggableCore: handleDragStart: %j", ...)   ← ReferenceError: process is not defined
      ↓ 异常抛出，handleDragStart 中断
      × onStart 永远不调用
      × document 上的 mousemove/mouseup 监听器永远不注册
      × 拖拽永远不启动
```

任何后续的 `dataTransfer` / `preventDefault` / handle selector / nodeRef 调试都无效，因为整个事件链在第一步就被异常中断。React 把异常 swallow 到 console（只在 dev tools 里可见），用户视觉上看到的就是「按下没反应」。

Vite 默认不向 client 注入 Node 风格的 `process` 全局；很多 npm 包假设它在浏览器里也存在，但通常被 Vite 的 `define` 或者 polyfill 处理掉了。`react-draggable` 的这个引用没被任何 Folio 已有的 define 命中，所以漏到了运行时。

> 为什么 rgl-test.html 能用：esm.sh 在 CDN 侧已经把 `process.env.DRAGGABLE_DEBUG` 编译成了字面量；Folio 自己的 Vite 没有这层处理。

### 修复

在 `vite.config.ts` 的 `define` 里把这一处访问编译为字面量 `false`，让运行时代码根本不接触 `process`：

```ts
// vite.config.ts
export default defineConfig({
  // ...
  define: {
    // Vite serves raw ESM to the browser/webview; it does NOT provide a
    // `process` global. react-draggable (used by react-grid-layout) reads
    // `process.env.DRAGGABLE_DEBUG` at the top of its `log()` helper, and
    // `log()` is called on every `handleDragStart`. Without this define the
    // read throws `ReferenceError: process is not defined` inside the
    // mousedown handler — which silently aborts the drag before it ever
    // starts.
    'process.env.DRAGGABLE_DEBUG': JSON.stringify(false),
  },
  // ...
});
```

`define` 是 Vite 的编译时字面量替换，比运行时 polyfill（`window.process = { env: {} }`）更精确——只替换这一处，不会污染其他模块对 `process` 的预期。

> 关闭前已确认：Folio 全代码库没有任何地方依赖 `process` 全局（除了 `vite.config.ts` 自身的 `process.env.TAURI_DEV_HOST` 等构建期变量，那是 Node 环境读的，与 client 无关）。此 define 不会影响其他模块。
>
> 同时修了 `WidgetFrame` 的 drag handle 位置问题：原来 RGL 的 `.folio-dashboard-drag-handle` 是一个透明 absolute overlay 覆盖在 widget 视觉外框上方 20px 留白处，用户视觉上看到的「widget header」并不在 handle 选择器范围内——即便 `process` 修好了，用户也找不到能拖的地方。改成把 `folio-dashboard-drag-handle` 直接加在 `WidgetFrame` 的 header div 上，让可见的 header 本身就是 handle。

### 验证

1. **必须完全重启 `pnpm tauri dev`（或 `pnpm dev`）**——`vite.config.ts` 的改动不会被 Vite HMR 热更新，Vite 会在配置变更时尝试重启，但浏览器里旧 bundle 仍是旧 define；强刷一次页面（Ctrl+Shift+R）确保拿到新 bundle。
2. 打开任意数据库，切到 Dashboard 视图。
3. 按下 widget 标题栏（不是 × 按钮），向右/向下拖动：widget 应跟随鼠标移动，松开后位置持久化。
4. 拖动 widget 右下角的 resize handle：widget 尺寸应跟随变化。
5. 点击 widget header 右侧的 ×：widget 被删除，layout 重新紧凑排列。

### 影响范围 / 附带修复

- **本次目标**：Dashboard widget 拖动 + resize + 删除全部恢复。
- **附带修复**：drag handle UX——从「透明 overlay 在 widget 上方留白」改成「widget header 本身就是 handle」，用户视觉上能直接识别可拖区域。
- **未波及**：表格行拖动（HTML5 drag，不经过 react-draggable）、侧边栏拖动（同上），这些走另一条事件链，不受 `process.env.DRAGGABLE_DEBUG` 影响。

### 教训

- 「按下没反应」+「在 dev console 里有 `ReferenceError`」= 第一信号去看 dev console，而不是继续猜 CSS / 选择器 / React 版本兼容。React 在事件回调里抛异常会被 swallow 到 console，UI 上毫无提示。
- 「在独立最小化 demo 里能用、在项目里不能用」通常是**构建链**差异（Vite define / polyfill / optimizeDeps），而不是业务代码差异。先比对两边的 bundle 处理（CDN 预编译 vs Vite 原始 ESM），再去看代码。
- 任何依赖访问 `process.env.XXX` 的 npm 包，在 Vite 项目里要么加 `define`、要么用 `vite-plugin-node-polyfills`，**不能假设 Vite 默认会处理**——Vite 的默认是「不 polyfill Node 内建」。

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
