# Product

## Metadata / 元数据

- Last updated: 2026-06-06
- Status: Current maintained document
- Scope: Product.
- Staleness check: Scanned on 2026-06-06; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## Register

product

## Users

Pact serves developers, platform operators, and local AI-agent users who need a
controlled workspace for agent collaboration. They inspect local targets, MCP
plugin state, Skill Hub records, model forwarding profiles, shared storage,
knowledge access, operation history, snapshots, and recovery paths while doing
real configuration and governance work.

Primary user contexts:

- A developer connecting OpenClaw, Claude Code, Codex, Gemini CLI,
  Antigravity, OpenCode, Copilot, Kilo Code, Cursor, Hermes Agent, Windsurf, or
  another agent harness to a local Pact workspace.
- A platform or workspace operator reviewing permission scope, storage state,
  knowledge access, operation history, and external-service connections.
- A maintainer using CLI, web console, or desktop client flows to configure,
  repair, roll back, or verify local and server-side Pact state.

## Product Purpose

Pact is a trusted agent collaboration space and workspace operating system. It
bridges isolated local AI agents and governed knowledge or storage systems by
making agent access, workspace changes, knowledge movement, MCP integration, and
runtime governance visible, reversible, and policy-aware.

Success means users can understand the current state, see which actor or target
is affected, make a scoped change, recover from mistakes, and trace important
decisions without relying on hidden defaults or implied configuration.

## Brand Personality

Precise, local, quiet.

Pact should feel like an operational tool with strong boundaries and clear
state. It should communicate expert confidence through concrete controls,
stable layouts, readable technical labels, and restrained visual treatment. The
voice should be direct and useful, especially in Chinese operator-facing UI, and
should explain capabilities through real workflows rather than slogans.

## Anti-references

Pact should not look or read like:

- A marketing landing page, hero-first SaaS page, or decorative product tour.
- A generic dashboard that summarizes instead of letting users inspect and act.
- A dark, glowing, terminal-native AI tool aesthetic.
- A purple-blue gradient or beige/sand SaaS template.
- A server console clone in the desktop client.
- An autonomous-agent framework that implies hidden planners, default model
  bindings, or inferred configuration.
- UI that masks unsupported, empty, degraded, or unconfigured states.

## Design Principles

1. Make real state visible.
   Surfaces should expose targets, paths, scopes, actors, tokens, snapshots,
   statuses, and affected boundaries rather than abstract summaries.

2. Preserve user configuration truth.
   Empty configuration remains empty. Candidate templates can help users create
   new entries, but they should not appear as active bindings or configured
   state.

3. Keep boundaries legible.
   Agent harnesses, MCP plugins, shared storage, external services, knowledge
   stores, permission scopes, cache layers, and recovery paths should be easy to
   distinguish.

4. Favor local, reversible operations.
   Actions should show the local file, target, field, snapshot, or rollback path
   they affect whenever that context changes the user's decision.

5. Build dense product workflows, not decorative pages.
   Use tables, split panels, compact cards, drawers, toolbars, and stable lists
   to support repeated work. Avoid ornamental sections that do not help a user
   inspect, change, or recover state.

6. Make truncated values recoverable.
   UI text shortened with ellipsis because it is too long must expose the
   complete value on hover or an equivalent detail affordance. Copying is not a
   default behavior for every value; only explicit operational targets such as
   upstream endpoints, paths, or container names should be copyable, with concise
   feedback after copy. Truncation is only a layout treatment, never a loss of
   operational detail.

## Accessibility & Inclusion

Target WCAG AA contrast for product UI. All command buttons, lists, forms,
tables, dialogs, drawers, and icon-only controls should be keyboard reachable
with visible focus order. Icon-only controls need accessible names or tooltips.
Color must be paired with text for status. Long paths, identifiers, command
output, and config previews should wrap, truncate, or scroll without hiding
adjacent controls. Truncated operational values should reveal their full value
without changing layout. Copyable values must use an explicit affordance and
visible copy feedback. Motion should be short, functional, and safe for reduced
motion preferences.
