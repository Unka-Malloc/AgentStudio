# Pact 客户端设计文档审查报告

> 历史归档标注：本文保留为 2026-05-26 的审计证据，不再作为当前客户端支持目标事实源。第一批一等支持目标已经固定为 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf。

审查日期：2026-05-26
范围：新增 7 份设计文档 vs 已有架构/协议/实现

---

## 一、OpenCode 在新客户端设计中完全缺失

CLIENT_ARCHITECTURE.md 列出了支持的目标智能体清单：

> "target-specific adapter flows for tools such as Codex, OpenClaw, Antigravity, Cursor, Windsurf, Gemini CLI, and other supported intelligent agent runtimes"

CLIENT-IMPLEMENTATION-PLAN.md Phase 2 的优先目标同样没有 opencode。而 **opencode 是当前唯一可用的真实 MCP 安装目标**（Codex 也配了但没有真正调用过），且我们的 `mcp:install` 已完整支持。

**影响**：新客户端上线后，已有用户如果只用 opencode，新客户端将不支持他们的场景。

---

## 二、CLIENT_ARCHITECTURE.md 与 SUBSYSTEM-REFACTOR-CHECKLIST.md 的声明显著冲突

**CLIENT_ARCHITECTURE.md 第 63-66 行：**

> "Existing HTTP panels, upload queues, DataConnector pages, Mail import flows, knowledge graph pages, checkpoint views, and local daemon surfaces are implementation assets only. They may be reused as Skills, plugins, or optional developer tools if they fit the new boundaries."

**SUBSYSTEM-REFACTOR-CHECKLIST.md 全文将整个服务端标记为 100% 完成：**

| Claims | Reality |
|--------|---------|
| "pact.workspace-contribution: 已完成" | operation-registry 里 **0 个 contribution 操作** |
| "知识转化 100%" 含 "knowledge.dossier.export / raw-corpus.format.convert" | 上轮审计确认这两个操作**不存在** |
| "策略管理 100%" | 无独立 protocol/operation |
| 全部 11 个架构节点均标记 `[x]` | 多项声称有 verifier 的验收在上轮审计中找不到对应脚本 |

**这是严重的不一致。** CLIENT_ARCHITECTURE.md 说旧能力应降级为 Skill/plugin，SUBSYSTEM-REFACTOR-CHECKLIST.md 却说它们全部 100% 完成且已通过验证。两份文档写在同一天（2026-05-25/26），但给的是两套完全相反的状态。

---

## 三、CLIENT-IMPLEMENTATION-PLAN.md 的配对模型缺少 opencode 的具体路径

Phase 3 定义了配对流程：Agent 必须先在客户端 UI 中配对，才能通过 `pact-client skill get` 获取 Skill。但文档没有描述：

1. **opencode 如何配对？** opencode 不是桌面 GUI 应用，没有"在客户端 UI 配对"的交互路径。当前通过 `opencode.jsonc` 直接写入 MCP token，这在配对模型中算什么？

2. **`skill get` 返回什么？** 文档说返回 `machine-readable metadata/path/package ref`，但 opencode 的 MCP plugin 收到这个怎么用？opencode 期望 MCP server URL，不是 Skill path ref。

3. **过渡策略缺失** — 从当前"MCP token 直接写在 opencode.jsonc"切换到"必须先在客户端 UI 配对才能用"的迁移路径完全没有描述。

---

## 四、V0.0.1-IMPLEMENTATION-PLAN.md 的协议版本不匹配

V0.0.1-IMPLEMENTATION-PLAN.md 第 37 行：

> "状态、缓存、上下文、知识块和 artifact 从 v0.0.1 起按内容寻址和 Merkle state root 建模"

但 CHECKPOINT-ALGORITHM-EVOLUTION-PLAN.md 第 26 行：

> "也不能在 v0.0.1 直接把 RDMA、RoCEv2、显存池做成依赖"

两份文档都在定义 v0.0.1 的范围，但目标不同：
- V0.0.1-IMPLEMENTATION-PLAN 说 v0.0.1 必须有 CAS + Merkle DAG
- CHECKPOINT-ALGORITHM-EVOLUTION-PLAN 说 v0.0.1 先做 LSM-style ingest，Merkle DAG 是"先冻结接口合同"，不是全量工程落地

需要明确：v0.0.1 的 CAS/Merkle 要求到底是"接口合同"还是"可运行实现"？

---

## 五、RESOURCE-OPERATION-INTERFACE-DRAFT.md 定义了 132+ 个新操作，但实现路径不清晰

草案定义了 repo/drive/knowledge 三大域共 100+ 个操作接口，其中：

| 域 | 定义数量 | 注册表中已存在 | 匹配率 |
|----|---------|--------------|--------|
| repo | 24 | ~24 (gerrit/codespace/repo) | 高 |
| drive | 32 | 0 | **零** |
| knowledge | 76+ | 约 50% | 中 |

**核心问题**：

1. **drive 域 32 个操作全部无对应实现**，且 V0.0.1-IMPLEMENTATION-PLAN Phase 4 计划做云盘闭环，但 drive.* 操作完全不在 operation-registry 中。它们是 future plan 还是已设计但未注册？

