use anyhow::{Result, anyhow};
use rusqlite::Connection;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const CONVERSATION_SCHEMA_VERSION: u32 = 2;
const MAX_HISTORY_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_HISTORY_FILES: usize = 8_000;
const MAX_SQLITE_ROWS_PER_TABLE: usize = 2_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HistoryAdapter {
    Antigravity,
    ClaudeCode,
    Codex,
    Copilot,
    Cursor,
    GeminiCli,
    Hermes,
    KiloCode,
    OpenClaw,
    OpenCode,
}

struct HistoryRoot {
    path: PathBuf,
    source_kind: &'static str,
}

impl HistoryAdapter {
    fn id(self) -> &'static str {
        match self {
            HistoryAdapter::Antigravity => "antigravity",
            HistoryAdapter::ClaudeCode => "claude-code",
            HistoryAdapter::Codex => "codex",
            HistoryAdapter::Copilot => "copilot",
            HistoryAdapter::Cursor => "cursor",
            HistoryAdapter::GeminiCli => "gemini-cli",
            HistoryAdapter::Hermes => "hermes",
            HistoryAdapter::KiloCode => "kilo-code",
            HistoryAdapter::OpenClaw => "openclaw",
            HistoryAdapter::OpenCode => "opencode",
        }
    }

    fn label(self) -> &'static str {
        match self {
            HistoryAdapter::Antigravity => "Antigravity",
            HistoryAdapter::ClaudeCode => "Claude Code",
            HistoryAdapter::Codex => "Codex",
            HistoryAdapter::Copilot => "GitHub Copilot",
            HistoryAdapter::Cursor => "Cursor",
            HistoryAdapter::GeminiCli => "Gemini CLI",
            HistoryAdapter::Hermes => "Hermes Agent",
            HistoryAdapter::KiloCode => "Kilo Code",
            HistoryAdapter::OpenClaw => "OpenClaw",
            HistoryAdapter::OpenCode => "OpenCode",
        }
    }

    fn accepts_file(self, path: &Path, extension: &str) -> bool {
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| name.ends_with(".backup") || name == "codebase-external.sqlite")
            .unwrap_or(false)
        {
            return false;
        }
        match self {
            HistoryAdapter::Codex => matches!(extension, "jsonl" | "ndjson" | "json" | "md"),
            HistoryAdapter::ClaudeCode => matches!(extension, "jsonl" | "json" | "md" | "txt"),
            HistoryAdapter::Antigravity | HistoryAdapter::GeminiCli => {
                matches!(
                    extension,
                    "jsonl"
                        | "ndjson"
                        | "json"
                        | "md"
                        | "txt"
                        | "log"
                        | "sqlite"
                        | "sqlite3"
                        | "db"
                        | "vscdb"
                )
            }
            HistoryAdapter::Cursor | HistoryAdapter::Copilot => {
                matches!(
                    extension,
                    "jsonl" | "ndjson" | "json" | "sqlite" | "sqlite3" | "db" | "vscdb"
                )
            }
            HistoryAdapter::KiloCode => {
                matches!(
                    extension,
                    "jsonl"
                        | "ndjson"
                        | "json"
                        | "md"
                        | "txt"
                        | "log"
                        | "sqlite"
                        | "sqlite3"
                        | "db"
                )
            }
            HistoryAdapter::OpenCode | HistoryAdapter::OpenClaw | HistoryAdapter::Hermes => {
                matches!(
                    extension,
                    "jsonl"
                        | "ndjson"
                        | "json"
                        | "md"
                        | "txt"
                        | "log"
                        | "sqlite"
                        | "sqlite3"
                        | "db"
                )
            }
        }
    }

    fn sqlite_table_may_hold_history(self, name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        if lower.starts_with("sqlite") || lower.contains("fts") || lower.contains("embedding") {
            return false;
        }
        if self == HistoryAdapter::KiloCode
            && (lower.contains("account") || lower.contains("control_account"))
        {
            return false;
        }
        match self {
            HistoryAdapter::Cursor | HistoryAdapter::Copilot | HistoryAdapter::Antigravity => {
                lower == "itemtable"
                    || lower.contains("chat")
                    || lower.contains("conversation")
                    || lower.contains("session")
                    || lower.contains("history")
            }
            _ => {
                lower.contains("chat")
                    || lower.contains("conversation")
                    || lower.contains("session")
                    || lower.contains("history")
                    || lower == "itemtable"
            }
        }
    }

    fn sqlite_row_may_hold_history(self, table: &str, key: Option<&str>, row_text: &str) -> bool {
        let key = key.unwrap_or_default().to_ascii_lowercase();
        let text = row_text.to_ascii_lowercase();
        match self {
            HistoryAdapter::Copilot => {
                key.contains("github.copilot")
                    || key.contains("copilot")
                    || key.contains("chatsessions")
                    || text.contains("copilot")
            }
            HistoryAdapter::Cursor => {
                key.contains("aichat")
                    || key.contains("composer")
                    || key.contains("chat")
                    || key.contains("conversation")
                    || looks_like_history_text(row_text)
            }
            HistoryAdapter::KiloCode => {
                !table.to_ascii_lowercase().contains("account") && looks_like_history_text(row_text)
            }
            _ => looks_like_history_text(row_text),
        }
    }
}

