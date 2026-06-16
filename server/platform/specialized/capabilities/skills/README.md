# Skill Hub Contribution Boundary

`capabilities/skills` is the shared boundary for Skill Hub contributed assets
and the MCP tool-access provider.

Skill Hub manages only skills contributed into the system by users, agents,
external teams, or workspaces. Built-in module abilities are not Skill Hub
assets: if a module depends on an ability to exist, that ability is part of the
module and should be named a playbook, runbook, framework, runtime contract, or
provider rather than a skill.

External or workspace-contributed skills must enter through the shared capability package lifecycle before they are installed or activated. The package manifest uses `v0.0.1:tool:skill-registry-1` and is governed with the same signature, dependency, compatibility, sandbox, approval, rollback, and deprecation checks as external tools. The server Skill Hub / skill library is the source of truth for skill bundles, versions, publication state, activation state, and rollback targets; workspace contribution records may reference skills for source, review, adoption, ranking, and usage statistics, but must not store or govern the skill package itself.

`tool-skill-management-provider.mjs` exposes the migration-era
`v0.0.1:tool:skill-management-1` protocol. MCP adapters and console workflows
must use that provider for capability discovery, grant authorization, local MCP
grant issuance, workspace reference projection, output sanitization, and tool
execution instead of directly touching Tool Management `registry`, `store`,
`runtime`, or `router`. The provider name does not mean built-in module
playbooks are managed by Skill Hub.

Tool execution internals stay under `capabilities/tools/tool-management-core`.
