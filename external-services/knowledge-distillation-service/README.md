# External Knowledge Distillation Service

Standalone HTTP service used to verify and evolve Pact external distillation registration. This service is the only maintained knowledge distillation algorithm surface; embedded `knowledge.distillation.*` platform implementations are deprecated migration shims and must not receive new parser, routing, or distillation work.

The service is intentionally standalone. It exposes a route-first, windowed, classified distillation baseline that separates unrelated source groups before producing human-readable Markdown and an agent-readable JSON message. The local reference framework manifest tracks the open-source systems Pact uses for ongoing comparison.

The service does not hide unsupported binary parsing behind a generic Tika call. Every source first receives a `routePlan` based on extension, media type, source kind, and text fallback. Archive entries and email attachments are recursively routed as child documents before distillable text is split into bounded windows, so large projects can converge through window, document, project-domain, topic-group, and project layers.

Request payloads can provide either direct text fields or a base64 file payload:

- Direct text: `text`, `content`, `markdown`, or `body`.
- File payload: `contentBase64`, `base64`, `dataBase64`, or `bytesBase64`.
- Mounted single-node file payload: `filePath`, `contentPath`, `inputPath`, or `contentRef` under the configured input roots. Text, Markdown, source code, CSV/TSV, JSON/JSONC, and JSONL references are scanned in chunks into window plans instead of being loaded as one full in-memory payload.
- Streaming document manifest: `rawDocumentsManifestPath`, `rawDocumentsManifestRef`, `documentsManifestPath`, or `manifestPath` can point to an allowed JSONL manifest. The service streams the manifest line by line, then routes each referenced document through the same filePath/contentRef parser chain so large project requests do not need large JSON bodies.
- Mounted archive payloads are expanded from their file path through ZIP/TAR/TGZ/7z extractors; child entries are routed as documents and streamable text entries use chunked windowing.
- Mounted PDF payloads use Poppler `pdftotext` into a temporary text stream and then the normal windowing path.
- Mounted OOXML payloads, including DOCX/DOCM/DOTX/DOTM, PPTX/PPTM/PPSX/PPSM/POTX/POTM, XLSX/XLSM/XLTX/XLTM, plus OpenDocument and EPUB payloads, are expanded as ZIP containers from their file path. The parser selects only structural XML/XHTML entries, uses bounded in-memory reads for native element extraction, and falls back to streaming structural text when a selected entry is too large.
- Mounted legacy Office and RTF payloads such as DOC/DOT, PPT/PPS/POT, XLS/XLSB, and RTF use Apache Tika from their file path into temporary text, then the normal windowing path is used for distillation.
- Oversized mounted binary files without a format-specific text parser use `bounded-binary-file-profile.v1`: the service streams a hash and bounded head/tail byte sample, records route and size evidence, and avoids direct in-memory reads without pretending binary bytes are text.
- File hints: `fileName`, `mediaType`, `byteSize`, `sourceId`, and optional `metadata`.

API namespace:

- `GET /health`
- `GET /v1/capabilities`
- `GET /v1/runtime/health`
- `GET /v1/reference-frameworks`
- `GET /v1/reference-gap-report`
- `GET /v1/distillation/runs`
- `POST /v1/distillation/runs`
- `GET /v1/distillation/runs/:runId`
- `POST /v1/distillation/runs/:runId/cancel`
- `GET /v1/distillation/runs/:runId/evidence`
- `GET /v1/projects/:projectId/evidence`
- `GET /v1/distillation/runs/:runId/artifacts/:artifactId`

Artifacts:

