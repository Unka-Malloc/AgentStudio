# Pact 使用说明

当前交付形态只有两部分：

- 服务端：`server`
- 薄客户端：`client-gui`

浏览器页面只保留服务端控制台，不再提供旧版桌面工作台。

## 1. 服务端控制台

先启动服务端（推荐一键命令）：

```bash
npm install
npm run start:all
```

默认地址：

```text
http://127.0.0.1:7228/
```

控制台可以直接操作这些内容：

- 基础设置
- 服务发现配置
- 规则库 JSON
- 运行时挂载状态
- 存储摘要
- 任务列表与删除
- 客户端迁移状态

如果服务端要对局域网开放：

```bash
npm run server:start:public
```

## 2. 薄客户端

薄客户端通过 HTTP 连接服务端，不直接承担解析和分析。

构建：

```bash
npm run client:build:macos
```

客户端里只需要填写服务端地址，例如：

```text
http://127.0.0.1:7228
```

## 3. 命令行入口

仓库提供统一 `pact` CLI。安装为 package bin 后可直接调用，也可以通过 npm 脚本调用：

```bash
npm run cli -- health
npm run cli -- --file a.txt --wait
npm run cli -- --path ./local --wait --output-result result.json
```

CLI 对常用 HTTP 接口提供命令别名，并保留通用 RPC 入口：

```bash
npm run cli -- settings get
npm run cli -- jobs list --limit 20
npm run cli -- search --query 合同
npm run cli -- rpc --method GET --path /api/healthz
npm run cli -- rpc-call jobs.list --params '{"limit":20}'
npm run cli -- interfaces --format markdown
npm run cli -- rpc --method PUT --path /api/upload-sessions/id/files/0?offset=0 --raw-file chunk.bin --content-type application/octet-stream
```

`rpc` 支持原始 HTTP 调用参数：`--method`、`--path`、`--body`、`--body-file`、`--raw-file`、`--content-type`、`--header` 和 `--output`。`rpc-call` 调用服务端 JSON-RPC：`POST /api/rpc`。所有命名命令和 HTTP/RPC 映射来自服务端接口注册表。

### 3.1 外部凭据初始化

外部 provider 的真实 token 不写入仓库，也不交给 Agent。开发者和运维通过本地 CLI 把凭据写入 `ServerConfig.getDataDir()` 下的运行态 secret store，同时更新对应 provider manifest。默认数据目录可用以下命令确认：

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

Dify / RAGFlow 示例：

```bash
printf '%s' "$DIFY_API_KEY" | \
  npm run cli -- secret dify init \
    --endpoint https://api.dify.ai \
    --api-key-stdin

printf '%s' "$RAGFLOW_API_KEY" | \
  npm run cli -- secret ragflow init \
    --endpoint https://ragflow.example.com \
    --api-key-stdin
```

云盘 OAuth provider 使用 JSON stdin：

```bash
cat onedrive-oauth.json | npm run cli -- secret onedrive init --oauth-json-stdin
cat google-drive-oauth.json | npm run cli -- secret google-drive init --oauth-json-stdin
cat dropbox-oauth.json | npm run cli -- secret dropbox init --oauth-json-stdin
```

外部知识蒸馏服务按远程容器部署时，容器默认要求 API token，运行数据也必须放在项目目录外：

```bash
mkdir -p "$HOME/.pact-server-data/external-kd"
docker run --rm \
  -p 127.0.0.1:8799:8799 \
  -e PACT_EXTERNAL_KD_API_TOKEN="$PACT_EXTERNAL_KD_API_TOKEN" \
  -v "$HOME/.pact-server-data/external-kd:/data" \
  pact-external-knowledge-distillation:local
```

先跑门禁：

```bash
npm run server:verify:external-knowledge-distillation-service-gates
```

也可以直接走本机 OAuth 跳转。CLI 会监听 `127.0.0.1` 临时回调地址，打开浏览器完成授权，校验 state/PKCE，换取 token 后写入同一个运行态 secret store。云盘应用后台的 redirect URI 需要填 CLI 打印的 `oauthRedirectUri`，或用固定端口提前配置：

```bash
printf '%s' "$ONEDRIVE_CLIENT_SECRET" | npm run cli -- secret onedrive oauth \
  --client-id "$ONEDRIVE_CLIENT_ID" \
  --client-secret-stdin \
  --port 7391

printf '%s' "$GOOGLE_DRIVE_CLIENT_SECRET" | npm run cli -- secret google-drive oauth \
  --client-id "$GOOGLE_DRIVE_CLIENT_ID" \
  --client-secret-stdin \
  --port 7392

printf '%s' "$DROPBOX_CLIENT_SECRET" | npm run cli -- secret dropbox oauth \
  --client-id "$DROPBOX_CLIENT_ID" \
  --client-secret-stdin \
  --port 7393
```

