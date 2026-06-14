# Design System — Appearance Presets

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: **Locked** — preset config schema and semantic token names require explicit product owner approval
- Scope: Visual identity presets, color tokens, typography, component patterns
- Staleness check: Scanned on 2026-06-14; design-system claims are enforced by `server:verify:design-system`.
- Gate: `server:verify:design-system`

---

## Design Identity

Pact uses **Appearance Presets / 外观方案** instead of a single fixed brand skin. An appearance preset is a local UI display preference loaded from a JSON config file. It selects a semantic color token set for supported frontends and is not a server policy, account setting, audit control, or tenant-level governance choice.

Built-in presets live one file per config under `server-web/appearance-presets/` and are mirrored as Flutter assets under `client-gui/assets/appearance-presets/`. The Web console can also load server-imported preset files persisted under `.pact-server-data/appearance-presets/`. The curated built-in files are:

| Preset ID | Name | Behavior | Core Colors |
|-----------|------|----------|-------------|
| `default-system` | System Default | Follows OS; light resolves to `geek-light-blue`, dark resolves to `sunset-ember` | Delegates by system brightness |
| `geek-light-blue` | Geek Light Blue / 极客浅蓝 | Fixed light | bg `#f5f9ff/#ffffff/#eaf3ff`, text `#0b1220/#315a8a`, brand `#2563eb/#1d4ed8/#dbeafe` |
| `catppuccin-latte` | Catppuccin Latte | Fixed light | bg `#eff1f5/#ffffff/#e6e9ef`, text `#4c4f69/#6c6f85`, brand `#1e66f5/#8839ef/#dce0e8` |
| `github-light` | GitHub Light | Fixed light | bg `#f6f8fa/#ffffff/#f6f8fa`, text `#1f2328/#57606a`, brand `#0969da/#0550ae/#ddf4ff` |
| `one-light` | One Light | Fixed light | bg `#fafafa/#ffffff/#f0f1f4`, text `#383a42/#696c77`, brand `#3568d4/#2f5fcf/#e5ebff` |
| `sunset-ember` | Sunset Ember / 落日余烬 | Fixed dark | bg `#18181b/#1f1f23/#292524`, text `#fafaf9/#a8a29e`, brand `#f97316/#fb923c/#431407` |
| `tokyo-night` | Tokyo Night / 东京之夜 | Fixed dark | bg `#1a1b26/#24283b/#292e42`, text `#c0caf5/#9aa5ce`, brand `#7aa2f7/#bb9af7/#1f2335` |
| `monokai` | Monokai | Fixed dark | bg `#272822/#2d2e28/#3e3d32`, text `#f8f8f2/#cfcfc2`, brand `#a6e22e/#66d9ef/#263b14` |
| `cyberpunk` | Cyberpunk / 赛博朋克 | Fixed dark | bg `#09030f/#160b22/#241233`, text `#fff8d6/#c292ff`, brand `#fcee0a/#ff2a6d/#3d3303` |
| `cappuccino-dark` | Catppuccin Mocha | Fixed dark | bg `#11111b/#1e1e2e/#313244`, text `#cdd6f4/#a6adc8`, brand `#cba6f7/#f5c2e7/#302d47` |

### Principles

1. **Config File Per Preset** — Each appearance preset is a standalone JSON config. For the Web console, source presets are packaged under `server-web/appearance-presets/`; server-imported presets are stored under `.pact-server-data/appearance-presets/` after schema validation. Vite/Vue reloads the source catalog, and the Web runtime merges server-imported configs into the same selector.
2. **Preset Complete At Runtime, Component Agnostic** — Switching presets changes the semantic token layer, not individual components. Runtime fills non-core derived tokens from the matching light/dark baseline so compact configs can still render the full UI.
3. **Local Preference Only** — Web stores only the selected preset id in `localStorage`; server-imported preset files are local server data under `.pact-server-data`, not account or tenant policy. Flutter stores the selected preset and user-supplied preset files under portable data. No account model or tenant governance setting is introduced for v1.
4. **Legibility Is Non-Negotiable** — The currently active preset must keep primary button foreground/background contrast at least WCAG AA 4.5:1.
5. **Clear Lines Over Ambiguity** — Flat solid surfaces, 1px borders, no blur, no glassmorphism, no radial-gradient decoration. UI boundaries must remain visually explicit in every preset.

---

## Token Contract

### Web Console

