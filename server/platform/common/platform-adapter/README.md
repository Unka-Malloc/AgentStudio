# Platform Adapter Module (平台适配)

`server/platform/common/platform-adapter` 负责适配底层操作系统和运行环境（本机、容器、虚拟机等），处理异构运行时对接与平台差异化屏蔽。

## 模块定位
- **层级**：基建层 (Common / Infrastructure)
- **依赖限制**：作为底层基建，本模块绝对禁止依赖或引入任何应用层业务逻辑（如 `specialized/agent` 或 `specialized/knowledge`）。

## 核心职责
1. **环境嗅探与适配**：检测当前运行环境（例如 MacOS、Linux、Windows），并适配标准接口调用。
2. **异构运行时桥接**：为外部或本地环境的虚拟机、容器运行时提供一致性的接口抽象。
3. **平台基础垫片**：提供统一的底层环境 Polling、平台属性映射以及与外置工具交互的轻量级驱动兼容。
