use crate::targets;
use anyhow::{Result, anyhow};
use serde_json::{Value, json};

const PACT_PLUGIN_ID: &str = "pact-mcp";

pub fn plugin_status(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    let inspected = targets::inspect_target_with_params(params)?;
    let target_info = inspected
        .get("target")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let configured = target_info
        .get("configured")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(json!({
        "ok": true,
        "pluginId": PACT_PLUGIN_ID,
        "pluginRole": "peer",
        "privilegedHost": false,
        "target": target,
        "status": if configured { "configured" } else { "not-configured" },
        "targetNative": {
            "configured": configured,
            "configPath": target_info.get("configPath").cloned().unwrap_or_else(|| json!(null)),
            "fields": inspected.get("fields").cloned().unwrap_or_else(|| json!([])),
            "writePolicy": inspected.get("writePolicy").cloned().unwrap_or_else(|| json!({}))
        },
        "actions": ["status", "update", "rollback"]
    }))
}

pub fn plugin_update(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    if bool_param(params, "dryRun").unwrap_or(false) || bool_param(params, "plan").unwrap_or(false)
    {
        let plan = targets::mcp_config_plan(params)?;
        return Ok(json!({
            "ok": true,
            "pluginId": PACT_PLUGIN_ID,
            "pluginRole": "peer",
            "target": target,
            "status": "planned",
            "plan": plan
        }));
    }
    let applied = targets::mcp_config_apply(params)?;
    Ok(json!({
        "ok": applied.get("ok").and_then(Value::as_bool).unwrap_or(false),
        "pluginId": PACT_PLUGIN_ID,
        "pluginRole": "peer",
        "target": target,
        "status": "updated",
        "apply": applied
    }))
}

pub fn plugin_rollback(params: &Value) -> Result<Value> {
    let target = target_param(params)?;
    let rollback = targets::mcp_config_rollback(params)?;
    Ok(json!({
        "ok": rollback.get("ok").and_then(Value::as_bool).unwrap_or(false),
        "pluginId": PACT_PLUGIN_ID,
        "pluginRole": "peer",
        "target": target,
        "status": "rolled_back",
        "rollback": rollback
    }))
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
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("MCP plugin command requires --target <target>"))
}

fn bool_param(params: &Value, key: &str) -> Option<bool> {
    params.get(key).and_then(|value| {
        value.as_bool().or_else(|| {
            value.as_str().map(|raw| {
                matches!(
                    raw.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn mcp_plugins_status_reports_pact_mcp_as_peer_plugin() {
        let status = plugin_status(&json!({"target": "opencode"})).unwrap();
        assert_eq!(status["ok"], true);
        assert_eq!(status["pluginId"], PACT_PLUGIN_ID);
        assert_eq!(status["pluginRole"], "peer");
        assert_eq!(status["privilegedHost"], false);
        assert!(
            status["targetNative"]["fields"]
                .as_array()
                .unwrap()
                .iter()
                .any(|field| field["path"] == "mcp.pact.url")
        );
    }

    #[test]
    fn mcp_plugins_opencode_update_writes_remote_connector_shape() {
        let dir = temp_test_dir("opencode-update");
        let config_path = dir.join("opencode.jsonc");
        let state_root = dir.join("future-client");
        fs::write(&config_path, r#"{"mcp":{"other":{"enabled":true}}}"#).unwrap();

        let update = plugin_update(&json!({
            "target": "opencode",
            "configPath": config_path.to_string_lossy(),
            "stateRoot": state_root.to_string_lossy(),
            "baseUrl": "http://127.0.0.1:7228",
            "token": "peer-token"
        }))
        .unwrap();

        assert_eq!(update["ok"], true);
        assert_eq!(update["pluginRole"], "peer");
        let updated: Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(updated["mcp"]["pact"]["type"], "remote");
        assert_eq!(updated["mcp"]["pact"]["url"], "http://127.0.0.1:7228/mcp");
        assert_eq!(
            updated["mcp"]["pact"]["headers"]["X-Pact-Api-Key"],
            "peer-token"
        );
        assert_eq!(updated["mcp"]["pact"]["enabled"], true);
    }

    #[test]
    fn mcp_plugins_rollback_restores_target_native_config() {
        let dir = temp_test_dir("opencode-rollback");
        let config_path = dir.join("opencode.jsonc");
        let state_root = dir.join("future-client");
        let original = r#"{"mcp":{"other":{"enabled":true}}}"#;
        fs::write(&config_path, original).unwrap();

        let update = plugin_update(&json!({
            "target": "opencode",
            "configPath": config_path.to_string_lossy(),
            "stateRoot": state_root.to_string_lossy(),
            "token": "rollback-token"
        }))
        .unwrap();
        let snapshot_id = update["apply"]["snapshotId"].as_str().unwrap();
        assert_ne!(fs::read_to_string(&config_path).unwrap(), original);

        let rollback = plugin_rollback(&json!({
            "target": "opencode",
            "configPath": config_path.to_string_lossy(),
            "stateRoot": state_root.to_string_lossy(),
            "snapshotId": snapshot_id
        }))
        .unwrap();

        assert_eq!(rollback["ok"], true);
        assert_eq!(fs::read_to_string(&config_path).unwrap(), original);
    }

    #[test]
    fn mcp_plugins_target_positionals_and_dry_run_supports_config_plan() {
        let result = plugin_update(&json!({
            "positionals": ["opencode", "plan"],
            "dryRun": true,
            "stateRoot": temp_test_dir("positionals").join("future-client").to_string_lossy(),
        }))
        .unwrap();
        assert_eq!(result["status"], "planned");
        assert_eq!(result["plan"]["status"], "planned");
    }

    #[test]
    fn mcp_plugins_respects_plan_string_toggle() {
        let result = plugin_update(&json!({
            "target": "opencode",
            "plan": "on",
            "stateRoot": temp_test_dir("plan-string").join("future-client").to_string_lossy(),
        }))
        .unwrap();
        assert_eq!(result["status"], "planned");
        assert_eq!(result["plan"]["plan"]["operation"], "mcp.config.apply");
    }

    #[test]
    fn mcp_plugins_status_accepts_positionals_target() {
        let status = plugin_status(&json!({
            "positionals": ["opencode"]
        }))
        .unwrap();
        assert!(status["status"] == "configured" || status["status"] == "not-configured");
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let dir = env::temp_dir().join(format!(
            "pact-mcp-plugin-{}-{}-{}",
            name,
            now.as_secs(),
            now.subsec_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
