# Workspace Asset Governance

## Metadata / 元数据

- Last updated: 2026-06-07
- Status: Current maintained document
- Scope: Workspace Asset Governance.
- Staleness check: Scanned on 2026-06-07; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 Pact 的核心产品边界：公共工作空间资产治理。

Pact 不关心智能体之间如何互相协作，也不把智能体当作可信主体。系统只关心公共工作空间里的资产状态是否可治理。

## 目录 / Table of Contents

- [定位](#定位)
- [被治理对象](#被治理对象)
- [安全原则](#安全原则)
- [状态类型](#状态类型)
- [终端贡献型资产](#终端贡献型资产)
- [代码贡献与 Gerrit 路线](#代码贡献与-gerrit-路线)
- [排行榜与统计面板](#排行榜与统计面板)
- [资产贡献统计报表](#资产贡献统计报表)
- [贡献授权](#贡献授权)
- [演示场景：OpenClaw 文档互通](#演示场景openclaw-文档互通)
- [演示场景：Skill 贡献排行榜](#演示场景skill-贡献排行榜)
- [五阶段本机 MCP 落地路径](#五阶段本机-mcp-落地路径)
  - [阶段一：MCP 服务 + 本机工作空间](#阶段一mcp-服务--本机工作空间)
  - [阶段二：知识贡献 + 知识授权](#阶段二知识贡献--知识授权)
  - [阶段三：Skills 上传 + MCP 操作工作空间](#阶段三skills-上传--mcp-操作工作空间)
  - [阶段四：授权管控](#阶段四授权管控)
  - [阶段五：文件树回档能力](#阶段五文件树回档能力)
  - [第一轮任务拆分和验证入口](#第一轮任务拆分和验证入口)
- [资产门禁模型](#资产门禁模型)
- [上游知识库隔离](#上游知识库隔离)
- [演示场景：上游知识库 A/B 权限再授权](#演示场景上游知识库-ab-权限再授权)
- [统一 Checkpoint Tree](#统一-checkpoint-tree)
- [Operation Ledger](#operation-ledger)
- [Snapshot Boundary](#snapshot-boundary)
- [演示场景：Checkpoint Tree 安全恢复](#演示场景checkpoint-tree-安全恢复)
- [Proposal To Decision](#proposal-to-decision)
- [Context Compiler](#context-compiler)
- [本地智能体接入](#本地智能体接入)
- [可复制工作空间](#可复制工作空间)
- [验收标准](#验收标准)

## 定位

> Pact 是面向智能体时代的 Workspace Asset Governance System。

产品问题定义固定为：

> 两个问题，一个能力，三个兼容。

- 两个问题：知识库缺少面向智能体的权限管控；本地智能体相对独立，难以协同。
- 一个能力：工作空间管理，覆盖权限控制、快照、Checkpoint Tree、Operation Ledger、回溯、恢复、审计和资产贡献统计报表。
- 三个兼容层：`agent-client-mcp-compatibility`、`external-service-compatibility`、`pact-internal-compatibility`。

它瞄准的是上游知识库和下游本地智能体之间的中间狭窄地带：

- 上游知识库太粗：权限、切分、脱敏、再授权和借阅登记不足。
- 下游本地智能体太细：各自有本地能力，但缺少可共享、可接力、可审计的公共资产空间。
- Pact 的工作：把上游粗资源加工成可授权资产，把下游细贡献沉淀成可复用资产，并在中间统一快照、溯源、恢复、授权和排行。

三个兼容层的治理边界如下：

- `agent-client-mcp-compatibility`：OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、其它机器人体系或脚本都不是核心抽象；统一通过 Pact MCP service / Workspace API 访问工作空间。
- `external-service-compatibility`：知识库、网站订阅、文件库、业务系统、人工整理和智能体上传文档都先进入 workspace asset model，再统一治理。
- `pact-internal-compatibility`：容器、虚拟机、本机、云端、Linux、macOS、Windows 以及内部 mount/module/runtime 差异都只是环境差异；安装 Pact 管理软件后，智能体访问工作空间必须经过 Pact 的权限、路径、快照和审计适配。

本地智能体可以使用公共空间，但不能拥有公共空间。它们可以提交观察、产物、建议和轨迹；公共事实、公共资产和公共决策必须由 Pact 的状态机、策略和审计链确认。

## 被治理对象

Workspace asset state 包含：

- `rawAssets`：上传文件、邮件、附件、本地镜像、外部引用。
- `derivedAssets`：解析结果、normalized documents、DOCX/YAML sidecar、索引包。
- `contributedAssets`：终端、本地智能体、脚本或人工提交的知识、Skills、工具、脚本、文件、专家意见和黄金规则。
- `evidencePacks`：可引用证据、来源定位、置信度、权限范围。
- `artifacts`：智能体、脚本或人工操作生成的报告、patch、导出物。
- `tasks`：任务、接力、状态、负责人、阻塞项。
- `observations`：操作者声明观察到的事实，不自动成为公共事实。
- `proposals`：对公共空间的修改建议。
- `decisions`：经过确认的团队事实或治理决定。
- `memoryEntries`：运行时辅助记忆，可加载、压缩、过期，但不等于 evidence。
- `operationLedger`：所有状态变更的可回放记录。
- `snapshots`：可恢复、可复制、可分支的状态边界。

## 安全原则

安全的本质不是让智能体更听话，而是让智能体永远碰不到不可恢复的最终状态。

因此：

- 智能体不能直接覆盖 canonical state。
- 智能体不能直接写 decision。
- 智能体不能把私有 memory 变成公共事实。
- 智能体不能绕过权限过滤读取 source。
- 智能体不能把只读资产下载、导出、写入 artifact、写入长期 memory 或带到其它 workspace。
- 智能体不能绕过 operation ledger 修改资产。
- 智能体不能直接删除历史，只能提交归档、撤销或恢复事件。

错误的智能体最多只能留下错误 proposal、错误 artifact 或失败 operation。这些都必须可追踪、可撤销、可隔离。

## 状态类型

公共空间里的信息按可信度分层：

| 类型 | 含义 | 是否可作为事实 |
| --- | --- | --- |
| `trace` | 操作者做过什么 | 否 |
| `observation` | 操作者声称看到什么 | 否 |
| `summary` | 对上下文的压缩 | 否 |
| `proposal` | 建议如何修改公共空间 | 否 |
| `artifact` | 产生的文件或结果 | 视验收而定 |
| `evidence` | 可追溯证据 | 是，但受权限和置信度约束 |
| `decision` | 已确认团队事实 | 是 |

新的智能体可以加载 trace、observation、summary 和 proposal 作为工作参考，但它们不能自动升级为 evidence 或 decision。

## 终端贡献型资产

信息源不只来自上游知识库。终端贡献是公共工作空间的第二信息源，甚至很多时候更有效：人类或本地智能体已经过滤、验证、组织、精加工过的信息，往往比原始知识库资产更接近可执行知识。

贡献类型至少包括：

- `knowledge`：整理后的事实、结论、背景材料、证据包。
- `skill`：可复用的 agent skill、提示模板、工作流说明、执行约束。
- `tool`：工具定义、schema、调用说明、权限需求。
- `script`：脚本、批处理、自动化片段。
- `file`：文件、模板、样例、报告、配置。
- `sourceCode`：作为知识、样例、报告附件或非合并材料进入 workspace 的代码内容。
- `codeChange`：需要进入代码仓库评审、patch set、review、submit 或 merge 的代码变更。
- `goldenRule`：黄金规则、最佳实践、强约束。
- `expertOpinion`：专家意见、人工判断、经验性结论。

每个 workspace 必须有固定资产位置：

```text
workspace/
  skills/
  tools/
  scripts/
  files/
  knowledge/
  rules/
  expert-opinions/
```

下游智能体可以选择一个或多个自己有权限访问的 workspace 上传贡献。上传不代表直接发布：贡献先成为 `contribution.submitted`；内容到达服务器并完成最小留档后进入 `preview`；经过权限、风险、许可、重复性和质量检查后，才能进入 `contribution.published` 或 `contribution.rejected`。

贡献不能绕过公共空间治理：

- 贡献知识不自动成为 canonical evidence。
- 贡献 Skill 不自动成为可执行工具。
- 贡献脚本不自动具备运行权限。
- 贡献文件不自动允许其它智能体下载。
- 黄金规则和专家意见必须标明来源、适用范围、置信度和复核周期。

## 代码贡献与 Gerrit 路线

代码贡献不能被简化为普通文件上传。Pact 保留 workspace asset route，同时新增 Gerrit code review route；两条路线由同一个 workspace governance、Operation Ledger 和 Checkpoint Tree 统一治理。

默认路由：

- 源代码文件、patch、git diff、仓库变更和需要合并的修改，优先进入 Gerrit route。
- 代码片段作为知识、教程、证据、日志分析、报告附件或临时草稿时，可以进入 Workspace route，但必须标注为 `sourceCode`，不能默认获得可合并语义。
- Gerrit 不可用、目标仓库未登记、权限不足或策略要求人工确认时，Pact 可以创建 `proposalFallback`，把 patch/diff 暂存为受控 proposal 或 artifact，并记录 `fallbackReason`。

Gerrit route 的治理对象是 `codeChange`：

- `repositoryId`、`branch`、`localWorktreeRef`。
- `commitRefs`、`changeId`、`gerritChangeUrl`、`patchSetRefs`。
- `reviewStatus`、`submitStatus`、`routeDecision`、`fallbackReason`。
- `policyDecision`、`operationId`、`checkpointNodeId`、`auditId`。

边界：

- Gerrit 负责代码 diff、patch set、review comment、submit 和 merge。
- Pact 负责权限、路由、审计、贡献统计、状态同步、workspace 关联和 fallback。
- 智能体不能直接获得裸 `git push` 能力；只能通过受控 `workspace.code.change.upload` 或等价操作发起 Gerrit review。
- 代码 review 结果必须回写为 workspace projection，使管理者能在同一个 workspace 里看到文档资产、知识贡献、代码 change、测试报告和任务状态的关联。

这个设计确保客户端需要上传代码文件时优先被引导到 Gerrit，同时不牺牲 workspace 的资产治理、审计和恢复能力。

## 排行榜与统计面板

Pact 用排行榜和统计面板管理贡献，而不是只依赖后台人工整理。

排行榜指标：

- `contributionCount`：提交次数。
- `acceptedCount`：通过审核次数。
- `usageCount`：被使用次数。
- `uniqueWorkspaceAdoptions`：被多少 workspace 采用。
- `skillExecutionCount`：贡献的 Skills / 工具 / 脚本被调用次数。
- `permissionRequestCount`：被请求授权次数。
- `permissionGrantCount`：授权通过次数。
- `reuseSuccessRate`：复用后成功率。
- `rollbackCount`：因错误或风险被回滚次数。
- `maintenanceFreshness`：维护新鲜度。

排名不是单纯鼓励数量，而是鼓励可复用、可审计、可维护、低风险的资产贡献。被频繁使用但高风险、回滚多或维护过期的贡献必须降权。

统计面板至少展示：

- workspace 贡献趋势。
- 贡献者排行榜。
- 热门 Skills / 工具 / 文件 / 规则。
- 请求授权队列。
- 使用次数和失败次数。
- 资产复用路径。
- 待维护、待复核、待撤销资产。

## 资产贡献统计报表

资产贡献统计报表是管理者视角的核心能力。因为 Pact 管的是公共空间，管理者必须能看到公共空间是否真的沉淀了团队资产，而不是只看到某个智能体完成了一次任务。

报表必须回答：

- 哪些 workspace 贡献最多、复用最多、回滚最多。
- 哪些贡献者贡献了高价值知识、Skills、工具、脚本、文件、黄金规则和专家意见。
- 哪些资产被最多智能体、最多 workspace、最多任务复用。
- 哪些资产被频繁请求授权，但仍未开放。
- 哪些资产下载多、使用少、失败多或回滚多。
- 哪些资产长期无人维护，应该复核、降权或撤销。
- 哪些贡献来自上游知识库再授权，哪些来自终端智能体上传，哪些来自人工整理。

报表维度：

- 时间窗口：day、week、month、quarter、自定义范围。
- 空间范围：tenant、workspace、source group、asset collection。
- 贡献者：subject、agentProfile、operatorKind、team。
- 资产类型：knowledge、skill、tool、script、file、goldenRule、expertOpinion。
- 使用动作：read、copyToContext、download、install、execute、export、checkout、share。
- 治理状态：submitted、preview、reviewed、published、adopted、deprecated、revoked。
- 风险状态：敏感度、失败率、回滚率、过期状态、维护新鲜度。

第一版报表可以先做简单汇总：

```text
assetContributionReportV0 =
  acceptedCount
  + usageCount
  + uniqueWorkspaceAdoptions
  + permissionGrantCount
  - rollbackCount
```

报表不是为了刷榜，而是为了让管理者判断公共空间的资产沉淀质量、复用效率和治理风险。排行榜可以从报表中派生，但报表比排行榜更重要。

## 贡献授权

其它人或智能体可以请求贡献者、workspace owner 或资产管理员授予权限，把贡献资产交给其它智能体使用。

授权请求必须说明：

- 请求方 subject / agent profile。
- 目标 workspace。
- 目标资产。
- 请求动作：read、copyToContext、export、checkout、execute、fork、install。
- 用途、有效期和风险等级。

授权通过后必须生成：

- `contributionGrant`
- `loanRecord`
- `knowledgeAccessReceipt` 或对应资产访问 receipt
- `auditId`

贡献者可以撤销、降级或要求重新审核授权。已经被借走的资产必须保留 loan record 和撤销策略；不能因为文件已经被下载就失去审计。

## 演示场景：OpenClaw 文档互通

目标：证明两个本地 OpenClaw 可以通过 Pact 公共工作空间交换文档资产，而不需要两个 Agent 直接互调。

前提：

- 两个 OpenClaw 都安装访问本项目的 Pact MCP service。
- MCP service 只暴露 workspace、knowledge、asset、contribution 和 audit 工具。
- 两个 OpenClaw 都有目标 workspace 的门禁卡，但权限可以不同。

流程：

1. A 端 OpenClaw 选择一个本地文档，调用 `workspace.contribution.submit`，贡献类型为 `knowledge` 或 `file`。
2. Pact 在真实内容到达服务器并完成最小留档后创建上传记录、内容对象、资产快照、`contribution.submitted`、`contribution.previewed` 和 `auditId`，资产状态进入 `preview`。
3. 策略引擎检查敏感度、许可、重复资产和默认授权范围；审核通过后进入 `contribution.published`，并按权限进入 `workspace/knowledge/` 或 `workspace/files/` 的可见集合。
4. B 端 OpenClaw 调用 `workspace.file.list` 或带 `workspaceId` 的 `knowledge.search` 查找这个 workspace 中可见的文档。
5. B 请求下载时，Pact 校验 B 是否具备 `export` 或 `checkout` 权限；通过后生成 `knowledgeAccessReceipt`、`loanRecord`、transfer id 和 `auditId`。只有内容真实传完并校验成功后，才生成 `asset.downloaded`。

闭环标准：

- A 不需要知道 B 是谁。
- B 不需要直接访问 A 的本地文件系统。
- 文档是否可见、可读、可下载、可借走，由 workspace 权限决定。
- 资产可以被快照、溯源、恢复、复制和撤销。
- 所有下载、借走、失败和拒绝都必须进入审计。

## 演示场景：Skill 贡献排行榜

目标：证明终端贡献可以记录 Skill Hub 技能的来源、采用、下载、使用和贡献值增长，但技能包本体、版本、发布状态和启用状态必须由独立 Skill Hub / skill library 管理。

流程：

1. A 通过 `pact.skillHub.upload` 上传 Skill manifest、说明、执行约束和必要文件；内容到达服务器后进入 capability package lifecycle。
2. A 设置默认可见策略，例如同 workspace 内主体默认允许 `read`、`install` 和 `use`。
3. Pact 扫描 Skill 的权限需求、脚本风险、依赖和许可；通过后进入 Skill Hub / SkillLibrary 的 `published` 状态，并向贡献面板和排行榜候选池写入引用记录。
4. Workspace contribution 只能保存 skill library record 引用、来源、审核、采用和统计信息，不能保存技能包文件、版本、发布状态或启用状态。
5. B 在面板中看到该 Skill，也可以通过 Pact MCP service 调用 `pact.skillHub.list` 发现它。
6. B 下载、安装或调用该 Skill 时，Pact 按真实完成阶段记录 `skill.downloaded`、`skill.installed` 或 `skill.used`，同时生成 `loanRecord` 和 `auditId`。
7. A 的 `usageCount` 增加，排行榜刷新。

Skill 路由治理证据（兼容入口约束）：

- `pact.skillHub.upload` 是技能包的真实入口，技能包必须进入 capability package lifecycle 与 SkillLibrary，再形成 `published` / `active` / `disabled` / `revoked` 状态。
- `workspace.skill.upload`、`workspace.skill.list`、`workspace.skill.download`、`workspace.skill.usage.report` 保持兼容 operation，不能直接持有技能包文件、版本、发布状态和启用状态；它们只反映来自 SkillHub 的可见引用或调用统计。
- `workspace.skill.list` 的资产治理证据应覆盖到 `workspace contribution` 层的引用关系（来源、审核、采用、统计）与 SkillHub 层事实（版本、状态、生命周期）双轨一致。

第一版贡献值算法保持简单，但以真实使用质量为主：

```text
rankScoreV0 =
  usageCount * successRate
  + uniqueWorkspaceAdoptions
  - rollbackCount
```

其中 `usageCount` 是被确认下载、安装、执行、复制到上下文或跨 workspace 采用的次数，`successRate = successfulUseCount / max(usageCount, 1)`，`uniqueWorkspaceAdoptions` 表示去重后的 workspace 采用数，`rollbackCount` 表示因为该资产导致的回滚或撤销次数。`acceptedCount` 继续作为资产贡献统计报表字段，但不主导排行榜。后续再引入风险等级、维护新鲜度和跨 workspace 权重。

## 五阶段本机 MCP 落地路径

这条路径是近期实现顺序，不单独维护实施文档。它把 OpenClaw 与 Hermes Agent 放到同一个受管公共工作空间里，验证资产互通、知识访问、Skill 贡献、权限拒绝和文件回档。

本轮一次性覆盖五阶段：

- MCP 文件互通。
- 知识贡献和访问。
- Skill 上传与共享文件修改。
- 授权封锁。
- Checkpoint Tree 回档。

设备级 MCP Hub 的安装目标包括：

- OpenClaw
- Claude Code
- Codex
- Gemini CLI
- Antigravity
- OpenCode
- Copilot
- Kilo Code
- Cursor
- Hermes Agent
- Windsurf

五阶段演示的首批真实 agent 固定为：

- A：`orbstack - kate - openclaw`
- B：`orbstack - serena - hermes agent`

演示工作空间固定为：

```text
build/demo-workspaces/mcp-agent-collab/
```

Demo 数据允许清空重建。第一阶段到第三阶段默认给两个 subject 打开 workspace owner-like demo 权限，先跑通协同链路；第四阶段再收紧到资产级授权；第五阶段展示回档。

最小身份模型：

| 字段 | A | B |
| --- | --- | --- |
| `subjectId` | `demo.subject.openclaw` | `demo.subject.hermes` |
| `operatorId` | `orbstack:kate:openclaw` | `orbstack:serena:hermes-agent` |
| `agentProfileId` | `demo.agent.openclaw` | `demo.agent.hermes` |
| `workspaceId` | `demo.workspace.mcp-agent-collab` | `demo.workspace.mcp-agent-collab` |

阶段总览：

| 阶段 | 名称 | 核心验收 |
| --- | --- | --- |
| 1 | MCP 服务 + 本机工作空间 | A/B 都能通过 MCP 上传示例文件，并下载对方文件。 |
| 2 | 知识贡献 + 知识授权 | 本项目介绍文档入库打底，A/B 能通过 MCP 贡献和获取授权知识。 |
| 3 | Skills 上传 + 工作空间操作 | A 上传 Skill；A/B 都能通过 MCP 修改同一个示例文件并形成操作记录。 |
| 4 | 授权管控 | A 私有文件对 B 拒绝；A 私有知识对 B 完全不可见；权限递进可解释。 |
| 5 | 文件树回档 | A 改一次、B 改一次；管控台可回到 A 后状态，再回到 A 前状态。 |

通用要求：

- MCP service 是智能体正式接入面，但不是事实源。Workspace API、Operation Ledger、permission decision、Checkpoint Tree 和 storage metadata 才是事实源。
- 每个 MCP tool 必须先解析 subject / operator / agentProfile / workspace，再做 policy evaluation，然后写 Operation Ledger，最后执行文件、知识、Skill 或 checkpoint 操作。
- Checkpoint Tree 必须从第一阶段开始写入。即使第五阶段才展示回档，前面阶段的上传、下载、读取、列表、发现、权限检查、receipt 查询和修改也要成为可回放证据。
- 知识与回档必须复用核心能力：知识走现有 KnowledgeCore / `knowledge.search`，文件树回档用 git-backed workspace 加产品封装，不另做只服务演示的旁路系统。
- 管控台必须跟着阶段走：文件资产列表、知识访问记录、Skill 使用、权限策略、不可见过滤统计、Checkpoint Tree、restore preview 和 restore action 都要能逐步看到。
- 先用本地 mock MCP client 验证，再安装到设备级目标智能体；OpenClaw（OrbStack Kate）和 Hermes Agent（OrbStack Serena）是首批真实 OrbStack 验收目标，真实安装后保留人工演示记录。验收报告必须显式标记 `verificationMode=mocked|verified`，mock 结果不得计入真实完成率。
- 如果 HTTP 或 stdio 某一侧的真实 agent 兼容性和本地 mock 结果不一致，优先修 MCP adapter，不降级为 agent 直连文件系统。

Agent 安装策略：

- 统一服务端入口：connector 扫描本机 Pact 候选服务并通过 `/api/mcp/handshake` 验证签名后，使用 discovery 返回的 HTTP MCP URL；OrbStack VM 内使用 discovery 返回的 VM advertised URL。
- 统一按 Stitch MCP 形态安装：HTTP MCP endpoint + 客户端侧认证 metadata / headers；Pact 的 API key header 是 `X-Pact-Api-Key`，值为 Tool Management grant token；Codex CLI 使用其标准 bearer token env var，服务端同时接受 bearer 和 header。
- 终端用户安装不得依赖完整服务端 checkout；统一通过 `pact-mcp-connector` release 包扫描本机 Pact 服务并验证签名，再运行 `npx pact-mcp-connector@latest install` 进入 TUI 选择要连接的客户端。安装器默认向已验证的本机 Pact 申请 Tool Management grant token 并写入客户端配置；脚本化场景默认使用 `--target auto`，需要限制范围时才指定 `--target <client>` 或逗号分隔的目标清单，`--token-stdin` 只用于预先签发的自定义 grant。显式服务端地址必须先通过 `server-config --set --url <Pact>` 验证并保存。
- 一行安装脚本优先使用已有 Node.js 20+ 下载小体积 source tarball；没有 Node.js、npm、npx 或包管理器的智能体宿主机必须 fallback 到 portable zip release 包：`pact-mcp-connector-<version>-<platform>.zip` 内置 Node runtime，提供 `./pact-mcp install` TUI、`./pact-mcp install --target <client>` 和 macOS `install.command`。
- stdio proxy：仅作为目标 agent 不支持 HTTP MCP 或 headers 时的未来兼容入口；当前 release 安装路径默认不启用 stdio。
- OpenClaw：通过 VM / remote 环境内 `openclaw mcp set` 写入已发现 HTTP endpoint。
- Claude Code：通过 `claude mcp add-json` 或等价 CLI 配置写入。
- Codex：通过 `codex mcp add --url --bearer-token-env-var` 安装；如需兼容旧版 CLI，可再尝试 `codex plugin marketplace add` 与 `codex plugin add`（失败不影响主流程）。
- Gemini CLI：通过 `gemini mcp add --transport http --header X-Pact-Api-Key` 安装，同时生成并校验 Stitch extension 同构 manifest。
- Antigravity：按官方 `~/.gemini/antigravity/mcp_config.json` 的 `serverUrl` + `headers` 格式结构化写入。
- OpenCode：按 `~/.config/opencode/opencode.jsonc` 的 remote MCP 配置格式结构化写入。
- Copilot：通过 `copilot mcp add --transport http --header X-Pact-Api-Key` 安装。
- Kilo Code：按 Kilo 标准 `~/.config/kilo/kilo.json` 的 remote MCP 配置格式结构化写入。
- Cursor：按 Cursor MCP settings 的 `mcpServers.pact` 结构化写入。
- Hermes Agent：通过 VM / remote 环境内 `hermes mcp add --url --auth header` 安装，安装器随后用 Hermes config helper 启用并执行 `hermes mcp test`。
- Windsurf：按 `~/.codeium/windsurf/mcp_config.json` 的 `mcpServers.pact` 结构化写入。
- 所有 installer 修改前必须生成目标配置回滚副本，只追加或替换 `pact` 条目，不打印完整 agent config，避免泄漏现有 token、API key 或 bot token。

实现默认约束：

- 可以改 repo 代码、package scripts、server-web、demo build 目录。
- 验证通过后可以生成配置回滚副本，并修改两个 OrbStack 智能体的 MCP 配置。
- Demo workspace 可以清空重建；真实 agent 原配置只允许生成回滚副本后追加 Pact 配置，不做破坏性重写。
- MCP 服务端只实现当前验收需要的标准 JSON-RPC 方法和 Streamable HTTP 最小面；目标客户端安装必须走 `pact-mcp-connector` release 包，不得靠人工手写配置。`server:mcp:install` 只作为服务端开发者本机调试入口。

### 阶段一：MCP 服务 + 本机工作空间

目标：证明两个不同架构的本地智能体可以通过 Pact MCP service 操作同一个受管工作空间，不通过本地路径互相复制。

最小工具：

```text
workspace.info
workspace.file.upload
workspace.file.list
workspace.file.download
workspace.audit.query
workspace.checkpoint.tree.list
```

流程：

1. 初始化 `build/demo-workspaces/mcp-agent-collab/`。
2. A 上传 `openclaw-note.md`。
3. B 上传 `hermes-note.md`。
4. A/B 都能 list 两个文件。
5. A 下载 `hermes-note.md`，B 下载 `openclaw-note.md`。
6. 管控台或 API 能看到两个上传、两个下载、对应 audit 和 checkpoint node。

验收标准：MCP 返回包含 `assetId`、`operationId`、`checkpointNodeId`、`auditId`；服务重启后 workspace asset list 仍然存在。

### 阶段二：知识贡献 + 知识授权

目标：复用现有 KnowledgeCore / `knowledge.search` 能力，把本项目介绍文档作为第一批知识打底，再让两个智能体通过 MCP 贡献和访问知识。

第一批 seed knowledge：

```text
title: Pact 简介
content: 可控的智能体协作空间。Pact 面向多个本地智能体提供公共工作空间、资产治理、权限控制、审计和可回档能力。
source: README.md
```

随后可以逐步导入 `README.md` 和五份核心设计文档，但首轮演示只要求介绍文档成功入库和读取，避免知识返回过大。

最小工具：

```text
knowledge.contribution.submit
knowledge.search
knowledge.evidence.get
knowledge.access.receipt.list
```

默认流量控制：

```text
maxDocuments: 3
maxEvidence: 5
maxChars: 4000
defaultSummaryChars: 800
```

验收标准：A/B 都能通过 MCP 获取 `Pact 简介` evidence；每次访问都产生 `knowledgeAccessReceipt` 和 `auditId`；返回结果受流量限制。

### 阶段三：Skills 上传 + MCP 操作工作空间

目标：证明 Pact 不只交换文件和知识，也能让智能体贡献可复用能力，并通过 MCP 操作公共工作空间。

本阶段只做低风险 Skill：不执行任意 shell，不下载外部依赖，只作为带 manifest 的 Skill Hub 技能包。workspace contribution 只能引用该技能包并记录采用/统计视图。文件修改先做文本 read/write/patch，不做自动冲突合并。

最小工具：

```text
pact.skillHub.upload
pact.skillHub.list
pact.skillHub.download
pact.skillHub.usage.report
workspace.file.read
workspace.file.write
workspace.file.patch
workspace.operation.history
```

示例文件：

```text
shared-notes/demo.md
```

初始内容：

```markdown
# Demo Shared Note

Initial state.
```

流程：A 上传 `append-workspace-note` 示例 Skill；B 发现并下载或标记使用；A 追加 `OpenClaw update`；B 追加 `Hermes update`；A/B 读取同一文件看到两次修改。

验收标准：Skill 作为 workspace asset 入库；B 的下载或使用增加 usage event；Operation history 能区分 A 操作和 B 操作。

### 阶段四：授权管控

目标：在前三阶段链路跑通后关闭默认全开放权限，验证 Pact 的安全价值。

文件授权流程：

1. A 上传 `openclaw-private.md`，policy 设置为 only A。
2. A 下载成功。
3. B 请求同一 asset id。
4. Pact 返回权限错误，包含 `auditId`，不返回文件内容。
5. 管控台显示 B 的 denied request audit。

知识授权流程：

1. A 贡献 `openclaw-private-knowledge.md` 到 AgentLibrary。
2. policy 设置为 only A，B 为 `deny`。
3. A 搜索相关关键词，能看到并获取 evidence。
4. B 搜索同样关键词，结果为空或只有其它授权知识。
5. B 的响应不出现该知识标题、摘要、source id 或 withheld refs。
6. 管控台管理员视角能看到过滤统计和 denied/filter audit。

权限递进关系：

| 权限层级 | 含义 | 允许行为 | 禁止行为 |
| --- | --- | --- | --- |
| `deny` | 完全不可见 | 无 | 发现、读取、下载、写入、引用 |
| `discoverOnly` | 可见存在 | 列表中看到脱敏标题或类型 | 读取正文、下载、写入 |
| `metadataOnly` | 可看元数据 | 查看 owner、时间、类型、摘要级元数据 | 读取正文、下载、写入 |
| `controlledView` | 受控阅览 | 在 Pact 受控会话内查看内容，不是读取本机原路径 | 下载、导出、写 memory、复制到外部 |
| `copyToContext` | 可进入本次上下文 | 放入本次 context bundle | 写长期 memory、导出、跨 workspace 迁移 |
| `exportAllowed` | 可导出 | 生成 artifact/export | 未授权跨 workspace 传播 |
| `checkoutAllowed` | 可带走 | 下载、复制、迁移 | 绕开 loan record 和撤销策略 |
| `writeAllowed` | 可写 | 修改或追加目标资产 | 修改未授权范围 |

知识搜索必须在检索前过滤。对于 `deny` 的知识，B 搜索时不返回条目、不返回 withheld title、不返回“有内容但无权限”。文件下载可以返回明确权限错误，因为 B 是在请求已知 asset id；知识搜索必须完全不可见。

### 阶段五：文件树回档能力

目标：证明安全不是依赖智能体不乱改，而是所有操作都在可快照、可溯源、可恢复的公共空间里发生。

实现必须复用统一 Checkpoint Tree 的产品语义。底层可以复用 git worktree / tree / diff 能力，产品层不能暴露裸 `git reset --hard`。

最小能力：

```text
workspace.checkpoint.tree.list
workspace.checkpoint.restore.preview
workspace.checkpoint.restore
workspace.operation.history
```

示例文件：

```text
shared-notes/rollback-demo.md
```

初始状态：

```markdown
# Rollback Demo

Base.
```

流程：

1. 记录初始 checkpoint：`C0`。
2. A 追加 `OpenClaw line`，形成 checkpoint：`C1`。
3. B 追加 `Hermes line`，形成 checkpoint：`C2`。
4. 管控台选择 `C1`，点击恢复到此节点。
5. 文件回到只包含 `OpenClaw line`、不包含 `Hermes line` 的状态，形成 restore checkpoint：`R1`。
6. 管控台再选择 `C0`，点击恢复到此节点。
7. 文件回到初始状态，形成 restore checkpoint：`R2`。

验收标准：`C0 -> C1 -> C2 -> R1 -> R2` 都在 Checkpoint Tree 中可见；恢复动作本身也是 append-only operation；管控台可以直接完成两次恢复。

### 第一轮任务拆分和验证入口

第一轮任务按下列 P0 包推进：

- `P0-A Device MCP Hub Shell`：新增 Stitch 形态 HTTP `/mcp`、agent-specific grant/token、统一本机入口 `pact-mcp discover-local`、canonical registry `~/.pact/mcp/servers.json`、`/.well-known/pact/mcp.json` 和 `pact-mcp-connector` release discovery publisher；stdio proxy 仅作为兼容兜底；release 包默认注册共享 Hub，不批量写入客户端；OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf 只有在用户明确 opt-in 时才写入对应配置；对外 MCP tool surface 收敛为单一稳定工具 `pact.call`，内部 operation 通过参数路由。
- `P0-B Local Workspace Store`：初始化 demo workspace，建立 asset metadata，文件上传落盘，下载走 asset id。
- `P0-C Operation Ledger + Checkpoint Node`：每个 MCP operation 写 ledger，文件上传、下载、读取、修改都写 checkpoint node。
- `P0-D Knowledge Seed + Search`：写入 `Pact 简介` seed knowledge，暴露 knowledge contribution/search/evidence，返回先做硬限制。
- `P0-E Permission Policy`：支持 asset policy set/check、文件下载拒绝、知识搜索预过滤和 denied/filter audit。
- `P0-F Checkpoint Restore`：支持 checkpoint tree list / restore preview / restore，restore 生成新 checkpoint，管控台支持点击恢复。

后续验证入口：

```text
npm run server:mcp:discover
npm run server:mcp:doctor
npm run server:verify:mcp-release
npm run server:verify:mcp-http
npm run server:verify:mcp-demo
npm run server:verify:mcp-workspace-demo
npm run server:verify:mcp-knowledge-demo
npm run server:verify:mcp-permission-demo
npm run server:verify:checkpoint-restore-demo
```

`server:mcp:doctor` 必须输出设备级发现清单、HTTP endpoint、VM endpoint、stdio proxy、target 安装状态、`initialize` / `tools/list` 单工具校验 / `tools/call pact.call(operation=system.health)` 结果、版本变更推送能力和 OrbStack 连通性。每个验证脚本必须输出参与 agent identity、workspace 路径、asset ids、MCP tool call 结果、operation ids、checkpoint node ids、audit ids、成功样例和拒绝样例。真实安装后还必须补一份人工演示记录，证明不是只在 mock client 中通过。

## 资产门禁模型

公共工作空间的知识资产以 `AgentLibrary / 图书馆` 形式治理，而不是一个默认向智能体敞开的文件夹。

- 门禁卡：`workspace.enter`
- 楼层：`sourceGroup.read`
- 书架：`catalog.discover` / `metadata.read`
- 图书：`asset.read` / `evidence.read`
- 阅览室：`controlledView`，即 Pact 受控会话内查看，不代表 Agent 获得文件系统路径或长期副本。
- 借走：`checkout` / `export`
- 借阅登记：`knowledgeAccessReceipt` / `loanRecord`

读权限和带走权限必须分开。某些资产可以让智能体在受控上下文中读，但不能取走；取走包括下载原文、导出、复制到 artifact、写入长期 memory、放入其它 workspace 或发送给未授权模型。

资产操作必须能表达：

- `deny`
- `discoverOnly`
- `metadataOnly`
- `controlledView`，即受控阅览。
- `citeOnly`
- `copyToContext`
- `exportAllowed`
- `checkoutAllowed`

这些是内置标准模式，用于跨 workspace、MCP 工具和控制台的互操作。具体 workspace 可以通过 policy 增加自定义 `accessMode` 或 action，但必须映射回内置出口动作，保证审计、receipt、loan record 和拒绝策略可解释。

高敏感资产默认不允许 `exportAllowed` 和 `checkoutAllowed`。如果需要让智能体参考，应优先使用 `controlledView`、脱敏 evidence 或私有模型路径。

从图书馆带走或知道的每一项信息都必须登记：

- `knowledgeAccessReceipt` 记录智能体实际知道了哪些 info refs。
- `loanRecord` 记录哪些内容被允许保留、导出、复制或跨 workspace 使用。
- denied request audit 记录所有被拒绝的借阅尝试。

没有借阅许可的内容不能通过换接口带走。search、evidence、context bundle、artifact、export、distillation、memory、tool call 和 evaluation sample 都必须共用同一套 AgentLibrary 裁决。

## 上游知识库隔离

外部知识库是 workspace asset 的上游资产源，不是下游智能体的直接依赖。Pact 可以把外部知识库拿进来做信息切分和再授权，但智能体只能操作 Pact 派生出来的 workspace asset。

隔离要求：

- 下游智能体不能持有上游知识库 token。
- 下游智能体不能看到上游私有对象路径、collection id、索引 id 或裸 source id。
- 上游材料进入 Pact 后必须生成 `upstreamKnowledgeRef`，再映射到 Pact 自己的 asset/evidence id。
- Pact 必须能对同一份上游材料切出不同的 `derivedKnowledgeSpace`。
- 不同 subject / workspace / agent profile 读取的是不同 `authorizationOverlay`。
- 某些内容可以允许人看，但不允许智能体看。
- 某些内容可以允许智能体以 `controlledView` 受控阅览，但不允许 checkout/export。

这使 Pact 与外部知识库不会撞型：外部知识库负责保存或检索上游资产，Pact 负责把这些资产变成下游可治理、可快照、可审计、可恢复的工作空间资产视图。Pact 允许对上游知识库执行 live proxy 或 `controlledView`；但凡是要进入 evidence、context、receipt、cache、export 或可复用资产的内容，都必须把真实返回内容或授权派生视图写入 Pact 的内容存储。

因此，上游知识库的信息和资源权限再分配是 workspace asset governance 的核心能力，而不是外部连接器的附属功能。连接器只负责把上游资源带进来；Pact 必须负责重新切分、重新授权、重新登记、重新审计和在需要时撤销下游借阅。

## 演示场景：上游知识库 A/B 权限再授权

目标：证明上游知识库进入 Pact 后，不再按上游粗粒度权限直接暴露，而是由 Pact 在公共工作空间里做本地再授权。

流程：

1. Pact 从上游知识库获取某个文件，并为它建立 `upstreamKnowledgeRef`、Pact asset id、evidence id 和 `derivedKnowledgeSpace`。
2. 管控台展示这个派生资产及其权限覆盖层。
3. 管理员在管控台配置：A 对该文件具备 `read` / `export` / `checkout` 中的授权动作；B 对该文件为 `deny`。
4. 对话页面中，A 请求获取这个文件。系统返回授权范围内的文件、派生视图或 evidence pack，并记录 `knowledgeAccessReceipt`、`loanRecord` 和 `auditId`。
5. 对话页面中，B 请求获取同一文件。系统返回权限错误，或按策略隐藏存在性；无论哪种 UI 表达，都必须写入 denied request audit。

验收标准：

- 管控台能显示 A/B 的不同 `authorizationOverlay`。
- 对话页能证明 A 成功、B 被拒绝。
- B 的权限错误必须是策略裁决结果，不是上游知识库连接失败或检索失败。
- B 不能通过 search、evidence read、context bundle、export、artifact、distillation、memory write 或 tool call 绕过拒绝。

## 统一 Checkpoint Tree

Checkpoint Tree 是公共工作空间的统一状态树，不只是任务队列或文件系统恢复树。

所有的一切都必须进入同一棵树：

- 访问请求：workspace info/list、catalog discover、metadata read、permission check、search、evidence read、asset list/read/download、skill list/download、receipt list、audit query、operation history、checkpoint tree list、restore preview、context bundle、export、checkout。
- 文件变动：create、update、move、delete、archive、restore。
- 知识贡献：submit、scan、review、publish、adopt、revoke。
- 代码贡献：target evaluate、prepare local worktree、upload Gerrit change、link existing change、sync review status、fallback proposal。
- 技能调用：skill list、download、install、execute、usage report。
- 权限裁决：grant、deny、permission request、authorizationOverlay change。
- 上下文暴露：context compile、memory write、distillation input、tool call input。
- 恢复动作：restore preview、restore、revert operation scope、branch、merge。

统一 Checkpoint Tree 的原则：

- 每个进入公共空间边界的行为都形成 `checkpointNode`。
- 读请求第一版全量入树，因为它会产生 receipt、loan record、usage event、denied request audit、贡献统计或上下文暴露记录。不能把 list、discover、metadata、permission check、receipt list、audit query、operation history 或 checkpoint tree list 降级为普通接口日志。
- 全量入树只针对外部可见请求边界。同一次请求内部读取 Ledger、AuditStore、CheckpointTree 或 projection 以构造响应时，不递归生成新的 checkpoint node。
- 文件树只是 checkpoint 的一个 projection；权限、知识 evidence、贡献记录、技能调用、资产统计和审计同样是 checkpoint state。
- 恢复不是删除历史，而是追加新的 restore node。
- 管控台必须能按 subject、agentProfile、workspace、asset、skill、permission、time range 和 event kind 过滤这棵树。

`checkpointNode` 最小字段：

- `checkpointNodeId`
- `parentNodeIds`
- `workspaceId`
- `subject`
- `operatorId`
- `agentProfile`
- `eventKind`
- `effectKind`
- `targetRefs`
- `policyDecision`
- `stateDelta`
- `receiptRefs`
- `auditId`
- `createdAt`

这个设计的安全意义是：智能体可以进入公共空间做事，但它无法制造不可解释、不可追踪、不可回撤的影响。即使它乱读、乱删、乱贡献、乱调用技能，也只是不断在统一 Checkpoint Tree 上追加节点；管理员可以按节点、按范围、按主体或按任务回放和回撤。

## Operation Ledger

所有进入 Pact 受管边界的 operation 都必须进入 Operation Ledger。写入操作、访问请求、权限拒绝、文件变动、知识贡献、技能调用、后台任务、provider side effect 和恢复动作都不是普通接口日志，而是可回放的 workspace / system event。

Operation Ledger 必须由 Operation Scheduling Kernel 写入。HTTP、RPC、CLI、MCP、控制台、worker、provider adapter 和业务 helper 不能自行宣布“真实操作”；它们只能提交 intent envelope 给调度内核。没有内核 accepted / rejected 记录的动作必须拒绝为 `operation_unmanaged` / `operation_not_scheduled`，不能改变状态、调用 provider 或写入资产。

最小字段：

- `operationId`
- `workspaceId`
- `taskId`
- `subject`
- `operatorId`
- `operatorKind`
- `intent`
- `inputRefs`
- `idempotencyKey`
- `policyDecision`
- `dryRunDiff`
- `preSnapshotRef`
- `postSnapshotRef`
- `auditId`
- `createdAt`

Ledger 记录的是业务状态和治理状态变更，不是接口日志。接口日志回答“谁调了接口”；Operation Ledger 回答“公共空间发生了什么变化、谁知道了什么、谁带走了什么、谁被拒绝了什么、为什么变化、如何恢复”。

模块本地 audit、provider ledger、queue event、runtime log 和 trace span 只能作为投影、回执或索引，不能替代统一账本。写操作和外部副作用必须由调度内核先追加 `started` / `pending` ledger entry；账本不可写时，操作必须失败在副作用之前。

## Snapshot Boundary

任何高风险操作都必须先形成 snapshot boundary：

- 批量导入
- 批量解析
- 知识索引重建
- 外部知识库同步
- 资产删除或归档
- proposal 应用
- 大规模 artifact 替换
- 工作空间复制或分支

Snapshot 必须能支持：

- restore
- clone
- branch
- compare
- export
- audit replay

## 演示场景：Checkpoint Tree 安全恢复

目标：证明智能体或成员误删大量工作空间文件时，团队可以通过 Checkpoint Tree 恢复，不需要追着智能体纠错。

流程：

1. A 在工作空间中逐个删除很多文件。
2. 每一次删除都必须进入 Operation Ledger，形成独立 workspace commit，记录 `preSnapshotRef`、`postSnapshotRef`、operation diff、operator、policy decision 和 `auditId`。
3. 多次删除形成一棵 Checkpoint Tree，而不是覆盖式最终状态。
4. 管控台展示 Checkpoint Tree 历史，管理员下滑找到 A 操作之前的节点。
5. 管理员点击“恢复到此节点”。
6. Pact 执行 `workspace.checkpoint.restore`，在 checkpoint tree 中追加 restore marker、`checkpoint.restored` event 和审计范围；如果 checkpoint node 携带 `workspaceFileSnapshot`，文件树 dry-run 与实际恢复由共享空间 `restoreWorkspaceFiles` provider 执行，资产引用或权限视图的回滚继续由对应 owning protocol 执行。
7. A 的误删历史不被删除；恢复本身也作为新 commit 进入 Checkpoint Tree。

闭环标准：

- 恢复不是 `git reset --hard` 式抹历史，而是 append-only restore commit。
- 可以按节点恢复，也可以按 A 的 operation scope 批量回撤本次 A 的所有操作。
- 恢复前必须支持 dry-run diff，展示会恢复、保留、冲突或需要重新索引的内容。
- 恢复后必须重建或校验受影响的 knowledge evidence、asset index、loan record、permission overlay 和贡献引用。
- 管控台必须能展示误删 commit、恢复 commit、操作者、时间、diff、审计和恢复原因。

实现上可以复用 git worktree 的成熟思想：文件 tree、diff、commit graph、checkout-like restore、临时 worktree 预览、branch 和 merge 都是合适的底层能力。边界是：Pact 的 workspace commit 还要覆盖数据库元数据、权限、知识 evidence、贡献和审计；所以 git 可以作为文件状态引擎或预览机制，但不能替代 Operation Ledger 和 Snapshot Boundary。

## Proposal To Decision

默认写操作不直接改公共事实：

```text
observation/artifact/proposal
  -> policy check
  -> review
  -> decision
  -> canonical state update
```

允许自动应用的操作必须满足：

- 低风险
- 幂等
- 可撤销
- 不扩大权限
- 不覆盖 canonical evidence
- 有明确 snapshot

否则必须进入 proposal 审核流。

## Context Compiler

公共工作空间不是把所有历史塞给智能体，而是按任务、权限和上下文预算编译上下文包。

Context Compiler 输入：

- `workspaceId`
- `taskId`
- `operatorProfile`
- `contextBudget`
- `knowledgeScope`
- `memoryScope`
- `outputContract`

输出：

- 当前任务目标
- 已确认 decision
- 可引用 evidence
- 可复用 memory
- 最近 trace 和 open questions
- 允许动作和禁止动作
- 需要回传的 artifact
- 压缩过程和丢弃内容说明

上下文短的智能体拿压缩包；上下文长的智能体可以拿更完整的证据摘要。无论上下文如何编译，最终可信边界仍是 evidence 和 decision。

## 本地智能体接入

本地智能体是 workspace operator。它可以是 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf、脚本型 agent 或人工 CLI。

允许动作使用当前 operation id：

- `agent_workspaces.context.get`
- `agent_workspaces.context_bundle.export`
- `agent_sessions.events.append`
- `workspace.contribution.submit`
- `workspace.file.upload`
- `workspace.file.write`
- `workspace.file.patch`
- `workspace.proposal.create`
- `workspace.contribution.permission.request`
- `knowledge.search`（带 `workspaceId`）
- `workspace.skill.list`
- `workspace.audit.query`

高风险动作使用当前 operation id：

- `workspace.proposal.apply`
- `agent_workspaces.file.delete`
- `workspace.checkpoint.restore.preview`
- `workspace.checkpoint.restore`
- `knowledge.reindex`
- `knowledge.sync`
- `workspace.code.change.upload`

高风险动作必须要求更高权限、confirm、snapshot 和审计。

## 可复制工作空间

工作空间必须可以复制给另一个团队、另一个环境或另一个本地智能体集群。复制包必须包含：

- workspace manifest
- task state
- artifact refs
- evidence refs
- operation ledger
- snapshots
- policy summary
- redaction report

复制包不能包含裸 secret。所有密钥只允许以 `secretRef` 出现。

## 验收标准

工作空间资产治理能力只有在这些路径可验证时才算闭合：

- 创建任务、领取任务、提交 observation、上传 artifact、创建 proposal。
- proposal 经过审核后形成 decision。
- 任意高风险操作前后都有 snapshot。
- 错误操作可以按 snapshot restore。
- 另一个本地智能体可以读取 context bundle 接力工作。
- 所有操作能按 `auditId` 回放。
- 被权限过滤的 source 不进入 context bundle、evidence pack 或导出文件。
