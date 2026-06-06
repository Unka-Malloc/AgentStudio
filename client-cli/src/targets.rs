use crate::client_state::ClientStateStore;
use anyhow::{Result, anyhow};
use directories::UserDirs;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SUPPORTED_ACTIONS: &[&str] = &[
    "scan",
    "add",
    "inspect",
    "mcp.config.plan",
    "mcp.config.apply",
    "mcp.config.rollback",
];

#[derive(Clone, Debug)]
struct TargetDef {
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    config_hint: &'static str,
    binary_names: &'static [&'static str],
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetCandidate {
    pub target: String,
    pub label: String,
    pub kind: String,
    pub status: String,
    pub configured: bool,
    pub confidence: f64,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    pub manual: bool,
    pub adapter_status: String,
    pub supported_actions: Vec<String>,
}

#[derive(Clone, Debug)]
struct ManualTarget {
    target: String,
    label: String,
    kind: String,
    config_path: Option<PathBuf>,
    binary_path: Option<PathBuf>,
}

fn target_defs() -> Vec<TargetDef> {
    vec![
        TargetDef {
            id: "openclaw",
            label: "OpenClaw",
            kind: "vm-cli",
            config_hint: "OpenClaw VM MCP configuration",
            binary_names: &["openclaw"],
        },
        TargetDef {
            id: "claude-code",
            label: "Claude Code",
            kind: "cli",
            config_hint: "Claude Code MCP CLI configuration",
            binary_names: &["claude"],
        },
        TargetDef {
            id: "codex",
            label: "Codex",
            kind: "cli",
            config_hint: "Codex MCP configuration",
            binary_names: &["codex"],
        },
        TargetDef {
            id: "gemini-cli",
            label: "Gemini CLI",
            kind: "cli",
            config_hint: "Gemini CLI MCP configuration",
            binary_names: &["gemini"],
        },
        TargetDef {
            id: "antigravity",
            label: "Antigravity",
            kind: "cli",
            config_hint: "Antigravity MCP configuration",
            binary_names: &["antigravity"],
        },
        TargetDef {
            id: "opencode",
            label: "OpenCode",
            kind: "cli",
            config_hint: "OpenCode remote MCP configuration",
            binary_names: &["opencode"],
        },
        TargetDef {
            id: "copilot",
            label: "Copilot",
            kind: "cli",
            config_hint: "Copilot MCP CLI configuration",
            binary_names: &["copilot"],
        },
        TargetDef {
            id: "kilo-code",
            label: "Kilo Code",
            kind: "cli",
            config_hint: "Kilo Code MCP configuration",
            binary_names: &["kilo"],
        },
        TargetDef {
            id: "cursor",
            label: "Cursor",
            kind: "desktop-agent",
            config_hint: "Cursor MCP configuration",
            binary_names: &["cursor"],
        },
        TargetDef {
            id: "windsurf",
            label: "Windsurf",
            kind: "desktop-agent",
            config_hint: "Windsurf MCP configuration",
            binary_names: &["windsurf"],
        },
        TargetDef {
            id: "hermes",
            label: "Hermes Agent",
            kind: "vm-cli",
            config_hint: "Hermes Agent MCP configuration",
            binary_names: &["hermes"],
        },
    ]
}

pub fn scan_targets() -> Result<Value> {
    scan_targets_with_params(&json!({}))
}

