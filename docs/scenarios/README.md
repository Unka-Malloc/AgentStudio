# Pact Scenarios

本目录记录 Pact 从客户端入口到服务端后端实现的一条条完整链路场景。

这里的场景文档是讨论和拆分用的工作稿，不替代五份核心设计文档。场景中沉淀为长期架构、协议或生产验收口径的结论，最终必须回写到 `Architecture.md`、`PROTOCOLS.md`、`WORKSPACE-ASSET-GOVERNANCE.md`、`KNOWLEDGE-GOVERNANCE.md` 或 `PRODUCTION-CAPABILITY-GAP.md`。

## 场景定义

一个场景必须描述完整链路：

```text
客户端入口
-> 本地连接器 / GUI / CLI / MCP tool
-> 服务端 API / RPC / operation
-> 身份、权限与策略裁决
-> 业务 provider / domain runtime
-> 存储 / 外部服务 / 队列 / workflow
-> ledger / audit / checkpoint / receipt / trace / report
-> 服务端响应
-> 客户端可见结果或后续动作
```

## 当前场景

原始设计目标为 16 个完整链路场景；当前已确认 8 个。未确认的 9-16 保留编号，不在本目录中臆造。

机器可读目录见 [scenario-catalog.json](scenario-catalog.json)。
机器可读状态事实源见 [scenario-implementation-status.json](scenario-implementation-status.json)。
历史实现差距归档见 [SCENARIO-IMPLEMENTATION-GAPS.md](../reports/history/SCENARIO-IMPLEMENTATION-GAPS.md)。

| 编号 | 场景 | 主入口 | 完整链路终点 | 文档 |
| --- | --- | --- | --- | --- |
| 01 | 代码提交 | 智能体 MCP | Gerrit / GitHub | [01-agent-code-submission.md](01-agent-code-submission.md) |
| 02 | 知识蒸馏 | 管控台 | 蒸馏结果输出 | [02-knowledge-distillation.md](02-knowledge-distillation.md) |
| 03 | 权限配置 | 管控台 | 上下游网关拦截生效 + 智能体 MCP 密钥权限刷新 | [03-permission-configuration.md](03-permission-configuration.md) |
| 04 | 工作空间文件传输 | 智能体 MCP | 服务端工作空间文件夹上传 / 下载 | [04-workspace-file-transfer.md](04-workspace-file-transfer.md) |
| 05 | 技能管理 | 智能体 MCP | 服务端技能库单独存放管理 | [05-skill-management.md](05-skill-management.md) |
| 06 | 云盘共享 | 智能体 MCP | 外部云盘上传 / 下载 | [06-cloud-drive-sharing.md](06-cloud-drive-sharing.md) |
| 07 | 日志记录 | 全系统操作入口 | 所有操作记录落账 | [07-operation-logging.md](07-operation-logging.md) |
| 08 | 操作审核 | 智能体 MCP -> Pact MCP 网关 | 高危行为主页审批流拦截 / 审批后放行 | [08-risk-approval-flow.md](08-risk-approval-flow.md) |
