---
name: pact-knowledge-skill-maintainer
description: "Use when maintaining Pact internal KnowledgeSkill and shared skill-management runtime: skill registry/frameworks, knowledge.skills.* operations, agent skill planning, skill proposals, evaluation, deployment, rollback, or distilling existing knowledge into reusable skills."
---

# Pact KnowledgeSkill Maintainer

## Purpose

Maintain Pact's runtime KnowledgeSkill system. This is not a Codex local skill folder: runtime skills live under Pact server data and are loaded by agents through skill profiles, workspace context, Tool Management, and the knowledge-agent skill protocol.

## Boundaries

- Skill management is a shared capability, not an agent's private memory, workspace state, or temporary context.
- A KnowledgeSkill is reusable evidence-backed operating guidance; it is not canonical fact storage.
- Canonical facts remain in `knowledge.search`, evidence packs, assets, graph, and KnowledgeCore or external `knowledgeBase` mounts.
- Skills should reference `evidenceRefs`; do not copy large evidence payloads into skill bundles.
- Model use must be explicit (`modelEnabled=true` or equivalent). Published skills require quality gates and review or deployment approval unless the caller deliberately forces a bypass.

## Source Map

- Protocol: `docs/protocols/PROTOCOLS.md`, sections for Tool Management, skill management, and `pact.knowledge-agent-skill.v1`.
- Runtime: `server/platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs`.
- Shared skill boundary: `server/platform/specialized/capabilities/skills/README.md`.
- Operations: `server/platform/common/operation-dispatcher/operation-registry.mjs`.
- Framework config: `server/config/entity-config/skills/knowledge-skill-framework/framework.json`.
- Data: `<userDataPath>/knowledge-skills/knowledge-skills.sqlite`, `bundles/<skillId>/`, `skill-evaluation-runs.json`, and `skill-deployments.json`.

## Workflow

1. Inspect current docs and operation registry before changing behavior; this area moves with Tool Management and knowledge runtime.
2. For agent Q&A, use `knowledge.agent_skill.plan` or `pact.agentLibrary.agentSkill.plan` before search so intent, coarse branch, evidence needs, rewrite, and validation are explicit.
3. List or read skills with `GET /api/knowledge/skills`, `GET /api/knowledge/skills/:skillId`, CLI `knowledge skills`, or Tool Management ids `pact.agentLibrary.skills.list/get`.
4. Generate corpus-backed skills with `POST /api/knowledge/skills/generate` or `knowledge skills generate --query QUERY`; keep `pending_review` unless review/deployment explicitly approves publishing.
5. Accept agent-created proposals through `POST /api/knowledge/skills/propose`; require `title`, `summary`, `decisionHeuristics`, `honestBoundaries`, `evidenceRefs`, and a reuse reason.
6. Resolve lifecycle with `knowledge.skills.resolve` actions: `publish`, `reject`, `archive`, `draft`, or `pending_review`. Do not use `force` unless bypassing the quality gate is the explicit task.
7. Evaluate and deploy SkillSets with `knowledge.skills.evaluation.runs.create`, `knowledge.skills.deployments.create`, and `knowledge.skills.deployments.rollback`; prefer canary before active.
8. For batch creation from existing data, run `npm run server:knowledge:distill-skills -- --dry-run` first, then rerun without `--dry-run` only after the selected topics and evidence counts look correct.

## Tool Management

External agents should use `/api/tool-management/v1/execute` with grant tokens instead of direct Console `/api/knowledge/*` routes. Useful tool ids include:

- `pact.agentLibrary.agentSkill`
- `pact.agentLibrary.agentSkill.plan`
- `pact.agentLibrary.agentSkill.run`
- `pact.agentLibrary.skills.list`
- `pact.agentLibrary.skills.get`
- `pact.agentLibrary.skills.generate`
- `pact.agentLibrary.skills.propose`
- `pact.agentLibrary.skills.resolve`
- `pact.agentLibrary.skillFramework`
- `pact.agentLibrary.skillFramework.set`
- `pact.agentLibrary.skills.evaluation.runs.create`
- `pact.agentLibrary.skills.deployments.create`
- `pact.agentLibrary.skills.deployments.rollback`

## Verification

Run `npm run server:verify:knowledge-skillization` after changing runtime behavior, framework rules, operation routing, or agent exploration skill use. Add `npm run server:verify:agent-exploration` when tool calls or workspace context changed, and `npm run server:verify:tool-management` when tool ids, scopes, grants, or catalog generation changed.
