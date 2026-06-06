---
name: pact-history-miner
description: "Use when the user needs to find, pull, inventory, or archive local AI agent development conversation histories related to the Pact project, including its legacy identities splitall, SplitAll, agent studio, Agent Studio, agentstudio, and agent-studio. Scans Codex, Claude Code, Cursor, VS Code, Windsurf, Continue, Aider, and project-local agent history stores when present, and can save each matching conversation as a source + session + datetime reference file."
---

# Pact History Miner

## Purpose

Find local AI-agent development conversations that relate to Pact and its legacy project names. Prefer archiving each matched conversation as a reference file; do not distill or rewrite conversation content unless the user explicitly asks for a separate summary.

## Default Project Identity

Treat these as the same project lineage unless current evidence says otherwise:

- Current: `Pact`, `Unka-Malloc/Pact`, `/Users/unka/DevSpace/Unka-Malloc/Pact`
- Legacy: `splitall`, `SplitAll`, `/Users/unka/DevSpace/Unka-Malloc/Pact`
- Legacy product wording: `agent studio`, `Agent Studio`, `agentstudio`, `agent-studio`, `agent_studio`

## Workflow

1. Read `references/local-history-sources.md` if source coverage or storage locations matter.
2. Run `scripts/find_project_history.py --archive-conversations` from the relevant project checkout.
3. Use `conversation-index.md` as the primary inventory. Each archived file is named as `source__session__datetime__hash.md`.
4. Review `summary.md` for source coverage and scan errors, then inspect `matches.jsonl` only when exact matched records are needed.
5. Prefer high-confidence matches that include a project path or legacy name. Treat bare `Pact` matches as weaker unless the surrounding snippet is clearly about this repo.

## Commands

From the Pact checkout:

```bash
python3 /Users/unka/DevSpace/Unka-Malloc/Pact/skills/project-history/pact-history-miner/scripts/find_project_history.py \
  --project-root /Users/unka/DevSpace/Unka-Malloc/Pact \
  --archive-conversations
```

Add extra tool-specific folders:

```bash
python3 /Users/unka/DevSpace/Unka-Malloc/Pact/skills/project-history/pact-history-miner/scripts/find_project_history.py \
  --project-root /Users/unka/DevSpace/Unka-Malloc/Pact \
  --archive-conversations \
  --root /path/to/other/history \
  --root /path/to/exported/transcripts
```

Choose an explicit archive directory:

```bash
python3 /Users/unka/DevSpace/Unka-Malloc/Pact/skills/project-history/pact-history-miner/scripts/find_project_history.py \
  --project-root /Users/unka/DevSpace/Unka-Malloc/Pact \
  --archive-conversations \
  --output-dir /Users/unka/.pact-agent-history/<timestamp>
```

Exclude the current investigation thread when it dominates results:

```bash
python3 /Users/unka/DevSpace/Unka-Malloc/Pact/skills/project-history/pact-history-miner/scripts/find_project_history.py \
  --project-root /Users/unka/DevSpace/Unka-Malloc/Pact \
  --archive-conversations \
  --before 2026-05-22T20:00:00
```

Capture full redacted matching records in `matches.jsonl`:

```bash
python3 /Users/unka/DevSpace/Unka-Malloc/Pact/skills/project-history/pact-history-miner/scripts/find_project_history.py \
  --project-root /Users/unka/DevSpace/Unka-Malloc/Pact \
  --archive-conversations \
  --include-full-text
```

## Output Contract

With `--archive-conversations` and no explicit `--output-dir`, the scanner writes into `~/.pact-agent-history`. Expected files:

- `summary.md`: source inventory, counts, and top snippets.
- `matches.jsonl`: one JSON record per matched transcript line, SQLite row, or text record.
- `sources.json`: discovered roots, skipped roots, and scan errors.
- `conversation-index.md`: human-readable inventory of archived conversation files.
- `conversation-index.jsonl`: machine-readable inventory.
- `conversations/*.md`: one reference file per matched conversation/source session.

Do not paste large raw histories into chat. Cite archived conversation file paths plus record ids so the user can inspect exact records.

## Matching Guidance

Use confidence levels this way:

- `high`: exact project path, legacy name, or several independent project terms.
- `medium`: one strong legacy/current project term with useful surrounding context.
- `low`: bare `Pact` or weak term match; inspect manually before using.

If a known local tool is absent, report it as "not present on this machine" rather than treating it as scanned.
