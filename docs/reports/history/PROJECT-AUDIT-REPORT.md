# Pact Project Detailed Code and Document Audit Report / Pact 项目深度代码与文档审计报告

**Audit Date / 审计日期**: 2026-06-03  
**Auditor / 审计人员**: Antigravity Code Auditor  
**Audit Scope / 审计范围**: Repository Hygiene, Frontend Feature Registry, Core Platform Security, Client Run-time Portability, Knowledge Distillation Service, and Architecture Design Conformance / 仓库卫生、前端功能注册、平台核心安全、客户端便携运行时、知识蒸馏服务及设计规范一致性  

---

## 1. Repository Structure & Path Hygiene / 仓库结构与路径卫生

The repository layout is governed by the hygiene rules defined in [verify-root-hygiene.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/tests/verify-root-hygiene.mjs). Running `node tests/verify-root-hygiene.mjs` failed due to path hygiene violations.
仓库布局受到 [verify-root-hygiene.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/tests/verify-root-hygiene.mjs) 中定义的卫生规则的严格约束。当前执行 `node tests/verify-root-hygiene.mjs` 失败，暴露出路径卫生违规问题。

### 1.1 Forbidden Root Entries / 被禁止的根目录条目
* **Severity / 严重程度**: **HIGH / 高**
* **Findings / 发现**:
  * **`.pact-server-data`**: This local directory violates the Server Data Dir policy. According to the design guidelines, all default data directory resolutions must pass through the `ServerConfig.getDataDir()` gateway rather than defaulting to a hardcoded project-local `.pact-server-data` directory (unless overridden by `--data-dir`).
  * **`.pact-server-data`**: 该本地目录违反了“服务器数据目录”策略。根据设计准则，所有默认的数据目录解析必须经过 `ServerConfig.getDataDir()` 网关，而不是在项目根目录下生成硬编码的本地 `.pact-server-data` 目录（除非使用 `--data-dir` 显式覆盖）。
* **Unclassified Root Entries / 未分类根目录条目**:
  * **`.impeccable`**: Hidden folder left by toolchains or previous agent workspaces.
  * **`.impeccable`**: 由工具链或此前智能体工作区残留的隐藏文件夹。
  * **`PRODUCT.md`**: Core product documentation located in the root. According to rules, this should be moved under the `/docs` directory.
  * **`PRODUCT.md`**: 位于根目录的核心产品文档。根据规则，这应当移入 `/docs` 目录统一进行资产化管理。
  * **`outputs` & `test-results`**: Run-time artifacts and test results written to the root. These should be placed under `build/` and excluded in `.gitignore` to prevent accidental commits.
  * **`outputs` & `test-results`**: 写入根目录的运行时产物和测试结果。这些应当移入 `build/` 目录下，并在 `.gitignore` 中进行忽略，防止研发过程中的误提交。

### 1.2 Forbidden Source Tree Noise / 被禁止的源码树噪声
* **Severity / 严重程度**: **LOW / 低**
* **Findings / 发现**:
  * **`tests/.DS_Store`**: OS metadata leakage in the testing directory. It was not filtered by `.gitignore` and pollutes the clean source tree.
  * **`tests/.DS_Store`**: 测试目录中泄露的 macOS 系统元数据文件。它未被 `.gitignore` 过滤，污染了干净的源码树。

---

## 2. Frontend Feature Registry Consistency / 前端路由与功能注册一致性

The Vue console uses role-based access control (RBAC) powered by a central backend registry. Running `node server/scripts/verify-frontend-feature-registry.mjs` failed with the following error:  
`frontend route is missing from registry: /admin/agent-assignment`  
Vue 管理端控制台采用由后端统一控制的功能注册表。执行 `node server/scripts/verify-frontend-feature-registry.mjs` 失败，抛出上述错误。

```text
Error Source: server-web/router/index.ts (Line 68) -> Missing from server/config/frontend-feature-registry.yaml
错误来源：server-web/router/index.ts（第 68 行） -> 在 server/config/frontend-feature-registry.yaml 中缺失
```

