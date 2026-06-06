# Pact 商业化提升计划

更新日期：2026-06-01

本文用于内部产品、工程和交付决策，不用于未经脱敏的对外宣传。

## 1. 背景和目标

本文对照当前 Pact 仓库的实现、协议文档和验证结果，整理商业化提升计划。核心判断是：Pact 不应被设计成一个新的超级智能体，而应成为所有智能体、客户端、服务和共享空间之间的轻量协作服务层。

商业化目标如下：

- 面向个人用户提供云服务，让用户可以在手机、PC、本地虚拟机、云主机或托管智能体之间共享信息。
- 面向企业用户提供私有化部署方案，允许企业完全脱钩于 Pact 云服务运行完整流程。
- 为所有客户端提供本地优化，让客户端能发现、配置和接入用户已有智能体。
- 让 MCP 插件安装极简化，本地可发现的智能体自动安装，本地不可发现的远端智能体也能通过一条命令自助安装。
- 把共享空间和共享云盘作为核心场景，让多个智能体可以可靠交换文件、上下文、知识、产物、提案和检查点。
- 保持服务尽可能轻、模块尽可能小、性能尽可能好，把服务端成本压低。

## 2. 设计理念提炼

### 2.1 Pact 的产品定位

Pact 的目标不是替代下游智能体，也不是替代上游知识库或业务系统。Pact 应位于中间层，负责把上游能力、下游智能体和用户共享空间连接起来。

对外口径可以收敛为：

- 一个共享服务层：为 PC、手机、云主机、虚拟机和托管智能体提供统一 MCP 接入口。
- 一个共享空间：让不同智能体围绕同一组文件、上下文、知识、产物和检查点协作。
- 一个治理边界：统一身份、权限、审批、审计、流量和成本。
- 一个安装入口：尽量做到一条命令安装、发现、配对、授权和验证。

### 2.1.1 当前商业目标和工程约束

本节记录当前商业目标的硬约束，作为后续实现、验收和对外表达的优先级来源。

- 优化主线必须围绕从云端服务、外部服务、平台网关到下游客户端管理的全链路体验，而不是只优化单点模块。
- 当前集中攻关 `docs/scenarios/` 已确认的 8 个上下贯穿场景；原始 16 个场景中未确认的 9-16 不臆造、不抢跑。
- 知识蒸馏算法本身由独立线程推进；本计划内的知识蒸馏工作只覆盖服务接入、管控台入口、结果授权隔离、审计、导出、成本和可观测性。
- 所有新增能力都要尽量增加可观测数据点。开发阶段默认可以用 SQLite 落地，请求量、工具调用量、数据传输大小、传输速率、耗时、错误率、审批状态、provider receipt 和成本归因都应能按 trace / request / operation / actor / workspace 关联。
- 第三方插件和依赖数量必须受控。非必要不新增；默认仅允许依赖开源项目，并优先选择可自托管、可替换的方案。
- 个人版默认保持轻量：模块化单体、SQLite、文件对象存储、本机目录和可选网关。企业版按需启用 Postgres、Redis、S3、KMS、独立网关和审计导出。
- 每个最小可独立提交的功能项都必须通过对应门禁验证后再提交推送；不得把 contract-mode、dry-run 或 debug-only 结果包装成生产级闭环。

### 2.2 架构原则

- MCP 优先：让智能体通过标准 MCP 调用 Pact，而不是把所有智能体纳入自研 harness。
- 共享空间优先：先把跨智能体信息交换做稳定，再扩展知识、Skill、代码空间和模型转发。
- 轻量优先：个人版默认使用模块化单体、SQLite 和对象存储；企业规模才启用更重的网关、Postgres、Redis、S3 或专用队列。
- 本地优化优先：客户端优先解决本机发现、配置写入、配对、回滚、活动记录和本地共享目录。
- 云和私有化双线：个人用户走 Pact 云服务，企业用户可完全私有化部署。
- 真实验证优先：区分真实 E2E、contract verified 和 planned，避免把协议验证误称为生产可用。

### 2.3 安全模型

安全模型可以固化为“2-3-5”：

- 两个边界：客户端 MCP 入口、服务端 API 出口。
- 三个环境：终端智能体、Pact 平台运行时、业务系统或外部服务。
- 五类对象：身份准入、权限和行为策略、流量和资源治理、风险安全保护、审计和日志。

生产实现必须保证：智能体不能直接绕过 Pact 获取上游敏感资源；共享空间里的高风险操作必须有审批、授权、审计和可撤销记录；跨智能体共享不能变成无边界复制。

## 3. 当前已落地基础

当前仓库已经具备一批可继续商业化的基础能力：

