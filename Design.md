# Pact Design.md

This document is the design contract for Pact product UI, architecture diagrams,
operator-facing pages, and AI-generated frontend work. Use it together with the
existing CSS tokens in `server-web/styles/tokens.css`.

## Product Identity

Pact is an AgentLibrary and workspace operating system for agent collaboration,
shared storage, permissions, knowledge access, external service integration, and
runtime governance.

The product should feel like a precise enterprise operations console: calm,
dense, readable, auditable, and built for repeated use. Pact screens are not
marketing pages. The first viewport of a product surface should expose real
workflows, state, controls, and operational context.

## Design Principles

1. Operational clarity comes first.
   UI should show what the operator can inspect, change, approve, route, retry,
   or audit. Decorative layout must not hide system state.

2. Dense, not crowded.
   Pact is used for workbench-style operations. Prefer compact tables, toolbars,
   segmented controls, side panels, and stable grids over oversized hero cards.

3. Boundaries must be visible.
   Agent harnesses, MCP tools, system capabilities, shared storage, external
   services, permission boundaries, cache boundaries, and gateway boundaries
   should be visually distinguishable.

4. Status must be explicit.
   Loading, empty, degraded, denied, pending, failed, synced, cached, and
   external-service states should each have clear labels and visual treatments.

5. Motion is functional.
   Use short transitions to clarify focus, reveal panels, or confirm state
   changes. Avoid ambient animation, decorative motion, and slow transitions.

6. Truncation preserves access.
   Ellipsis is allowed for dense operational UI, but it must not hide the real
   value. Truncated values should reveal full text through hover or an
   equivalent detail affordance. Copy behavior must be explicit and reserved for
   operational targets that users naturally reuse outside the table.

## Color System

Use the project tokens from `server-web/styles/tokens.css` as the source of
truth. Do not introduce one-off colors unless a feature requires a new semantic
state and the token file is updated accordingly.

### Core Tokens

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| App background | `--bg-base` | `#f3f4f6` | Main page background |
| Surface | `--bg-surface` | `#ffffff` | Panels, cards, tables, drawers |
| Subtle surface | `--bg-subtle` | `#f9fafb` | Headers, filters, secondary rows |
| Primary text | `--text-primary` | `#111827` | Main labels and content |
| Secondary text | `--text-secondary` | `#4b5563` | Descriptions and metadata |
| Muted text | `--text-muted` | `#6b7280` | Low-priority metadata |
| Subtle border | `--border-subtle` | `#e5e7eb` | Default dividers and outlines |
| Strong border | `--border-strong` | `#d1d5db` | Active or structural borders |
| Brand | `--brand` | `#2563eb` | Primary action and selected state |
| Brand strong | `--brand-strong` | `#1d4ed8` | Hover and active brand state |
| Brand subtle | `--brand-subtle` | `#eff6ff` | Selected surfaces and badges |
| Success | `--success` | `#16a34a` | Healthy, completed, allowed |
| Warning | `--warning` | `#d97706` | Risk, pending, attention |
| Danger | `--danger` | `#dc2626` | Failure, destructive, denied |

### Neutral Scale

| Token | Value |
| --- | --- |
| `--gray-0` | `#ffffff` |
| `--gray-50` | `#f9fafb` |
| `--gray-100` | `#f3f4f6` |
| `--gray-200` | `#e5e7eb` |
| `--gray-300` | `#d1d5db` |
| `--gray-400` | `#9ca3af` |
| `--gray-500` | `#6b7280` |
| `--gray-600` | `#4b5563` |
| `--gray-700` | `#374151` |
| `--gray-800` | `#1f2937` |
| `--gray-900` | `#111827` |

### Diagram Palette

Architecture diagrams should use the existing diagram palette:

| Category | Color | Suggested Meaning |
| --- | --- | --- |
| Blue | `#276d9d` | Interface, router, gateway, command flow |
| Green | `#3d7a47` | Cache, storage, persistence, workspace data |
| Purple | `#7656a8` | Agent harness, MCP plugin, client capability |
| Brown | `#8a6230` | External system, cloud service, repository target |
| Red | `#8b4a5b` | Permission, policy, risk, review boundary |
| Ink | `#17212f` | Diagram title and primary label |
| Muted | `#66758a` | Diagram subtitle and secondary metadata |
| Line | `#d4deea` | Connectors and grouping borders |
| Canvas | `#f6f8fb` | Diagram background |

Avoid pages dominated by a single hue family. In new UI, avoid purple-blue
gradients, beige/sand themes, dark slate themes, and espresso/orange palettes
unless the product domain specifically requires them.

## Typography

Use `Inter` for product UI and `IBM Plex Mono` or the configured monospace stack
for identifiers, commands, resource names, IDs, and protocol fields.

