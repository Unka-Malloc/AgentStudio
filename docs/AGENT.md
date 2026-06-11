# Docs Agent Entry

## Metadata / 元数据

- Last updated: 2026-06-12
- Status: Current maintained document
- Scope: Documentation and agent entry workflow.
- Staleness check: Scanned on 2026-06-12; this entry routes documentation tasks and does not change architecture or release/readiness claims.

## Scope

- Owns maintained documentation under `docs/`, root `AGENT.md`, and local
  collaboration guidance that helps agents choose the right context.
- Root `README.md` and `README.zh-CN.md` are product pages and are outside the
  default documentation work scope.

## First Reads

- Start with root `AGENT.md`, then this file.
- Use `docs/README.md` as the documentation index.
- Open only the core or operational document named by the task.
- Use `docs/CONTEXT.md` for glossary and domain terminology checks.

## Directory Routing

- Core architecture and governance decisions live in the five core documents
  listed in `docs/README.md`.
- `docs/adr/` is for durable architecture decisions with real trade-offs.
- `docs/scenarios/` is for scenario drafts and acceptance flows.
- `docs/testing/` is for test framework support notes.
- `docs/reports/history/` is historical material; use it for dated evidence,
  not as the first source for current behavior.

## Verification

- For docs-only changes, run `npm run server:verify:docs-governance` only when
  the change updates current maintained docs for the commit day.
- For narrow entry-file updates, check metadata, links, and `git diff --check`.
- Keep long-term decisions in existing core docs rather than adding new lateral
  design documents.

## Context Budget

- Do not read all historical reports by default.
- Prefer indexes, headings, and targeted `rg` searches before opening long core
  documents.
