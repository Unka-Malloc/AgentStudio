# Resource Operation Interface Draft

> 历史归档标注：本文是旧资源操作草案，不再作为当前 operation 清单事实源。当前 operation 入口、协议 facade 和 MCP 五入口以 `docs/PROTOCOLS.md`、Operation Registry 和 verifier 为准。

> 讨论草案。本文只用于沉淀资源操作接口清单，后续定稿后应合并回 `PROTOCOLS.md`、`Architecture.md` 或对应核心治理文档。

## 设计原则

- 第一列是权限组。权限组是一对多授权边界，可以覆盖多个具体操作接口。
- 第二列是实际操作接口。接口名只表达一个动作，不把不同语义的操作混在一起。
- 第三列是接口参数。参数可以让同一动作指向不同对象，例如 `repo.status` 可以通过 `targetType` 查看不同对象的状态。
- 第四列是描述。描述必须说明接口边界，尤其是哪些动作需要升级到更高权限。
- 本地智能体已经能直接执行的普通本地命令，不必默认重复包装成 Pact MCP 能力；Pact MCP 优先治理跨边界、需审计、需授权或需协作系统状态同步的动作。

## 代码库

| 权限 | 操作接口 | 参数 | 描述 |
| --- | --- | --- | --- |
| `repo:read` | `repo.status` | `repoId`, `targetType`, `targetId?`, `ref?` | 查看指定对象状态，例如 worktree、branch、remote、ci、pr、change。 |
| `repo:read` | `repo.file.read` | `repoId`, `path`, `ref?` | 读取文件内容。 |
| `repo:read` | `repo.tree.list` | `repoId`, `path?`, `ref?` | 列出目录树。 |
| `repo:read` | `repo.diff.read` | `repoId`, `baseRef`, `headRef` | 读取两个 ref 之间的 diff。 |
| `repo:read` | `repo.commit.read` | `repoId`, `commitRef` | 读取 commit 信息。 |
| `repo:write` | `repo.file.create` | `repoId`, `path`, `content`, `branch?` | 创建新文件。 |
| `repo:write` | `repo.file.update` | `repoId`, `path`, `content`, `branch?` | 更新已有文件。 |
| `repo:write` | `repo.file.delete` | `repoId`, `path`, `branch?` | 删除文件。 |
| `repo:write` | `repo.file.move` | `repoId`, `fromPath`, `toPath`, `branch?` | 移动或重命名文件。 |
| `repo:write` | `repo.branch.create` | `repoId`, `branchName`, `baseRef` | 创建新分支。 |
| `repo:write` | `repo.branch.checkout` | `repoId`, `branchName` | 切换工作分支。 |
| `repo:write` | `repo.commit.create` | `repoId`, `branch`, `message`, `changes?`, `changeSetId?` | 创建 commit。`changes` 可直接携带文件变更；`changeSetId` 可引用已准备的受控变更集。 |
| `repo:write` | `repo.push` | `repoId`, `remote`, `sourceRef`, `targetRef`, `force?` | 推送分支、commit 或 patch set。`force=true`、推受保护分支或覆盖远端历史应升级到 `repo:maintain` 或 `repo:admin`。 |
| `repo:write` | `repo.proposal.create` | `repoId`, `sourceRef`, `targetRef`, `title`, `body?` | 创建 PR、MR 或 Gerrit Change，发起代码评审。 |
| `repo:review` | `repo.review.comment` | `repoId`, `reviewTarget`, `body`, `comments?` | 提交普通评论。 |
| `repo:review` | `repo.review.requestChanges` | `repoId`, `reviewTarget`, `body`, `comments?` | 请求修改。 |
| `repo:approve` | `repo.review.approve` | `repoId`, `reviewTarget`, `body?`, `label?` | 批准 PR、MR 或 Gerrit Change，例如 GitHub approve 或 Gerrit `+1/+2`。 |
| `repo:maintain` | `repo.merge` | `repoId`, `reviewTarget`, `strategy?`, `confirm` | 合并 PR 或 MR。 |
| `repo:maintain` | `repo.submit` | `repoId`, `changeId`, `confirm` | Gerrit submit。 |
| `repo:maintain` | `repo.rebase` | `repoId`, `targetRef`, `baseRef`, `confirm` | rebase 分支或 change。 |
| `repo:maintain` | `repo.revert` | `repoId`, `targetRef`, `reason?`, `confirm` | 回滚 commit、PR 或 change。 |
| `repo:maintain` | `repo.proposal.close` | `repoId`, `reviewTarget`, `reason?`, `confirm` | 关闭 PR 或 MR。 |
| `repo:maintain` | `repo.change.abandon` | `repoId`, `changeId`, `reason?`, `confirm` | Gerrit abandon。 |
| `repo:admin` | `repo.protection.set` | `repoId`, `branchPattern`, `rules`, `confirm` | 设置保护分支规则。 |
| `repo:admin` | `repo.webhook.set` | `repoId`, `webhookId?`, `payload`, `confirm` | 创建或更新 webhook。 |
| `repo:admin` | `repo.member.set` | `repoId`, `subjectId`, `role`, `confirm` | 管理成员权限。 |

