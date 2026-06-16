# Ingestion Jobs

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained functionality document
- Scope: Upload sessions, checkpoint resume, document parsing, job workflow, normalized documents, and result export.
- Staleness check: Checked against `server/protocols/checkpoint/`, `server/services/client/work-queue-core/`, `server/platform/specialized/knowledge/preprocessing/`, jobs controller, upload APIs, and CLI usage on 2026-06-16.

## 模块边界

本模块负责文件/目录进入 Pact 后的上传、校验、解析、任务、归一化文档和结果导出。知识持久化与检索归 `KNOWLEDGE`，工作空间资产归 `WORKSPACE-ASSETS`。

## 功能项 IJ-01 Upload Session

| 项 | 设计 |
| --- | --- |
| 目标 | 支持大文件和目录的分块上传、断点续传和 manifest digest 绑定。 |
| 输入 | `POST /api/upload-sessions`, `PUT /api/upload-sessions/:id/files/:index?offset=...`。 |
| 处理 | 校验 session、文件 index、offset、byte size、sha256 和 manifest digest。 |
| 输出 | session id、received bytes、offset mismatch 提示和完成状态。 |
| 错误 | 不同 manifest digest 不能复用 checkpoint；offset mismatch 返回 expected offset。 |
| 验证 | `npm run server:verify:checkpoints`。 |

## 功能项 IJ-02 Job 创建与调度

| 项 | 设计 |
| --- | --- |
| 目标 | 从 upload session 或输入路径创建导入/解析任务。 |
| 输入 | `POST /api/jobs`, CLI `npm run cli -- --path ... --wait`。 |
| 处理 | JobManager、job pipeline 和可选 Work Queue 负责排队、执行、恢复和状态持久化。 |
| 输出 | job id、status、progress、result endpoint、normalized documents endpoint。 |
| 错误 | 上传未完成、重复 manifest、解析失败或删除中的任务必须返回稳定错误。 |
| 验证 | `npm run server:verify:job-work-queue`, `npm run server:verify:ops`。 |

## 功能项 IJ-03 文档格式路由与解析

| 项 | 设计 |
| --- | --- |
| 目标 | 按 extension、media type、source kind 路由到 Tika、OCR、multimodalParser、documentParser 或自定义 mount。 |
| 输入 | 文件路径、buffer、media type hint、source kind、mount routing。 |
| 处理 | 默认 Tika 主线；OCR 处理图片/扫描件；custom mount 必须实现 `extractDocument` 或 `extractText`。 |
| 输出 | text、metadata、parserId、embeddedDocuments、normalized document。 |
| 错误 | 不支持或会丢失信息的格式应显式失败，不静默降级为空文本。 |
| 验证 | `npm run server:verify:dynamic-document-parsing`, `npm run server:verify:document-parser-dry-run`。 |

## 功能项 IJ-04 归一化文档

| 项 | 设计 |
| --- | --- |
| 目标 | 为每个 job 保存可回读的 normalized documents，便于预览、导出和证据追踪。 |
| 输入 | 解析结果、job id、document id。 |
| 处理 | pipeline 在结果持久化时生成 per-document metadata 和内容引用。 |
| 输出 | `GET /api/jobs/:jobId/normalized-documents` 和 `GET /api/jobs/:jobId/normalized-documents/:documentId`。 |
| 错误 | 不存在、未完成或权限不足时返回规范错误。 |
| 验证 | `npm run server:verify:document-preview-consistency`。 |

## 功能项 IJ-05 结果导出

| 项 | 设计 |
| --- | --- |
| 目标 | 导出 job result、canonical knowledge DOCX、per-job normalized document DOCX。 |
| 输入 | job id、result JSON、format、document id、output path。 |
| 处理 | CLI 和服务端 export operation 读取已完成结果，不调用已移除的旧 result-export endpoint。 |
| 输出 | JSON、Markdown、DOCX 或受管 artifact。 |
| 错误 | 未完成 job、未知 document id、权限不足或格式不支持时失败。 |
| 验证 | `npm run server:verify:knowledge-docx-export`。 |

## 功能项 IJ-06 Checkpoint 恢复

| 项 | 设计 |
| --- | --- |
| 目标 | 上传与任务恢复可从 checkpoint、event cursor 和 persisted job state 恢复。 |
| 输入 | checkpoint tree、upload session state、job metadata、event log。 |
| 处理 | 恢复只追加 marker 和状态迁移，不破坏历史。 |
| 输出 | 恢复后的 session/job 状态和 audit evidence。 |
| 错误 | 无法确认副作用时进入失败或 review 状态，不自动重复 destructive write。 |
| 验证 | `npm run server:verify:checkpoints`, `npm run server:verify:workspace-checkpoints`。 |
