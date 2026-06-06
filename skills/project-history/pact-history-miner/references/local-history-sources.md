# Local History Sources

## Covered by default

The scanner discovers these local stores when present:

| Tool | Default paths |
| --- | --- |
| Codex | `~/.codex/history.jsonl`, `~/.codex/session_index.jsonl`, `~/.codex/sessions`, `~/.codex/archived_sessions`, `~/.codex/memories/MEMORY.md`, `~/.codex/memories/rollout_summaries` |
| Claude Code | `~/.claude/projects`, `~/.claude.json` |
| Cursor | `~/Library/Application Support/Cursor/User/workspaceStorage`, `~/Library/Application Support/Cursor/User/globalStorage` |
| VS Code / compatible forks | `~/Library/Application Support/Code/User/workspaceStorage`, `~/Library/Application Support/Code/User/globalStorage`, plus common forks such as Windsurf, VSCodium, Code - Insiders, Trae, and Trae CN |
| Continue | `~/.continue` |
| Aider | `~/.aider` and project-local `.aider.chat.history.md` files |
| Project local | `.agentstudio-server-data`, `.codex`, `.claude`, and other explicit roots passed with `--root` |
| Legacy SplitAll local | sibling `../splitall/.agentstudio-server-data`, `../splitall/.codex`, `../splitall/.claude`, and `../splitall/.aider.chat.history.md` when scanning from the Pact checkout |

For `.agentstudio-server-data`, the scanner skips operational `auth`, `background`, `logs`, and `security` directories by default because they are runtime state rather than development conversation history.

## How matching works

The default term set combines current and legacy identity:

- `Pact`
- `Unka-Malloc/Pact`
- the active `--project-root`
- `splitall`, `SplitAll`
- `agent studio`, `Agent Studio`, `agentstudio`, `agent-studio`, `agent_studio`
- known legacy paths under `/Users/unka/DevSpace/Unka-Malloc`

`Pact` alone is useful but can be noisy. Exact paths and legacy names carry more weight.

## SQLite handling

Cursor, VS Code-compatible apps, and some project stores keep chat or state data in SQLite files such as `state.vscdb`, `.sqlite`, `.sqlite3`, or `.db`. The scanner opens them read-only, inspects user tables, decodes text/blob values as UTF-8 with replacement, and searches row text plus table/key metadata.

If a database is locked or not a SQLite database, the scanner records the error in `sources.json` and continues.

SQLite FTS shadow tables and sqlite-vec virtual vector tables are skipped; their canonical row data is expected to live in ordinary tables.

## Conversation archive

With `--archive-conversations`, each matched text transcript is written as a Markdown reference file containing metadata and the raw redacted transcript. File names follow:

`source__session__datetime__hash.md`

SQLite matches are written as Markdown files containing the matched rows. They are reference artifacts, not distilled summaries.

When `--output-dir` is omitted in archive mode, output defaults to
`~/.pact-agent-history/<timestamp>`.

## Privacy defaults

The default output contains redacted snippets and references to source records. Archive files also redact common secret patterns by default. Use `--include-full-text` for full matched row/line text in `matches.jsonl`.

Redaction covers common bearer tokens, OpenAI-style `sk-` keys, GitHub tokens, Anthropic keys, and AWS access key ids. It is a safety layer, not a formal secret scanner.
