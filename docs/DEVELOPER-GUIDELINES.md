# Developer Guidelines

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: Developer Guidelines.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文档汇总了 Pact 项目的核心开发守则。作为架构说明的补充，它指导所有参与开发的工程师在进行代码编写、重构或设计时应遵循的最高原则。

这些守则是为了防止“过早优化”带来的运维负担，并在保证系统安全、可审计的前提下，让系统能够从早期的小型实验环境平滑扩展到企业级生产环境。

## 1. 架构总纲：逻辑隔离先行，物理拆分延后 (Modular Monolith)

Pact 的目标是从少数几个智能体平滑过渡到企业级规模。但这并不意味着我们要在初期堆砌过度复杂的架构。为防止“过早优化（Premature Optimization）”带来沉重的运维负担（DevOps Tax），所有开发必须遵循 **“逻辑隔离先行，物理拆分延后”** 的模块化单体（Modular Monolith）原则。

- **不盲目引入中间件：** 除非遇到单节点无法解决的硬件瓶颈，否则不要在初期引入 Kafka、Redis、Temporal 等外部中间件。
- **划定“架构虚线”：** 所有的隔离必须在代码逻辑层面完成，保证未来需要物理拆分时（如将解析服务独立拆分为 Worker）代码的改动量降到最低。

## 2. 接口与契约先行 (Interface First)

即使系统早期只是在一个 Node.js 进程里执行同步或简单的异步操作，组件间的交互也必须通过严格定义的领域接口，严禁直接引用内部实例细节或裸调数据库。

- **行为抽象：** 即使是本地方法调用，也必须抽象为如 `TaskQueue.submit(type, payload)` 或 `AgentGateway.invoke()` 的形式。
- **隐藏实现：** 底层实现初期可以是简单的 `setTimeout` 或内存队列。这确保了未来剥离为独立 Worker 服务或引入分布式消息队列时，业务调用方代码无需修改。

## 3. 构建状态存储的“防腐层” (Anti-Corruption Layer)

即使系统初期并发量很低，单节点 SQLite 就能满足所有请求，也**绝不允许**业务逻辑代码直接拼写 SQL 去操作核心的 Checkpoint Tree 或 Operation Ledger。

- **统一网关：** 所有的状态变更和读取记录必须通过统一的领域服务网关（如 `OperationLedger.append()` 或 `AuditLogger.recordAccess()`）进行。
- **拥抱变化：** 这层防腐隔离使得未来能在底层无缝插入内存 Buffer、批量合并（Batch Flush）或更换时序数据库，而完全不会污染上层的业务控制流。

## 4. 事件驱动的本地化 (Local Pub/Sub)

系统架构旨在支持智能体的响应式协同，但在初期不要引入外部的消息中间件或复杂的集群架构。

- **原生替代：** 采用进程内原生事件总线（如 Node.js 原生的 `EventEmitter`）来实现事件驱动。
- **明确 Topic：** 在核心业务路径上（如生成了新的 Checkpoint 或资产权限变更时）发布定义明确的事件 Topic（如 `workspace.asset.updated`）。订阅方在进程内存中监听。
- **预留插槽：** 明确预留出未来切换为外部集中式 Pub/Sub 服务的“架构插槽”。

## 5. 容忍“半自动”，保留“降级口” (Graceful Degradation)

不要为小概率的并发冲突或极端的语义合并场景去设计庞大且脆弱的自动仲裁算法。

- **安全降级：** 在遇到资产并发修改冲突且难以自动解决时，系统应直接降级并抛出 `Merge Proposal` 让流程“挂起”，转交人工或指定的高权限 Agent 处理。
- **保持主干极简：** 保持主干写入流程的极简与安全闭环：`Diff -> 发现冲突 -> 产生 Proposal -> 挂起等待 -> 收到决策 -> Apply`。未来只需在挂起阶段旁路插入更智能的 Reviewer 算法（如 LLM 仲裁）进行静默仲裁，而无需重构系统的核心状态机。
## 6. 核心理念：资产是主体，不信任智能体 (Zero Trust for Agents)

Pact 的核心不是让智能体聊天，而是管理工作空间内的资产。

- **智能体只是外部操作员：** 严禁将智能体（哪怕是最聪明的 LLM）的输出直接作为 canonical fact 写入公共空间。智能体只能提交 intent、observation、artifact 或 proposal。
- **状态的最终裁决权在系统：** 所有的状态变更必须由 Pact 的 Policy Engine 和 Operation Ledger 决定是否落库。

## 7. 权限前置与统一出口 (Source-Level Governance & Unified Egress)

不要依赖 Prompt 去约束智能体不看什么，必须在数据进入系统（切分）和流出系统（出口）时进行硬拦截。

- **源头鉴权：** 所有的知识、文件进入系统后，必须生成基于工作空间和身份的 `authorizationOverlay`。
- **统一出口卡点：** 无论是 search result, evidence read, context bundle 还是 export，所有的“出口”必须调用同一套底层的鉴权逻辑，严禁开发“绕过鉴权直接查数据库”的后门接口。

## 8. 极致的审计：全量行为入树 (Enforce Checkpoints for Everything)

Pact 的生命线是“可回溯、可审计”。

- **读请求也是行为：** 不要认为“只读不写”就不需要记录。在第一版实现中，所有的外部可见读取操作（List, Search, Permission Check）也必须生成 Checkpoint Node。
- **Append-Only 恢复：** 所有的恢复操作（Restore）本身也是一次新的操作记录，严禁提供类似 `git reset --hard` 那样会物理抹除历史记录的危险接口。