- MCP HTTP 入口、discovery、signed handshake、本地 grant、SSE/list_changed。
- 五类 MCP 语义出口：`pact.discovery`、`pact.knowledge`、`pact.sharedspace`、`pact.codespace`、`pact.skillHub`。
- 共享空间操作：workspace、folder、file、artifact、proposal、checkpoint 等方向已有协议和操作入口。
- 知识蒸馏、知识访问治理、AgentLibrary、贡献资产治理、审批流、操作审计和可观测性。
- MCP connector 已有一条命令安装、便携包、doctor、目标扫描和配置写入方向。
- 云盘端口已有 iCloud / OneDrive 本机目录投影和 Google Drive / Dropbox contract-mode 适配。
- Docker、离线包、Feature Profile、生产就绪门禁和场景验证脚本已有基础。

已通过的关键验证包括：

- `npm run server:verify:mcp-http --silent`
- `npm run server:verify:v001-cloud-drive-e2e --silent`
- `npm run client:verify:targets --silent`
- `npm run client:verify:mcp-plugins --silent`
- `npm run client:verify:pairing-skill-cli --silent`

当前 `npm run server:verify:production-readiness --silent` 仍为 blocked，主要阻塞项是：

- `knowledge.distillation.workbench.runs.artifacts` 已存在 operation，但 capability kernel 缺少对应 API capability。
- 前端 feature registry smoke 报 `/workspaces` 路由未匹配，需要修复验证器或路由声明解析。

## 4. 当前尚未实现或未闭合部分

### 4.1 手机 App 客户端

当前 `client-gui` 是桌面 Flutter 客户端，尚未形成 iOS 和 Android App。手机端不能只做展示页，而要承载真实产品场景：

- 手机作为共享空间入口。
- 手机作为文件、图片、语音、剪贴板和系统分享的输入端。
- 手机可以触发远端智能体读取共享空间。
- 手机可以查看跨智能体产物、审批请求、共享文件和安装状态。

手机端不应承载重型解析、蒸馏或长期后台服务。移动端应保持轻量，重任务交给本机电脑、用户云主机或 Pact 云服务。

### 4.2 零售云服务控制面

当前实现更接近本地服务、私有化原型和工程验证基线，还缺完整零售云服务能力：

- 账号、租户、设备和客户端生命周期。
- 云端 workspace、共享空间和对象存储。
- 订阅、用量计费、限额和成本治理。
- 多设备同步和授权撤销。
- 公网服务的安全、速率限制、滥用防护和运营监控。

### 4.3 企业私有化交付

仓库已有 Docker、离线包和 Feature Profile，但还不是企业交付级闭环：

- 缺少一键部署和管理员初始化流程。
- 缺少私有化许可证、升级、迁移和回滚流程。
- 缺少真实备份恢复演练。
- 缺少 KMS、HSM、Infisical 等企业密钥管理后端。
- 缺少标准运维手册、健康检查、审计导出和故障定位路径。

### 4.4 一条命令安装

MCP connector 已经接近目标，但还需要把“安装效率极高”做成硬门槛：

- 覆盖 macOS、Linux、Windows、WSL、OrbStack、常见云主机和无 Node 环境。
- 覆盖全部已列智能体框架和客户端：OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf 等都按一等目标维护，不以单一框架作为唯一重点。
- 安装命令必须自动完成下载、校验、发现、handshake、grant、写配置和 doctor。
- 失败时必须给机器可读错误和下一条可执行命令。
- 远端智能体应能复制一条命令完成自助安装和回报状态。

### 4.5 远端和托管智能体接入

用户的智能体可能运行在本机、虚拟机、云主机、容器、IDE、手机或第三方托管服务。当前本地扫描能力不足以覆盖这个目标。

需要补齐：

- 面向远端智能体的公开 bootstrap 文档和安装脚本。
- 安装脚本的无交互模式。
- 远端 doctor 和回传安装报告。
- 服务端配对码、短期 token、设备身份和撤销机制。
- 用户把命令交给智能体执行后的状态跟踪。

### 4.6 共享空间和云盘

共享空间是商业化核心场景。当前已有协议和局部实现，但还未形成可售卖体验：

- iCloud / OneDrive 本机目录投影较实，Google Drive / Dropbox 仍偏 contract-mode；OneDrive OAuth / Remote live 仍是后续目标。
- 尚未完整支持 WebDAV、S3、SFTP、NAS、用户指定云主机和任意本地目录。
- 跨设备同步、冲突处理、版本恢复、离线写入和差量上传仍需产品化。
- 共享文件、上下文、artifact、proposal、checkpoint 的 UI 和审计体验仍需闭合。

### 4.7 Skill Hub 客户端闭环

服务端已有 Skill 和工具治理基础，但客户端还没有完成闭环：

- GUI 中 Skill Hub 仍有占位和 deferred 口径。
- CLI pairing 可用，但 Skill 下载、签名校验、版本 pin、隐藏、授权和回执还需要完整体验。
- MCP `pact.skillHub` 应能返回可执行、可审计、可撤销的 Skill 分发结果。

