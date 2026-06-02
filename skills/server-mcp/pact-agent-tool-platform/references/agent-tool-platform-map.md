# Agent Tool Platform Map

Implementation:

- `server/platform/specialized/capabilities/tools/tool-management-core/catalog.mjs`
- `server/platform/specialized/capabilities/tools/tool-management-core/store.mjs`
- `server/platform/specialized/capabilities/tools/tool-management-core/policy.mjs`
- `server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs`
- `server/platform/specialized/capabilities/tools/tool-management-core/http.mjs`
- `server/config/entity-config/tools/{scopes,toolsets,profiles}/`
- `server/platform/specialized/capabilities/skills/README.md` is the sibling shared skill-management boundary.
- Legacy `/api/tool-platform/*` and `/api/agent-tools/*` are removed; verify scripts expect 404.

Scopes:

- `knowledge:read`
- `knowledge:write`
- `knowledge:maintain`
- `knowledge:admin`
- `storage:read`
- `jobs:read`
- `agent_sync:publish`

Primary APIs:

- `GET /api/tool-management/v1/catalog`
- `GET /api/tool-management/v1/catalog/:toolId`
- `GET /api/tool-management/v1/toolsets`
- `POST /api/tool-management/v1/toolsets/resolve`
- `GET /api/tool-management/v1/profiles`
- `POST /api/tool-management/v1/policy/evaluate`
- `POST /api/tool-management/v1/policy/preview`
- `POST /api/tool-management/v1/execute`
- `POST /api/tool-management/v1/dry-run`
- `POST /api/tool-management/v1/batch`
- `GET /api/tool-management/v1/grants`
- `POST /api/tool-management/v1/grants`
- `POST /api/tool-management/v1/grants/:grantId`
- `POST /api/tool-management/v1/grants/:grantId/rotate`
- `POST /api/tool-management/v1/grants/:grantId/revoke`
- `GET /api/tool-management/v1/audit`
- `GET /api/tool-management/v1/audit/:toolExecutionId`
- `GET /api/tool-management/v1/metrics/summary`
- `GET /api/tool-management/v1/events`

Toolsets:

- `pact.knowledge.read`
- `pact.knowledge.write`
- `pact.knowledge.maintain`
- `pact.knowledge.admin`
- `pact.storage.read`
- `pact.jobs.read`
- `pact.document.parse`
- `pact.document.convert`
- `pact.mail.import`
- `pact.result.export`
- `pact.agent.workspace`
- `pact.agent.sync.publish`
- `pact.runtime.read`
- `pact.runtime.maintain`
- `pact.mount.dev`
- `pact.admin`

Example tools:

- `pact.storageSummary`
- `pact.jobs.list`
- `pact.jobs.get`
- `pact.knowledge.affairTaxonomy`
- `pact.knowledge.search`
- `pact.knowledge.documentStructure`
- `pact.knowledge.evidence`
- `pact.knowledge.renderMarkdown`
- `pact.knowledge.agentSkill`
- `pact.knowledge.agentSkill.plan`
- `pact.knowledge.agentSkill.run`
- `pact.knowledge.skills.list`
- `pact.knowledge.skills.get`
- `pact.knowledge.skills.generate`
- `pact.knowledge.skills.propose`
- `pact.knowledge.skills.resolve`
- `pact.knowledge.skillFramework`
- `pact.knowledge.skills.evaluation.runs.create`
- `pact.knowledge.skills.deployments.create`
- `pact.knowledge.skills.deployments.rollback`
- `pact.knowledge.health`
- `agent-exploration.keyword_search`
- `agent-exploration.knowledge_skill_search`
- `agent-exploration.knowledge_skill_propose`
- `maintenance-agent.storage.doctor`

Authentication:

- Console catalog/grant/audit/metrics routes use Console auth and RBAC.
- Use bearer token or `x-pact-tool-token`.
- Grants are stored in `<userDataPath>/tool-management/tool-management.sqlite`.
- Token plaintext is returned only on create or rotate; store only hashes.
- Rotate or revoke tokens instead of editing token values manually.
- Grant changes require `x-pact-safety-confirm: true` from console/CLI callers.
- Grant tokens execute tools through `/api/tool-management/v1/execute`, `/dry-run`, or `/batch`; they must not be used as direct Console API credentials.