pub fn scan_targets_with_params(params: &Value) -> Result<Value> {
    let store = client_state_store(params)?;
    let manual_targets = manual_targets(&store)?;
    let candidates = target_defs()
        .iter()
        .map(|def| {
            let manual = manual_targets.iter().find(|item| item.target == def.id);
            scan_target_with_manual(def, manual)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(json!({
        "ok": true,
        "schemaVersion": 1,
        "source": "target-adapters",
        "candidates": candidates,
    }))
}

pub fn add_target(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    let def = target_def(&target)?;
    let store = client_state_store(params)?;
    let saved = upsert_manual_target(&store, &def, params)?;
    let activity = store.activity_log().append(
        "target.manual.saved",
        json!({
            "target": def.id,
            "configPath": saved.get("configPath").cloned().unwrap_or_else(|| json!("")),
            "binaryPath": saved.get("binaryPath").cloned().unwrap_or_else(|| json!(""))
        }),
    )?;
    Ok(json!({
        "ok": true,
        "status": "accepted",
        "target": def.id,
        "label": def.label,
        "manual": true,
        "record": saved,
        "activity": activity,
        "nextAction": "mcp.config.plan",
    }))
}

pub fn inspect_target(target: &str) -> Result<Value> {
    inspect_target_with_params(&json!({ "target": target }))
}

pub fn inspect_target_with_params(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    let def = target_def(&target)?;
    let store = client_state_store(params)?;
    let manual_targets = manual_targets(&store)?;
    let manual = manual_targets.iter().find(|item| item.target == def.id);
    let candidate = scan_target_with_manual(&def, manual)?;
    Ok(json!({
        "ok": true,
        "target": candidate,
        "fields": target_fields(def.id),
        "writePolicy": {
            "snapshotRequired": true,
            "structuredPatchRequired": true,
            "atomicWriteRequired": true,
            "preserveUnrelatedConfig": true
        }
    }))
}

pub fn mcp_config_plan(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    let def = target_def(&target)?;
    let config_path = resolve_config_path(&def, params).ok();
    let base_url = normalize_base_url(params);
    let token_ref = token_ref(params);
    Ok(json!({
        "ok": true,
        "status": "planned",
        "target": def.id,
        "label": def.label,
        "plan": {
            "operation": "mcp.config.apply",
            "configPath": config_path.map(display_path),
            "baseUrl": base_url,
            "tokenRef": token_ref,
            "fields": target_fields_with_values(def.id, &base_url, &token_ref),
            "requiresSnapshot": true,
            "requiresStructuredPatch": true,
            "requiresAtomicWrite": true,
            "rollbackCommand": "pact-client mcp config rollback --target <target> --snapshot-id <snapshotId>"
        }
    }))
}

pub fn mcp_config_apply(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    let def = target_def(&target)?;
    let config_path = resolve_config_path(&def, params)?;
    let base_url = normalize_base_url(params);
    let token_ref = token_ref(params);
    let current = fs::read_to_string(&config_path).unwrap_or_default();
    let before_hash = hash_text(&current);
    if let Some(expected_hash) = params.get("expectedHash").and_then(Value::as_str) {
        if expected_hash != before_hash {
            return Ok(json!({
                "ok": false,
                "status": "field_conflict",
                "target": def.id,
                "configPath": display_path(config_path),
                "expectedHash": expected_hash,
                "actualHash": before_hash,
                "message": "Target config changed after plan; refusing to overwrite without a new plan."
            }));
        }
    }
    let fields = target_fields_with_values(def.id, &base_url, &token_ref);
    let new_content = apply_structured_patch(def.id, &current, &base_url, &token_ref)?;
    let store = client_state_store(params)?;
    let snapshot = store.snapshot_store().capture(
        def.id,
        &config_path,
        json!({
            "operation": "mcp.config.apply",
            "configPath": display_path(config_path.clone()),
            "beforeHash": before_hash.clone(),
            "fields": fields.clone()
        }),
    )?;
    atomic_write(&config_path, &new_content)?;
    let after_hash = hash_text(&new_content);
    let activity = store.activity_log().append(
        "mcp.config.applied",
        json!({
            "target": def.id,
            "configPath": display_path(config_path.clone()),
            "snapshotId": snapshot.snapshot_id.clone(),
            "snapshotPath": display_path(snapshot.snapshot_path.clone()),
            "beforeHash": before_hash.clone(),
            "afterHash": after_hash.clone()
        }),
    )?;
    Ok(json!({
        "ok": true,
        "status": "applied",
        "target": def.id,
        "configPath": display_path(config_path),
        "snapshotId": snapshot.snapshot_id,
        "snapshotPath": display_path(snapshot.snapshot_path),
        "beforeHash": before_hash,
        "afterHash": after_hash,
        "activity": activity,
        "patch": {
            "type": "structured",
            "fields": fields
        }
    }))
}

pub fn mcp_config_rollback(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    let def = target_def(&target)?;
    let store = client_state_store(params)?;
    let Some(snapshot_path) = params.get("snapshotPath").and_then(Value::as_str) else {
        let snapshot_id = snapshot_id_from_params(params)?;
        let restore = store.snapshot_store().restore(&snapshot_id)?;
        let activity = store.activity_log().append(
            "mcp.config.rolled_back",
            json!({
                "target": def.id,
                "snapshotId": snapshot_id.clone(),
                "snapshotPath": restore.get("snapshotPath").cloned().unwrap_or_else(|| json!("")),
                "configPath": restore.get("sourcePath").cloned().unwrap_or_else(|| json!(""))
            }),
        )?;
        return Ok(json!({
            "ok": true,
            "status": "rolled_back",
            "target": def.id,
            "configPath": restore.get("sourcePath").cloned().unwrap_or_else(|| json!("")),
            "restoredSnapshotId": snapshot_id,
            "restoredSnapshotPath": restore.get("snapshotPath").cloned().unwrap_or_else(|| json!("")),
            "preRollbackSnapshotId": restore.get("preRestoreSnapshotId").cloned().unwrap_or_else(|| json!("")),
            "preRollbackSnapshotPath": restore.get("preRestoreSnapshotPath").cloned().unwrap_or_else(|| json!("")),
            "activity": activity
        }));
    };
    let snapshot_path = PathBuf::from(snapshot_path);
    let raw = fs::read_to_string(&snapshot_path)?;
    let snapshot: Value = serde_json::from_str(&raw)?;
    let config_path = snapshot
        .get("sourcePath")
        .or_else(|| snapshot.get("configPath"))
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| anyhow!("Snapshot is missing sourcePath"))?;
    let existed = snapshot
        .get("existed")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let original_content = snapshot
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let rollback_snapshot = store.snapshot_store().capture(
        def.id,
        &config_path,
        json!({
            "operation": "mcp.config.rollback",
            "restoringSnapshotPath": display_path(snapshot_path.clone())
        }),
    )?;
    if existed {
        atomic_write(&config_path, original_content)?;
    } else if config_path.exists() {
        fs::remove_file(&config_path)?;
    }
    let snapshot_id = snapshot
        .get("snapshotId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let activity = store.activity_log().append(
        "mcp.config.rolled_back",
        json!({
            "target": def.id,
            "configPath": display_path(config_path.clone()),
            "snapshotId": snapshot_id.clone(),
            "snapshotPath": display_path(snapshot_path.clone()),
            "preRollbackSnapshotId": rollback_snapshot.snapshot_id.clone(),
            "preRollbackSnapshotPath": display_path(rollback_snapshot.snapshot_path.clone())
        }),
    )?;
    Ok(json!({
        "ok": true,
        "status": "rolled_back",
        "target": def.id,
        "configPath": display_path(config_path),
        "restoredSnapshotId": snapshot_id,
        "restoredSnapshotPath": display_path(snapshot_path),
        "preRollbackSnapshotId": rollback_snapshot.snapshot_id,
        "preRollbackSnapshotPath": display_path(rollback_snapshot.snapshot_path),
        "activity": activity
    }))
}

fn scan_target_with_manual(
    def: &TargetDef,
    manual: Option<&ManualTarget>,
) -> Result<TargetCandidate> {
    let config_path = manual
        .and_then(|item| item.config_path.clone())
        .or_else(|| default_config_path(def.id));
    let binary_path = manual
        .and_then(|item| item.binary_path.clone())
        .or_else(|| find_binary(def.binary_names));
    let configured = config_path
        .as_ref()
        .map(|path| config_has_pact(path))
        .unwrap_or(false);
    let config_exists = config_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let detected = config_exists || binary_path.is_some();
    let manual_entry = manual.is_some();
    let status = if configured {
        "configured"
    } else if detected {
        "detected"
    } else if manual_entry {
        "manual"
    } else {
        "not-detected"
    };
    let confidence = if configured {
        1.0
    } else if detected {
        0.72
    } else {
        0.15
    };
    let base_detail = match (&config_path, &binary_path) {
        (Some(config), Some(binary)) => {
            format!(
                "{}: {}; binary: {}",
                def.config_hint,
                config.display(),
                binary.display()
            )
        }
        (Some(config), None) => format!("{}: {}", def.config_hint, config.display()),
        (None, Some(binary)) => format!("binary: {}", binary.display()),
        (None, None) => def.config_hint.to_string(),
    };
    let detail = if manual_entry {
        format!("Manual entry: {}", base_detail)
    } else {
        base_detail
    };
    Ok(TargetCandidate {
        target: def.id.to_string(),
        label: manual
            .map(|item| item.label.clone())
            .unwrap_or_else(|| def.label.to_string()),
        kind: manual
            .map(|item| item.kind.clone())
            .unwrap_or_else(|| def.kind.to_string()),
        status: status.to_string(),
        configured,
        confidence,
        detail,
        config_path: config_path.map(display_path),
        binary_path: binary_path.map(display_path),
        manual: manual_entry,
        adapter_status: "implemented".to_string(),
        supported_actions: SUPPORTED_ACTIONS
            .iter()
            .map(|item| item.to_string())
            .collect(),
    })
}

fn manual_targets(store: &ClientStateStore) -> Result<Vec<ManualTarget>> {
    let document = store.read_collection("targets")?;
    let items = document
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut manual = Vec::new();
    for item in items {
        let Some(target) = item
            .get("target")
            .and_then(Value::as_str)
            .map(normalize_target)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Ok(def) = target_def(&target) else {
            continue;
        };
        manual.push(ManualTarget {
            target: def.id.to_string(),
            label: item
                .get("label")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(def.label)
                .to_string(),
            kind: item
                .get("kind")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(def.kind)
                .to_string(),
            config_path: optional_path(&item, "configPath"),
            binary_path: optional_path(&item, "binaryPath"),
        });
    }
    Ok(manual)
}

fn upsert_manual_target(
    store: &ClientStateStore,
    def: &TargetDef,
    params: &Value,
) -> Result<Value> {
    let mut document = store.read_collection("targets")?;
    let mut items = document
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let now = timestamp();
    let existing = items.iter().position(|item| {
        item.get("target")
            .and_then(Value::as_str)
            .map(normalize_target)
            .as_deref()
            == Some(def.id)
    });
    let created_at = existing
        .and_then(|index| {
            items[index]
                .get("createdAt")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| now.clone());
    let record = json!({
        "target": def.id,
        "label": param_string(params, "label").unwrap_or_else(|| def.label.to_string()),
        "kind": param_string(params, "kind").unwrap_or_else(|| def.kind.to_string()),
        "manual": true,
        "configPath": param_string(params, "configPath"),
        "binaryPath": param_string(params, "binaryPath"),
        "createdAt": created_at,
        "updatedAt": now
    });
    match existing {
        Some(index) => items[index] = record.clone(),
        None => items.push(record.clone()),
    }
    document["items"] = Value::Array(items);
    store.write_collection("targets", document)?;
    Ok(record)
}

fn optional_path(item: &Value, key: &str) -> Option<PathBuf> {
    item.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn param_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn target_def(target: &str) -> Result<TargetDef> {
    let normalized = normalize_target(target);
    target_defs()
        .into_iter()
        .find(|def| def.id == normalized)
        .ok_or_else(|| anyhow!("Unsupported target adapter: {}", target))
}

fn target_param(params: &Value) -> Result<String> {
    params
        .get("target")
        .and_then(Value::as_str)
        .or_else(|| {
            params
                .get("positionals")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(Value::as_str)
        })
        .map(normalize_target)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("Missing --target <target>"))
}

fn normalize_target(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "claude" | "claude_code" | "claudecode" => "claude-code".to_string(),
        "gemini" | "gemini_cli" => "gemini-cli".to_string(),
        "kilo" | "kilo_code" | "kilocode" => "kilo-code".to_string(),
        "github-copilot" => "copilot".to_string(),
        "open-code" | "open_code" => "opencode".to_string(),
        "openclaw-kate" | "openclaw_kate" => "openclaw".to_string(),
        "hermes-agent" | "hermes_serena" | "hermes-serena" => "hermes".to_string(),
        other => other.to_string(),
    }
}

fn target_fields(target: &str) -> Value {
    target_fields_with_values(target, "<base-url>/mcp", "<token-ref>")
}

fn target_fields_with_values(target: &str, base_url: &str, token_ref: &str) -> Value {
    let mcp_url = mcp_url(base_url);
    match target {
        "opencode" => json!([
            {"path": "mcp.pact.type", "value": "remote"},
            {"path": "mcp.pact.url", "value": mcp_url},
            {"path": "mcp.pact.headers.X-Pact-Api-Key", "value": token_ref},
            {"path": "mcp.pact.enabled", "value": true}
        ]),
        "antigravity" => json!([
            {"path": "mcpServers.pact.serverUrl", "value": mcp_url},
            {"path": "mcpServers.pact.headers.X-Pact-Api-Key", "value": token_ref},
            {"path": "mcpServers.pact.disabled", "value": false}
        ]),
        "codex" => json!([
            {"path": "mcp_servers.pact.url", "value": mcp_url},
            {"path": "mcp_servers.pact.bearer_token_env_var", "value": "PACT_MCP_TOKEN"}
        ]),
        "gemini-cli" => json!([
            {"path": "mcpServers.pact.transport", "value": "http"},
            {"path": "mcpServers.pact.url", "value": mcp_url},
            {"path": "mcpServers.pact.headers.X-Pact-Api-Key", "value": token_ref}
        ]),
        "claude-code" | "copilot" => json!([
            {"path": "cli.mcp.command", "value": format!("{} mcp add", target)},
            {"path": "cli.mcp.transport", "value": "http"},
            {"path": "cli.mcp.url", "value": mcp_url},
            {"path": "cli.mcp.headers.X-Pact-Api-Key", "value": token_ref}
        ]),
        "kilo-code" => json!([
            {"path": "mcp.pact.type", "value": "remote"},
            {"path": "mcp.pact.url", "value": mcp_url},
            {"path": "mcp.pact.headers.X-Pact-Api-Key", "value": token_ref},
            {"path": "mcp.pact.enabled", "value": true}
        ]),
        "openclaw" => json!([
            {"path": "vm.name", "value": "<vm>"},
            {"path": "mcp.pact.url", "value": mcp_url},
            {"path": "mcp.pact.headers.X-Pact-Api-Key", "value": token_ref}
        ]),
        "hermes" => json!([
            {"path": "vm.name", "value": "<vm>"},
            {"path": "hermes.mcp.pact.url", "value": mcp_url},
            {"path": "hermes.mcp.pact.auth", "value": "header"},
            {"path": "hermes.mcp.pact.headers.X-Pact-Api-Key", "value": token_ref}
        ]),
        "cursor" | "windsurf" => json!([
            {"path": "mcpServers.pact.command", "value": "pact-mcp"},
            {"path": "mcpServers.pact.args", "value": ["server"]}
        ]),
        _ => json!([]),
    }
}

fn apply_structured_patch(
    target: &str,
    current: &str,
    base_url: &str,
    token_ref: &str,
) -> Result<String> {
    match target {
        "codex" => apply_codex_patch(current, base_url),
        "opencode" | "antigravity" | "cursor" | "windsurf" | "gemini-cli" | "openclaw"
        | "kilo-code" => apply_json_patch(target, current, base_url, token_ref),
        _ => Err(anyhow!("Unsupported target adapter: {}", target)),
    }
}

fn apply_json_patch(
    target: &str,
    current: &str,
    base_url: &str,
    token_ref: &str,
) -> Result<String> {
    let parsed = if current.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&strip_json_comments(current))
            .map_err(|error| anyhow!("Unable to parse target JSON config: {}", error))?
    };
    let mut config = parsed.as_object().cloned().unwrap_or_else(Map::new);
    let patch = json_patch_entries(target, base_url, token_ref);
    for (path, value) in patch {
        set_json_path(&mut config, &path, value)?;
    }
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&Value::Object(config))?
    ))
}