### 2.1 Technical Impact / 技术影响
* **Severity / 严重程度**: **CRITICAL / 致命 (Blocker / 发布阻断项)**
* **Findings / 发现**:
  * [router/index.ts](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server-web/router/index.ts) defines `/admin/agent-assignment` which maps to [AgentAssignmentView.vue](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server-web/views/admin/AgentAssignmentView.vue) to assign default agent models to specific business logic (e.g. `infoFeedSummaryModelAlias`, `ruleAuthoringModelAlias`).
  * [router/index.ts](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server-web/router/index.ts) 中定义了 `/admin/agent-assignment` 路由，映射到 [AgentAssignmentView.vue](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server-web/views/admin/AgentAssignmentView.vue) 视图，用于给核心业务（如 `infoFeedSummaryModelAlias`、`ruleAuthoringModelAlias`）分配默认的智能体模型。
  * Since this path is missing from [frontend-feature-registry.yaml](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/config/frontend-feature-registry.yaml), the backend `PolicyEngine` cannot enforce permissions on it. Users or agents could bypass security gating or execute undocumented actions since no capabilities are mapped to this route.
  * 由于该路径在 [frontend-feature-registry.yaml](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/config/frontend-feature-registry.yaml) 中缺失，后端 `PolicyEngine`（策略引擎）无法对该页面进行权限过滤或审计。这可能导致智能体或用户绕过边界管理，执行未被记录和授权的操作。

---

## 3. Platform Security & Capability Key Kernel / 平台安全与 Capability Key 内核设计

Pact implements a zero-trust model for agents using cryptographically sealed keys. We audited [security-permissions-provider.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/common/security/security-permissions-provider.mjs) and [opaque-capability-key.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/common/security/authorization/opaque-capability-key.mjs).
Pact 为智能体实现了一个基于加密封装密钥的零信任鉴权模型。我们对 [security-permissions-provider.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/common/security/security-permissions-provider.mjs) 和 [opaque-capability-key.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/common/security/authorization/opaque-capability-key.mjs) 进行了深度代码审计。

### 3.1 AEAD Sealed State Gaps / AEAD 封装状态设计隐患
* **Severity / 严重程度**: **HIGH / 高**
* **Findings / 发现**:
  * [opaque-capability-key.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/common/security/authorization/opaque-capability-key.mjs) uses `aes-256-gcm` (AEAD) to seal capability keys into `.sealed.json` and writes a plaintext `.sealing-key` in the same directory under fallback `local-file` mode.
  * [opaque-capability-key.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/common/security/authorization/opaque-capability-key.mjs) 使用 `aes-256-gcm`（AEAD）将能力密钥加密封装在 `.sealed.json` 中，但在本地文件降级模式下，会将明文 `.sealing-key` 写入同一目录下。
  * **Key Leakage Risk / 密钥泄露风险**: If an agent compromises the filesystem and obtains read access to the server data directory, it can simultaneously read `.sealed.json` and `.sealing-key`, decrypting all capabilities and gaining full administrative access, bypassing the security kernel. The sandbox and OS keychain backends (like macOS Keychain or Windows DPAPI) must be enforced in production to separate the encryption keys from database files.
  * **密钥泄露风险**：如果智能体突破了文件系统沙箱，获得了对服务器数据目录的读权限，它可以同时读取 `.sealed.json` 与 `.sealing-key`，从而能够解密所有被封印的能力，获取全局管理员级别的访问权限。因此，在生产环境中必须强制使用 OS Keychain（如 macOS 钥匙串或 Windows DPAPI），将解密秘钥与密文数据文件物理分离。

### 3.2 Opaque Verification Redaction / 隐蔽验证审计不彻底
* **Severity / 严重程度**: **MEDIUM / 中**
* **Findings / 发现**:
  * The `authorizeOperation` method (in `security-permissions-provider.mjs`) calls `resolvedAuthorizationEngine.evaluate`.
  * `security-permissions-provider.mjs` 中的 `authorizeOperation` 动作最终会触发 `resolvedAuthorizationEngine.evaluate` 进行判定。
  * While the Capability Key design dictates that the kernel must only perform `verify(opaqueKey, requestedCapability)` and return a binary `allow/deny` without exposing the whole capability set, the `decision` object returned in authorization events (`appendDecision`) contains full trace logs that sometimes list `missingCapabilities`. This could allow a malicious agent reading these audit traces to rebuild the list of valid system capabilities through deductive queries.
  * 尽管 Capability Key 设计要求内核只提供 `verify(opaqueKey, requestedCapability)` 并返回二值判定，而不泄露完整权限列表；但当前在 `appendDecision` 记录的审计日志中，抛出的 `decision` 仍然包含了 `missingCapabilities` 等详细能力列表。攻击者可以通过构造多次拒绝测试，拼凑出系统全部的敏感能力标识。

---

## 4. Knowledge Preprocessing & Distillation / 知识预处理与蒸馏管线

