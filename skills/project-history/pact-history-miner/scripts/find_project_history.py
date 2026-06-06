#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import urllib.parse
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


TEXT_SUFFIXES = {
    ".jsonl",
    ".json",
    ".md",
    ".markdown",
    ".txt",
    ".log",
    ".yaml",
    ".yml",
    ".toml",
}

SQLITE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".vscdb"}

SKIP_DIR_NAMES = {
    "Cache",
    "CachedData",
    "CachedProfilesData",
    "Crashpad",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GPUCache",
    "node_modules",
    ".git",
    "__pycache__",
    "Service Worker",
    "SharedStorage",
    "Session Storage",
    "WebStorage",
    ".pact-agent-history",
}

AGENTSTUDIO_OPERATIONAL_SKIP_DIRS = {
    "auth",
    "background",
    "logs",
    "security",
}

SQLITE_SHADOW_SUFFIXES = (
    "_config",
    "_idx",
    "_docsize",
    "_data",
)

DEFAULT_APP_NAMES = (
    "Cursor",
    "Code",
    "Code - Insiders",
    "Windsurf",
    "VSCodium",
    "Trae",
    "Trae CN",
)

SECRET_PATTERNS = (
    (re.compile(r"sk-[A-Za-z0-9_-]{16,}"), "sk-REDACTED"),
    (re.compile(r"gh[pousr]_[A-Za-z0-9_]{16,}"), "gh_REDACTED"),
    (re.compile(r"ANTHROPIC_API_KEY\s*[:=]\s*['\"]?[^'\"\s,}]+", re.I), "ANTHROPIC_API_KEY=REDACTED"),
    (re.compile(r"OPENAI_API_KEY\s*[:=]\s*['\"]?[^'\"\s,}]+", re.I), "OPENAI_API_KEY=REDACTED"),
    (re.compile(r"Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{16,}", re.I), "Authorization: Bearer REDACTED"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS_ACCESS_KEY_ID_REDACTED"),
)


@dataclass
class SourceRoot:
    path: Path
    tool: str
    kind: str
    exists: bool = False
    note: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "path": str(self.path),
            "tool": self.tool,
            "kind": self.kind,
            "exists": self.exists,
            "note": self.note,
        }


@dataclass
class ScanStats:
    files_seen: int = 0
    files_scanned: int = 0
    sqlite_seen: int = 0
    sqlite_scanned: int = 0
    records_seen: int = 0
    matches: int = 0
    skipped: list[dict[str, str]] = field(default_factory=list)
    errors: list[dict[str, str]] = field(default_factory=list)


@dataclass
class MatchRecord:
    source_tool: str
    source_kind: str
    path: str
    record_id: str
    mtime: str | None
    score: int
    confidence: str
    matched_terms: list[str]
    snippets: list[str]
    metadata: dict[str, Any] = field(default_factory=dict)
    full_text: str | None = None

    def to_json(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "source_tool": self.source_tool,
            "source_kind": self.source_kind,
            "path": self.path,
            "record_id": self.record_id,
            "mtime": self.mtime,
            "score": self.score,
            "confidence": self.confidence,
            "matched_terms": self.matched_terms,
            "snippets": self.snippets,
            "metadata": self.metadata,
        }
        if self.full_text is not None:
            data["full_text"] = self.full_text
        return data


@dataclass
class ConversationArchiveRecord:
    source_tool: str
    source_kind: str
    session_id: str
    datetime: str
    original_path: str
    archive_path: str
    matched_records: int
    matched_terms: list[str]
    bytes_written: int

    def to_json(self) -> dict[str, Any]:
        return {
            "source_tool": self.source_tool,
            "source_kind": self.source_kind,
            "session_id": self.session_id,
            "datetime": self.datetime,
            "original_path": self.original_path,
            "archive_path": self.archive_path,
            "matched_records": self.matched_records,
            "matched_terms": self.matched_terms,
            "bytes_written": self.bytes_written,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Find local AI-agent conversation history records related to Pact, splitall, and Agent Studio."
    )
    parser.add_argument("--project-root", default=os.getcwd(), help="Current Pact checkout path.")
    parser.add_argument(
        "--output-dir",
        help="Output directory. Defaults to ~/.pact-agent-history/<timestamp>.",
    )
    parser.add_argument("--root", action="append", default=[], help="Extra history root to scan. Can be repeated.")
    parser.add_argument("--term", action="append", default=[], help="Extra search term. Can be repeated.")
    parser.add_argument("--max-file-mb", type=float, default=256.0, help="Skip text files larger than this size.")
    parser.add_argument("--max-sqlite-mb", type=float, default=250.0, help="Skip SQLite files larger than this size.")
    parser.add_argument("--max-sqlite-rows", type=int, default=50000, help="Rows to inspect per SQLite table.")
    parser.add_argument("--summary-limit", type=int, default=80, help="Top matches to include in summary.md.")
    parser.add_argument("--max-snippets", type=int, default=3, help="Snippets to keep per matched record.")
    parser.add_argument("--after", help="Only scan files modified at or after this local ISO timestamp/date.")
    parser.add_argument("--before", help="Only scan files modified before this local ISO timestamp/date.")
    parser.add_argument("--include-full-text", action="store_true", help="Include full matched line/row text in matches.jsonl.")
    parser.add_argument("--copy-matched-files", action="store_true", help="Copy matched source files into raw/.")
    parser.add_argument(
        "--archive-conversations",
        action="store_true",
        help="Write each matched conversation/source session as a standalone reference file.",
    )
    parser.add_argument(
        "--conversation-dir",
        help="Directory for archived conversation files. Defaults to <output-dir>/conversations.",
    )
    parser.add_argument("--no-redact", action="store_true", help="Disable secret redaction in snippets and full_text.")
    return parser.parse_args()


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def iso_mtime(path: Path) -> str | None:
    try:
        return dt.datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
    except OSError:
        return None


