# ADR 0013: Multi-Brand Appearance Presets

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Accepted
- Scope: Multi-brand appearance preset vocabulary, config sources, local persistence, and frontend theme contract.
- Staleness check: Scanned on 2026-06-14; appearance preset behavior is guarded by current web and Flutter theme verification gates.

## Status
Accepted

Pact will replace the previous single visual skin plus light/dark mode switch with a config-driven **Appearance Preset / 外观方案** system across supported frontends.

The initial built-in preset config files are:

- `default-system`
- `geek-light-blue`
- `catppuccin-latte`
- `github-light`
- `one-light`
- `sunset-ember`
- `tokyo-night`
- `monokai`
- `cyberpunk`
- `cappuccino-dark`

`default-system` follows the operating system brightness: light resolves to `geek-light-blue`, and dark resolves to `sunset-ember`. All other presets are fixed appearances. Presets do not stack with a separate `system/light/dark` mode.

Appearance presets are local display preferences. The Web console stores the selected preset in `localStorage` under `pact-appearance-preset`. Web preset config files have two sources: source-packaged JSON under `server-web/appearance-presets/*.json`, and server-imported JSON under `.pact-server-data/appearance-presets/*.json`. The server import endpoint validates the config shape and writes the file under the server data directory; it does not create an account setting, tenant policy, or governed preference. The Flutter client stores the selected preset under portable data as `appearancePresetId` and loads user-supplied JSON files from `<portable-data>/future-client/appearance-presets/*.json`.

The Web console applies the active preset through `html[data-appearance-preset="<preset-id>"]` and exposes the resolved mode through `html[data-appearance-color-scheme="light|dark"]`. Components continue consuming semantic CSS variables; `server-web/appearance-presets/*.json` owns source-packaged Web token values, `.pact-server-data/appearance-presets/*.json` owns server-imported Web token values, `server-web/lib/appearance-preset-config.ts` validates and completes runtime tokens, and `server-web/styles/themes/appearance-presets.css` maps Element Plus variables to semantic tokens. In Vite dev, source JSON catalog HMR refreshes the Vue selector and reapplies the active CSS variables; server-imported presets refresh through `/api/appearance-presets`. Legacy `pact-theme` values are migrated locally: `system -> default-system`, `light -> geek-light-blue`, and `dark -> sunset-ember`. Legacy generated preset ids are migrated to the closest current built-in where possible.

The Flutter client exposes the same preset vocabulary through JSON-backed string ids, bundles the built-ins under `client-gui/assets/appearance-presets/`, builds `ThemeData` with `buildPactTheme(...)`, and exposes active colors through `PactThemeColors` on `BuildContext`. Widgets should read `context.pactColors` instead of static palette constants.

## Considered Options

- **Keep single brand plus light/dark mode**: preserves the old implementation shape, but does not satisfy quick switching among multiple visual identities.
- **Server-owned theme setting**: centralizes selection state, but incorrectly turns a display preference into a governed product/account policy and adds synchronization burden without v1 value.
- **Local appearance preset config registry**: gives fast switching, keeps semantics consistent across frontends, and avoids expanding the account or tenant model.
- **One JSON config per preset through source and server catalogs**: lets external agents either generate source-packaged files under `server-web/appearance-presets/` or POST generated JSON to `/api/appearance-presets/import` for immediate server-side persistence under `.pact-server-data/appearance-presets/`.

## Consequences

- Preset config schema and semantic token names become part of the frontend design contract.
- User/generated preset files can be added to the Web source catalog or imported into the server catalog without changing component code when they pass schema validation.
- Components must remain token-driven so preset changes affect the full UI surface.
- Web and Flutter maintain separate local persistence adapters but share the same preset terminology.
- Verification gates validate config schema and the currently active preset instead of assuming a locked single-theme identity or hardcoded approved palette list.
- A custom user-defined color editor is out of scope for v1.
