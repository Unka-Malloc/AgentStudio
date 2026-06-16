# Tool Management And Capability Packages

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Tool Management v1, toolsets, grants, scopes, policy, audit, Skill/Playbook management aliases, module ecosystem, and capability package lifecycle.
- Staleness check: Checked against `server/platform/specialized/capabilities/tools/tool-management-core/`, `server/config/entity-config/tools/`, capability package handlers, module ecosystem operations, and verification scripts on 2026-06-16.

## 模块边界

本模块负责把 Pact 能力以受控工具目录暴露给 agent、维护进程和控制台。它不拥有业务事实；每个工具最终映射到 owning operation 或 provider。

## 功能项 TM-01 Catalog 与 Toolsets

| 项 | 设计 |
| --- | --- |
| 目标 | 发布工具目录、按 toolset/profile 解析可见工具。 |
| 输入 | tool manifests、operation registry、grant、profile、scope config。 |
| 处理 | catalog builder 将 operation 映射为 tool，按 scope/risk/profile 投影。 |
| 输出 | `/api/tool-management/v1/catalog`, `/toolsets`, `/toolsets/resolve`, `/profiles`。 |
| 错误 | 未授权工具默认隐藏存在性。 |
| 验证 | `npm run server:verify:tool-management`。 |

## 功能项 TM-02 Grant 生命周期

| 项 | 设计 |
| --- | --- |
| 目标 | 创建、更新、轮换、撤销 Tool Management grant。 |
| 输入 | grant request、scope、toolset、subject、risk、safety confirmation。 |
| 处理 | 只在 create/rotate 返回 token 明文；存储 hash；高风险变更需要安全确认。 |
| 输出 | grant record、token plaintext once、audit、metrics event。 |
| 错误 | grant token 不能作为 Console API credential 使用。 |
| 验证 | `npm run server:verify:tool-management`, `npm run server:verify:security-hardening`。 |

## 功能项 TM-03 工具执行

| 项 | 设计 |
| --- | --- |
| 目标 | 通过 `/execute`、`/dry-run`、`/batch` 调用工具。 |
| 输入 | toolId、input、grant token、console auth 或 internal context。 |
| 处理 | policy evaluate、risk check、operation dispatch、audit 和 output governance。 |
| 输出 | structured result、denied decision、dry-run plan、batch result。 |
| 错误 | policy 拒绝、scope 缺失、risk 超限和 schema 错误返回稳定 envelope。 |
| 验证 | `npm run server:verify:operation-policy`。 |

## 功能项 TM-04 Audit 与 Metrics

| 项 | 设计 |
| --- | --- |
| 目标 | 记录 tool execution audit、metrics summary、health 和 events。 |
| 输入 | tool execution lifecycle、grant changes、policy decisions。 |
| 处理 | 审计不保存 token、raw secret、未授权 payload 或内部 stack。 |
| 输出 | audit list/item、metrics summary/export/health、event stream。 |
| 错误 | audit export 也必须按授权过滤。 |
| 验证 | `npm run server:verify:tool-management`。 |

## 功能项 TM-05 Capability Package Lifecycle

| 项 | 设计 |
| --- | --- |
| 目标 | 管理能力包计划、提交、列表和生命周期。 |
| 输入 | package plan、manifest、submission、lifecycle action。 |
| 处理 | 能力包变更进入 operation、policy、risk、audit 和 lifecycle 状态。 |
| 输出 | package plan、list、submission result、lifecycle transition。 |
| 错误 | 未验证包不能直接进入 active 工具目录。 |
| 验证 | `npm run server:verify:capability-package-lifecycle`。 |

## 功能项 TM-06 Module Ecosystem

| 项 | 设计 |
| --- | --- |
| 目标 | 为 mount/analysis/external module 提供模板、计划、scaffold 和 contract test。 |
| 输入 | module type、template id、sample file、module path。 |
| 处理 | scaffold 只生成模板；contract test 验证 shape 和 sample execution。 |
| 输出 | templates、plan、generated files、contract result。 |
| 错误 | scaffold 不等于注册；注册仍需 operator 配置和验证。 |
| 验证 | `npm run server:verify:module-ecosystem`, `npm run server:module:contract-test`。 |
