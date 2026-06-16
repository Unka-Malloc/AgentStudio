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
        [scope, area, action, rest @ ..]
            if scope == "process-identity" && area == "bootstrap" && action == "claim" =>
        {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::process_identity::bootstrap_claim(&params)?,
            ))
        }
        [scope, area, action, rest @ ..]
            if scope == "process-identity" && area == "request" && action == "sign" =>
        {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::process_identity::sign_request(&params)?,
            ))
        }
        [scope, action, rest @ ..] if scope == "process-identity" && action == "status" => {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::process_identity::status(&params)?,
            ))
        }
        [scope, action, rest @ ..] if scope == "local-runtime" => {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "ensure" => pact_client_native::local_runtime::ensure(&params)?,
                "build" => pact_client_native::local_runtime::build(&params)?,
                "start" => pact_client_native::local_runtime::start(&params)?,
                "stop" => pact_client_native::local_runtime::stop(&params)?,
                "restart" => pact_client_native::local_runtime::restart(&params)?,
                "status" => pact_client_native::local_runtime::status(&params)?,
                "logs" => pact_client_native::local_runtime::logs(&params)?,
                _ => return Ok(CliExecution::Usage),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, action, rest @ ..] if scope == "source-queue" || scope == "upload-queue" => {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "add" => pact_client_native::source_queue::add(&params)?,
                "list" => pact_client_native::source_queue::list(&params)?,
                "status" => pact_client_native::source_queue::status(&params)?,
                "pause" => pact_client_native::source_queue::pause(&params)?,
                "resume" => pact_client_native::source_queue::resume(&params)?,
                "retry" => pact_client_native::source_queue::retry(&params)?,
                "cancel" => pact_client_native::source_queue::cancel(&params)?,
                "drain" => pact_client_native::source_queue::drain(&params)?,
                _ => return Ok(CliExecution::Usage),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, action, rest @ ..]
            if scope == "connectors" && matches!(action.as_str(), "list" | "sync" | "status") =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "list" => pact_client_native::connectors::list(&params)?,
                "sync" => pact_client_native::connectors::sync(&params)?,
                "status" => pact_client_native::connectors::status(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, action, subaction, rest @ ..]
            if scope == "connectors" && action == "mirror" && subaction == "inspect" =>
        {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::connectors::mirror_inspect(&params)?,
            ))
        }
        [scope, action, rest @ ..]
            if scope == "knowledge-cache"
                && matches!(
                    action.as_str(),
                    "sync" | "search" | "evidence" | "get" | "status"
                ) =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "sync" => pact_client_native::knowledge_cache::sync(&params)?,
                "search" => pact_client_native::knowledge_cache::search(&params)?,
                "evidence" => pact_client_native::knowledge_cache::evidence(&params)?,
                "get" => pact_client_native::knowledge_cache::get(&params)?,
                "status" => pact_client_native::knowledge_cache::status(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, action, rest @ ..]
            if scope == "mail"
                && matches!(action.as_str(), "preview" | "enqueue" | "status" | "cancel") =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "preview" => pact_client_native::mail::preview(&params)?,
                "enqueue" => pact_client_native::mail::enqueue(&params)?,
                "status" => pact_client_native::mail::status(&params)?,
                "cancel" => pact_client_native::mail::cancel(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, action, rest @ ..]
            if scope == "mcp-local-bridge"
                && matches!(
                    action.as_str(),
                    "plan" | "start" | "stop" | "status" | "register"
                ) =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "plan" => pact_client_native::mcp_local_bridge::plan(&params)?,
                "start" => pact_client_native::mcp_local_bridge::start(&params)?,
                "stop" => pact_client_native::mcp_local_bridge::stop(&params)?,
                "status" => pact_client_native::mcp_local_bridge::status(&params)?,
                "register" => pact_client_native::mcp_local_bridge::register(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
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
        [scope, action, rest @ ..]
            if scope == "conversations"
                && matches!(action.as_str(), "list" | "append" | "delete") =>
        {
            let params = cli_params(rest);
            let result = match action.as_str() {
                "list" => pact_client_native::conversations::conversation_list(&params)?,
                "append" => pact_client_native::conversations::conversation_append(&params)?,
                "delete" => pact_client_native::conversations::conversation_delete(&params)?,
                _ => unreachable!(),
            };
            Ok(CliExecution::Json(result))
        }
        [scope, area, action, rest @ ..]
            if scope == "agent" && area == "message" && action == "send" =>
        {
            let params = cli_params(rest);
            Ok(CliExecution::Json(
                pact_client_native::runtime_adapters::send_message(&params)?,
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
        [scope, area, noun, action, rest @ ..] if scope == "mobile" && area == "relay" => {
            let params = cli_params(rest);
            let result = match (noun.as_str(), action.as_str()) {
                ("config", "get") => pact_client_native::mobile_relay::config_get()?,
                ("config", "set") => pact_client_native::mobile_relay::config_set(&params)?,
                ("pairing", "create") => pact_client_native::mobile_relay::pairing_create(&params)?,
                ("pairing", "claim") => pact_client_native::mobile_relay::pairing_claim(&params)?,
                ("pairing", "status") => pact_client_native::mobile_relay::pairing_status(&params)?,
                ("pairing", "revoke") => pact_client_native::mobile_relay::pairing_revoke(&params)?,
                ("pc", "check-in") => pact_client_native::mobile_relay::pc_check_in(&params)?,
                ("commands", "poll") => pact_client_native::mobile_relay::commands_poll(&params)?,
                ("commands", "sync") => pact_client_native::mobile_relay::commands_sync(&params)?,
                ("commands", "complete") => {
                    pact_client_native::mobile_relay::command_complete(&params)?
                }
                ("commands", "create") => {
                    pact_client_native::mobile_relay::command_create(&params)?
                }
                ("commands", "result") => {
                    pact_client_native::mobile_relay::command_result(&params)?
                }
                _ => return Ok(CliExecution::Usage),
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
  pact-client state get|set <settings|targets|pairings|skills|pins|identities> [json]
  pact-client process-identity bootstrap claim --server-url URL --claim-token TOKEN --default-identity-hash HASH [--client-id ID]
  pact-client process-identity request sign --request-url URL [--method POST] [--body-text JSON]
  pact-client process-identity status [--server-url URL|--package-id ID]
  pact-client local-runtime ensure|build --source-root PATH --preset-config PATH [--port 17328] [--rebuild true]
  pact-client local-runtime start|restart [--port 17328]
  pact-client local-runtime stop|status|logs [--tail N]
  pact-client source-queue add|list|status|pause|resume|retry|cancel|drain [--path PATH|--text TEXT] [--server-url URL]
  pact-client upload-queue add|list|status|pause|resume|retry|cancel|drain (compatibility alias)
  pact-client connectors list|sync|status [--connector local-directory|icloud-local-projection|onedrive-local-projection] [--path PATH]
  pact-client connectors mirror inspect [--limit N]
  pact-client knowledge-cache sync|search|evidence|get|status [--evidence-json JSON|--evidence-file PATH|--query TEXT|--evidence-id ID]
  pact-client mail preview|enqueue|status|cancel --mailbox NAME [--since DATE|--until DATE|--query TEXT]
  pact-client mcp-local-bridge plan|start|stop|status|register [--port 17328|--server-url URL]
  pact-client activity list [--type TYPE] [--target TARGET] [--limit N]
  pact-client snapshots list [--target TARGET]
  pact-client snapshots restore <snapshot-id>
  pact-client conversations list|append|delete --agent AGENT [--session-id ID] [--text TEXT]
  pact-client agent message send --agent AGENT --text TEXT [--session-id ID] [--cwd PATH] [--command CMD] [--args JSON]
  pact-client agents pair request|approve|revoke|list --agent AGENT [--target TARGET]
  pact-client skill list --agent AGENT
  pact-client skill get <skill-id> --agent AGENT --json
  pact-client skill visibility set <skill-id> --agent AGENT --hidden true|false
  pact-client skill pin set <skill-id> --agent AGENT --version VERSION
  pact-client targets scan [--state-root PATH]
  pact-client targets add --target <target> [--config-path PATH] [--binary-path PATH] [--state-root PATH]
  pact-client targets inspect <target> [--state-root PATH]
  pact-client mobile relay config get|set [--use-custom-gateway true|false] [--custom-gateway-url URL] [--relay-enabled true|false]
  pact-client mobile relay pairing create|status|claim|revoke [--pairing-code CODE] [--pairing-id ID] [--mobile-token TOKEN]
  pact-client mobile relay pc check-in
  pact-client mobile relay commands poll|sync|complete|create|result [--command-id ID] [--type TYPE] [--payload JSON] [--mobile-token TOKEN]
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
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
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

            let native_history_root = dir.join("native-codex-history");
            fs::create_dir_all(&native_history_root).unwrap();
            fs::write(
                native_history_root.join("history.jsonl"),
                [
                    r#"{"role":"user","content":"hello from native codex history"}"#,
                    r#"{"role":"assistant","content":"native history response"}"#,
                ]
                .join("\n"),
            )
            .unwrap();

            let conversations = execute_cli(vec![
                "conversations".into(),
                "list".into(),
                "--agent".into(),
                "codex".into(),
                "--root".into(),
                native_history_root.display().to_string(),
            ])
            .unwrap();
            assert_eq!(
                json_payload(&&conversations)["sessions"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            assert_eq!(json_payload(&&conversations)["mode"], "native-history");

            let relay_config = execute_cli(vec![
                "mobile".into(),
                "relay".into(),
                "config".into(),
                "set".into(),
                "--use-custom-gateway".into(),
                "true".into(),
                "--custom-gateway-url".into(),
                "https://relay.example.test/".into(),
            ])
            .unwrap();
            assert_eq!(
                json_payload(&&relay_config)["config"]["useCustomGateway"],
                true
            );
            assert_eq!(
                json_payload(&&relay_config)["config"]["customGatewayUrl"],
                "https://relay.example.test"
            );
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
    fn cli_dispatches_gap_closure_client_surfaces() {
        let dir = temp_cli_dir("gap-client-surfaces");
        {
            let _guard = cli_env_lock().lock().unwrap();
            let _portable = set_portable_dir(&dir);

            let added = execute_cli(vec![
                "source-queue".into(),
                "add".into(),
                "--text".into(),
                "source queue text".into(),
                "--source-type".into(),
                "manual-text".into(),
                "--provider-id".into(),
                "test".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&added)["status"], "enqueued");

            let compat_list = execute_cli(vec!["upload-queue".into(), "list".into()]).unwrap();
            assert_eq!(json_payload(&&compat_list)["ok"], true);

            let paused = execute_cli(vec!["source-queue".into(), "pause".into()]).unwrap();
            assert_eq!(json_payload(&&paused)["paused"], true);
            let resumed = execute_cli(vec!["source-queue".into(), "resume".into()]).unwrap();
            assert_eq!(json_payload(&&resumed)["paused"], false);
            let drained = execute_cli(vec!["source-queue".into(), "drain".into()]).unwrap();
            assert_eq!(json_payload(&&drained)["deferred"], 1);

            let source_dir = dir.join("local-source");
            fs::create_dir_all(&source_dir).unwrap();
            fs::write(source_dir.join("note.txt"), "connector file").unwrap();
            let connectors = execute_cli(vec!["connectors".into(), "list".into()]).unwrap();
            assert_eq!(
                json_payload(&&connectors)["connectors"]
                    .as_array()
                    .unwrap()
                    .len(),
                4
            );
            let synced = execute_cli(vec![
                "connectors".into(),
                "sync".into(),
                "--connector".into(),
                "local-directory".into(),
                "--path".into(),
                source_dir.display().to_string(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&synced)["status"], "enqueued");
            let mirror =
                execute_cli(vec!["connectors".into(), "mirror".into(), "inspect".into()]).unwrap();
            assert_eq!(
                json_payload(&&mirror)["entries"].as_array().unwrap().len(),
                1
            );

            let synced_cache = execute_cli(vec![
                "knowledge-cache".into(),
                "sync".into(),
                "--evidence-json".into(),
                r#"{"id":"ev-1","title":"Queue recovery","text":"Source queue resumes uploads"}"#
                    .into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&synced_cache)["upserted"], 1);
            let searched = execute_cli(vec![
                "knowledge-cache".into(),
                "search".into(),
                "--query".into(),
                "queue".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&searched)["authoritative"], false);

            let mail_preview = execute_cli(vec![
                "mail".into(),
                "preview".into(),
                "--mailbox".into(),
                "Inbox".into(),
                "--since".into(),
                "2026-06-01".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&mail_preview)["status"], "preview_ready");
            let mail_enqueue = execute_cli(vec![
                "mail".into(),
                "enqueue".into(),
                "--mailbox".into(),
                "Inbox".into(),
                "--since".into(),
                "2026-06-01".into(),
            ])
            .unwrap();
            assert_eq!(json_payload(&&mail_enqueue)["status"], "enqueued");

            let bridge_plan = execute_cli(vec!["mcp-local-bridge".into(), "plan".into()]).unwrap();
            assert_eq!(json_payload(&&bridge_plan)["directServiceHubStdio"], false);
            let bridge_register =
                execute_cli(vec!["mcp-local-bridge".into(), "register".into()]).unwrap();
            assert_eq!(
                json_payload(&&bridge_register)["status"],
                "registration_planned"
            );
        }
    }

    #[test]
    fn cli_dispatches_local_runtime_status_before_start() {
        let dir = temp_cli_dir("local-runtime-status");
        {
            let _guard = cli_env_lock().lock().unwrap();
            let _portable = set_portable_dir(&dir);
            let status = execute_cli(vec!["local-runtime".into(), "status".into()]).unwrap();
            let payload = json_payload(&status);
            assert_eq!(payload["ok"], true);
            assert_eq!(payload["status"], "stopped");
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

    #[cfg(unix)]
    #[test]
    fn cli_dispatches_agent_message_send_runtime_adapter() {
        let dir = temp_cli_dir("dispatch-runtime");
        let script = dir.join("echo-agent.sh");
        fs::write(&script, "#!/bin/sh\nprintf 'cli-runtime:%s' \"$1\"\n").unwrap();
        let mut permissions = fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script, permissions).unwrap();

        let result = execute_cli(vec![
            "agent".into(),
            "message".into(),
            "send".into(),
            "--agent".into(),
            "codex".into(),
            "--text".into(),
            "hello-cli-runtime".into(),
            "--command".into(),
            script.display().to_string(),
            "--args".into(),
            r#"["{prompt}"]"#.into(),
            "--timeout-ms".into(),
            "5000".into(),
        ])
        .unwrap();

        let payload = json_payload(&result);
        assert_eq!(payload["ok"], true);
        assert_eq!(payload["mode"], "runtime-adapter");
        assert_eq!(payload["runtimeProtocol"], "configured-command");
        assert_eq!(payload["output"], "cli-runtime:hello-cli-runtime");
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
