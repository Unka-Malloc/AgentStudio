# Pact Client Design System

This document describes the visual and interaction direction for the Pact
Flutter desktop client. Product scope is controlled by
[`docs/CLIENT_ARCHITECTURE.md`](../docs/CLIENT_ARCHITECTURE.md).

## Product Identity

Pact Client is a lightweight local environment manager for a developer's
machine. It makes target-native MCP configuration, local Skill Hub state, thin
model forwarding, and configuration recovery understandable without becoming a
new agent framework.

The UI must feel:

1. **Local**: actions should map to visible local targets, config files,
   snapshots, and CLI-backed operations.
2. **Precise**: every write path should show what target, path, field, token
   reference, or snapshot is affected.
3. **Quiet**: the app is an operational tool, not a marketing surface or a
   server console clone.

The client must not present removed Console, Mail, DataConnector, upload queue,
Knowledge Graph, or server API panels as first-class product surfaces.

## Navigation

The app uses a desktop split view with a stable first-level sidebar. The only
default sections are:

- Agents
- MCP Plugins
- Skill Hub
- Model Forwarding
- Activity And Snapshots
- Settings

Each section should expose concrete target state and actions. Avoid generic
dashboard pages that summarize the product instead of helping the user inspect
or change local configuration.

## Visual Language

The client can share primitive brand colors with the server console, but it
should be less dense and more file/config oriented. Use restrained surfaces,
clear list rows, compact status chips, path previews, and diff/snapshot details.

| Role | Light Value | Dark Value | Usage |
| --- | --- | --- | --- |
| App background | `#F9FAFB` | `#111827` | Window background |
| Surface | `#FFFFFF` | `#1F2937` | Panels, dialogs, repeated cards |
| Accent | `#2563EB` | `#3B82F6` | Primary actions, active navigation |
| Success | `#16A34A` | `#22C55E` | Configured, paired, verified |
| Warning | `#D97706` | `#F59E0B` | Pending, deferred, conflict |
| Danger | `#DC2626` | `#EF4444` | Failed, revoked, destructive |
| Text primary | `#111827` | `#F9FAFB` | Headings and primary values |
| Text secondary | `#4B5563` | `#9CA3AF` | Metadata and descriptions |
| Border | `#E5E7EB` | `#374151` | Dividers and panel borders |

## Typography

Use system fonts for a native desktop feel. Use monospace text only for paths,
commands, JSON snippets, token environment variable names, and target-native
configuration fields.

## Module Guidance

### Agents

Show supported targets, detection confidence, binary/config paths, manual add
entries, and pairing state. Scanning is conservative and must not imply that
the client launched or authorized an agent.

The supported target list is OpenClaw, Claude Code, Codex, Gemini CLI,
Antigravity, OpenCode, Copilot, Kilo Code, Cursor, Hermes Agent, and Windsurf.

### MCP Plugins

Treat Pact MCP as a peer plugin. Show target-native MCP fields, version/status
when available, update/repair triggers, and rollback actions backed by local
snapshots.

### Skill Hub

Present the Hub as passive local storage. Pairing, visibility, pinning, and
integrity state are product concepts; executing Skills, installing dependencies,
or copying Skills into workspaces are outside the client boundary.

### Model Forwarding

Forwarding controls should make the selected profile and target explicit. The
UI should not suggest that Pact Client owns a planner, hidden tool loop, or
long-running autonomous session.

### Activity And Snapshots

Activity should read like an audit trail for local client actions. Snapshot
views must show enough target/path/hash context for rollback decisions without
turning into a full filesystem backup interface.

### Settings

Settings covers known paths, manual binaries, portable data root, server
profile, and client preferences. It should not become a registry for server
business modules or removed local runtime services.

## Accessibility

- Text contrast must meet WCAG AA.
- All command buttons, lists, and dialogs must be keyboard navigable.
- Icon-only controls require tooltips.
- Long paths, command output, and config previews must wrap or scroll without
  obscuring adjacent controls.