fn adapter_for_agent(agent_id: &str) -> Option<HistoryAdapter> {
    match agent_id {
        "antigravity" => Some(HistoryAdapter::Antigravity),
        "claude" | "claude-code" => Some(HistoryAdapter::ClaudeCode),
        "codex" => Some(HistoryAdapter::Codex),
        "copilot" | "github-copilot" => Some(HistoryAdapter::Copilot),
        "cursor" => Some(HistoryAdapter::Cursor),
        "gemini" | "gemini-cli" => Some(HistoryAdapter::GeminiCli),
        "hermes" | "hermes-agent" => Some(HistoryAdapter::Hermes),
        "kilo" | "kilo-code" => Some(HistoryAdapter::KiloCode),
        "openclaw" => Some(HistoryAdapter::OpenClaw),
        "opencode" => Some(HistoryAdapter::OpenCode),
        _ => None,
    }
}

pub fn conversation_list(params: &Value) -> Result<Value> {
    let agent_id = agent_param(params)?;
    let adapter = adapter_for_agent(&agent_id)
        .ok_or_else(|| anyhow!("unsupported native history adapter: {}", agent_id))?;
    let roots = history_roots(adapter, params);
    let mut sessions = Vec::<Value>::new();
    let mut skipped = Vec::<Value>::new();
    let mut files_seen = 0usize;

    for root in roots {
        scan_history_path(
            adapter,
            &root.path,
            root.source_kind,
            &mut sessions,
            &mut skipped,
            &mut files_seen,
        );
    }
    sessions.sort_by(|left, right| {
        right
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(
                left.get("updatedAt")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
    });

    Ok(json!({
        "ok": true,
        "schemaVersion": CONVERSATION_SCHEMA_VERSION,
        "mode": "native-history",
        "importMode": "precise-adapter",
        "readOnly": true,
        "agentId": agent_id,
        "adapterId": adapter.id(),
        "adapterLabel": adapter.label(),
        "sessions": sessions,
        "sources": {
            "filesSeen": files_seen,
            "skipped": skipped
        }
    }))
}

pub fn conversation_append(_params: &Value) -> Result<Value> {
    Err(anyhow!(
        "native agent history is read-only; Pact does not create synthetic local conversations"
    ))
}

pub fn conversation_delete(_params: &Value) -> Result<Value> {
    Err(anyhow!(
        "native agent history is read-only; Pact does not delete source agent conversations"
    ))
}

fn scan_history_path(
    adapter: HistoryAdapter,
    path: &Path,
    source_kind: &'static str,
    sessions: &mut Vec<Value>,
    skipped: &mut Vec<Value>,
    files_seen: &mut usize,
) {
    if *files_seen >= MAX_HISTORY_FILES {
        skipped.push(json!({
            "path": display_path(path),
            "reason": "file_limit_reached"
        }));
        return;
    }
    if !path.exists() {
        skipped.push(json!({
            "path": display_path(path),
            "reason": "not_present"
        }));
        return;
    }
    if path.is_dir() {
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(error) => {
                skipped.push(json!({
                    "path": display_path(path),
                    "reason": "read_dir_failed",
                    "error": error.to_string()
                }));
                return;
            }
        };
        for entry in entries.flatten() {
            scan_history_path(
                adapter,
                &entry.path(),
                source_kind,
                sessions,
                skipped,
                files_seen,
            );
            if *files_seen >= MAX_HISTORY_FILES {
                break;
            }
        }
        return;
    }

    *files_seen += 1;
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            skipped.push(json!({
                "path": display_path(path),
                "reason": "metadata_failed",
                "error": error.to_string()
            }));
            return;
        }
    };
    if metadata.len() > MAX_HISTORY_FILE_BYTES {
        skipped.push(json!({
            "path": display_path(path),
            "reason": "file_too_large",
            "bytes": metadata.len()
        }));
        return;
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !adapter.accepts_file(path, &extension) {
        return;
    }
    let parsed = match extension.as_str() {
        "jsonl" | "ndjson" => parse_jsonl_sessions(adapter, path, source_kind, &metadata),
        "json" => parse_json_sessions(adapter, path, source_kind, &metadata),
        "md" | "markdown" | "txt" | "log" => {
            parse_text_session(adapter, path, source_kind, &metadata)
        }
        "sqlite" | "sqlite3" | "db" | "vscdb" => {
            parse_sqlite_sessions(adapter, path, source_kind, &metadata)
        }
        _ => Vec::new(),
    };
    sessions.extend(parsed);
}

