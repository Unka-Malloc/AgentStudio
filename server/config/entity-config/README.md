# Pact Entity Configs

This directory stores human-maintainable configuration entities as folders and lightweight bundles.

- `tools/`: tool-management scopes, toolsets, and agent profiles.
- `skills/`: Skill Hub package metadata and legacy compatibility skill bundles. Built-in module abilities should not add new primary configuration here.
- `playbooks/`: built-in AgentLibrary Playbook, Retrieval Playbook, and Playbook Framework bundles that are owned by the knowledge module rather than Skill Hub.
- `runbooks/`: built-in operational procedures shipped with modules. These are not Skill Hub contributed skill assets.
- `standards/`: human governance standards and golden-rule policy packages.
- `specs/`: protocol, import, source, and runtime configuration specs.

Large payloads should not be copied into these bundles. Use a manifest entry with a source locator, checksum, and expected loader instead.
