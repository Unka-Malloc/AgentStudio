# Pact Desktop Client

Pact Desktop Client 是未来 Pact 本地客户端的 Flutter 桌面壳。客户端产品边界以
[`docs/CLIENT_ARCHITECTURE.md`](../docs/CLIENT_ARCHITECTURE.md) 为准。旧桌面
Console、Mail 导入、DataConnector、上传队列、checkpoint upload、本地 daemon
和 Knowledge Graph 界面都不是默认客户端的兼容目标。

旧客户端之前是怎么做的、为什么改方向、旧能力现在如何归位，统一收敛在
[`docs/CLIENT-HISTORY.md`](../docs/CLIENT-HISTORY.md)。

## 产品范围

客户端现在定位为轻量本地环境管理器。它帮助用户查看和编辑目标原生 MCP 配置，
管理被动本地 Skill Hub，做薄模型转发，并通过 activity 和 snapshot 恢复本地
配置变更。

默认 UI 只有六个一级模块：

- Agents
- MCP Plugins
- Skill Hub
- Model Forwarding
- Activity And Snapshots
- Settings

客户端不拥有 agent harness、planner、tool loop、运行时审批系统、本地业务
daemon、server API console 或通用数据连接器运行时。

## 运行形态

- `client-gui` 提供 Flutter 桌面壳。
- `client-cli` 提供 GUI 和目标智能体共同使用的本地命令面。
- Target adapter 读取或写入目标原生配置文件；目标有官方可脚本化 CLI 时优先
  调用官方 CLI。
- 本地状态使用可读 JSON、JSONL activity 记录和配置 snapshot，存放在客户端
  portable data root 下。
- Pact MCP 作为同级 MCP plugin 管理，不是有特权的 super-plugin。

默认打包由 [`client-gui/packaging.modules.json`](packaging.modules.json)
控制。默认 package profile 是 `future-client`；旧模块标记为 `legacy/dev-only`，
并被默认 package plan 跳过。

## 本地开发

```bash
npm run client:get
npm run client:analyze
npm run client:test
npm run client:native:test
```

本地启动 Flutter 桌面端：

```bash
cd client-gui
flutter run -d macos
```

## 验证

主要客户端门禁：

```bash
npm run client:verify:architecture
npm run client:verify:plan
npm run client:verify:ui-new-architecture
npm run client:verify
```

架构和计划 verifier 会守住破坏性重构边界：默认导航必须保持六个未来模块，旧重
客户端模块不能进入默认构建，deferred 的 Skill Hub 协议工作不能被说成已完成。

## 打包

查看默认 package plan：

```bash
npm run client:package:plan
```

构建 release bundle：

```bash
npm run client:build:macos
npm run client:build:windows
npm run client:build:linux
```

平台说明：

- Windows bundle 需要在 Windows 环境构建。
- Linux bundle 需要在 Linux 或 Ubuntu 环境构建。
- macOS 主机可用 `npm run client:ubuntu:verify` 通过 Docker 执行 Ubuntu
  验证路径。
- 默认 package 只包含未来客户端模块和必要 native sidecar。旧客户端运行时模块
  必须显式按 `legacy/dev-only` 处理，不能进入默认产品包。