fn parse_jsonl_sessions(
    adapter: HistoryAdapter,
    path: &Path,
    source_kind: &str,
    metadata: &fs::Metadata,
) -> Vec<Value> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let mut grouped = Vec::<(String, Vec<Value>)>::new();
    for (index, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if let Some(message) = message_from_json(adapter, path, index, &value) {
                let session_id =
                    extract_native_session_id(&value).unwrap_or_else(|| "file".to_string());
                push_grouped_message(&mut grouped, session_id, message);
            }
        }
    }
    grouped
        .into_iter()
        .map(|(native_session_id, messages)| {
            session_from_messages(
                adapter,
                path,
                metadata,
                source_kind,
                native_session_id,
                messages,
            )
        })
        .collect()
}

fn parse_json_sessions(
    adapter: HistoryAdapter,
    path: &Path,
    source_kind: &str,
    metadata: &fs::Metadata,
) -> Vec<Value> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let value = match serde_json::from_str::<Value>(&raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let sessions = collect_explicit_json_sessions(adapter, path, metadata, source_kind, &value);
    if !sessions.is_empty() {
        return sessions;
    }
    let mut messages = Vec::<Value>::new();
    collect_messages_from_value(adapter, path, &value, &mut messages);
    if messages.is_empty() {
        return Vec::new();
    }
    vec![session_from_messages(
        adapter,
        path,
        metadata,
        source_kind,
        extract_native_session_id(&value).unwrap_or_else(|| "file".to_string()),
        messages,
    )]
}

fn parse_text_session(
    adapter: HistoryAdapter,
    path: &Path,
    source_kind: &str,
    metadata: &fs::Metadata,
) -> Vec<Value> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    if raw.trim().is_empty() || !looks_like_history_text(&raw) {
        return Vec::new();
    }
    let created_at = system_time(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH));
    let messages = vec![json!({
        "id": message_id(adapter.id(), path, 0),
        "role": "transcript",
        "text": raw,
        "createdAt": created_at,
        "sourcePath": display_path(path)
    })];
    vec![session_from_messages(
        adapter,
        path,
        metadata,
        source_kind,
        "file".to_string(),
        messages,
    )]
}

fn parse_sqlite_sessions(
    adapter: HistoryAdapter,
    path: &Path,
    source_kind: &str,
    metadata: &fs::Metadata,
) -> Vec<Value> {
    let connection = match Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
            | rusqlite::OpenFlags::SQLITE_OPEN_URI
            | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(connection) => connection,
        Err(_) => return Vec::new(),
    };
    let mut sessions = Vec::<Value>::new();
    let mut table_statement = match connection
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    {
        Ok(statement) => statement,
        Err(_) => return sessions,
    };
    let table_names = table_statement
        .query_map([], |row| row.get::<_, String>(0))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|name| adapter.sqlite_table_may_hold_history(name))
        .collect::<Vec<_>>();

    for table in table_names {
        let query = format!(
            "SELECT * FROM \"{}\" LIMIT {}",
            table.replace('"', "\"\""),
            MAX_SQLITE_ROWS_PER_TABLE
        );
        let mut statement = match connection.prepare(&query) {
            Ok(statement) => statement,
            Err(_) => continue,
        };
        let column_names = statement
            .column_names()
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        let rows = match statement.query_map([], |row| {
            let mut fields = Vec::<(String, String)>::new();
            for index in 0..column_names.len() {
                if let Ok(value) = row.get_ref(index).map(sqlite_value_text) {
                    if value.trim().is_empty() {
                        continue;
                    }
                    fields.push((column_names[index].clone(), value));
                }
            }
            Ok(fields)
        }) {
            Ok(rows) => rows,
            Err(_) => continue,
        };
        let mut grouped = Vec::<(String, Vec<Value>)>::new();
        for (index, fields) in rows.filter_map(Result::ok).enumerate() {
            let row_text = fields
                .iter()
                .map(|(name, value)| format!("{}: {}", name, value))
                .collect::<Vec<_>>()
                .join("\n");
            let row_key = sqlite_row_key(&fields);
            if !adapter.sqlite_row_may_hold_history(&table, row_key.as_deref(), &row_text) {
                continue;
            }
            let session_id = row_key
                .clone()
                .unwrap_or_else(|| format!("{}:{}", table, index));
            let mut row_messages = Vec::<Value>::new();
            if let Some(json_value) = extract_json_from_text(&row_text) {
                collect_messages_from_value(adapter, path, &json_value, &mut row_messages);
            }
            if row_messages.is_empty() {
                row_messages.push(json!({
                    "id": message_id(adapter.id(), path, index),
                    "role": "record",
                    "text": row_text,
                    "createdAt": system_time(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
                    "sourcePath": display_path(path),
                    "sourceTable": table,
                    "sourceKey": row_key.unwrap_or_default()
                }));
            }
            for message in row_messages {
                push_grouped_message(&mut grouped, session_id.clone(), message);
            }
        }
        for (native_session_id, messages) in grouped {
            sessions.push(session_from_messages(
                adapter,
                path,
                metadata,
                source_kind,
                native_session_id,
                messages,
            ));
        }
    }
    sessions
}

