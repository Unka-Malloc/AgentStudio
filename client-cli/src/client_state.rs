use crate::paths::portable_data_dir;
use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const STATE_SCHEMA_VERSION: u32 = 1;
const CLIENT_STATE_DIR: &str = "future-client";
const ACTIVITY_FILE: &str = "activity.jsonl";
const SNAPSHOT_DIR: &str = "snapshots";
const COLLECTIONS: &[&str] = &["settings", "targets", "pairings", "skills", "pins"];

#[derive(Clone, Debug)]
pub struct ClientStateStore {
    root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct ActivityLog {
    path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct SnapshotStore {
    root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct SnapshotRecord {
    pub snapshot_id: String,
    pub snapshot_path: PathBuf,
    pub source_path: PathBuf,
    pub existed: bool,
    pub content: String,
}

impl ClientStateStore {
    pub fn portable() -> Result<Self> {
        Self::new(portable_data_dir()?.join(CLIENT_STATE_DIR))
    }

    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root)?;
        fs::create_dir_all(root.join(SNAPSHOT_DIR))?;
        fs::create_dir_all(root.join("activity"))?;
        let store = Self { root };
        store.ensure_collections()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn collection_path(&self, collection: &str) -> Result<PathBuf> {
        validate_collection(collection)?;
        Ok(self.root.join(format!("{}.json", collection)))
    }

    pub fn read_collection(&self, collection: &str) -> Result<Value> {
        let path = self.collection_path(collection)?;
        read_json_or_default(&path, || empty_collection(collection))
    }

    pub fn write_collection(&self, collection: &str, value: Value) -> Result<Value> {
        let path = self.collection_path(collection)?;
        let document = normalize_collection(collection, value);
        atomic_write_json(&path, &document)?;
        Ok(document)
    }

    pub fn activity_log(&self) -> ActivityLog {
        ActivityLog {
            path: self.root.join("activity").join(ACTIVITY_FILE),
        }
    }

    pub fn snapshot_store(&self) -> SnapshotStore {
        SnapshotStore {
            root: self.root.join(SNAPSHOT_DIR),
        }
    }

    fn ensure_collections(&self) -> Result<()> {
        for collection in COLLECTIONS {
            let path = self.collection_path(collection)?;
            if !path.exists() {
                atomic_write_json(&path, &empty_collection(collection))?;
            }
        }
        Ok(())
    }
}

impl ActivityLog {
    pub fn portable() -> Result<Self> {
        Ok(ClientStateStore::portable()?.activity_log())
    }

    pub fn append(&self, event_type: &str, payload: Value) -> Result<Value> {
        let event = json!({
            "schemaVersion": STATE_SCHEMA_VERSION,
            "eventId": format!("activity-{}", timestamp()),
            "type": event_type,
            "target": payload.get("target").and_then(Value::as_str).unwrap_or(""),
            "createdAt": timestamp(),
            "payload": payload,
        });
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{}", serde_json::to_string(&event)?)?;
        Ok(event)
    }

    pub fn list(&self, filter: &Value) -> Result<Value> {
        let mut events = Vec::<Value>::new();
        if self.path.exists() {
            let file = fs::File::open(&self.path)?;
            for line in BufReader::new(file).lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let event: Value = serde_json::from_str(&line)?;
                if matches_activity_filter(&event, filter) {
                    events.push(event);
                }
            }
        }
        if let Some(limit) = filter.get("limit").and_then(Value::as_u64) {
            let limit = limit as usize;
            if events.len() > limit {
                events = events[events.len() - limit..].to_vec();
            }
        }
        Ok(json!({
            "ok": true,
            "schemaVersion": STATE_SCHEMA_VERSION,
            "path": display_path(self.path.clone()),
            "events": events
        }))
    }
}

impl SnapshotStore {
    pub fn portable() -> Result<Self> {
        Ok(ClientStateStore::portable()?.snapshot_store())
    }

    pub fn capture(
        &self,
        target: &str,
        source_path: &Path,
        metadata: Value,
    ) -> Result<SnapshotRecord> {
        fs::create_dir_all(&self.root)?;
        let existed = source_path.exists();
        let content = fs::read_to_string(source_path).unwrap_or_default();
        let snapshot_id = format!("snapshot-{}-{}", sanitize_id(target), timestamp());
        let snapshot_path = self.root.join(format!("{}.json", snapshot_id));
        let record = json!({
            "schemaVersion": STATE_SCHEMA_VERSION,
            "snapshotId": snapshot_id,
            "target": target,
            "sourcePath": display_path(source_path.to_path_buf()),
            "capturedAt": timestamp(),
            "existed": existed,
            "size": content.len(),
            "hash": hash_text(&content),
            "content": content,
            "metadata": metadata,
        });
        atomic_write_json(&snapshot_path, &record)?;
        Ok(SnapshotRecord {
            snapshot_id,
            snapshot_path,
            source_path: source_path.to_path_buf(),
            existed,
            content,
        })
    }