- `portable-markdown`: human-readable classified distillation output.
- `portable-docx`: valid OpenXML Word document for human review; Markdown headings, lists, code blocks, routing tables, and hyperlinks are converted into native Word paragraph styles, table XML, and OpenXML hyperlink relationships instead of plain text lines.
- `console-summary-json`: control-plane summary for humans, with document rows, route IDs, file sizes, parse status, openability, conversion risk, and quality gate counts while omitting parser traces and full window payloads.
- `agent-message-json`: machine-readable classification and evidence message for agents.
- `result-json`: full run record.
- `project-snapshot-json`: project-level fingerprint, text-unit/window hashes, group snapshot, and incremental diff plan.
- `evidence-pack-json`: GraphRAG-style text units, entities, relationships, claims/covariates, communities, and community reports.
- `format-conversion-plan-json`: per-document professional parser/conversion plan, adapter matrix, quality gate results, and output artifact validation for PDF, Word, PowerPoint, Excel, Markdown, and OpenDocument.
- `professional-format-manifest-json`: agent-readable professional format manifest listing every source document's parser profile, structure units, conversion adapters, preserves, quality gate results, risk controls, known losses, and openability state.
- `reference-gap-report-json`: machine-readable comparison between the service and local RAGFlow, MinerU, Docling, LlamaIndex, Marker, GraphRAG, Haystack, and Unstructured checkouts.
- `workspace-package-zip`: complete delivery package with Markdown, DOCX, agent JSON, result JSON, snapshot, evidence pack, manifest sizes/hashes, and artifact validation status.

Professional office-document adaptation contract:

| Family | Parser profile | Required preserved evidence |
| --- | --- | --- |
| PDF | `pdf.text-layout-ocr-route` | Page order, basic text geometry, URI links, outline/bookmark refs, AcroForm/widget field refs, subtype/risk flags, OCR fallback trace. |
| Word | `wordprocessingml-paragraph-style-route` | Heading/list style refs, table cells, headers, footers, content controls, bookmarks, hyperlinks, images, charts, comments, footnotes, endnotes, tracked-change revisions. |
| PowerPoint | `presentationml-slide-route` | Slide order, slide layout/master inheritance refs, shape id/name, placeholder, bbox, tables, hyperlinks, images, charts, speaker notes, comments. |
| Excel | `spreadsheetml-sheet-row-cell-route` | Workbook sheet id/name/state/path, defined names, named ranges, print areas, row/cell refs, merged cells, comments, date serials, formulas, hyperlinks, chart drawings, time index. |
| Markdown | `markdown-block-element-route` | YAML/TOML frontmatter key-value refs, heading tree, tables, code-fence language/line refs, blockquotes, links, images, block refs without Tika XHTML noise. |

Core response fields:

- `runtimeDoctor`: optional parser runtime availability for Java/Tika fallback, PyMuPDF, Poppler, Tesseract, and PaddleOCR.
- `routePlan`: per-source declared extension/media type, sniffed content signature, content shape, parser chain, fallback parsers, risk flags, and reference frameworks.
- `corpusPlan`: route-then-window source plan with byte counts, character counts, element counts, window counts, and evidence strength.
- `pdfProfile`: PDF subtype evidence for PDF sources, including `pdf-text`, `pdf-scanned`, `pdf-font-broken`, `pdf-image-heavy`, `pdf-encrypted`, or `pdf-empty-or-unknown`, plus image/font/ToUnicode counts, URI annotation links, and extraction character counts.
- `elementPlan`: document-element model for structured sources, with element type counts, sampled element metadata, and by-title chunking references.
- `parserTrace`: per-source parser stages, including `content.signature`, direct text, JSON, CSV/TSV, mounted file references, chunked text windowing, MSG Tika extraction, MBOX message splitting, email attachment routing, archive child routing, and OOXML extraction.
- `classification`: hashing-embedding document groups plus window communities before distillation, with a weak-evidence garbage pool, per-topic distillation units, group cohesion, and inter-group separation scores.
- `convergence`: window-to-window-community-to-document-to-project-domain-to-topic-to-project convergence plan with domain reports, community reports, cross-domain links, and an agent query index for large project synthesis.
- `incrementalPlan`: project snapshot and reuse plan keyed by `projectId`/`workspaceId`/`repositoryId`, with added, changed, removed, and reusable source/window counts.
- `graphEvidence`: graph-lite evidence pack containing `text_units`, `entities`, `relationships`, `covariates`, `communities`, and `community_reports`.
- `referenceGapReport`: absorbed patterns, baseline patterns, open gaps, and local checkout audit status mapped from the reference framework manifest.
- `formatConversionPlan`: source-format adapter matrix, parser stages, structure units, conversion adapters, evaluated quality gates, risk controls, openability targets, output artifact self-checks, and per-document evidence for PDF, Word, PowerPoint, Excel, Markdown, and OpenDocument. DOCX self-checks verify OpenXML package structure plus heading style, list/code style, Word table readiness, and hyperlink relationship integrity.
- `modeSeparation`: `human-agent-response-profile-separation.v1` separates console artifacts from agent artifacts: console output avoids parser trace noise, while agent output carries parser, element, window, quality gate, evidence, and convergence payloads.
- `grounding`: claim-to-evidence top-k support, cross-topic conflict evidence, and candidate promotion gates for generated summaries and requested claims.
- `timeRange` and `timeSignals`: document/window-level time hints extracted from table date fields such as `payment_date`, `Report Date`, or localized date headers so agents can filter evidence by time without reparsing table text.
- `evidence query`: bounded agent API over `graphEvidence` filtered by entity, relationship, claim status, claim text, domain, route id, source id, group id, and time range.
- `project evidence query`: project-level agent API that merges graph evidence from multiple runs sharing the same `projectId`, preserving `sourceRunId`, project fingerprints, incremental modes, domain metadata, and bounded graph tables for large-project convergence reads.

Agent/API requests can include a `timeFilter` object:

- `from` and `to`: inclusive `YYYY-MM-DD` date range.
- `timeField`: `eventTime`, `documentTime`, or `any`.
- `confidenceMin`: minimum date extraction confidence.
- `excludeWeakEvidence`: remove undated or low-confidence evidence from the filtered corpus.
- `includeUnknownTime`: keep undated evidence when strict exclusion is not requested.

Routed format families:

- PDF: subtype routing before distillation, text extraction, URI annotation links, outline/bookmark destinations, AcroForm/widget field refs, visual layout fallback, OCR fallback, and text-operator geometry (`page`, `x/y`, approximate `bbox`) for evidence windows and conversion profiles.
- Office and OpenDocument: DOC/DOT/DOCX/DOCM/DOTX/DOTM, RTF, PPT/PPS/POT/PPTX/PPTM/PPSX/PPSM/POTX/POTM, XLS/XLSB/XLSX/XLSM/XLTX/XLTM, ODT/ODS/ODP with paragraph, heading, Word paragraph style and numbering refs, Word header/footer part refs, Word content controls/bookmarks, Word hyperlinks/images/charts/comments/footnotes/endnotes/tracked-change revisions, Word/PowerPoint/OpenDocument table row/cell metadata, OpenDocument hyperlinks, slide, PresentationML slide layout/master inheritance refs, shape id/name, placeholder, chart, comment, and geometry refs, PowerPoint hyperlinks/images/charts and speaker notes, workbook sheet name/id/state/path, defined names/named ranges/print areas, sheet-row, cell-coordinate, SpreadsheetML merged-cell/comment/date style/date serial/formula/hyperlink/chart metadata, and table/chart elements for OOXML/OpenDocument payloads.
- Ebooks: EPUB.
- Text, configuration, and structured data: Markdown, TXT, YAML, TOML, INI, properties, dotenv, JSON, JSONC, JSONL, CSV, TSV, and logs. Markdown is parsed as frontmatter key-value refs plus block elements with heading, table, code-fence language/line refs, blockquote refs, link refs, and image refs rather than treated as plain text.
- Markup documents: HTML, XHTML, XML, reStructuredText, AsciiDoc, Org, LaTeX, and MediaWiki with element-type extraction.
- Diagrams: SVG, draw.io, Mermaid, and PlantUML with node, edge, and label extraction.
- Notebooks: Jupyter `.ipynb` with markdown, code, and output cell extraction.
- Change sets: Git/unified `.diff` and `.patch` with file, hunk, addition, and deletion extraction.
- Email: EML, MSG, MBOX with attachment child routing.
- Images: PNG, JPEG, TIFF, WEBP, BMP, HEIC, PBM, PGM, PNM.
- Source code: JavaScript, TypeScript, Python, Java, Go, Rust, Swift, Kotlin, C, and C++ with static import/symbol extraction.
- Calendar events: iCalendar `.ics` and vCalendar `.vcs` with event/todo and timeline extraction.
- Recursively routed ZIP, TAR, GZip/TGZ, and 7z archives.

