# State Machine Definitions

本目录包含了 Pact 系统的机器可读状态机定义文件（JSON 格式）。

## 文件列表

- `contribution.lifecycle.v1.json`: 资产贡献全量生命周期管理状态机。
- `agentlibrary.loan.v1.json`: 知识借阅记录生命周期状态机。
- `checkpoint.restore.v1.json`: append-only Checkpoint 恢复过程映射状态机。

## 设计原则

1. **矩阵完备性 (Matrix Totality)**:
   每个定义文件必须在 `totalMatrix` 中包含所有的 `State × Event` 组合。如果有未定义的格子，验证器 (Verifier) 将抛出异常。非法转移必须显式定义为 `"result": "illegal_transition"` 并附带 `errorCode`。
   
2. **零副作用核心 (Stateless Core)**:
   状态机定义仅表示纯逻辑状态演变，具体持久化（写入数据库、追加日志）由业务运行时服务在 Policy 裁决通过和 Ledger 启动后执行。

3. **安全规范 (Secret Redaction)**:
   任何定义、注释、Metadata 字段均不得写入真实的密钥或本机绝对路径。

## 定义变更策略 (Versioning)

- **Patch (1.0.X)**: 仅允许修改描述文本、测试元数据、或新增证明义务声明。
- **Minor (1.X.0)**: 新增非破坏性事件，或新增 recoverable 状态。
- **Major (X.0.0)**: 删除状态，改变转移关系（如从非法改为合法），或改变 terminal 状态的出入口规范。
