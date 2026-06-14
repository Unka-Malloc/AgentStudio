# Scenario 01: 代码提交

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Scenario draft with machine-readable status tracking
- Scope: Scenario 01: 代码提交.
- Staleness check: Scanned on 2026-06-11; scenario live/contract/local status must match docs/scenarios/scenario-implementation-status.json and the latest readiness reports.

状态：已确认场景草案

## 元数据

### 执行路线

```text
智能体 MCP -> Pact MCP adapter -> Tool Management -> 代码提交 operation -> 身份绑定与三层权限裁决 -> 用户审批或长期授权 -> 代码提交任务队列 / durable workflow -> Codespace / Code Review worker -> Gerrit Change / GitHub PR -> receipt / audit / trace / 管控台状态
```

### 涉及模块

#### 接入层

| 模块 / 入口 | 本场景职责 | 关键暴露 |
| --- | --- | --- |
| MCP 服务端入口 | 接收智能体发起的代码提交请求，承接 MCP transport、工具发现和调用上下文。 | `tools/list`、`tools/call`、HTTP MCP / stdio proxy |
| `pact.codespace` | 面向智能体暴露代码空间与代码提交能力，承载代码提交场景的业务语义入口。 | `pact.workspace.code.change.upload` 等 codespace operation |
| `pact.call` | 作为底层稳定调用工具，按 tool name / operation id 转发到 Pact operation。 | 统一 `pact.call` envelope、operation payload |
| Tool Management | 管理工具目录、grant token、能力发现、scope / toolset 约束和调用路由。 | tool catalog、grant token、policy decision |
| 智能体连接与回包 | 维护客户端连接、身份绑定和任务完成通知。 | SSE `notifications/pact/operation_reply` |

#### 调度层

- Operation Registry / Dispatcher。
- Console Domain Operation Executor。
- 代码提交任务队列 / durable workflow。
- Codespace / Code Review worker。
- 代码提交任务状态、异步通知和失败重试。

#### 安全治理层

- Console Auth、主体解析和会话上下文。
- Authorization Governance、团队 / 用户 / 智能体三层权限裁决。
- 审批流、长期授权、风险策略和 operation policy。

#### 业务能力层

- Codespace / workspace code change runtime。
- ChangeSet / CodeChange / UploadReceipt 抽象。
- GitHub PR adapter 与 Gerrit Change adapter。

#### 数据与观测层

- 工作空间文件与代码变更留档。
- Operation Ledger、Audit、Trace、Report。
- Checkpoint / receipt / 外部 provider 状态同步。

## 场景目标

智能体通过 Pact MCP 工具发起代码提交请求，链路必须从智能体 MCP 一路打到 Gerrit / GitHub。Pact 必须完成智能体身份识别、用户与团队权限裁决、必要的用户或管理员审批、代码变更抽象、GitHub / Gerrit 目标适配、外部提交、状态同步、审计、报表、trace 和回溯记录，并把结果返回给智能体与管控台。

本场景不是单个“代码管理模块”能力，而是一条从客户端到服务端后端的完整业务链路：

```text
智能体
-> MCP 工具调用
-> Pact MCP adapter
-> Tool Management
-> 身份绑定与三层权限裁决
-> 用户审批或长期授权
-> 代码提交任务队列 / durable workflow
-> Codespace / Code Review worker
-> GitHub PR 或 Gerrit Change
-> Operation Ledger / Audit / Trace / Report / Checkpoint
-> 智能体响应与管控台可见状态
```

## 参与者

- 智能体：通过 Pact MCP 调用代码提交工具的外部操作者。
- 用户：智能体绑定的自然人或账号主体。
- 团队：用户所属的一个或多个权限组，团队权限按并集计算。
- 管理员：可配置用户、团队、智能体、智能体分组和代码目标权限。
- 代码目标：GitHub、Gerrit，后续可扩展到其它 review / repository 系统。
- Pact 服务端：负责协议入口、权限裁决、业务执行、状态持久化和审计。

## 入口与客户端兼容

入口固定为“智能体 + MCP”。不同智能体必须能发现并调用同一组代码提交 MCP 工具。不同智能体之间只允许在连接、认证、transport、能力声明和本地安装方式上存在适配差异，业务语义不能分叉。