## 云盘/文件空间

`driveId` 表示一个已连接的云盘、团队盘、用户盘或 Pact workspace 文件空间挂载。外部云盘可以用 provider 原生 `itemId`，Pact workspace 文件空间可以把 `path` 映射为文件定位符。

| 权限 | 操作接口 | 参数 | 描述 |
| --- | --- | --- | --- |
| `drive:read` | `drive.status` | `driveId?`, `targetType`, `targetId?`, `path?` | 查看指定对象状态，例如 account、mount、quota、root、folder、file、syncJob、webhook。 |
| `drive:read` | `drive.account.list` | `provider?`, `status?` | 列出已连接账号或可用云盘挂载。 |
| `drive:read` | `drive.item.get` | `driveId`, `itemId?`, `path?`, `fields?` | 读取文件或文件夹元信息，不下载正文内容。 |
| `drive:read` | `drive.folder.list` | `driveId`, `folderId?`, `path?`, `recursive?`, `pageToken?`, `limit?` | 列出文件夹内容。 |
| `drive:read` | `drive.search` | `driveId`, `query`, `folderId?`, `mimeTypes?`, `modifiedSince?`, `pageToken?`, `limit?` | 搜索云盘文件或文件夹。 |
| `drive:read` | `drive.file.download` | `driveId`, `fileId?`, `path?`, `revisionId?`, `range?`, `format?` | 下载文件内容或导出指定格式内容。允许 provider 直接流转到客户端/Agent，但必须生成 transfer receipt、byte count、digest/etag/version、完成状态和失败原因，不能静默丢失。 |
| `drive:read` | `drive.revision.list` | `driveId`, `fileId?`, `path?`, `pageToken?`, `limit?` | 列出文件版本历史。 |
| `drive:read` | `drive.revision.download` | `driveId`, `fileId?`, `path?`, `revisionId`, `format?` | 下载指定历史版本。 |
| `drive:write` | `drive.folder.create` | `driveId`, `parentId?`, `parentPath?`, `name`, `conflictPolicy?` | 创建新文件夹；v0.0.1 需要 policy 允许，冲突时转 proposal。 |
| `drive:write` | `drive.file.upload` | `driveId`, `parentId?`, `parentPath?`, `name`, `content?`, `contentBase64?`, `mimeType?`, `conflictPolicy?` | 上传新文件；覆盖已有对象、冲突或替换内容必须转 proposal。 |
| `drive:write` | `drive.file.update` | `driveId`, `fileId?`, `path?`, `content?`, `contentBase64?`, `mimeType?`, `ifRevisionId?` | 更新已有文件内容；v0.0.1 强制 proposal + 审核或高权限确认。 |
| `drive:write` | `drive.item.copy` | `driveId`, `itemId?`, `path?`, `targetParentId?`, `targetParentPath?`, `newName?` | 复制文件或文件夹；跨位置复制或冲突时强制 proposal。 |
| `drive:write` | `drive.item.move` | `driveId`, `itemId?`, `path?`, `targetParentId?`, `targetParentPath?`, `conflictPolicy?` | 移动文件或文件夹；v0.0.1 强制 proposal + 审核或高权限确认。 |
| `drive:write` | `drive.item.rename` | `driveId`, `itemId?`, `path?`, `newName`, `conflictPolicy?` | 重命名文件或文件夹；v0.0.1 强制 proposal + 审核或高权限确认。 |
| `drive:write` | `drive.item.trash` | `driveId`, `itemId?`, `path?`, `confirm` | 移入回收站或软删除；v0.0.1 强制 proposal + 审核或高权限确认。 |
| `drive:write` | `drive.item.restore` | `driveId`, `itemId`, `targetParentId?`, `targetParentPath?`, `confirm` | 从回收站恢复文件或文件夹；v0.0.1 强制 proposal + 审核或高权限确认。 |
| `drive:share` | `drive.permission.list` | `driveId`, `itemId?`, `path?` | 读取文件或文件夹 ACL、共享成员和共享链接状态。 |
| `drive:share` | `drive.permission.create` | `driveId`, `itemId?`, `path?`, `principal`, `role`, `expiresAt?`, `notify?`, `confirm` | 新增共享授权。 |
| `drive:share` | `drive.permission.update` | `driveId`, `itemId?`, `path?`, `permissionId`, `role`, `expiresAt?`, `confirm` | 更新已有共享授权。 |
| `drive:share` | `drive.permission.delete` | `driveId`, `itemId?`, `path?`, `permissionId`, `confirm` | 删除共享授权。 |
| `drive:share` | `drive.link.create` | `driveId`, `itemId?`, `path?`, `scope`, `role`, `expiresAt?`, `confirm` | 创建共享链接。 |
| `drive:share` | `drive.link.delete` | `driveId`, `itemId?`, `path?`, `linkId`, `confirm` | 删除共享链接。 |
| `drive:sync` | `drive.sync.plan` | `driveId`, `scope`, `direction`, `sinceCursor?`, `dryRun?` | 生成同步计划，不直接写入目标。 |
| `drive:sync` | `drive.sync.run` | `driveId`, `scope`, `direction`, `sinceCursor?`, `conflictPolicy?`, `confirm?` | 执行同步任务；默认只增不删，覆盖/删除/冲突必须生成 proposal 并审核。 |
| `drive:sync` | `drive.sync.cancel` | `driveId`, `syncJobId`, `reason?`, `confirm` | 取消正在运行的同步任务。 |
| `drive:maintain` | `drive.item.purge` | `driveId`, `itemId`, `confirm` | 永久删除文件或文件夹，不能只用普通 `drive:write`；v0.0.1 强制 proposal + 高权限确认。 |
| `drive:maintain` | `drive.trash.empty` | `driveId`, `scope?`, `confirm` | 清空回收站或按范围永久清理；v0.0.1 强制 proposal + 高权限确认。 |
| `drive:maintain` | `drive.sync.reconcile` | `driveId`, `scope?`, `confirm` | 对账云盘索引、游标、本地镜像或导入记录。 |
| `drive:admin` | `drive.account.connect` | `provider`, `authFlow`, `scopes`, `redirectUri?`, `confirm` | 发起云盘账号连接或 OAuth 授权。 |
| `drive:admin` | `drive.account.disconnect` | `driveId`, `revokeRemoteToken?`, `confirm` | 断开云盘账号或挂载。 |
| `drive:admin` | `drive.mount.set` | `driveId?`, `provider`, `rootId?`, `rootPath?`, `policy`, `confirm` | 创建或更新云盘挂载配置。 |
| `drive:admin` | `drive.mount.delete` | `driveId`, `removeLocalMirror?`, `confirm` | 删除云盘挂载配置。 |
| `drive:admin` | `drive.webhook.set` | `driveId`, `eventTypes`, `callbackUrl?`, `secretRef?`, `confirm` | 创建或更新云盘变更通知 webhook。 |
| `drive:admin` | `drive.webhook.delete` | `driveId`, `webhookId`, `confirm` | 删除云盘 webhook。 |

