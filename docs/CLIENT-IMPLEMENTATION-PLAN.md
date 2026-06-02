# Pact Client Implementation Plan

更新日期：2026-05-26

本文是 Pact 新桌面客户端的实现路线方案，用于把
`docs/CLIENT_ARCHITECTURE.md` 中的设计边界拆成可执行、可检查、可验收的
开发闭环。

旧客户端的历史脉络统一收敛在 `docs/CLIENT-HISTORY.md`。该文档只解释过去
客户端为什么这样做、现在迁往哪里，不承载新的实现目标。

本文不是新的核心架构文档。本文只定义客户端重构的阶段顺序、接口改造、兼容
目标、检查点和验收门槛。长期设计结论必须回写到：

- `docs/CLIENT_ARCHITECTURE.md`
- `docs/PROTOCOLS.md`
- `docs/Architecture.md`
- `docs/FEATURE-PROFILES.md`
- `docs/TEST-FRAMEWORK.md`

当前 `client-gui` 和 `client-cli` 中已有的 HTTP 面板、DataConnector、Mail 导入、
上传队列、checkpoint、本地 daemon、知识图谱等能力不是兼容目标。新客户端只服从
“带外 MCP 配置管理 + 被动 Skill Hub + 本机 CLI 取用 + 薄模型转发”的设计。
不符合该设计的旧能力必须删除、替换，或迁到 `legacy/dev-only`，且不得进入默认
导航、默认 CLI、默认构建或默认打包计划。

本轮执行以 `docs/CLIENT_ARCHITECTURE.md` 和本文为唯一目标文档。旧实现不能反向
约束新设计；不得为了保守过渡保留 deprecated 转发层。只有测试或发布入口当前
无法拆除时可以临时保留，并必须在 conformance 文档和 verifier 中说明删除计划。

## 1. 修正后的开发模式

| 主题 | 旧客户端倾向 | 新客户端修正 |
| --- | --- | --- |
| 产品身份 | 桌面控制台、任务提交器、本地 daemon UI、数据连接器宿主 | 轻量本地环境管理器、MCP 配置可视化、被动 Skill Hub、薄转发入口 |
| 运行时 | Flutter UI + Rust daemon + 多类业务执行模块 | UI + CLI 优先；只有确有必要时保留极薄本机服务，默认不新增常驻业务 daemon |
| 本机状态 | 可能把客户端状态做成服务端式数据库模型 | 客户端配置量小，使用可读 JSON 文件；活动日志需要追加语义时使用 JSONL，不引入 SQLite 作为默认配置/状态源 |
| 服务端交互 | GUI 直接通过 `server.api` / HTTP 面板调用服务端能力 | GUI 只发起薄请求，复用 Pact MCP、服务端脚本或 MCP 插件能力，不复制业务逻辑 |
| Skill 分发 | 客户端可能执行或管理连接器运行时 | 客户端只存储、校验、版本化、可见性控制和通过 CLI 返回 Skill 元数据/包引用 |
| 权限 | 容易出现客户端授权页或风险标签 | 只做 Hub 配对和可见性控制；运行时审批归执行端点 |
| 目标适配 | 硬编码少量路径和 JSON 写入 | 目标适配器协议化；服务端可下发 adapter capability，本地代码能力变化时发客户端版本 |
| 配置写入 | 直接改文件 | 写前快照、字段级冲突、用户确认、原子写入和可回滚 |
| 验收 | Flutter/Rust 常规测试 | 每阶段有 CLI、配置、快照、冲突、Hub、UI 和打包 smoke 验收 |

### 1.1 实现原则