- Active preset is applied through `html[data-appearance-preset="<preset-id>"]`; the resolved config id is exposed as `html[data-resolved-appearance-preset]`.
- The resolved color scheme is exposed as `html[data-appearance-color-scheme="light|dark"]` for shallow third-party bridge styles.
- `server-web/appearance-presets/*.json` owns built-in source preset color values.
- `.pact-server-data/appearance-presets/*.json` owns server-imported Web preset color values.
- `server/platform/common/appearance-presets/appearance-preset-store.mjs` owns server-side import validation and persistence.
- `server-web/lib/appearance-preset-config.ts` owns Web schema validation, config merging, system preset resolution, and runtime token completion.
- Files added under `server-web/appearance-presets/` are discovered by the Web build through a JSON glob import. In Vite dev, catalog HMR notifies the Vue preference composable, refreshes the selector, and reapplies the active CSS variables.
- Files imported through `/api/appearance-presets/import` are validated by the server, written to `.pact-server-data/appearance-presets/<id>.json`, then returned through `/api/appearance-presets` for immediate rendering.
- `server-web/styles/themes/appearance-presets.css` owns only Element Plus variable mappings to semantic tokens.
- The preferences panel exposes reload and import actions. Import submits JSON to the server catalog; the browser does not become the long-term preset store.
- Existing semantic variables remain the public component contract. Component CSS must not branch on individual preset IDs unless a third-party component integration needs a targeted bridge.
- Legacy `theme-dark` / `theme-light` classes and `pact-theme` values are compatibility inputs only. New UI must use appearance preset ids and `pact-appearance-preset`.

Minimal fixed-preset config shape:

```json
{
  "schemaVersion": "v0.0.1:schema:definition-1",
  "id": "agent-preview",
  "label": { "en": "Agent Preview", "zh-CN": "智能体预览" },
  "mode": "light",
  "tokens": {
    "bg-base": "#f8fafc",
    "bg-surface": "#ffffff",
    "bg-subtle": "#f1f5f9",
    "text-primary": "#0f172a",
    "text-muted": "#475569",
    "text-on-brand": "#ffffff",
    "brand": "#2563eb",
    "brand-strong": "#1d4ed8",
    "brand-subtle": "#dbeafe",
    "success": "#15803d",
    "warning": "#b45309",
    "danger": "#b91c1c"
  }
}
```

### Flutter Client

- `client-gui/assets/appearance-presets/*.json` owns bundled preset config files for packaged clients.
- `client-gui/lib/src/ui/appearance_preset_config.dart` owns schema validation, config merging, system preset resolution, and token completion for Flutter.
- `AppearancePresetId` is a string id so user/generated presets can enter the runtime without enum edits.
- `buildPactTheme(presetId: ..., presets: ...)` builds active `ThemeData` from the selected preset catalog and platform brightness.
- `PactThemeColors` is the app token extension. Widgets read colors through `context.pactColors`, not static palette constants.
- The selected preset is stored in portable data as `appearancePresetId`; user-supplied configs are loaded from `<portable-data>/future-client/appearance-presets/*.json`.

### Shared Status Defaults

| Status | Light Baseline | Dark Baseline |
|--------|---------------|--------------|
| Success | `#15803d` | `#4ade80` |
| Warning | `#b45309` | `#facc15` |
| Danger | `#b91c1c` | `#fb7185` |

Curated fixed presets may tune status hues, surfaces, and borders around their palette identity to preserve contrast.

---

## Typography

- **Sans-serif stack**: SF Pro Text, PingFang SC, Segoe UI, system-ui
- **Monospace stack**: IBM Plex Mono, SFMono-Regular, Menlo, Consolas
- **Base size**: 14px
- **Weights**: 400, 500, 600, 700
- **Line heights**: 1.25, 1.375, 1.5

---

## Spacing & Radius

- Spacing: 4px grid (`--space-1` = 4px through `--space-16` = 64px)
- Border radius: `--radius-xs` through `--radius-2xl`
- Cards and compact controls should remain at 8px radius or less unless an existing component contract requires otherwise.

---

## Shared Components

### PactTabs (`components/PactTabs.vue`)

The canonical tabbed navigation component. All tab-like UI should use this component, not ad-hoc button groups.

```vue
<PactTabs
  v-model="activeTab"
  :tabs="[
    { key: 'overview', label: 'Overview' },
    { key: 'detail', label: 'Detail', meta: '3' },
    { key: 'draft', label: 'Draft', draft: true, closable: true },
  ]"
  variant="line"
  size="default"
  aria-label="Page sections"
  @change="onTabChange"
  @close="onTabClose"
/>
```

