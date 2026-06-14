# Document Evaluation Corpus

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Current maintained document
- Scope: Document Evaluation Corpus.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

本文定义 Pact 文档解析、知识蒸馏、邮件导入和 openability 回归使用的测评集位置和治理规则。

## 目录规则

测评集不得放入项目源码目录。所有公开下载样本、本机 Mail 导出样本、真实 PDF/Office/邮件样本、大文件样本和敏感样本统一放在：

```text
~/.pact-server-data/evaluation-corpora/
```

建议子目录：

```text
~/.pact-server-data/evaluation-corpora/
  public-documents/
    govdocs1/
    apache-poi/
    apache-tika/
    docx-corpus/
  mail/
    messages/
    exports/
    reports/
  manifests/
  reports/
```

项目内只允许保留：

- 下载脚本和选择策略。
- manifest 模板和 schema。
- hash、size、source URL、license、format、risk label 等元数据。
- 小型合成 fixture。
- verifier 源码。

当前仓库内的最小事实源：

- `docs/examples/document-evaluation-corpus-manifest.schema.json`
- `docs/examples/document-evaluation-corpus-manifest.template.json`
- `docs/examples/document-evaluation-corpus-public-smoke.json`
- `docs/examples/document-evaluation-corpus-mail-local.template.json`

项目内不允许保留：

- 公开测评集原始文件。
- 本机 Mail 原文、`.eml`、`.mbox`、`.msg`。
- 真实用户附件。
- 大型 PDF/Office/PPT/Excel 样本。
- 从真实样本导出的全文、正文片段或可逆摘要。

## 第一批公开来源

公开测评集先用于覆盖格式和 parser 边界，不直接进入仓库：

| Source | 用途 | 处理方式 |
| --- | --- | --- |
| Govdocs1 / Digital Corpora | 混合真实文件、PDF、Office、旧格式、异常文件 | 下载小 subset 到 `public-documents/govdocs1/`，运行前做 hash manifest 和风险标记。 |
| Apache POI test-data | DOCX/XLSX/PPTX/OLE2/OpenXML 边界样本 | 下载选定文件到 `public-documents/apache-poi/`，覆盖 Office openability 和结构解析。 |
| Apache Tika test documents | Tika parser 边界和批量解析样本 | 下载选定文件到 `public-documents/apache-tika/`，覆盖 parser fallback 和元数据提取。 |
| docx-corpus | 大量真实 DOCX | 只拉取小型 manifest 子集到 `public-documents/docx-corpus/`，不全量下载。 |
| Enron Email Dataset | 公开邮件语料 | 可作为邮件 parser 的公开对照集；本机 Mail 样本仍作为真实复杂度主样本。 |

## 本机 Mail 样本

维护者已允许使用本机 Mail 邮件作为测评样本。使用规则：

- 原始邮件只写入 `~/.pact-server-data/evaluation-corpora/mail/`。
- 运行报告只记录 message count、hash、size、format、thread/attachment 统计、错误码和不可逆摘要。
- 不把邮件正文、联系人、主题、附件内容或可还原片段写入仓库。
- 需要人工复核时，从外部数据目录打开 evidence，不通过 Git 记录原文。

相关脚本默认输出到外部目录：

```sh
node scripts/collect-dedupe-emails.mjs --root <mail-export-dir>
node scripts/split-mbox-corpus.mjs
```

## Manifest 字段

每个样本集至少维护一份 manifest，放在外部目录或以脱敏形式放入 `docs/`：

推荐直接复用仓库内模板与 schema：

- `docs/examples/document-evaluation-corpus-manifest.schema.json`
- `docs/examples/document-evaluation-corpus-manifest.template.json`
- `docs/examples/document-evaluation-corpus-public-smoke.json`
- `docs/examples/document-evaluation-corpus-mail-local.template.json`

```json
{
  "schemaVersion": "v0.0.1:schema:definition-1",
  "corpusId": "public-documents-smoke",
  "storageRoot": "~/.pact-server-data/evaluation-corpora/public-documents",
  "items": [
    {
      "id": "sample-001",
      "relativePath": "govdocs1/subset0/0000001.pdf",
      "source": "govdocs1",
      "sourceUrl": "https://downloads.digitalcorpora.org/corpora/files/govdocs1/",
      "licenseOrTerms": "source-defined",
      "sha256": "...",
      "byteSize": 0,
      "format": "pdf",
      "openability": {
        "expectedStatus": "opens",
        "verificationHints": ["macos-quick-look", "libreoffice"]
      },
      "structureAnchors": [
        { "anchorType": "page", "description": "首页标题块仍可定位" }
      ],
      "exportExpectations": [
        {
          "targetFormat": "docx",
          "expectedStatus": "opens",
          "checks": ["docx-export-opens", "structure-headings-preserved"]
        }
      ],
      "riskLabels": ["public", "untrusted-parser-input"],
      "expectedChecks": ["text-extracts", "metadata-extracts", "docx-export-opens"]
    }
  ]
}
```

`docs/examples/document-evaluation-corpus-public-smoke.json` 提供第一批公开 PDF/DOCX/XLSX/PPTX 的脱敏 manifest 占位，用于记录四类样本的 openability、结构锚点和导出预期，而不把真实文件带入仓库。

`docs/examples/document-evaluation-corpus-mail-local.template.json` 提供本机 Mail 样本的脱敏 manifest 模板，只允许记录外部路径、hash、message/thread/attachment 计数、格式和错误码，不允许记录主题、正文、联系人或附件内容。

## Verifier 原则

- CI 只跑小型合成 fixture 和 manifest/schema 检查。
- 本机或 release 前运行真实测评集 verifier。
- 所有真实文件按 untrusted input 处理，解析过程必须有 timeout、size limit、sandbox 或容器边界。
- openability 验证优先使用系统工具、LibreOffice、macOS Quick Look 或可脚本化检查；失败必须产生机器可读原因。