2. **knowledge 域大量**操作（如 `knowledge.accessPolicy.set`、`knowledge.modelPolicy.set`、`knowledge.connector.set`）声称需要 `knowledge:admin` 权限，但 admin 权限的治理机制是什么？谁有权分配 admin？文档没有回答。

3. 草案顶部说"本地智能体已经能直接执行的普通本地命令，不必重复包装成 Pact MCP 能力"——但第 44-83 行的 `drive.*` 操作覆盖了 `drive.folder.create`、`drive.item.move` 等本地操作，是否违反了这个原则？

---

## 六、薄转发模型与当前实现的矛盾

CLIENT_ARCHITECTURE.md 第 134-153 行定义了 Thin Model Forwarding：

> "Forward a user request to Pact MCP, Pact Server MCP, or a user-configured local agent command. "

但当前 Rust 客户端已有完整的 agent invocation 链（`agent_client.rs` 处理 SSE 流解析、session/project 管理）。CLIENT-IMPLEMENTATION-PLAN Phase 5 说只做"薄转发"：

> "No self-owned agent loop. No planner, tool chooser, hidden scratchpad. "

**矛盾**：现有 `agent_client.rs` 实现了 SSE 流解析和 session 管理，这算不算"agent harness"？是需要移除还是保留？文档没有给出 Rust client 模块的具体迁移清单。

---

## 七、Skill Hub 的协议依赖未落实

CLIENT_ARCHITECTURE.md 第 180-183 行：

> "The Skill schema, protocol fields, and versioning are owned by the server Skill management protocol."
> "The protocol version used by client and server must be explicit."

但 `docs/PROTOCOLS.md` 中没有 `Skill management protocol` 的协议定义。`pact.skill.v1` 在 PROTOCOLS.md 的协议分组表（第 44-66 行）中也不存在。service 端的 `knowledge.skills.*` 操作在注册表中存在，但客户端引用的"server Skill management protocol"口径指向了一个文档中不存在的东西。

---

## 八、文档依赖链断裂

CLIENT-IMPLEMENTATION-PLAN.md 第 14 行说"长期设计结论必须回写到 PROTOCOLS.md"，但：

1. PROTOCOLS.md 缺少 `pact.adapter-protocol.v1`（Target Adapter 协议）
2. PROTOCOLS.md 缺少 `pact.skill-hub.v1`（Skill Hub 协议）
3. PROTOCOLS.md 缺少 `pact.client-pairing.v1`（Agent 配对协议）
4. PROTOCOLS.md 缺少 `pact.client-activity.v1`（客户端活动日志协议）

CLIENT_ARCHITECTURE.md 引用了四个不存在于 PROTOCOLS.md 的协议。

---

## 九、旧能力裁剪的具体清单缺失

CLIENT-IMPLEMENTATION-PLAN.md Phase 0 CP0.3 要求"形成旧能力 reuse inventory"，Phase 6 要求"旧能力按 inventory 迁移"。但整个实施计划中没有实际列出哪些旧模块对应哪种迁移结论。当前只有抽象描述：

> "keep-main / migrate-skill / migrate-plugin / developer-tool / remove"

没有具体的模块名→目标映射表。进入 Phase 6 时，缺乏可执行的判断依据。

---

## 十、SUMMARY：按优先级排列

| 优先级 | 问题 | 影响范围 | 建议 |
|--------|------|----------|------|
| **P0** | OpenCode 在客户端设计中完全缺失 | 用户 onboarding、client verifier | CLIENT_ARCHITECTURE.md 和 CLIENT-IMPLEMENTATION-PLAN.md 的 supported targets 补充 opencode |
| **P0** | SUBSYSTEM-REFACTOR-CHECKLIST 与 CLIENT_ARCHITECTURE 矛盾 | 技术决策：旧能力保留还是降级？ | 统一口径：要么承认 CHECKLIST 是服务端状态（不含客户端），要么在 CHECKLIST 中标注客户端模块独立评估 |
| **P0** | Skill Hub 协议引用空指针 | 客户端 Phase 3-4 无法实现 | 在 PROTOCOLS.md 补充 pact.skill-hub、pact.client-pairing、pact.adapter-protocol 协议定义 |
| **P1** | V0.0.1-IMPLEMENTATION-PLAN 与 CHECKPOINT-ALGORITHM-EVOLUTION-PLAN 对 CAS/Merkle 的范围定义不一致 | v0.0.1 工程范围不清 | 明确 v0.0.1 的算法要求是"接口合同固定"还是"LSM-style ingest 可运行" |
| **P1** | RESOURCE-OPERATION-INTERFACE-DRAFT 中 drive.* 32 个操作没有实现计划 | v0.0.1 Phase 4 无法推进 | 要么标注为 protocol-only draft，要么加入 Phase 4 检查点 |
| **P1** | 薄转发与现有 Rust agent_client 冲突 | Rust client 重构范围不明 | 给出 Rust client 模块的 keep/migrate/remove 清单 |
| **P2** | 配对模型缺少非 GUI Agent (opencode) 的路径 | Phase 3 设计缺口 | 补充终端/CLI Agent 的配对方式说明 |
| **P2** | 旧能力 reuse inventory 仍为空 | Phase 6 无法执行 | 填写具体模块→迁移目标映射表 |
| **P2** | PROTOCOLS.md 缺少 4 个客户端引用的协议 | 协议文档一致性 | 补充或改为引用 CLI contract 而非不存在的协议号 |