第一版至少要覆盖：

- OpenClaw 类智能体。
- Claude Code 类 MCP 客户端。
- Codex 类智能体。
- Antigravity 类 MCP 客户端。
- OpenCode 类 MCP 客户端。
- Copilot 类 MCP 客户端。
- Kilo Code 类 MCP 客户端。
- Cursor 类 MCP 客户端。
- Hermes Agent 类智能体。
- 脚本型 MCP 客户端。

验收口径：

- 每类客户端都能完成工具发现。
- 每类客户端都能发起权限检查。
- 每类客户端都能提交同一种 `ChangeSet`。
- 同一请求在服务端进入相同 operation、policy、ledger、audit 和 trace 链路。

## 代码提交抽象

用户语义统一叫“提交代码”。实现上，Pact 需要兼容不同输入形态：

- diff / patch。
- 文件新增、修改、删除。
- 已存在的 branch。
- 已存在的 commit ref。
- 智能体生成的变更描述和 commit message。

Pact 服务端统一抽象为：

- `CodeChange`：一次代码变更对象。
- `ChangeSet`：可上传、可审查、可回放的一组变更。
- `UploadReceipt`：外部目标系统确认收到后的凭证。

Pact 可以接收已有 diff，也可以在受控工作树中生成 branch / commit，再上传到目标系统。无论内部采用哪种方式，对智能体暴露的都是稳定的代码提交语义。

## MCP 工具要求

所有与代码提交相关的 MCP 工具必须可用，且效果符合预期。第一版工具语义至少覆盖：

- 发现可用代码目标。
- 发现用户和智能体可访问的仓库。
- 检查某仓库某动作的权限。
- 读取仓库 tree / 文件 / diff。
- 准备 `ChangeSet`。
- 预览提交影响。
- 选择 GitHub Draft PR、GitHub 正式 PR 或 Gerrit Change。
- 上传变更到目标系统。
- 同步 PR / Change 状态。
- 读取评论、审批、请求修改状态。
- 提交评论、请求修改、批准。
- 查询一次提交链路的 audit、trace、ledger、receipt 和报表记录。

工具必须通过 Pact 的 Tool Management、operation registry、权限裁决和 audit 链路，不允许智能体直接拿目标系统 token 绕过 Pact。

## 三层权限模型

智能体提交代码的权限分三层：

1. 智能体自身权限。
2. 智能体所属用户权限。
3. 用户所属团队权限。

覆盖顺序固定为：

```text
团队权限并集
  -> 用户权限 / 用户审批
    -> 智能体自身权限 / 智能体分组权限
      -> 本次代码提交动作
```

规则：

- 用户可以属于多个团队。
- 团队层权限按并集计算。
- 团队层是最高约束。只要所有团队都不允许某仓库或某动作，团队层直接拒绝。
- 用户权限只能在团队允许范围内生效，不能扩大团队权限。
- 用户审批只能在团队和用户权限允许的范围内放行，不能覆盖团队拒绝。
- 智能体自身权限只能在团队和用户允许范围内生效，不能扩大用户权限。
- 智能体分组权限低于用户权限，也低于团队权限。
- 管理员直接配置智能体权限或智能体分组权限时，也不能突破该智能体所属用户和团队的上层约束。

等价裁决表达：

```text
effectiveTeamAllow = union(user.teams[].repoActionAllow)
effectiveUserAllow = effectiveTeamAllow ∩ user.repoActionAllow ∩ userApprovalScope
effectiveAgentAllow = effectiveUserAllow ∩ agent.repoActionAllow ∩ agentGroupAllow
decision = allow only if requestedAction ∈ effectiveAgentAllow
```

其中 `userApprovalScope` 可以来自单次审批、限时授权或永久授权；它仍然只能收窄或确认上层权限，不能扩大权限。

## 审批模式

当团队和用户权限允许，但智能体缺少本次提交所需授权时，Pact 可以进入用户审批流程。

用户在管控台上可选择：

- 本次允许。
- 限时允许。
- 永久允许。
- 拒绝。

审批记录必须包含：

- 审批人。
- 智能体身份。
- 绑定用户。
- 团队权限快照。
- 仓库。
- 代码目标。
- 动作范围。
- PR / Change 类型。
- 过期时间或永久标记。
- 撤销状态。
- 审计 ID。

