# Scenario 02: 知识蒸馏

状态：已确认场景草案

## 元数据

### 执行路线

```text
管控台蒸馏入口 -> knowledge distillation operation -> 权限 / 模型 / 知识源检查 -> 蒸馏 job / workflow -> 知识蒸馏 runtime -> 蒸馏结果持久化 -> 结果导出 / 下载 -> audit / trace / report
```

### 涉及模块

#### 接入层

- 管控台知识蒸馏入口、进度视图和结果下载入口。
- Frontend bridge 与 HTTP API。

#### 调度层

- Operation Registry / Dispatcher。
- Console Domain Operation Executor。
- Job workflow、任务状态轮询和导出调度。

#### 安全治理层

- Console Auth、用户角色和 workspace 上下文。
- 知识源读取权限、模型使用权限和导出权限裁决。
- 审计脱敏和高风险导出策略。

#### 业务能力层

- Knowledge Distillation Workbench。
- Knowledge Distillation Runtime。
- 知识源解析、摘要、规则、结果生成和结果导出。

#### 数据与观测层

- 蒸馏 run / stage / result 存储。
- 结果文件、导出包和下载 receipt。
- Audit、Trace、Job 状态和 Report。

## 场景目标

用户从管控台入口发起知识蒸馏任务。Pact 必须完成入口参数校验、权限裁决、模型与知识源配置检查、蒸馏任务执行、结果持久化、结果输出和全链路记录。

```text
管控台入口
-> knowledge distillation operation
-> 权限、模型、知识源检查
-> 知识蒸馏 runtime
-> 任务状态 / 结果持久化
-> 蒸馏结果导出或下载
-> audit / trace / job / report
```

## 链路要求

- 管控台必须能发起蒸馏、查看进度、查看失败原因和下载结果。
- 蒸馏输入必须受知识源、workspace、用户角色和模型使用权限约束。
- 蒸馏运行状态必须可恢复查询，不能只存在于前端内存。
- 蒸馏输出必须有稳定结果 ID、文件或导出 URL、生成时间、输入摘要和权限快照。
- 失败、取消、重试、导出都必须进入 audit / trace。

## 验收口径

- 从管控台发起一次蒸馏任务后，可以拿到可查询的 run ID。
- 任务完成后，管控台可以读取和导出蒸馏结果。
- 未授权用户不能读取或导出不属于自己的蒸馏结果。
- 对同一次任务，job 状态、结果文件、audit 和 trace 能互相对上。
