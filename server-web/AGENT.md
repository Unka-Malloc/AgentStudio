# Server Web Agent Entry

## Scope

- Owns the Vue 3 + Element Plus management console in `server-web/`.
- Keep UI work inside `server-web/` unless the task explicitly changes a server
  API contract or shared build configuration.

## First Reads

- Start with root `AGENT.md`, then this file.
- For route-level work, inspect `server-web/router/` and the target file in
  `server-web/views/`.
- For reusable UI, inspect `server-web/components/common.ts` and the nearest
  component folder before adding new components.
- For API calls and frontend data contracts, inspect the relevant client under
  `server-web/lib/`.

## Directory Routing

- `server-web/views/`: route-level pages.
- `server-web/components/`: reusable and feature components.
- `server-web/lib/`: typed API clients, browser helpers, and shared frontend
  utilities.
- `server-web/i18n/`: console localization and dynamic text handling.
- `server-web/styles/`: tokens, themes, layout, and feature styles.
- `server-web/router/`: route definitions and navigation boundaries.

## Verification

- Use `npm run server:verify:frontend-typecheck` for type safety.
- Use the specific frontend verifier when touching feature registry,
  architecture, cache storage, or production-health console behavior.
- Use browser checks only when layout, interaction, or rendering changed.

## Context Budget

- Keep searches under `server-web/` first.
- Avoid loading all views or all styles; follow the route/component/lib path for
  the feature being changed.