长期允许不是全局绕过。团队权限、用户权限、管理员策略、智能体分组权限或目标仓库策略变化后，长期允许必须重新计算有效性。

## 管控台配置要求

管控台必须支持：

- 用户与智能体身份绑定。
- 用户所属团队配置。
- 团队权限组配置：超级管理员、团队管理员、团队成员、普通用户等。
- 团队对仓库和代码目标动作的授权。
- 用户级仓库和动作授权。
- 每次智能体请求的审批。
- 本次允许、限时允许、永久允许的授权记录管理。
- 管理员手动配置单个智能体允许行为。
- 管理员配置智能体分组。
- 查询某次拒绝来自团队层、用户层、智能体层还是目标系统层。

权限解释必须对用户可见。团队层直接拒绝时，不应再要求用户审批。

## 目标系统兼容

### GitHub

GitHub 第一版必须支持：

- 准备 PR 变更。
- 创建 Draft PR。
- 创建正式 PR。
- 同步 PR 状态。
- 读取 review、comment、check 状态。
- 发表评论。
- 请求修改。
- 批准。
- 记录目标系统返回的 PR URL、编号、head branch、base branch、commit ref 和 receipt。

是否由 Pact 生成 commit / branch 属于实现细节，但必须能被 `CodeChange`、`ChangeSet` 和 `UploadReceipt` 表达。

### Gerrit

Gerrit 第一版必须支持：

- 准备 Change。
- 上传 Change。
- 同步 Review 状态。
- 读取评论、标签、投票、当前 patchset。
- 发表评论。
- 请求修改。
- 批准。
- 记录目标系统返回的 change id、change URL、patchset、commit ref 和 receipt。

### 目标差异处理

GitHub 和 Gerrit 的差异必须由后端 adapter 吸收。智能体面对的 MCP 工具语义应稳定，不应要求智能体理解 `refs/for/*`、PR branch push、Gerrit patchset 等目标系统细节。

## 全链路记录与回溯

全流程所有关键动作都必须可记录、可观察、可审计、可回溯。

必须记录：

- MCP 工具调用。
- 智能体身份解析。
- 用户绑定关系。
- 团队权限并集计算结果。
- 用户权限裁决。
- 智能体权限裁决。
- 用户审批记录。
- 代码目标选择。
- `CodeChange` / `ChangeSet` 创建。
- dry-run / preview。
- 外部上传请求。
- GitHub / Gerrit 返回结果。
- 状态同步。
- 失败、拒绝、重试和撤销。

必须进入：

- Operation Ledger。
- Audit。
- Trace。
- Report。
- Checkpoint / state history。
- Upload receipt。

管控台必须能按以下维度查询：

- 智能体。
- 用户。
- 团队。
- 仓库。
- 代码目标。
- PR / Change。
- 权限裁决层级。
- 审批状态。
- 时间范围。
- 成功 / 失败 / 拒绝 / 重试。

## 成功链路

1. 智能体通过 MCP 发现代码提交工具。
2. 智能体请求提交某仓库的 `ChangeSet`。
3. Pact 识别智能体身份。
4. Pact 找到智能体绑定用户。
5. Pact 计算该用户所属团队的仓库/动作权限并集。
6. Pact 检查用户权限。
7. Pact 检查智能体自身权限和智能体分组权限。
8. 如果需要审批，管控台通知用户审批。
9. 用户选择本次允许、限时允许或永久允许。
10. Pact 准备 `CodeChange` / `ChangeSet`。
11. Pact 将已授权的代码提交请求写入任务队列 / durable workflow。
12. Codespace / Code Review worker 领取任务并根据目标创建 GitHub Draft PR、GitHub 正式 PR 或 Gerrit Change。
13. Pact 写入 ledger、audit、trace、report、checkpoint 和 upload receipt。
14. Pact 向智能体返回目标系统 URL、状态和审计引用。
15. 管控台展示完整链路和结果。

## 拒绝链路

拒绝必须说明来自哪一层：

- 团队层拒绝：用户所有智能体都不能提交，且无需用户审批。
- 用户层拒绝：该用户及其所有智能体不能提交。
- 智能体层拒绝：用户可提交，但该智能体或智能体分组无权提交。
- 审批拒绝：用户拒绝本次请求。
- 目标系统拒绝：Pact 已允许，但 GitHub / Gerrit 返回权限、分支保护、review rule 或 API 错误。