def parse_local_time(value: str | None, label: str) -> float | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            parsed = dt.datetime.fromisoformat(raw + "T00:00:00")
        else:
            parsed = dt.datetime.fromisoformat(raw)
    except ValueError as exc:
        raise SystemExit(f"Invalid --{label} value {value!r}; use YYYY-MM-DD or ISO local timestamp.") from exc
    return parsed.timestamp()


def in_time_window(path: Path, args: argparse.Namespace, stats: ScanStats) -> bool:
    after_ts = getattr(args, "after_ts", None)
    before_ts = getattr(args, "before_ts", None)
    if after_ts is None and before_ts is None:
        return True
    try:
        mtime = path.stat().st_mtime
    except OSError as exc:
        stats.errors.append({"path": str(path), "error": str(exc)})
        return False
    if after_ts is not None and mtime < after_ts:
        return False
    if before_ts is not None and mtime >= before_ts:
        return False
    return True


def redact(text: str, enabled: bool) -> str:
    if not enabled:
        return text
    redacted = text
    for pattern, replacement in SECRET_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def normalize_path(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def default_terms(project_root: Path) -> list[str]:
    legacy_root = project_root.parent if project_root.parent.exists() else Path("/Users/unka/DevSpace/Unka-Malloc")
    terms = [
        "Pact",
        "Unka-Malloc/Pact",
        str(project_root),
        project_root.name,
        "splitall",
        "SplitAll",
        str(legacy_root / "splitall"),
        "agent studio",
        "Agent Studio",
        "agentstudio",
        "agent-studio",
        "agent_studio",
        ".agentstudio-server-data",
        str(legacy_root / "agent-studio"),
        str(legacy_root / "AgentStudio"),
    ]
    return unique_preserve_order([term for term in terms if term])


def unique_preserve_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def term_weight(term: str) -> int:
    folded = term.casefold()
    if "/" in term or "\\" in term:
        return 9
    if "splitall" in folded:
        return 7
    if "agent studio" in folded or "agentstudio" in folded or "agent-studio" in folded or "agent_studio" in folded:
        return 7
    if "unka-malloc/pact" in folded:
        return 8
    if folded == "pact":
        return 3
    return 4


def match_terms(text: str, terms: list[str]) -> tuple[int, list[str]]:
    folded = text.casefold()
    score = 0
    matched: list[str] = []
    for term in terms:
        folded_term = term.casefold()
        if not folded_term:
            continue
        if folded_term == "pact":
            found = re.search(r"(?<![a-z0-9_-])pact(?![a-z0-9_-])", folded, re.I) is not None
        else:
            found = folded_term in folded
        if found:
            matched.append(term)
            score += term_weight(term)
    if len(matched) > 1:
        score += min(6, len(matched) * 2)
    return score, matched


def confidence_for(score: int, matched_terms: list[str]) -> str:
    folded_terms = " ".join(matched_terms).casefold()
    has_path = "/" in folded_terms or "\\" in folded_terms
    has_legacy = "splitall" in folded_terms or "agent studio" in folded_terms or "agentstudio" in folded_terms
    if score >= 10 or has_path or has_legacy:
        return "high"
    if score >= 5:
        return "medium"
    return "low"


def snippets_for(text: str, terms: list[str], limit: int, redact_enabled: bool) -> list[str]:
    folded = text.casefold()
    spans: list[tuple[int, int]] = []
    for term in terms:
        folded_term = term.casefold()
        if not folded_term:
            continue
        start = folded.find(folded_term)
        if start >= 0:
            spans.append((start, start + len(term)))
    if not spans:
        compact = " ".join(text.split())
        return [redact(compact[:360], redact_enabled)]
    snippets: list[str] = []
    for start, end in spans[:limit]:
        left = max(0, start - 180)
        right = min(len(text), end + 220)
        piece = text[left:right]
        piece = " ".join(piece.split())
        if left > 0:
            piece = "..." + piece
        if right < len(text):
            piece = piece + "..."
        snippets.append(redact(piece, redact_enabled))
    return snippets


def classify_tool(path: Path) -> str:
    text = str(path)
    parts = set(path.parts)
    if ".codex" in parts:
        return "codex"
    if ".claude" in parts:
        return "claude-code"
    if ".continue" in parts:
        return "continue"
    if ".aider" in parts or path.name.startswith(".aider"):
        return "aider"
    if ".agentstudio-server-data" in parts:
        return "agent-studio-local"
    for app in DEFAULT_APP_NAMES:
        marker = f"/Application Support/{app}/"
        if marker in text:
            return app.lower().replace(" ", "-")
    return "local"


def discover_roots(project_root: Path, extra_roots: list[str]) -> list[SourceRoot]:
    home = Path.home()
    roots: list[SourceRoot] = []

    def add(path: Path, tool: str, kind: str, note: str = "") -> None:
        roots.append(SourceRoot(path=path.expanduser(), tool=tool, kind=kind, note=note))

    codex = home / ".codex"
    add(codex / "history.jsonl", "codex", "jsonl", "prompt history")
    add(codex / "session_index.jsonl", "codex", "jsonl", "session index")
    add(codex / "sessions", "codex", "directory", "active sessions")
    add(codex / "archived_sessions", "codex", "directory", "archived sessions")
    add(codex / "memories" / "MEMORY.md", "codex", "markdown", "memory registry")
    add(codex / "memories" / "rollout_summaries", "codex", "directory", "memory rollout summaries")

    add(home / ".claude" / "projects", "claude-code", "directory", "project transcripts")
    add(home / ".claude.json", "claude-code", "json", "global state")

    app_support = home / "Library" / "Application Support"
    for app in DEFAULT_APP_NAMES:
        add(app_support / app / "User" / "workspaceStorage", app.lower().replace(" ", "-"), "directory", "workspace state")
        add(app_support / app / "User" / "globalStorage", app.lower().replace(" ", "-"), "directory", "global state")

    add(home / ".continue", "continue", "directory", "Continue state")
    add(home / ".aider", "aider", "directory", "Aider state")

    add(project_root / ".aider.chat.history.md", "aider", "markdown", "project-local Aider chat")
    add(project_root / ".agentstudio-server-data", "agent-studio-local", "directory", "legacy project-local data")
    add(project_root / ".codex", "codex", "directory", "project-local Codex state")
    add(project_root / ".claude", "claude-code", "directory", "project-local Claude state")

    legacy_splitall = project_root.parent / "splitall"
    if legacy_splitall != project_root:
        add(legacy_splitall / ".agentstudio-server-data", "agent-studio-local", "directory", "legacy splitall Agent Studio data")
        add(legacy_splitall / ".codex", "codex", "directory", "legacy splitall project-local Codex state")
        add(legacy_splitall / ".claude", "claude-code", "directory", "legacy splitall project-local Claude state")
        add(legacy_splitall / ".aider.chat.history.md", "aider", "markdown", "legacy splitall project-local Aider chat")

    for root in extra_roots:
        add(Path(root), "extra", "directory", "explicit --root")

    deduped: dict[str, SourceRoot] = {}
    for root in roots:
        key = str(root.path.expanduser())
        if key not in deduped:
            root.exists = root.path.exists()
            deduped[key] = root
    return list(deduped.values())


def should_scan_text_file(path: Path) -> bool:
    if path.name in {"workspace.json", "storage.json", "argv.json"}:
        return True
    return path.suffix.lower() in TEXT_SUFFIXES


def should_scan_sqlite_file(path: Path) -> bool:
    if path.name.endswith(("-wal", "-shm")):
        return False
    if path.name.endswith(".vscdb.backup"):
        return True
    if path.name == "state.vscdb":
        return True
    return path.suffix.lower() in SQLITE_SUFFIXES


def walk_files(root: SourceRoot, stats: ScanStats) -> Iterable[Path]:
    path = root.path
    if not path.exists():
        return
    if path.is_file():
        yield path
        return
    for dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIR_NAMES]
        if ".agentstudio-server-data" in Path(dirpath).parts:
            dirnames[:] = [name for name in dirnames if name not in AGENTSTUDIO_OPERATIONAL_SKIP_DIRS]
        for filename in filenames:
            yield Path(dirpath) / filename