### 4.8 流量和成本网关

商业化落地需要的流量、负载和服务融合网关尚未成为生产核心能力：

- `agent-traffic-gateway` 仍偏可选能力。
- 需要统一管理 QPS、并发、上传大小、模型调用、外部 API 额度和降级策略。
- 个人云服务尤其需要成本上限和滥用防护，否则服务端成本不可控。

### 4.9 权限、密钥和生产审计

当前已有权限和密钥基础，但生产门禁仍有缺口：

- capability kernel 仍有 operation 未登记，已阻塞 production readiness。
- 本地 secret store 不能替代企业 KMS/HSM。
- 对外商业化需要租户隔离、审计导出、数据保留、删除证明和管理员策略继承。

### 4.10 真实外部集成证据

一部分外部系统目前处于 contract verified 状态，不应对外宣称真实 E2E 完成：

- Dify、RAGFlow、OneDrive、Google Drive、Dropbox、GitHub、Gerrit 等都需要真实凭据实验室。
- 每个外部集成都应有 nightly contract test 和 real provider smoke。
- 对外材料必须明确哪些是可用、哪些是测试、哪些是规划。

### 4.11 脱敏和对外材料

待对外发布内容不得包含内部语境、组织示例、智能体名称、截图路径、端口、能力清单和企业内部表述。商业化前必须拆分为：

- 内部技术路线材料。
- 企业客户售前材料。
- 个人用户产品介绍。
- 安全白皮书。
- 安装和接入手册。

对外版本不得包含内部平台名、客户/部门暗示、真实路径、真实 IP、未发布能力或未经验证的生产承诺。

## 5. 分阶段提升路线

### 5.1 P0: 清除生产阻塞

目标：让当前工程基线恢复为可持续验证状态。

工作项：

- 补齐 `knowledge.distillation.workbench.runs.artifacts` 的 capability kernel/API capability 登记。
- 修复 `/workspaces` feature registry smoke，确认是路由声明、验证器解析还是 registry 格式问题。
- 重新执行 `npm run server:verify:production-readiness --silent`。
- 建立能力状态标记：`realVerified`、`contractVerified`、`planned`。
- 整理对外材料脱敏清单，禁止未脱敏版本直接外发。

验收：

- production readiness 不再被 capability kernel 和 UI smoke 阻塞。
- 商业化文档中不再混用已实现、协议验证和规划能力。

### 5.2 P1: 安装和接入成为第一产品能力

目标：让 MCP 插件安装达到“弱智能体也能一次成功”的标准。

工作项：

- 把 `mcp-connector` 定为唯一公开安装入口。
- 提供 GitHub Release 一命令安装、无 Node 便携包和无交互模式。
- 安装流程覆盖 discovery、signed handshake、grant、配置写入、doctor 和安装报告。
- 将 Claude Code、Codex、OpenClaw 作为优先真实 smoke 目标，同时保持 OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent、Windsurf 等目标的同级安装、卸载、扫描和 doctor 覆盖。
- 完成 macOS、Linux、Windows、WSL、OrbStack、云主机 smoke。
- 对每个支持目标建立真实配置写入测试。
- 为远端智能体提供“复制这条命令给你的智能体执行”的接入页。

验收：

- 新机器上一条命令可完成安装和 doctor。
- 安装失败时返回明确原因和下一条修复命令。
- 用户可以在控制台看到每个已列智能体目标是否已安装、已配对、可调用；OpenClaw、Claude Code、Codex、Gemini CLI、Antigravity、OpenCode、Copilot、Kilo Code、Cursor、Hermes Agent 和 Windsurf 不得只停留在文档声明。

### 5.3 P1: 共享空间产品化

目标：把共享空间从协议能力做成用户第一眼能理解和持续使用的核心场景。

工作项：

- 完成 workspace、folder、file、artifact、proposal、checkpoint 的统一产品视图。
- 补齐上传、下载、移动、删除、版本、冲突、恢复和审计。
- 支持本机目录、iCloud、OneDrive、Google Drive、Dropbox、WebDAV、S3、SFTP、NAS 和用户指定云主机。
- 为每次跨智能体共享生成 receipt、audit 和可撤销授权。
- 提供跨智能体协作演示：A 上传资料，B 读取和生成产物，C 审核并写回共享空间。

验收：

- 不同智能体通过 MCP 共享同一 workspace，文件交换不依赖 agent 直连。
- 共享空间具备可追溯、可恢复和可撤销能力。

### 5.4 P2: 多端客户端

目标：形成桌面、手机和远端智能体统一接入体验。

工作项：

