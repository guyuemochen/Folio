# Git 规则

本项目（Folio）的 Git 工作流规范。所有贡献者在动手前必须阅读本文件。

---

## 1. 分支模型

### 1.1 长期分支

| 分支 | 角色 | 保护级别 |
|------|------|----------|
| `master` | **生产分支**。始终处于可发布状态，与线上最新稳定版本一致。 | 🔒 禁止直接 push，只能由 `dev` 发版时通过 PR 合并。 |
| `dev` | **开发分支**。所有功能分支的集成分支，保持最新开发进度。 | 🔒 禁止直接 push，只能通过功能分支 PR 合并。 |

### 1.2 功能分支（短期）

**每项开发任务必须单独创建分支**，完成后通过 PR 合并入 `dev`。

#### 分支命名规范

```
<类型>/<简短描述>-<issue编号?>
```

| 类型 | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat/global-search` |
| `fix` | Bug 修复 | `fix/first-line-text-selection` |
| `refactor` | 重构（无行为变化） | `refactor/db-layer` |
| `perf` | 性能优化 | `perf/database-virtualization` |
| `docs` | 文档变更 | `docs/prd-update` |
| `chore` | 构建/工具/依赖 | `chore/upgrade-tauri` |
| `ci` | CI 配置 | `ci/release-pipeline` |
| `hotfix` | 生产紧急修复（从 `master` 拉出，见 §3） | `hotfix/crash-on-startup` |

规则：
- 一律小写，单词用 `-` 分隔。
- 描述应能自解释；避免 `feature-1`、`tmp`、`wip` 等无意义命名。
- 一个分支只做一件事。多个不相关改动请拆分为多个分支。

---

## 2. 日常工作流（功能 → dev）

```
master (生产) ────────────────────────────────────────┐
                                                       │ 发版时合并（见 §4）
dev (开发) ────┬──────────┬──────────┬────────────────┘
               │          │          │
        feat/xxx     fix/yyy     perf/zzz   ← 每个 PR 一个分支
```

### 2.1 标准流程

1. **同步本地 dev**
   ```bash
   git checkout dev
   git pull origin dev
   ```

2. **创建功能分支**
   ```bash
   git checkout -b feat/your-feature
   ```

3. **开发 + 提交**（提交信息规范见 §5）
   ```bash
   git add <files>
   git commit -m "feat(search): add FTS5 index on page contents"
   ```

4. **推送并创建 PR 到 `dev`**
   ```bash
   git push -u origin feat/your-feature
   ```
   在 GitLab 上创建 **Merge Request**：
   - 源分支：`feat/your-feature`
   - 目标分支：**`dev`**（不要选 `master`）
   - 标题用 Conventional Commit 格式。
   - 描述说明「改了什么 / 为什么改 / 如何验证」。

5. **Code Review 通过后合并**
   - 采用 **Squash Merge**（推荐）或 **Merge Commit**，保持历史清晰。
   - 合并后删除源分支。

### 2.2 同步上游变更

开发期间若 `dev` 有新提交，及时 rebase 保持分支最新：
```bash
git fetch origin
git rebase origin/dev
```
避免无意义的 merge commit 堆积。

---

## 3. 紧急修复（Hotfix）

生产环境出现紧急 Bug 时，**不要从 `dev` 拉分支**（`dev` 可能包含未发版的改动）。

```
master ──────┬───────────────────────┐
             │                       │
        hotfix/xxx               合并回 master + dev
```

1. 从 `master` 拉出：
   ```bash
   git checkout master
   git pull origin master
   git checkout -b hotfix/critical-crash
   ```
2. 修复并提交。
3. 同时创建两个 PR（或先合并 master 再 cherry-pick 到 dev）：
   - `hotfix/critical-crash` → **`master`**（发版用）
   - `hotfix/critical-crash` → **`dev`**（让开发分支也拿到修复）

---

## 4. 发版流程（dev → master）

发版 = 把 `dev` 上经过测试的功能集合正式发布为稳定版。

### 4.1 合并

1. 确认 `dev` 分支所有 CI 通过、测试稳定。
2. 创建 PR：`dev` → **`master`**。
3. PR 标题写明版本号，例如 `release: v0.1.0`。
4. Code Review + 批准后合并（推荐 **Merge Commit**，保留发版历史节点）。

### 4.2 打 Tag（见 §6）

合并到 `master` 后，根据发布通道打对应 tag：

```bash
git checkout master
git pull origin master
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0   # 会同步到 GitHub，触发 release.yml 稳定通道构建
```

---

## 5. 提交信息规范（Conventional Commits）

本项目采用 [Conventional Commits](https://www.conventionalcommits.org/)，历史提交已遵循此规范。

### 格式

```
<类型>(<范围>): <简短描述>

<可选正文，说明动机/影响>