| 原则 | 要求 | 验收方式 |
| --- | --- | --- |
| 轻量优先 | 不新增 agent harness、planner、tool loop 或本地分析运行时 | 代码审查和 `client:verify:architecture` 禁止相关模块回流 |
| 本机边界 | Skill Hub 取用只走本机 CLI，不开放通用 HTTP/MCP endpoint | CLI smoke 验证无监听端口依赖 |
| 配置事实源 | 目标原生配置文件和 CLI 是事实源 | 外部手改后客户端刷新可见，保存时触发字段级冲突 |
| 强制快照 | 所有目标配置写入前必须快照 | 写入 verifier 检查 snapshot、hash、rollback |
| 字段级冲突 | 配置变化时不整文件覆盖，按解析树字段确认 | UI/CLI 测试覆盖重复字段和不可解析降级 |
| 配对后取用 | 智能体必须先配对，才能通过 Hub CLI 取 Skill | 未配对 `skill get` 返回机器可读 `pairing_required` |
| 完整性强制 | 云端 Skill 校验失败不入库、不展示、不返回 | Skill verifier 注入坏 hash/signature |
| 可追溯 | 配置、配对、下载、pin、隐藏、回滚、转发都有活动记录 | Activity log verifier 覆盖所有事件类型 |
| 协议优先 | adapter/Skill schema 优先由服务端协议下发 | adapter protocol contract test |
| 旧能力可删 | 不符合新边界的旧页面和 daemon 能力可以移出主客户端 | Phase 6 裁剪清单通过 |
| 破坏性优先 | 旧客户端不是兼容目标；默认删除、替换或迁出主线 | `CLIENT-DESIGN-CONFORMANCE.md` 和 verifier 阻止回流 |

## 2. 总阶段计划

| 阶段 | 名称 | 主要链路 | 检查点数 | 阶段完成标准 |
| --- | --- | --- | ---: | --- |
| Phase 0 | 设计和协议基线 | 架构文档 -> 实现计划 -> 旧能力归位 -> 验收脚手架 | 6 | 新客户端边界、模块清单、数据目录、验证命令和裁剪规则固定 |
| Phase 1 | 本机状态底座 | Portable store -> Activity log -> Snapshot store -> Structured config tree | 7 | 所有后续写入、配对、Skill 和转发都有可追溯本机事实源 |
| Phase 2 | 目标发现与适配器 | Known-path scan -> Manual add -> Adapter protocol -> Config write/rollback | 9 | Codex/OpenCode/OpenClaw/Antigravity/Cursor 等目标能安全发现、配置、冲突处理和回滚 |
| Phase 3 | 配对与 Skill Hub CLI | Agent pairing -> Visibility policy -> `pact-client skill ...` | 7 | 已配对智能体可本机 CLI 取 Skill；未配对或隐藏目标被稳定拒绝 |
| Phase 4 | Skill 同步、校验和版本 | Server Skill protocol -> Download -> Integrity -> Version pin | 8 | 云端 Skill 强制校验，本地 Skill 可追溯，多版本和 pin 可用 |
| Phase 5 | MCP 插件生命周期与薄转发 | Pact MCP peer plugin -> Update trigger -> Model forwarding | 6 | 插件生命周期和模型请求均为薄触发，不形成新 harness |
| Phase 6 | 新 UI 与旧能力裁剪 | Six-module shell -> Conflict cards -> Activity views -> Old feature migration | 8 | 主界面切为六模块，旧重能力移出主产品或迁为 Skill/插件/开发工具 |
| Phase 7 | 打包、升级与发布验收 | Client update -> Bundle plan -> Smoke -> Documentation backfill | 6 | macOS/Linux/Windows 包和验证链路按新客户端边界可交付 |

## 3. Phase 0: 设计和协议基线

目标：先把设计边界、旧能力归位和验证脚手架固定，避免一边重构一边把旧客户端
的重运行时带回主产品。

### 3.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Client architecture | `docs/CLIENT_ARCHITECTURE.md` | 固定产品身份、非目标、模块、Hub、配对、权限边界 | 不在实现计划里重新争论架构身份 |
| Protocol backfill | `docs/PROTOCOLS.md` | 补充 client adapter、Skill Hub CLI、pairing、activity/snapshot 协议口径 | 不引入本机 HTTP/MCP Hub endpoint |
| Feature profile | `docs/FEATURE-PROFILES.md` | 定义新客户端 feature flags 和旧能力裁剪配置 | 不把旧 GUI 页面默认归入主产品 |
| Test harness | `package.json`、`tests/run.mjs` | 增加客户端架构和 CLI smoke 验证入口 | 不等 Phase 6 才补测试 |
| Reuse inventory | `client-gui`、`client-cli` | 标记可复用、迁移、删除、待确认能力 | 不因已有实现而保留产品功能 |

