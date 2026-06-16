# Development Runbook

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained runbook
- Scope: Development standards, feature-item design standards, testing, validation, release gates, and documentation governance.
- Staleness check: Checked against package scripts, verification scripts, documentation governance verifier, current docs layout, and release/version scripts on 2026-06-16.

## 开发规范

### 代码事实优先

- 文档结论必须能追溯到当前代码、manifest、config、operation registry、state-machine definition 或 verifier。
- 历史过程文档、阶段计划、审计旧报告和 TODO 草稿不能作为当前事实源。
- 新功能先明确 owning module，再修改 operation、API、UI、docs 和 verifier。

### 模块边界

- 公共平台层不得反向依赖 specialized 业务模块。
- HTTP adapter、console controller、event bus、storage、work queue 和 verifier 不持有业务事实。
- 外部服务、agent framework 和 model provider 都是边界对象，不能被当作可信内部模块。

### 功能项说明规范

每个功能项至少说明：

- 目标
- 输入
- 处理
- 输出
- 错误/拒绝路径
- 持久化或审计要求
- 验证入口

功能项不得只写实现计划；尚未实现的内容必须写入 `docs/IMPLEMENTATION-GAP.md`，不能写成当前功能。

## 测试验证

### 服务端

| 变更范围 | 最小验证 |
| --- | --- |
| 文档 | `npm run server:verify:docs-governance`, `git diff --check` |
| 运行时/API | `npm run server:verify:headless` |
| Operation / dispatcher | `npm run server:verify:dispatcher-unified`, `npm run server:verify:protocol-operations` |
| 上传/job/checkpoint | `npm run server:verify:checkpoints` |
| 存储运维 | `npm run server:verify:ops` |
| Knowledge | `npm run server:verify:knowledge` plus focused knowledge verifier |
| Tool Management | `npm run server:verify:tool-management` |
| ACP Relay | `npm run server:verify:acp-agent-relay` |
| 外部服务 | `npm run server:verify:external-service-api-registration` |
| 安全/授权 | `npm run server:verify:security-hardening` and focused verifier |
| 状态机 | `npm run server:verify:state-machines` |
| 版本 | `npm run server:verify:version-registry`, `npm run server:verify:version-naming` |

### 客户端

| 变更范围 | 最小验证 |
| --- | --- |
| Flutter UI | `npm run client:analyze`, `npm run client:test` |
| Rust sidecar | `npm run client:native:test` |
| 目标适配 | `npm run client:verify:targets` |
| MCP 插件 | `npm run client:verify:mcp-plugins` |
| Skill Hub | `npm run client:verify:pairing-skill-cli` |
| 薄转发 | `npm run client:verify:thin-forwarding` |
| 全量客户端 | `npm run client:verify` |

## 发布门禁

- 发布声明必须基于当前 verifier，不引用历史过程报告。
- 生产部署必须有 HTTPS 反向代理、网络隔离、密钥管理、审计归档和备份恢复策略。
- 版本变更必须更新 `docs/VERSION.md`、`CHANGELOG.md` 和 version registry 中相关 artifact，且证据引用必须存在。
- 外部服务 candidate catalog promote 前必须通过 Tool Adoption Gate、contract verification、egress policy、secret injection、quota/bulkhead、output governance 和 rollback plan。
- 高风险写入、外部副作用、grant 变更和 destructive operation 必须有 approval 或 explicit safety confirmation。

## 文档治理

### 路径规则

| 内容 | 目标路径 |
| --- | --- |
| 架构 | `docs/architecture/ARCHITECTURE.md` |
| 术语 | `docs/TERM.md` |
| 功能模块 | `docs/functionality/*.md` |
| 脚本/CLI 用法 | `docs/USAGES.md` |
| 前端页面和配色 | `docs/DESIGN.md` |
| 兼容目标 | `docs/COMPATIBILITY.md` |
| 智能体引导 | `docs/AGENT.md` |
| 开发规范/测试/发布门禁 | `docs/runbook/DEVELOPMENT-RUNBOOK.md` |
| 版本 | `docs/VERSION.md` |
| 状态机 | `docs/state-machine/STATE-MACHINES.md` |
| 协议 | `docs/protocols/PROTOCOLS.md` |
| 实现差距 | `docs/IMPLEMENTATION-GAP.md` |
| 长期决策 | `docs/adr/` |

### 删除规则

- 历史过程文档必须删除，不保留 `history/` 或 `reports/` 作为当前文档事实源。
- 专业名词必须登记在 `docs/TERM.md`，未登记术语不进入当前文档。
- 计划文档已有实现时，长期决策进入 ADR，操作说明进入 runbook，功能事实进入 functionality，原计划文件删除。
- 横向草案、Checklist、progress summary、dated audit、implementation plan 和 temporary report 不进入 `docs/`。

### Metadata 规则

`docs/` 下每个 Markdown 当前文档必须在 H1 后直接放置：

```markdown
## Metadata / 元数据

- Last updated: YYYY-MM-DD
- Status: ...
- Scope: ...
- Staleness check: ...
```

提交前运行：

```bash
npm run server:verify:docs-governance
```

## 安全规范

- 不提交 secret、token、cookie、OAuth code、grant token、claim token、private key。
- 示例使用环境变量、stdin、`secretRef` 或占位值。
- 对外部服务调用必须记录脱敏 receipt，不保存原始 headers、query、body、stack 或 stream chunk。
- 本机 stdio 不是公开 Pact framework surface；任何 stdio 能力必须通过受控 gateway/adapter 或明确开发模式。