- 桌面客户端完成 targets、MCP plugins、Skill Hub、Activity、Settings、Model Forwarding 六模块闭环。
- Flutter 增加 iOS 和 Android shell。
- 手机端支持配对、共享空间、文件选择、系统分享、审批、安装状态和远端唤起。
- 移动端避免重服务，默认走 Pact 云服务或用户指定主机。
- 支持手机作为共享空间入口，但不默认作为高负载服务端。

验收：

- 手机 App 可以进入同一 workspace，查看、上传、分享和审批跨智能体文件。
- 手机端可引导用户把 MCP 安装命令发送给远端智能体。

### 5.5 P2: 云服务和私有化双线

目标：把 Pact 从本地项目升级为可销售服务。

个人云服务工作项：

- 账号、设备、租户、workspace、存储、订阅和用量计费。
- 默认低成本存储和轻量后端。
- 个人用户成本上限、限速和滥用防护。
- 客户端自动发现 Pact 云服务和本机服务。

企业私有化工作项：

- Docker Compose 和可选 Kubernetes 部署。
- 管理员初始化、许可证、离线包、升级、迁移和回滚。
- KMS/HSM/Infisical 可选集成。
- 备份恢复演练和审计导出。
- 企业安全白皮书和运维手册。

验收：

- 个人用户无需自建服务器即可使用共享空间。
- 企业用户可在无公网依赖环境部署完整流程。

### 5.6 P3: Skill、知识和服务生态

目标：把企业服务融合、知识复用和 Skill 共享做成生态能力。

工作项：

- Skill Hub 完成签名、下载、版本 pin、授权、撤销、审计和使用统计。
- 上游 API 一次注册，多智能体复用。
- 高风险操作进入审批流。
- 知识蒸馏与上下文缓存结合，降低模型调用成本。
- 外部服务接入区分 contract test 和 real provider smoke。

验收：

- 管理员可以注册一个服务，并授权给多个 workspace 和智能体使用。
- 智能体通过 MCP 发现可用 Skill 和工具，不直接持有上游敏感凭据。

## 6. 轻量化和成本控制原则

Pact 的商业化不能靠堆重服务。默认架构应遵守以下原则：

- 个人版默认模块化单体，优先 SQLite、文件对象存储和本机目录。
- 默认不启用重型队列、独立网关、复杂缓存集群或长期后台模型任务。
- 大文件传输走直传、断点续传和对象存储，不把 MCP payload 当文件通道。
- 模型调用必须有缓存、批处理、限额、降级和成本统计。
- 移动端只做轻交互和共享空间入口，不做重解析和重蒸馏。
- 企业版按需启用 Postgres、Redis、S3、KMS、独立网关和审计导出。
- 每个模块都必须能被 Feature Profile 裁剪，不能把企业级能力强塞进个人版默认路径。

## 7. 建议验收门禁

每个阶段都应以可执行门禁收口：

```bash
npm run server:verify:mcp-http --silent
npm run server:verify:v001-cloud-drive-e2e --silent
npm run client:verify:targets --silent
npm run client:verify:mcp-plugins --silent
npm run client:verify:pairing-skill-cli --silent
npm run server:verify:production-readiness --silent
```

后续应新增：

- `npm run client:verify:mobile-shell --silent`
- `npm run mcp:verify:one-command-install --silent`
- `npm run server:verify:cloud-control-plane --silent`
- `npm run server:verify:private-deployment-kit --silent`
- `npm run server:verify:real-provider-smoke --silent`
- `npm run server:verify:sharedspace-product-e2e --silent`

## 8. 对外表达建议

当前阶段不建议直接宣称“生产可用”或“全平台商业化完成”。更稳妥的表述是：

- Pact 已具备 MCP 协作服务层、共享空间、知识治理和插件接入的工程基线。
- 当前正在从工程原型升级为商业化产品。
- 短期重点是安装成功率、共享空间体验、生产门禁、手机端和云服务控制面。
- 企业私有化和个人云服务是同一协议底座上的两种交付形态。

对外材料应避免：

- 使用内部客户、部门、平台或智能体名称。
- 暴露本机路径、内网 IP、端口、token、真实截图细节。
- 把 contract verified 能力描述成真实生产集成。
- 承诺尚未闭合的手机端、云服务、计费、企业 KMS 或完整远端智能体调度能力。

## 9. 总结

Pact 的商业化路线应围绕一个核心体验展开：用户拥有一个可被所有智能体安全访问的共享空间。无论智能体运行在手机、电脑、虚拟机、云主机还是托管平台，只要能安装或配置 Pact MCP connector，就能进入同一个受控协作空间。

当前工程已经具备核心协议和局部闭环，但商业化还需要补齐手机端、云控制面、企业交付、一命令安装、真实云盘、远端智能体接入、Skill Hub 客户端闭环、流量成本治理和生产审计。推进顺序应先清生产阻塞，再把安装和共享空间做成第一产品能力，最后扩展多端、云服务、私有化和生态能力。
