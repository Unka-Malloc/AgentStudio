use crate::client_state::ClientStateStore;
use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const STATUS_REQUESTED: &str = "requested";
const STATUS_APPROVED: &str = "approved";
const STATUS_REVOKED: &str = "revoked";

pub fn pair_request(params: &Value) -> Result<Value> {
    pair_request_in(&ClientStateStore::portable()?, params)
}

pub fn pair_approve(params: &Value) -> Result<Value> {
    pair_approve_in(&ClientStateStore::portable()?, params)
}

pub fn pair_revoke(params: &Value) -> Result<Value> {
    pair_revoke_in(&ClientStateStore::portable()?, params)
}

pub fn pair_list(params: &Value) -> Result<Value> {
    pair_list_in(&ClientStateStore::portable()?, params)
}

pub fn skill_list(params: &Value) -> Result<Value> {
    skill_list_in(&ClientStateStore::portable()?, params)
}

pub fn skill_get(params: &Value) -> Result<Value> {
    skill_get_in(&ClientStateStore::portable()?, params)
}

pub fn skill_visibility(params: &Value) -> Result<Value> {
    skill_visibility_in(&ClientStateStore::portable()?, params)
}

pub fn skill_pin(params: &Value) -> Result<Value> {
    skill_pin_in(&ClientStateStore::portable()?, params)
}

fn pair_request_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    let agent_id = agent_id(params)?;
    let target = target_id(params).unwrap_or_else(|| "manual".to_string());
    let target_kind = params
        .get("targetKind")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let label = params
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or(&agent_id);
    let config_path = params
        .get("configPath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let binary_path = params
        .get("binaryPath")
        .and_then(Value::as_str)
        .unwrap_or("");
    let pairing_id = format!("pair-{}", uuid_v4());
    let local_identity = format!("local-{}", uuid_v4());
    let visibility_policy = params
        .get("defaultVisibilityPolicy")
        .and_then(Value::as_str)
        .unwrap_or("deny-by-default");

    let mut document = store.read_collection("pairings")?;
    let items = collection_items_mut(&mut document)?;
    items.retain(|item| item.get("agentId").and_then(Value::as_str) != Some(&agent_id));
    let record = json!({
        "pairingId": pairing_id,
        "agentId": agent_id,
        "target": target,
        "targetKind": target_kind,
        "label": label,
        "configPath": config_path,
        "binaryPath": binary_path,
        "localIdentity": local_identity,
        "status": STATUS_REQUESTED,
        "requestedAt": timestamp(),
        "defaultVisibilityPolicy": visibility_policy,
        "scopes": [],
    });
    items.push(record.clone());
    store.write_collection("pairings", document)?;
    append_activity(
        store,
        "pairing.requested",
        json!({"target": target, "agentId": agent_id, "pairingId": pairing_id}),
    )?;
    Ok(json!({
        "ok": true,
        "status": STATUS_REQUESTED,
        "pairing": record
    }))
}

fn pair_approve_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    update_pairing_status(store, params, STATUS_APPROVED, "pairing.approved")
}

fn pair_revoke_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    update_pairing_status(store, params, STATUS_REVOKED, "pairing.revoked")
}

fn pair_list_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    let document = store.read_collection("pairings")?;
    let mut pairings = document
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(agent) = params.get("agent").and_then(Value::as_str) {
        pairings.retain(|item| item.get("agentId").and_then(Value::as_str) == Some(agent));
    }
    Ok(json!({
        "ok": true,
        "pairings": pairings
    }))
}

fn update_pairing_status(
    store: &ClientStateStore,
    params: &Value,
    status: &str,
    event_type: &str,
) -> Result<Value> {
    let agent_id = agent_id(params)?;
    let mut document = store.read_collection("pairings")?;
    let items = collection_items_mut(&mut document)?;
    let mut updated = None::<Value>;
    for item in items.iter_mut() {
        if item.get("agentId").and_then(Value::as_str) == Some(&agent_id) {
            item["status"] = json!(status);
            let status_time_key = match status {
                STATUS_APPROVED => "approvedAt",
                STATUS_REVOKED => "revokedAt",
                _ => "updatedAt",
            };
            item[status_time_key] = json!(timestamp());
            updated = Some(item.clone());
            break;
        }
    }
    let Some(record) = updated else {
        return Ok(json!({
            "ok": false,
            "error": "pairing_not_found",
            "agentId": agent_id
        }));
    };
    store.write_collection("pairings", document)?;
    append_activity(
        store,
        event_type,
        json!({
            "target": record.get("target").and_then(Value::as_str).unwrap_or(""),
            "agentId": agent_id
        }),
    )?;
    Ok(json!({
        "ok": true,
        "status": status,
        "pairing": record
    }))
}