fn collect_explicit_json_sessions(
    adapter: HistoryAdapter,
    path: &Path,
    metadata: &fs::Metadata,
    source_kind: &str,
    value: &Value,
) -> Vec<Value> {
    let Some(object) = value.as_object() else {
        return Vec::new();
    };
    let mut sessions = Vec::<Value>::new();
    for key in ["sessions", "conversations", "chats", "chatSessions"] {
        let Some(Value::Array(items)) = object.get(key) else {
            continue;
        };
        for (index, item) in items.iter().enumerate() {
            let mut messages = Vec::<Value>::new();
            collect_messages_from_value(adapter, path, item, &mut messages);
            if messages.is_empty() {
                continue;
            }
            sessions.push(session_from_messages(
                adapter,
                path,
                metadata,
                source_kind,
                extract_native_session_id(item).unwrap_or_else(|| format!("{}-{}", key, index)),
                messages,
            ));
        }
    }
    sessions
}

fn push_grouped_message(
    groups: &mut Vec<(String, Vec<Value>)>,
    session_id: String,
    message: Value,
) {
    if let Some((_, messages)) = groups.iter_mut().find(|(id, _)| *id == session_id) {
        messages.push(message);
    } else {
        groups.push((session_id, vec![message]));
    }
}

fn collect_messages_from_value(
    adapter: HistoryAdapter,
    path: &Path,
    value: &Value,
    out: &mut Vec<Value>,
) {
    match value {
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                if let Some(message) = message_from_json(adapter, path, index, item) {
                    out.push(message);
                } else {
                    collect_messages_from_value(adapter, path, item, out);
                }
            }
        }
        Value::Object(object) => {
            let before = out.len();
            for key in [
                "messages",
                "conversation",
                "conversations",
                "transcript",
                "turns",
                "items",
                "entries",
                "sessions",
                "chats",
                "chatSessions",
            ] {
                if let Some(child) = object.get(key) {
                    collect_messages_from_value(adapter, path, child, out);
                }
            }
            if out.len() == before {
                if let Some(message) = message_from_json(adapter, path, 0, value) {
                    out.push(message);
                }
            }
        }
        _ => {}
    }
}

fn message_from_json(
    adapter: HistoryAdapter,
    path: &Path,
    index: usize,
    value: &Value,
) -> Option<Value> {
    let text = extract_text(value)?;
    if text.trim().is_empty() {
        return None;
    }
    Some(json!({
        "id": message_id(adapter.id(), path, index),
        "role": extract_role(value),
        "text": text,
        "createdAt": extract_timestamp(value).unwrap_or_else(|| {
            OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
        }),
        "sourcePath": display_path(path)
    }))
}