### 3.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| Doc | `CLIENT-IMPLEMENTATION-PLAN.md` | 新增 | 客户端重构 | 阶段、检查点、验收命令齐全 |
| Doc | `PROTOCOLS.md` client section | 改造 | pairing、adapter、skill CLI | 协议口径不承诺 HTTP/MCP Hub endpoint |
| Config | `client.feature-profile` | 新增 | 新/旧客户端能力裁剪 | 可声明主产品模块和迁移模块 |
| Script | `client:verify:architecture` | 新增 | 静态守卫 | 禁止 harness/proxy/HTTP Hub 回流 |
| Script | `client:verify:plan` | 新增 | 文档和配置一致性 | 文档引用的 verifier/script 存在或明确待建 |
| Report | client reuse inventory | 新增 | 旧能力归位 | 每个旧页面/服务有 keep/migrate/remove 结论 |

### 3.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP0.1 设计基线 | 新客户端架构和实现路线都进入 `/docs` | `CLIENT_ARCHITECTURE.md` 与本文互相引用且无边界冲突 |
| CP0.2 协议回写 | pairing、Skill Hub CLI、adapter protocol、activity/snapshot 写入协议文档 | `PROTOCOLS.md` 不再只描述旧 client runtime bootstrap |
| CP0.3 旧能力归位 | 形成旧能力 reuse inventory | 每个旧模块有 `keep-main` / `migrate-skill` / `migrate-plugin` / `developer-tool` / `remove` |
| CP0.4 Feature profile | 新客户端主模块和可选迁移模块可配置 | `npm run feature:... --client` 或等价 dry-run 能输出模块裁剪计划 |
| CP0.5 验证脚手架 | 新增客户端架构守卫和计划验证脚本 | `npm run client:verify:architecture --silent` 通过 |
| CP0.6 Phase 0 收口 | 文档、配置、脚手架一起过审 | `npm run client:verify:plan --silent` 通过 |

## 4. Phase 1: 本机状态底座

目标：建立新客户端的本机事实源。后续所有配置写入、配对、Skill 取用、版本 pin、
可见性控制和薄转发都必须落入同一套本机状态、快照和活动日志。

### 4.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Portable store | macOS/Linux/Windows | 使用可读 JSON 文件保存 settings、targets、pairings、skills、pins | 不复用旧重 daemon 状态模型，不引入 SQLite 做客户端配置源 |
| Activity log | JSONL | append-only 记录所有客户端动作 | 不记录智能体取走后做了什么，不用 SQLite 承载客户端日志 |
| Snapshot store | 配置文件快照 | 写前保存原文、hash、metadata、patch summary | 不做整机备份 |
| Config parser | JSON/TOML/YAML/目标自定义格式 | 输出结构化配置树和字段 path | 不用字符串替换改配置 |
| Integrity record | cloud/local Skill | 保存 hash、signature/source、version、local mutation | 不对本地变动默认阻断 |

### 4.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| CLI/Core | `ClientStateStore` | 新增 | `client-cli`、Flutter UI | settings/targets/pairings/skills/pins 以 JSON 可读写 |
| CLI/Core | `ActivityLog` | 新增 | JSONL | 所有动作 append-only |
| CLI/Core | `SnapshotStore` | 新增 | target config writes | 写前快照、rollback lookup |
| CLI/Core | `StructuredConfigTree` | 新增 | JSON/TOML/YAML | 产生字段 path、重复字段、diff |
| CLI | `pact-client activity list` | 新增 | local CLI | 可按 type/target/time 查询 |
| CLI | `pact-client snapshots list/restore` | 新增 | local CLI | 可列出并恢复指定快照 |
| Verification | `client:verify:state-store` | 新增 | Phase 1 | 状态、活动、快照、解析树 contract 通过 |

### 4.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP1.1 数据目录 | 固定新客户端本机数据目录布局 | settings、targets、pairings、skills、pins 使用 JSON；activity 使用 JSONL；snapshots 独立分区 |
| CP1.2 活动日志 | 统一 append-only activity log | 写配置、配对、Skill、转发事件都能记录 |
| CP1.3 快照仓库 | 配置写入前可保存快照 | 快照包含 mtime/size/hash/source path/content |
| CP1.4 结构化解析树 | JSON/TOML/YAML 至少可生成字段 path diff | 重复字段和不可解析文件有明确降级 |
| CP1.5 回滚基础 | CLI 可恢复指定快照 | 恢复前也记录活动事件 |
| CP1.6 完整性记录 | cloud/local Skill 都有 hash 记录模型 | 本地改动被记录为新 mutation，不阻断 |
| CP1.7 Phase 1 验证 | 本机状态底座通过 | `npm run client:verify:state-store --silent` 通过 |