<可选脚注，如 BREAKING CHANGE:>
```

### 类型

| 类型 | 含义 |
|------|------|
| `feat` | 新功能（用户可感知） |
| `fix` | Bug 修复 |
| `refactor` | 重构，不改变行为 |
| `perf` | 性能优化 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响逻辑） |
| `test` | 测试相关 |
| `build` | 构建系统 / 依赖 |
| `ci` | CI 配置 |
| `chore` | 杂项（不归入 src 或 test） |
| `revert` | 回滚某次提交 |

### 范围（可选）

用模块名或里程碑标识，例如：
- `feat(search): ...`
- `fix(editor): ...`
- `feat(M9): ...`
- `ci(release): ...`

### 示例

```
feat(updater): add About modal with channel picker
fix(ci): use universal-apple-darwin target + rolling tag
docs: mark M7-a11y done in README
revert: use tag push to trigger stable/beta releases
```

### 规则

- 描述用**祈使句现在时**（英文）：`add`，不要 `added` / `adds`。
- 首字母小写，结尾不加句号。
- 一行不超过 72 字符（正文按 72 字符折行）。
- **Breaking Change**：在类型后加 `!`，或在脚注写 `BREAKING CHANGE: <说明>`。
  ```
  feat(api)!: rename `getPage` command to `page_get`
  ```

---

## 6. Tag 与版本号规范

### 6.1 版本号（SemVer）

遵循 [Semantic Versioning](https://semver.org/)：`MAJOR.MINOR.PATCH`

```
v0.1.0
 │ │ │
 │ │ └─ PATCH  — 向后兼容的 Bug 修复
 │ └─── MINOR  — 向后兼容的新功能
 └───── MAJOR  — 不兼容的破坏性变更
```

- 当前处于 `0.x` 阶段，MINOR 位用于新功能，PATCH 位用于修复。
- 所有 tag **必须以 `v` 开头**：`v0.1.0`，不是 `0.1.0`。

### 6.2 三个发布通道

本项目有三条发布通道（由 `.github/workflows/release.yml` 驱动）：

| 通道 | Tag 格式 | 示例 | 用途 | 目标分支 |
|------|----------|------|------|----------|
| **Stable**（稳定） | `v<X.Y.Z>` | `v0.1.0`、`v0.1.1` | 正式发布给所有用户 | `master` |
| **Beta**（测试） | `v<X.Y.Z>-beta.<N>` | `v0.1.0-beta.1`、`v0.1.0-beta.2` | 发布前的公开测试版 | `dev` 或发版分支 |
| **Nightly**（每日构建） | `nightly-<YYYY-MM-DD>` | `nightly-2026-07-08` | 自动构建，每日 03:00 UTC 由 cron 触发 | `dev` HEAD |

### 6.3 Rolling Tags（CI 维护）

每条通道还对应一个**滚动 Tag**，由 CI 自动覆盖写入，**禁止手动操作**：

| Rolling Tag | 对应通道 | 用途 |
|-------------|----------|------|
| `stable-latest` | Stable | Tauri 更新器读取此处的 `latest.json` |
| `beta-latest` | Beta | 同上 |
| `nightly-latest` | Nightly | 同上 |

> 这些 Tag 每次 CI 构建都会被覆盖。**绝对不要手动 push 或删除它们**。

### 6.4 打 Tag 流程

#### Stable 发版

```bash
# 1. 确认 dev → master PR 已合并
git checkout master
git pull origin master

# 2. 打 annotated tag
git tag -a v0.1.0 -m "Release v0.1.0 - 首个稳定版"

# 3. 推送（会经 mirror 同步到 GitHub，触发 stable 构建）
git push origin v0.1.0
```

#### Beta 预发布

从 `dev`（或发版准备分支）打：
```bash
git checkout dev
git pull origin dev
git tag -a v0.1.0-beta.3 -m "Beta 3 for v0.1.0"
git push origin v0.1.0-beta.3
```

#### Nightly

- **自动**：cron 每天 03:00 UTC 触发，无需手动操作。
- **手动触发**：在 GitHub Actions 页面用 `workflow_dispatch` 选择 `nightly` 通道，或手动打 `nightly-<日期>` tag。

### 6.5 Pre-release 编号规则

同一版本的多次 Beta 递增序号：

```
v0.1.0-beta.1   ← 第一轮测试
v0.1.0-beta.2   ← 修复后第二轮
v0.1.0          ← 测试通过后，去掉 -beta 后缀发正式版
```

---

## 7. 速查表

| 场景 | 从哪拉 | 合到哪 | 打 Tag |
|------|--------|--------|--------|
| 开发新功能 | `dev` | `dev`（PR） | 否 |
| 修 Bug（非紧急） | `dev` | `dev`（PR） | 否 |
| 生产紧急修复 | `master` | `master` + `dev`（两个 PR） | 视情况补 PATCH tag |
| 正式发版 | — | `dev` → `master`（PR） | `v<X.Y.Z>` |
| 公开测试版 | `dev` | — | `v<X.Y.Z>-beta.<N>` |
| 每日构建 | `dev` HEAD | — | 自动（cron） |

---

## 8. 禁止事项

- ❌ 直接 push 到 `master` 或 `dev`（必须走 PR）。
- ❌ 手动操作 `stable-latest` / `beta-latest` / `nightly-latest` 滚动 Tag。
- ❌ 不带 `v` 前缀的版本 Tag（`0.1.0` ❌，`v0.1.0` ✅）。
- ❌ 在 `master` 上直接开发。
- ❌ 提交超大二进制文件（用 Git LFS 或放入 release assets）。
- ❌ 提交密钥、私钥、`.env` 等敏感信息（包括 `TAURI_SIGNING_PRIVATE_KEY`）。
- ❌ Force push 到受保护分支（`master` / `dev`）。
- ❌ 使用 `git push --tags` 批量推送（应只推需要的那个 tag）。
