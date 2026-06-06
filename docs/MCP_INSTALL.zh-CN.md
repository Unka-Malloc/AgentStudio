# Pact MCP 发布版安装

Pact MCP 以 GitHub Release connector 包分发。普通用户不需要克隆 Pact 仓库。如果机器已经安装 Node.js 20+，一行安装脚本会使用体积较小的源码包；如果没有 Node.js，则回退到自带运行时的便携包。

## 一行命令

中文安装脚本：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)"
```

英文安装脚本：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.sh)"
```

安装脚本会从 GitHub Releases 下载最新 connector，校验 SHA256，把 connector 安装到 `~/.pact/mcp/connector`，然后打开多选 TUI。机器上有 Node.js 20+ 时使用小体积源码 tarball；没有 Node.js 时下载更大的 portable zip，zip 内置 Node 运行时。

安装器不会假设默认 IP 地址。写入任何智能体配置前，它会扫描本机 Pact 候选服务，获取 MCP discovery，并校验已发现服务身份的 `/api/mcp/handshake` Ed25519 签名。服务端通过验证后，安装器会向本机 Pact 申请 Tool Management grant，并把 token 写入所选客户端配置。正常安装不需要用户手动复制 `PACT_MCP_TOKEN`。

## 按需拉取客户端运行时

MCP connector 不能假设机器上已经存在完整 Pact client。connector 只是最小 bootstrapper：完成 discovery、handshake 和 grant pairing 后，它会向已验证的 Pact 服务端请求裁剪后的 client runtime。

这个拉取是按需的。它不会克隆 Pact 仓库，也不会下载全部客户端功能。connector 会声明自己需要的模块，例如 `upload`、`mcp-local-bridge`、`connectors`、`knowledge-cache` 或 `mail-import`；服务端只返回这次请求需要的 framework、`pact-client-cli`、`clientd`、上传队列、checkpoint upload、本地 bridge 和 transport adapter artifacts。

协议入口：

```text
HTTP POST /api/client-runtime/bootstrap/plan
HTTP POST /api/client-runtime/bootstrap/pull
RPC  client_runtime.bootstrap.plan
RPC  client_runtime.bootstrap.pull
MCP  pact.clientRuntime.bootstrapPlan
MCP  pact.clientRuntime.bootstrapPull
```

首版实现返回 inline manifest bundle，不伪造二进制下载 URL；release/package 发布后再填入真实 artifact URL。connector 必须在启用运行时前校验每个 artifact 的 digest 和签名。随后，大文件和目录上传会通过拉取到的本地 bridge 执行，并复用 `pact-client upload enqueue`、后台队列、上传会话、checkpoint 和断点续传状态。inline MCP payload 只保留为小文本兼容路径。

TUI 操作：

- 使用 Up/Down 或 `j`/`k` 移动。
- 按 Space 选择或取消选择客户端。
- 按 `a` 选择或取消选择全部检测到的客户端。
- 按 Enter 安装已选择的客户端。
- 按 `q` 取消。

安装完成后，connector 会输出精简安装报告，包括已验证 MCP URL、所选客户端、每个客户端的成功或失败状态、token 来源和验证状态。它不会把客户端配置文件完整打印出来。只有脚本需要机器可读详情时才使用 `--json`。

支持的 target 是 OpenClaw（`openclaw`）、Claude Code（`claude-code`）、Codex（`codex`）、Gemini CLI（`gemini-cli`）、Antigravity（`antigravity`）、OpenCode（`opencode`）、Copilot（`copilot`）、Kilo Code（`kilo-code`）、Cursor（`cursor`）、Hermes Agent（`hermes`）和 Windsurf（`windsurf`）。OpenClaw 兼容的 OrbStack 智能体，例如 IronClaw 或 ZeroClaw，会通过同一套 Claw-compatible 扫描发现。

## 选项

只有自动发现找不到目标服务时，才显式指定 Pact 服务端 URL。显式 URL 仍然必须通过签名 handshake 校验：

```bash
PACT_MCP_BASE_URL=http://<host>:<port> \
  /bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)"
```

使用自定义本地安装目录：

```bash
PACT_MCP_INSTALL_DIR="$HOME/.local/share/pact-mcp" \
  /bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)"
```

在 shell 命令后传递 connector 安装参数：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)" -- --no-verify
```

非交互智能体 shell 可以直接使用自动检测模式：

```bash
~/.pact/mcp/connector/current/pact-mcp install --target auto --json
```

`auto` 会安装 connector 能验证到的所有受支持客户端。没有 TTY 且未传
`--target` 的 `pact-mcp install` 也会走同一条自动检测路径，避免智能体脚本
因为缺少交互菜单而直接失败。确实需要先限制到重点智能体客户端时，使用
`--target claude-code,codex,openclaw --json`。

如果智能体需要一条可直接复制执行的 GitHub Release 命令，使用无人值守
auto target 形态。它会覆盖 OpenClaw、Claude Code、Codex、Gemini CLI、
Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf
以及 connector 能验证到的所有其它受支持客户端：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)" -- --target auto --json
```

如果已知要安装的单一客户端，把 `<client>` 替换成任意受支持 target，例如
`openclaw`、`claude-code`、`codex`、`gemini-cli`、`antigravity`、`opencode`、`copilot`、`kilo-code`、`cursor`、`hermes` 或 `windsurf`：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)" -- --target <client> --json
```

如果要优先一次覆盖 Claude Code、Codex 和 OpenClaw：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-install.zh-CN.sh)" -- --target claude-code,codex,openclaw --json
```

管理本机服务端地址 profile：

```bash
~/.pact/mcp/connector/current/pact-mcp server-config --set --url http://<host>:<port> --name local
~/.pact/mcp/connector/current/pact-mcp server-config --switch local
~/.pact/mcp/connector/current/pact-mcp server-config --refresh
~/.pact/mcp/connector/current/pact-mcp server-config --reset
```

`--reset` 会清空本机 connector 的服务端地址配置。下一次安装会重新扫描；如果没有找到签名有效的 Pact 服务，会提供 `skip, manually configure later` 选项。

## 手动便携安装

从 GitHub Releases 下载 `pact-mcp-connector-<version>-<platform>.zip`，解压后执行：

```bash
./pact-mcp install
```

zip 包内置 Node.js 运行时。

## 卸载

中文卸载脚本：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-uninstall.zh-CN.sh)"
```

英文卸载脚本：

```bash
/bin/sh -c "$(curl -fL --retry 3 --connect-timeout 20 -sS https://github.com/Unka-Malloc/Pact/releases/latest/download/pact-mcp-uninstall.sh)"
```

## 验证

```bash
~/.pact/mcp/connector/current/pact-mcp doctor
```

`doctor` 可以在没有 token 的情况下验证 discovery。要验证带认证的 `tools/list` 和 `tools/call`，使用已写入客户端的 token，或传入预签发的自定义 grant：

```bash
PACT_MCP_TOKEN='<issued-token>' \
  ~/.pact/mcp/connector/current/pact-mcp doctor
```