fn skill_list_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    let agent_id = agent_id(params)?;
    if !is_agent_approved(store, &agent_id)? {
        return Ok(pairing_required(&agent_id));
    }
    let skills = visible_skills(store, &agent_id)?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "protocolStatus": "protocol_deferred",
        "skills": skills
    }))
}

fn skill_get_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    let agent_id = agent_id(params)?;
    if !is_agent_approved(store, &agent_id)? {
        return Ok(pairing_required(&agent_id));
    }
    let skill_id = skill_id(params)?;
    let skill = find_skill(store, &skill_id)?;
    let Some(skill) = skill else {
        return Ok(protocol_deferred(&agent_id, &skill_id));
    };
    if is_hidden(store, &agent_id, &skill_id)? {
        return Ok(json!({
            "ok": false,
            "error": "hidden",
            "agentId": agent_id,
            "skillId": skill_id
        }));
    }
    if !is_skill_visible_by_policy(store, &agent_id, &skill_id)? {
        return Ok(json!({
            "ok": false,
            "error": "visibility_denied",
            "agentId": agent_id,
            "skillId": skill_id,
            "message": "Skill visibility denied by pairing defaultVisibilityPolicy"
        }));
    }
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "skill": skill,
        "protocolStatus": "protocol_deferred",
        "execution": "not_supported",
        "dependencyInstall": "not_supported",
        "copyToWorkspace": "not_supported"
    }))
}

fn is_skill_visible_by_policy(
    store: &ClientStateStore,
    agent_id: &str,
    skill_id: &str,
) -> Result<bool> {
    let pairing = get_approved_pairing(store, agent_id)?;
    let policy = pairing
        .as_ref()
        .and_then(|p| p.get("defaultVisibilityPolicy").and_then(Value::as_str))
        .unwrap_or("allow-all");
    match policy {
        "deny-by-default" => Ok(is_explicitly_revealed(store, agent_id, skill_id)),
        _ => Ok(true),
    }
}

fn skill_visibility_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    let agent_id = agent_id(params)?;
    let skill_id = skill_id(params)?;
    let hidden = bool_param(params, "hidden").unwrap_or_else(|| {
        params
            .get("visibility")
            .and_then(Value::as_str)
            .map(|value| value == "hidden" || value == "hide")
            .unwrap_or(false)
    });
    let mut document = store.read_collection("skills")?;
    let items = collection_items_mut(&mut document)?;
    upsert_policy_item(
        items,
        &agent_id,
        &skill_id,
        json!({
            "agentId": agent_id,
            "skillId": skill_id,
            "hidden": hidden,
            "visibility": if hidden { "hidden" } else { "allowed" },
            "updatedAt": timestamp()
        }),
    );
    store.write_collection("skills", document)?;
    append_activity(
        store,
        if hidden {
            "skill.hidden"
        } else {
            "skill.revealed"
        },
        json!({"target": agent_id, "agentId": agent_id, "skillId": skill_id}),
    )?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "skillId": skill_id,
        "hidden": hidden
    }))
}