fn apply_codex_patch(current: &str, base_url: &str) -> Result<String> {
    let mut root = if current.trim().is_empty() {
        toml::map::Map::new()
    } else {
        current
            .parse::<toml::Value>()
            .map_err(|error| anyhow!("Unable to parse Codex TOML config: {}", error))?
            .as_table()
            .cloned()
            .ok_or_else(|| anyhow!("Codex TOML config must be a table"))?
    };
    let mcp_servers = root
        .entry("mcp_servers".to_string())
        .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut()
        .ok_or_else(|| anyhow!("Codex mcp_servers must be a table"))?;
    let mut pact = toml::map::Map::new();
    pact.insert("url".to_string(), toml::Value::String(mcp_url(base_url)));
    pact.insert(
        "bearer_token_env_var".to_string(),
        toml::Value::String("PACT_MCP_TOKEN".to_string()),
    );
    mcp_servers.insert("pact".to_string(), toml::Value::Table(pact));
    Ok(toml::to_string_pretty(&toml::Value::Table(root))?)
}

fn json_patch_entries(target: &str, base_url: &str, token_ref: &str) -> Vec<(String, Value)> {
    let mcp_url = mcp_url(base_url);
    match target {
        "opencode" => vec![
            ("mcp.pact.type".to_string(), json!("remote")),
            ("mcp.pact.url".to_string(), json!(mcp_url)),
            (
                "mcp.pact.headers.X-Pact-Api-Key".to_string(),
                json!(token_ref),
            ),
            ("mcp.pact.enabled".to_string(), json!(true)),
        ],
        "antigravity" => vec![
            ("mcpServers.pact.serverUrl".to_string(), json!(mcp_url)),
            (
                "mcpServers.pact.headers.X-Pact-Api-Key".to_string(),
                json!(token_ref),
            ),
            ("mcpServers.pact.disabled".to_string(), json!(false)),
        ],
        "gemini-cli" => vec![
            ("mcpServers.pact.transport".to_string(), json!("http")),
            ("mcpServers.pact.url".to_string(), json!(mcp_url)),
            (
                "mcpServers.pact.headers.X-Pact-Api-Key".to_string(),
                json!(token_ref),
            ),
        ],
        "kilo-code" => vec![
            ("mcp.pact.type".to_string(), json!("remote")),
            ("mcp.pact.url".to_string(), json!(mcp_url)),
            (
                "mcp.pact.headers.X-Pact-Api-Key".to_string(),
                json!(token_ref),
            ),
            ("mcp.pact.enabled".to_string(), json!(true)),
        ],
        "openclaw" => vec![
            ("mcp.pact.type".to_string(), json!("remote")),
            ("mcp.pact.url".to_string(), json!(mcp_url)),
            (
                "mcp.pact.headers.X-Pact-Api-Key".to_string(),
                json!(token_ref),
            ),
            ("mcp.pact.enabled".to_string(), json!(true)),
        ],
        "cursor" | "windsurf" => vec![
            ("mcpServers.pact.command".to_string(), json!("pact-mcp")),
            ("mcpServers.pact.args".to_string(), json!(["server"])),
        ],
        _ => Vec::new(),
    }
}