## 知识库

`knowledgeId` 表示一个知识库实例或知识空间。知识库至少分为原始语料、索引证据和蒸馏背景三层：原始语料负责入库和可追溯材料，索引证据是 canonical 查询边界，蒸馏结果只作为运行时上下文背景，不能替代 canonical evidence。

| 权限 | 操作接口 | 参数 | 描述 |
| --- | --- | --- | --- |
| `knowledge:read` | `knowledge.status` | `knowledgeId?`, `targetType`, `targetId?` | 查看指定对象状态，例如 source、index、retrieval、distillation、evaluation、maintenance。 |
| `knowledge:read` | `knowledge.source.list` | `knowledgeId?`, `sourceType?`, `status?`, `pageToken?`, `limit?` | 列出知识源。 |
| `knowledge:read` | `knowledge.source.get` | `knowledgeId`, `sourceId`, `includeStats?` | 读取知识源元信息和入库状态。 |
| `knowledge:read` | `knowledge.search` | `knowledgeId`, `query`, `sourceIds?`, `topK?`, `retrievalProfile?`, `contextBudget?`, `explain?` | 检索 canonical evidence。默认不调用模型；需要模型参与时必须显式传入相关开关和模型参数。 |
| `knowledge:read` | `knowledge.item.get` | `knowledgeId`, `itemId`, `includeEvidence?` | 读取知识条目或索引对象。 |
| `knowledge:read` | `knowledge.document.structure` | `knowledgeId`, `documentId`, `contextBudget?`, `continuationToken?` | 读取文档结构、标题树、source ranges 和结构质量信息。 |
| `knowledge:read` | `knowledge.evidence.get` | `knowledgeId`, `evidenceId`, `contextBudget?`, `payloadBudget?`, `continuationToken?` | 读取 evidence pack。返回证据、引用、结构片段和可追溯元数据。 |
| `knowledge:read` | `knowledge.asset.download` | `knowledgeId`, `assetId`, `variant?`, `range?` | 下载知识资产，例如图片、附件、OCR 资产或归一化材料；返回的是下载状态响应/transfer id，不是文件系统句柄。 |
| `knowledge:read` | `knowledge.graph.query` | `knowledgeId`, `query`, `nodeIds?`, `edgeTypes?`, `depth?`, `limit?` | 查询实体、关系和图谱邻域。 |
| `knowledge:write` | `knowledge.source.create` | `knowledgeId`, `sourceType`, `locator`, `metadata?`, `ingestPolicy?` | 注册新的知识源。可以指向本地目录、云盘文件、上传对象、邮件包或外部知识源。 |
| `knowledge:write` | `knowledge.source.update` | `knowledgeId`, `sourceId`, `metadata?`, `ingestPolicy?` | 更新知识源元信息或入库策略。 |
| `knowledge:write` | `knowledge.source.refresh` | `knowledgeId`, `sourceId`, `mode?`, `sinceCursor?`, `confirm?` | 刷新单个知识源并生成新的入库/索引任务。 |
| `knowledge:write` | `knowledge.sources.refresh` | `knowledgeId`, `sourceIds?`, `mode?`, `sinceCursor?`, `confirm?` | 批量刷新知识源。 |
| `knowledge:write` | `knowledge.document.parse` | `knowledgeId`, `sourceRef`, `parserOptions?`, `granularity?`, `dryRun?` | 解析或预解析文档，产出结构化语料和可索引材料。 |
| `knowledge:write` | `knowledge.feedback.create` | `knowledgeId`, `targetType`, `targetId`, `feedback`, `evidenceRefs?` | 提交反馈，不直接覆盖 canonical knowledge。 |
| `knowledge:write` | `knowledge.proposal.create` | `knowledgeId`, `proposalType`, `payload`, `evidenceRefs?`, `sourceIds?` | 创建事实、实体、关系、分类、规则或纠错建议，等待审核。 |
| `knowledge:write` | `knowledge.annotation.create` | `knowledgeId`, `targetType`, `targetId`, `annotation`, `visibility?` | 为证据、文档或条目添加注释。 |
| `knowledge:review` | `knowledge.review.list` | `knowledgeId`, `status?`, `proposalType?`, `sourceId?`, `limit?` | 列出待审核项、建议和发布候选。 |
| `knowledge:review` | `knowledge.review.comment` | `knowledgeId`, `reviewId`, `body`, `evidenceRefs?` | 对审核项发表评论。 |
| `knowledge:review` | `knowledge.review.requestChanges` | `knowledgeId`, `reviewId`, `body`, `requiredChanges?` | 要求修改审核项。 |
| `knowledge:review` | `knowledge.review.reject` | `knowledgeId`, `reviewId`, `reason`, `confirm` | 拒绝审核项。 |
| `knowledge:review` | `knowledge.review.approve` | `knowledgeId`, `reviewId`, `publishMode?`, `confirm` | 批准审核项。只有该接口可以把建议推进到 canonical knowledge 或正式规则状态。 |
| `knowledge:export` | `knowledge.export.create` | `knowledgeId`, `scope`, `format`, `includeAssets?`, `includeMachineReadable?`, `redactionPolicy?` | 导出知识包，例如 docx、markdown、html、jsonl 或离线 evidence package。属于数据出境边界。 |
| `knowledge:export` | `knowledge.export.download` | `knowledgeId`, `exportId`, `range?` | 下载已生成的知识导出包。 |
| `knowledge:export` | `knowledge.distillation.export` | `knowledgeId`, `runId`, `stageId?`, `format`, `redactionPolicy?` | 导出蒸馏结果。蒸馏结果只能作为运行时背景或工作空间材料，不作为 canonical evidence。 |
| `knowledge:maintain` | `knowledge.source.delete` | `knowledgeId`, `sourceId`, `deleteIndexedEvidence?`, `confirm` | 删除知识源或断开来源。删除已入库证据时必须显式确认。 |
| `knowledge:maintain` | `knowledge.reindex` | `knowledgeId`, `sourceIds?`, `scope?`, `profile?`, `confirm` | 重建知识索引、向量索引或结构索引。 |
| `knowledge:maintain` | `knowledge.maintenance.run` | `knowledgeId`, `checks?`, `repair?`, `confirm?` | 运行维护检查或轻量修复。 |
| `knowledge:maintain` | `knowledge.hierarchy.audit` | `knowledgeId`, `sourceIds?`, `profile?` | 审计层级索引、分类、父子结构和召回质量。 |
| `knowledge:maintain` | `knowledge.evaluation.run` | `knowledgeId`, `caseSetId?`, `retrievalProfile?`, `modelEnabled?` | 运行知识库评估，产出指标和建议，不默认发布策略。 |
| `knowledge:maintain` | `knowledge.evolution.run` | `knowledgeId`, `feedbackWindow?`, `caseSetId?`, `candidateProfile?` | 基于真实反馈或人工 case 生成演进候选。 |
| `knowledge:maintain` | `knowledge.evolution.promote` | `knowledgeId`, `deploymentId`, `confirm` | 将 canary 或候选检索策略提升为 active。 |
| `knowledge:maintain` | `knowledge.evolution.rollback` | `knowledgeId`, `deploymentId`, `confirm` | 回滚已发布的检索、分层或上下文策略。 |
| `knowledge:maintain` | `knowledge.distillation.run` | `knowledgeId`, `sourceIds?`, `scope?`, `modelAlias`, `outputProfile?`, `confirm?` | 运行知识蒸馏。蒸馏必须保留来源和校验证据，不能直接写 canonical knowledge。 |
| `knowledge:maintain` | `knowledge.distillation.cancel` | `knowledgeId`, `runId`, `reason?`, `confirm` | 取消蒸馏任务。 |
| `knowledge:maintain` | `knowledge.distillation.archive` | `knowledgeId`, `runId`, `reason?`, `confirm` | 归档蒸馏任务及其运行时背景材料。 |
| `knowledge:admin` | `knowledge.config.set` | `knowledgeId`, `configPatch`, `confirm` | 修改知识库配置。 |
| `knowledge:admin` | `knowledge.taxonomy.set` | `knowledgeId`, `taxonomyPatch`, `confirm` | 修改分类体系、实体类型或关系类型配置。 |
| `knowledge:admin` | `knowledge.accessPolicy.set` | `knowledgeId`, `policyPatch`, `confirm` | 修改知识访问、复制、导出、脱敏或 checkout 策略。 |
| `knowledge:admin` | `knowledge.modelPolicy.set` | `knowledgeId`, `modelRoles`, `budgetPolicy?`, `confirm` | 修改知识检索、蒸馏、评估和演进使用的模型角色策略。 |
| `knowledge:admin` | `knowledge.connector.set` | `knowledgeId`, `connectorId?`, `provider`, `settings`, `confirm` | 创建或更新外部知识库、向量库、图数据库或文档解析连接器配置。 |
| `knowledge:admin` | `knowledge.connector.delete` | `knowledgeId`, `connectorId`, `confirm` | 删除外部连接器配置。 |