def scan_text_file(
    path: Path,
    terms: list[str],
    args: argparse.Namespace,
    stats: ScanStats,
) -> list[MatchRecord]:
    matches: list[MatchRecord] = []
    stats.files_seen += 1
    try:
        size = path.stat().st_size
    except OSError as exc:
        stats.errors.append({"path": str(path), "error": str(exc)})
        return matches
    if size > args.max_file_mb * 1024 * 1024:
        stats.skipped.append({"path": str(path), "reason": f"text file larger than {args.max_file_mb} MB"})
        return matches
    stats.files_scanned += 1
    redact_enabled = not args.no_redact
    path_score, path_terms = match_terms(str(path), terms)
    try:
        with path.open("rb") as handle:
            for line_no, raw_line in enumerate(handle, 1):
                stats.records_seen += 1
                if len(raw_line) > 500_000:
                    raw_line = raw_line[:500_000] + b"...[truncated]"
                line = raw_line.decode("utf-8", errors="replace")
                score, matched = match_terms(line, terms)
                if score > 0 and path_terms:
                    score += min(path_score, 6)
                    matched = unique_preserve_order(matched + path_terms)
                if not matched:
                    continue
                metadata = summarize_json_line(line)
                metadata["line"] = line_no
                record = MatchRecord(
                    source_tool=classify_tool(path),
                    source_kind="text-line",
                    path=str(path),
                    record_id=f"L{line_no}",
                    mtime=iso_mtime(path),
                    score=score,
                    confidence=confidence_for(score, matched),
                    matched_terms=matched,
                    snippets=snippets_for(line, matched, args.max_snippets, redact_enabled),
                    metadata=metadata,
                    full_text=redact(line.rstrip("\n"), redact_enabled) if args.include_full_text else None,
                )
                matches.append(record)
    except OSError as exc:
        stats.errors.append({"path": str(path), "error": str(exc)})
    stats.matches += len(matches)
    return matches