fn skill_pin_in(store: &ClientStateStore, params: &Value) -> Result<Value> {
    let agent_id = agent_id(params)?;
    let skill_id = skill_id(params)?;
    let version = params
        .get("version")
        .and_then(Value::as_str)
        .or_else(|| {
            params
                .get("positionals")
                .and_then(Value::as_array)
                .and_then(|items| items.get(1))
                .and_then(Value::as_str)
        })
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("skill pin requires --version <version>"))?
        .to_string();
    let mut document = store.read_collection("pins")?;
    let items = collection_items_mut(&mut document)?;
    upsert_policy_item(
        items,
        &agent_id,
        &skill_id,
        json!({
            "agentId": agent_id,
            "skillId": skill_id,
            "version": version,
            "updatedAt": timestamp()
        }),
    );
    store.write_collection("pins", document)?;
    append_activity(
        store,
        "skill.pinned",
        json!({"target": agent_id, "agentId": agent_id, "skillId": skill_id, "version": version}),
    )?;
    Ok(json!({
        "ok": true,
        "agentId": agent_id,
        "skillId": skill_id,
        "version": version
    }))
}

fn visible_skills(store: &ClientStateStore, agent_id: &str) -> Result<Vec<Value>> {
    let pairing = get_approved_pairing(store, agent_id)?;
    let policy = pairing
        .as_ref()
        .and_then(|p| p.get("defaultVisibilityPolicy").and_then(Value::as_str))
        .unwrap_or("allow-all");

    let document = store.read_collection("skills")?;
    let items = document
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    Ok(items
        .into_iter()
        .filter(|item| item.get("kind").and_then(Value::as_str) == Some("skill"))
        .filter(|item| {
            let skill_id = item.get("skillId").and_then(Value::as_str).unwrap_or("");
            if is_hidden(store, agent_id, skill_id).unwrap_or(true) {
                return false;
            }
            match policy {
                "deny-by-default" => is_explicitly_revealed(store, agent_id, skill_id),
                _ => true,
            }
        })
        .collect())
}

fn get_approved_pairing(store: &ClientStateStore, agent_id: &str) -> Result<Option<Value>> {
    let document = store.read_collection("pairings")?;
    Ok(document
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .find(|item| {
                    item.get("agentId").and_then(Value::as_str) == Some(agent_id)
                        && item.get("status").and_then(Value::as_str) == Some(STATUS_APPROVED)
                })
                .cloned()
        })
        .unwrap_or(None))
}

fn is_explicitly_revealed(store: &ClientStateStore, agent_id: &str, skill_id: &str) -> bool {
    let document = match store.read_collection("skills") {
        Ok(doc) => doc,
        Err(_) => return false,
    };
    document
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().any(|item| {
                item.get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("visibility")
                    != "skill"
                    && item.get("agentId").and_then(Value::as_str) == Some(agent_id)
                    && item.get("skillId").and_then(Value::as_str) == Some(skill_id)
                    && item.get("hidden").and_then(Value::as_bool) == Some(false)
                    && item.get("visibility").and_then(Value::as_str) == Some("allowed")
            })
        })
        .unwrap_or(false)
}

fn find_skill(store: &ClientStateStore, skill_id: &str) -> Result<Option<Value>> {
    let document = store.read_collection("skills")?;
    Ok(document
        .get("items")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| {
                    item.get("kind").and_then(Value::as_str) == Some("skill")
                        && item.get("skillId").and_then(Value::as_str) == Some(skill_id)
                })
                .cloned()
        }))
}

fn is_hidden(store: &ClientStateStore, agent_id: &str, skill_id: &str) -> Result<bool> {
    let document = store.read_collection("skills")?;
    Ok(document
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().any(|item| {
                item.get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("visibility")
                    != "skill"
                    && item.get("agentId").and_then(Value::as_str) == Some(agent_id)
                    && item.get("skillId").and_then(Value::as_str) == Some(skill_id)
                    && item.get("hidden").and_then(Value::as_bool).unwrap_or(false)
            })
        })
        .unwrap_or(false))
}

fn is_agent_approved(store: &ClientStateStore, agent_id: &str) -> Result<bool> {
    Ok(get_approved_pairing(store, agent_id)?.is_some())
}

fn upsert_policy_item(items: &mut Vec<Value>, agent_id: &str, skill_id: &str, replacement: Value) {
    items.retain(|item| {
        !(item
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("visibility")
            != "skill"
            && item.get("agentId").and_then(Value::as_str) == Some(agent_id)
            && item.get("skillId").and_then(Value::as_str) == Some(skill_id))
    });
    items.push(replacement);
}

