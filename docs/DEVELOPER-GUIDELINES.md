# Developer Guidelines

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: Developer Guidelines.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

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

## 9. 设计系统：外观方案与语义 Token (Appearance Presets)

Pact 的前端视觉体系采用 **Appearance Preset / 外观方案**，详见 [Design System](DESIGN-SYSTEM.md)。外观方案是本地 UI 展示偏好，不是服务端策略、账号设置、租户配置或审计控制。

- **Preset schema Owner-locked：** `server-web/lib/appearance-preset-config.ts`、`server/platform/common/appearance-presets/appearance-preset-store.mjs`、Web preset runtime facade、Flutter `appearance_preset_config.dart` / `buildPactTheme` 入口、Logo/Banner/Favicon 资产文件均为产品负责人锁定范围；新增配色 JSON 文件只需通过 schema 校验。
- **禁止绕过语义 Token：** 组件必须消费 `var(--bg-surface)`、`var(--text-primary)`、`var(--brand)` 等语义 CSS 变量，Flutter 组件必须通过 `context.pactColors` 读取活动 token。
- **禁止引入模糊效果：** `backdrop-filter: blur()`、`radial-gradient` 装饰背景、半透明 `color-mix` 表面一律禁止。
- **禁止硬编码颜色：** 组件 CSS 中不得出现 `#xxx` 或彩色 `rgba(r,g,b,a)` 形式的颜色值（纯黑纯白透明度除外），必须使用 `var(--token)` 引用。
- **门禁校验：** `npm run server:verify:design-system` 会检查组件色值、禁用视觉模式、配色 JSON schema，以及当前运行配色的可用性；CI 不通过则不允许合入。
- **允许的操作：** 在 `server-web/appearance-presets/` 新增通过 schema 的源码打包配色 JSON 文件、通过 `/api/appearance-presets/import` 导入并持久化到 `.pact-server-data/appearance-presets/`、重新加载 Vue/Vite 与服务端配色 catalog、在现有 Token 基础上新增语义别名（如 `--card-header-bg: var(--bg-subtle)`）、新增使用已有 accent 的按钮变体样式、补充旧本地偏好到新 preset 的兼容迁移。

## 10. 部署验证隔离 (Fresh Container Deployment Testing)

涉及部署、运行时自举、镜像构建、外部服务启动、包管理器安装、平台依赖下载或生产入口配置的测试，必须在全新的容器环境中执行。本机环境只能用于代码路径调试、语法检查或非部署类快速验证，不能作为部署可用性的结论依据。

- **全新环境：** 每次部署测试都应从新建容器或等价的一次性隔离环境开始，不能复用开发机上已有的 JRE、Python、Node.js、包管理器缓存、全局命令或历史数据目录。
- **原生路径验证：** 需要验证安装流程时，应在目标基础镜像内走该平台的原生包管理器、版本管理器或推荐安装路径，确认源码下载后能自举所需组件。
- **服务端持有长任务：** 运行时依赖下载必须由服务端后台任务持有并持久化状态，触发脚本、浏览器请求或一次性容器退出后，服务端仍应继续执行并允许后续轮询。
- **发布渠道优先：** 部署验证优先使用已发布镜像、包、二进制或平台原生安装源；除非目标依赖没有可用发布渠道，否则不应把“从源码构建”作为主要部署路径。
- **结论标注：** 测试报告和人工总结必须区分“本机快速检查”和“全新容器部署验证”。只有后者可以支撑 VPS、Docker、生产部署或运行资源评估结论。