def summarize_json_line(line: str) -> dict[str, Any]:
    text = line.strip()
    if not text or len(text) > 200_000:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    metadata: dict[str, Any] = {}
    for key in (
        "type",
        "timestamp",
        "created_at",
        "cwd",
        "thread_id",
        "session_id",
        "id",
        "role",
        "source",
    ):
        if key in data and isinstance(data[key], (str, int, float, bool)):
            metadata[key] = data[key]
    payload = data.get("payload")
    if isinstance(payload, dict):
        for key in ("id", "cwd", "timestamp", "type", "role"):
            value = payload.get(key)
            if isinstance(value, (str, int, float, bool)):
                metadata[f"payload.{key}"] = value
    return metadata


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def sqlite_text_for_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        if len(value) > 500_000:
            value = value[:500_000] + b"...[truncated]"
        return value.decode("utf-8", errors="replace")
    if isinstance(value, (str, int, float, bool)):
        text = str(value)
        if len(text) > 500_000:
            return text[:500_000] + "...[truncated]"
        return text
    return repr(value)


def scan_sqlite_file(
    path: Path,
    terms: list[str],
    args: argparse.Namespace,
    stats: ScanStats,
) -> list[MatchRecord]:
    matches: list[MatchRecord] = []
    stats.sqlite_seen += 1
    try:
        size = path.stat().st_size
    except OSError as exc:
        stats.errors.append({"path": str(path), "error": str(exc)})
        return matches
    if size > args.max_sqlite_mb * 1024 * 1024:
        stats.skipped.append({"path": str(path), "reason": f"SQLite file larger than {args.max_sqlite_mb} MB"})
        return matches

    redact_enabled = not args.no_redact
    path_score, path_terms = match_terms(str(path), terms)
    uri = "file:" + urllib.parse.quote(str(path), safe="/:") + "?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=1)
    except sqlite3.Error as exc:
        stats.errors.append({"path": str(path), "error": f"sqlite open failed: {exc}"})
        return matches

    try:
        stats.sqlite_scanned += 1
        table_rows = connection.execute(
            "SELECT name, COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for table_name, table_sql in table_rows:
            if table_name.endswith(SQLITE_SHADOW_SUFFIXES):
                continue
            if "USING vec0" in table_sql:
                stats.skipped.append({"path": str(path), "reason": f"SQLite virtual vector table skipped: {table_name}"})
                continue
            try:
                columns_info = connection.execute(f"PRAGMA table_info({quote_ident(table_name)})").fetchall()
                columns = [row[1] for row in columns_info]
                if not columns:
                    continue
                has_rowid = True
                try:
                    select_sql = f"SELECT rowid, * FROM {quote_ident(table_name)} LIMIT ?"
                    cursor = connection.execute(select_sql, (args.max_sqlite_rows,))
                except sqlite3.Error as exc:
                    if "no such column: rowid" not in str(exc):
                        raise
                    has_rowid = False
                    select_sql = f"SELECT * FROM {quote_ident(table_name)} LIMIT ?"
                    cursor = connection.execute(select_sql, (args.max_sqlite_rows,))
                for synthetic_rowid, row in enumerate(cursor, 1):
                    stats.records_seen += 1
                    if has_rowid:
                        rowid = row[0]
                        values = row[1:]
                    else:
                        rowid = synthetic_rowid
                        values = row
                    pieces = [f"table={table_name}", f"rowid={rowid}"]
                    metadata: dict[str, Any] = {"table": table_name, "rowid": rowid}
                    for column, value in zip(columns, values):
                        text_value = sqlite_text_for_value(value)
                        if not text_value:
                            continue
                        if column.lower() in {"key", "id", "conversationid", "sessionid", "workspaceid"}:
                            metadata[column] = text_value[:300]
                        pieces.append(f"{column}={text_value}")
                    row_text = "\n".join(pieces)
                    score, matched = match_terms(row_text, terms)
                    if score > 0 and path_terms:
                        score += min(path_score, 6)
                        matched = unique_preserve_order(matched + path_terms)
                    if not matched:
                        continue
                    record = MatchRecord(
                        source_tool=classify_tool(path),
                        source_kind="sqlite-row",
                        path=str(path),
                        record_id=f"{table_name}:{rowid}",
                        mtime=iso_mtime(path),
                        score=score,
                        confidence=confidence_for(score, matched),
                        matched_terms=matched,
                        snippets=snippets_for(row_text, matched, args.max_snippets, redact_enabled),
                        metadata=metadata,
                        full_text=redact(row_text, redact_enabled) if args.include_full_text else None,
                    )
                    matches.append(record)
            except sqlite3.Error as exc:
                stats.errors.append({"path": str(path), "error": f"table {table_name}: {exc}"})
    finally:
        connection.close()
    stats.matches += len(matches)
    return matches


def scan_all(roots: list[SourceRoot], terms: list[str], args: argparse.Namespace, stats: ScanStats) -> list[MatchRecord]:
    all_matches: list[MatchRecord] = []
    for root in roots:
        if not root.exists:
            continue
        for file_path in walk_files(root, stats):
            if not in_time_window(file_path, args, stats):
                continue
            if should_scan_sqlite_file(file_path):
                all_matches.extend(scan_sqlite_file(file_path, terms, args, stats))
            elif should_scan_text_file(file_path):
                all_matches.extend(scan_text_file(file_path, terms, args, stats))
            else:
                stats.files_seen += 1
    return all_matches


def ensure_output_dir(args: argparse.Namespace) -> Path:
    if args.output_dir:
        out_dir = normalize_path(args.output_dir)
    else:
        # 默认落在工作区外，避免把 agent 历史放回项目目录；与外部数据目录约束保持一致。
        out_dir = Path.home() / ".pact-agent-history" / now_stamp()
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def write_jsonl(path: Path, records: list[MatchRecord]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record.to_json(), ensure_ascii=False, sort_keys=True) + "\n")


