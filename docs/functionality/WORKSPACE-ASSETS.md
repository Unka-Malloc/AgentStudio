# Workspace Assets

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Workspace, sharedspace, asset governance, contribution lifecycle, checkpoint, context bundle, and code-change workspace facade.
- Staleness check: Checked against workspace operations, sharedspace operations, checkpoint protocol, contribution state machine, workspace verifiers, and agent workspace controllers on 2026-06-16.

## 模块边界

本模块负责受控工作空间中的文件、贡献、资产、权限、checkpoint、context bundle、proposal、local directory sync 和 workspace code facade。真实代码评审 provider 归 `EXTERNAL-SERVICES`。

## 功能项 WA-01 工作空间文件

| 项 | 设计 |
| --- | --- |
| 目标 | 支持工作空间文件上传、列表、读取、写入、下载、删除和移动。 |
| 输入 | `/api/agent-workspaces/:workspaceId/files*`, `/api/workspace/files*`。 |
| 处理 | 所有写入经过 operation、authorization、audit 和 checkpoint；路径必须规范化。 |
| 输出 | 文件 metadata、download stream、write receipt、audit ref。 |
| 错误 | 越权路径、未授权 data class、锁冲突和非法写入 fail closed。 |
| 验证 | `npm run server:verify:agent-workspace-file-upload`, `npm run server:verify:workspace-file-ops`。 |

## 功能项 WA-02 Sharedspace 与本机目录同步

| 项 | 设计 |
| --- | --- |
| 目标 | 把本机目录或公共空间投影为 agent 可用但受控的 sharedspace。 |
| 输入 | localDir connect、item list、file read/write、sync plan/apply。 |
| 处理 | sync plan 先 dry-run，apply 只执行授权范围内的差异。 |
| 输出 | mount list、item tree、sync plan、apply result、receipt。 |
| 错误 | 默认不把用户任意目录变成可写空间；暴露目录可只读。 |
| 验证 | `npm run server:verify:workspace-local-dir-sync`, `npm run server:verify:v001-local-dir-e2e`。 |

## 功能项 WA-03 资产贡献

| 项 | 设计 |
| --- | --- |
| 目标 | 支持知识、文件、Skill 引用、工具、脚本、专家意见和产物的贡献、审核、发布和采用统计。 |
| 输入 | contribution submit/list/scan/review/preview/publish/adopt/permission/report。 |
| 处理 | 贡献遵守 `contribution.lifecycle`，不能直接变成 canonical fact。 |
| 输出 | contribution record、leaderboard、stats、permission request/grant、report。 |
| 错误 | 脚本贡献不自动具备运行权限；Skill 包生命周期由能力包或 Skill Hub 拥有。 |
| 验证 | `npm run server:verify:workspace-contribution-governance`。 |

## 功能项 WA-04 Checkpoint Tree

| 项 | 设计 |
| --- | --- |
| 目标 | 所有重要状态变更形成 append-only checkpoint，可 preview 和 restore。 |
| 输入 | checkpoint list/get/diff/restore preview/restore/scope query。 |
| 处理 | 恢复写入 marker 和新状态，不 destructive reset 历史。 |
| 输出 | checkpoint tree、node、diff、restore preview、restore receipt。 |
| 错误 | 无法验证 scope 或越权恢复时拒绝；业务状态由 owning module 恢复。 |
| 验证 | `npm run server:verify:workspace-checkpoints`, `npm run server:verify:checkpoints`。 |

## 功能项 WA-05 Context Bundle

| 项 | 设计 |
| --- | --- |
| 目标 | 为智能体导出和恢复受控上下文包，而不是泄露完整 workspace。 |
| 输入 | context get、context bundle export/restore、context profiles。 |
| 处理 | 按 data class、grant、profile 和 compaction policy 形成裁剪视图。 |
| 输出 | context bundle、restore result、context evaluation records。 |
| 错误 | 未授权文件、hidden prompt、secret 和完整 transcript 默认不能打包。 |
| 验证 | `npm run server:verify:context-runtime`, `npm run server:verify:agent-workspace-context-bundle-security`。 |

## 功能项 WA-06 Proposal 与代码变更 facade

| 项 | 设计 |
| --- | --- |
| 目标 | 支持 workspace proposal、code target evaluation、change prepare/upload/link/status sync。 |
| 输入 | proposal create/apply、workspace.code.* operations。 |
| 处理 | workspace facade 只管理工作空间治理视角；真实 Git/Gerrit/GitHub provider 由外部服务模块处理。 |
| 输出 | proposal、decision、code change link、status projection。 |
| 错误 | 智能体不能直接获得裸 `git push` 能力。 |
| 验证 | `npm run server:verify:workspace-proposals`, `npm run server:verify:codespace`。 |
