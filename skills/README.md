# Pact Maintenance Skills

`skills/` 是 Pact 仓库内置维护 Skills 的源代码目录。这里的内容属于项目本身，用于维护、诊断、迁移、审计和操作本仓库。

这些 Skills 不是服务端运行数据，不得迁移到 `~/.pact-server-data`、`.pact-server-data` 或其他运行时数据目录。运行时产物、缓存、数据库、日志和上传对象继续使用 `ServerConfig.getDataDir()` 解析的数据目录。

## 目录分类

- `server-ops`: 服务端运行、配置、存储、上传、checkpoint、回归检查、导出和运行环境诊断。
- `server-knowledge`: 知识库、解析器、OCR、邮件规则、向量/图存储、分析模块和知识技能维护。
- `server-mcp`: MCP Hub、工具平台、授权、上传审计、Gerrit 代码评审兼容和连接器相关维护。
- `server-web`: 管理控制台和 Web UI 相关维护。
- `client`: 客户端配置、便携数据布局和客户端/服务端契约维护。
- `project-history`: 项目历史、开发记录、迁移来源和代理会话归档。

## 维护原则

- 新增 Pact 专用维护 Skill 时，必须放在 `skills/<category>/<skill-name>/`。
- 每个 Skill 目录必须包含 `SKILL.md`，辅助脚本、模板和参考资料放在该 Skill 自己的 `scripts/`、`assets/`、`references/` 子目录下。
- 不要把 Pact 专用 Skill 放到用户级 `.codex/skills` 作为唯一来源；用户级 Skills 只能作为外部安装副本或个人覆盖。
- 不要把 Skills 放入服务端数据目录。数据目录只承载运行时状态，不承载仓库维护源文件。
- 通用 Skills 例如 PDF、Playwright、文档处理、图片生成等不属于 Pact 仓库，不应复制到这里。

## 命名说明

Pact 仓库内置维护 Skill 统一使用 `pact-*` 前缀。历史项目名只能出现在 `project-history/pact-history-miner` 这类需要检索迁移来源的上下文中；新增或维护其他 Skill 时，不要恢复旧项目前缀。
