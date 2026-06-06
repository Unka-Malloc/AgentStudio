---
name: pact-mount-routing-lab
description: Use when testing or explaining Pact mount routing for file extension, media type, or source kind rules before changing mount modules or ingest behavior.
---

# Pact Mount Routing Lab

## Purpose

Resolve the exact mount and action that the server will use for a document.

## Workflow

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/module-management/pact-mount-routing-lab/scripts/pact-mount-routing-lab.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --extension .pdf \
  --kind document
```

With a runtime patch:

```bash
node /Users/unka/DevSpace/Unka-Malloc/Pact/skills/module-management/pact-mount-routing-lab/scripts/pact-mount-routing-lab.mjs \
  --repo /Users/unka/DevSpace/Unka-Malloc/Pact \
  --extension .png \
  --routing '{"extensionRoutes":{".png":{"mountName":"multimodalParser","action":"extractDocument"}}}'
```

## Route Order

1. Extension route.
2. Media type route.
3. Source kind route.
4. Default `documentParser.extractDocument`.