def write_sources(path: Path, roots: list[SourceRoot], stats: ScanStats, terms: list[str], project_root: Path) -> None:
    data = {
        "project_root": str(project_root),
        "terms": terms,
        "roots": [root.to_json() for root in roots],
        "stats": {
            "files_seen": stats.files_seen,
            "files_scanned": stats.files_scanned,
            "sqlite_seen": stats.sqlite_seen,
            "sqlite_scanned": stats.sqlite_scanned,
            "records_seen": stats.records_seen,
            "matches": stats.matches,
        },
        "skipped": stats.skipped,
        "errors": stats.errors,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def copy_matched_files(out_dir: Path, records: list[MatchRecord], stats: ScanStats) -> None:
    raw_dir = out_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, str]] = []
    seen: set[str] = set()
    for record in records:
        source = Path(record.path)
        key = str(source)
        if key in seen or not source.exists() or not source.is_file():
            continue
        seen.add(key)
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
        target = raw_dir / f"{digest}-{source.name}"
        try:
            shutil.copy2(source, target)
            manifest.append({"source": key, "copy": str(target)})
        except OSError as exc:
            stats.errors.append({"path": key, "error": f"copy failed: {exc}"})
    (out_dir / "raw-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def safe_slug(value: str, limit: int = 80) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-._")
    if not cleaned:
        cleaned = "unknown"
    return cleaned[:limit].strip("-._") or "unknown"


def filename_datetime(value: str | None) -> str:
    if not value:
        return "unknown-date"
    cleaned = value.strip()
    cleaned = cleaned.replace(":", "-")
    cleaned = cleaned.replace("+", "plus")
    cleaned = cleaned.replace("/", "-")
    cleaned = cleaned.replace("\\", "-")
    cleaned = re.sub(r"[^A-Za-z0-9._TZ-]+", "-", cleaned)
    cleaned = cleaned.replace(".000Z", "Z")
    return safe_slug(cleaned, 40)


def parse_rollout_filename(path: Path) -> tuple[str | None, str | None]:
    match = re.search(
        r"rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([0-9a-fA-F-]{36})",
        path.name,
    )
    if not match:
        return None, None
    timestamp = match.group(1).replace("T", "T").replace("-", "-", 2)
    timestamp = timestamp[:13] + ":" + timestamp[14:16] + ":" + timestamp[17:19]
    return match.group(2), timestamp


def source_metadata_from_json_line(line: str) -> dict[str, Any]:
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    metadata: dict[str, Any] = {}
    if isinstance(data.get("timestamp"), str):
        metadata["timestamp"] = data["timestamp"]

    payload = data.get("payload")
    if data.get("type") == "session_meta" and isinstance(payload, dict):
        if isinstance(payload.get("id"), str):
            metadata["session_id"] = payload["id"]
        if isinstance(payload.get("timestamp"), str):
            metadata["datetime"] = payload["timestamp"]
        for key in ("cwd", "originator", "source", "cli_version"):
            if isinstance(payload.get(key), str):
                metadata[key] = payload[key]

    if data.get("type") == "session.start" and isinstance(data.get("data"), dict):
        inner = data["data"]
        if isinstance(inner.get("sessionId"), str):
            metadata["session_id"] = inner["sessionId"]
        if isinstance(inner.get("startTime"), str):
            metadata["datetime"] = inner["startTime"]
        for key in ("producer", "copilotVersion", "vscodeVersion"):
            if isinstance(inner.get(key), str):
                metadata[key] = inner[key]

    for key in ("session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId", "id"):
        value = data.get(key)
        if isinstance(value, str) and "session_id" not in metadata:
            metadata["session_id"] = value
    return metadata