## 5. Phase 2: 目标发现与适配器

目标：让客户端安全识别和配置外部智能体。第一批优先目标为 Codex、OpenCode、
OpenClaw、Antigravity、Cursor、Windsurf、Gemini CLI；后续通过 adapter protocol
扩展。

### 5.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Scanner | known paths、package managers、known config paths | 保守扫描、去重、help/version probe | 不全盘扫家目录，不启动 GUI |
| Manual target | binary/config path picker | 用户手动添加目标 | 不要求所有目标都自动发现 |
| Adapter protocol | server-published capability | target fields、config recipe、compat metadata | 不下发任意代码执行 |
| Local adapter code | parser/prober/platform integration | 目标需要本地能力时随客户端版本发布 | 不让服务端协议绕过安全写入器 |
| Config writer | target-native CLI or structured write | Pact-managed blocks、快照、字段冲突 | 不整文件强制覆盖 |

### 5.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| CLI | `pact-client targets scan` | 新增/替换 `local-agents scan` | known-path scan | 输出 target、confidence、config path、probe result |
| CLI | `pact-client targets add` | 新增 | manual binary/config | 手动目标进入同一状态模型 |
| CLI | `pact-client targets inspect` | 新增 | all targets | 展示 target-native fields |
| CLI | `pact-client mcp config plan` | 新增 | target adapter | 生成结构化写入计划，不落盘 |
| CLI | `pact-client mcp config apply` | 新增 | target config | 快照、冲突检查、写入 |
| CLI | `pact-client mcp config rollback` | 新增 | snapshot store | 回滚指定目标配置 |
| Protocol | `client.adapter.capabilities` | 新增 | server-published adapter | 服务端下发字段和 recipe |
| Verification | `client:verify:targets` | 新增 | Phase 2 | 扫描、手动添加、plan/apply/rollback 通过 |

### 5.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP2.1 保守扫描 | 只扫描允许路径并 probe | 测试证明不启动 GUI、不触发登录、不全盘爬取 |
| CP2.2 手动添加 | 用户可添加 binary/config 路径 | 手动目标参与 inspect/config/pairing |
| CP2.3 Adapter protocol | 服务端能力可下发字段和 recipe | 客户端能展示 target-native 配置字段 |
| CP2.4 Codex adapter | Codex 目标配置可 plan/apply/rollback | 保留其它 MCP server 和 token |
| CP2.5 OpenCode adapter | OpenCode remote MCP 配置可 plan/apply/rollback | 使用 `url`、`headers.X-Pact-Api-Key`、`enabled` |
| CP2.6 OpenClaw/VM adapter | VM endpoint 和配置形态可表达 | 不假设固定 localhost 或固定 VM 地址 |
| CP2.7 Antigravity/Cursor/Windsurf/Gemini adapters | 常见 GUI/CLI agent 配置可表达 | 不启动 GUI 主程序 |
| CP2.8 字段级冲突 | 外部改文件后 apply 进入冲突流程 | 每个冲突字段可单独选择行为 |
| CP2.9 Phase 2 验证 | 目标发现和配置闭环通过 | `npm run client:verify:targets --silent` 通过 |

## 6. Phase 3: 配对与 Skill Hub CLI

目标：建立“我认识这个智能体”的本机身份边界。安装 Pact MCP 或发现目标只代表
可配置；用户在 UI 配对后，智能体才能通过本机 CLI 取 Skill。

### 6.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Pairing store | local paired agents | target identity、pairing status、createdAt、revokedAt | 不做运行时工具审批 |
| Pairing UI | Agents/MCP Plugins | 用户批准/拒绝/撤销配对 | 不自动把安装等同配对 |
| Hub CLI | `pact-client skill ...` | 本机 CLI 取用入口 | 不开 HTTP/MCP Hub endpoint |
| Visibility policy | paired agent -> Skill/version | allow-all default、hide、pin | 不追踪已复制副本 |
| Machine response | agent adapters | JSON 响应 `ok/error/pairing_required/hidden` | 不输出不可解析的人类文本作为唯一结果 |

