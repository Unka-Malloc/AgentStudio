# Resource Management Module (资源管理)

`server/platform/common/resource-management` 负责 Pact 系统中底层物理资源（包括本地盘空间、缓存、CPU/GPU 限流与配额等）的统一协调与调度，以防止智能体（Agent）因过度请求或异常写入导致系统资源耗尽。

## 模块定位
- **层级**：基建层 (Common / Infrastructure)
- **依赖限制**：作为底层基建，本模块绝对禁止依赖或引入任何应用层业务逻辑。

## 核心职责
1. **资源配额与限制**：限制和审计底层缓存文件、临时工作空间所占用的最大存储水位。
2. **本地盘调度与垃圾回收**：统管临时缓存文件与垃圾文件的生命周期，实现定时主动清理与安全回收。
3. **子模块归口管理**：
   - **存储子模块 (`storage`)**：物理存储与元数据持久化设施（如 SQLite、LSM Ingest 管道、CAS 块存储等）作为本模块的核心下属能力，由资源管理层提供统一的资源供给与维护保障。
   - **工作队列子模块 (`work-queue`)**：平台基建层通用调度队列，拥有 Work Item 调度状态、状态机、journal/projection、worker runtime 合同和 store adapter conformance；不拥有业务 job 状态、payload、结果或 workflow history。