    pub fn list(&self, filter: &Value) -> Result<Value> {
        let mut snapshots = Vec::<Value>::new();
        if self.root.exists() {
            for entry in fs::read_dir(&self.root)? {
                let entry = entry?;
                if entry.path().extension().and_then(|item| item.to_str()) != Some("json") {
                    continue;
                }
                let snapshot = read_json_or_default(&entry.path(), || json!({}))?;
                if matches_snapshot_filter(&snapshot, filter) {
                    snapshots.push(snapshot_summary(&snapshot, entry.path()));
                }
            }
        }
        snapshots.sort_by(|left, right| {
            left.get("capturedAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .cmp(
                    right
                        .get("capturedAt")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                )
        });
        Ok(json!({
            "ok": true,
            "schemaVersion": STATE_SCHEMA_VERSION,
            "path": display_path(self.root.clone()),
            "snapshots": snapshots
        }))
    }

    pub fn restore(&self, snapshot_id: &str) -> Result<Value> {
        let snapshot_path = self.snapshot_path(snapshot_id);
        let snapshot = read_json_or_default(&snapshot_path, || json!({}))?;
        let source_path = snapshot
            .get("sourcePath")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| anyhow!("snapshot is missing sourcePath"))?;
        let existed = snapshot
            .get("existed")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let content = snapshot
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let pre_restore = self.capture(
            snapshot
                .get("target")
                .and_then(Value::as_str)
                .unwrap_or("restore"),
            &source_path,
            json!({
                "reason": "pre-restore",
                "restoringSnapshotId": snapshot_id
            }),
        )?;
        if existed {
            atomic_write_text(&source_path, content)?;
        } else if source_path.exists() {
            fs::remove_file(&source_path)?;
        }
        Ok(json!({
            "ok": true,
            "status": "restored",
            "snapshotId": snapshot_id,
            "snapshotPath": display_path(snapshot_path),
            "sourcePath": display_path(source_path),
            "preRestoreSnapshotId": pre_restore.snapshot_id,
            "preRestoreSnapshotPath": display_path(pre_restore.snapshot_path)
        }))
    }

    fn snapshot_path(&self, snapshot_id: &str) -> PathBuf {
        self.root.join(format!("{}.json", snapshot_id))
    }
}

pub fn state_get(collection: &str) -> Result<Value> {
    let store = ClientStateStore::portable()?;
    Ok(json!({
        "ok": true,
        "collection": collection,
        "document": store.read_collection(collection)?
    }))
}

pub fn state_set(collection: &str, value: Value) -> Result<Value> {
    let store = ClientStateStore::portable()?;
    let document = store.write_collection(collection, value)?;
    let activity = store.activity_log().append(
        "state.collection.saved",
        json!({
            "collection": collection,
            "target": collection
        }),
    )?;
    Ok(json!({
        "ok": true,
        "collection": collection,
        "document": document,
        "activity": activity
    }))
}

pub fn activity_list(params: &Value) -> Result<Value> {
    ActivityLog::portable()?.list(params)
}

pub fn snapshots_list(params: &Value) -> Result<Value> {
    SnapshotStore::portable()?.list(params)
}

pub fn snapshots_restore(snapshot_id: &str) -> Result<Value> {
    let store = ClientStateStore::portable()?;
    let result = store.snapshot_store().restore(snapshot_id)?;
    let activity = store.activity_log().append(
        "snapshot.restored",
        json!({
            "target": result.get("sourcePath").and_then(Value::as_str).unwrap_or(""),
            "snapshotId": snapshot_id
        }),
    )?;
    Ok(json!({
        "ok": true,
        "restore": result,
        "activity": activity
    }))
}

fn validate_collection(collection: &str) -> Result<()> {
    if COLLECTIONS.contains(&collection) {
        Ok(())
    } else {
        Err(anyhow!(
            "unsupported client state collection: {}",
            collection
        ))
    }
}

fn empty_collection(collection: &str) -> Value {
    json!({
        "schemaVersion": STATE_SCHEMA_VERSION,
        "collection": collection,
        "items": []
    })
}

fn normalize_collection(collection: &str, value: Value) -> Value {
    if value.is_object() {
        let mut object = value.as_object().cloned().unwrap_or_default();
        object
            .entry("schemaVersion".to_string())
            .or_insert_with(|| json!(STATE_SCHEMA_VERSION));
        object
            .entry("collection".to_string())
            .or_insert_with(|| json!(collection));
        Value::Object(object)
    } else {
        json!({
            "schemaVersion": STATE_SCHEMA_VERSION,
            "collection": collection,
            "items": value
        })
    }
}

fn matches_activity_filter(event: &Value, filter: &Value) -> bool {
    let type_matches = filter
        .get("type")
        .and_then(Value::as_str)
        .map(|expected| event.get("type").and_then(Value::as_str) == Some(expected))
        .unwrap_or(true);
    let target_matches = filter
        .get("target")
        .and_then(Value::as_str)
        .map(|expected| event.get("target").and_then(Value::as_str) == Some(expected))
        .unwrap_or(true);
    type_matches && target_matches
}