无桌面浏览器或 CI 环境可加 `--no-open`，再手动打开 stderr 中的 `oauthAuthorizationUrl`。如果 provider 后台不接受动态端口，使用 `--port` 固定回调地址，例如 `http://127.0.0.1:7392/oauth/callback`。

云盘连接完成后，Pact 默认使用两层 agent 视图：`default/` 映射到 `.pact-data/<client>`，是当前智能体的可写默认空间；`public/` 映射到 `.pact-data/public`，是所有智能体可读的公共空间。控制台的 Cloud Drive 面板可以开启高级模式并添加只读目录卡片，把用户选定的既有路径暴露到智能体视野中；这些暴露目录默认不可写，真实 token 仍只通过 `secretRef` 留在运行态 secret store。第一版真实云盘验收范围是 iCloud + OneDrive；Google Drive / Dropbox 的 contract-mode 通过不等于真实云盘接通。

等价点号命令也可用，例如：

```bash
npm run cli -- secret.gerrit.init --base-url https://gerrit.example.com --username svc-pact --http-password-stdin
printf '%s' "$GOOGLE_DRIVE_CLIENT_SECRET" | npm run cli -- secret.google-drive.oauth --client-id "$GOOGLE_DRIVE_CLIENT_ID" --client-secret-stdin --port 7392
```

查看已配置的 secretRef：

```bash
npm run cli -- secret list
npm run cli -- secret targets
```

CLI 只在运行态目录写入：

- `secrets/registry.json`：脱敏索引和配置状态。
- `secrets/values/*.json`：0600 权限的本机密钥值。
- `secrets/audit.jsonl`：初始化/更新审计。
- `code-management/codespace-providers.json`、`knowledge/knowledge-backends.json`、`agent-workspaces/cloud-drive-connections.json`：只保存 `secretRef` / `endpointRef`，不保存 token。

配置了凭据只表示 `credentialConfigured=true`。除 Gerrit、OneDrive live verifier 等明确真实验证链路外，contract-mode provider 仍只能报告 `contractVerified`，不能说成真实上传、真实同步或 production ready。

上传文件或目录时，CLI 复用服务端 upload session、checkpoint、分块上传和任务提交链路。示例：

```bash
npm run cli -- \
  --path ./mail-folder \
  --wait \
  --output-result result.json
```

### 3.2 MCP 按需拉取裁剪客户端

MCP 不能假设机器上已经安装了完整 `pact-client-cli` 或后台 `clientd`。正常流程是：最小 MCP connector 先完成服务端发现和握手，然后通过服务端 bootstrap 操作按需拉取裁剪后的客户端运行时。

这不是拉取完整客户端，也不是拉取服务端仓库。客户端必须声明自己需要哪些能力，服务端只返回这些能力依赖的模块。例如只为了 MCP 大文件上传，通常只需要：

- runtime framework
- `pact-client-cli`
- `clientd`
- upload queue
- `mcp-local-bridge`
- HTTP upload session/checkpoint
- 当前机器和服务端同时支持的 transport adapter，例如 `rsync`、`scp`、`sftp`

MCP connector 内部应先请求计划：

```json
{
  "clientUid": "codex-local",
  "client": {
    "os": "linux",
    "arch": "x64",
    "availableCommands": ["rsync", "ssh", "scp", "sftp"]
  },
  "modules": ["upload", "mcp-local-bridge"],
  "transfer": {
    "directory": true,
    "incremental": true,
    "totalBytes": 536870912,
    "fileCount": 200
  }
}
```

对应入口：

```text
HTTP POST /api/client-runtime/bootstrap/plan
RPC  client_runtime.bootstrap.plan
MCP  pact.clientRuntime.bootstrapPlan
```

如果本地缺少客户端运行时，connector 再调用拉取入口：

```text
HTTP POST /api/client-runtime/bootstrap/pull
RPC  client_runtime.bootstrap.pull
MCP  pact.clientRuntime.bootstrapPull
```

`bootstrap.pull` 返回裁剪模块的 artifact refs、版本、digest、签名状态和交付信息。首版实现返回 inline manifest bundle，不伪造二进制下载 URL；后续发布流水线接入后，响应中的 artifact refs 会带上真实下载 URL。connector 启用任何模块前都必须校验签名和 digest，再安装到本机 client runtime 目录并启动 local bridge。之后 MCP 上传大文件或目录时，才通过 local bridge 调用 `pact-client upload enqueue`，复用后台队列、分块、checkpoint 和断点续传。若 transport 选择 `local-copy`，也必须把真实 bytes 深拷贝到 Pact staging/CAS，不能保存共享路径引用或零拷贝引用。

## 4. 邮件导入

推荐输入：

- 装满 `.eml` 的目录
- 装满 `.eml` 的 `.zip`