fn collection_items_mut(document: &mut Value) -> Result<&mut Vec<Value>> {
    if document.get("items").and_then(Value::as_array).is_none() {
        document["items"] = json!([]);
    }
    document
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| anyhow!("state collection is missing items array"))
}

fn append_activity(store: &ClientStateStore, event_type: &str, payload: Value) -> Result<Value> {
    store.activity_log().append(event_type, payload)
}

fn pairing_required(agent_id: &str) -> Value {
    json!({
        "ok": false,
        "error": "pairing_required",
        "agentId": agent_id
    })
}

fn protocol_deferred(agent_id: &str, skill_id: &str) -> Value {
    json!({
        "ok": false,
        "error": "protocol_deferred",
        "agentId": agent_id,
        "skillId": skill_id,
        "protocols": ["server Skill Registry", "MCP Skill Hub"]
    })
}

fn agent_id(params: &Value) -> Result<String> {
    string_param(params, &["agent", "agentId", "id"], 0)
        .ok_or_else(|| anyhow!("missing --agent <agent-id>"))
}

fn target_id(params: &Value) -> Option<String> {
    string_param(params, &["target"], 1)
}

fn skill_id(params: &Value) -> Result<String> {
    string_param(params, &["skill", "skillId", "id"], 0).ok_or_else(|| anyhow!("missing skill id"))
}

