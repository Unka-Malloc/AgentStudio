# Scenario 05: 技能管理

## Metadata / 元数据

- Last updated: 2026-06-08
- Status: Scenario draft with machine-readable status tracking
- Scope: Scenario 05: 技能管理.
- Staleness check: Scanned on 2026-06-08; scenario live/contract/local status must match docs/scenarios/scenario-implementation-status.json and the latest readiness reports.

状态：已确认场景草案

## 元数据

### 执行路线

```text
智能体 MCP -> pact.skillHub.upload operation -> 身份 / 权限 / 风险裁决 -> 技能包结构校验 -> capability package lifecycle -> 服务端技能库隔离存储 -> 版本 / 发布 / 禁用管理 -> 智能体技能目录刷新 -> audit / trace / receipt
```

### 涉及模块

#### 接入层

- MCP 服务端入口与 `pact.skillHub` 工具。
- Tool Management grant、技能上传调用和能力刷新。

#### 调度层

- Operation Registry / Dispatcher。
- Skill management operation executor。
- 上传、校验、发布和回滚任务调度。

#### 安全治理层

- 智能体身份绑定和用户 / workspace 权限。
- 技能风险策略、危险能力声明和审批流。
- 技能使用 scope、安装授权和禁用策略。

#### 业务能力层

- Skill Hub / Tool Skill Management。
- 技能包 manifest 校验、版本管理和发布状态机。
- 技能库隔离存储、索引和目录刷新。

#### 数据与观测层

- 服务端技能库目录和技能元数据 store。
- 技能版本、来源、启用状态和回滚记录。
- Audit、Trace、Receipt 和使用记录。

## 场景目标

智能体通过 Pact MCP 上传技能到服务端 Skill Hub / 技能库。技能必须单独存放、单独管理，并经过权限、风险和包结构校验后才能发布或使用。workspace contribution 只能保存来源、审核、采用、排行榜和引用关系，不能作为技能包文件、版本、发布状态或启用状态的事实源。

```text
智能体 MCP
-> pact.skillHub.upload operation
-> 身份、权限与风险裁决
-> 技能包结构校验
-> capability package lifecycle
-> 服务端技能库隔离存储
-> 版本 / 发布 / 禁用 / 删除管理
-> audit / trace / receipt
```

## 链路要求

- 技能库不能混入普通 workspace 文件目录或运行时下载目录。
- `pact.skillHub.upload` 是真实上传入口；`workspace.skill.upload` 若继续存在，只能作为兼容别名路由到 Skill Hub / capability package lifecycle。
- 技能包不得只作为 workspace contribution 管理；workspace contribution 只能引用 skill library 记录并承载采用、统计和审核视图。
- 上传必须校验 manifest、入口说明、引用文件和危险行为声明。
- 高风险技能发布或启用必须进入审批链路。
- 技能必须有版本、来源、上传者、适用 workspace、可用状态和回滚记录。
- 智能体只能安装或使用其权限允许的技能。

## 验收口径

- 智能体 MCP 上传技能后，服务端技能库出现独立条目。
- 同一次上传不会只生成 `contributionType: "skill"` 的 workspace contribution；若生成 contribution，也必须包含 skill library record 引用。
- 无效技能包会被拒绝并记录原因。
- 技能启用、禁用、发布、回滚都可追踪。
- 技能使用权限变更后，智能体 MCP 可见能力随之刷新。
