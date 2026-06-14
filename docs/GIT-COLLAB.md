# GitHub 协作约定

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: GitHub 协作约定.
- Staleness check: Scanned on 2026-06-12; this update covers local worktree collaboration only and does not change release/readiness claims.

这个仓库现在按“源码仓”管理，只允许这些内容进入 Git：

- 源代码
- 源码级配置文件
- 构建脚本
- 文本文档
- 轻量占位文件，例如 `.gitkeep`

默认不进 Git 的内容：

- `node_modules/`
- `.pact-agent-history/`
- `build/dist/`
- `build/release/`
- `build/server-data/`
- `client-cli/target/`
- `build/local-data/`
- `build/mailapp-full-download/`
- `server/platform/modules/knowledge/runtime/jre/` 里的 JRE 二进制
- `server/platform/modules/knowledge/tika/*.jar`
- `server/platform/modules/knowledge/ocr/runtime/` 里的 Python / PaddleOCR / 模型二进制

## 为什么这样处理

我们需要把仓库上传到 GitHub 做协同开发，但这些目录要么是：

- 本地构建产物
- 第三方运行时
- 本地任务数据
- 超大二进制

把它们放进 GitHub 会让仓库变得非常重，也会让后续 clone、fetch、review 都变差。

## 本地如何补齐运行时

运行态配置、密钥状态、provider manifest、mount config、SQLite、日志、对象存储、后台队列、本地服务状态和原始 agent history 默认都放在：

- `~/.pact-server-data/`

项目目录里的 `build/` 不能作为服务端运行数据或配置目录。

真实邮件下载件、邮箱导入件和测评语料默认放在：

- `~/.pact-server-data/evaluation-corpora/`

如果你要在本地准备完整服务运行时，运行时二进制资产放在：

- `server/platform/modules/knowledge/runtime/jre/<platform-arch>/`
- `server/platform/modules/knowledge/tika/`
- `server/platform/modules/knowledge/ocr/runtime/<platform-arch>/`

这些目录约定是当前唯一受支持的运行时资源布局；大文件本体不进 GitHub。

## 当前状态

当前仓库已经调整为：

- 忽略所有构建产物和本地运行时
- 从 Git 索引里移除大目录和二进制
- 保留说明文件和目录占位

## 工作树拆分方案

Pact 的服务端、Web Console、CLI、GUI、MCP connector 和文档规则可以分开维护。推荐用 Git worktree 把不同任务放到 `Pact-worktrees/` 下，主工作树保留为集成区和手动产品文案维护区。

建议目录布局：

| Worktree | Branch | 主要职责 | 默认写入范围 |
| --- | --- | --- | --- |
| `Pact/` | `nightly` | 主集成区、最终合并、手动维护产品宣传页 | 避免直接承接大范围实验改动 |
| `Pact-worktrees/server/` | `codex/server-runtime` | 服务端运行时、治理、协议、server verifier | `server/`, `tests/server/`, 服务端脚本和相关服务端文档 |
| `Pact-worktrees/web/` | `codex/web-console` | 管理控制台前端 | `server-web/`, 前端样式、前端类型检查相关配置 |
| `Pact-worktrees/mcp/` | `codex/mcp-connector` | 本地智能体 MCP 连接器 | `mcp-connector/`, `docs/MCP_INSTALL*.md` |
| `Pact-worktrees/cli/` | `codex/client-cli` | Rust CLI | `client-cli/`, CLI smoke 测试 |
| `Pact-worktrees/gui/` | `codex/client-gui` | Flutter 桌面端 | `client-gui/` |
| `Pact-worktrees/docs-agent/` | `codex/docs-agent-context` | 智能体入口、文档索引、协作规则 | `AGENT.md`, `docs/`, 文档治理和根目录卫生校验 |

每个子系统目录都有局部入口文件：

