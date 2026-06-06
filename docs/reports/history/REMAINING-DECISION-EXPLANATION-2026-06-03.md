# 剩余决策说明

> 归档说明：本文是 2026-06-03 的 P3 和安全批量决策过程记录，已从当前报告层移入 `docs/reports/history/`。当前任务顺序和验收口径以 `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md` 为准。

日期：2026-06-03

用途：记录 P0/P1/P2 之后剩余事项的批量决策。2026-06-03 维护者已确认 P3 远期路线和安全硬化排期；P0/P1/P2/P3/S 系列仍有实现工作，但方向已经拍板。

回复方式：

```text
P3-A 批准：完整贡献者生态、市场和统计面板，不降级不回退
P3-B 批准
P3-C 搁置
S-01 批准：单独 CSP 批次
S-02 批准
S-10 批准：接受残余风险，维护时处理
```

## 已批准结论

- P3-A：批准。完整贡献者生态、市场和统计面板进入 P3，不降级，不回退。
- P3-B：批准为 P3 维护项。管理报告、架构 live map 和样例业务包已有基础，可以继续维护，但不抢 P0/P1/P2。
- P3-C：搁置并拆分。connector SDK、多租户、分布式 worker、mTLS fleet、插件市场后续分别单独决策，不作为一个大包启动。
- 安全项：S-01 到 S-09 均批准；S-07 和 S-09 合并；S-10 批准为接受残余风险，维护时处理。

## P3-A Skill、知识和服务生态

问题：

P2-E 负责模块和外部服务接入的基础治理；P3-A 负责面向贡献者、资产、技能、知识包和服务的完整生态、市场和统计面板。这不是 P2-E 的重复项，而是建立在 P2-E 治理底座上的产品生态层。

需要决定：

P3-A 是否完整进入 P3，包含贡献者生态、市场和统计面板。

决策状态：

已批准；完整贡献者生态、市场和统计面板进入 P3，不降级，不回退。

批准后的范围：

- 贡献者主页、贡献资产列表、贡献请求、维护 SLA、订阅、评分、推荐和使用统计。
- Skill、知识包、服务和贡献资产的使用统计、成功率、回滚率、撤销传播、版本趋势。
- 市场和统计面板：可发现、可筛选、可授权、可安装、可撤销、可审计、可排行。
- 服务一次注册，多 workspace / 多智能体复用，但仍必须走 Tool Management、上游网关、统一审批和操作账本。
- 高复用资产推荐、贡献者声誉、维护新鲜度、风险提示和滥用防护。

不做的范围：

- 不把市场能力提前变成 P0/P1/P2 的前置依赖。
- 不让市场绕过 P2-E 的模块/外部服务治理、签名、撤销、审批和审计。
- 不把 P3-A 提前变成 P0/P1/P2 的前置依赖。
- 不把 P3-C 的分布式 worker、mTLS fleet、企业 S3/MinIO 生产部署和多租户大包混进 P3-A。

验收标准：

- 统计和推荐基于真实 operation / usage / rollback / revoke 事件。
- 撤销后可证明 discovery、grant、Tool Management catalog 和多智能体可见性同步失效。
- 市场上展示的每个条目都有来源、版本、签名状态、授权范围、安装/撤销记录和风险提示。

## P3-B 管理报告、架构 live map 和样例业务包

问题：

这部分已有基础：executive report、architecture live map、sample business pack 都已有实现入口和 verifier。剩下的问题不是“要不要从零做”，而是要不要作为 P3 继续维护成正式管理体验。

需要决定：

是否批准为 P3 维护项。

默认建议：

批准为 P3。

批准后的范围：

- 管理层报告继续聚合 production readiness、资产价值、评估、容量、成本、安全和风险。
- 架构图和运行状态联动继续维护，核心架构节点能指到实现路径和门禁状态。
- 样例业务包继续维护，但样本数据必须可公开、可复现、可脱敏；敏感测评集仍放外部数据目录。

不做的范围：

- 不做营销页。
- 不让样例业务包伪装成真实业务 E2E。
- 不把报告当成门禁本身；事实仍来自 verifier、trace 和 operation ledger。

验收标准：

- 报告能解释资产价值、生产风险、容量成本和安全状态。
- 架构 live map 的文档路径、实现路径和 verifier 状态可检查。
- 样例业务包可物化、可导入、可清理。

## P3-C 第三方 connector SDK、插件市场、多租户和分布式生产栈

问题：

P3-C 现在太大，把几类不同风险的事混在一起：connector SDK、插件市场、多组织多租户、分布式 worker、mTLS fleet、S3/MinIO 生产部署。这里面一部分已经被 P2-B/P2-E 吸收：企业私有化预设、模块和外部服务接入生态。剩下的 marketplace、分布式 worker 和 fleet 管理风险更高，不能作为一个大包直接批准。

需要决定：

是否把 P3-C 搁置，后续拆成单独决策。

