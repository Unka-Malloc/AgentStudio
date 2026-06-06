# GitHub 协作约定

这个仓库现在按“源码仓”管理，只允许这些内容进入 Git：

- 源代码
- 源码级配置文件
- 构建脚本
- 文本文档
- 轻量占位文件，例如 `.gitkeep`

默认不进 Git 的内容：

- `node_modules/`
- `.pact-agent-history/`
- `build/dist/`
- `build/release/`
- `build/server-data/`
- `client-cli/target/`
- `build/local-data/`
- `build/mailapp-full-download/`
- `server/platform/modules/knowledge/runtime/jre/` 里的 JRE 二进制
- `server/platform/modules/knowledge/tika/*.jar`
- `server/platform/modules/knowledge/ocr/runtime/` 里的 Python / PaddleOCR / 模型二进制

## 为什么这样处理

我们需要把仓库上传到 GitHub 做协同开发，但这些目录要么是：

- 本地构建产物
- 第三方运行时
- 本地任务数据
- 超大二进制

把它们放进 GitHub 会让仓库变得非常重，也会让后续 clone、fetch、review 都变差。

## 本地如何补齐运行时

运行态配置、密钥状态、provider manifest、mount config、SQLite、日志、对象存储、后台队列、本地服务状态和原始 agent history 默认都放在：

- `~/.pact-server-data/`

项目目录里的 `build/` 不能作为服务端运行数据或配置目录。

真实邮件下载件、邮箱导入件和测评语料默认放在：

- `~/.pact-server-data/evaluation-corpora/`

如果你要在本地准备完整服务运行时，运行时二进制资产放在：

- `server/platform/modules/knowledge/runtime/jre/<platform-arch>/`
- `server/platform/modules/knowledge/tika/`
- `server/platform/modules/knowledge/ocr/runtime/<platform-arch>/`

这些目录约定是当前唯一受支持的运行时资源布局；大文件本体不进 GitHub。

## 当前状态

当前仓库已经调整为：

- 忽略所有构建产物和本地运行时
- 从 Git 索引里移除大目录和二进制
- 保留说明文件和目录占位

## 重要

当前仓库历史里原先有一个带大文件的 `Initial commit`。
如果你要把“干净历史”上传到 GitHub，不要直接推这段旧历史。

建议二选一：

1. 用当前清理后的工作树重新初始化一个新的 GitHub 仓库再提交
2. 在本地重写这一个初始提交，再推送

如果你要，我下一步可以继续把这一步也做掉。
