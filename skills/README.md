# Pact Maintenance Skills

`skills/` 是 Pact 仓库内置维护 Skills 的源代码目录。这里的内容属于项目本身，用于维护、诊断、迁移、审计和操作本仓库。

这些 Skills 不是服务端运行数据，不得迁移到 `~/.pact-server-data`、`.pact-server-data` 或其他运行时数据目录。运行时产物、缓存、数据库、日志和上传对象继续使用 `ServerConfig.getDataDir()` 解析的数据目录。

## 目录分类

Pact 仓库内置维护 Skills 按系统架构图中的主要责任模块存放。目录名表达模块归属；每个 Skill 仍保持自己的 `pact-*` 触发名。

| 目录 | 架构模块 | 维护范围 |
| --- | --- | --- |
| `appearance` | 外观层 | 控制台、Web UI 组件、操作员文档和可视化维护入口。 |
| `downstream-client-aspect` | 下游客户端切面 | Pact Client、便携数据布局、客户端发现、bootstrap 和服务发现契约。 |
| `interface-wrapper` | 接口封装层 | MCP/API 入口、外部 HTTP/RPC 服务封装、请求归一化、上传事实审计和服务层边界证据。 |
| `knowledge-transformation` | 应用层 / 知识转化 | 原始语料、解析、OCR、邮件、索引、证据、AgentLibrary、外部向量库和图库适配。 |
| `sharedspace` | 应用层 / 共享空间 | 上传会话、checkpoint、断点续传和受控工作空间写入链路。 |
| `codespace` | 应用层 / 代码管理 | 源码资料、Codespace、Gerrit code review route 和代码评审兼容。 |
| `tools-skills` | 应用层 / 通用工具与技能 | Tool Management、SkillLibrary、grant、toolset、skill registry 和技能沉淀。 |
| `module-management` | 基建层 / 模块管理 | mount 合同、模块脚手架、路由实验、contract test 和 postcommit hook。 |
| `runtime-ops` | 基建层 / 运行与运维 | 服务端配置、运行时依赖、运行环境诊断和回归检查。 |
| `storage` | 基建层 / 存储 | SQLite、raw object、job artifact、结果导出和存储修复。 |
| `project-history` | 横切历史与迁移 | 项目历史、开发记录、迁移来源和代理会话归档。 |

## 维护原则

- 新增 Pact 专用维护 Skill 时，必须先映射到系统架构图中的主要责任模块，再放在 `skills/<module>/<skill-name>/`。
- 每个 Skill 目录必须包含 `SKILL.md`，辅助脚本、模板和参考资料放在该 Skill 自己的 `scripts/`、`assets/`、`references/` 子目录下。
- 不要把 Pact 专用 Skill 放到用户级 `.codex/skills` 作为唯一来源；用户级 Skills 只能作为外部安装副本或个人覆盖。
- 不要把 Skills 放入服务端数据目录。数据目录只承载运行时状态，不承载仓库维护源文件。
- 通用 Skills 例如 PDF、Playwright、文档处理、图片生成等不属于 Pact 仓库，不应复制到这里。

## 命名说明

Pact 仓库内置维护 Skill 统一使用 `pact-*` 前缀。历史项目名只能出现在 `project-history/pact-history-miner` 这类需要检索迁移来源的上下文中；新增或维护其他 Skill 时，不要恢复旧项目前缀。
