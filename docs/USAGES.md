# Pact Usages

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Script and command-line usage, separated into server and client.
- Staleness check: Checked against `package.json`, `server/scripts/`, `client-cli/src/bin/pact-client.rs`, and `client-gui/scripts/` on 2026-06-16.

## 服务端

### 本机开发

```bash
npm install
npm run server:setup-runtime
npm run start:all
```

控制台默认地址是 `http://127.0.0.1:7228/`。

### Docker 本机启动

```bash
docker compose up -d
```

容器端口映射为 `7228:7228`，生产环境禁止直接裸露 HTTP 端口。

### 开发联调

```bash
npm run start:all -- --dev
```

开发模式同时运行后端 API 与 Vite HMR。`npm run dev:web` 只启动前端开发服务器。

### 生产监听

```bash
npm run server:start:public
```

该命令监听 `0.0.0.0:7228`。生产部署必须配置 HTTPS 反向代理、受控网段或隔离子网、运行态密钥管理、审计归档和备份恢复。

### 服务端常用脚本

| 命令 | 用途 |
| --- | --- |
| `npm run server:start` | 启动服务端。 |
| `npm run server:start:minimal` | 以 minimal profile 启动。 |
| `npm run server:start:client-local -- --runtime-config PATH` | 启动客户端本机 sidecar runtime，要求 explicit config。 |
| `npm run server:console` | 启动控制台服务。 |
| `npm run server:auth` | 管理控制台认证。 |
| `npm run auth:rotate` | 生成 owner 新密码。 |
| `npm run server:doctor` | 运行服务端诊断。 |
| `npm run server:locate` | 定位存储路径。 |
| `npm run server:reconcile` | 修复文件与 SQLite 元数据不一致。 |
| `npm run server:rebuild-metadata` | 重建元数据索引。 |
| `npm run server:runtime-downloads` | 启动 runtime dependency download 服务。 |
| `npm run server:mcp:doctor` / `npm run mcp:doctor` | 诊断 MCP 安装与发现。 |
| `npm run server:mcp:release` | 生成 MCP release 包。 |
| `npm run pact:create-module` | 创建模块模板。 |
| `npm run server:module:contract-test` | 验证模块合同。 |

### 统一 CLI

```bash
npm run cli -- health
npm run cli -- settings get
npm run cli -- jobs list --limit 20
npm run cli -- search --query 合同
npm run cli -- rpc --method GET --path /api/healthz
npm run cli -- rpc-call jobs.list --params '{"limit":20}'
```

上传目录并等待结果：

```bash
npm run cli -- --path ./mail-folder --wait --output-result result.json
```

### 外部凭据初始化

真实 token 只能写入运行态 secret store。默认数据目录可用以下命令确认：

```bash
node server/scripts/resolve-server-data-dir.mjs
```

Gerrit 示例：

```bash
printf '%s' "$PACT_GERRIT_HTTP_PASSWORD" | \
  npm run cli -- secret gerrit init \
    --base-url https://gerrit.example.com \
    --username svc-pact \
    --http-password-stdin \
    --mode live
```

外部知识蒸馏服务先跑门禁：

```bash
npm run server:verify:external-knowledge-distillation-service-gates
```

### 验证

| 场景 | 命令 |
| --- | --- |
| 文档治理 | `npm run server:verify:docs-governance` |
| 服务端核心回归 | `npm run server:verify` |
| Headless API | `npm run server:verify:headless` |
| 上传与 checkpoint | `npm run server:verify:checkpoints` |
| 存储运维 | `npm run server:verify:ops` |
| Tool Management | `npm run server:verify:tool-management` |
| ACP Relay | `npm run server:verify:acp-agent-relay` |
| 外部服务注册 | `npm run server:verify:external-service-api-registration` |
| 状态机 | `npm run server:verify:state-machines` |
| 版本治理 | `npm run server:verify:version-registry && npm run server:verify:version-naming` |

## 客户端

### Flutter GUI

```bash
npm run client:get
npm run client:analyze
npm run client:test
npm run client:run:macos
```

### 客户端打包

```bash
npm run client:package:plan
npm run client:build:macos
npm run client:install:macos
npm run client:build:linux
npm run client:build:windows
```

macOS 构建产物：

```text
build/client-gui/runnable/macos/release/PactClient.app
```

`npm run client:install:macos` 会优先复用已安装的 `Pact Client.app` 位置；识别依据是
macOS bundle id `com.pact.client`，会检查当前运行的客户端、`/Applications`、
`~/Applications` 和 Spotlight 结果。找不到已有安装时默认目标是
`/Applications/Pact Client.app`；需要强制用户级开发安装时设置
`PACT_CLIENT_INSTALL_DIR="$HOME/Applications"`。安装时会按 bundle id 请求正在运行的
Pact Client 退出，再替换 app。

### Native sidecar 测试

```bash
npm run client:native:test
npm run client:verify
```

### `pact-client` 常用命令

支持目标为 OpenClaw、Claude Code、Codex、Antigravity、OpenCode、Copilot、Kilo Code、Cursor 和 Hermes Agent；命令参数使用对应 target id。

```bash
pact-client model profiles list
pact-client model profiles set local --command codex --args '["exec"]'
pact-client mcp config plan --target opencode --base-url http://127.0.0.1:7228
pact-client mcp config apply --target opencode --base-url http://127.0.0.1:7228 --token "$PACT_MCP_TOKEN"
pact-client mcp config rollback --target opencode --snapshot-id SNAPSHOT_ID
pact-client skill list --agent codex
pact-client skill get review-skill --agent codex --json
pact-client conversations list --agent codex
pact-client mobile relay config get
```

### 客户端本机 runtime

服务端源码存在本机时，构建 client-local runtime：

```bash
npm run server:build:client-local
```

启动时必须传入 runtime config：

```bash
npm run server:start:client-local -- --runtime-config /path/to/client-local-runtime-instance.json
```

GUI supervisor 对应 sidecar 命令：

```bash
pact-client local-runtime ensure \
  --source-root /path/to/Pact \
  --preset-config /path/to/Pact/server/platform/common/composition-management/client-local-runtime.preset.json \
  --port 17328

pact-client local-runtime status
pact-client local-runtime logs --tail 200
pact-client local-runtime restart
pact-client local-runtime stop
```

### 客户端验证

| 场景 | 命令 |
| --- | --- |
| GUI 静态检查 | `npm run client:analyze` |
| GUI 测试 | `npm run client:test` |
| Rust sidecar 测试 | `npm run client:native:test` |
| 客户端架构门禁 | `npm run client:verify:architecture` |
| 目标适配门禁 | `npm run client:verify:targets` |
| MCP 插件门禁 | `npm run client:verify:mcp-plugins` |
| 全量客户端门禁 | `npm run client:verify` |