def detect_text_conversation_metadata(path: Path, records: list[MatchRecord]) -> dict[str, Any]:
    source_tool = records[0].source_tool if records else classify_tool(path)
    fallback_session, fallback_datetime = parse_rollout_filename(path)
    metadata: dict[str, Any] = {
        "source_tool": source_tool,
        "source_kind": "text-file",
        "session_id": fallback_session or path.stem,
        "datetime": fallback_datetime or iso_mtime(path) or "unknown-date",
        "original_path": str(path),
        "mtime": iso_mtime(path),
    }

    try:
        with path.open("rb") as handle:
            for line_index, raw_line in enumerate(handle, 1):
                if line_index > 2000:
                    break
                line = raw_line.decode("utf-8", errors="replace")
                parsed = source_metadata_from_json_line(line)
                if parsed.get("session_id"):
                    metadata["session_id"] = parsed["session_id"]
                if parsed.get("datetime"):
                    metadata["datetime"] = parsed["datetime"]
                elif parsed.get("timestamp") and metadata.get("datetime") in {None, "unknown-date"}:
                    metadata["datetime"] = parsed["timestamp"]
                for key, value in parsed.items():
                    if key not in {"session_id", "datetime", "timestamp"}:
                        metadata[key] = value
                if parsed.get("session_id") and parsed.get("datetime"):
                    break
    except OSError:
        pass
    return metadata


def archive_filename(source_tool: str, session_id: str, timestamp: str, original_path: str) -> str:
    digest = hashlib.sha256(original_path.encode("utf-8")).hexdigest()[:10]
    return "__".join(
        [
            safe_slug(source_tool, 32),
            safe_slug(session_id, 96),
            filename_datetime(timestamp),
            digest,
        ]
    ) + ".md"


def markdown_metadata_block(metadata: dict[str, Any]) -> list[str]:
    lines = ["## Metadata", ""]
    for key in sorted(metadata):
        value = metadata[key]
        if isinstance(value, (list, dict)):
            rendered = json.dumps(value, ensure_ascii=False, sort_keys=True)
        else:
            rendered = str(value)
        lines.append(f"- `{key}`: `{rendered}`")
    lines.append("")
    return lines