Variants:

| Variant | When to Use |
|---------|-------------|
| `line` | Standard page-level tabs. Active tab shows a bottom-border indicator that connects to the content region. |
| `card` | Session/document tabs, including closable tabs. Active tab visually merges with the panel below. |

### SegmentedToggle (`components/SegmentedToggle.vue`)

A segmented control for small option sets with 2-4 options. Use `PactTabs` for page navigation.

---

## Forbidden Patterns

| Pattern | Reason |
|---------|--------|
| `backdrop-filter: blur(...)` | Creates visual ambiguity and makes boundaries hard to inspect |
| `radial-gradient` decorative backgrounds | Adds ambient glows that are not part of the token contract |
| Colored `rgba(...)` in component CSS | Components must use semantic `var(--*)` references |
| Hardcoded hex colors in component CSS | Presets must affect all components through tokens |
| Ad-hoc `color-mix(...)` surfaces | Preset surfaces should be explicit tokens |
| Custom fonts or font-weight > 700 | Keep typography stable across clients |
| Emoji in UI text | Use icons or text labels in functional UI |

Theme and token files may define literal color values; component files may not.

---

## File Structure

| File | Lock Level | Purpose |
|------|------------|---------|
| `server-web/styles/tokens.css` | Token contract | Base semantic variables, spacing, radius, typography, compatibility primitives |
| `server-web/appearance-presets/*.json` | Config file | Source-packaged Web appearance presets, one JSON per preset |
| `.pact-server-data/appearance-presets/*.json` | Runtime data | Server-imported Web appearance presets, one JSON per preset |
| `server/platform/common/appearance-presets/appearance-preset-store.mjs` | Server runtime facade | Server import validation and `.pact-server-data` persistence |
| `server-web/lib/appearance-presets-client.ts` | API client | Web access to server-imported preset catalog and import endpoint |
| `server-web/lib/appearance-preset-config.ts` | **Owner-locked schema** | Web preset config validation, merge, and runtime token completion |
| `server-web/styles/themes/appearance-presets.css` | Mapping facade | Element Plus variable mappings to semantic tokens |
| `server-web/composables/console-shell-preference-effects.ts` | Runtime facade | Web migration, selected-id persistence, Vite catalog refresh, and document application |
| `client-gui/assets/appearance-presets/*.json` | Config file | Flutter bundled appearance preset assets |
| `client-gui/lib/src/ui/appearance_preset_config.dart` | **Owner-locked schema** | Flutter preset config validation, merge, and runtime token completion |
| `client-gui/lib/src/ui/theme.dart` | **Owner-locked facade** | Flutter token model and `ThemeData` builder |
| `client-gui/lib/src/services/appearance_preferences_service.dart` | Preference adapter | Flutter portable-data persistence and external config loading |
| `docs/logo.svg` | **Owner-locked** | Canonical logo mark |
| `server-web/favicon.svg` | **Owner-locked** | Browser favicon |
| `docs/banner.svg` | **Owner-locked** | Product banner |

---

## Change Policy

Preset schema and runtime contract changes require product owner approval. This includes:

- Changing config schema fields or required token names
- Changing `default-system` resolution behavior
- Changing semantic token names consumed by components
- Reintroducing global `light/dark/system` as a separate active model

Permitted without approval:

- Adding generated or hand-authored preset JSON files that pass schema validation
- Adding source preset JSON files under `server-web/appearance-presets/` and reloading the Vue/Vite catalog
- Importing local server preset JSON files through `/api/appearance-presets/import`, which persists them under `.pact-server-data/appearance-presets/`
- Adding component styles that consume existing semantic tokens
- Adding new semantic aliases that resolve to existing preset tokens
- Layout changes that do not hardcode colors or alter typography scale
- Compatibility migration code for older local preference keys

---

## Verification Gate

`npm run server:verify:design-system` validates:

1. Component CSS has no hardcoded hex or colored `rgba(...)` values outside token/theme files
2. Forbidden blur, radial-gradient, and ad-hoc surface patterns are absent from component CSS
3. Appearance preset JSON files have a valid schema
4. The active preset selected by `PACT_VERIFY_APPEARANCE_PRESET_ID` or `default-system` is usable and passes primary button contrast
5. The Web preset facade exposes migration from legacy `pact-theme` values to `pact-appearance-preset`

Run: `npm run server:verify:design-system`