fn set_json_path(root: &mut Map<String, Value>, path: &str, value: Value) -> Result<()> {
    if path.is_empty() {
        return Err(anyhow!("Empty config path"));
    }
    let mut current = root;
    let parts = path.split('.').collect::<Vec<_>>();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        let entry = current
            .entry((*part).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !entry.is_object() {
            *entry = Value::Object(Map::new());
        }
        current = entry
            .as_object_mut()
            .ok_or_else(|| anyhow!("Unable to create config object for {}", path))?;
    }
    let Some(last) = parts.last() else {
        return Err(anyhow!("Empty config path"));
    };
    current.insert((*last).to_string(), value);
    Ok(())
}

fn strip_json_comments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(ch) = chars.next() {
        if in_string {
            escaped = ch == '\\' && !escaped;
            if ch == '"' && !escaped {
                in_string = false;
            }
            output.push(ch);
            if ch != '\\' {
                escaped = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            output.push(ch);
            continue;
        }
        if ch == '/' {
            match chars.peek() {
                Some('/') => {
                    chars.next();
                    for next in chars.by_ref() {
                        if next == '\n' {
                            output.push('\n');
                            break;
                        }
                    }
                    continue;
                }
                Some('*') => {
                    chars.next();
                    let mut previous = '\0';
                    for next in chars.by_ref() {
                        if previous == '*' && next == '/' {
                            break;
                        }
                        previous = next;
                    }
                    continue;
                }
                _ => {}
            }
        }
        output.push(ch);
    }
    output
}

fn resolve_config_path(def: &TargetDef, params: &Value) -> Result<PathBuf> {
    params
        .get("configPath")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| stored_config_path(def, params).ok().flatten())
        .or_else(|| default_config_path(def.id))
        .ok_or_else(|| anyhow!("{} requires --config-path for config writes", def.label))
}

fn stored_config_path(def: &TargetDef, params: &Value) -> Result<Option<PathBuf>> {
    let store = client_state_store(params)?;
    Ok(manual_targets(&store)?
        .into_iter()
        .find(|item| item.target == def.id)
        .and_then(|item| item.config_path))
}

fn normalize_base_url(params: &Value) -> String {
    normalize_base_url_with_env(params, env::var("PACT_MCP_URL").ok())
}

fn normalize_base_url_with_env(params: &Value, mcp_url: Option<String>) -> String {
    params
        .get("baseUrl")
        .or_else(|| params.get("url"))
        .and_then(Value::as_str)
        .and_then(normalize_url_value)
        .or_else(|| discovered_base_url_from_params(params))
        .or_else(|| mcp_url.as_deref().and_then(normalize_url_value))
        .or_else(discovered_base_url_from_environment)
        .unwrap_or_else(|| "http://127.0.0.1:7228".to_string())
}

fn token_ref(params: &Value) -> String {
    token_ref_with_env(params, env::var("PACT_MCP_TOKEN").ok())
}