def write_text_conversation_archive(
    path: Path,
    records: list[MatchRecord],
    target: Path,
    metadata: dict[str, Any],
    redact_enabled: bool,
) -> int:
    matched_terms = sorted({term for record in records for term in record.matched_terms}, key=str.casefold)
    header: dict[str, Any] = {
        "archive_type": "pact-agent-conversation",
        "source_tool": metadata["source_tool"],
        "source_kind": "text-file",
        "session_id": metadata["session_id"],
        "datetime": metadata["datetime"],
        "original_path": str(path),
        "matched_records": len(records),
        "matched_terms": matched_terms,
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    lines = [
        f"# {metadata['source_tool']} / {metadata['session_id']} / {metadata['datetime']}",
        "",
        "This file is an archived local agent conversation for reference. It is not a distilled summary.",
        "",
    ]
    lines.extend(markdown_metadata_block(header))
    lines.extend(["## Raw Conversation", "", "```jsonl"])
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
        with path.open("rb") as source:
            for raw_line in source:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\n")
                handle.write(redact(line, redact_enabled) + "\n")
        handle.write("```\n")
    return target.stat().st_size


def write_sqlite_conversation_archive(
    key: tuple[str, str],
    records: list[MatchRecord],
    target: Path,
    redact_enabled: bool,
) -> int:
    source_path, session_id = key
    source_tool = records[0].source_tool if records else classify_tool(Path(source_path))
    timestamp = records[0].mtime if records else iso_mtime(Path(source_path)) or "unknown-date"
    matched_terms = sorted({term for record in records for term in record.matched_terms}, key=str.casefold)
    header: dict[str, Any] = {
        "archive_type": "pact-agent-conversation",
        "source_tool": source_tool,
        "source_kind": "sqlite-rows",
        "session_id": session_id,
        "datetime": timestamp,
        "original_path": source_path,
        "matched_records": len(records),
        "matched_terms": matched_terms,
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    lines = [
        f"# {source_tool} / {session_id} / {timestamp}",
        "",
        "This file contains matched SQLite rows for reference. It is not a distilled summary.",
        "",
    ]
    lines.extend(markdown_metadata_block(header))
    lines.extend(["## Matched Rows", "", "```jsonl"])
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
        for record in records:
            payload = record.to_json()
            if payload.get("full_text"):
                payload["full_text"] = redact(str(payload["full_text"]), redact_enabled)
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
        handle.write("```\n")
    return target.stat().st_size


def sqlite_archive_session_id(record: MatchRecord) -> str:
    for key in ("conversationId", "conversationid", "sessionId", "sessionid", "threadId", "thread_id", "id"):
        value = record.metadata.get(key)
        if isinstance(value, str) and value:
            return value
    table = str(record.metadata.get("table", "sqlite"))
    rowid = str(record.metadata.get("rowid", record.record_id))
    return f"{Path(record.path).stem}-{table}-{rowid}"


def write_conversation_archives(
    out_dir: Path,
    records: list[MatchRecord],
    args: argparse.Namespace,
    stats: ScanStats,
) -> list[ConversationArchiveRecord]:
    archive_dir = normalize_path(args.conversation_dir) if args.conversation_dir else out_dir / "conversations"
    archive_dir.mkdir(parents=True, exist_ok=True)
    text_groups: dict[str, list[MatchRecord]] = defaultdict(list)
    sqlite_groups: dict[tuple[str, str], list[MatchRecord]] = defaultdict(list)
    for record in records:
        if record.source_kind == "text-line":
            text_groups[record.path].append(record)
        elif record.source_kind == "sqlite-row":
            sqlite_groups[(record.path, sqlite_archive_session_id(record))].append(record)

    manifest: list[ConversationArchiveRecord] = []
    redact_enabled = not args.no_redact

    for source_path, group in sorted(text_groups.items()):
        path = Path(source_path)
        if not path.exists() or not path.is_file():
            stats.errors.append({"path": source_path, "error": "matched source file disappeared before archive"})
            continue
        metadata = detect_text_conversation_metadata(path, group)
        filename = archive_filename(
            str(metadata["source_tool"]),
            str(metadata["session_id"]),
            str(metadata["datetime"]),
            source_path,
        )
        target = archive_dir / filename
        try:
            bytes_written = write_text_conversation_archive(path, group, target, metadata, redact_enabled)
        except OSError as exc:
            stats.errors.append({"path": source_path, "error": f"archive failed: {exc}"})
            continue
        manifest.append(
            ConversationArchiveRecord(
                source_tool=str(metadata["source_tool"]),
                source_kind="text-file",
                session_id=str(metadata["session_id"]),
                datetime=str(metadata["datetime"]),
                original_path=source_path,
                archive_path=str(target),
                matched_records=len(group),
                matched_terms=sorted({term for record in group for term in record.matched_terms}, key=str.casefold),
                bytes_written=bytes_written,
            )
        )

    for key, group in sorted(sqlite_groups.items()):
        source_path, session_id = key
        source_tool = group[0].source_tool if group else classify_tool(Path(source_path))
        timestamp = group[0].mtime if group else iso_mtime(Path(source_path)) or "unknown-date"
        filename = archive_filename(source_tool, session_id, timestamp or "unknown-date", f"{source_path}:{session_id}")
        target = archive_dir / filename
        try:
            bytes_written = write_sqlite_conversation_archive(key, group, target, redact_enabled)
        except OSError as exc:
            stats.errors.append({"path": source_path, "error": f"sqlite archive failed: {exc}"})
            continue
        manifest.append(
            ConversationArchiveRecord(
                source_tool=source_tool,
                source_kind="sqlite-rows",
                session_id=session_id,
                datetime=timestamp or "unknown-date",
                original_path=source_path,
                archive_path=str(target),
                matched_records=len(group),
                matched_terms=sorted({term for record in group for term in record.matched_terms}, key=str.casefold),
                bytes_written=bytes_written,
            )
        )

    write_conversation_manifest(out_dir, manifest)
    return manifest


def write_conversation_manifest(out_dir: Path, manifest: list[ConversationArchiveRecord]) -> None:
    jsonl_path = out_dir / "conversation-index.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for record in manifest:
            handle.write(json.dumps(record.to_json(), ensure_ascii=False, sort_keys=True) + "\n")

    lines = ["# Conversation Archive Index", ""]
    lines.append(f"- Generated: {dt.datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"- Conversations: {len(manifest)}")
    lines.append(f"- Total bytes: {sum(item.bytes_written for item in manifest)}")
    lines.append("")
    lines.append("| Source | Session | Datetime | Matched records | File |")
    lines.append("| --- | --- | --- | ---: | --- |")
    for item in sorted(manifest, key=lambda entry: (entry.source_tool, entry.datetime, entry.session_id)):
        lines.append(
            f"| `{item.source_tool}` | `{item.session_id}` | `{item.datetime}` | {item.matched_records} | `{item.archive_path}` |"
        )
    (out_dir / "conversation-index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def source_counts(records: list[MatchRecord]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for record in records:
        counter[record.source_tool] += 1
    return counter


def confidence_counts(records: list[MatchRecord]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for record in records:
        counter[record.confidence] += 1
    return counter


def path_counts(records: list[MatchRecord]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for record in records:
        counter[record.path] += 1
    return counter


def write_summary(
    path: Path,
    out_dir: Path,
    records: list[MatchRecord],
    roots: list[SourceRoot],
    stats: ScanStats,
    terms: list[str],
    args: argparse.Namespace,
    project_root: Path,
    archived_conversations: list[ConversationArchiveRecord] | None = None,
) -> None:
    sorted_records = sorted(
        records,
        key=lambda item: (-item.score, item.source_tool, item.path, item.record_id),
    )
    lines: list[str] = []
    lines.append("# Pact History Miner Summary")
    lines.append("")
    lines.append(f"- Generated: {dt.datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"- Project root: `{project_root}`")
    lines.append(f"- Output dir: `{out_dir}`")
    lines.append(f"- Matches: {len(records)}")
    lines.append(f"- Records scanned: {stats.records_seen}")
    lines.append(f"- Files scanned: {stats.files_scanned}")
    lines.append(f"- SQLite DBs scanned: {stats.sqlite_scanned}")
    if archived_conversations is not None:
        lines.append(f"- Archived conversations: {len(archived_conversations)}")
    lines.append("")
    lines.append("## Terms")
    lines.append("")
    lines.append(", ".join(f"`{term}`" for term in terms))
    lines.append("")
    lines.append("## Counts")
    lines.append("")
    lines.append("### By Source")
    lines.append("")
    for source, count in source_counts(records).most_common():
        lines.append(f"- `{source}`: {count}")
    if not records:
        lines.append("- none")
    lines.append("")
    lines.append("### By Confidence")
    lines.append("")
    conf = confidence_counts(records)
    for level in ("high", "medium", "low"):
        lines.append(f"- `{level}`: {conf.get(level, 0)}")
    lines.append("")
    lines.append("### Top Matched Files")
    lines.append("")
    for matched_path, count in path_counts(records).most_common(20):
        lines.append(f"- {count}: `{matched_path}`")
    if not records:
        lines.append("- none")
    lines.append("")
    if archived_conversations is not None:
        lines.append("### Conversation Archive")
        lines.append("")
        lines.append(f"- Files: {len(archived_conversations)}")
        lines.append(f"- Index: `{out_dir / 'conversation-index.md'}`")
        lines.append(f"- JSONL index: `{out_dir / 'conversation-index.jsonl'}`")
        lines.append("")
    lines.append("## Source Roots")
    lines.append("")
    lines.append("| Status | Tool | Kind | Path | Note |")
    lines.append("| --- | --- | --- | --- | --- |")
    for root in roots:
        status = "present" if root.exists else "missing"
        lines.append(f"| {status} | `{root.tool}` | `{root.kind}` | `{root.path}` | {root.note} |")
    lines.append("")
    lines.append("## Top Matches")
    lines.append("")
    if not sorted_records:
        lines.append("No matching records found.")
    for index, record in enumerate(sorted_records[: args.summary_limit], 1):
        lines.append(f"### {index}. {record.confidence} score={record.score} source={record.source_tool}")
        lines.append("")
        lines.append(f"- Path: `{record.path}`")
        lines.append(f"- Record: `{record.record_id}`")
        if record.mtime:
            lines.append(f"- Modified: `{record.mtime}`")
        lines.append(f"- Terms: {', '.join(f'`{term}`' for term in record.matched_terms)}")
        if record.metadata:
            metadata = json.dumps(record.metadata, ensure_ascii=False, sort_keys=True)
            if len(metadata) > 700:
                metadata = metadata[:700] + "..."
            lines.append(f"- Metadata: `{metadata}`")
        for snippet in record.snippets:
            lines.append("")
            lines.append("> " + snippet.replace("\n", " "))
        lines.append("")
    lines.append("## Scan Notes")
    lines.append("")
    lines.append(f"- Skipped paths: {len(stats.skipped)}")
    lines.append(f"- Errors: {len(stats.errors)}")
    if stats.errors:
        lines.append("- See `sources.json` for error details.")
    if not args.include_full_text:
        lines.append("- Full matched text was not written. Rerun with `--include-full-text` if complete matched rows/lines are needed.")
    if not args.copy_matched_files:
        lines.append("- Raw source files were not copied. Rerun with `--copy-matched-files` if a portable evidence bundle is needed.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    project_root = normalize_path(args.project_root)
    args.after_ts = parse_local_time(args.after, "after")
    args.before_ts = parse_local_time(args.before, "before")
    terms = unique_preserve_order(default_terms(project_root) + args.term)
    roots = discover_roots(project_root, args.root)
    stats = ScanStats()
    out_dir = ensure_output_dir(args)

    records = scan_all(roots, terms, args, stats)
    write_jsonl(out_dir / "matches.jsonl", records)
    if args.copy_matched_files:
        copy_matched_files(out_dir, records, stats)
    archived_conversations: list[ConversationArchiveRecord] | None = None
    if args.archive_conversations:
        archived_conversations = write_conversation_archives(out_dir, records, args, stats)
    write_sources(out_dir / "sources.json", roots, stats, terms, project_root)
    write_summary(out_dir / "summary.md", out_dir, records, roots, stats, terms, args, project_root, archived_conversations)

    print(f"Output: {out_dir}")
    print(f"Matches: {len(records)}")
    if archived_conversations is not None:
        print(f"Archived conversations: {len(archived_conversations)}")
    print(f"Records scanned: {stats.records_seen}")
    print(f"Files scanned: {stats.files_scanned}")
    print(f"SQLite scanned: {stats.sqlite_scanned}")
    if stats.errors:
        print(f"Errors: {len(stats.errors)} (see sources.json)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