Built-in payload parsers:

- Direct text, Markdown frontmatter/block structure, markup structure, and source code text.
- Markup normalization for HTML/XHTML/XML/RST/AsciiDoc/Org/LaTeX/MediaWiki headings, lists, links, table rows, code blocks, citations, and formulas.
- JSON, JSONC, and JSONL normalization, with mounted JSON/JSONC file references using `structured-json-file-ref-streaming-window.v1` instead of binary fallback when they exceed the direct-read threshold.
- Configuration key-value normalization for YAML, TOML, INI, properties, and dotenv files.
- Diagram structure normalization for SVG, draw.io, Mermaid, and PlantUML files.
- Jupyter Notebook cell normalization for `.ipynb` files.
- Source code structure normalization for imports, symbols, entry points, TODOs, and line-aware excerpts without executing code.
- Unified diff/patch normalization for changed files, hunks, additions, deletions, and context lines.
- iCalendar/vCalendar normalization for events, todos, dates, locations, organizers, and descriptions.
- CSV and TSV row normalization.
- EML-style header/body extraction.
- MSG binary text extraction through Apache Tika for direct payloads and mounted file references.
- MBOX mailbox splitting into child EML messages, preserving message-level trace and recursively routed attachments.
- MIME attachment extraction with recursive child-file routing.
- Basic text PDF content streams, including FlateDecode streams where text operators are present.
- PDF subtype routing emits `pdf.subtype-route`, `pdf.hyperlinks`, `pdf.outlines`, `pdf.form-fields`, and `pdfProfile` so agents can distinguish text PDFs, scanned PDFs, font-mapping-risk PDFs, image-heavy PDFs, encrypted PDFs, empty/unknown PDFs, URI annotations, outline/bookmark refs, and AcroForm/widget fields without rescanning parser traces.
- Image OCR through Tesseract when `tesseract-ocr` is installed.
- Scanned PDF OCR through Poppler page rasterization plus Tesseract when both runtimes are installed.
- Mounted file references from configured input roots, with chunked text windowing for streamable text formats, including oversized JSON/JSONC payloads.
- Bounded binary file profiles for oversized or unknown file references without a text parser, emitted as `payload.file-ref-binary-profile`.
- Mounted archive file references with child-entry file refs, so project packages do not need to be base64 encoded or fully loaded into Node memory.
- Mounted PDF file references with Poppler `pdftotext` extraction into chunked windows.
- Mounted structured ZIP file references for OOXML document/presentation/spreadsheet macro and template variants, ODT/ODS/ODP, and EPUB, with structural text extraction into chunked windows or element-aware windows when native OOXML structure is available.
- Mounted structured ZIP file references expose `structured-zip.structural-entry-plan`; large selected structural entries use `structured-zip.large-entry-stream` instead of forcing a whole XML entry into memory.
- DOCX and PPTX extraction preserves image and chart relationship IDs, resolved package targets, chart title/type/series metadata, DOCX header/footer part refs, PPTX slide layout/master inheritance refs, alt text/title/description, and slide geometry where available, without loading binary media as text.
- XLSX extraction preserves workbook sheet name/id/state/path, defined names/named ranges/print areas, header row, row number, cell reference, merged-cell range/master ref, cell comment author/text/relationship target, style index, date number format, normalized ISO date, original date serial, formula, chart drawing relationships, chart title/type/series metadata, and `header=value` pairs so table/chart evidence can be classified and grounded without losing cell context.
- XLSX, CSV, and TSV table rows feed a table time index when date-like headers are present; extracted dates are attached to document and window records as `timeRange`, `timeConfidence`, and `timeSignals`.
- Mounted legacy Office file references for DOC/DOT, PPT/PPS/POT, XLS/XLSB, and RTF through Apache Tika into chunked windows.
- ZIP, TAR, and GZip/TGZ manifest extraction plus child-file routing for project packages.
- 7z extraction through the packaged `7zz`/`7z` runtime when available.
- OOXML container extraction for document, presentation, slideshow, template, macro-enabled, and spreadsheet template variants.
- Content-signature routing for mislabeled or generic `application/octet-stream` PDF, DOCX, PPTX, XLSX, OpenDocument, EPUB, image, archive, RTF, and HTML payloads before Tika fallback.
- OpenDocument extraction for ODT, ODS, and ODP with content order, table cell refs, and `xlink:href` references.
- EPUB chapter extraction.
- Apache Tika app fallback for legacy Office and other binary text extraction routes when Java/Tika is installed.

