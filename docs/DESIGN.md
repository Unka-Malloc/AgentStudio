# Pact Design

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: Frontend page design, visual language, color, and interaction design.
- Staleness check: Checked against `server-web/ServerConsoleApp.vue`, `server-web/components/`, `server-web/appearance-presets/`, `client-gui/lib/src/ui/`, and `client-gui/assets/brand/` on 2026-06-16.

## 设计边界

本文是 Pact 唯一维护的前端页面设计和配色说明。服务端控制台使用 Vue，桌面客户端使用 Flutter；二者共享克制、操作密集、审计友好的产品气质，但组件实现独立。

## 服务端控制台

### 信息架构

Server Console 是运维和治理控制台，不是营销页。页面应优先支持快速扫描、过滤、审计、配置、回滚和诊断。

主要页面域：

- Runtime、settings、mounts、dependencies、storage、jobs、monitor alerts。
- Knowledge sources、ingest、maintenance、rules、word cloud、evidence preview。
- Workspaces、sharedspace、cloud drive、checkpoint、context bundle。
- Tool Management、grants、audit、metrics、external services。
- Authorization、auth users、sessions、OIDC、approval governance。
- Agent Relay、agent exploration、model routing、maintenance agent。

### 视觉规则

- 卡片只用于重复项、工具面板、modal 或清晰分组，不把整个页面包进卡片。
- 数据表、列表、树、详情面板和抽屉优先于大面积英雄视觉。
- 操作按钮要用明确图标和短标签；危险操作使用确认、禁用态和审计结果提示。
- `BinaryCheckbox` 用于独立 boolean 选项；`BinaryToggle` 或 segmented control 用于二选一模式。
- 历史记录和会话列表复用 `HistorySessionPanel`，避免每页自建不一致列表。
- 控制台文本必须适配紧凑容器，避免按钮、卡片、表格单元格溢出。

### 配色

服务端控制台支持 appearance presets，位于 `server-web/appearance-presets/`。默认设计应保持中性、可读、高对比和低装饰，不以单一紫色、蓝黑、米色或棕橙作为主视觉。

品牌蓝可用于选中、链接、焦点和少量关键操作；危险、警告、成功、禁用状态应使用语义色而不是纯品牌色变体。

## 桌面客户端

### 信息架构

桌面客户端是本机环境管理器。第一层导航围绕：

- Agents
- MCP Plugins
- Skill Hub
- Model Forwarding
- Mobile Relay
- Activity And Snapshots
- Settings

客户端不显示旧服务端控制台式的信息架构，不保留 Mail、DataConnector、Knowledge Graph、上传队列等旧重型页面作为主产品页面。

### 视觉规则

- Flutter 页面使用紧凑 panel、toolbar、target card、history panel 和 settings form。
- 本机 runtime、mobile relay、MCP config、Skill Hub 等状态要展示可操作的下一步，而不是解释性长文。
- target card 必须区分 discovered、manual、configured、needs action、error 等状态。
- Activity 和 snapshot 是恢复依据，不能只是日志装饰。
- macOS app icon 由 `client-gui/assets/brand/pact-app-icon.svg` 生成，不以截图 PNG 作为构建输入。

## 组件规范

| 控件 | 使用场景 |
| --- | --- |
| Icon button | 删除、刷新、下载、回滚、展开、复制等明确命令。 |
| Segmented control | 在互斥模式间切换。 |
| BinaryCheckbox | 单个 boolean 选项。 |
| BinaryToggle | 两态选择，两个状态语义都可见或明显。 |
| Tooltip | 命名不熟悉图标或解释短状态。 |
| DataTable | 审计、工具、grants、jobs、sources、assets 等可扫描数据。 |
| Drawer / Dialog | 风险操作、详情、编辑、配置导入、证据预览。 |

## 可访问性

- 可点击元素必须有明确 label、focus state 和 disabled state。
- 颜色不能作为唯一状态信号。
- 表格、列表、树和按钮文本应可被屏幕阅读器理解。
- 长路径、operation id、tool id 和错误信息必须支持复制。

## 设计验证

设计变更至少运行：

```bash
npm run server:verify:frontend-typecheck
npm run server:verify:design-system
npm run client:analyze
npm run client:test
```

服务端控制台重大视觉变更还应通过浏览器截图或手工检查确认无溢出、遮挡和空白关键区域。