| Worktree | 子目录入口 | 用途 |
| --- | --- | --- |
| `Pact-worktrees/server/` | `server/AGENT.md` | 服务端目录、首读文件和验证范围 |
| `Pact-worktrees/web/` | `server-web/AGENT.md` | Web Console 目录、组件入口和前端验证 |
| `Pact-worktrees/mcp/` | `mcp-connector/AGENT.md` | MCP connector CLI、安装文档和验证 |
| `Pact-worktrees/cli/` | `client-cli/AGENT.md` | Rust CLI 模块和 cargo/npm 验证 |
| `Pact-worktrees/gui/` | `client-gui/AGENT.md` | Flutter GUI 入口、测试和生成物边界 |
| `Pact-worktrees/docs-agent/` | `docs/AGENT.md` | 文档索引、元数据、历史材料和上下文预算 |

从主工作树创建这些 worktree：

```bash
cd /Users/unka/DevSpace/Unka-Malloc/Pact
mkdir -p ../Pact-worktrees

git worktree add -b codex/server-runtime ../Pact-worktrees/server nightly
git worktree add -b codex/web-console ../Pact-worktrees/web nightly
git worktree add -b codex/mcp-connector ../Pact-worktrees/mcp nightly
git worktree add -b codex/client-cli ../Pact-worktrees/cli nightly
git worktree add -b codex/client-gui ../Pact-worktrees/gui nightly
git worktree add -b codex/docs-agent-context ../Pact-worktrees/docs-agent nightly
```

查看和清理工作树：

```bash
git worktree list
git worktree prune
```

如果已经有同级 `Pact-server/`、`Pact-web/` 这类旧布局，可以用 `git worktree move` 收拢到 `Pact-worktrees/`：

```bash
git worktree move ../Pact-server ../Pact-worktrees/server
git worktree move ../Pact-web ../Pact-worktrees/web
```

### 协作边界

- 根 `README.md` 和 `README.zh-CN.md` 作为产品宣传页，默认只在主工作树中手动维护。
- `package.json`、`package-lock.json`、`vite.config.ts`、`tsconfig.json`、`docs/README.md` 属于共享文件；一次只让一个 worktree 修改，或放到专门的集成 worktree 中处理。
- 涉及服务端接口、前端调用和文档说明的变更，使用单独集成 worktree，例如 `Pact-policy/`，不要拆成多个并行分支分别修改。
- 每个 worktree 提交前运行覆盖本目录的最小验证；只有准备合并或发布时，再回到主集成区运行更宽的 gate。

### 智能体使用方式

智能体进入任一 worktree 后，先读取根 `AGENT.md`，再读取当前任务所属子目录的 `AGENT.md`。如果该目录没有局部入口，再读取最近的 README 或局部说明。不要把主工作树中的脏状态复制到子工作树，也不要用 `git add .` 批量暂存跨子系统文件。

如果需要让多个智能体并行工作，按上述边界分配 worktree 和写入范围；跨边界任务先指定唯一负责人，再由负责人合并其他分支的结果。

### 入口健康检查

入口文件结构由 `tests/verify-agent-entrypoints.mjs` 维护，并接入 `npm run repo:hygiene`。该检查用于维护项目内部引导的完整性：确认根目录以 `AGENT.md` 作为工程入口、关键子系统有局部入口、入口长度保持轻量、协作文档列出局部入口。

这个检查不用于证明或强制任何智能体遵守工作方式；它只保证仓库内有足够清晰、可发现、可渐进读取的引导材料。

调整工作树拆分或新增长期维护子系统时，同步更新局部 `AGENT.md`、`docs/GIT-COLLAB.md` 的入口表和 `tests/verify-agent-entrypoints.mjs`。

## 重要

当前仓库历史里原先有一个带大文件的 `Initial commit`。
如果你要把“干净历史”上传到 GitHub，不要直接推这段旧历史。

建议二选一：

1. 用当前清理后的工作树重新初始化一个新的 GitHub 仓库再提交
2. 在本地重写这一个初始提交，再推送

如果你要，我下一步可以继续把这一步也做掉。