### 6.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| CLI | `pact-client agents pair request` | 新增 | target adapter/Pact MCP | 创建配对请求 |
| CLI | `pact-client agents pair approve` | 新增 | UI/CLI | 批准配对 |
| CLI | `pact-client agents pair revoke` | 新增 | UI/CLI | 撤销配对 |
| CLI | `pact-client agents list --pairings` | 新增 | UI/CLI | 展示配对状态 |
| CLI | `pact-client skill list --agent <id>` | 新增 | paired agent | 按可见性返回 Skill 清单 |
| CLI | `pact-client skill get <id>[@version] --agent <id> --json` | 新增 | local-only retrieval | 返回机器可读 metadata/path/package ref |
| CLI | `pact-client skill visibility set` | 新增 | hide/reveal | 设置按 agent/skill/version 可见性 |
| Verification | `client:verify:pairing-skill-cli` | 新增 | Phase 3 | 配对、未配对拒绝、隐藏、取用 JSON 通过 |

### 6.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP3.1 配对记录 | target 可创建 pairing request | request 写入 activity log |
| CP3.2 UI 批准/拒绝 | 用户可批准、拒绝、撤销 | 结果影响 CLI 取用资格 |
| CP3.3 未配对拒绝 | 未配对 target 调 `skill get` 被拒绝 | 返回机器可读 `pairing_required` |
| CP3.4 配对后 allow-all | 已配对 target 默认可见全部可用 Skill | `skill list` 返回可见清单 |
| CP3.5 可见性例外 | 用户可对 agent/skill/version hide/reveal | 隐藏后 CLI 不返回可用引用 |
| CP3.6 `skill get` JSON | CLI 返回路径、版本、hash、entrypoint、协议字段 | 不复制、不执行、不安装依赖 |
| CP3.7 Phase 3 验证 | 配对和 Skill CLI 闭环通过 | `npm run client:verify:pairing-skill-cli --silent` 通过 |

## 7. Phase 4: Skill 同步、校验和版本

目标：让客户端作为被动仓库可靠接收云端托管 Skill，也能管理用户本地导入的
local Skill。服务端协议是 schema 事实源，客户端不发明私有 manifest。

### 7.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Server Skill protocol | current server Skill management | list/download/metadata/version/compat | 不创建客户端私有 manifest |
| Cloud download | signed/hash artifacts | 下载、校验、入库 | 校验失败不允许使用 |
| Local import | local path/archive | 标记 local、计算 hash、记录变更 | 本地内容变动不默认阻断 |
| Version store | multi-version Skill | latest、specific version、pin | 不强制只保留 latest |
| Integrity UI | Skill Hub | 展示来源、版本、hash、签名/校验状态 | 不做运行时风险审批 |

### 7.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| CLI | `pact-client skill sync` | 新增 | server protocol | 拉取远端 Skill catalog |
| CLI | `pact-client skill download <id>[@version]` | 新增 | cloud skill | 下载并强制校验 |
| CLI | `pact-client skill import-local <path>` | 新增 | local skill | 生成 local metadata/hash |
| CLI | `pact-client skill pin set` | 新增 | agent/skill/version | 设置版本 pin |
| CLI | `pact-client skill versions <id>` | 新增 | multi-version | 列出版本和完整性 |
| CLI | `pact-client skill delete <id>[@version]` | 新增 | local repository | 删除前检查 pin |
| Verification | `client:verify:skill-integrity` | deferred | Phase 4 | 等 Skill Hub、服务端 Skill Registry、MCP Skill Hub 三方协议完成后再实现；本轮不得伪造通过 |

### 7.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP4.1 协议复用 | 客户端使用服务端 Skill 字段 | 未知兼容字段不丢失 |
| CP4.2 云端强校验 | bad hash/signature/source/version 失败关闭 | 失败 Skill 不入库、不展示、不返回 |
| CP4.3 本地 Skill | 本地导入生成 local hash 和 activity | 内容变化记录 mutation，不阻断 |
| CP4.4 多版本 | 同一 Skill 多版本并存 | `latest` 和指定版本都可解析 |
| CP4.5 Pin | agent 可 pin 指定版本 | `skill get` 按 pin 返回 |
| CP4.6 删除保护 | 删除被 pin 版本前提示/阻断 | 用户确认后记录 activity |
| CP4.7 UI 展示 | Skill Hub 显示来源、版本、校验、可见性 | 不展示假权限标签 |
| CP4.8 Phase 4 验证 | Skill 同步和版本闭环通过 | deferred：三方协议完成后再启用 `npm run client:verify:skill-integrity --silent` |