| Role | Size | Token |
| --- | --- | --- |
| Dense metadata | 9-11px | `--font-size-2xs`, `--font-size-xs` |
| Secondary UI | 12-13px | `--font-size-sm`, `--font-size-md` |
| Default UI | 14px | `--font-size-base` |
| Emphasized UI | 15-16px | `--font-size-lg`, `--font-size-xl` |
| Section heading | 18-20px | `--font-size-2xl`, `--font-size-3xl` |
| Page heading | 24px | `--font-size-4xl` |

Rules:

- Default app text is 14px.
- Do not scale font size with viewport width.
- Use clear weight changes instead of oversized type inside compact panels.
- For new work, keep letter spacing at `0` unless an existing tokenized style is
  being reused for uppercase metadata.
- Monospace text should be used sparingly and only for literal technical values.

## Layout

Pact uses a console shell:

| Area | Size |
| --- | --- |
| Sidebar | `220px` expanded, `56px` collapsed |
| Topbar | `52px` |
| Base spacing | 4px grid |
| Main content | Full-height, scrollable work area |

Layout rules:

- Use full-width work surfaces and constrained inner content where useful.
- Keep primary navigation in the sidebar and operational actions in the topbar
  or local toolbars.
- Prefer tables, split panels, detail drawers, and compact grids for repeated
  operational workflows.
- Do not place UI cards inside other cards.
- Use cards only for repeated items, modals, tool surfaces, and genuinely framed
  summaries.
- Stable UI elements such as toolbars, boards, tiles, and counters need fixed or
  constrained dimensions so hover states and dynamic labels do not shift layout.
- Text must wrap or truncate predictably and must never overlap adjacent
  controls.
- Truncated text must remain inspectable without changing layout. Hover or an
  equivalent detail affordance should reveal the full value. Copy is reserved
  for explicit operational targets, not every truncated label.

## Spacing, Radius, And Shadow

Use the spacing tokens from `--space-*`. Most UI should be built from 4, 8, 12,
16, 20, and 24px increments.