fn token_ref_with_env(params: &Value, mcp_token: Option<String>) -> String {
    params
        .get("token")
        .or_else(|| params.get("apiKey"))
        .or_else(|| params.get("pactApiKey"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            mcp_token
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "${PACT_MCP_TOKEN}".to_string())
}

fn mcp_url(base_url: &str) -> String {
    if base_url.ends_with("/mcp") {
        base_url.to_string()
    } else {
        format!("{}/mcp", base_url.trim_end_matches('/'))
    }
}

fn discovered_base_url_from_params(params: &Value) -> Option<String> {
    param_path(params, "discoveryFile")
        .or_else(|| param_path(params, "mcpDiscoveryFile"))
        .and_then(|path| base_url_from_json_file(&path))
        .or_else(|| {
            param_path(params, "registryFile")
                .or_else(|| param_path(params, "mcpRegistryFile"))
                .filter(|path| path.exists())
                .and_then(|path| base_url_from_json_file(&path))
        })
}

fn discovered_base_url_from_environment() -> Option<String> {
    env_path("PACT_MCP_DISCOVERY_FILE")
        .and_then(|path| base_url_from_json_file(&path))
        .or_else(|| {
            env_path("PACT_MCP_REGISTRY_FILE")
                .or_else(default_registry_file)
                .filter(|path| path.exists())
                .and_then(|path| base_url_from_json_file(&path))
        })
}

fn param_path(params: &Value, key: &str) -> Option<PathBuf> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn default_registry_file() -> Option<PathBuf> {
    Some(
        UserDirs::new()?
            .home_dir()
            .join(".pact")
            .join("mcp")
            .join("servers.json"),
    )
}

fn base_url_from_json_file(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|document| extract_discovery_base_url(&document))
}

fn extract_discovery_base_url(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    for key in ["httpUrl", "mcpUrl", "url", "baseUrl", "endpoint"] {
        if let Some(url) = object
            .get(key)
            .and_then(Value::as_str)
            .and_then(normalize_url_value)
        {
            return Some(url);
        }
    }
    if let Some(servers) = object.get("servers") {
        if let Some(active) = object
            .get("activeServer")
            .or_else(|| object.get("active"))
            .or_else(|| object.get("defaultServer"))
            .and_then(Value::as_str)
        {
            if let Some(server) = servers.get(active) {
                if let Some(url) = extract_discovery_base_url(server) {
                    return Some(url);
                }
            }
        }
        if let Some(url) = extract_first_collection_base_url(servers) {
            return Some(url);
        }
    }
    for key in ["server", "service", "discovery", "mcp"] {
        if let Some(url) = object.get(key).and_then(extract_discovery_base_url) {
            return Some(url);
        }
    }
    for key in ["candidates", "items"] {
        if let Some(url) = object.get(key).and_then(extract_first_collection_base_url) {
            return Some(url);
        }
    }
    None
}

fn extract_first_collection_base_url(value: &Value) -> Option<String> {
    if let Some(items) = value.as_array() {
        return items.iter().find_map(extract_discovery_base_url);
    }
    value
        .as_object()
        .and_then(|items| items.values().find_map(extract_discovery_base_url))
}

fn normalize_url_value(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn snapshot_id_from_params(params: &Value) -> Result<String> {
    params
        .get("snapshotId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Missing --snapshot-id or --snapshot-path"))
}

fn client_state_store(params: &Value) -> Result<ClientStateStore> {
    if let Some(root) = params
        .get("stateRoot")
        .or_else(|| params.get("clientStateRoot"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return ClientStateStore::new(PathBuf::from(root));
    }
    if let Some(portable_dir) = params
        .get("portableDir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return ClientStateStore::new(PathBuf::from(portable_dir).join("future-client"));
    }
    ClientStateStore::portable()
}

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{}", now.as_secs(), now.subsec_nanos())
}

fn atomic_write(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|item| item.to_str())
            .unwrap_or("pact")
    ));
    {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
    }
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            if path.exists() {
                fs::remove_file(path)?;
                fs::rename(&tmp, path)?;
                Ok(())
            } else {
                Err(error.into())
            }
        }
    }
}

fn hash_text(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
fn snapshot_stamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{}", now.as_secs(), now.subsec_nanos())
}

fn default_config_path(target: &str) -> Option<PathBuf> {
    let home = UserDirs::new()?.home_dir().to_path_buf();
    match target {
        "codex" => Some(home.join(".codex").join("config.toml")),
        "opencode" => Some(home.join(".config").join("opencode").join("opencode.jsonc")),
        "antigravity" => Some(
            home.join(".gemini")
                .join("antigravity")
                .join("mcp_config.json"),
        ),
        "cursor" => {
            #[cfg(target_os = "macos")]
            {
                Some(home.join("Library/Application Support/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"))
            }
            #[cfg(target_os = "windows")]
            {
                Some(directories::BaseDirs::new()?.data_dir().join("Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"))
            }
            #[cfg(target_os = "linux")]
            {
                Some(home.join(".config/Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json"))
            }
        }
        "windsurf" => Some(
            home.join(".codeium")
                .join("windsurf")
                .join("mcp_config.json"),
        ),
        "gemini-cli" => Some(home.join(".gemini").join("settings.json")),
        "kilo-code" => Some(home.join(".config").join("kilo").join("kilo.json")),
        "openclaw" => None,
        "claude-code" => None,
        "copilot" => None,
        "hermes" => None,
        _ => None,
    }
}

fn config_has_pact(path: &Path) -> bool {
    let Ok(content) = std::fs::read_to_string(path) else {
        return false;
    };
    content.contains("\"pact\"")
        || content.contains("[mcp_servers.pact]")
        || content.contains("pact-mcp")
}

