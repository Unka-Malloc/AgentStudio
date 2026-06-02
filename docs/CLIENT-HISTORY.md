# Pact Client History

**Status:** 历史说明
**Scope:** 旧 Pact 桌面客户端方向与当前替换路线
**Updated:** 2026-06-01

本文统一收敛过去散落在 `client-gui/README.md`、`client-gui/Design.md` 和旧实现
讨论里的客户端历史说明。

当前生效的客户端产品合同是：

- [CLIENT_ARCHITECTURE.md](CLIENT_ARCHITECTURE.md)
- [CLIENT-IMPLEMENTATION-PLAN.md](CLIENT-IMPLEMENTATION-PLAN.md)
- [CLIENT-DESIGN-CONFORMANCE.md](CLIENT-DESIGN-CONFORMANCE.md)

## 之前的客户端是怎么做的

早期 Pact 桌面客户端被设计成一个跨平台 Flutter Console，让用户从本机操作 Pact。
它参考 `Pact Console` 的视觉方向，并采用接近 server console 的信息架构：类似
dashboard 的页面、输入处理、saved states、文件队列、active operations、export
pipeline、logs 和 operational summary。

当时的实现方向包含不少本地重运行时能力：

- Rust daemon 和 GUI bridge，用于承载本地后台工作。
- 文件上传队列、checkpoint upload、可恢复任务提交和导出流程。
- macOS Mail 导入，通过系统 Automation 权限读取 Mail.app 并导出 `.eml`。
- DataConnector 模块，把邮件、文件、云盘、聊天和知识源同步成本地 mirror。
- 通用 server API 面板，用来调用服务端注册的接口。
- Knowledge Graph UI、本地 knowledge mirror、mail index、agent registry 和专家词汇
  等界面。
- local-first retry：服务端不可达时保留本地后台状态，服务恢复后继续提交或同步。

这些探索对桌面打包、本机状态和 Flutter/Rust 跨端集成有价值，但它也让桌面客户端
越来越像第二套 server console，且越来越接近本地业务运行时。

## 为什么改方向

旧方向带来了几个产品和工程问题：

- 它重复了 server console、server scripts、MCP plugins 或 Skills 应该承载的工作。
- 它模糊了 client、agent harness、本地 daemon 和 server API explorer 的边界。
- 它把 Mail、DataConnector、graph、upload queue 和 daemon 等模块拉进默认客户端
  形态，导致打包和发布变重。
- 它让验证变得不精确：旧 UI 仍可残留，即使新客户端已经不需要这些界面。
- 它鼓励兼容探索原型，而不是围绕 Pact MCP 和 Skill 工作流收敛到更小边界。

当前重构是破坏性的：旧客户端不是兼容目标。旧代码只有在明确服务新客户端合同时
才能复用。

## 现在打算怎么做

当前 Pact Client 定位为轻量本地环境管理器。它负责让用户的本地智能体环境可见、
可配置、可回滚，但不变成新的 agent framework。

默认客户端收敛为六个模块：

| Module | 当前责任 |
| --- | --- |
| Agents | 发现支持的智能体目标，展示目标原生配置状态，并支持手动添加目标。 |
| MCP Plugins | 以同级 plugin 方式管理 Pact MCP 和其他 MCP entries，包括状态、更新、修复和回滚触发。 |
| Skill Hub | 作为被动本地仓库存储、校验、隐藏、显示、pin 和暴露 Skills。 |
| Model Forwarding | 通过配置 profile 做薄模型转发，不拥有 planning 或 tool execution。 |
| Activity And Snapshots | 记录本地客户端动作，并为配置写入提供 rollback。 |
| Settings | 配置 known paths、portable data root、server profile 和客户端偏好。 |

新客户端是 CLI-first、GUI-assisted。`client-cli` 承担本地命令面，包括 `targets`、
`mcp config`、`mcp plugin`、`agents pair`、`skill`、`forward`、`activity` 和
`snapshots`。`client-gui` 用六模块桌面 UI 包装这些本地命令。

## 旧能力归位

| 旧能力 | 当前归位 |
| --- | --- |
| Server-console-style navigation | 从默认客户端导航删除。 |
| Rust local daemon | `legacy/dev-only`；不是默认 runtime。 |
| Upload queue 和 checkpoint upload | `legacy/dev-only`；不是默认桌面客户端能力。 |
| macOS Mail import | `legacy/dev-only`；可作为未来 Skill 或 plugin 示例的参考。 |
| DataConnector runtime 和 local mirrors | `legacy/dev-only`；不是默认客户端模块。 |
| Knowledge Graph UI 和 local knowledge mirror | `legacy/dev-only`；不是主客户端界面。 |
| Generic server API panel | 从默认客户端边界删除。 |
| 旧 `local-agents` 和 `agent invoke` 思路 | 替换为 target adapters、pairing、Skill Hub CLI 和 thin forwarding。 |

`client-gui/packaging.modules.json` 是这条分界线的打包记录。默认 package profile
是 `future-client`；旧模块被禁用并标记为 `legacy/dev-only`。

## 文档规则

新的客户端决策应进入本文开头列出的当前生效文档。本文只解释旧方向从哪里来、现在
映射到哪里，不能成为新的架构权威。