Use subtle radius:

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-sm` | `3px` | Small tags, compact controls |
| `--radius-md` | `6px` | Inputs, icon buttons, small cards |
| `--radius-lg` | `10px` | Existing larger panels and drawers |
| `--radius-pill` | `9999px` | Pills and status badges |

Prefer 6-8px visual rounding for dense cards and controls. Use larger radii only
where the existing layout already establishes that shape.

Use shadows sparingly. `--shadow-xs` and `--shadow-sm` are enough for most
surfaces. Reserve stronger shadows for drawers, popovers, and modals.

## Components

### Buttons

- Primary actions use brand blue, white text, and compact height.
- Secondary actions use white or subtle gray surfaces with gray borders.
- Icon-only buttons should use familiar lucide icons where available and include
  a tooltip or accessible label.
- Destructive actions use danger styling and should require clear context.

### Operational Copy Values

Use this pattern for literal operational values that users are likely to reuse
outside the current component: upstream endpoints, local paths, container names,
resource IDs, policy references, and similar technical targets.

- Do not style copyable values as hyperlinks unless they navigate. Copy actions
  must not use underlines or link-only color treatment.
- Render the value as a compact code-value control: monospace text, subtle
  surface background, subtle border, `--radius-sm`, single-line ellipsis, and a
  `copy` cursor.
- Hover should keep the control quiet: use `--brand` only for the border and
  `--brand-subtle` for the surface. Do not switch to a loud filled button.
- Hover and keyboard focus must show a popover or tooltip with the complete
  value. When the value sits inside an overflowed table or scroller, the tooltip
  should escape clipping with fixed positioning or a portal.
- Clicking copies the complete value and shows concise feedback such as
  `已复制`. The tooltip should not be the copy confirmation.
- Reserve this pattern for explicit copy affordances. Ordinary labels, service
  names, statuses, modes, and descriptive text should remain normal text even
  when truncated.

### Cards And Panels

- Panels should have white surfaces, subtle borders, and compact headers.
- A panel header should contain the title, status, scope, and direct actions.
- Repeated cards should expose the entity name, status, last change, and one or
  two direct actions.
- Avoid decorative cards whose only purpose is visual rhythm.

### Tables And Lists

- Tables are the default for operational records, grants, jobs, tools, resources,
  service targets, and audit events.
- Use sticky or stable headers where lists are long.
- Use one semantic value per column. Do not combine independent values such as
  execution IDs and trace IDs, PID and response time, status and timestamp,
  count and rate, or name and identifier in the same cell. If two values may be
  scanned, sorted, filtered, copied, audited, or compared separately, they must
  be rendered as separate labeled columns.
- Secondary text inside a table cell is allowed only when it describes the same
  primary value and never needs independent comparison. Operational report
  fields must favor explicit columns over stacked mixed metadata.
- Table cells that truncate paths, URLs, container names, endpoints, or other
  operational targets must preserve access to the full value. Copy affordances
  should be explicit and limited to values operators naturally reuse outside the
  table.
- Actions should be right-aligned and predictable.
- Empty states should say what is missing and provide the next valid action when
  one exists.

### Forms And Settings

- Use labels above controls for settings and policy fields.
- Use toggles or checkboxes for binary values.
- Use segmented controls for modes.
- Use select menus for finite option sets.
- Use sliders, steppers, or numeric inputs for numeric values.
- Show validation and permission errors next to the affected control.

### Status And Alerts

- Use color plus text; color alone is not enough.
- Status pills should be compact and readable in tables.
- Alerts should identify the affected system boundary, not just the symptom.
- For external services, include whether the failure is auth, network, rate
  limit, schema, permission, or unsupported capability when known.

### Drawers, Modals, And Popovers

- Use drawers for inspecting or editing an entity without losing table context.
- Use modals for confirmation, creation, pairing, and narrow blocking decisions.
- Keep popovers short and action-focused.
- Escape, close buttons, and focus return must work.

## Architecture Diagram Style

Pact architecture diagrams should be simple, layered, and visually consistent.

Current diagram names:

- `Pact 系统架构图`
- `Pact 服务能力架构图`

Card hierarchy:

1. Outer cards use a horizontal color strip at the top.
2. Inner cards use a vertical color strip on the left.
3. Leaf cards use rounded rectangles with no color strip.

Use parent-child cards for extensible target groups. Examples:

- Code Repository: `GitHub`, `Gerrit`
- Cloud Drive: `iCloud`, `OneDrive`, `Google Drive`, `Dropbox`
- External Knowledge Base: selected backend knowledge systems

Diagram rules:

- Keep the main vertical or horizontal structure stable once agreed.
- Show data flow and responsibility boundaries more prominently than
  implementation detail.
- Use concise labels. English labels in technical diagrams should use Title
  Case for each word.
- Do not use large explanatory paragraphs inside diagrams.
- Connectors should be low-contrast and readable, not decorative.

## Interaction And State

Interaction rules:

- Hover changes should be subtle and local.
- Focus state must be visible with the brand outline or equivalent tokenized
  treatment.
- Disabled controls use reduced opacity and must not look selected.
- Loading state should preserve layout dimensions.
- Long-running operations should expose progress, retry, cancellation, and
  failure details where applicable.
- Permissioned workflows should show grant scope, actor, target, and audit trail
  whenever that context affects the decision.

## Responsive Rules

Pact is desktop-first, but narrow screens must remain usable.

- Collapse multi-column grids to one column around tablet width.
- Convert dense side-by-side panels into stacked panels when horizontal space is
  insufficient.
- Keep toolbars wrap-safe; controls may move to a second row instead of
  overflowing.
- Text must not overlap or be hidden behind adjacent UI.
- Truncate only secondary metadata. Primary entity names and action labels should
  wrap or resize within reason.

## Accessibility

- Use semantic buttons, inputs, headings, and table markup.
- Every icon-only action needs an accessible name.
- Keyboard focus order must match visual order.
- All actionable controls must be reachable by keyboard.
- Contrast must remain readable on selected, disabled, warning, and danger
  states.
- Do not rely on color alone to communicate system state.

## Content Voice

Operator-facing Chinese should be concise and concrete. English should be used
for product names, protocols, code identifiers, external service names, and API
terms that are already English in the codebase.

Good labels:

- `权限范围`
- `同步状态`
- `缓存命中`
- `重新授权`
- `GitHub`
- `MCP Compatible Agent Harness`

Avoid:

- Marketing slogans in product surfaces.
- In-app paragraphs explaining how the UI works.
- Ambiguous status text like `异常` without the affected boundary or reason.

## Do And Do Not

Do:

- Use existing tokens and component patterns before adding new styles.
- Keep surfaces restrained, light, and readable.
- Use tables and dense panels for operational records.
- Show protocol, permission, cache, gateway, and external-service boundaries.
- Use lucide icons for common actions when available.
- Preserve Pact domain language: AgentLibrary, Agent Harness, MCP Plugin, Shared
  Storage, Workspace API, Operation Ledger, Checkpoint Tree, and Knowledge Base.

Do not:

- Build landing-page heroes for product workflows.
- Add nested cards for page sections.
- Use decorative orbs, bokeh, heavy gradients, or stock-like backgrounds.
- Hide unsupported states or degraded external-service behavior.
- Create local colors, shadows, or radii when a token exists.
- Let hover, loading, or dynamic labels resize stable controls.

## AI Agent Prompt Guide

When an AI agent designs or edits Pact UI, it should first inspect the local
component and token files, especially `server-web/styles/tokens.css`,
`server-web/styles/components.css`, `server-web/styles/layout.css`, and nearby
Vue views. It should preserve the current operations-console feel, use existing
tokens, and design real product workflows instead of marketing screens.

For Pact architecture or capability diagrams, the agent should preserve the
agreed card hierarchy: outer cards with top color strips, inner cards with left
color strips, and leaf cards as plain rounded rectangles. It should make system
boundaries legible and keep future compatibility targets extensible through
parent-child card groups.
