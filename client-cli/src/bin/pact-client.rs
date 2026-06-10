use anyhow::Result;
use serde_json::{Value, json};
use std::env;

#[derive(Debug, PartialEq, Clone)]
enum CliExecution {
    Usage,
    Json(Value),
}

fn main() -> Result<()> {
    env_logger::init();
    match execute_cli(env::args().skip(1).collect::<Vec<_>>())? {
        CliExecution::Usage => print_usage(),
        CliExecution::Json(value) => print_json(&value),
    }
    Ok(())
}

fn execute_cli(args: Vec<String>) -> Result<CliExecution> {
    if args.is_empty()
        || matches!(
            args.first().map(String::as_str),
            Some("--help" | "-h" | "help")
        )
    {
        return Ok(CliExecution::Usage);
    }

    match args.as_slice() {
        [scope, action, subaction]
            if scope == "model" && action == "profiles" && subaction == "list" =>
        {
            Ok(CliExecution::Json(
                pact_client_native::forwarding::list_model_profiles()?,
            ))
        }
        [scope, action, subaction, rest @ ..]
            if scope == "model" && action == "profiles" && subaction == "set" =>
        {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::forwarding::save_model_profile(&params)?,
            ))
        }
        [scope, rest @ ..] if scope == "forward" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(pact_client_native::forwarding::forward(
                &params,
            )?))
        }
        [scope, action, collection] if scope == "state" && action == "get" => Ok(
            CliExecution::Json(pact_client_native::client_state::state_get(collection)?),
        ),
        [scope, action, collection, payload] if scope == "state" && action == "set" => {
            Ok(CliExecution::Json(
                pact_client_native::client_state::state_set(collection, parse_json_arg(payload))?,
            ))
        }
        [scope, action, rest @ ..] if scope == "activity" && action == "list" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::client_state::activity_list(&params)?,
            ))
        }
        [scope, action, rest @ ..] if scope == "snapshots" && action == "list" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::client_state::snapshots_list(&params)?,
            ))
        }
        [scope, action, snapshot_id] if scope == "snapshots" && action == "restore" => {
            Ok(CliExecution::Json(
                pact_client_native::client_state::snapshots_restore(snapshot_id)?,
            ))
        }
        [scope, area, action, rest @ ..]
            if scope == "agents"
                && area == "pair"
                && matches!(action.as_str(), "request" | "approve" | "revoke" | "list") =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "request" => pact_client_native::skill_hub::pair_request(&params)?,
                "approve" => pact_client_native::skill_hub::pair_approve(&params)?,
                "revoke" => pact_client_native::skill_hub::pair_revoke(&params)?,
                "list" => pact_client_native::skill_hub::pair_list(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, action, rest @ ..] if scope == "skill" && action == "list" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::skill_hub::skill_list(&params)?,
            ))
        }
        [scope, action, rest @ ..] if scope == "skill" && action == "get" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::skill_hub::skill_get(&params)?,
            ))
        }
        [scope, area, action, rest @ ..]
            if scope == "skill" && area == "visibility" && action == "set" =>
        {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::skill_hub::skill_visibility(&params)?,
            ))
        }
        [scope, area, action, rest @ ..]
            if scope == "skill" && area == "pin" && action == "set" =>
        {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::skill_hub::skill_pin(&params)?,
            ))
        }
        [scope, action, rest @ ..] if scope == "targets" && action == "scan" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::targets::scan_targets_with_params(&params)?,
            ))
        }
        [scope, action, rest @ ..] if scope == "targets" && action == "add" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(pact_client_native::targets::add_target(
                &params,
            )?))
        }
        [scope, action, target, rest @ ..] if scope == "targets" && action == "inspect" => {
            let mut params = cli_params(rest);
            if let Some(object) = params.as_object_mut() {
                object.insert("target".to_string(), json!(target));
            }
            Ok(CliExecution::Json(
                pact_client_native::targets::inspect_target_with_params(&params)?,
            ))
        }
        [scope, area, action, rest @ ..]
            if scope == "mcp"
                && area == "plugin"
                && matches!(action.as_str(), "status" | "update" | "rollback") =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "status" => pact_client_native::mcp_plugins::plugin_status(&params)?,
                "update" => pact_client_native::mcp_plugins::plugin_update(&params)?,
                "rollback" => pact_client_native::mcp_plugins::plugin_rollback(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, area, action, rest @ ..]
            if scope == "mcp"
                && area == "config"
                && matches!(action.as_str(), "plan" | "apply" | "rollback") =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "plan" => pact_client_native::targets::mcp_config_plan(&params)?,
                "apply" => pact_client_native::targets::mcp_config_apply(&params)?,
                "rollback" => pact_client_native::targets::mcp_config_rollback(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
        }
        _ => Ok(CliExecution::Usage),
    }
}