## 8. Phase 5: MCP 插件生命周期与薄转发

目标：Pact MCP 是 peer plugin。客户端可以展示和触发插件生命周期操作，但不能因为
内置 Pact MCP 就变成特殊宿主或外骨骼。模型转发只做请求转发，不做 agent harness。

### 8.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Pact MCP plugin | peer MCP target | version/status/update/rollback trigger | 不内置离线修复器 |
| Release connector | external package | 插件坏掉时引导外部 release 包修复 | 不私有维护另一套升级链 |
| Model profile | user-configured model endpoint | 保存和选择转发目标 | 不做 agent loop |
| Forwarding command | Pact MCP / Server MCP / local agent command | 传入文本、显示结果、记录 activity | 不做工具选择、规划、长期自治 |
| UI | Model Forwarding module | 轻量输入、目标选择、结果展示 | 不复制服务端业务页面 |

### 8.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| CLI | `pact-client mcp plugin status` | 新增 | Pact MCP / external MCP | 展示 target-native 状态 |
| CLI | `pact-client mcp plugin update` | 新增 | server/MCP operation trigger | 薄触发更新 |
| CLI | `pact-client mcp plugin rollback` | 新增 | server/MCP operation trigger | 薄触发回滚 |
| CLI | `pact-client model profiles list/set` | 新增 | model forwarding | 保存模型转发配置 |
| CLI | `pact-client forward --target <id> --text ...` | 新增 | Pact MCP/local agent | 只转发请求并返回结果 |
| Verification | `client:verify:thin-forwarding` | 新增 | Phase 5 | 无 harness、无本地业务执行、activity 通过 |

### 8.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP5.1 插件状态 | UI/CLI 可显示 Pact MCP peer plugin 状态 | 不把 Pact MCP 当特权宿主 |
| CP5.2 更新/回滚触发 | 更新和回滚走同构 MCP/服务端能力 | 插件坏掉时提示 release 包路径 |
| CP5.3 模型配置 | 用户可配置模型转发目标 | 密钥保存走既有 secret/ref 策略 |
| CP5.4 薄转发 | 可向 Pact MCP/Server MCP/local agent command 转发文本 | 不创建 planner/tool loop |
| CP5.5 活动留痕 | 每次转发记录 endpoint summary | 不记录敏感 payload 时有脱敏策略 |
| CP5.6 Phase 5 验证 | 插件生命周期和薄转发通过 | `npm run client:verify:thin-forwarding --silent` 通过 |

## 9. Phase 6: 新 UI 与旧能力裁剪

目标：把 Flutter 主界面重构为六个一级模块，旧重能力按 Phase 0 inventory 迁移、
下线或隐藏为开发工具。

### 9.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Shell | Agents / MCP Plugins / Skill Hub / Model Forwarding / Activity / Settings | 新 IA 和导航 | 不保留旧控制台式信息架构 |
| Agents UI | targets + pairing | 发现、手动添加、配对状态 | 不展示假风险标签 |
| MCP Plugins UI | target-native config | 配置字段、plan/apply、rollback | 不整文件覆盖 |
| Skill Hub UI | local repository | sync/download/import/pin/hide/get preview | 不执行 Skill |
| Conflict UI | structured field cards | 每字段选择行为 | 不做整文件二选一 |
| Activity UI | local audit | 查看、筛选、定位快照 | 不记录取走后的运行时行为 |
| Legacy cleanup | old pages/modules | migrate/remove/dev-only | 不让旧重功能回流主产品 |

### 9.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| Flutter | New client shell | 改造 | six modules | 导航和布局符合新 IA |
| Flutter | Agents view | 改造 | target scan/manual/pairing | 配对流可操作 |
| Flutter | MCP Plugins view | 改造 | config plan/apply/rollback | 字段级配置和快照可见 |
| Flutter | Skill Hub view | 改造 | sync/import/pin/hide | 不执行、不安装依赖 |
| Flutter | Conflict cards | 新增 | structured config diff | 每字段单独选择 |
| Flutter | Activity/Snapshots view | 新增 | activity/snapshot store | 可查看和回滚 |
| Flutter | Legacy removal | 改造 | old client pages | 旧页面从主导航移除 |
| Verification | `client:verify:ui-new-architecture` | 新增 | Phase 6 | Flutter analyze/test + UI smoke 通过 |

