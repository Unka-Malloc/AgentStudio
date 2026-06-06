# Pact Entity Config Layout

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: Pact Entity Config Layout.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

Pact uses folder-managed entity configs for human-maintainable runtime
entities. Single JSON files remain acceptable only for singleton snapshots such
as `settings.json`, `discovery.json`, or event/state caches.

## Source Bundles

- `server/config/entity-config/tools/`
  - `scopes/*.json`
  - `toolsets/*.json`
  - `profiles/*.json`
  - Loaded by Tool Management before falling back to built-in defaults.
- `server/config/entity-config/skills/`
  - Skill bundles use `manifest.json`, `README.md`, and `dependencies.json`.
  - `knowledge-skill-framework/framework.json` is the default framework source.
- `server/config/entity-config/standards/`
  - Governance standards, including golden-rule package metadata.
- `server/config/entity-config/specs/`
  - Protocol or runtime configuration specs such as import file types and
    source search rules.

## Runtime Entity Stores

- `<userDataPath>/model-agents/<agent_id>.json`
  - One model agent per JSON entity.
- `<userDataPath>/model-settings/<provider>.json`
  - One provider settings file per model provider.
- `<userDataPath>/tool-management/execution.json`
  - Singleton execution policy for local/HTTP tool execution.
- `<userDataPath>/knowledge-golden/packages/<packageId>/`
  - `manifest.json` plus versioned golden-rule payloads.
- `<userDataPath>/knowledge-skills/bundles/<skillId>/`
  - Lightweight KnowledgeSkill bundle with `manifest.json`, `skill.json`,
    `dependencies.json`, `evidence-refs.json`, `quality.json`, and `README.md`.

## Bundle Policy

Lightweight bundles may inline small JSON instructions, metadata, dependencies,
and human-readable manuals. Heavy artifacts must be referenced by manifest only,
with source locator, checksum, and expected loader. Evidence payloads should not
be copied into skill bundles; use evidence ids and dependency declarations.

## Verification

Run:

```bash
npm run server:verify:entity-config-layout
```

The verifier checks tool entity files, skill framework bundles, generated
KnowledgeSkill bundles, model-agent split files, golden-rule package manifests,
and knowledge package manifests.