Container runtime:

- The Docker image installs Poppler and Tesseract English OCR so scanned PDF and image OCR paths are executable in single-node deployment.
- The Docker image installs Java and Apache Tika app so legacy Office fallback is executable without relying on the embedded Pact server.
- The Docker image installs 7zip so 7z project packages can be expanded as child documents.
- `npm run server:verify:external-knowledge-distillation-container` builds the image, starts the service, checks `/v1/runtime/health`, and verifies OCR image, text PDF hyperlinks/forms, image-only scanned PDF, legacy Office fallback, OpenDocument, EPUB, project ZIP/TAR/TGZ/7z packages, mounted file references, streaming JSONL document manifests, mounted archive packages, mounted PDF payloads, mounted DOCX/PPTX/XLSX/OpenDocument/EPUB payloads, signature-routed generic PDF/DOCX/PPTX/XLSX payloads, mounted DOC/PPT/XLS/RTF payloads, configuration files, markup files, diagram files, notebook files, source code files, diff/patch files, calendar files, MSG Tika extraction, MBOX mailbox splitting, and email attachment payloads become distillable corpus through `content.signature`, `ocr.image`, `ocr.page`, `tika.text`, `tika.text.file-ref`, `open-document.structured`, `open-document.tables`, `open-document.hyperlinks`, `office.word.styles`, `office.word.numbering`, `office.word.headers-footers`, `office.word.content-controls`, `office.word.bookmarks`, `office.word.revisions`, `office.word.hyperlinks`, `office.word.images`, `office.word.charts`, `office.presentation.layouts`, `office.presentation.placeholders`, `office.presentation.tables`, `office.presentation.hyperlinks`, `office.presentation.images`, `office.presentation.charts`, `office.presentation.speaker-notes`, `office.presentation.comments`, `ebook.epub`, `pdf.text.pdftotext`, `pdf.hyperlinks`, `pdf.outlines`, `pdf.form-fields`, `structured-zip.file-ref.extract`, `table.workbook.sheets`, `table.workbook.defined-names`, `table.sheet.headers`, `table.sheet.cells`, `table.sheet.merged-cells`, `table.sheet.comments`, `table.sheet.date-styles`, `table.sheet.formulas`, `table.sheet.hyperlinks`, `table.sheet.charts`, `table.time-index`, `config.key-value`, `markup.structure`, `diagram.structure`, `notebook.cells`, `code.structure`, `diff.unified`, `calendar.ics`, `archive.expand-route`, `archive.file-ref.expand`, `archive.entry-file-ref`, `archive.tar.container`, `archive.gzip.decompress`, `archive.7z.extract`, `input.manifest.jsonl`, `payload.file-ref`, `payload.stream-text`, `email.msg.tika`, `email.msg.tika.file-ref`, `email.mbox`, `email.mbox-route`, and `email.attachment-route`.

