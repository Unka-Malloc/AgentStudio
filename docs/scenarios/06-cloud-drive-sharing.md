# Scenario 06: 云盘共享

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Scenario draft with machine-readable status tracking
- Scope: Scenario 06: 云盘共享.
- Staleness check: Scanned on 2026-06-11; scenario live/contract/local status must match docs/scenarios/scenario-implementation-status.json and the latest readiness reports.

状态：已确认场景草案

## 元数据

### 执行路线

```text
智能体 MCP -> cloud drive operation -> 身份 / workspace / 云盘授权裁决 -> 外部云盘 adapter -> 上传文件到外部云盘 -> provider receipt -> 从外部云盘下载文件 -> audit / trace / sync 状态
```

### 涉及模块

#### 接入层

- MCP 服务端入口与云盘文件工具。
- Tool Management grant、智能体调用路由和连接发现。

#### 调度层

- Operation Registry / Dispatcher。
- Cloud drive operation executor。
- 上传、下载、同步、重试和失败处理。

#### 安全治理层

- 智能体身份绑定、workspace 权限和云盘连接授权。
- 数据等级、外发策略、provider scope 和 token 保护。
- 授权过期、撤销和高风险外发审批。

#### 业务能力层

- Cloud Drive Port。
- iCloud / OneDrive local projection adapter。
- Google Drive / Dropbox contract-mode adapter 和后续 provider 插槽。
- 后续 OAuth / Remote provider file upload / download、etag / version 和 sync 状态管理。

#### 数据与观测层

- 云盘连接配置和 secret-ref。
- Provider receipt、外部文件 ID、hash 和本地落地记录。
- Audit、Trace、Sync state 和 Report。

## 场景目标

智能体通过 Pact MCP 把文件上传到受控云盘投影，并能从该投影下载文件。Pact 必须通过云盘 adapter 处理身份授权、provider mode、同步状态和审计。

v0.0.1 第一版真实可运行范围固定为 iCloud + OneDrive 的本机目录投影。iCloud 通过受控本机 iCloud Drive 路径 / projection 完成真实读写；OneDrive 通过受控本机 OneDrive 同步目录 / projection 完成真实读写。它们都只能声明 `localAdapterVerified` / `localProjectionVerified`，不能声明远端云 API 已同步。Google Drive / Dropbox 可以继续保留 contract-mode 以证明接口合同，但不能算作真实远端云盘完成。

```text
智能体 MCP
-> cloud drive operation
-> 身份、workspace 与云盘授权裁决
-> 云盘 adapter / local projection
-> 上传文件到受控投影
-> 从受控投影下载文件
-> provider receipt / audit / trace
```

## 链路要求

- 云盘连接必须是受管连接，不能让智能体直接持有外部云盘 token。
- 上传前必须检查 workspace、数据等级、外发策略和目标云盘权限。
- 上传返回值必须包含 provider、connectionId、路径摘要、hash、byte count、receipt、audit id 和 checkpoint id；local projection 不得伪造远端 provider id。
- 下载必须记录投影来源、落地位置、hash、权限快照和 provider mode receipt。
- OneDrive v0.0.1 receipt 必须来自本机同步目录读写，并标记 `localAdapterVerified` / `localProjectionVerified`；OAuth + Microsoft Graph remote receipt 是后续目标，只有真实远端上传 / 下载请求才能标记 `remoteLiveVerified` 或 `realE2EVerified`。
- iCloud adapter 不得把用户整盘目录暴露给智能体；公开响应只能返回受控 driveRef、root hash、映射摘要、receipt 和 checkpoint，不返回本机绝对路径。
- OneDrive local projection 也不得把用户整盘目录暴露给智能体；公开响应只能返回受控 driveRef、root hash、映射摘要、receipt 和 checkpoint，不返回本机绝对路径。
- Google Drive / Dropbox 第一阶段只能作为 contract-mode provider；fake provider server 只能作为 CI / contract harness，不能作为产品真实云盘完成口径。
- Provider 失败、限流、断连和授权过期必须明确进入失败状态。

## 验收口径

- 智能体 MCP 可以通过受管连接分别上传同一个最小样例文件到 iCloud 和 OneDrive 的本机目录投影。
- 上传后能从 receipt 定位受控投影路径并追踪 checkpoint。
- 智能体 MCP 可以凭 receipt 下载有权限的 iCloud / OneDrive 投影文件，并校验 byte count 和 hash。
- 未授权外发或下载会被拒绝，并在 audit / trace 中显示原因。
- readiness 报告必须区分 `contractVerified`、`localProjectionVerified` / `localAdapterVerified`、`remoteLiveVerified`、`realE2EVerified`；Google Drive / Dropbox 或 fake provider 的 contract pass 不得提升为真实上传 / 下载完成，iCloud / OneDrive 本地投影也不得提升为远端云 API 成功。