fn string_param(params: &Value, keys: &[&str], positional_index: usize) -> Option<String> {
    for key in keys {
        if let Some(value) = params.get(*key).and_then(Value::as_str) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    params
        .get("positionals")
        .and_then(Value::as_array)
        .and_then(|items| items.get(positional_index))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn bool_param(params: &Value, key: &str) -> Option<bool> {
    params.get(key).and_then(|value| {
        value.as_bool().or_else(|| {
            value.as_str().map(|raw| {
                matches!(
                    raw.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on" | "hidden" | "hide"
                )
            })
        })
    })
}

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{}", now.as_secs(), now.subsec_nanos())
}

fn uuid_v4() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn pairing_skill_cli_pair_request_approve_revoke_list() {
        let store = test_store("pairing-lifecycle");
        let requested =
            pair_request_in(&store, &json!({"agent": "codex", "target": "codex"})).unwrap();
        assert_eq!(requested["status"], STATUS_REQUESTED);

        let approved = pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(approved["status"], STATUS_APPROVED);
        assert!(is_agent_approved(&store, "codex").unwrap());

        let listed = pair_list_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(listed["pairings"].as_array().unwrap().len(), 1);

        let revoked = pair_revoke_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(revoked["status"], STATUS_REVOKED);
        assert!(!is_agent_approved(&store, "codex").unwrap());
    }

    #[test]
    fn pairing_skill_cli_unpaired_skill_list_returns_pairing_required() {
        let store = test_store("unpaired");
        let result = skill_list_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "pairing_required");
    }

    #[test]
    fn pairing_skill_cli_hidden_skill_returns_hidden() {
        let store = test_store("hidden");
        pair_request_in(&store, &json!({"agent": "codex", "target": "codex"})).unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");

        skill_visibility_in(
            &store,
            &json!({"agent": "codex", "skill": "review", "hidden": true}),
        )
        .unwrap();
        let result = skill_get_in(&store, &json!({"agent": "codex", "skill": "review"})).unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "hidden");
    }

    #[test]
    fn pairing_skill_cli_missing_skill_is_protocol_deferred() {
        let store = test_store("deferred");
        pair_request_in(
            &store,
            &json!({"agent": "codex", "target": "codex", "defaultVisibilityPolicy": "allow-all"}),
        )
        .unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();

        let result = skill_get_in(&store, &json!({"agent": "codex", "skill": "future"})).unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "protocol_deferred");
        assert!(
            result["protocols"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item.as_str() == Some("server Skill Registry"))
        );
    }

    #[test]
    fn pairing_skill_cli_pin_and_get_are_passive() {
        let store = test_store("pin");
        pair_request_in(
            &store,
            &json!({"agent": "codex", "target": "codex", "defaultVisibilityPolicy": "allow-all"}),
        )
        .unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");

        let pinned = skill_pin_in(
            &store,
            &json!({"agent": "codex", "skill": "review", "version": "1.0.0"}),
        )
        .unwrap();
        assert_eq!(pinned["version"], "1.0.0");

        let result = skill_get_in(&store, &json!({"agent": "codex", "skill": "review"})).unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["execution"], "not_supported");
        assert_eq!(result["dependencyInstall"], "not_supported");
        assert_eq!(result["copyToWorkspace"], "not_supported");
    }

    #[test]
    fn pairing_skill_hub_public_wrappers_work_with_temp_portable_state() {
        let dir = temp_test_dir("public-wrappers");
        let _guard = PortableDataDirOverrideGuard::set(dir);

        let requested = pair_request(&json!({"agent": "codex", "target": "codex"})).unwrap();
        assert_eq!(requested["status"], STATUS_REQUESTED);

        let approved = pair_approve(&json!({"agent": "codex"})).unwrap();
        assert_eq!(approved["status"], STATUS_APPROVED);

        let listed = pair_list(&json!({"agent": "codex"})).unwrap();
        assert_eq!(listed["pairings"].as_array().unwrap().len(), 1);

        let pinned =
            skill_pin(&json!({"agent": "codex", "skill": "review", "version": "0.1.0"})).unwrap();
        assert_eq!(pinned["version"], "0.1.0");

        let visibility =
            skill_visibility(&json!({"agent": "codex", "skill": "review", "hidden": "on"}))
                .unwrap();
        assert_eq!(visibility["hidden"], true);

        let list = skill_list(&json!({"agent": "codex"})).unwrap();
        assert_eq!(list["ok"], true);
    }

    #[test]
    fn pairing_skill_hub_parsing_helpers_support_aliases_and_positionals() {
        assert_eq!(
            string_param(&json!({"agentId": "codex"}), &["agent", "agentId"], 0).unwrap(),
            "codex"
        );
        assert_eq!(
            string_param(
                &json!({"positionals": ["target-id", "skill-id"]}),
                &["agent", "agentId"],
                1
            )
            .unwrap(),
            "skill-id"
        );
        assert_eq!(
            bool_param(&json!({"hidden": "hidden"}), "hidden"),
            Some(true)
        );
        assert_eq!(bool_param(&json!({"hidden": "no"}), "hidden"), Some(false));
    }

    #[test]
    fn pairing_skill_hub_upsert_policy_item_replaces_matching_visibility_entry_only() {
        let mut items = vec![
            json!({"agentId":"codex","skillId":"review","hidden":false}),
            json!({"kind":"skill","agentId":"codex","skillId":"review","hidden":false}),
        ];
        upsert_policy_item(
            &mut items,
            "codex",
            "review",
            json!({"agentId":"codex","skillId":"review","hidden":true}),
        );
        assert_eq!(items.len(), 2);
        assert_eq!(
            items
                .iter()
                .filter(|item| item.get("kind").is_none())
                .filter(|item| item.get("agentId") == Some(&json!("codex")))
                .filter(|item| item.get("skillId") == Some(&json!("review")))
                .find_map(|item| item.get("hidden").and_then(Value::as_bool)),
            Some(true)
        );
        assert_eq!(
            items
                .iter()
                .filter(|item| item.get("kind") == Some(&json!("skill")))
                .filter(|item| item.get("agentId") == Some(&json!("codex")))
                .filter(|item| item.get("skillId") == Some(&json!("review")))
                .find_map(|item| item.get("hidden").and_then(Value::as_bool)),
            Some(false)
        );
    }

    #[test]
    fn pairing_skill_cli_approve_missing_pairing_returns_error() {
        let store = test_store("approve-missing");
        let approved = pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(approved["ok"], false);
        assert_eq!(approved["error"], "pairing_not_found");
    }

    #[test]
    fn pairing_skill_cli_pin_uses_positionals_version() {
        let store = test_store("pin-positionals");
        pair_request_in(&store, &json!({"agent": "codex", "target": "codex"})).unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");

        let pinned = skill_pin_in(
            &store,
            &json!({
                "agent": "codex",
                "skill": "review",
                "positionals": ["ignored", "2.0.0"],
            }),
        )
        .unwrap();
        assert_eq!(pinned["ok"], true);
        assert_eq!(pinned["version"], "2.0.0");
    }

    #[test]
    fn pairing_skill_hub_visibility_filters_listed_skills() {
        let store = test_store("visibility-filters-list");
        pair_request_in(&store, &json!({"agent": "codex", "target": "codex"})).unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");
        skill_visibility_in(
            &store,
            &json!({"agent":"codex","skill":"review","hidden": "hidden"}),
        )
        .unwrap();

        let list = pair_list_in(&store, &json!({"agent":"codex"})).unwrap();
        assert_eq!(list["pairings"].as_array().unwrap().len(), 1);
        assert!(list["pairings"][0]["status"] == "approved");

        let visible = skill_list_in(&store, &json!({"agent":"codex"})).unwrap();
        assert!(visible["skills"].as_array().unwrap().is_empty());
    }

    #[test]
    fn deny_by_default_pairing_hides_unrevealed_skills() {
        let store = test_store("deny-by-default");
        pair_request_in(
            &store,
            &json!({
                "agent": "codex",
                "target": "codex",
                "defaultVisibilityPolicy": "deny-by-default"
            }),
        )
        .unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");

        let visible = skill_list_in(&store, &json!({"agent": "codex"})).unwrap();
        assert!(visible["skills"].as_array().unwrap().is_empty());
    }

    #[test]
    fn deny_by_default_revealed_skill_is_visible() {
        let store = test_store("deny-revealed");
        pair_request_in(
            &store,
            &json!({
                "agent": "codex",
                "target": "codex",
                "defaultVisibilityPolicy": "deny-by-default"
            }),
        )
        .unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");
        skill_visibility_in(
            &store,
            &json!({
                "agent": "codex",
                "skill": "review",
                "hidden": false
            }),
        )
        .unwrap();

        let visible = skill_list_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(visible["skills"].as_array().unwrap().len(), 1);
        assert_eq!(visible["skills"][0]["skillId"], "review");
    }

    #[test]
    fn allow_all_pairing_returns_unhidden_skills() {
        let store = test_store("allow-all");
        pair_request_in(
            &store,
            &json!({
                "agent": "codex",
                "target": "codex",
                "defaultVisibilityPolicy": "allow-all"
            }),
        )
        .unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");
        seed_skill(&store, "lint", "2.0.0");

        let visible = skill_list_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(visible["skills"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn revoked_pairing_blocks_skill_list() {
        let store = test_store("revoked-blocks");
        pair_request_in(&store, &json!({"agent": "codex", "target": "codex"})).unwrap();
        pair_approve_in(&store, &json!({"agent": "codex"})).unwrap();
        seed_skill(&store, "review", "1.0.0");
        pair_revoke_in(&store, &json!({"agent": "codex"})).unwrap();

        let result = skill_list_in(&store, &json!({"agent": "codex"})).unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "pairing_required");
    }

    fn seed_skill(store: &ClientStateStore, skill_id: &str, version: &str) {
        let mut document = store.read_collection("skills").unwrap();
        collection_items_mut(&mut document).unwrap().push(json!({
            "kind": "skill",
            "skillId": skill_id,
            "version": version,
            "metadata": {
                "name": skill_id
            }
        }));
        store.write_collection("skills", document).unwrap();
    }

    fn test_store(name: &str) -> ClientStateStore {
        let dir: PathBuf =
            env::temp_dir().join(format!("pact-pairing-skill-{}-{}", name, timestamp()));
        fs::create_dir_all(&dir).unwrap();
        ClientStateStore::new(dir).unwrap()
    }

    struct PortableDataDirOverrideGuard {
        previous: Option<PathBuf>,
    }

    impl PortableDataDirOverrideGuard {
        fn set(path: PathBuf) -> Self {
            let previous = crate::paths::set_portable_data_dir_override(Some(path));
            Self { previous }
        }
    }

    impl Drop for PortableDataDirOverrideGuard {
        fn drop(&mut self) {
            crate::paths::set_portable_data_dir_override(self.previous.take());
        }
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!(
            "pact-skill-hub-{}-{}-{}",
            name,
            timestamp(),
            timestamp()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