fn extract_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(extract_text)
                .filter(|text| !text.trim().is_empty())
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        Value::Object(object) => {
            for key in [
                "text", "content", "message", "prompt", "response", "answer", "summary", "value",
            ] {
                if let Some(text) = object.get(key).and_then(extract_text) {
                    if !text.trim().is_empty() {
                        return Some(text);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn extract_role(value: &Value) -> String {
    let role = find_string(value, &["role", "author", "speaker", "type", "source"])
        .unwrap_or_else(|| "system".to_string())
        .to_ascii_lowercase();
    if role.contains("user") || role.contains("human") {
        "user".to_string()
    } else if role.contains("assistant")
        || role.contains("agent")
        || role.contains("model")
        || role.contains("ai")
    {
        "agent".to_string()
    } else if role.contains("tool") {
        "tool".to_string()
    } else {
        role
    }
}

fn extract_timestamp(value: &Value) -> Option<String> {
    find_string(
        value,
        &[
            "createdAt",
            "updatedAt",
            "timestamp",
            "time",
            "date",
            "created_at",
            "updated_at",
        ],
    )
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(text) = object.get(*key).and_then(Value::as_str) {
            return Some(text.to_string());
        }
        if let Some(number) = object.get(*key).and_then(Value::as_i64) {
            return Some(number.to_string());
        }
    }
    if let Some(message) = object.get("message") {
        return find_string(message, keys);
    }
    None
}

fn extract_native_session_id(value: &Value) -> Option<String> {
    find_string(
        value,
        &[
            "sessionId",
            "session_id",
            "conversationId",
            "conversation_id",
            "chatId",
            "chat_id",
            "threadId",
            "thread_id",
        ],
    )
    .filter(|value| !value.trim().is_empty())
}

fn sqlite_row_key(fields: &[(String, String)]) -> Option<String> {
    for preferred in ["key", "id", "sessionId", "session_id", "conversationId"] {
        if let Some((_, value)) = fields
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(preferred))
        {
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

fn sqlite_value_text(value: rusqlite::types::ValueRef<'_>) -> String {
    match value {
        rusqlite::types::ValueRef::Null => String::new(),
        rusqlite::types::ValueRef::Integer(value) => value.to_string(),
        rusqlite::types::ValueRef::Real(value) => value.to_string(),
        rusqlite::types::ValueRef::Text(value) => String::from_utf8_lossy(value).to_string(),
        rusqlite::types::ValueRef::Blob(value) => String::from_utf8_lossy(value).to_string(),
    }
}

fn session_from_messages(
    adapter: HistoryAdapter,
    path: &Path,
    metadata: &fs::Metadata,
    source_kind: &str,
    native_session_id: String,
    messages: Vec<Value>,
) -> Value {
    let updated_at = system_time(metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH));
    let created_at = system_time(metadata.created().unwrap_or(SystemTime::UNIX_EPOCH));
    let title = messages
        .iter()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .or_else(|| messages.first())
        .and_then(|message| message.get("text").and_then(Value::as_str))
        .map(title_from_text)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Native history")
                .to_string()
        });
    json!({
        "id": session_id(adapter.id(), path, &native_session_id),
        "agentId": adapter.id(),
        "adapterId": adapter.id(),
        "adapterLabel": adapter.label(),
        "sourceTool": adapter.id(),
        "sourceKind": source_kind,
        "sourcePath": display_path(path),
        "nativeSessionId": native_session_id,
        "importMode": "precise-adapter",
        "title": title,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "native": true,
        "readOnly": true,
        "messageCount": messages.len(),
        "messages": messages
    })
}

fn history_roots(adapter: HistoryAdapter, params: &Value) -> Vec<HistoryRoot> {
    if let Some(root) = text_param(params, &["root", "historyRoot"]) {
        if !root.is_empty() {
            return vec![HistoryRoot {
                path: expand_home(&root),
                source_kind: "override-root",
            }];
        }
    }
    let home = home_dir();
    match adapter {
        HistoryAdapter::Codex => roots(&[
            (home.join(".codex/history.jsonl"), "codex-prompt-history"),
            (
                home.join(".codex/session_index.jsonl"),
                "codex-session-index",
            ),
            (home.join(".codex/sessions"), "codex-session-store"),
            (
                home.join(".codex/archived_sessions"),
                "codex-archived-session-store",
            ),
            (home.join(".codex/memories/MEMORY.md"), "codex-memory"),
            (
                home.join(".codex/memories/rollout_summaries"),
                "codex-rollout-summary",
            ),
        ]),
        HistoryAdapter::Antigravity => roots(&[
            (
                home.join("Library/Application Support/Antigravity IDE"),
                "antigravity-ide-state",
            ),
            (
                appdata_dir().join("Antigravity IDE"),
                "antigravity-ide-state",
            ),
            (
                local_appdata_dir().join("Antigravity IDE"),
                "antigravity-ide-state",
            ),
            (
                xdg_config_dir().join("Antigravity IDE"),
                "antigravity-ide-state",
            ),
            (
                home.join(".gemini/antigravity"),
                "antigravity-gemini-bridge",
            ),
            (
                home.join(".gemini/antigravity-ide"),
                "antigravity-gemini-bridge",
            ),
        ]),
        HistoryAdapter::ClaudeCode => roots(&[
            (home.join(".claude/projects"), "claude-project-transcripts"),
            (home.join(".claude.json"), "claude-global-state"),
        ]),
        HistoryAdapter::GeminiCli => {
            let mut items = vec![
                (home.join(".gemini/history"), "gemini-project-history"),
                (home.join(".gemini/tmp"), "gemini-temp-chats"),
            ];
            if let Some(project_slug) = params
                .get("project")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
            {
                items.push((
                    home.join(".gemini/history").join(project_slug.trim()),
                    "gemini-project-history",
                ));
                items.push((
                    home.join(".gemini/tmp")
                        .join(project_slug.trim())
                        .join("chats"),
                    "gemini-chat-sessions",
                ));
            }
            roots(&items)
        }
        HistoryAdapter::Cursor => roots(&[
            (
                home.join("Library/Application Support/Cursor/User/workspaceStorage"),
                "cursor-workspace-storage",
            ),
            (
                home.join("Library/Application Support/Cursor/User/globalStorage"),
                "cursor-global-storage",
            ),
            (
                appdata_dir().join("Cursor/User/workspaceStorage"),
                "cursor-workspace-storage",
            ),
            (
                appdata_dir().join("Cursor/User/globalStorage"),
                "cursor-global-storage",
            ),
            (
                xdg_config_dir().join("Cursor/User/workspaceStorage"),
                "cursor-workspace-storage",
            ),
            (
                xdg_config_dir().join("Cursor/User/globalStorage"),
                "cursor-global-storage",
            ),
        ]),
        HistoryAdapter::Copilot => roots(&[
            (
                home.join("Library/Application Support/Code/User/workspaceStorage"),
                "vscode-copilot-workspace-storage",
            ),
            (
                home.join("Library/Application Support/Code/User/globalStorage"),
                "vscode-copilot-global-storage",
            ),
            (
                appdata_dir().join("Code/User/workspaceStorage"),
                "vscode-copilot-workspace-storage",
            ),
            (
                appdata_dir().join("Code/User/globalStorage"),
                "vscode-copilot-global-storage",
            ),
            (
                xdg_config_dir().join("Code/User/workspaceStorage"),
                "vscode-copilot-workspace-storage",
            ),
            (
                xdg_config_dir().join("Code/User/globalStorage"),
                "vscode-copilot-global-storage",
            ),
        ]),
        HistoryAdapter::KiloCode => roots(&[
            (
                home.join(".local/share/kilo/kilo.db"),
                "kilo-session-database",
            ),
            (
                home.join(".local/share/kilo/storage/session_diff"),
                "kilo-session-diff",
            ),
            (
                home.join(".local/share/kilo/storage/session_share"),
                "kilo-session-share",
            ),
            (home.join(".local/share/kilo/log"), "kilo-log"),
            (home.join(".config/kilo"), "kilo-config"),
            (appdata_dir().join("kilo"), "kilo-appdata"),
            (xdg_data_dir().join("kilo"), "kilo-data"),
        ]),
        HistoryAdapter::OpenCode => roots(&[
            (home.join(".config/opencode"), "opencode-config"),
            (home.join(".local/share/opencode"), "opencode-data"),
            (appdata_dir().join("opencode"), "opencode-appdata"),
            (xdg_data_dir().join("opencode"), "opencode-data"),
        ]),
        HistoryAdapter::OpenClaw => roots(&[
            (home.join(".openclaw"), "openclaw-home"),
            (home.join(".config/openclaw"), "openclaw-config"),
            (appdata_dir().join("OpenClaw"), "openclaw-appdata"),
            (xdg_config_dir().join("openclaw"), "openclaw-config"),
        ]),
        HistoryAdapter::Hermes => roots(&[
            (home.join(".hermes"), "hermes-home"),
            (home.join(".config/hermes"), "hermes-config"),
            (appdata_dir().join("Hermes"), "hermes-appdata"),
            (xdg_config_dir().join("hermes"), "hermes-config"),
        ]),
    }
}

fn roots(items: &[(PathBuf, &'static str)]) -> Vec<HistoryRoot> {
    items
        .iter()
        .map(|(path, source_kind)| HistoryRoot {
            path: path.clone(),
            source_kind,
        })
        .collect()
}

fn looks_like_history_text(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.contains("assistant")
        || lower.contains("user")
        || lower.contains("prompt")
        || lower.contains("message")
        || lower.contains("conversation")
        || lower.contains("chat")
}

fn extract_json_from_text(text: &str) -> Option<Value> {
    for part in text.split('\n') {
        let trimmed = part.trim();
        if let Some(start) = trimmed.find('{') {
            if let Ok(value) = serde_json::from_str::<Value>(&trimmed[start..]) {
                return Some(value);
            }
        }
        if let Some(start) = trimmed.find('[') {
            if let Ok(value) = serde_json::from_str::<Value>(&trimmed[start..]) {
                return Some(value);
            }
        }
    }
    None
}

fn agent_param(params: &Value) -> Result<String> {
    text_param(params, &["agent", "agentId", "target"])
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("conversation command requires --agent"))
}

fn text_param(params: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| params.get(*key).and_then(Value::as_str))
        .map(|value| value.trim().to_string())
}

fn title_from_text(text: &str) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 64 {
        compact
    } else {
        format!("{}...", compact.chars().take(64).collect::<String>())
    }
}

fn session_id(agent_id: &str, path: &Path, native_session_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(agent_id.as_bytes());
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(native_session_id.as_bytes());
    format!("native-{:x}", hasher.finalize())
}

fn message_id(agent_id: &str, path: &Path, index: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(agent_id.as_bytes());
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(index.to_string().as_bytes());
    format!("msg-{:x}", hasher.finalize())
}

fn home_dir() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn appdata_dir() -> PathBuf {
    env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| xdg_config_dir())
}