We audited the external knowledge distillation service in [server.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/external-services/knowledge-distillation-service/server.mjs).
我们对 [server.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/external-services/knowledge-distillation-service/server.mjs) 中的外部知识蒸馏服务进行了代码层审计。

### 4.1 Improvement Over Legacy Audit / 相比历史审计的改进
* **Findings / 发现**:
  * The deprecated embedded distillation algorithms had severe issues (documented in [KNOWLEDGE-DISTILLATION-AUDIT.md](file:///Users/unka/DevSpace/Unka-Malloc/Pact/docs/reports/history/KNOWLEDGE-DISTILLATION-AUDIT.md)), such as empty fallback models, lack of MIME encoding, and basic tokenizers.
  * 此前内嵌 of 旧蒸馏算法存在严重问题（记录在 [KNOWLEDGE-DISTILLATION-AUDIT.md](file:///Users/unka/DevSpace/Unka-Malloc/Pact/docs/reports/history/KNOWLEDGE-DISTILLATION-AUDIT.md) 中），例如空的确定性回退方案、缺失 MIME 邮件解析以及玩具级的正则分词器。
  * The new external `knowledge-distillation-service` resolves many of these issues: it implements recursion over Zip/Tar archives, PDF pdftotext extraction, structured OOXML (DOCX/XLSX/PPTX) parser paths, and a robust MIME parser (`parseMimeMessage`, `decodeMimeBody`, `splitMimeParts`) that properly decodes base64 and quoted-printable email components.
  * 独立的外部 `knowledge-distillation-service` 修复了许多此类缺陷：它实现了 ZIP/TAR 压缩包递归路由、PDF pdftotext 解析、结构化 OOXML（DOCX/XLSX/PPTX）解析，并补充了健壮 of MIME 解析函数（`parseMimeMessage`, `decodeMimeBody`, `splitMimeParts`），可正确解码 base64 与 quoted-printable 格式 of 邮件及其附件。

### 4.2 Legacy Shims Cleanup / 遗留代码清理不彻底
* **Severity / 严重程度**: **MEDIUM / 中**
* **Findings / 发现**:
  * Although the external service is designated as the sole active distillation surface, several embedded shims (`knowledge.distillation.*` hooks) are still present in the server's platform directories. This codebase redundancy increases maintenance costs and can cause confusion during refactoring.
  * 尽管架构规定外部服务是唯一的活性蒸馏界面，但在服务器的 specialized 目录中依然残留了部分嵌入式的 `knowledge.distillation.*` 钩子。这种代码库冗余增加了维护成本，并且在重构时易引发概念混淆。

---

## 5. Client-GUI Portable Environment / 客户端-GUI 便携式运行环境

We audited the Flutter path management service [portable_data_root.dart](file:///Users/unka/DevSpace/Unka-Malloc/Pact/client-gui/lib/src/services/portable_data_root.dart).
我们对 Flutter 客户端路径服务 [portable_data_root.dart](file:///Users/unka/DevSpace/Unka-Malloc/Pact/client-gui/lib/src/services/portable_data_root.dart) 进行了代码审计。

### 5.1 Portable Dir Priority Conflict / 便携目录优先级冲突
* **Severity / 严重程度**: **MEDIUM / 中**
* **Findings / 发现**:
  * In `dataDirectory()`, the code checks `Platform.environment['PACT_PORTABLE_DIR']` before falling back to detecting a bundled Mac App structure:  
    `final isBundledMacExecutable = p.basename(executableDirectory.path) == 'MacOS' && ...`
  * 在 `dataDirectory()` 中，代码会优先检查 `Platform.environment['PACT_PORTABLE_DIR']`，随后才退回到打包好的 macOS App 结构识别。
  * **Conflict Risk / 冲突风险**: If `PACT_PORTABLE_DIR` is set globally in the user's login shell, it overrides the sandboxed portable location inside bundled Mac apps. This might cause a Mac desktop client to read/write state in a different, unmanaged location, leading to silent state sync failures or permissions issues.
  * **冲突风险**：如果用户在系统的登录 Shell 中全局设置了 `PACT_PORTABLE_DIR` 环境变量，它将覆盖打包 Mac 应用程序内部自带的沙箱便携路径。这会导致 Mac 桌面端将数据意外读写到非预期的未受管位置，从而引发数据丢失或静默同步失败。

### 5.2 File Lock Performance Gaps / 独占文件锁性能隐患
* **Severity / 严重程度**: **LOW / 低**
* **Findings / 发现**:
  * The `_writeTextAtomically` method creates a `.lock` file and uses `lockHandle.lock(FileLock.exclusive)` before renaming the temporary write file.
  * `_writeTextAtomically` 方法会在改写临时文件前，创建一个 `.lock` 文件并使用 `lockHandle.lock(FileLock.exclusive)` 进行独占锁定。
  * **I/O Overhead / I/O 开销**: While atomic rename is safe, holding an exclusive OS-level lock on client settings UI writes might block the main Flutter thread on slower disks (like USB flash drives under portable deployment modes), causing GUI frame drops.
  * **I/O 开销**：虽然原子重命名非常安全，但在客户端 GUI 更新设置时，如果在慢速磁盘（例如便携模式下的普通 U 盘）上频繁申请操作系统的独占文件锁，可能会短暂阻塞 Flutter UI 渲染主线程，造成界面丢帧或卡顿。

---

## 6. Security Vulnerability Audit / 安全漏洞专项审计

We conducted a dedicated security audit of the codebase, focusing on SQL Injection, Command Injection, Path Traversal, XSS, and Cryptographic risks.
我们对代码库进行了一次安全漏洞专项审计，重点关注 SQL 注入、命令注入、路径遍历、跨站脚本（XSS）以及密码学安全风险。

### 6.1 Cryptographic Key Co-location / 密钥存储共置风险
* **Severity / 严重程度**: **HIGH / 高**
* **Finding / 发现**:
  * In fallback `local-file` mode, [opaque-capability-key.mjs](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/platform/common/security/authorization/opaque-capability-key.mjs) stores both `.sealed.json` (encrypted state) and `.sealing-key` (plaintext key) in the same data folder `security/capability-kernel/`.
  * 在本地文件降级模式下，`opaque-capability-key.mjs` 将加密状态文件 `.sealed.json` 和明文秘钥 `.sealing-key` 同时存储在 `security/capability-kernel/` 目录下。
  * **Exploitation / 危害**: If an attacker or a malicious agent exploits a file read vulnerability (e.g. via path traversal), they can extract both the ciphertext and the encryption key, decrypt the kernel state, and access all credentials and capabilities.
  * **危害**：如果攻击者或恶意智能体利用某种任意文件读取漏洞（例如路径遍历），可以同时读取密文与加密秘钥，从而轻易恢复内核状态并接管系统中所有的敏感凭据与权限。

### 6.2 Custom HTML Sanitizer Bypasses in Console / 控制台自定义 HTML 过滤绕过风险
* **Severity / 严重程度**: **MEDIUM / 中**
* **Finding / 发现**:
  * The frontend [rendering.ts](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server-web/lib/rendering.ts) implements a custom HTML sanitizer `sanitizeHtmlContent` based on a HTML `<template>` parser and a tag blocklist (`blockedTags`) / attribute allowlist (`allowedAttrs`).
  * 前端 `rendering.ts` 实现了基于 HTML `<template>` 解析器、标签黑名单（`blockedTags`）和属性白名单（`allowedAttrs`）的自定义 HTML 过滤器 `sanitizeHtmlContent`。
  * **Exploitation / 危害**: Although it checks event handlers (`on*`), `style`, and restricts `href` to safe links via regex, custom blocklist-based sanitizers are mathematically less resilient than industry-standard sanitization libraries (e.g. `DOMPurify`). Complex HTML5 tag nestings or XML namespaces could potentially bypass the simple `querySelectorAll("*")` loop to trigger Cross-Site Scripting (XSS).
  * **危害**：尽管该过滤器剥离了 `on*` 事件、`style` 属性并通过正则过滤了 `href` 的链接协议，但基于黑名单过滤自定义标签和属性的方式，在面对复杂的 HTML5 嵌套结构或 XML 命名空间技巧时，可能被攻击者绕过，从而导致 DOM-based XSS 漏洞。

### 6.3 SQL Injection Audit / SQL 注入安全审计
* **Status / 评估状态**: **PASSED / 通过**
* **Finding / 发现**:
  * We audited database queries across storage and security providers (`console-auth.mjs`, `authorization-governance-store.mjs`). All dynamically executed SQLite queries use prepared statements with placeholders (e.g., `db.prepare("SELECT * FROM console_users WHERE username = ?")`). No insecure string concatenation with untrusted inputs was observed.
  * 我们对存储和安全模块中的数据库查询进行了审计。所有动态执行的 SQLite 查询均使用带有占位符的参数化预编译语句（如 `db.prepare("SELECT * FROM console_users WHERE username = ?")`）。未发现通过字符串直接拼接外部输入的不安全 SQL 操作。

### 6.4 Command Injection Audit / 命令注入安全审计
* **Status / 评估状态**: **PASSED / 通过**
* **Finding / 发现**:
  * We audited process spawning (`child_process.spawn`) across script supervisors, credential keys, and the Gerrit integration. Commands are consistently spawned with arguments passed as separate array elements (e.g., `spawn(command, args)`). Stdin is fed via write pipes. There is no direct execution of shell command strings via `child_process.exec`, preventing shell injection vulnerabilities.
  * 我们对进程派生（`child_process.spawn`）进行了审计。所有的外部系统命令（如 Gerrit 集成、系统认证 helper）都通过数组参数形式进行隔离传参（如 `spawn(command, args)`），输入通过 Stdin 管道写入。未发现直接通过 `child_process.exec` 执行未经安全转义的 Shell 命令行字符串的情况，防止了命令注入漏洞。

---

## 7. Action and Repair Matrix / 修复与改进矩阵

| Severity / 严重度 | Finding / 问题描述 | Impact Area / 影响范围 | Action Recommended / 修复建议 |
|---|---|---|---|
| **CRITICAL / 致命** | Missing `/admin/agent-assignment` in feature registry. / 前端 `/admin/agent-assignment` 路由未在服务端配置注册表中注册。 | RBAC & Security Policy Gate / 控制台鉴权与发版门禁 | Add the route and features to [frontend-feature-registry.yaml](file:///Users/unka/DevSpace/Unka-Malloc/Pact/server/config/frontend-feature-registry.yaml). / 在 `frontend-feature-registry.yaml` 中登记路由关联的功能 ID 与操作集合。 |
| **HIGH / 高** | Leftover local data `.pact-server-data` and `.impeccable` in root. / 根目录下存在本地数据文件夹 `.pact-server-data` 以及 `.impeccable` 冗余。 | Repository Hygiene check / 仓库卫生门禁与发布校验 | Clear root artifacts; ensure paths resolve using `ServerConfig.getDataDir()`. / 清理根目录多余产物；确保所有本地文件解析都经过 `ServerConfig`。 |
| **HIGH / 高** | Plaintext `.sealing-key` stored in the same data folder. / 降级文件模式下，明文解密秘钥与密文数据存储在同一个数据文件夹中。 | Cryptographic Secret Protection / 密钥存储与封印安全 | Enforce system keychain backends in production (darwin/win32/keyctl). / 生产环境下强制启用 Keychain/DPAPI 等硬件或系统级保密设备存储秘钥。 |
| **MEDIUM / 中** | Deprecated distillation runtime shims left in server platform. / 服务器平台中仍遗留已废弃的嵌入式知识蒸馏钩子。 | Code Maintenance / 代码库整洁度与维护性 | Delete legacy paths; route all distillation tasks exclusively to `knowledge-distillation-service`. / 清理旧路径源码；将所有蒸馏任务完全引流至独立的蒸馏微服务中。 |
| **MEDIUM / 中** | Global `PACT_PORTABLE_DIR` overrides Mac bundled detection. / 全局环境变量 `PACT_PORTABLE_DIR` 会覆盖 macOS App 自带的沙箱路径探测。 | Portability & Environment Sync / 便携式运行时路径决策 | Refine lookup priority to give precedence to App bundle paths when bundled. / 优化路径优先级逻辑，在已打包环境中，优先以应用容器或 Bundle 内部为准。 |
| **MEDIUM / 中** | Custom HTML sanitizer `sanitizeHtmlContent` used in frontend. / 前端使用自定义 HTML 过滤器 `sanitizeHtmlContent`。 | Cross-Site Scripting (XSS) / 跨站脚本安全 | Replace custom sanitizer with an industry standard library (e.g. `DOMPurify`). / 使用业界标准的消毒库（如 `DOMPurify`）替换自定义过滤逻辑，防止高级绕过。 |
| **LOW / 低** | OS metadata `tests/.DS_Store` exists in the test tree. / 测试用例源码树中包含 macOS 的系统缓存文件 `.DS_Store`。 | Source Tree Hygiene / 源码树整洁性 | Delete `.DS_Store` and update `.gitignore`. / 物理删除该文件并在 `.gitignore` 中追加过滤规则。 |
| **LOW / 低** | File locks inside UI thread atomic writes. / 客户端写入操作时，在 UI 线程同步申请 OS 级别文件锁。 | GUI Performance / 控制台渲染性能 | Move the file write and lock operations to an asynchronous background isolate. / 将文件写入与锁征用逻辑移至后台异步 Isolate 中执行，避免阻塞主 UI。 |