External runtime still required:

- PDF visual layout extraction.
- Multimodal image understanding.

When these runtimes are unavailable, parser traces use `unavailable` rather than hiding the failure. When a runtime is installed but this baseline service has not executed that parser stage, traces use `available-not-executed`.

If no distillable text can be produced, the run is marked `failed` with `EMPTY_RAW_CORPUS`; the service does not return a fake successful distillation.

Built-in algorithm baseline:

- `hashing_embedding_window_community_classification_v3`: dependency-free 128-dimensional semantic hashing vectors with fixed concept dimensions, document-level Leader-Clustering, semantic concept topic hierarchy, assignment rationale, per-topic window communities, low-coupling/high-cohesion separation scores, weak-evidence exclusion reasons, and isolated distillation units for unrelated input sets.
- `inline-or-streaming-manifest-document-input.v1`: accepts small API bodies that reference JSONL manifests, streams manifest records from disk, and sends each record through the normal route-first file parser path for large project distillation.
- `structured-json-file-ref-streaming-window.v1`: keeps large mounted JSON/JSONC files in the structured-data route, streams them into windows with a bounded sample parser trace, and avoids misclassifying them as unknown binary.
- `content-signature-routing.v1`: samples bounded head bytes before extension/media routing so mislabeled PDF, OOXML Word/PowerPoint/Excel, OpenDocument, EPUB, images, archives, RTF, and HTML still enter their professional parser chain instead of falling into Tika or unknown binary handling.
- `claim-evidence-topk-conflict-gating.v2`: every generated summary claim and optional requested claim is matched back to top-k evidence, checked against cross-topic conflicts, and used to gate candidate promotion.
- `project-snapshot-incremental-convergence.v1`: stores a compact project snapshot and compares later runs for the same project to reuse unchanged text units/window communities and recompute only changed windows before convergence.
- `graph-lite-entity-relationship-evidence-pack.v1`: builds deterministic text-unit, entity, relationship, claim/covariate, community, and community-report tables for agent retrieval and graph-style inspection.
- `graph-lite-evidence-query.v1`: returns filtered graph evidence slices for agent reads without requiring full evidence-pack artifact scans.
- `hierarchical-domain-topic-project-convergence.v3`: adds a project-domain layer, domain reports, cross-domain links, and `agent-project-convergence-query-index.v1` for global/local project reads.
- `project-graph-evidence-convergence-query.v1`: merges graph evidence across project runs and supports `mode=all|latest`, `runLimit`, domain, route, source, entity, claim, group, and time filters for engineering-project convergence queries.
- `document-element-model.v1` and `element-aware-by-title-windowing.v1`: keep structured elements, heading paths, table/code/image/chart/annotation/form isolation, element refs, Markdown frontmatter/code-fence/blockquotes/links/images, basic PDF geometry, URI annotation links, outline/bookmark refs, and AcroForm/widget fields, Word paragraph style/list numbering refs, Word header/footer refs, Word content controls/bookmarks, Word hyperlinks/images/charts/annotations/revisions, Word/PowerPoint/OpenDocument table cells, OpenDocument hyperlinks, PowerPoint slide layout/master refs, shape id/name/placeholders, PowerPoint hyperlinks/images/charts/comments and speaker notes, spreadsheet workbook sheet refs/defined names/named ranges/print areas/cell coordinates/merged-cell ranges/comments/date serials/formulas/hyperlinks/charts, and PresentationML shape geometry on agent windows and graph text units.
- `pdf-subtype-routing.v1`: turns PDF parser signals into machine-readable subtype, risk flags, image/font/ToUnicode counts, text/OCR/Tika character counts, and route-level `pdfSubtype`.
- `office-document-professional-adaptation.v1`: exposes a professional adapter matrix and per-document parsing/conversion profiles for PDF, Word, PowerPoint, Excel, Markdown, and OpenDocument, separating human-readable exports from agent-readable JSON/evidence packs while recording quality gates, including PDF outline/form-field preservation, Markdown frontmatter/code-fence/blockquote preservation, Office image/chart references, Word header/footer/content-control/bookmark/revision preservation, PowerPoint slide layout/master preservation, Excel defined-name/named-range/print-area preservation, Excel merged-cell/comment/chart preservation, Excel date serial normalization, and known loss boundaries.
- `human-agent-response-profile-separation.v1` and `professional-format-manifest.v1`: split control-plane summaries from agent payloads and make professional parsing/conversion evidence queryable without scanning the full result JSON.
- `bounded-binary-file-profile.v1`: handles oversized or unknown file references with streaming hash plus bounded byte sampling, preventing memory-heavy direct reads while keeping unsupported assets visible to agents.
- `reference-framework-gap-report.v1`: maps local reference framework learnings to absorbed service capabilities, baseline-only patterns, and open gaps that still need parser, graph, pipeline, or evaluation work.
- `reference-framework-local-checkout-audit.v1`: verifies each declared local reference checkout exists, is a Git worktree, and matches the manifest commit before treating it as a current comparison source.
- Weak or tiny inputs are assigned to a garbage group and are not promoted as core distillation candidates.