fn matches_snapshot_filter(snapshot: &Value, filter: &Value) -> bool {
    filter
        .get("target")
        .and_then(Value::as_str)
        .map(|expected| snapshot.get("target").and_then(Value::as_str) == Some(expected))
        .unwrap_or(true)
}

fn snapshot_summary(snapshot: &Value, path: PathBuf) -> Value {
    json!({
        "schemaVersion": snapshot.get("schemaVersion").cloned().unwrap_or_else(|| json!(STATE_SCHEMA_VERSION)),
        "snapshotId": snapshot.get("snapshotId").cloned().unwrap_or_else(|| json!("")),
        "target": snapshot.get("target").cloned().unwrap_or_else(|| json!("")),
        "sourcePath": snapshot.get("sourcePath").cloned().unwrap_or_else(|| json!("")),
        "capturedAt": snapshot.get("capturedAt").cloned().unwrap_or_else(|| json!("")),
        "existed": snapshot.get("existed").cloned().unwrap_or_else(|| json!(false)),
        "size": snapshot.get("size").cloned().unwrap_or_else(|| json!(0)),
        "hash": snapshot.get("hash").cloned().unwrap_or_else(|| json!("")),
        "snapshotPath": display_path(path)
    })
}

fn read_json_or_default<F>(path: &Path, default_value: F) -> Result<Value>
where
    F: FnOnce() -> Value,
{
    if !path.exists() {
        return Ok(default_value());
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(default_value());
    }
    Ok(serde_json::from_str(&raw)?)
}

fn atomic_write_json(path: &Path, value: &Value) -> Result<()> {
    atomic_write_text(path, &format!("{}\n", serde_json::to_string_pretty(value)?))
}

fn atomic_write_text(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", timestamp()));
    fs::write(&tmp, content)?;
    fs::rename(tmp, path)?;
    Ok(())
}

fn hash_text(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{}", now.as_secs(), now.subsec_nanos())
}

fn display_path(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn state_store_creates_json_collections() {
        let dir = temp_test_dir("collections");
        let store = ClientStateStore::new(dir.clone()).unwrap();

        for collection in COLLECTIONS {
            let document = store.read_collection(collection).unwrap();
            assert_eq!(document["schemaVersion"], STATE_SCHEMA_VERSION);
            assert_eq!(document["collection"], *collection);
            assert!(store.collection_path(collection).unwrap().exists());
        }
    }

    #[test]
    fn state_store_writes_settings_targets_pairings_skills_and_pins() {
        let dir = temp_test_dir("writes");
        let store = ClientStateStore::new(dir).unwrap();

        store
            .write_collection("settings", json!({"items": [{"key": "serverProfile"}]}))
            .unwrap();
        store
            .write_collection("targets", json!({"items": [{"target": "opencode"}]}))
            .unwrap();
        store
            .write_collection("pairings", json!({"items": [{"agent": "codex"}]}))
            .unwrap();
        store
            .write_collection("skills", json!({"items": [{"skill": "review"}]}))
            .unwrap();
        store
            .write_collection(
                "pins",
                json!({"items": [{"skill": "review", "version": "1"}]}),
            )
            .unwrap();

        assert_eq!(
            store.read_collection("targets").unwrap()["items"][0]["target"],
            "opencode"
        );
        assert_eq!(
            store.read_collection("pins").unwrap()["items"][0]["version"],
            "1"
        );
    }

    #[test]
    fn state_store_activity_log_is_jsonl_and_filterable() {
        let dir = temp_test_dir("activity");
        let store = ClientStateStore::new(dir).unwrap();
        let log = store.activity_log();
        log.append("target.config.applied", json!({"target": "opencode"}))
            .unwrap();
        log.append("skill.hidden", json!({"target": "codex"}))
            .unwrap();

        let listed = log.list(&json!({"target": "opencode"})).unwrap();
        let events = listed["events"].as_array().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["type"], "target.config.applied");
        assert!(
            fs::read_to_string(listed["path"].as_str().unwrap())
                .unwrap()
                .lines()
                .all(|line| serde_json::from_str::<Value>(line).is_ok())
        );
    }

    #[test]
    fn state_store_snapshot_store_can_list_and_restore() {
        let dir = temp_test_dir("snapshots");
        let store = ClientStateStore::new(dir).unwrap();
        let source = store.root().join("target-config.json");
        fs::write(&source, r#"{"before":true}"#).unwrap();
        let snapshot = store
            .snapshot_store()
            .capture("opencode", &source, json!({"operation": "test"}))
            .unwrap();
        fs::write(&source, r#"{"after":true}"#).unwrap();

        let listed = store
            .snapshot_store()
            .list(&json!({"target": "opencode"}))
            .unwrap();
        assert_eq!(listed["snapshots"].as_array().unwrap().len(), 1);

        let restored = store
            .snapshot_store()
            .restore(&snapshot.snapshot_id)
            .unwrap();
        assert_eq!(restored["status"], "restored");
        assert_eq!(fs::read_to_string(&source).unwrap(), r#"{"before":true}"#);
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("pact-client-state-{}-{}", name, timestamp()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