fn print_json(value: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string())
    );
}

fn parse_json_arg(value: &str) -> Value {
    serde_json::from_str(value).unwrap_or_else(|_| json!({}))
}

fn cli_params(args: &[String]) -> Value {
    let mut params = serde_json::Map::new();
    let mut positionals = Vec::<Value>::new();
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if let Some(raw_key) = arg.strip_prefix("--") {
            let key = cli_param_key(raw_key);
            if let Some(value) = args.get(index + 1).filter(|value| !value.starts_with("--")) {
                params.insert(key, json!(value));
                index += 2;
            } else {
                params.insert(key, json!(true));
                index += 1;
            }
            continue;
        }
        positionals.push(json!(arg));
        index += 1;
    }
    if !positionals.is_empty() {
        if !params.contains_key("target") {
            if let Some(target) = positionals.first().and_then(Value::as_str) {
                params.insert("target".to_string(), json!(target));
            }
        }
        params.insert("positionals".to_string(), Value::Array(positionals));
    }
    Value::Object(params)
}

fn cli_param_key(raw: &str) -> String {
    let mut out = String::new();
    let mut uppercase_next = false;
    for ch in raw.chars() {
        if ch == '-' || ch == '_' {
            uppercase_next = true;
            continue;
        }
        if uppercase_next {
            out.extend(ch.to_uppercase());
            uppercase_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}

fn print_usage() {
    eprintln!(
        "Usage:
  pact-client model profiles list
  pact-client model profiles set <profile-id> [--command CMD|--url URL] [--args JSON] [--api-key KEY]
  pact-client forward --profile <profile-id> --text <input>
  pact-client state get|set <settings|targets|pairings|skills|pins> [json]
  pact-client activity list [--type TYPE] [--target TARGET] [--limit N]
  pact-client snapshots list [--target TARGET]
  pact-client snapshots restore <snapshot-id>
  pact-client agents pair request|approve|revoke|list --agent AGENT [--target TARGET]
  pact-client skill list --agent AGENT
  pact-client skill get <skill-id> --agent AGENT --json
  pact-client skill visibility set <skill-id> --agent AGENT --hidden true|false
  pact-client skill pin set <skill-id> --agent AGENT --version VERSION
  pact-client targets scan [--state-root PATH]
  pact-client targets add --target <target> [--config-path PATH] [--binary-path PATH] [--state-root PATH]
  pact-client targets inspect <target> [--state-root PATH]
  pact-client mcp plugin status|update|rollback --target <target> [--config-path PATH] [--discovery-file PATH] [--registry-file PATH] [--state-root PATH]
  pact-client mcp config plan --target <target> [--config-path PATH] [--base-url URL|--discovery-file PATH|--registry-file PATH] [--state-root PATH]
  pact-client mcp config apply --target <target> [--config-path PATH] [--base-url URL|--discovery-file PATH|--registry-file PATH] [--token TOKEN] [--state-root PATH]
  pact-client mcp config rollback --target <target> [--snapshot-id ID] [--state-root PATH]"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;
    use std::env;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn signed_receipt_discovery(endpoint: &str, path: &Path) {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let secret_bytes = bytes;
        let mcp_url = format!("{}/mcp", endpoint.trim_end_matches('/'));
        let (receipt, public_key) = pact_client_native::mcp_trust::test_signed_receipt(
            endpoint,
            &mcp_url,
            "test-key",
            "2026-06-09T00:00:00Z",
            "2099-01-01T00:00:00Z",
            &secret_bytes,
        );
        let doc = serde_json::json!({
            "url": endpoint,
            "trustReceipt": receipt,
            "pinnedPublicKey": public_key
        });
        fs::write(path, serde_json::to_string_pretty(&doc).unwrap()).unwrap();
    }

    #[test]
    fn cli_dispatches_state_profiles_targets() {
        let dir = temp_cli_dir("dispatch");
        {
            let _guard = cli_env_lock().lock().unwrap();
            let _portable = set_portable_dir(&dir);

            let profile_set = execute_cli(vec![
                "model".into(),
                "profiles".into(),
                "set".into(),
                "--profile".into(),
                "cat".into(),
                "--command".into(),
                "/bin/cat".into(),
                "--label".into(),
                "Cat".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&profile_set)["status"], "saved");

            let profiles =
                execute_cli(vec!["model".into(), "profiles".into(), "list".into()]).unwrap();
            let profiles = json_payload(&&profiles);
            assert_eq!(profiles["ok"], true);
            assert_eq!(profiles["profiles"][0]["id"], "cat");

            let forward = execute_cli(vec![
                "forward".into(),
                "--profile".into(),
                "cat".into(),
                "--text".into(),
                "hello-forward".into(),
            ])
            .unwrap();
            let forward_output = json_payload(&&forward)["output"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            assert!(forward_output.contains("hello-forward"));

            let set_state = execute_cli(vec![
                "state".into(),
                "set".into(),
                "targets".into(),
                r#"{"items": []}"#.into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&set_state)["ok"], true);

            let get_state =
                execute_cli(vec!["state".into(), "get".into(), "targets".into()]).unwrap();
            let got = json_payload(&&get_state);
            assert_eq!(got["collection"], "targets");

            let activities = execute_cli(vec![
                "activity".into(),
                "list".into(),
                "--limit".into(),
                "5".into(),
            ])
            .unwrap();
            assert!(json_payload(&&activities)["ok"].as_bool().unwrap_or(false));

            let list_targets = execute_cli(vec![
                "targets".into(),
                "scan".into(),
                "--state-root".into(),
                dir.join("future-client").display().to_string(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&list_targets)["ok"], true);
            let inspect_target =
                execute_cli(vec!["targets".into(), "inspect".into(), "opencode".into()]).unwrap();
            assert_eq!(
                json_payload(&&inspect_target)["target"]["target"],
                "opencode"
            );

            let added = execute_cli(vec![
                "targets".into(),
                "add".into(),
                "--target".into(),
                "opencode".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&added)["status"], "accepted");
        }
    }

    #[test]
    fn cli_dispatches_mcp_and_skill_paths() {
        let dir = temp_cli_dir("dispatch-mcp");
        {
            let _guard = cli_env_lock().lock().unwrap();
            let _portable = set_portable_dir(&dir);

            let requested = execute_cli(vec![
                "agents".into(),
                "pair".into(),
                "request".into(),
                "--agent".into(),
                "codex".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&requested)["status"], "requested");

            let pair_list = execute_cli(vec![
                "agents".into(),
                "pair".into(),
                "list".into(),
                "--agent".into(),
                "codex".into(),
            ])
            .unwrap();
            assert_eq!(
                json_payload(&&pair_list)["pairings"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );

            let approved = execute_cli(vec![
                "agents".into(),
                "pair".into(),
                "approve".into(),
                "--agent".into(),
                "codex".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&approved)["status"], "approved");

            let skill_list = execute_cli(vec![
                "skill".into(),
                "list".into(),
                "--agent".into(),
                "codex".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&skill_list)["ok"], true);
            assert_eq!(
                json_payload(&&skill_list)["skills"]
                    .as_array()
                    .unwrap()
                    .len(),
                0
            );

            let get_unavailable = execute_cli(vec![
                "skill".into(),
                "get".into(),
                "review".into(),
                "--agent".into(),
                "codex".into(),
            ])
            .unwrap();
            assert_eq!(
                json_payload(&&get_unavailable)["error"],
                "protocol_deferred"
            );

            let visibility = execute_cli(vec![
                "skill".into(),
                "visibility".into(),
                "set".into(),
                "--agent".into(),
                "codex".into(),
                "--skill".into(),
                "review".into(),
                "--visibility".into(),
                "hidden".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&visibility)["hidden"], true);
            assert_eq!(json_payload(&&visibility)["skillId"], "review");

            let pin = execute_cli(vec![
                "skill".into(),
                "pin".into(),
                "set".into(),
                "--agent".into(),
                "codex".into(),
                "--skill".into(),
                "review".into(),
                "--version".into(),
                "1.0.0".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&pin)["version"], "1.0.0");

            let revoked = execute_cli(vec![
                "agents".into(),
                "pair".into(),
                "revoke".into(),
                "--agent".into(),
                "codex".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&revoked)["status"], "revoked");

            let plugin_status = execute_cli(vec![
                "mcp".into(),
                "plugin".into(),
                "status".into(),
                "--target".into(),
                "opencode".into(),
            ])
            .unwrap();
            assert!(matches!(
                json_payload(&plugin_status)["status"].as_str(),
                Some("configured") | Some("not-configured")
            ));

            let discovery_file = dir.join("mcp-discovery.json");
            signed_receipt_discovery("http://127.0.0.1:7228", &discovery_file);

            let config_path = dir.join("opencode.jsonc");
            fs::write(&config_path, "{}\n").unwrap();
            let plugin_update = execute_cli(vec![
                "mcp".into(),
                "plugin".into(),
                "update".into(),
                "--target".into(),
                "opencode".into(),
                "--config-path".into(),
                config_path.display().to_string(),
                "--state-root".into(),
                dir.join("future-client").display().to_string(),
                "--token".into(),
                "plugin-token".into(),
                "--discovery-file".into(),
                discovery_file.display().to_string(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&plugin_update)["status"], "updated");

            let snapshot_id = json_payload(&&plugin_update)
                .get("apply")
                .and_then(|a| a.get("snapshotId"))
                .and_then(|s| s.as_str())
                .unwrap_or("snapshot-missing")
                .to_string();

            let plugin_rollback = execute_cli(vec![
                "mcp".into(),
                "plugin".into(),
                "rollback".into(),
                "--target".into(),
                "opencode".into(),
                "--snapshot-id".into(),
                snapshot_id,
            ])
            .unwrap();
            assert_eq!(json_payload(&&plugin_rollback)["status"], "rolled_back");
        }
    }

    #[test]
    fn cli_dispatches_mcp_config_and_snapshots() {
        let dir = temp_cli_dir("dispatch-config");
        let config_path = dir.join("opencode.jsonc");
        fs::write(&config_path, "{}\n").unwrap();

        {
            let _guard = cli_env_lock().lock().unwrap();
            let _portable = set_portable_dir(&dir);
            let state_root = dir.join("future-client");

            let discovery_file = dir.join("mcp-discovery.json");
            signed_receipt_discovery("http://127.0.0.1:7228", &discovery_file);

            let plan = execute_cli(vec![
                "mcp".into(),
                "config".into(),
                "plan".into(),
                "--target".into(),
                "opencode".into(),
                "--discovery-file".into(),
                discovery_file.display().to_string(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&plan)["status"], "planned");

            let apply = execute_cli(vec![
                "mcp".into(),
                "config".into(),
                "apply".into(),
                "--target".into(),
                "opencode".into(),
                "--config-path".into(),
                config_path.display().to_string(),
                "--state-root".into(),
                state_root.display().to_string(),
                "--token".into(),
                "x-token".into(),
                "--discovery-file".into(),
                discovery_file.display().to_string(),
            ])
            .unwrap();
            let apply = json_payload(&&apply);
            assert_eq!(apply["status"], "applied");
            assert!(apply["snapshotId"].is_string());

            let rollback = execute_cli(vec![
                "mcp".into(),
                "config".into(),
                "rollback".into(),
                "--target".into(),
                "opencode".into(),
                "--snapshot-id".into(),
                apply["snapshotId"].as_str().unwrap().to_string(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&rollback)["status"], "rolled_back");

            let conflict = execute_cli(vec![
                "mcp".into(),
                "config".into(),
                "apply".into(),
                "--target".into(),
                "opencode".into(),
                "--config-path".into(),
                config_path.display().to_string(),
                "--expected-hash".into(),
                "bad-hash".into(),
                "--discovery-file".into(),
                discovery_file.display().to_string(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&conflict)["status"], "field_conflict");

            let list = execute_cli(vec![
                "snapshots".into(),
                "list".into(),
                "--target".into(),
                "opencode".into(),
            ])
            .unwrap();
            let list = json_payload(&&list);
            assert_eq!(list["ok"], true);
            let snapshot_id = list["snapshots"]
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item.get("snapshotId"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if !snapshot_id.is_empty() {
                let restore = execute_cli(vec!["snapshots".into(), "restore".into(), snapshot_id]);
                assert!(restore.is_ok());
            }
        }
    }

    #[test]
    fn cli_dispatches_help_and_error_paths() {
        let dir = temp_cli_dir("dispatch-errors");

        {
            let _guard = cli_env_lock().lock().unwrap();
            let _portable = set_portable_dir(&dir);

            let empty = execute_cli(vec![]);
            assert!(matches!(empty.unwrap(), CliExecution::Usage));

            let help = execute_cli(vec!["help".into()]);
            assert!(matches!(help.unwrap(), CliExecution::Usage));

            let flag_help = execute_cli(vec!["--help".into()]);
            assert!(matches!(flag_help.unwrap(), CliExecution::Usage));

            let unknown = execute_cli(vec!["unknown".into()]);
            assert!(matches!(unknown.unwrap(), CliExecution::Usage));

            let bad_state =
                execute_cli(vec!["state".into(), "get".into(), "does-not-exist".into()]);
            assert!(bad_state.is_err());

            let bad_forward = execute_cli(vec!["forward".into(), "--text".into(), "ping".into()]);
            assert!(bad_forward.is_err());
        }
    }

    #[test]
    fn cli_parse_json_args_and_keys() {
        assert_eq!(parse_json_arg("{\"x\":1}")["x"], json!(1));
        assert_eq!(parse_json_arg("bad json"), json!({}));
        assert_eq!(cli_param_key("base-url"), "baseUrl");
        assert_eq!(cli_param_key("mcp_discovery_file"), "mcpDiscoveryFile");

        let params = cli_params(&[
            "--target".into(),
            "opencode".into(),
            "alpha".into(),
            "--dry-run".into(),
            "false".into(),
        ]);
        assert_eq!(params["target"], "opencode");
        assert_eq!(params["dryRun"], "false");

        let bare_flag = cli_params(&["--dry-run".into()]);
        assert_eq!(bare_flag["dryRun"], true);
    }

    fn set_portable_dir(path: &Path) -> PortableDirGuard {
        PortableDirGuard::set(path)
    }

    fn json_payload(result: &CliExecution) -> &Value {
        match result {
            CliExecution::Json(value) => value,
            CliExecution::Usage => panic!("expected json result"),
        }
    }

    fn temp_cli_dir(name: &str) -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let dir = env::temp_dir().join(format!(
            "pact-client-cli-test-{}-{}-{}",
            name,
            now.as_secs(),
            now.subsec_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cli_env_lock() -> &'static std::sync::Mutex<()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
    }

    struct PortableDirGuard {
        previous: Option<PathBuf>,
    }

    impl PortableDirGuard {
        fn set(path: &Path) -> Self {
            let previous =
                pact_client_native::paths::set_portable_data_dir_override(Some(path.to_path_buf()));
            Self { previous }
        }
    }

    impl Drop for PortableDirGuard {
        fn drop(&mut self) {
            pact_client_native::paths::set_portable_data_dir_override(self.previous.take());
        }
    }
}