Reference patterns currently absorbed into the local baseline:

- GraphRAG-style text units, entities, relationships, covariates, communities, and community reports.
- GraphRAG-style community reports plus domain/topic global-local read models for corpus-wide convergence.
- GraphRAG-style period/size snapshots and text-unit ids for incremental merges.
- LlamaIndex-style node/window metadata attached to agent-readable outputs.
- Haystack-style explicit pipeline stages exposed through route plans, parser traces, and capability metadata.
- Haystack-style pipeline snapshots for replayable agent/debug context.
- Docling/Haystack-style converter boundaries for HTML, Markdown, AsciiDoc, XML, LaTeX-like markup, OOXML, OpenDocument, EPUB, and PDF text documents.
- Docling-style basic PDF text-block geometry derived from text positioning operators, plus PresentationML shape id/name, placeholder, and bbox metadata for slide evidence.
- Unstructured-style element families for Markdown frontmatter, code fences, blockquotes, markup, and structured-document headings, paragraphs, lists, links, images, table headers, table rows, defined names, named ranges, print areas, merged-cell ranges, cell comments, code, citations, formulas, PDF outlines/forms, Word header/footer/content controls/bookmarks/revisions, Word/PowerPoint/OpenDocument hyperlinks, PowerPoint slide layout/master refs, comments/placeholders, and spreadsheet hyperlinks.
- Unstructured `chunk_by_title`-style element-aware windows with table/code isolation, plus LlamaIndex-style node refs in graph text-unit metadata.

Reference framework checkout root:

- `build/reference-frameworks/knowledge-distillation`

Reference framework audit:

- `npm run server:external-kd:references` audits the pinned local checkouts from `reference-frameworks.json`.
- `npm run server:external-kd:sync-references -- --only graphrag` fetches and checks out one pinned reference; omit `--only` to synchronize every framework.
- `npm run server:verify:external-knowledge-distillation-references` verifies the local reference tree is present and each checkout matches the manifest commit.
- `/v1/reference-frameworks`, `/v1/capabilities`, and `/v1/reference-gap-report` expose `localAudit` with expected, present, Git checkout, commit-match, dirty, missing counts, and repair commands.
- Single-node Docker images do not include the large reference checkout tree by default; in that case `localAudit` reports missing checkouts explicitly instead of implying live comparison.