默认建议：

已搁置，拆分后再审。

可拆方向：

- Connector SDK：跟 P2-E 的模块和外部服务生态走。
- 多租户：等个人/企业预设和 workspace boundary 稳定后再单独定义。
- 分布式 worker / mTLS fleet / S3-MinIO：作为企业私有化高级预设的可脱水模块，不能进入个人电脑默认路径。
- 插件市场：后续单独决策；该拆分不取消 P3-A 已批准的贡献者生态、市场和统计面板。

不做的范围：

- 不启动完整插件市场。
- 不把分布式 worker、mTLS fleet、S3/MinIO 变成默认依赖。
- 不把多租户和企业私有化混成一件事。

验收标准：

- 以后重启 P3-C 时，必须拆成小决策，分别说明依赖、风险、预设线、脱水方式和验收门禁。

## 安全剩余项

### S-01 CSP 去掉 `script-src 'unsafe-inline'`

对应审计：H-3。

建议：批准，但单独批次。

原因：这是高影响前端安全硬化，需要 Vite nonce/hash 或等价构建方案；不能和小修混在一起。

验收：控制台构建和运行不破；CSP 不再允许 inline script；必要 inline style 单独评估。

### S-02 iframe sandbox 加固

对应审计：M-1。

建议：批准，安全短批次。

验收：移除不必要的 `allow-popups-to-escape-sandbox` / `allow-same-origin` 组合；邮件 evidence 渲染回归通过。

### S-03 初始 owner 凭据提示减少 stdout 暴露

对应审计：M-3。

建议：批准，安全短批次。

验收：stdout 不再输出敏感路径或详细 owner 信息；初始登录和 doctor 指引不破。

### S-04 HTTP 层全局请求频率限制

对应审计：M-5。

建议：批准，安全短批次。

验收：HTTP 层有 IP / subject 级限流；登录接口有额外 per-IP 限流；生产反代限流写进部署说明。

### S-05 `.dockerignore` 加固

对应审计：L-3。

建议：批准，安全短批次。

验收：排除运行数据、agent 历史、临时报告和敏感上下文；生产镜像仍包含 license 和必要文档。

### S-06 Docker Compose 生产 TLS 口径

对应审计：M-2。

建议：批准，部署文档和 compose 分层批次。

验收：开发 compose 明确只限本地；生产 compose 或企业预设必须通过 HTTPS / 反代 TLS；不把 HTTP compose 说成生产可用。

### S-07 `v-html` 防御深度加固

对应审计：M-4。

建议：批准，但和 S-09 合并成 HTML 渲染安全批次。

验收：`SafeHtmlBlock` 增加强制消毒或 branded type；调用方不能传普通 string 绕过消毒。

### S-08 Vite 代理 TLS 验证

对应审计：M-6。

建议：批准，开发代理短批次。

验收：`VITE_API_ORIGIN` 指向 HTTPS 远端时不默认 `secure: false`；本地开发例外有明确条件和注释。

### S-09 邮件 HTML 消毒 allowlist

对应审计：L-5。

建议：批准，和 S-07 合并。

验收：邮件 HTML 消毒从 blocklist 升级到 allowlist 或等价策略；覆盖 `math`、`svg`、事件属性、危险 URL 等回归。

### S-10 低危残余风险合并处理

对应审计：L-1、L-2、L-4。

建议：批准为“接受残余风险，维护时处理”。

范围：

- L-1：CI 失败时不要输出过宽 JSON；维护 CI 时顺手收窄。
- L-2：legacy/dev-only Rust unsafe 添加说明或后续替换，不进入主线阻塞。
- L-4：User-Agent 软校验保持当前权衡，只确保审计记录可见。

验收：不作为当前发布阻塞；如果相关文件被改动，顺手补最小防护或说明。

## 建议一次性回复

维护者已经按以下口径批准：

```text
P3-A 批准：完整的贡献者生态和市场以及统计面板，不降级，不回退
P3-B 批准：作为 P3 维护项，不抢 P0/P1/P2
P3-C 搁置：拆成 connector SDK、多租户、分布式 worker、mTLS fleet、插件市场后再单独决策
S-01 批准：单独 CSP 批次
S-02 批准
S-03 批准
S-04 批准
S-05 批准
S-06 批准
S-07 批准：和 S-09 合并
S-08 批准
S-09 批准：和 S-07 合并
S-10 批准：接受残余风险，维护时处理
```

## 来源

- `docs/reports/OPEN-DECISION-CHECKLIST-2026-06-03.md`
- `docs/reports/HISTORY-SYNTHESIS-DECISION-QUEUE-2026-06-03.md`
- `docs/reports/SECURITY-HARDENING-BACKLOG-2026-06-03.md`
- `docs/SECURITY-VULNERABILITY-AUDIT.md`
- `docs/PRODUCTION-CAPABILITY-GAP.md`
