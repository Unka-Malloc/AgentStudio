# Security Hardening Backlog

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Active security backlog with residual-risk tracking
- Scope: Security Hardening Backlog.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

记录日期：2026-06-03

本文记录 `docs/SECURITY-VULNERABILITY-AUDIT.md` 中已批准但尚未实现的安全硬化项。H-1 和 H-2 已作为 P0 阻塞项修复；本文件只跟踪后续批次，不表示这些问题已经关闭。

## 已批准待实现项

| ID | 项目 | 状态 | 后续处理口径 |
| --- | --- | --- | --- |
| H-3 / S-01 | CSP 去掉 `script-src 'unsafe-inline'` | 已关闭（T05） | 控制台 CSP 改为 `script-src 'self' 'nonce-<随机值>'` 并给所有 inline script 注入 nonce。 |
| M-1 / S-02 | iframe sandbox 策略加固 | 已关闭（T04） | 邮件 evidence iframe 移除 `allow-same-origin` 与 `allow-popups-to-escape-sandbox`，保留 `allow-popups`。 |
| M-3 / S-03 | 初始 owner 凭据提示写入 stdout | 已关闭（T04） | 凭据不再直出到 stdout；改写入受控文件并保留登录/恢复流程。 |
| M-5 / S-04 | HTTP 层全局请求频率限制 | 已关闭（T04） | 已上线 IP / subject / 登录限流；并由 `server:verify:security-hardening` 自动验证拒绝与放行。 |
| L-3 / S-05 | `.dockerignore` 加固 | 已关闭（T04） | 已排除运行数据、agent 历史、临时 reports 与生产构建外无关上下文。 |
| M-2 / S-06 | Docker Compose 生产 TLS 口径 | 已关闭（T04） | 明确开发/本地 scope 与生产 / enterprise HTTPS 或反代 TLS 口径。 |
| M-4 / S-07 | `v-html` 防御深度加固 | 已关闭（T05） | `SafeHtmlBlock` 输出统一经过强制 sanitizer，普通 string 不可绕过。 |
| M-6 / S-08 | Vite 代理 HTTPS 证书验证 | 已关闭（T04） | 远端 HTTPS origin 默认保持 TLS 验证；本地 loopback 通过 `VITE_API_PROXY_ALLOW_INSECURE_HTTPS=1` 显式放行。 |
| L-5 / S-09 | 邮件 HTML 消毒 allowlist | 已关闭（T05） | 邮件 HTML 清洗改为 allowlist；去除危险标签、事件属性、危险 URL 与不安全 CSS URL 用法。 |
| L-1/L-2/L-4 / S-10 | CI JSON 输出、legacy unsafe、User-Agent 软校验 | 已批准，接受残余风险 | 维护相关文件时顺手收窄输出、添加说明或补审计可见性；不作为当前发布阻塞。 |

## 执行规则

- 这些项不在当前小修中动代码。
- 下一次安全硬化小修优先处理待关闭的残余项（S-10）及新增批准项。
- S-07、S-08、S-09 已并入 T05/T04 批次并回写状态。
- S-10 默认接受残余风险，维护相关文件时处理。
- 每个项关闭时必须补对应 verifier 或回归检查，并回写 `docs/SECURITY-VULNERABILITY-AUDIT.md` 的处理状态。