所有拒绝都必须进入 audit、trace 和报表，并可在管控台按拒绝层级过滤。

## 子场景清单

1. 智能体连接 Pact 后发现代码提交 MCP 工具。
2. 智能体请求查看可提交仓库列表。
3. 用户属于多个团队，团队权限按并集允许目标仓库。
4. 用户所有团队都不允许某仓库，团队层直接拒绝。
5. 团队允许但用户不允许，用户层拒绝。
6. 团队和用户允许，但智能体自身不允许，智能体层拒绝。
7. 团队和用户允许，智能体缺少长期授权，进入本次审批。
8. 用户批准本次提交。
9. 用户设置限时允许后，智能体在有效期内再次提交无需审批。
10. 限时允许过期后，智能体再次提交需要重新审批。
11. 用户设置永久允许后，智能体后续提交沿用授权。
12. 管理员撤销永久允许后，智能体再次提交需要重新审批或被拒绝。
13. 管理员直接允许某智能体提交指定仓库。
14. 管理员通过智能体分组授予提交权限。
15. 智能体提交 diff / patch。
16. 智能体提交文件变更集合。
17. 智能体提交已有 branch / commit ref。
18. Pact 创建 GitHub Draft PR。
19. Pact 创建 GitHub 正式 PR。
20. Pact 上传 Gerrit Change。
21. Pact 同步 GitHub PR 状态。
22. Pact 同步 Gerrit Change 状态。
23. 智能体读取 review 评论。
24. 智能体发表评论。
25. 智能体请求修改或批准。
26. GitHub 目标返回 API 错误，Pact 返回可解释错误并记录审计。
27. Gerrit 目标返回 refs / patchset 错误，Pact 返回可解释错误并记录审计。
28. 外部目标网络失败，Pact 标记可重试并保留 trace。
29. 代码提交过程中服务端中断，恢复后可查询中间状态和 receipt。
30. 管控台按智能体、用户、团队、仓库、目标系统和时间范围回溯完整链路。

## 验收标准

- 不同智能体都能通过 MCP 调用同一组代码提交工具。
- 代码提交工具覆盖发现、权限检查、变更准备、预览、上传、状态同步和 review 操作。
- 团队、用户、智能体三层权限按既定覆盖顺序生效。
- 多团队用户按团队权限并集计算。
- 用户审批支持本次允许、限时允许、永久允许和拒绝。
- 管理员可以配置智能体和智能体分组权限，但不能突破用户和团队权限。
- GitHub 支持 Draft PR 和正式 PR。
- Gerrit 支持 Change 上传和 Review 状态同步。
- 所有成功、失败、拒绝、审批和目标系统返回都进入 ledger、audit、trace、report 和 receipt。
- 管控台可以解释一次提交为什么被允许或拒绝。
- 管控台可以回溯一次提交从 MCP 调用到 GitHub / Gerrit 返回的完整链路。

## 待映射实现入口

后续实现或校准时，需要把本场景映射到现有或新增入口：

- MCP tool 暴露和 Tool Management scope。
- `codespace.*` / `workspace.code.*` operation。
- GitHub adapter。
- Gerrit adapter。
- 身份绑定和智能体注册表。
- 团队、用户、智能体三层权限 provider。
- 用户审批和长期授权记录。
- Operation Ledger。
- Audit / Trace / Report。
- Checkpoint / state history。
- 管控台代码提交链路视图。

## 待新增或复用的验证

候选 verifier：

- `server:verify:scenario-agent-code-submission`
- `server:verify:codespace`
- `server:verify:gerrit-mcp`
- `server:verify:v001-codespace-e2e`
- `server:verify:tool-management`
- `server:verify:security-hardening`
- `server:verify:business-scenarios` 后续可改名或新增 `server:verify:scenarios`

第一版专用 verifier 至少应覆盖：

- MCP 工具发现。
- 三层权限裁决。
- 本次 / 限时 / 永久审批。
- GitHub Draft PR contract。
- GitHub 正式 PR contract。
- Gerrit Change contract。
- 全链路 ledger / audit / trace / report / receipt。