### 9.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP6.1 新 Shell | 六模块主导航落地 | 旧 server-console IA 不再是主入口 |
| CP6.2 Agents/MCP UI | 目标发现、配对、配置计划、回滚可用 | UI 不直接执行业务能力 |
| CP6.3 Skill Hub UI | sync/import/download/pin/hide 可用 | Skill 不被执行 |
| CP6.4 Conflict UI | 字段级冲突卡片可操作 | 不可解析文件默认不覆盖 |
| CP6.5 Activity UI | 活动和快照可筛选、定位、回滚 | 事件类型覆盖前五阶段 |
| CP6.6 旧能力迁移 | 旧 HTTP/DataConnector/Mail/Graph 等按 inventory 处理 | 主产品不再依赖旧重页面 |
| CP6.7 UI smoke | macOS 至少可启动并完成核心流 | `npm run client:run:macos` 手工 smoke 或自动等价 |
| CP6.8 Phase 6 验证 | 新 UI 架构通过 | `npm run client:verify:ui-new-architecture --silent` 通过 |

## 10. Phase 7: 打包、升级与发布验收

目标：按新客户端能力重新收口打包、升级和发布验证。服务端可推送客户端新版本；
adapter 本地代码变化通过客户端版本发布。

### 10.1 阶段总表

| 组件 | 兼容目标 | 开发目标 | 不做 |
| --- | --- | --- | --- |
| Packaging profile | macOS/Linux/Windows | 新客户端模块包、CLI、必要资源 | 不默认打包旧重 runtime |
| Client update | server-driven update | 版本检查、下载、校验、安装提示 | 不绕过签名/完整性 |
| Adapter rollout | protocol + client version | 协议能力下发；本地能力随客户端升级 | 不下发任意执行代码 |
| Verification | `client:verify`、bundle smoke | 全平台基本链路 | 不把 mock 说成真实外部验证 |
| Docs | README/USAGE/TEST-FRAMEWORK | 新入口和旧能力迁移说明 | 不让旧 README 继续描述旧产品身份 |

### 10.2 接口和功能改造表

| 类型 | 名称 | 新增/改造 | 兼容目标 | 验收 |
| --- | --- | --- | --- | --- |
| Config | `client-gui/packaging.modules.json` | 改造 | new main modules | 默认包只含新客户端必需模块 |
| CLI | `pact-client update check/apply` | 新增 | server-driven client update | 校验版本和包完整性 |
| Script | `client:package:plan` | 改造 | new package profile | 输出新模块裁剪计划 |
| Script | `client:verify` | 改造 | new client tests | 汇总 Phase 1-6 verifier |
| Script | `client:ubuntu:verify` | 改造 | Linux bundle | GUI smoke 按新 UI |
| Doc | `client-gui/README.md` | 改造 | new product identity | 删除旧控制台式介绍 |
| Doc | `docs/USAGE.md` | 改造 | user workflows | 增加 pairing/skill CLI/conflict/rollback |

### 10.3 检查点

| 检查点 | 产出目标 | 成功验收 |
| --- | --- | --- |
| CP7.1 打包 profile | 默认包只包含新客户端必需能力 | `npm run client:package:plan --silent` 输出无旧重模块 |
| CP7.2 客户端升级 | 服务端推送版本可检查和应用 | 包校验失败不可安装 |
| CP7.3 Adapter rollout | 协议能力和客户端版本边界清楚 | 需要本地代码的新 target 要求客户端升级 |
| CP7.4 全量验证 | 客户端验证链路聚合 | `npm run client:verify --silent` 通过 |
| CP7.5 跨平台 bundle | macOS/Linux/Windows 打包路径更新 | Linux GUI smoke 和 macOS 手工 smoke 通过 |
| CP7.6 文档回写 | README/USAGE/TEST-FRAMEWORK 更新 | 用户文档不再描述旧重客户端为主产品 |

## 11. 待确认问题

以下问题不阻塞 Phase 0/1，但进入对应阶段前需要拍板：

