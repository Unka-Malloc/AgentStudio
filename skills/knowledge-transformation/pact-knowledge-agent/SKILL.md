---
name: pact-knowledge-agent
description: "Use when an agent needs to operate a Pact knowledge base through agent tools, including hierarchical search, graph lookup, evidence reading, feedback submission, suggestions, review queues, learning jobs, or maintenance. Requires coarse-to-fine retrieval: classify the broad branch before using fine-grained evidence."
---

# Pact Knowledge Agent

## Core Rule

Always use hierarchical retrieval. Do not start by blindly searching tiny evidence chunks.

DOCX exports are offline corpus artifacts for other knowledge bases. Agents should not use exported DOCX as the live context channel; use `knowledge.search`, evidence packs, and Markdown rendering for runtime grounding.

The required order is:

1. Plan intent, broad branch, evidence needs, query rewrite, and validation with `/api/knowledge/agent-skill/plan` or tool id `pact.agentLibrary.agentSkill.plan` when available.
2. Discover available tools and scopes from `/api/tool-management/v1/catalog` or `/toolsets/resolve`.
3. Use `/api/tool-management/v1/execute` with tool id `pact.agentLibrary.search` and `explain: true`. Console-authenticated UI/runtime code may call `/api/knowledge/search` directly.
4. Inspect `result.hierarchy.selected` before trusting item-level hits.
5. Follow the selected collection/document/section branch into item, graph, evidence, and Markdown tools.
6. Submit feedback for useful, weak, or missing results.

The agent may be wrong on the finest evidence, but should not skip broad classification. If the broad branch looks weak, broaden at the hierarchy level first; do not jump directly to arbitrary chunk search.

## Tool Scopes

- `knowledge:read`: search, sync, item, evidence, asset, graph, health, suggestions/review lists, learning health.
- `knowledge:write`: taxonomy enhancement, structured changes, feedback.
- `knowledge:maintain`: maintenance run, learning jobs, reindex, review/suggestion resolution.
- `knowledge:admin`: knowledge maintenance/retrieval settings.

Use the minimum grant scope. Do not log or paste grant tokens.

## Retrieval Workflow

Use this sequence for question answering:

```http
POST /api/tool-management/v1/execute
Authorization: Bearer <token>
Content-Type: application/json

{
  "toolId": "pact.agentLibrary.search",
  "input": {
    "query": "...",
    "limit": 8,
    "learningEnabled": true,
    "explain": true
  }
}
```

Then:

- If `hierarchy.enforced` is true, treat selected documents/sections as the search boundary.
- If selected branches are obviously too broad, rerun with a clearer query or filters.
- If selected branches are empty, check `knowledge.health` and `knowledge.learning.health`, then try a broader query.
- Use `pact.agentLibrary.item` for structured detail.
- Use `pact.agentLibrary.evidence` or `pact.agentLibrary.renderMarkdown` before making claims.
- Use `pact.agentLibrary.graph` for relation expansion after a branch is selected.

Do not use old `/api/tool-platform/*` or `/api/agent-tools/*` routes unless the current checkout has explicitly reintroduced them; this repo's current server docs mark them as removed.

For corpus handoff rather than answering, use the registered DOCX export surfaces:

- `knowledge export-docx --output knowledge.docx`
- `GET /api/knowledge/export/docx`
- `jobs normalized-doc` for per-job raw-materials-to-normalized-docx outputs.

## Feedback

Write feedback after meaningful interactions:

- `open`: evidence helped.
- `copy` or `export`: evidence was useful enough to reuse.
- `downvote`: result was wrong or misleading.
- `no_result`: the query failed or selected the wrong branch.

Feedback is safe to submit with `knowledge:write`; it improves retrieval profiles and suggestions without changing canonical facts.

## Mutation Boundaries

Allowed with review or scoped tools:

- Structured field patches.
- Tags, categories, relation suggestions, notes.
- Feedback and learning jobs.

Never directly rewrite:

- Raw evidence.
- Normalized document text.
- Canonical entity/relation/fact data without review.
- Taxonomy structure without explicit review resolution.

## Maintenance

Routine safe tasks:

- `validate_assets`
- `repair_missing_thumbnails`
- `compare_retrieval_profiles`
- `learning_run`
- `validate_quality`

High-impact tasks such as `reindex`, `reembed_by_model_version`, and orphan deletion require maintain/admin scope and explicit confirmation.