服务端会：

- 遍历原始邮件
- 保持原文件名和原文件内容不变
- 计算 `sha256`
- 写入对象存储
- 建立邮件、线程、事务、时间线、人物和检索索引

外部邮箱连接器只作为可选入口处理：有可用配置时显示入口，没有配置时不影响 `.eml` / `.zip` / 文件夹导入主流程。

## 5. 本地数据连接器

客户端连接器用于把多应用数据源同步成本地 mirror，再通过上传队列提交服务端。搜索默认不实时访问远端 Gmail、Drive、Slack 或 Teams API。

常用命令：

```bash
pact-client connectors list
pact-client connectors install slack
pact-client connectors enable slack
pact-client connectors auth start slack '{"accountHint":"me@example.com"}'
pact-client connectors sync slack '{"syncBatchId":"client-batch-2026-03","messages":[]}'
pact-client connectors query-local "3 月账单"
```

外部连接器可以按目录包动态安装。包内必须包含 `connector.json`，进程型连接器的 `runtime.kind` 为 `process`，`entrypoint` 指向包内相对路径的可执行文件：

```text
acme-files-connector/
  connector.json
  connector.sh
```

```bash
pact-client connectors install ./acme-files-connector
pact-client connectors enable acme-files
pact-client connectors sync acme-files '{"syncBatchId":"client-batch-2026-03"}'
pact-client connectors query-local "3 月账单"
pact-client connectors health acme-files
pact-client connectors uninstall acme-files '{"removeCache":true}'
```

运行时通过标准输入接收 JSON 请求，通过标准输出返回 JSON。请求包含 `operation`、`providerId`、`params`、`paths` 和 `policy`；`policy.remoteCallsAllowed=false` 表示 `localQuery` 只能查询本地 mirror，不能现场访问远端 API。卸载时如 `uninstallPolicy.removeModuleOnUninstall=true`，客户端会在调用连接器 `uninstall` 钩子后删除 `portable-data/connectors/modules/<providerId>`。

聊天来源写入 `portable-data/chat-index/chat.sqlite`，邮件、网盘文件和知识镜像写入 `portable-data/connectors/cache`。连接器上传到服务端时会携带 `clientUid/sourceType/providerId/externalId/syncBatchId/contentHash/capturedAt/sourceMetadata`，原始文件仍只按 `ClientUID -> SourceType -> FileName` 归档，服务端不向源文件追加检索字段。

## 6. 归一化 DOCX 输出

Pact 当前定位为外部知识库的解析归一中转层，不在本地追加长期知识库模块。任务完成后可以导出：

- `result.json`：任务分析、邮件/事务结构、源文件审计和归一化 DOCX manifest。
- `normalized-documents/*.docx`：面向阅读、归档和外部知识库摄取的多颗粒度 DOCX 文档。
- `normalized-documents/source-materials/*`：仅对 PPT/PDF/HTML 等允许入库的原始材料保留副本；EML/MSG 原始邮件只保留在 raw object 审计存储中。

正式检索不读取 `result.json` 或 upload session manifest。服务端先查 SQLite / 知识库索引，命中 raw object 后再按元数据中的 `storage_rel_path` 打开原始文件。

Markdown 和旧 `knowledge-package` 导出已移除。图片、图表和版式信息必须在 DOCX 中被嵌入或文本化，不能依赖 Markdown 外部图片地址。

读取归一化 DOCX manifest：

```http
GET /api/jobs/:jobId/normalized-documents
```

下载具体 DOCX 或允许输出的原始材料：

```http
GET /api/jobs/:jobId/normalized-documents/:documentId
```

## 7. 适配拆分 DOCX

任务完成后，服务端会在 job 工作目录生成多颗粒度 DOCX：

```text
<userDataPath>/jobs/<jobId>/normalized-documents/
```

默认策略：

- PPT/PDF/HTML：复制原始材料，并生成 deck/document/page/section/block/slide 等 DOCX。
- EML/MSG：不复制原始邮件到知识库目录，只生成 message/thread/transaction DOCX。
- `manifest.json` 记录每个 DOCX 和允许输出的原始材料，可通过 HTTP、RPC 或 CLI 下载。

CLI 示例：

```bash
npm run cli -- jobs normalized-docs --id JOB_ID
npm run cli -- jobs normalized-doc --id JOB_ID --document-id DOC_ID --output out.docx
```

## 8. 文档解析挂载

服务端主链支持挂载式组件。

核心最小构建：

- `Node`
- `SQLite`
- 原始对象存储
- 邮件事务分析链

可选挂载：

- 文档解析器
- OCR
- 外部解析或分析适配器

默认文档解析主线按 `Tika` 设计。

## 9. 校验

服务端回归：

```bash
npm run server:verify
```

客户端回归：

```bash
npm run client:test
```