| 编号 | 问题 | 影响阶段 | 默认建议 |
| --- | --- | --- | --- |
| Q1 | `pact-client skill get` 的 JSON 字段是否固定为 `skillId/version/path/hash/entrypoint/protocolFields/visibility/pairing` | Phase 3 | 固定最小字段，保留 `protocolFields` 承载服务端 schema |
| Q2 | 配对身份是否需要一次性 pairing code，还是 UI 直接批准本机 detected target | Phase 3 | detected/manual target 先生成 request，UI 批准后写 local identity token |
| Q3 | 客户端本机状态是否允许 SQLite | Phase 1 | 已决议：配置和状态使用 JSON，activity 使用 JSONL；客户端默认不引入 SQLite |
| Q4 | 本地 Skill archive 格式是否允许目录、zip、tar.gz 三类 | Phase 4 | 三类都允许，入库后统一生成 hash manifest |
| Q5 | 薄转发是否允许保存 prompt 历史 | Phase 5 | 默认只保存 endpoint summary 和脱敏摘要，完整 prompt 需用户显式开启 |
| Q6 | 旧 Mail/DataConnector/Knowledge Graph 是否迁成官方 Skill 示例 | Phase 6 | 作为迁移示例，但不进入默认主导航 |
| Q7 | Skill Hub、服务端 Skill Registry、MCP Skill Hub 三方协议如何收口 | Phase 3/4 | 本轮只保留本机边界和 `protocol_deferred` 响应，不标记完成 |

## 12. 破坏性重构批次

| Batch | 范围 | 提交主题 | 必须验证 |
| --- | --- | --- | --- |
| 1 | 文档和目标收口；新增 conformance 矩阵 | `docs(client): define destructive client refactor target` | `git diff --check` |
| 2 | 删除 `local-agents` 原型；引入 `targets` CLI 和 GUI API | `refactor(client): replace local agents prototype with target adapters` | Rust CLI 测试、Flutter service/widget 测试 |
| 3 | 首批 target adapter：Codex、OpenCode、OpenClaw、Antigravity、Cursor、Windsurf、Gemini CLI | `feat(client): implement first target adapters` | `client:verify:targets`、`client:verify:config-writes`、Rust 全量测试 |
| 4 | 删除旧 `agent invoke` 主线；新增薄 forwarding | `refactor(client): remove legacy agent invocation path` | `client:verify:thin-forwarding`、Rust 全量测试 |
| 5 | `ClientStateStore`、`ActivityLog`、`SnapshotStore` | `feat(client): add future client state substrate` | `client:verify:state-store` |
| 6 | Pairing 与被动 Skill Hub 本机边界 | `feat(client): add passive skill hub boundary` | `client:verify:pairing-skill-cli` |
| 7 | MCP Plugins peer lifecycle | `feat(client): add peer mcp plugin lifecycle` | `client:verify:mcp-plugins`、OpenCode connector verifier |
| 8 | Flutter 六模块主界面 | `refactor(client-ui): replace legacy shell with future modules` | `client:analyze`、`client:test`、UI smoke 如可用 |
| 9 | 默认 package profile 切到新客户端 | `refactor(client): make future client the default package` | `client:package:plan`、`feature:build:client --dry-run` |
| 10 | verifier 和全量收口 | `test(client): add destructive refactor verification gates` | `client:verify`、package plan、dry-run、Rust/Flutter 全量 |

每批提交前后必须运行 `git status --short --branch` 和 `git diff --check`。每批提交后
推送 `codex/client-destructive-refactor`。未完成协议必须使用 `protocol_deferred`
或文档中的 deferred 状态，不允许把 Skill Hub 三方协议伪装为完成。

## 13. 更新规则

1. 每完成一个 Phase，必须同步更新本文对应阶段状态和验收结果。
2. 每新增或删除一个客户端主模块，必须同步更新 `docs/CLIENT_ARCHITECTURE.md`。
3. 每新增 CLI 或协议字段，必须同步更新 `docs/PROTOCOLS.md`。
4. 每次把旧能力迁移为 Skill、插件或开发工具，必须更新 Phase 0 reuse inventory。
5. 每个 Phase 的 verifier 必须能单独运行，也必须能被 `npm run client:verify` 聚合。
6. 不允许只因为旧代码存在就把能力标记为完成；必须通过对应检查点。