fn find_binary(names: &[&str]) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
            #[cfg(target_os = "windows")]
            {
                let candidate = dir.join(format!("{}.exe", name));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn display_path(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_includes_required_first_targets() {
        let scan = scan_targets().unwrap();
        let ids = scan["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["target"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec![
                "openclaw",
                "claude-code",
                "codex",
                "gemini-cli",
                "antigravity",
                "opencode",
                "copilot",
                "kilo-code",
                "cursor",
                "windsurf",
                "hermes"
            ]
        );
    }

    #[test]
    fn targets_add_persists_manual_entry_and_scan_uses_it() {
        let dir = temp_test_dir("manual-target");
        let state_root = dir.join("future-client");
        let config_path = dir.join("openclaw-mcp.json");

        let added = add_target(&json!({
            "target": "openclaw",
            "stateRoot": display_path(state_root.clone()),
            "configPath": display_path(config_path.clone()),
            "label": "OpenClaw VM"
        }))
        .unwrap();

        assert_eq!(added["ok"], true);
        assert_eq!(added["record"]["target"], "openclaw");
        assert_eq!(added["activity"]["type"], "target.manual.saved");

        let store = crate::client_state::ClientStateStore::new(state_root.clone()).unwrap();
        let saved = store.read_collection("targets").unwrap();
        assert_eq!(saved["items"][0]["target"], "openclaw");
        assert_eq!(saved["items"][0]["manual"], true);

        let scan = scan_targets_with_params(&json!({
            "stateRoot": display_path(state_root.clone())
        }))
        .unwrap();
        let openclaw = scan["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["target"] == "openclaw")
            .unwrap();
        assert_eq!(openclaw["manual"], true);
        assert_eq!(openclaw["label"], "OpenClaw VM");
        assert_eq!(openclaw["status"], "manual");
        assert_eq!(openclaw["configPath"], display_path(config_path.clone()));

        let inspected = inspect_target_with_params(&json!({
            "target": "openclaw",
            "stateRoot": display_path(state_root.clone())
        }))
        .unwrap();
        assert_eq!(inspected["target"]["manual"], true);
        assert_eq!(
            inspected["target"]["configPath"],
            display_path(config_path.clone())
        );

        let plan = mcp_config_plan(&json!({
            "target": "openclaw",
            "stateRoot": display_path(state_root)
        }))
        .unwrap();
        assert_eq!(plan["plan"]["configPath"], display_path(config_path));
    }

    #[test]
    fn opencode_plan_exposes_real_remote_mcp_shape() {
        let plan = mcp_config_plan(&json!({"target": "opencode"})).unwrap();
        let fields = plan["plan"]["fields"].as_array().unwrap();
        let paths = fields
            .iter()
            .map(|item| item["path"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"mcp.pact.url"));
        assert!(paths.contains(&"mcp.pact.headers.X-Pact-Api-Key"));
        assert!(paths.contains(&"mcp.pact.enabled"));
    }

    #[test]
    fn mcp_config_plan_uses_discovery_file_endpoint_before_default() {
        let dir = temp_test_dir("discovery-file");
        let discovery_file = dir.join("mcp-discovery.json");
        fs::write(
            &discovery_file,
            r#"{"httpUrl":"http://pact-device.local:7228/mcp"}"#,
        )
        .unwrap();

        let plan = mcp_config_plan(&json!({
            "target": "opencode",
            "discoveryFile": display_path(discovery_file)
        }))
        .unwrap();
        let fields = plan["plan"]["fields"].as_array().unwrap();
        let url = fields
            .iter()
            .find(|item| item["path"] == "mcp.pact.url")
            .and_then(|item| item["value"].as_str())
            .unwrap();
        assert_eq!(url, "http://pact-device.local:7228/mcp");
    }

    #[test]
    fn mcp_config_plan_uses_active_registry_server_endpoint() {
        let dir = temp_test_dir("registry-file");
        let registry_file = dir.join("servers.json");
        fs::write(
            &registry_file,
            r#"{
  "activeServer": "vm",
  "servers": {
    "local": { "httpUrl": "http://127.0.0.1:7228/mcp" },
    "vm": { "httpUrl": "http://orbstack-host.local:7228/mcp" }
  }
}"#,
        )
        .unwrap();

        let plan = mcp_config_plan(&json!({
            "target": "gemini-cli",
            "registryFile": display_path(registry_file)
        }))
        .unwrap();
        let fields = plan["plan"]["fields"].as_array().unwrap();
        let url = fields
            .iter()
            .find(|item| item["path"] == "mcpServers.pact.url")
            .and_then(|item| item["value"].as_str())
            .unwrap();
        assert_eq!(url, "http://orbstack-host.local:7228/mcp");
    }

    #[test]
    fn config_write_opencode_apply_uses_snapshot_and_preserves_unrelated_config() {
        let dir = temp_test_dir("opencode-apply");
        let config_path = dir.join("opencode.jsonc");
        let state_root = dir.join("future-client");
        fs::write(
            &config_path,
            r#"{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "other": {
      "type": "remote",
      "url": "https://example.test/mcp",
      "enabled": true
    }
  }
}"#,
        )
        .unwrap();

        let result = mcp_config_apply(&json!({
            "target": "opencode",
            "configPath": display_path(config_path.clone()),
            "stateRoot": display_path(state_root.clone()),
            "baseUrl": "http://127.0.0.1:7228",
            "token": "test-token"
        }))
        .unwrap();

        assert_eq!(result["ok"], true);
        assert_eq!(result["status"], "applied");
        let updated: Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(updated["$schema"], "https://opencode.ai/config.json");
        assert_eq!(updated["mcp"]["other"]["url"], "https://example.test/mcp");
        assert_eq!(updated["mcp"]["pact"]["type"], "remote");
        assert_eq!(updated["mcp"]["pact"]["url"], "http://127.0.0.1:7228/mcp");
        assert_eq!(
            updated["mcp"]["pact"]["headers"]["X-Pact-Api-Key"],
            "test-token"
        );
        assert_eq!(updated["mcp"]["pact"]["enabled"], true);
        let snapshot_path = PathBuf::from(result["snapshotPath"].as_str().unwrap());
        assert!(snapshot_path.exists());
        assert!(snapshot_path.starts_with(state_root.join("snapshots")));
        assert!(!dir.join(".pact-snapshots").exists());
        assert_eq!(result["activity"]["type"], "mcp.config.applied");
        let store = crate::client_state::ClientStateStore::new(state_root).unwrap();
        let activity = store
            .activity_log()
            .list(&json!({"type": "mcp.config.applied", "target": "opencode"}))
            .unwrap();
        assert_eq!(activity["events"].as_array().unwrap().len(), 1);
        let snapshots = store
            .snapshot_store()
            .list(&json!({"target": "opencode"}))
            .unwrap();
        assert_eq!(snapshots["snapshots"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn config_write_rollback_restores_snapshot_content() {
        let dir = temp_test_dir("opencode-rollback");
        let config_path = dir.join("opencode.jsonc");
        let state_root = dir.join("future-client");
        let original = r#"{"mcp":{"other":{"enabled":true}}}"#;
        fs::write(&config_path, original).unwrap();
        let apply = mcp_config_apply(&json!({
            "target": "opencode",
            "configPath": display_path(config_path.clone()),
            "stateRoot": display_path(state_root.clone()),
            "baseUrl": "http://localhost:7228",
            "token": "rollback-token"
        }))
        .unwrap();
        assert_ne!(fs::read_to_string(&config_path).unwrap(), original);

        let rollback = mcp_config_rollback(&json!({
            "target": "opencode",
            "configPath": display_path(config_path.clone()),
            "stateRoot": display_path(state_root.clone()),
            "snapshotId": apply["snapshotId"].as_str().unwrap()
        }))
        .unwrap();

        assert_eq!(rollback["ok"], true);
        assert_eq!(rollback["restoredSnapshotId"], apply["snapshotId"]);
        assert_eq!(rollback["activity"]["type"], "mcp.config.rolled_back");
        assert_eq!(fs::read_to_string(&config_path).unwrap(), original);
    }

    #[test]
    fn config_write_expected_hash_prevents_stale_overwrite() {
        let dir = temp_test_dir("opencode-conflict");
        let config_path = dir.join("opencode.jsonc");
        fs::write(&config_path, r#"{"mcp":{}}"#).unwrap();

        let result = mcp_config_apply(&json!({
            "target": "opencode",
            "configPath": display_path(config_path.clone()),
            "expectedHash": "stale",
            "token": "blocked"
        }))
        .unwrap();

        assert_eq!(result["ok"], false);
        assert_eq!(result["status"], "field_conflict");
        assert_eq!(fs::read_to_string(&config_path).unwrap(), r#"{"mcp":{}}"#);
    }

    #[test]
    fn targets_public_inspect_entrypoint_uses_default_scan_path() {
        let inspected = inspect_target("opencode").unwrap();
        assert_eq!(inspected["target"]["target"], "opencode");
    }

    #[test]
    fn targets_target_params_and_aliases_are_normalized() {
        assert_eq!(
            target_param(&json!({"positionals": ["open_code"]})).unwrap(),
            "opencode"
        );
        assert_eq!(normalize_target("claude"), "claude-code");
        assert_eq!(normalize_target("kilo-code"), "kilo-code");
    }

    #[test]
    fn targets_add_updates_existing_manual_entry_created_at() {
        let dir = temp_test_dir("manual-update");
        let state_root = dir.join("future-client");
        let first = add_target(&json!({
            "target": "opencode",
            "stateRoot": display_path(state_root.clone()),
            "label": "First"
        }))
        .unwrap();
        let second = add_target(&json!({
            "target": "opencode",
            "stateRoot": display_path(state_root),
            "label": "Second"
        }))
        .unwrap();
        assert_eq!(first["record"]["createdAt"], second["record"]["createdAt"]);
        assert_eq!(second["record"]["label"], "Second");
    }

    #[test]
    fn targets_config_apply_raises_missing_path_for_target_without_default_path() {
        let err = mcp_config_apply(&json!({"target": "openclaw"})).unwrap_err();
        assert!(err.to_string().contains("requires --config-path"));
    }

    #[test]
    fn targets_rollback_from_snapshot_path_without_snapshot_store() {
        let dir = temp_test_dir("rollback-path");
        let state_root = dir.join("future-client");
        let config_path = dir.join("opencode.jsonc");
        fs::write(&config_path, r#"{"existing":true}"#).unwrap();
        let snapshot_path = dir.join("snapshot.json");
        let snapshot = json!({
            "schemaVersion": 1,
            "snapshotId": "manual-snapshot",
            "sourcePath": display_path(config_path.clone()),
            "existed": true,
            "content": r#"{"rollback":"snapshot"}"#
        });
        fs::write(
            &snapshot_path,
            serde_json::to_string_pretty(&snapshot).unwrap(),
        )
        .unwrap();

        let result = mcp_config_rollback(&json!({
            "target": "opencode",
            "stateRoot": display_path(state_root),
            "snapshotPath": display_path(snapshot_path)
        }))
        .unwrap();
        assert_eq!(result["status"], "rolled_back");
        assert_eq!(result["restoredSnapshotId"], "manual-snapshot");
        assert_eq!(
            fs::read_to_string(&config_path).unwrap(),
            r#"{"rollback":"snapshot"}"#
        );
    }

    #[test]
    fn targets_rollback_snapshot_path_removes_config_when_snapshot_marked_missing() {
        let dir = temp_test_dir("rollback-missing");
        let state_root = dir.join("future-client");
        let config_path = dir.join("opencode.jsonc");
        fs::write(&config_path, r#"{"before":true}"#).unwrap();
        let snapshot_path = dir.join("snapshot-missing.json");
        let snapshot = json!({
            "schemaVersion": 1,
            "snapshotId": "manual-snapshot",
            "sourcePath": display_path(config_path.clone()),
            "existed": false,
            "content": r#"{"new":"snapshot"}"#
        });
        fs::write(
            &snapshot_path,
            serde_json::to_string_pretty(&snapshot).unwrap(),
        )
        .unwrap();

        let result = mcp_config_rollback(&json!({
            "target": "opencode",
            "stateRoot": display_path(state_root),
            "snapshotPath": display_path(snapshot_path)
        }))
        .unwrap();
        assert_eq!(result["status"], "rolled_back");
        assert!(!config_path.exists());
    }

    #[test]
    fn targets_scan_candidate_discovery_variants_are_supported() {
        assert_eq!(
            extract_discovery_base_url(&json!({"discovery": {"httpUrl": "http://discovery:7228"}}))
                .unwrap(),
            "http://discovery:7228"
        );
        assert_eq!(
            extract_discovery_base_url(
                &json!({"candidates": [{"httpUrl": "http://candidate:7228/mcp"}]})
            )
            .unwrap(),
            "http://candidate:7228/mcp"
        );
    }

    #[test]
    fn targets_target_path_and_patch_helpers_cover_error_paths() {
        let root = json!({"mcp": 1});
        let mut root_map = root.as_object().cloned().unwrap_or_default();
        set_json_path(&mut root_map, "mcp.enabled", json!(true)).unwrap();
        assert_eq!(root_map["mcp"]["enabled"], true);

        let mut empty = json!({});
        let mut empty_map = empty.as_object_mut().unwrap();
        assert!(set_json_path(&mut empty_map, "", json!(1)).is_err());
    }

    #[test]
    fn targets_strip_json_comments_handles_line_and_block_forms() {
        let stripped = strip_json_comments(
            r#"{"mcp":{"x":1}} // line
            /* block */
            {"mcp":{"y":2}}"#,
        );
        let compact = stripped.replace('\n', "");
        assert!(compact.contains(r#"{"mcp":{"x":1}}"#));
        assert!(compact.contains(r#"{"mcp":{"y":2}}"#));
        assert!(!compact.to_lowercase().contains("line"));
        assert!(!compact.to_lowercase().contains("block"));
    }

    #[test]
    fn targets_apply_helpers_hit_error_and_normalized_input_paths() {
        let current = r#"{ "mcp": {"enabled": true}, /* comment */ "other": 1 }"#;
        let updated =
            apply_json_patch("opencode", current, "http://127.0.0.1:7228", "token").unwrap();
        assert!(updated.contains("\"mcp\""));
        assert!(updated.contains("\"url\""));
        assert!(updated.contains("127.0.0.1:7228/mcp"));

        let codex_patch = apply_codex_patch("", "http://127.0.0.1:7228").unwrap();
        assert!(codex_patch.contains("PACT_MCP_TOKEN"));

        let unknown = apply_structured_patch("unknown", "", "http://127.0.0.1:7228", "token");
        assert!(unknown.is_err());

        assert!(apply_json_patch("opencode", "[", "http://127.0.0.1:7228", "token").is_err());
    }

    #[test]
    fn targets_token_ref_comes_from_env_when_not_set() {
        let token = token_ref_with_env(
            &json!({"target": "opencode"}),
            Some("token-from-env".to_string()),
        );
        assert_eq!(token, "token-from-env");
    }

    #[test]
    fn targets_base_url_uses_env_when_not_in_params() {
        let base_url = normalize_base_url_with_env(
            &json!({"target": "opencode"}),
            Some("http://env-mcp:7228".to_string()),
        );
        assert_eq!(base_url, "http://env-mcp:7228");
    }

    #[test]
    fn targets_target_field_and_patch_variants_are_covered() {
        let codex = target_fields("codex")
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(codex.contains(&"mcp_servers.pact.url".to_string()));
        assert!(codex.contains(&"mcp_servers.pact.bearer_token_env_var".to_string()));

        let antigravity = target_fields("antigravity")
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(antigravity.contains(&"mcpServers.pact.serverUrl".to_string()));

        let kilo = target_fields("kilo-code")
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(kilo.contains(&"mcp.pact.type".to_string()));

        let gemini = target_fields("gemini-cli")
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(gemini.contains(&"mcpServers.pact.transport".to_string()));

        let hermes = target_fields("hermes")
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(
            hermes
                .iter()
                .any(|item| item.starts_with("hermes.mcp.pact"))
        );

        let cursor = target_fields("cursor")
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["path"].as_str().unwrap_or_default().to_string())
            .collect::<Vec<_>>();
        assert!(
            cursor
                .iter()
                .any(|item| item.contains("mcpServers.pact.command"))
        );
        assert!(cursor.contains(&"mcpServers.pact.args".to_string()));

        assert!(target_fields("mystery").as_array().unwrap().is_empty());
    }

    #[test]
    fn targets_target_apply_helpers_cover_empty_and_structured_variants() {
        let empty_json =
            apply_json_patch("opencode", "", "http://127.0.0.1:7228", "token").unwrap();
        assert!(empty_json.contains("\"mcp\""));

        let codex = apply_codex_patch("", "http://127.0.0.1:7228").unwrap();
        assert!(codex.contains("PACT_MCP_TOKEN"));

        let antigravity =
            apply_json_patch("antigravity", "{}", "http://127.0.0.1:7228", "token").unwrap();
        assert!(antigravity.contains("\"mcpServers\""));
        assert!(antigravity.contains("\"token\""));

        let cursor = json_patch_entries("cursor", "http://127.0.0.1:7228", "token");
        assert_eq!(cursor.len(), 2);
        assert!(
            cursor
                .iter()
                .any(|(path, _)| path == "mcpServers.pact.command")
        );
        assert!(
            cursor
                .iter()
                .any(|(path, _)| path == "mcpServers.pact.args")
        );

        let opencode_patch = json_patch_entries("opencode", "http://127.0.0.1:7228", "token");
        assert_eq!(opencode_patch.len(), 4);
        assert!(
            opencode_patch
                .iter()
                .any(|(path, value)| path == "mcp.pact.url"
                    && value == &json!("http://127.0.0.1:7228/mcp"))
        );

        let unknown = json_patch_entries("unknown", "http://127.0.0.1:7228", "token");
        assert!(unknown.is_empty());
    }

    #[test]
    fn targets_manual_target_filter_skips_invalid_items() {
        let store = test_store("manual-targets-invalid");
        let items = json!({
            "collection": "targets",
            "items": [
                {"target": "", "label": "bad-target"},
                {"target": "non-existent", "label": "missing"},
                {"target": "opencode", "label": "OpenCode"}
            ]
        });
        store.write_collection("targets", items).unwrap();

        let items = manual_targets(&store).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].target, "opencode");
    }

    #[test]
    fn targets_discovery_url_extracts_from_nested_server_variants() {
        assert_eq!(
            extract_discovery_base_url(&json!({"servers":{"active":{"url":"http://active.local:7228/mcp"}, "other":{"url":"http://other.local:7228/mcp"}}, "activeServer":"active"})).unwrap(),
            "http://active.local:7228/mcp"
        );
        assert_eq!(
            extract_discovery_base_url(
                &json!({"server":{"endpoint":"https://example.service:7228/mcp"}})
            )
            .unwrap(),
            "https://example.service:7228/mcp"
        );
        assert_eq!(
            extract_discovery_base_url(
                &json!({"candidates":{"local":{"endpoint":"http://candidate.local:7228/mcp"}}})
            )
            .unwrap(),
            "http://candidate.local:7228/mcp"
        );
        assert!(extract_discovery_base_url(&json!({"server":{"bad":false}})).is_none());
        assert!(normalize_url_value("   ").is_none());
    }

    #[test]
    fn targets_uses_portable_dir_state_root_and_default_config_path_fallback() {
        let dir = temp_test_dir("portable-state-root");
        let portable_root = dir.join("portable");
        fs::create_dir_all(&portable_root).unwrap();
        let state_root = portable_root.join("future-client");
        let _ = state_root;

        let plan = mcp_config_plan(&json!({
            "target": "opencode",
            "baseUrl": "http://127.0.0.1:7228",
            "portableDir": portable_root.to_string_lossy()
        }))
        .unwrap();
        assert_eq!(plan["status"], "planned");

        assert!(default_config_path("openclaw").is_none());
    }

    #[test]
    fn targets_rollback_by_snapshot_id_reuses_snapshot_store() {
        let dir = temp_test_dir("rollback-snapshot-id");
        let config_path = dir.join("opencode.jsonc");
        fs::write(&config_path, "{}").unwrap();
        let state_root = dir.join("future-client");

        let applied = mcp_config_apply(&json!({
            "target": "opencode",
            "configPath": display_path(config_path.clone()),
            "stateRoot": display_path(state_root.clone()),
            "baseUrl": "http://127.0.0.1:7228",
            "token": "snapshot-id-token",
        }))
        .unwrap();

        let rollback = mcp_config_rollback(&json!({
            "target": "opencode",
            "stateRoot": display_path(state_root),
            "snapshotId": applied["snapshotId"].as_str().unwrap()
        }))
        .unwrap();
        assert_eq!(rollback["status"], "rolled_back");
        assert_eq!(rollback["target"], "opencode");
    }

    fn test_store(name: &str) -> crate::client_state::ClientStateStore {
        let dir = temp_test_dir(&format!("target-test-store-{}", name));
        crate::client_state::ClientStateStore::new(dir).unwrap()
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("pact-targets-{}-{}", name, snapshot_stamp()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