fn local_appdata_dir() -> PathBuf {
    env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| xdg_data_dir())
}

fn xdg_config_dir() -> PathBuf {
    env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".config"))
}

fn xdg_data_dir() -> PathBuf {
    env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".local/share"))
}

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        return home_dir();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(value)
}

fn system_time(time: SystemTime) -> String {
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    OffsetDateTime::from_unix_timestamp(duration.as_secs() as i64)
        .unwrap_or(OffsetDateTime::UNIX_EPOCH)
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn conversations_scan_codex_jsonl_history() {
        let dir = temp_dir("codex-history");
        let history = dir.join("history.jsonl");
        fs::write(
            &history,
            [
                r#"{"role":"user","content":"Build Pact native history","createdAt":"2026-06-12T00:00:00Z"}"#,
                r#"{"role":"assistant","content":"Use Codex history adapter","createdAt":"2026-06-12T00:00:01Z"}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let listed = conversation_list(&json!({
            "agent": "codex",
            "root": dir.to_string_lossy()
        }))
        .unwrap();

        assert_eq!(listed["mode"], "native-history");
        assert_eq!(listed["readOnly"], true);
        let sessions = listed["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["agentId"], "codex");
        assert_eq!(sessions[0]["native"], true);
        assert_eq!(sessions[0]["messages"].as_array().unwrap().len(), 2);
        assert_eq!(
            sessions[0]["messages"][0]["text"],
            "Build Pact native history"
        );
    }

    #[test]
    fn codex_jsonl_groups_by_native_session_id() {
        let dir = temp_dir("codex-session-groups");
        fs::write(
            dir.join("session.jsonl"),
            [
                r#"{"sessionId":"codex-session-1","role":"user","content":"First session prompt"}"#,
                r#"{"sessionId":"codex-session-2","role":"user","content":"Second session prompt"}"#,
                r#"{"sessionId":"codex-session-2","role":"assistant","content":"Second session answer"}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let listed = conversation_list(&json!({
            "agent": "codex",
            "root": dir.to_string_lossy()
        }))
        .unwrap();

        assert_eq!(listed["adapterId"], "codex");
        assert_eq!(listed["importMode"], "precise-adapter");
        let sessions = listed["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 2);
        assert!(
            sessions
                .iter()
                .any(|session| session["nativeSessionId"] == "codex-session-2"
                    && session["messages"].as_array().unwrap().len() == 2)
        );
    }

    #[test]
    fn claude_code_adapter_extracts_nested_jsonl_messages() {
        let dir = temp_dir("claude-history");
        fs::write(
            dir.join("project.jsonl"),
            [
                r#"{"sessionId":"claude-session-1","type":"user","message":{"role":"user","content":[{"type":"text","text":"Open the Pact repo"}]}}"#,
                r#"{"sessionId":"claude-session-1","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Repo opened"}]}}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let listed = conversation_list(&json!({
            "agent": "claude-code",
            "root": dir.to_string_lossy()
        }))
        .unwrap();

        let sessions = listed["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["adapterId"], "claude-code");
        assert_eq!(sessions[0]["nativeSessionId"], "claude-session-1");
        assert_eq!(sessions[0]["messages"][0]["text"], "Open the Pact repo");
        assert_eq!(sessions[0]["messages"][1]["role"], "agent");
    }

    #[test]
    fn cursor_adapter_reads_sqlite_blob_chat_payloads() {
        let dir = temp_dir("cursor-history");
        let database = dir.join("state.vscdb");
        {
            let connection = Connection::open(&database).unwrap();
            connection
                .execute(
                    "CREATE TABLE ItemTable (key TEXT NOT NULL, value BLOB NOT NULL)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                    (
                        "composerData.session-1",
                        br#"{"messages":[{"role":"user","text":"Cursor native prompt"},{"role":"assistant","text":"Cursor native answer"}]}"#.as_slice(),
                    ),
                )
                .unwrap();
        }

        let listed = conversation_list(&json!({
            "agent": "cursor",
            "root": dir.to_string_lossy()
        }))
        .unwrap();

        let sessions = listed["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["adapterId"], "cursor");
        assert_eq!(sessions[0]["nativeSessionId"], "composerData.session-1");
        assert_eq!(sessions[0]["messages"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn copilot_adapter_imports_item_table_chat_sessions() {
        let dir = temp_dir("copilot-history");
        let database = dir.join("state.vscdb");
        {
            let connection = Connection::open(&database).unwrap();
            connection
                .execute(
                    "CREATE TABLE ItemTable (key TEXT NOT NULL, value TEXT NOT NULL)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                    [
                        "github.copilot-chat.chatSessions",
                        r#"{"chatSessions":[{"id":"copilot-chat-1","messages":[{"role":"user","content":"Ask Copilot about Pact"},{"role":"assistant","content":"Copilot answer"}]}]}"#,
                    ],
                )
                .unwrap();
        }

        let listed = conversation_list(&json!({
            "agent": "copilot",
            "root": dir.to_string_lossy()
        }))
        .unwrap();

        let sessions = listed["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["adapterId"], "copilot");
        assert_eq!(sessions[0]["messages"][0]["text"], "Ask Copilot about Pact");
    }

    #[test]
    fn every_supported_agent_has_dedicated_history_adapter() {
        for agent in [
            "antigravity",
            "claude-code",
            "codex",
            "copilot",
            "cursor",
            "gemini-cli",
            "hermes",
            "kilo-code",
            "openclaw",
            "opencode",
        ] {
            let dir = temp_dir(&format!("{}-adapter", agent));
            fs::write(
                dir.join("session.json"),
                format!(
                    r#"{{
                      "sessions": [{{
                        "sessionId": "{agent}-session",
                        "messages": [
                          {{"role": "user", "text": "{agent} native prompt"}},
                          {{"role": "assistant", "text": "{agent} native answer"}}
                        ]
                      }}]
                    }}"#
                ),
            )
            .unwrap();

            let listed = conversation_list(&json!({
                "agent": agent,
                "root": dir.to_string_lossy()
            }))
            .unwrap();

            assert_eq!(listed["adapterId"], agent);
            assert_eq!(listed["importMode"], "precise-adapter");
            assert_eq!(listed["sessions"][0]["adapterId"], agent);
            assert_eq!(
                listed["sessions"][0]["nativeSessionId"],
                format!("{}-session", agent)
            );
        }
    }

    #[test]
    fn unsupported_history_adapter_is_rejected() {
        let error = conversation_list(&json!({"agent": "unknown-agent"})).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("unsupported native history adapter")
        );
    }

    #[test]
    fn native_history_is_read_only() {
        assert!(conversation_append(&json!({})).is_err());
        assert!(conversation_delete(&json!({})).is_err());
    }

    #[test]
    fn sqlite_history_preserves_multiple_record_rows() {
        let dir = temp_dir("sqlite-history");
        let database = dir.join("state.vscdb");
        {
            let connection = Connection::open(&database).unwrap();
            connection
                .execute(
                    "CREATE TABLE ItemTable (key TEXT NOT NULL, value TEXT NOT NULL)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                    ["chat.first", "user message: First native conversation turn"],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                    [
                        "chat.second",
                        "assistant message: Second native conversation turn",
                    ],
                )
                .unwrap();
        }

        let listed = conversation_list(&json!({
            "agent": "cursor",
            "root": dir.to_string_lossy()
        }))
        .unwrap();

        let sessions = listed["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 2);
        let total_messages = sessions
            .iter()
            .map(|session| session["messages"].as_array().unwrap().len())
            .sum::<usize>();
        assert_eq!(total_messages, 2);
        assert!(
            sessions
                .iter()
                .any(|session| session["nativeSessionId"] == "chat.second")
        );
    }

    fn temp_dir(name: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("pact-client-{}-{}", name, now));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
