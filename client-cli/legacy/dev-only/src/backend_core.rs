use crate::connectors;
use crate::upload_queue::{self, UploadQueueFile, UploadQueueState, UploadQueueTask};
use anyhow::{anyhow, Result};
use base64::Engine;
use fs2::FileExt;
use interprocess::local_socket::{prelude::*, GenericFilePath, GenericNamespaced, ListenerOptions};
use notify::{Config as NotifyConfig, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const PROTOCOL_VERSION: u32 = 1;
const BACKEND_SCHEMA_VERSION: u32 = 1;
const MAIL_WORKSPACE: &str = "mail-imports";
const BACKEND_WORKSPACE: &str = "backend";

#[derive(Clone, Debug)]
pub struct Backend {
    pub data_dir: PathBuf,
}

impl Backend {
    pub fn from_portable_data_dir() -> Result<Self> {
        Self::new(portable_data_dir()?)
    }

    pub fn new(data_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(data_dir.join(BACKEND_WORKSPACE))?;
        fs::create_dir_all(data_dir.join(MAIL_WORKSPACE))?;
        connectors::ensure_connector_workspace(&data_dir)?;
        Ok(Self { data_dir })
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn recent_runs_path(&self) -> PathBuf {
        self.data_dir.join("recent-runs.json")
    }

    pub fn checkpoints_path(&self) -> PathBuf {
        self.data_dir.join("checkpoints.json")
    }

    pub fn client_log_path(&self) -> PathBuf {
        self.data_dir.join("logs").join("client.log")
    }

    pub fn exports_dir(&self) -> PathBuf {
        self.data_dir.join("exports")
    }

    pub fn backend_dir(&self) -> PathBuf {
        self.data_dir.join(BACKEND_WORKSPACE)
    }

    pub fn capabilities_path(&self) -> PathBuf {
        self.backend_dir().join("capabilities.json")
    }

    pub fn runtime_state_path(&self) -> PathBuf {
        self.backend_dir().join("runtime-state.json")
    }

    pub fn agent_registry_path(&self) -> PathBuf {
        self.backend_dir().join("agent-registry.json")
    }

    pub fn events_path(&self) -> PathBuf {
        self.backend_dir().join("events.jsonl")
    }

    pub fn upload_queue_dir(&self) -> PathBuf {
        upload_queue::queue_dir(&self.backend_dir())
    }

    pub fn upload_queue_events_path(&self) -> PathBuf {
        upload_queue::events_path(&self.upload_queue_dir())
    }

    pub fn server_events_state_path(&self) -> PathBuf {
        self.backend_dir().join("server-events-state.json")
    }

    pub fn rpc_path(&self) -> PathBuf {
        self.backend_dir().join("rpc.json")
    }

    pub fn shutdown_path(&self) -> PathBuf {
        self.backend_dir().join("shutdown.flag")
    }

    pub fn mail_import_state_path(&self) -> PathBuf {
        self.backend_dir().join("mail-import-state.json")
    }

    pub fn macos_mail_tool_path(&self) -> PathBuf {
        self.backend_dir().join("pact-macos-mail-tool")
    }

    pub fn command_inbox_dir(&self) -> PathBuf {
        self.backend_dir().join("commands").join("inbox")
    }

    pub fn context_dir(&self) -> PathBuf {
        self.data_dir.join("context")
    }

    pub fn context_compaction_records_path(&self) -> PathBuf {
        self.context_dir().join("compaction-records.jsonl")
    }

    pub fn context_compaction_boundaries_path(&self) -> PathBuf {
        self.context_dir().join("compaction-boundaries.jsonl")
    }

    pub fn context_session_memory_path(&self) -> PathBuf {
        self.context_dir().join("session-memory.jsonl")
    }

    pub fn command_processing_dir(&self) -> PathBuf {
        self.backend_dir().join("commands").join("processing")
    }

    pub fn command_done_dir(&self) -> PathBuf {
        self.backend_dir().join("commands").join("done")
    }

    pub fn command_results_dir(&self) -> PathBuf {
        self.backend_dir().join("command-results")
    }

    pub fn cancelled_tasks_dir(&self) -> PathBuf {
        self.backend_dir().join("cancelled-tasks")
    }

    pub fn mail_workspace(&self) -> PathBuf {
        self.data_dir.join(MAIL_WORKSPACE)
    }

    pub fn mail_downloads_dir(&self) -> PathBuf {
        self.mail_workspace().join("downloads")
    }

    pub fn expert_vocabulary_path(&self) -> PathBuf {
        self.mail_workspace().join("expert-vocabulary.json")
    }

    pub fn mail_index_dir(&self) -> PathBuf {
        self.mail_workspace().join("index")
    }

    pub fn docs_tsv_path(&self) -> PathBuf {
        self.mail_index_dir().join("docs.tsv")
    }

    pub fn knowledge_dir(&self) -> PathBuf {
        self.data_dir.join("knowledge")
    }

    pub fn knowledge_cache_path(&self) -> PathBuf {
        self.knowledge_dir().join("index.sqlite")
    }

    pub fn knowledge_documents_dir(&self) -> PathBuf {
        self.knowledge_dir().join("documents")
    }

    pub fn knowledge_assets_dir(&self) -> PathBuf {
        self.knowledge_dir().join("assets")
    }

    pub fn knowledge_normalized_documents_dir(&self) -> PathBuf {
        self.knowledge_dir().join("normalized-documents")
    }

    fn ensure_knowledge_workspace(&self) -> Result<()> {
        fs::create_dir_all(self.knowledge_dir())?;
        fs::create_dir_all(self.knowledge_documents_dir())?;
        fs::create_dir_all(self.knowledge_assets_dir())?;
        fs::create_dir_all(self.knowledge_normalized_documents_dir())?;
        Ok(())
    }

    fn open_knowledge_conn(&self) -> Result<Connection> {
        self.ensure_knowledge_workspace()?;
        open_knowledge_cache(&self.knowledge_cache_path())
    }

    pub fn initialize_shared_files(&self) -> Result<()> {
        let _ = fs::remove_file(self.shutdown_path());
        fs::create_dir_all(self.command_inbox_dir())?;
        fs::create_dir_all(self.command_processing_dir())?;
        fs::create_dir_all(self.command_done_dir())?;
        fs::create_dir_all(self.command_results_dir())?;
        fs::create_dir_all(self.cancelled_tasks_dir())?;
        fs::create_dir_all(self.upload_queue_dir())?;
        connectors::ensure_connector_workspace(&self.data_dir)?;
        self.recover_processing_commands()?;
        self.write_capabilities()?;
        let stats = self.mail_index_stats().unwrap_or_else(|_| MailIndexStats {
            document_count: 0,
            segment_count: 0,
            pending_count: 0,
            last_updated_at: String::new(),
            index_directory: self.mail_index_dir().to_string_lossy().to_string(),
        });
        let vocabulary = self.load_expert_vocabulary().unwrap_or_default();
        self.write_runtime_state("running", None, &stats, &vocabulary)?;
        self.append_event("backend.started", json!({ "dataDir": self.data_dir }))?;
        Ok(())
    }

    fn recover_processing_commands(&self) -> Result<()> {
        for entry in fs::read_dir(self.command_processing_dir())? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|item| item.to_str()) != Some("json") {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|item| item.to_str()) else {
                continue;
            };
            let command_id = file_name.trim_end_matches(".json");
            let target = if self.command_result_path(command_id).exists() {
                self.command_done_dir().join(file_name)
            } else {
                self.command_inbox_dir().join(file_name)
            };
            if fs::rename(&path, &target).is_err() {
                let _ = fs::remove_file(&path);
            }
        }
        Ok(())
    }

    pub fn request_shutdown(&self) -> Result<()> {
        atomic_write_text(&self.shutdown_path(), &timestamp())?;
        Ok(())
    }

    pub fn request_task_cancel(&self, task_id: &str) -> Result<()> {
        let normalized = sanitize_file_token(task_id);
        if normalized.is_empty() {
            return Err(anyhow!("taskId is required"));
        }
        fs::create_dir_all(self.cancelled_tasks_dir())?;
        atomic_write_text(
            &self
                .cancelled_tasks_dir()
                .join(format!("{}.cancel", normalized)),
            &timestamp(),
        )?;
        Ok(())
    }

    pub fn is_task_cancelled(&self, task_id: &str) -> bool {
        let normalized = sanitize_file_token(task_id);
        !normalized.is_empty()
            && self
                .cancelled_tasks_dir()
                .join(format!("{}.cancel", normalized))
                .exists()
    }

    pub fn command_result_path(&self, command_id: &str) -> PathBuf {
        self.command_results_dir()
            .join(format!("{}.json", sanitize_file_token(command_id)))
    }

    pub fn write_capabilities(&self) -> Result<ClientBackendCapabilities> {
        let capabilities = ClientBackendCapabilities::current();
        atomic_write_json(&self.capabilities_path(), &capabilities)?;
        Ok(capabilities)
    }

    pub fn write_runtime_state(
        &self,
        daemon_status: &str,
        current_task: Option<&str>,
        mail_index: &MailIndexStats,
        vocabulary: &ExpertVocabulary,
    ) -> Result<ClientBackendRuntimeState> {
        let state = ClientBackendRuntimeState {
            schema_version: BACKEND_SCHEMA_VERSION,
            protocol_version: PROTOCOL_VERSION,
            daemon_status: daemon_status.to_string(),
            current_task: current_task.unwrap_or("").to_string(),
            mail_index: mail_index.clone(),
            vocabulary: ExpertVocabularyRuntimeState {
                version: vocabulary.version,
                checksum: vocabulary.checksum.clone(),
                active_entry_count: vocabulary.active_entry_count(),
                updated_at: vocabulary.updated_at.clone(),
            },
            recent_error: String::new(),
            last_heartbeat_at: timestamp(),
            data_directory: self.data_dir.to_string_lossy().to_string(),
        };
        atomic_write_json(&self.runtime_state_path(), &state)?;
        Ok(state)
    }

    pub fn append_event(&self, event_type: &str, payload: Value) -> Result<()> {
        self.append_event_with_trace(event_type, payload, &new_client_trace_id())
    }

    pub fn append_event_with_trace(
        &self,
        event_type: &str,
        payload: Value,
        trace_id: &str,
    ) -> Result<()> {
        fs::create_dir_all(self.backend_dir())?;
        let event = ClientBackendEvent {
            schema_version: BACKEND_SCHEMA_VERSION,
            trace_id: normalize_trace_id(trace_id),
            event_type: event_type.to_string(),
            created_at: timestamp(),
            payload,
        };
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.events_path())?;
        writeln!(file, "{}", serde_json::to_string(&event)?)?;
        Ok(())
    }

    pub fn append_upload_queue_event(
        &self,
        event_type: &str,
        payload: Value,
    ) -> Result<upload_queue::UploadQueueEvent> {
        let event =
            upload_queue::append_event(&self.upload_queue_dir(), event_type, payload, timestamp())?;
        self.append_event(
            event_type,
            upload_queue::event_payload_with_metadata(&event),
        )?;
        Ok(event)
    }

    pub fn load_upload_queue_state(&self) -> Result<UploadQueueState> {
        upload_queue::load_state(&self.upload_queue_dir())
    }

    pub fn upload_queue_list(&self, params: Value) -> Result<Value> {
        let state = self.load_upload_queue_state()?;
        let include_events = params
            .get("includeEvents")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !include_events {
            return Ok(json!({ "ok": true, "state": state }));
        }
        let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0);
        let (events, next_offset) = upload_queue::read_events(&self.upload_queue_dir(), offset)?;
        Ok(json!({
            "ok": true,
            "state": state,
            "offset": offset,
            "nextOffset": next_offset,
            "events": events
        }))
    }

    pub fn upload_queue_get(&self, params: Value) -> Result<Value> {
        let task_id = required_string(&params, "taskId")?;
        self.upload_queue_task_response(&task_id)
    }

    pub fn upload_queue_enqueue(&self, params: Value) -> Result<Value> {
        let task = self.build_upload_queue_task(&params)?;
        let state = self.load_upload_queue_state()?;
        if let Some(existing) = upload_queue::task_by_id(&state, &task.task_id) {
            return Ok(json!({
                "ok": true,
                "deduplicated": true,
                "taskId": existing.task_id,
                "task": existing,
                "state": state
            }));
        }
        let task_id = task.task_id.clone();
        self.append_upload_queue_event("upload.queue.enqueued", json!({ "task": task }))?;
        let wait = params.get("wait").and_then(Value::as_bool).unwrap_or(false);
        let process = params
            .get("process")
            .or_else(|| params.get("autoStart"))
            .and_then(Value::as_bool)
            .unwrap_or(wait);
        if params
            .get("startPaused")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            self.append_upload_queue_event(
                "upload.queue.paused",
                json!({ "taskId": task_id, "reason": "start-paused" }),
            )?;
        } else if process || wait {
            let _ = self.process_upload_queue_tasks(Some(&task_id), usize::MAX)?;
        }
        let response = self.upload_queue_task_response(&task_id)?;
        if wait {
            let state = self.load_upload_queue_state()?;
            if let Some(task) = upload_queue::task_by_id(&state, &task_id) {
                match task.status.as_str() {
                    "failed" => {
                        return Err(anyhow!(
                            "{}",
                            if task.error.trim().is_empty() {
                                "upload queue task failed"
                            } else {
                                task.error.as_str()
                            }
                        ));
                    }
                    "cancelled" => return Err(anyhow!("upload queue task cancelled")),
                    "paused" => return Err(anyhow!("upload queue task paused")),
                    _ => {}
                }
            }
        }
        Ok(response)
    }

    pub fn upload_queue_pause(&self, params: Value) -> Result<Value> {
        let task_id = required_string(&params, "taskId")?;
        let reason = params
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("requested");
        self.append_upload_queue_event(
            "upload.queue.paused",
            json!({ "taskId": task_id, "reason": reason }),
        )?;
        self.upload_queue_task_response(&task_id)
    }

    pub fn upload_queue_resume(&self, params: Value) -> Result<Value> {
        let task_id = required_string(&params, "taskId")?;
        self.append_upload_queue_event("upload.queue.resumed", json!({ "taskId": task_id }))?;
        let process = params
            .get("process")
            .or_else(|| params.get("autoStart"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if process {
            let _ = self.process_upload_queue_tasks(Some(&task_id), usize::MAX)?;
        }
        self.upload_queue_task_response(&task_id)
    }

    pub fn upload_queue_retry(&self, params: Value) -> Result<Value> {
        let task_id = required_string(&params, "taskId")?;
        self.append_upload_queue_event("upload.queue.retried", json!({ "taskId": task_id }))?;
        let process = params
            .get("process")
            .or_else(|| params.get("autoStart"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if process {
            let _ = self.process_upload_queue_tasks(Some(&task_id), usize::MAX)?;
        }
        self.upload_queue_task_response(&task_id)
    }

    pub fn upload_queue_cancel(&self, params: Value) -> Result<Value> {
        let task_id = required_string(&params, "taskId")?;
        let reason = params
            .get("reason")
            .and_then(Value::as_str)
            .unwrap_or("requested");
        self.append_upload_queue_event(
            "upload.queue.cancelled",
            json!({ "taskId": task_id, "reason": reason }),
        )?;
        self.upload_queue_task_response(&task_id)
    }

    pub fn upload_queue_clear_completed(&self, params: Value) -> Result<Value> {
        let include_failed = params
            .get("includeFailed")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let state = self.load_upload_queue_state()?;
        let task_ids = state
            .tasks
            .iter()
            .filter(|task| {
                matches!(task.status.as_str(), "completed" | "cancelled")
                    || (include_failed && task.status == "failed")
            })
            .map(|task| task.task_id.clone())
            .collect::<Vec<_>>();
        self.append_upload_queue_event(
            "upload.queue.cleared",
            json!({ "taskIds": task_ids, "includeFailed": include_failed }),
        )?;
        self.upload_queue_list(json!({}))
    }

    pub fn upload_queue_process(&self, params: Value) -> Result<Value> {
        let task_id = params
            .get("taskId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        let max_tasks = params
            .get("maxTasks")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX)
            .min(10_000) as usize;
        self.process_upload_queue_tasks(task_id.as_deref(), max_tasks)
    }

    pub fn sync_server_events(&self, params: Value) -> Result<Value> {
        let config = self.load_config().unwrap_or_default();
        let base_url = params
            .get("serviceBaseUrl")
            .or_else(|| params.get("baseUrl"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| service_base_url(&config).ok())
            .ok_or_else(|| anyhow!("missing serviceBaseUrl"))?;
        let service_url = normalize_service_url(&base_url);
        let state = read_json_file(&self.server_events_state_path()).unwrap_or_else(|| json!({}));
        let cursor = params
            .get("cursor")
            .or_else(|| params.get("since"))
            .and_then(Value::as_u64)
            .or_else(|| state.get("nextCursor").and_then(Value::as_u64))
            .unwrap_or(0);
        let limit = params
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(100)
            .min(500);
        let timeout_ms = params
            .get("timeoutMs")
            .or_else(|| params.get("timeout"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(60_000);
        let include_snapshot = params
            .get("includeSnapshot")
            .or_else(|| params.get("snapshot"))
            .and_then(Value::as_bool)
            .unwrap_or(cursor == 0);
        let topics = normalize_topic_params(&params);
        let mut query = format!(
            "cursor={}&limit={}&timeoutMs={}&includeSnapshot={}",
            cursor,
            limit,
            timeout_ms,
            if include_snapshot { 1 } else { 0 }
        );
        for topic in &topics {
            query.push_str("&topic=");
            query.push_str(&url_escape(topic));
        }
        let session = console_session_for_config(&service_url, &config)?;
        let result = http_json_with_auth(
            "GET",
            &format!("{}/api/events?{}", service_url, query),
            None,
            session.as_ref(),
        )?;
        let events = result
            .get("events")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for event in &events {
            self.append_event("server.event", event.clone())?;
        }
        let next_cursor = result
            .get("nextCursor")
            .or_else(|| result.get("cursor"))
            .and_then(Value::as_u64)
            .unwrap_or(cursor);
        let synced_at = timestamp();
        let saved = json!({
            "schemaVersion": BACKEND_SCHEMA_VERSION,
            "serviceBaseUrl": service_url,
            "cursor": cursor,
            "nextCursor": next_cursor,
            "topics": topics,
            "lastEventCount": events.len(),
            "syncedAt": synced_at
        });
        atomic_write_json(&self.server_events_state_path(), &saved)?;
        self.append_event(
            "server.events.synced",
            json!({
                "serviceBaseUrl": saved["serviceBaseUrl"],
                "cursor": cursor,
                "nextCursor": next_cursor,
                "eventCount": events.len()
            }),
        )?;
        Ok(json!({
            "ok": true,
            "state": saved,
            "events": events,
            "snapshots": result.get("snapshots").cloned().unwrap_or_else(|| json!([]))
        }))
    }

    fn build_upload_queue_task(&self, params: &Value) -> Result<UploadQueueTask> {
        let config = self.load_config().unwrap_or_default();
        let service_url = params
            .get("serviceBaseUrl")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| service_base_url(&config).ok())
            .ok_or_else(|| anyhow!("missing serviceBaseUrl"))?;
        let service_url = normalize_service_url(&service_url);
        let input_text = params
            .get("inputText")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let settings = params.get("settings").cloned().unwrap_or_else(|| json!({}));
        let files = pipeline_files_from_params(params)?;
        let manifest_digest = pipeline_manifest_digest(&files)?;
        let input_digest = sha256_hex(input_text.as_bytes());
        let checkpoint_id = params
            .get("checkpointId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "client-{}",
                    &manifest_digest[..24.min(manifest_digest.len())]
                )
            });
        let task_id = params
            .get("taskId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("upload-{}", Uuid::new_v4()));
        let now = timestamp();
        Ok(UploadQueueTask {
            task_id,
            status: "queued".to_string(),
            service_base_url: service_url,
            input_text: input_text.clone(),
            settings,
            checkpoint_id,
            manifest_digest,
            input_digest,
            summary: pipeline_summary(&files, &input_text),
            files: files
                .into_iter()
                .map(|file| UploadQueueFile {
                    path: file.path.to_string_lossy().to_string(),
                    name: file.name,
                    relative_path: file.relative_path,
                    media_type: file.media_type,
                    client_uid: file.client_uid.unwrap_or_default(),
                    source_type: file.source_type.unwrap_or_default(),
                    provider_id: file.provider_id.unwrap_or_default(),
                    external_id: file.external_id.unwrap_or_default(),
                    sync_batch_id: file.sync_batch_id.unwrap_or_default(),
                    content_hash: file.content_hash.unwrap_or_default(),
                    captured_at: file.captured_at.unwrap_or_default(),
                    source_metadata: file.source_metadata,
                    sha256: file.sha256,
                    byte_size: file.byte_size,
                    status: "pending".to_string(),
                    ..UploadQueueFile::default()
                })
                .collect(),
            created_at: now.clone(),
            updated_at: now,
            job: json!({}),
            result: json!({}),
            upload_session: json!({}),
            ..UploadQueueTask::default()
        })
    }

    fn upload_queue_task_response(&self, task_id: &str) -> Result<Value> {
        let state = self.load_upload_queue_state()?;
        let task = upload_queue::task_by_id(&state, task_id)
            .ok_or_else(|| anyhow!("upload queue task not found: {}", task_id))?;
        Ok(json!({
            "ok": true,
            "taskId": task.task_id,
            "checkpointId": task.checkpoint_id,
            "manifestDigest": task.manifest_digest,
            "serviceBaseUrl": task.service_base_url,
            "task": task.clone(),
            "job": task.job.clone(),
            "result": task.result.clone(),
            "uploadSession": task.upload_session.clone(),
            "state": state
        }))
    }

    fn try_lock_upload_queue_worker(&self) -> Result<Option<std::fs::File>> {
        fs::create_dir_all(self.upload_queue_dir())?;
        let lock = OpenOptions::new()
            .create(true)
            .write(true)
            .open(self.upload_queue_dir().join("worker.lock"))?;
        match lock.try_lock_exclusive() {
            Ok(()) => Ok(Some(lock)),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn process_upload_queue_tasks(
        &self,
        target_task_id: Option<&str>,
        max_tasks: usize,
    ) -> Result<Value> {
        let Some(_lock) = self.try_lock_upload_queue_worker()? else {
            return Ok(json!({
                "ok": true,
                "processed": 0,
                "workerActive": true,
                "state": self.load_upload_queue_state()?
            }));
        };
        let mut processed = 0usize;
        let mut last_result = json!({});
        loop {
            let state = self.load_upload_queue_state()?;
            if let Some(task_id) = target_task_id {
                if let Some(task) = upload_queue::task_by_id(&state, task_id) {
                    if upload_queue::is_terminal_status(&task.status) {
                        break;
                    }
                    if task.status == "paused" || task.status == "cancelled" {
                        break;
                    }
                }
            }
            if processed >= max_tasks {
                break;
            }
            let now_epoch_ms = unix_epoch_millis();
            let next_task = if let Some(task_id) = target_task_id {
                upload_queue::processable_task_by_id(&state, task_id, now_epoch_ms)
            } else {
                upload_queue::next_processable_task(&state, now_epoch_ms)
            };
            let Some(next_task) = next_task else {
                break;
            };
            last_result = self.run_upload_queue_task(&next_task)?;
            processed += 1;
            if let Some(task_id) = target_task_id {
                let state = self.load_upload_queue_state()?;
                if let Some(task) = upload_queue::task_by_id(&state, task_id) {
                    if upload_queue::is_terminal_status(&task.status)
                        || task.status == "paused"
                        || task.status == "cancelled"
                    {
                        break;
                    }
                }
            }
        }
        let state = self.load_upload_queue_state()?;
        let task = target_task_id.and_then(|task_id| upload_queue::task_by_id(&state, task_id));
        Ok(json!({
            "ok": true,
            "processed": processed,
            "workerActive": false,
            "lastResult": last_result,
            "task": task,
            "state": state
        }))
    }

    fn run_upload_queue_task(&self, task: &UploadQueueTask) -> Result<Value> {
        let attempt = task.attempts + 1;
        self.append_upload_queue_event(
            "upload.queue.started",
            json!({ "taskId": task.task_id, "attempt": attempt }),
        )?;
        let params = json!({
            "serviceBaseUrl": task.service_base_url.clone(),
            "inputText": task.input_text.clone(),
            "files": task.files.iter().map(|file| json!({
                "path": file.path.clone(),
                "name": file.name.clone(),
                "relativePath": file.relative_path.clone(),
                "mediaType": file.media_type.clone(),
                "clientUid": file.client_uid.clone(),
                "sourceType": file.source_type.clone(),
                "providerId": file.provider_id.clone(),
                "externalId": file.external_id.clone(),
                "syncBatchId": file.sync_batch_id.clone(),
                "contentHash": file.content_hash.clone(),
                "capturedAt": file.captured_at.clone(),
                "sourceMetadata": file.source_metadata.clone()
            })).collect::<Vec<_>>(),
            "settings": task.settings.clone(),
            "checkpointId": task.checkpoint_id.clone(),
            "wait": true,
            "queueTaskId": task.task_id.clone()
        });
        match self.submit_pipeline(params, Some(&task.task_id)) {
            Ok(result) => {
                self.append_upload_queue_event(
                    "upload.queue.completed",
                    json!({
                        "taskId": task.task_id,
                        "job": result.get("job").cloned().unwrap_or_else(|| json!({})),
                        "result": result.get("result").cloned().unwrap_or_else(|| json!({})),
                        "uploadSession": result
                            .get("uploadSession")
                            .cloned()
                            .unwrap_or_else(|| json!({}))
                    }),
                )?;
                self.append_upload_queue_event(
                    "knowledge.sync.requested",
                    json!({ "taskId": task.task_id, "reason": "upload-completed" }),
                )?;
                self.append_upload_queue_event(
                    "knowledge.sync.started",
                    json!({ "taskId": task.task_id, "serviceBaseUrl": task.service_base_url }),
                )?;
                match self.sync_knowledge_cache(json!({
                    "serviceBaseUrl": task.service_base_url,
                    "scope": "mirror",
                    "pushOutbox": false
                })) {
                    Ok(sync_result) => {
                        self.append_upload_queue_event(
                            "knowledge.sync.completed",
                            json!({ "taskId": task.task_id, "result": sync_result }),
                        )?;
                    }
                    Err(error) => {
                        self.append_upload_queue_event(
                            "knowledge.sync.failed",
                            json!({ "taskId": task.task_id, "error": error.to_string() }),
                        )?;
                    }
                }
                self.upload_queue_task_response(&task.task_id)
            }
            Err(error) => {
                let state = self.load_upload_queue_state()?;
                let current = upload_queue::task_by_id(&state, &task.task_id);
                let status = current
                    .as_ref()
                    .map(|item| item.status.as_str())
                    .unwrap_or_default();
                if matches!(status, "paused" | "cancelled") {
                    return self.upload_queue_task_response(&task.task_id);
                }
                let error_text = error.to_string();
                if let Some(failure_kind) = recoverable_upload_error_kind(&error_text) {
                    let retry_delay_ms = upload_queue_retry_delay_ms(attempt);
                    let retry_after_epoch_ms = unix_epoch_millis().saturating_add(retry_delay_ms);
                    self.append_upload_queue_event(
                        "upload.queue.deferred",
                        json!({
                            "taskId": task.task_id,
                            "error": error_text,
                            "failureKind": failure_kind,
                            "attempt": attempt,
                            "retryDelayMs": retry_delay_ms,
                            "retryAfterEpochMs": retry_after_epoch_ms,
                            "retryAfterAt": timestamp_from_epoch_ms(retry_after_epoch_ms),
                            "serviceBaseUrl": task.service_base_url
                        }),
                    )?;
                } else {
                    self.append_upload_queue_event(
                        "upload.queue.failed",
                        json!({
                            "taskId": task.task_id,
                            "error": error_text,
                            "failureKind": "fatal"
                        }),
                    )?;
                }
                self.upload_queue_task_response(&task.task_id)
            }
        }
    }

    fn ensure_upload_queue_task_active(&self, task_id: &str) -> Result<()> {
        if task_id.trim().is_empty() {
            return Ok(());
        }
        let state = self.load_upload_queue_state()?;
        let Some(task) = upload_queue::task_by_id(&state, task_id) else {
            return Ok(());
        };
        match task.status.as_str() {
            "paused" => Err(anyhow!("upload queue task paused")),
            "cancelled" => Err(anyhow!("upload queue task cancelled")),
            _ => Ok(()),
        }
    }

    pub fn load_config_value(&self) -> Result<Value> {
        let path = self.settings_path();
        if !path.exists() {
            return Ok(json!({}));
        }
        let raw = fs::read_to_string(&path)?;
        if raw.trim().is_empty() {
            return Ok(json!({}));
        }
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn load_config(&self) -> Result<ClientConfig> {
        let value = self.load_config_value()?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn save_config_value(&self, value: Value) -> Result<Value> {
        atomic_write_json(&self.settings_path(), &value)?;
        self.append_event("config.saved", json!({}))?;
        Ok(value)
    }

    pub fn patch_config_value(&self, patch: Value) -> Result<Value> {
        let mut value = self.load_config_value().unwrap_or_else(|_| json!({}));
        if !value.is_object() {
            value = json!({});
        }
        merge_json_object(&mut value, &patch)?;
        self.save_config_value(value)
    }

    pub fn load_state_file(&self, name: &str) -> Result<Value> {
        let path = self.state_file_path(name)?;
        Ok(read_json_file(&path).unwrap_or_else(|| default_state_value(name)))
    }

    pub fn save_state_file(&self, name: &str, value: Value) -> Result<Value> {
        let path = self.state_file_path(name)?;
        atomic_write_json(&path, &value)?;
        self.append_event("state.saved", json!({ "name": name }))?;
        Ok(value)
    }

    pub fn clear_state_file(&self, name: &str) -> Result<Value> {
        let value = default_state_value(name);
        self.save_state_file(name, value)
    }

    pub fn tail_client_logs(&self, max_lines: usize) -> Result<Value> {
        let raw = fs::read_to_string(self.client_log_path()).unwrap_or_default();
        let mut lines = raw
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if lines.len() > max_lines {
            lines = lines.split_off(lines.len() - max_lines);
        }
        Ok(json!({ "ok": true, "lines": lines }))
    }

    pub fn append_client_log(&self, line: &str) -> Result<Value> {
        let path = self.client_log_path();
        fs::create_dir_all(path.parent().unwrap_or_else(|| Path::new(".")))?;
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        writeln!(file, "{}", line)?;
        Ok(json!({ "ok": true }))
    }

    pub fn clear_client_logs(&self) -> Result<Value> {
        atomic_write_text(&self.client_log_path(), "")?;
        Ok(json!({ "ok": true }))
    }

    pub fn collect_files(&self, roots: &[String], include_all_files: bool) -> Result<Value> {
        let mut files = Vec::new();
        for root in roots {
            let root_path = PathBuf::from(root);
            collect_files_under(&root_path, &root_path, include_all_files, &mut files)?;
        }
        Ok(json!({ "ok": true, "files": files }))
    }

    pub fn open_path(&self, path: &str, reveal: bool) -> Result<Value> {
        let target = PathBuf::from(path);
        if cfg!(target_os = "macos") {
            let mut command = Command::new("open");
            if reveal {
                command.arg("-R");
            }
            let _ = command.arg(&target).status();
        }
        Ok(json!({
            "ok": true,
            "opened": cfg!(target_os = "macos"),
            "path": target.to_string_lossy().to_string()
        }))
    }

    pub fn run_server_cli(&self, args: &[String]) -> Result<Value> {
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../server/scripts/pact.mjs");
        if !script.exists() {
            return Err(anyhow!("server CLI is missing: {}", script.display()));
        }
        let output = Command::new("node")
            .arg(script)
            .args(args)
            .env("PACT_CLIENT_DATA_DIR", &self.data_dir)
            .output()?;
        if !output.status.success() {
            return Err(anyhow!(
                "{}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let stdout = String::from_utf8(output.stdout)?;
        let value = serde_json::from_str(stdout.trim())
            .unwrap_or_else(|_| json!({ "ok": true, "stdout": stdout }));
        Ok(value)
    }

    pub fn server_api_request(&self, params: Value) -> Result<Value> {
        let config = self.load_config().unwrap_or_default();
        let base_url = params
            .get("serviceBaseUrl")
            .or_else(|| params.get("baseUrl"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| service_base_url(&config).ok())
            .ok_or_else(|| anyhow!("missing serviceBaseUrl"))?;
        let base_url = normalize_service_url(&base_url);
        let path = params
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("missing API path"))?;
        let normalized_path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };
        let method = params
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("GET")
            .to_ascii_uppercase();
        let body = params.get("body").cloned();
        let session = if service_path_requires_console_auth(&normalized_path) {
            console_session_for_config(&base_url, &config)?
        } else {
            None
        };
        http_json_with_auth(
            &method,
            &format!("{}{}", base_url, normalized_path),
            body,
            session.as_ref(),
        )
    }

    pub fn knowledge_cache_stats(&self) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        knowledge_cache_stats_from_conn(&conn, &self.knowledge_cache_path(), self)
    }

    pub fn apply_knowledge_sync_payload(&self, payload: &Value) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        apply_knowledge_sync_payload(&conn, payload, self)?;
        knowledge_cache_stats_from_conn(&conn, &self.knowledge_cache_path(), self)
    }

    pub fn sync_knowledge_cache(&self, params: Value) -> Result<Value> {
        let config = self.load_config().unwrap_or_default();
        let base_url = params
            .get("serviceBaseUrl")
            .or_else(|| params.get("baseUrl"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| service_base_url(&config).ok())
            .ok_or_else(|| anyhow!("missing serviceBaseUrl"))?;
        let service_url = normalize_service_url(&base_url);
        let conn = self.open_knowledge_conn()?;
        let since = match params.get("since").and_then(Value::as_str) {
            Some(value) => value.to_string(),
            None => knowledge_meta_get(&conn, "serverCursor")?.unwrap_or_else(|| "0".to_string()),
        };
        let scope = params
            .get("scope")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("mirror");
        let session = console_session_for_config(&service_url, &config)?;
        self.append_event(
            "knowledge.sync.started",
            json!({ "serviceBaseUrl": service_url, "since": since, "scope": scope }),
        )?;
        let pull = http_json_with_auth(
            "GET",
            &format!(
                "{}/api/knowledge/sync?since={}&scope={}",
                service_url,
                url_escape(&since),
                url_escape(scope)
            ),
            None,
            session.as_ref(),
        )?;
        apply_knowledge_sync_payload(&conn, &pull, self)?;
        download_missing_knowledge_assets(&conn, self, &service_url, session.as_ref())?;
        download_missing_normalized_documents(&conn, self, &service_url, session.as_ref())?;

        let push_outbox = params
            .get("pushOutbox")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mut push_result = json!({ "skipped": true });
        if push_outbox {
            let changes = pending_knowledge_outbox(&conn)?;
            if !changes.is_empty() {
                push_result = http_json_with_auth(
                    "POST",
                    &format!("{}/api/knowledge/changes", service_url),
                    Some(json!({ "changes": changes })),
                    session.as_ref(),
                )?;
                apply_knowledge_push_result(&conn, &push_result)?;
            } else {
                push_result = json!({ "skipped": false, "submitted": 0 });
            }
        }

        let stats = knowledge_cache_stats_from_conn(&conn, &self.knowledge_cache_path(), self)?;
        self.append_event(
            "knowledge.sync.completed",
            json!({ "serviceBaseUrl": service_url, "scope": scope, "stats": stats }),
        )?;
        Ok(json!({
            "ok": true,
            "pull": pull,
            "push": push_result,
            "stats": stats
        }))
    }

    pub fn queue_knowledge_change(&self, params: Value) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        queue_knowledge_change(&conn, &self.load_config().unwrap_or_default(), &params)
    }

    pub fn list_pending_knowledge_changes(&self) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        Ok(json!({
            "ok": true,
            "items": pending_knowledge_outbox(&conn)?
        }))
    }

    pub fn search_knowledge_cache(&self, params: Value) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        let query = params
            .get("query")
            .or_else(|| params.get("q"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let limit = params
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(20)
            .min(200);
        search_knowledge_cache(&conn, query, limit as usize)
    }

    pub fn list_data_connectors(&self) -> Result<Value> {
        connectors::list_connectors(&self.data_dir)
    }

    pub fn install_data_connector(&self, params: Value) -> Result<Value> {
        let result = connectors::install_connector(&self.data_dir, params)?;
        self.append_event("connectors.installed", result.clone())?;
        Ok(result)
    }

    pub fn enable_data_connector(&self, params: Value) -> Result<Value> {
        let result = connectors::enable_connector(&self.data_dir, params)?;
        self.append_event("connectors.enabled", result.clone())?;
        Ok(result)
    }

    pub fn disable_data_connector(&self, params: Value) -> Result<Value> {
        let result = connectors::disable_connector(&self.data_dir, params)?;
        self.append_event("connectors.disabled", result.clone())?;
        Ok(result)
    }

    pub fn uninstall_data_connector(&self, params: Value) -> Result<Value> {
        let result = connectors::uninstall_connector(&self.data_dir, params)?;
        self.append_event("connectors.uninstalled", result.clone())?;
        Ok(result)
    }

    pub fn start_data_connector_auth(&self, params: Value) -> Result<Value> {
        let result = connectors::start_connector_auth(&self.data_dir, params)?;
        self.append_event("connectors.auth.started", result.clone())?;
        Ok(result)
    }

    pub fn data_connector_auth_status(&self, params: Value) -> Result<Value> {
        connectors::connector_auth_status(&self.data_dir, params)
    }

    pub fn revoke_data_connector_auth(&self, params: Value) -> Result<Value> {
        let result = connectors::revoke_connector_auth(&self.data_dir, params)?;
        self.append_event("connectors.auth.revoked", result.clone())?;
        Ok(result)
    }

    pub fn sync_data_connector(&self, params: Value) -> Result<Value> {
        let result = connectors::sync_connector(&self.data_dir, params)?;
        self.append_event("connectors.sync.completed", result.clone())?;
        Ok(result)
    }

    pub fn data_connector_health(&self, params: Value) -> Result<Value> {
        connectors::connector_health(&self.data_dir, params)
    }

    pub fn query_local_data_connectors(&self, params: Value) -> Result<Value> {
        connectors::query_local_sources(&self.data_dir, params)
    }

    pub fn knowledge_cache_graph(&self, params: Value) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        let seed = params
            .get("seed")
            .or_else(|| params.get("itemId"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let depth = params
            .get("depth")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .min(3);
        let limit = params
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(120)
            .min(500);
        knowledge_cache_graph(&conn, seed, depth as usize, limit as usize)
    }

    pub fn get_knowledge_document(&self, params: Value) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        let document_id = params
            .get("documentId")
            .or_else(|| params.get("itemId"))
            .or_else(|| params.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        if document_id.trim().is_empty() {
            return Err(anyhow!("documentId is required"));
        }
        let rendered = render_cached_document(&conn, self, document_id)?;
        let markdown_path = rendered
            .get("markdownPath")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let markdown = if markdown_path.is_empty() {
            String::new()
        } else {
            fs::read_to_string(markdown_path).unwrap_or_default()
        };
        Ok(json!({
            "ok": rendered.get("ok").and_then(Value::as_bool).unwrap_or(false),
            "documentId": document_id,
            "markdownPath": markdown_path,
            "jsonPath": rendered.get("jsonPath").cloned().unwrap_or_else(|| json!("")),
            "markdown": markdown
        }))
    }

    pub fn open_knowledge_document(&self, params: Value) -> Result<Value> {
        let document = self.get_knowledge_document(params)?;
        let markdown_path = document
            .get("markdownPath")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if markdown_path.trim().is_empty() {
            return Err(anyhow!("knowledge document has no local Markdown path"));
        }
        self.open_path(markdown_path, false)
    }

    pub fn export_knowledge(&self, params: Value) -> Result<Value> {
        let conn = self.open_knowledge_conn()?;
        let export_dir = self.exports_dir().join("knowledge");
        fs::create_dir_all(&export_dir)?;
        let document_id = params
            .get("documentId")
            .or_else(|| params.get("itemId"))
            .or_else(|| params.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let targets = if document_id.trim().is_empty() {
            let mut stmt = conn.prepare(
                "SELECT document_id FROM knowledge_documents ORDER BY server_updated_at DESC, document_id ASC",
            )?;
            stmt.query_map([], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            vec![document_id]
        };
        let mut exported = Vec::new();
        for target_id in targets {
            let rendered = render_cached_document(&conn, self, &target_id)?;
            let markdown_path = rendered
                .get("markdownPath")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if markdown_path.trim().is_empty() || !Path::new(markdown_path).exists() {
                continue;
            }
            let name = Path::new(markdown_path)
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or("knowledge.md");
            let target = export_dir.join(name);
            fs::copy(markdown_path, &target)?;
            exported.push(json!({
                "documentId": target_id,
                "path": target.to_string_lossy().to_string()
            }));
        }
        Ok(json!({
            "ok": true,
            "exportDirectory": export_dir.to_string_lossy().to_string(),
            "items": exported
        }))
    }

    pub fn knowledge_agent_context(&self, params: Value) -> Result<Value> {
        let query = params
            .get("query")
            .or_else(|| params.get("q"))
            .or_else(|| params.get("question"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let limit = params
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(8)
            .min(32);
        let search = self.search_knowledge_cache(json!({ "query": query, "limit": limit }))?;
        let mut citations = Vec::new();
        let mut context = String::new();
        for item in search
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let document_id = item
                .get("documentId")
                .or_else(|| item.get("itemId"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if document_id.is_empty() {
                continue;
            }
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("知识文档");
            let snippet = item
                .get("snippet")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let path = item
                .get("localMarkdownPath")
                .and_then(Value::as_str)
                .unwrap_or_default();
            context.push_str(&format!(
                "## {}\n\n{}\n\n来源: {}\n\n",
                title,
                snippet,
                if path.is_empty() {
                    document_id.as_str()
                } else {
                    path
                }
            ));
            citations.push(json!({
                "documentId": document_id,
                "title": title,
                "snippet": snippet,
                "localMarkdownPath": path
            }));
        }
        Ok(json!({
            "ok": true,
            "query": query,
            "contextMarkdown": context,
            "citations": citations,
            "search": search
        }))
    }

    pub fn context_compaction_preview(&self, params: Value) -> Result<Value> {
        self.context_compaction_run_with_persistence(params, false)
    }

    pub fn context_compaction_run(&self, params: Value) -> Result<Value> {
        self.context_compaction_run_with_persistence(params, true)
    }

    fn context_compaction_run_with_persistence(
        &self,
        params: Value,
        default_persist: bool,
    ) -> Result<Value> {
        let session_id = params
            .get("sessionId")
            .or_else(|| params.get("session_id"))
            .and_then(Value::as_str)
            .unwrap_or("client")
            .to_string();
        let persist = params
            .get("persist")
            .and_then(Value::as_bool)
            .unwrap_or(default_persist);
        let force = params
            .get("force")
            .and_then(Value::as_bool)
            .unwrap_or(default_persist);
        let messages = client_context_messages(&params);
        let source_tokens = estimate_client_context_tokens(&messages);
        let threshold_tokens = params
            .get("autoThresholdTokens")
            .and_then(Value::as_u64)
            .unwrap_or(12_000) as usize;
        if !force && source_tokens < threshold_tokens {
            return Ok(json!({
                "protocolVersion": "pact.context.compaction.v1",
                "status": "skipped",
                "compacted": false,
                "sessionId": session_id,
                "triggerReason": "within_budget",
                "tokenReport": {
                    "sourceTokens": source_tokens,
                    "autoCompactThresholdTokens": threshold_tokens
                }
            }));
        }
        let protected_tail = params
            .get("recentMessageProtectionCount")
            .and_then(Value::as_u64)
            .unwrap_or(1) as usize;
        let cut_index = messages
            .len()
            .saturating_sub(protected_tail.min(messages.len()));
        let compacted_messages = &messages[..cut_index];
        let kept_messages = &messages[cut_index..];
        let summary = client_context_summary(compacted_messages, &params);
        let summary_tokens = estimate_client_text_tokens(&summary);
        let kept_tokens = estimate_client_context_tokens(kept_messages);
        let boundary_id = format!("client_context_boundary_{}", Uuid::new_v4());
        let record_id = format!("client_context_compaction_{}", Uuid::new_v4());
        let token_report = json!({
            "sourceTokens": source_tokens,
            "summaryTokens": summary_tokens,
            "keptTokens": kept_tokens,
            "finalTokens": summary_tokens + kept_tokens,
            "savedTokens": source_tokens.saturating_sub(summary_tokens + kept_tokens)
        });
        let boundary = json!({
            "type": "compact_boundary",
            "boundaryId": &boundary_id,
            "sessionId": &session_id,
            "lastOriginalMessageId": compacted_messages
                .last()
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or_default(),
            "preservedTailCount": kept_messages.len(),
            "summaryChecksum": sha256_hex(summary.as_bytes()),
            "tokenReport": token_report.clone(),
            "strategy": "deterministic-extractive",
            "createdAt": timestamp()
        });
        let result = json!({
            "protocolVersion": "pact.context.compaction.v1",
            "recordId": &record_id,
            "status": "completed",
            "source": params.get("inputSource").and_then(Value::as_str).unwrap_or("client-backend"),
            "sessionId": &session_id,
            "compacted": true,
            "strategy": "deterministic-extractive",
            "boundary": boundary.clone(),
            "summary": &summary,
            "messagesToKeep": kept_messages,
            "tokenReport": token_report.clone(),
            "createdAt": timestamp()
        });
        if persist {
            append_jsonl_value(
                &self.context_compaction_records_path(),
                &json!({
                    "protocolVersion": "pact.context.compaction.v1",
                    "recordId": &record_id,
                    "boundaryId": &boundary_id,
                    "sessionId": &session_id,
                    "status": "completed",
                    "strategy": "deterministic-extractive",
                    "tokenReport": token_report.clone(),
                    "createdAt": timestamp()
                }),
            )?;
            append_jsonl_value(&self.context_compaction_boundaries_path(), &boundary)?;
            append_jsonl_value(
                &self.context_session_memory_path(),
                &json!({
                    "protocolVersion": "pact.context.compaction.v1",
                    "memoryId": format!("client_context_memory_{}", Uuid::new_v4()),
                    "sessionId": &session_id,
                    "boundaryId": &boundary_id,
                    "summaryChecksum": sha256_hex(summary.as_bytes()),
                    "summary": &summary,
                    "createdAt": timestamp(),
                    "status": "active"
                }),
            )?;
            self.append_event(
                "context.compaction.completed",
                json!({
                    "recordId": &record_id,
                    "boundaryId": &boundary_id,
                    "sessionId": &session_id
                }),
            )?;
        }
        Ok(result)
    }

    pub fn context_compaction_records(&self, params: Value) -> Result<Value> {
        let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
        Ok(json!({
            "protocolVersion": "pact.context.compaction.v1",
            "records": read_jsonl_tail(&self.context_compaction_records_path(), limit)?
        }))
    }

    pub fn context_session_memory_get(&self, params: Value) -> Result<Value> {
        let limit = params.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
        let session_id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let records = read_jsonl_tail(&self.context_session_memory_path(), limit)?
            .into_iter()
            .filter(|item| {
                session_id.is_empty()
                    || item
                        .get("sessionId")
                        .and_then(Value::as_str)
                        .map(|value| value == session_id)
                        .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "protocolVersion": "pact.context.compaction.v1",
            "records": records
        }))
    }

    pub fn context_session_memory_clear(&self, params: Value) -> Result<Value> {
        let session_id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let record = json!({
            "protocolVersion": "pact.context.compaction.v1",
            "memoryId": format!("client_context_memory_clear_{}", Uuid::new_v4()),
            "sessionId": session_id,
            "status": "cleared",
            "reason": params.get("reason").and_then(Value::as_str).unwrap_or("manual_clear"),
            "createdAt": timestamp()
        });
        append_jsonl_value(&self.context_session_memory_path(), &record)?;
        self.append_event(
            "context.session_memory.cleared",
            json!({ "sessionId": session_id }),
        )?;
        Ok(json!({
            "protocolVersion": "pact.context.compaction.v1",
            "ok": true,
            "record": record
        }))
    }

    pub fn sync_agent_registry(&self, params: Value) -> Result<Value> {
        let config = self.load_config().unwrap_or_default();
        let service_url = params
            .get("serviceBaseUrl")
            .and_then(Value::as_str)
            .map(normalize_service_url)
            .or_else(|| service_base_url(&config).ok())
            .ok_or_else(|| anyhow!("missing serviceBaseUrl"))?;
        let session = console_session_for_config(&service_url, &config)?;
        let registry = http_json_with_auth(
            "GET",
            &format!("{}/api/agents", service_url),
            None,
            session.as_ref(),
        )?;
        let synced_at = timestamp();
        let payload = json!({
            "schemaVersion": 1,
            "syncedAt": synced_at,
            "serviceBaseUrl": service_url,
            "registry": registry
        });
        atomic_write_json(&self.agent_registry_path(), &payload)?;
        self.append_event(
            "agents.registry.synced",
            json!({
                "serviceBaseUrl": payload["serviceBaseUrl"],
                "agentCount": payload
                    .pointer("/registry/agents")
                    .and_then(Value::as_array)
                    .map(|items| items.len())
                    .unwrap_or(0)
            }),
        )?;
        Ok(payload)
    }

    pub fn list_agent_registry(&self) -> Result<Value> {
        let config_value = self.load_config_value().unwrap_or_else(|_| json!({}));
        let local = local_agent_registry(&config_value);
        let synced = read_json_file(&self.agent_registry_path()).unwrap_or_else(|| json!({}));
        let server_agents = synced
            .pointer("/registry/agents")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(json!({
            "ok": true,
            "local": local,
            "server": synced,
            "agents": merge_agent_lists(
                local.get("agents").and_then(Value::as_array).cloned().unwrap_or_default(),
                server_agents
            )
        }))
    }

    pub fn submit_pipeline(&self, params: Value, task_id: Option<&str>) -> Result<Value> {
        let config = self.load_config().unwrap_or_default();
        let service_url = params
            .get("serviceBaseUrl")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| service_base_url(&config).ok())
            .ok_or_else(|| anyhow!("missing serviceBaseUrl"))?;
        let service_url = normalize_service_url(&service_url);
        let auth_session = console_session_for_config(&service_url, &config)?;
        let input_text = params
            .get("inputText")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let settings = params.get("settings").cloned().unwrap_or_else(|| json!({}));
        let wait = params.get("wait").and_then(Value::as_bool).unwrap_or(true);
        let queue_task_id = params
            .get("queueTaskId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.ensure_upload_queue_task_active(&queue_task_id)?;
        let files = pipeline_files_from_params(&params)?;
        let manifest_digest = pipeline_manifest_digest(&files)?;
        let input_digest = sha256_hex(input_text.as_bytes());
        let checkpoint_id = params
            .get("checkpointId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "client-{}",
                    &manifest_digest[..24.min(manifest_digest.len())]
                )
            });
        let client_batch_id = params
            .get("batchId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                params
                    .get("clientBatchId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                params
                    .get("archiveBatchId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
            })
            .unwrap_or(&checkpoint_id)
            .to_string();
        let client_uid = params
            .get("clientUid")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                params
                    .get("clientId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
            })
            .unwrap_or(config.client_id.as_str())
            .to_string();
        let source_type = params
            .get("sourceType")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                params
                    .get("resourceType")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
            })
            .unwrap_or("upload")
            .to_string();
        let provider_id = string_param(&params, &["providerId"]).unwrap_or_default();
        let external_id = string_param(&params, &["externalId"]).unwrap_or_default();
        let sync_batch_id = string_param(&params, &["syncBatchId", "clientBatchId", "batchId"])
            .unwrap_or_else(|| client_batch_id.clone());
        let content_hash = string_param(&params, &["contentHash"]).unwrap_or_default();
        let captured_at = string_param(&params, &["capturedAt"]).unwrap_or_default();
        let checkpoint = json!({
            "checkpointId": checkpoint_id,
            "clientBatchId": client_batch_id,
            "clientUid": client_uid.clone(),
            "sourceType": source_type.clone(),
            "providerId": provider_id.clone(),
            "externalId": external_id.clone(),
            "syncBatchId": sync_batch_id.clone(),
            "contentHash": content_hash.clone(),
            "capturedAt": captured_at.clone(),
            "mode": "pact-client-backend"
        });
        let manifest = json!({
            "inputDigest": input_digest,
            "manifestDigest": manifest_digest,
            "clientUid": client_uid.clone(),
            "sourceType": source_type.clone(),
            "providerId": provider_id.clone(),
            "externalId": external_id.clone(),
            "syncBatchId": sync_batch_id.clone(),
            "contentHash": content_hash.clone(),
            "capturedAt": captured_at.clone(),
            "fileCount": files.len(),
            "fileRecords": files.iter().map(|file| json!({
                "label": file.name,
                "relativePath": file.relative_path,
                "clientUid": file.client_uid.clone().unwrap_or_else(|| client_uid.clone()),
                "sourceType": file.source_type.clone().unwrap_or_else(|| source_type.clone()),
                "providerId": file.provider_id.clone().unwrap_or_else(|| provider_id.clone()),
                "externalId": file.external_id.clone().unwrap_or_else(|| external_id.clone()),
                "syncBatchId": file.sync_batch_id.clone().unwrap_or_else(|| sync_batch_id.clone()),
                "contentHash": file.content_hash.clone().unwrap_or_else(|| content_hash.clone()),
                "capturedAt": file.captured_at.clone().unwrap_or_else(|| captured_at.clone()),
                "sourceMetadata": file.source_metadata.clone(),
                "sha256": file.sha256,
                "byteSize": file.byte_size
            })).collect::<Vec<_>>(),
            "summary": pipeline_summary(&files, &input_text)
        });
        self.append_event(
            "pipeline.submit.started",
            json!({ "checkpointId": checkpoint_id, "fileCount": files.len() }),
        )?;
        let mut upload_session = http_json_with_auth(
            "POST",
            &format!("{}/api/upload-sessions", service_url),
            Some(json!({
                "checkpoint": checkpoint.clone(),
                "manifest": manifest,
                "files": files.iter().map(|file| json!({
                "name": file.name,
                "relativePath": file.relative_path,
                "originalFileName": file.name,
                    "clientUid": file.client_uid.clone().unwrap_or_else(|| client_uid.clone()),
                    "sourceType": file.source_type.clone().unwrap_or_else(|| source_type.clone()),
                    "providerId": file.provider_id.clone().unwrap_or_else(|| provider_id.clone()),
                    "externalId": file.external_id.clone().unwrap_or_else(|| external_id.clone()),
                    "syncBatchId": file.sync_batch_id.clone().unwrap_or_else(|| sync_batch_id.clone()),
                    "contentHash": file.content_hash.clone().unwrap_or_else(|| content_hash.clone()),
                    "capturedAt": file.captured_at.clone().unwrap_or_else(|| captured_at.clone()),
                    "sourceMetadata": file.source_metadata.clone(),
                    "mediaType": file.media_type,
                    "sha256": file.sha256,
                    "byteSize": file.byte_size
                })).collect::<Vec<_>>()
            })),
            auth_session.as_ref(),
        )?;
        let session_id = upload_session
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("server did not return upload session id"))?
            .to_string();
        let archive_batch_id = upload_session
            .get("archiveBatchId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !queue_task_id.is_empty() {
            self.append_upload_queue_event(
                "upload.queue.session.created",
                json!({ "taskId": queue_task_id, "session": upload_session }),
            )?;
        }
        for (fallback_index, file) in files.iter().enumerate() {
            if let Some(task_id) = task_id {
                if self.is_task_cancelled(task_id) {
                    return Err(anyhow!("task cancelled"));
                }
            }
            self.ensure_upload_queue_task_active(&queue_task_id)?;
            if !queue_task_id.is_empty() {
                self.append_upload_queue_event(
                    "upload.queue.file.started",
                    json!({
                        "taskId": queue_task_id,
                        "relativePath": file.relative_path
                    }),
                )?;
            }
            let remote = find_upload_session_file(&upload_session, file, fallback_index)
                .ok_or_else(|| anyhow!("upload session is missing {}", file.relative_path))?;
            let file_index = remote
                .get("index")
                .and_then(Value::as_u64)
                .ok_or_else(|| anyhow!("upload session file has no index"))?;
            let mut offset = remote
                .get("receivedBytes")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            while offset < file.byte_size {
                if let Some(task_id) = task_id {
                    if self.is_task_cancelled(task_id) {
                        return Err(anyhow!("task cancelled"));
                    }
                }
                self.ensure_upload_queue_task_active(&queue_task_id)?;
                let chunk = read_file_chunk(&file.path, offset, 1024 * 1024)?;
                if chunk.is_empty() {
                    break;
                }
                let chunk_response = http_checkpoint_chunk_with_auth(
                    &format!(
                        "{}/api/upload-sessions/{}/files/{}?offset={}",
                        service_url, session_id, file_index, offset
                    ),
                    &chunk,
                    auth_session.as_ref(),
                )?;
                if let Some(code) = chunk_response.get("code").and_then(Value::as_str) {
                    match code {
                        "offset_mismatch" | "chunk_too_large" | "sha256_mismatch" => {
                            if let Some(remote_session) = chunk_response.get("session") {
                                upload_session = remote_session.clone();
                            }
                            offset = chunk_response
                                .get("expectedOffset")
                                .and_then(Value::as_u64)
                                .or_else(|| {
                                    find_upload_session_file(&upload_session, file, fallback_index)
                                        .and_then(|remote| {
                                            remote.get("receivedBytes").and_then(Value::as_u64)
                                        })
                                })
                                .unwrap_or(0);
                            self.append_event(
                                "pipeline.upload.realigned",
                                json!({
                                    "sessionId": session_id,
                                    "relativePath": file.relative_path,
                                    "code": code,
                                    "expectedOffset": offset
                                }),
                            )?;
                            if !queue_task_id.is_empty() {
                                self.append_upload_queue_event(
                                    "upload.queue.session.realigned",
                                    json!({
                                        "taskId": queue_task_id,
                                        "sessionId": session_id,
                                        "session": upload_session,
                                        "relativePath": file.relative_path,
                                        "code": code,
                                        "expectedOffset": offset
                                    }),
                                )?;
                            }
                            continue;
                        }
                        _ => {
                            return Err(anyhow!(
                                "upload chunk rejected: {}",
                                chunk_response
                                    .get("error")
                                    .and_then(Value::as_str)
                                    .unwrap_or(code)
                            ));
                        }
                    }
                }
                upload_session = chunk_response;
                let remote = find_upload_session_file(&upload_session, file, fallback_index)
                    .ok_or_else(|| anyhow!("upload session lost {}", file.relative_path))?;
                offset = remote
                    .get("receivedBytes")
                    .and_then(Value::as_u64)
                    .unwrap_or(offset + chunk.len() as u64);
                self.append_event(
                    "pipeline.upload.progress",
                    json!({
                        "sessionId": session_id,
                        "relativePath": file.relative_path,
                        "receivedBytes": offset,
                    "byteSize": file.byte_size
                    }),
                )?;
                if !queue_task_id.is_empty() {
                    self.append_upload_queue_event(
                        "upload.queue.file.progress",
                        json!({
                            "taskId": queue_task_id,
                            "sessionId": session_id,
                            "relativePath": file.relative_path,
                            "receivedBytes": offset,
                            "byteSize": file.byte_size
                        }),
                    )?;
                }
            }
        }
        self.ensure_upload_queue_task_active(&queue_task_id)?;
        let job = http_json_with_auth(
            "POST",
            &format!("{}/api/jobs", service_url),
            Some(json!({
                "inputText": input_text,
                "filePaths": [],
                "uploadedFiles": [],
                "uploadSessionId": session_id,
                "archiveBatchId": archive_batch_id,
                "clientUid": client_uid.clone(),
                "sourceType": source_type.clone(),
                "providerId": provider_id.clone(),
                "externalId": external_id.clone(),
                "syncBatchId": sync_batch_id.clone(),
                "contentHash": content_hash.clone(),
                "capturedAt": captured_at.clone(),
                "checkpoint": checkpoint.clone(),
                "settings": settings
            })),
            auth_session.as_ref(),
        )?;
        let job_id = job
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if !queue_task_id.is_empty() {
            self.append_upload_queue_event(
                "upload.queue.job.created",
                json!({ "taskId": queue_task_id, "job": job }),
            )?;
        }
        if !wait {
            return Ok(json!({
                "ok": true,
                "job": job,
                "uploadSession": upload_session,
                "checkpointId": checkpoint_id,
                "archiveBatchId": archive_batch_id,
                "serviceBaseUrl": service_url
            }));
        }
        let final_job = self.wait_for_server_job(
            &service_url,
            &job_id,
            task_id,
            &queue_task_id,
            auth_session.as_ref(),
        )?;
        let result = http_json_with_auth(
            "GET",
            &format!("{}/api/jobs/{}/result", service_url, job_id),
            None,
            auth_session.as_ref(),
        )?;
        self.append_event(
            "pipeline.submit.completed",
            json!({ "checkpointId": checkpoint_id, "jobId": job_id }),
        )?;
        if !queue_task_id.is_empty() {
            self.append_upload_queue_event(
                "upload.queue.job.completed",
                json!({
                    "taskId": queue_task_id,
                    "job": final_job,
                    "result": result,
                    "uploadSession": upload_session
                }),
            )?;
        }
        Ok(json!({
            "ok": true,
            "job": final_job,
            "result": result,
            "uploadSession": upload_session,
            "checkpointId": checkpoint_id,
            "archiveBatchId": archive_batch_id,
            "serviceBaseUrl": service_url,
            "manifestDigest": manifest_digest
        }))
    }

    fn wait_for_server_job(
        &self,
        service_url: &str,
        job_id: &str,
        task_id: Option<&str>,
        queue_task_id: &str,
        session: Option<&ConsoleServiceSession>,
    ) -> Result<Value> {
        loop {
            if let Some(task_id) = task_id {
                if self.is_task_cancelled(task_id) {
                    return Err(anyhow!("task cancelled"));
                }
            }
            self.ensure_upload_queue_task_active(queue_task_id)?;
            let job = http_json_with_auth(
                "GET",
                &format!("{}/api/jobs/{}", service_url, job_id),
                None,
                session,
            )?;
            let status = job
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            self.append_event(
                "pipeline.job.status",
                json!({
                    "jobId": job_id,
                    "status": status,
                    "progressPercent": job.get("progressPercent").cloned().unwrap_or(json!(0)),
                    "stage": job.get("stage").cloned().unwrap_or(json!(""))
                }),
            )?;
            match status {
                "completed" => return Ok(job),
                "failed" | "cancelled" | "deleted" => {
                    let message = job
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("job did not complete");
                    return Err(anyhow!("{}", message));
                }
                _ => thread::sleep(Duration::from_millis(1500)),
            }
        }
    }

    pub fn export_result_artifact(&self, params: Value) -> Result<Value> {
        let config = self.load_config().unwrap_or_default();
        let service_url = params
            .get("serviceBaseUrl")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| service_base_url(&config).ok())
            .ok_or_else(|| anyhow!("missing serviceBaseUrl"))?;
        let service_url = normalize_service_url(&service_url);
        let format = params
            .get("format")
            .and_then(Value::as_str)
            .unwrap_or("json");
        let result = params
            .get("result")
            .cloned()
            .ok_or_else(|| anyhow!("missing result"))?;
        let mode = params
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut body = json!({ "format": format, "result": result });
        if !mode.is_empty() {
            if let Some(object) = body.as_object_mut() {
                object.insert("mode".to_string(), json!(mode));
            }
        }
        let session = console_session_for_config(&service_url, &config)?;
        let response = apply_console_session_auth(
            http_binary_agent()
                .post(&format!("{}/api/export", service_url))
                .set("accept", "*/*")
                .set("content-type", "application/json"),
            "POST",
            session.as_ref(),
        )
        .send_json(body)?;
        let content_type = response
            .header("content-type")
            .unwrap_or("application/octet-stream")
            .to_string();
        let disposition = response.header("content-disposition").unwrap_or("");
        let file_name = content_disposition_filename(disposition)
            .unwrap_or_else(|| format!("pact-result.{}", format));
        let mut reader = response.into_reader();
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes)?;
        Ok(json!({
            "ok": true,
            "fileName": file_name,
            "contentType": content_type,
            "base64": base64::engine::general_purpose::STANDARD.encode(bytes)
        }))
    }

    fn state_file_path(&self, name: &str) -> Result<PathBuf> {
        match name {
            "recent-runs" | "recentRuns" => Ok(self.recent_runs_path()),
            "checkpoints" => Ok(self.checkpoints_path()),
            _ => Err(anyhow!("unknown state file: {}", name)),
        }
    }

    pub fn patch_settings_after_vocabulary_pull(
        &self,
        vocabulary: &ExpertVocabulary,
    ) -> Result<()> {
        let mut value = self.load_config_value().unwrap_or_else(|_| json!({}));
        if !value.is_object() {
            value = json!({});
        }
        let object = value.as_object_mut().expect("checked object");
        object.insert(
            "lastExpertVocabularyVersion".to_string(),
            json!(vocabulary.version),
        );
        object.insert(
            "lastExpertVocabularyChecksum".to_string(),
            json!(vocabulary.checksum),
        );
        object.insert(
            "lastExpertVocabularyPulledAt".to_string(),
            json!(timestamp()),
        );
        atomic_write_json(&self.settings_path(), &value)?;
        Ok(())
    }

    pub fn load_expert_vocabulary(&self) -> Result<ExpertVocabulary> {
        let path = self.expert_vocabulary_path();
        if !path.exists() {
            return Ok(ExpertVocabulary::default());
        }
        let raw = fs::read_to_string(&path)?;
        if raw.trim().is_empty() {
            return Ok(ExpertVocabulary::default());
        }
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn save_expert_vocabulary(&self, vocabulary: &ExpertVocabulary) -> Result<()> {
        atomic_write_json(&self.expert_vocabulary_path(), vocabulary)?;
        Ok(())
    }

    pub fn pull_vocabulary(&self) -> Result<VocabularyPullResult> {
        self.append_event("vocabulary.pull.started", json!({}))?;
        let previous = self.load_expert_vocabulary().unwrap_or_default();
        let config = self.load_config().unwrap_or_default();
        let session = service_base_url(&config)
            .ok()
            .map(|service_url| console_session_for_config(&service_url, &config))
            .transpose()?
            .flatten();
        let vocabulary = fetch_expert_vocabulary(&config, session.as_ref())?;
        let changed = vocabulary.checksum.is_empty() || vocabulary.checksum != previous.checksum;
        self.save_expert_vocabulary(&vocabulary)?;
        self.patch_settings_after_vocabulary_pull(&vocabulary)?;
        self.append_event(
            "vocabulary.pulled",
            json!({
                "version": vocabulary.version,
                "checksum": vocabulary.checksum,
                "activeEntryCount": vocabulary.active_entry_count(),
                "changed": changed
            }),
        )?;

        let apply_result = if changed {
            Some(self.apply_vocabulary_to_index()?)
        } else {
            None
        };

        let stats = self.mail_index_stats()?;
        self.write_runtime_state("running", None, &stats, &vocabulary)?;
        Ok(VocabularyPullResult {
            changed,
            vocabulary,
            apply_result,
        })
    }

    pub fn try_auto_sync_vocabulary(&self, reason: &str) -> Result<bool> {
        let config = self.load_config().unwrap_or_default();
        let policy = config.expert_vocabulary_sync_policy.to_ascii_lowercase();
        if policy != "automatic" && policy != "auto" {
            return Ok(false);
        }
        if service_base_url(&config).is_err() {
            return Ok(false);
        }
        self.append_event("vocabulary.auto-sync.started", json!({ "reason": reason }))?;
        match self.pull_vocabulary() {
            Ok(result) => {
                self.append_event(
                    "vocabulary.auto-sync.completed",
                    json!({
                        "reason": reason,
                        "changed": result.changed,
                        "version": result.vocabulary.version,
                        "checksum": result.vocabulary.checksum
                    }),
                )?;
                Ok(true)
            }
            Err(error) => {
                self.append_event(
                    "vocabulary.auto-sync.failed",
                    json!({ "reason": reason, "error": error.to_string() }),
                )?;
                Err(error)
            }
        }
    }

    pub fn apply_vocabulary_to_index(&self) -> Result<VocabularyApplyResult> {
        let vocabulary = self.load_expert_vocabulary().unwrap_or_default();
        let taxonomy_signature = vocabulary_signature(&vocabulary);
        let result = rewrite_docs_tsv_with_taxonomy(&self.docs_tsv_path(), &vocabulary)?;
        let stats = self.mail_index_stats()?;
        write_index_state(&self.mail_index_dir(), &stats, &taxonomy_signature)?;
        self.write_runtime_state("running", None, &stats, &vocabulary)?;
        self.append_event(
            "vocabulary.applied-to-index",
            json!({
                "documentCount": result.document_count,
                "updatedDocumentCount": result.updated_document_count,
                "taxonomySignature": taxonomy_signature
            }),
        )?;
        Ok(result)
    }

    pub fn mail_index_stats(&self) -> Result<MailIndexStats> {
        let docs_path = self.docs_tsv_path();
        let document_count = if docs_path.exists() {
            fs::read_to_string(&docs_path)?
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count()
        } else {
            0
        };

        let segment_count = segment_count(&self.mail_index_dir()).unwrap_or(0);
        let state_path = self.mail_index_dir().join("state.json");
        let last_updated_at = if state_path.exists() {
            read_state_last_updated_at(&state_path).unwrap_or_else(timestamp)
        } else {
            String::new()
        };

        Ok(MailIndexStats {
            document_count,
            segment_count,
            pending_count: 0,
            last_updated_at,
            index_directory: self.mail_index_dir().to_string_lossy().to_string(),
        })
    }

    pub fn rebuild_mail_index(&self) -> Result<Value> {
        let mut native_stats = None;
        if cfg!(target_os = "macos") && self.mail_downloads_dir().exists() {
            match self.run_macos_mail_tool(&[
                "rebuild".to_string(),
                self.mail_workspace().to_string_lossy().to_string(),
            ]) {
                Ok(value) => {
                    self.append_event("mail.index.rebuilt", value.clone())?;
                    native_stats = Some(value);
                }
                Err(error) => {
                    self.append_event(
                        "mail.index.rebuild-native.failed",
                        json!({ "error": error.to_string() }),
                    )?;
                }
            }
        }
        let apply_result = self.apply_vocabulary_to_index()?;
        let mut value = json!(apply_result);
        if let (Some(object), Some(native_stats)) = (value.as_object_mut(), native_stats) {
            object.insert("nativeStats".to_string(), native_stats);
        }
        Ok(value)
    }

    pub fn search_mail_index(
        &self,
        query: &str,
        limit: usize,
        offset: usize,
    ) -> Result<MailIndexSearchResponse> {
        let normalized = query.trim().to_lowercase();
        if normalized.is_empty() {
            return Ok(MailIndexSearchResponse {
                total: 0,
                results: Vec::new(),
            });
        }
        let docs_path = self.docs_tsv_path();
        if !docs_path.exists() {
            return Ok(MailIndexSearchResponse {
                total: 0,
                results: Vec::new(),
            });
        }
        let raw = fs::read_to_string(docs_path)?;
        let mut matches = Vec::new();
        for line in raw.lines() {
            if line.to_lowercase().contains(&normalized) {
                matches.push(
                    MailIndexSearchResult::from_tsv_line(line)
                        .with_downloads_dir(&self.mail_downloads_dir()),
                );
            }
        }
        let total = matches.len();
        let results = matches
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
        Ok(MailIndexSearchResponse { total, results })
    }

    pub fn request_mail_authorization(&self) -> Result<Value> {
        let value = self.run_macos_mail_tool(&["auth".to_string()])?;
        self.append_event("mail.authorization.checked", value.clone())?;
        Ok(value)
    }

    pub fn start_macos_mail_import(&self) -> Result<Value> {
        if !cfg!(target_os = "macos") {
            return Err(anyhow!("macOS Mail import is only available on macOS"));
        }
        let current = self.mail_import_status()?;
        if current
            .get("running")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(json!({
                "ok": true,
                "alreadyRunning": true,
                "status": current
            }));
        }

        let tool = self.ensure_macos_mail_tool()?;
        let workspace = self.mail_workspace();
        self.prepare_mail_import_workspace()?;
        let tmp_dir = workspace.join("tmp");
        let log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(tmp_dir.join("import-helper.log"))?;
        let stderr_file = log_file.try_clone()?;
        let mut child = Command::new(tool)
            .arg("export")
            .arg(&workspace)
            .env("PACT_PORTABLE_DIR", &self.data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()?;
        let pid = child.id();
        let state = json!({
            "schemaVersion": BACKEND_SCHEMA_VERSION,
            "protocolVersion": PROTOCOL_VERSION,
            "status": "running",
            "pid": pid,
            "workspaceDirectory": workspace,
            "startedAt": timestamp()
        });
        atomic_write_json(&self.mail_import_state_path(), &state)?;
        self.append_event(
            "mail.import.started",
            json!({ "pid": pid, "workspaceDirectory": self.mail_workspace() }),
        )?;

        let backend = self.clone();
        thread::spawn(move || {
            let status = child.wait();
            let code = status.ok().and_then(|item| item.code()).unwrap_or(-1);
            let next_state = json!({
                "schemaVersion": BACKEND_SCHEMA_VERSION,
                "protocolVersion": PROTOCOL_VERSION,
                "status": if code == 0 { "completed" } else { "failed" },
                "pid": pid,
                "exitCode": code,
                "workspaceDirectory": backend.mail_workspace(),
                "finishedAt": timestamp()
            });
            let _ = atomic_write_json(&backend.mail_import_state_path(), &next_state);
            let _ = backend.append_event(
                if code == 0 {
                    "mail.import.completed"
                } else {
                    "mail.import.failed"
                },
                json!({ "pid": pid, "exitCode": code }),
            );
        });

        self.mail_import_status()
    }

    fn prepare_mail_import_workspace(&self) -> Result<()> {
        let workspace = self.mail_workspace();
        let tmp_dir = workspace.join("tmp");
        fs::create_dir_all(&tmp_dir)?;
        fs::create_dir_all(self.mail_downloads_dir())?;
        fs::create_dir_all(self.mail_index_dir())?;
        for file_name in [
            "progress.tsv",
            "manifest.tsv",
            "index-events.tsv",
            "dedupe-requests.tsv",
        ] {
            atomic_write_text(&tmp_dir.join(file_name), "")?;
        }
        let _ = fs::remove_file(tmp_dir.join("control.pause"));
        let _ = fs::remove_file(tmp_dir.join("control.cancel"));
        let _ = fs::remove_dir_all(tmp_dir.join("sources"));
        atomic_write_json(
            &tmp_dir.join("diagnostics.json"),
            &json!({
                "workspaceDirectory": workspace.to_string_lossy().to_string(),
                "downloadsDirectory": self.mail_downloads_dir().to_string_lossy().to_string(),
                "indexDirectory": self.mail_index_dir().to_string_lossy().to_string(),
                "tmpDirectory": tmp_dir.to_string_lossy().to_string(),
                "status": "starting",
                "writtenAt": timestamp(),
            }),
        )?;
        Ok(())
    }

    pub fn mail_import_status(&self) -> Result<Value> {
        let workspace = self.mail_workspace();
        let tmp_dir = workspace.join("tmp");
        let mut state = read_json_file(&self.mail_import_state_path()).unwrap_or_else(|| json!({}));
        let pid = state.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32;
        let running = pid > 0 && process_is_running(pid);
        let latest_progress =
            read_latest_mail_progress(&tmp_dir.join("progress.tsv"), &self.mail_downloads_dir());
        let diagnostics = read_json_file(&tmp_dir.join("diagnostics.json"));
        let paused = tmp_dir.join("control.pause").exists();
        let cancel_requested = tmp_dir.join("control.cancel").exists();
        let status = if running {
            if paused {
                "paused".to_string()
            } else if cancel_requested {
                "cancelling".to_string()
            } else {
                "running".to_string()
            }
        } else {
            let stored_status = state
                .get("status")
                .and_then(Value::as_str)
                .or_else(|| {
                    latest_progress
                        .as_ref()
                        .and_then(|item| item.get("kind"))
                        .and_then(Value::as_str)
                })
                .unwrap_or("idle");
            if matches!(stored_status, "running" | "paused" | "cancelling") {
                "failed".to_string()
            } else {
                stored_status.to_string()
            }
        };
        if let Some(object) = state.as_object_mut() {
            object.insert("status".to_string(), json!(status));
            object.insert("running".to_string(), json!(running));
            object.insert("paused".to_string(), json!(paused));
            object.insert("cancelRequested".to_string(), json!(cancel_requested));
            object.insert(
                "workspaceDirectory".to_string(),
                json!(workspace.to_string_lossy().to_string()),
            );
            object.insert(
                "downloadsDirectory".to_string(),
                json!(self.mail_downloads_dir().to_string_lossy().to_string()),
            );
            object.insert(
                "tmpDirectory".to_string(),
                json!(tmp_dir.to_string_lossy().to_string()),
            );
            if let Some(progress) = latest_progress {
                object.insert("latestProgress".to_string(), progress);
            }
            if let Some(diagnostics) = diagnostics {
                object.insert("diagnostics".to_string(), diagnostics);
            }
        }
        Ok(state)
    }

    pub fn pause_macos_mail_import(&self) -> Result<Value> {
        self.write_mail_import_control("control.pause", "paused")?;
        self.append_event("mail.import.paused", json!({}))?;
        self.mail_import_status()
    }

    pub fn resume_macos_mail_import(&self) -> Result<Value> {
        let path = self.mail_workspace().join("tmp").join("control.pause");
        if path.exists() {
            fs::remove_file(path)?;
        }
        self.append_event("mail.import.resumed", json!({}))?;
        self.mail_import_status()
    }

    pub fn cancel_macos_mail_import(&self) -> Result<Value> {
        let state = read_json_file(&self.mail_import_state_path()).unwrap_or_else(|| json!({}));
        let pid = state.get("pid").and_then(Value::as_u64).unwrap_or(0) as u32;
        let pause_path = self.mail_workspace().join("tmp").join("control.pause");
        let _ = fs::remove_file(pause_path);
        self.write_mail_import_control("control.cancel", "cancelled")?;
        if pid > 0 && process_is_running(pid) {
            terminate_process(pid);
        }
        self.append_event("mail.import.cancel-requested", json!({}))?;
        self.mail_import_status()
    }

    pub fn open_mail_index_item(&self, doc_id: Option<u64>, message_key: &str) -> Result<Value> {
        let docs_path = self.docs_tsv_path();
        if !docs_path.exists() {
            return Err(anyhow!("mail index does not exist"));
        }
        let raw = fs::read_to_string(docs_path)?;
        let mut selected = None;
        for line in raw.lines() {
            let item = MailIndexSearchResult::from_tsv_line(line)
                .with_downloads_dir(&self.mail_downloads_dir());
            let id_matches = doc_id.map(|id| id == item.doc_id).unwrap_or(false);
            let key_matches = !message_key.trim().is_empty() && item.message_key == message_key;
            if id_matches || key_matches {
                selected = Some(item);
                break;
            }
        }
        let item = selected.ok_or_else(|| anyhow!("mail index item not found"))?;
        if cfg!(target_os = "macos") {
            let _ = Command::new("open").arg("-R").arg(&item.path).status();
        }
        Ok(json!({
            "opened": cfg!(target_os = "macos"),
            "path": item.path,
            "docId": item.doc_id,
            "messageKey": item.message_key
        }))
    }

    fn write_mail_import_control(&self, file_name: &str, value: &str) -> Result<()> {
        let tmp_dir = self.mail_workspace().join("tmp");
        fs::create_dir_all(&tmp_dir)?;
        atomic_write_text(&tmp_dir.join(file_name), value)?;
        Ok(())
    }

    fn run_macos_mail_tool(&self, args: &[String]) -> Result<Value> {
        let tool = self.ensure_macos_mail_tool()?;
        let output = Command::new(tool)
            .args(args)
            .env("PACT_PORTABLE_DIR", &self.data_dir)
            .output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(anyhow!(
                "{}",
                if stderr.is_empty() { stdout } else { stderr }
            ));
        }
        let raw = String::from_utf8(output.stdout)?;
        Ok(serde_json::from_str(raw.trim())?)
    }

    fn ensure_macos_mail_tool(&self) -> Result<PathBuf> {
        if !cfg!(target_os = "macos") {
            return Err(anyhow!("macOS Mail helper is only available on macOS"));
        }
        if let Ok(value) = env::var("PACT_MACOS_MAIL_TOOL_PATH") {
            let path = PathBuf::from(value.trim());
            if path.exists() {
                return Ok(path);
            }
        }
        if let Ok(exe) = env::current_exe() {
            if let Some(parent) = exe.parent() {
                let sibling = parent.join("pact-macos-mail-tool");
                if sibling.exists() {
                    return Ok(sibling);
                }
            }
        }
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../client-gui/macos/Runner/MacOSMailImporter.swift");
        if !source.exists() {
            return Err(anyhow!(
                "macOS Mail helper source is missing: {}",
                source.display()
            ));
        }
        let target = self.macos_mail_tool_path();
        let source_mtime = modified_time(&source);
        let target_mtime = modified_time(&target);
        if target.exists() && target_mtime >= source_mtime {
            return Ok(target);
        }
        fs::create_dir_all(self.backend_dir())?;
        let output = Command::new("xcrun")
            .arg("swiftc")
            .arg("-parse-as-library")
            .arg("-O")
            .arg("-o")
            .arg(&target)
            .arg(&source)
            .output()?;
        if !output.status.success() {
            return Err(anyhow!(
                "failed to build macOS Mail helper: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(target)
    }

    pub fn process_pending_commands(&self) -> Result<usize> {
        fs::create_dir_all(self.command_inbox_dir())?;
        fs::create_dir_all(self.command_processing_dir())?;
        fs::create_dir_all(self.command_done_dir())?;
        fs::create_dir_all(self.command_results_dir())?;

        let mut commands = Vec::new();
        for entry in fs::read_dir(self.command_inbox_dir())? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|item| item.to_str()) == Some("json") {
                commands.push(path);
            }
        }
        commands.sort();

        let mut processed = 0;
        for inbox_path in commands {
            let file_name = match inbox_path.file_name().and_then(|item| item.to_str()) {
                Some(value) => value.to_string(),
                None => continue,
            };
            let processing_path = self.command_processing_dir().join(&file_name);
            if fs::rename(&inbox_path, &processing_path).is_err() {
                continue;
            }
            processed += 1;
            let result = self.process_command_file(&processing_path);
            let done_path = self.command_done_dir().join(&file_name);
            let _ = fs::rename(&processing_path, done_path);
            if let Err(error) = result {
                let fallback_id = file_name.trim_end_matches(".json");
                let trace_id = new_client_trace_id();
                let command_result = BackendCommandResult::error(
                    fallback_id,
                    "unknown",
                    -32000,
                    &error.to_string(),
                    &trace_id,
                );
                let _ = atomic_write_json(&self.command_result_path(fallback_id), &command_result);
                let _ = self.append_event_with_trace(
                    "command.failed",
                    json!({ "commandId": fallback_id, "error": error.to_string() }),
                    &trace_id,
                );
            }
        }
        Ok(processed)
    }

    fn process_command_file(&self, path: &Path) -> Result<()> {
        let raw = fs::read_to_string(path)?;
        let command: BackendCommand = serde_json::from_str(&raw)?;
        let command_id = if command.command_id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            command.command_id.clone()
        };
        let trace_id = normalize_trace_id(&command.trace_id);
        let started_at = timestamp();
        self.append_event_with_trace(
            "command.started",
            json!({ "commandId": command_id, "method": command.method }),
            &trace_id,
        )?;
        let stats = self.mail_index_stats().unwrap_or_else(|_| MailIndexStats {
            document_count: 0,
            segment_count: 0,
            pending_count: 0,
            last_updated_at: String::new(),
            index_directory: self.mail_index_dir().to_string_lossy().to_string(),
        });
        let vocabulary = self.load_expert_vocabulary().unwrap_or_default();
        self.write_runtime_state("running", Some(&command.method), &stats, &vocabulary)?;

        let result = if self.is_task_cancelled(&command_id) {
            Err(anyhow!("task cancelled"))
        } else {
            self.execute_method_with_trace(
                &command.method,
                command.params.clone(),
                Some(&command_id),
                &trace_id,
                "command-inbox",
            )
        };
        let finished_at = timestamp();
        let command_result = match result {
            Ok(value) => BackendCommandResult::success(
                &command_id,
                &command.method,
                value,
                &started_at,
                &finished_at,
                &trace_id,
            ),
            Err(error) => BackendCommandResult::error_with_time(
                &command_id,
                &command.method,
                -32000,
                &error.to_string(),
                &started_at,
                &finished_at,
                &trace_id,
            ),
        };
        atomic_write_json(&self.command_result_path(&command_id), &command_result)?;
        self.append_event_with_trace(
            if command_result.error.is_some() {
                "command.failed"
            } else {
                "command.completed"
            },
            json!({
                "commandId": command_id,
                "method": command.method,
                "status": command_result.status
            }),
            &trace_id,
        )?;
        let stats = self.mail_index_stats().unwrap_or_else(|_| MailIndexStats {
            document_count: 0,
            segment_count: 0,
            pending_count: 0,
            last_updated_at: String::new(),
            index_directory: self.mail_index_dir().to_string_lossy().to_string(),
        });
        let vocabulary = self.load_expert_vocabulary().unwrap_or_default();
        self.write_runtime_state("running", None, &stats, &vocabulary)?;
        Ok(())
    }

    pub fn execute_method(
        &self,
        method: &str,
        params: Value,
        task_id: Option<&str>,
    ) -> Result<Value> {
        self.execute_method_with_trace(method, params, task_id, &new_client_trace_id(), "direct")
    }

    pub fn execute_method_with_trace(
        &self,
        method: &str,
        params: Value,
        task_id: Option<&str>,
        trace_id: &str,
        transport: &str,
    ) -> Result<Value> {
        let trace_id = normalize_trace_id(trace_id);
        let operation =
            client_operation(method).ok_or_else(|| anyhow!("unknown method: {}", method))?;
        if operation.destructive {
            return Err(anyhow!(
                "client operation is destructive and blocked: {}",
                method
            ));
        }
        let started_at = timestamp();
        let audit_enabled = operation
            .audit
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        let audit_id = if audit_enabled && !operation.read_only {
            format!("audit_{}", Uuid::new_v4())
        } else {
            String::new()
        };
        if operation
            .audit
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true)
            && !operation.read_only
        {
            self.append_event_with_trace(
                "client.operation.started",
                json!({
                    "method": method,
                    "risk": operation.risk,
                    "scope": operation.scope,
                    "auditId": audit_id,
                    "transport": transport
                }),
                &trace_id,
            )?;
        }
        let result = self.execute_method_impl(method, params, task_id);
        let finished_at = timestamp();
        if operation
            .audit
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true)
            && !operation.read_only
        {
            self.append_event_with_trace(
                if result.is_ok() {
                    "client.operation.completed"
                } else {
                    "client.operation.failed"
                },
                json!({
                    "method": method,
                    "risk": operation.risk,
                    "auditId": audit_id,
                    "transport": transport,
                    "startedAt": started_at,
                    "finishedAt": finished_at,
                    "error": result.as_ref().err().map(|error| error.to_string()).unwrap_or_default()
                }),
                &trace_id,
            )?;
        }
        result.map(|value| {
            attach_client_dispatch_metadata(
                value,
                &operation,
                &trace_id,
                "completed",
                &audit_id,
                transport,
                &started_at,
                &finished_at,
            )
        })
    }

    fn execute_method_impl(
        &self,
        method: &str,
        params: Value,
        task_id: Option<&str>,
    ) -> Result<Value> {
        if let Some(task_id) = task_id {
            if self.is_task_cancelled(task_id) {
                return Err(anyhow!("task cancelled"));
            }
        }
        match method {
            "system.ping" => Ok(json!({
                "ok": true,
                "protocolVersion": PROTOCOL_VERSION,
                "timestamp": timestamp()
            })),
            "system.capabilities" => self.write_capabilities().map(|item| json!(item)),
            "system.operations" => Ok(json!({ "operations": client_operation_registry() })),
            "config.get" => self.load_config_value(),
            "config.set" => self.save_config_value(params),
            "config.patch" => self.patch_config_value(params),
            "config.reload" => self.load_config().and_then(|config| {
                self.append_event("config.applied", json!({ "clientId": config.client_id }))?;
                Ok(json!({ "ok": true, "config": config }))
            }),
            "state.recentRuns.get" => self.load_state_file("recent-runs"),
            "state.recentRuns.set" => self.save_state_file("recent-runs", params),
            "state.recentRuns.clear" => self.clear_state_file("recent-runs"),
            "state.checkpoints.get" => self.load_state_file("checkpoints"),
            "state.checkpoints.set" => self.save_state_file("checkpoints", params),
            "state.checkpoints.clear" => self.clear_state_file("checkpoints"),
            "state.logs.tail" => {
                let max_lines = params
                    .get("maxLines")
                    .and_then(Value::as_u64)
                    .unwrap_or(2000)
                    .min(20_000) as usize;
                self.tail_client_logs(max_lines)
            }
            "state.logs.append" => {
                let line = params
                    .get("line")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.append_client_log(line)
            }
            "state.logs.clear" => self.clear_client_logs(),
            "state.exports.dir" => {
                fs::create_dir_all(self.exports_dir())?;
                Ok(json!({ "ok": true, "path": self.exports_dir() }))
            }
            "file.collect" => {
                let roots = params
                    .get("roots")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let include_all = params
                    .get("includeAllFiles")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.collect_files(&roots, include_all)
            }
            "file.open" => {
                let path = params
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let reveal = params
                    .get("reveal")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.open_path(path, reveal)
            }
            "server.cli" => {
                let args = params
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                self.run_server_cli(&args)
            }
            "server.api" => self.server_api_request(params),
            "knowledge.cache.stats" => self.knowledge_cache_stats(),
            "knowledge.status" => self.knowledge_cache_stats(),
            "knowledge.sync" => self.sync_knowledge_cache(params),
            "knowledge.search" => self.search_knowledge_cache(params),
            "knowledge.graph" => self.knowledge_cache_graph(params),
            "knowledge.document.get" => self.get_knowledge_document(params),
            "knowledge.document.open" => self.open_knowledge_document(params),
            "knowledge.export" => self.export_knowledge(params),
            "knowledge.agent.context" => self.knowledge_agent_context(params),
            "connectors.list" => self.list_data_connectors(),
            "connectors.install" => self.install_data_connector(params),
            "connectors.enable" => self.enable_data_connector(params),
            "connectors.disable" => self.disable_data_connector(params),
            "connectors.uninstall" => self.uninstall_data_connector(params),
            "connectors.auth.start" => self.start_data_connector_auth(params),
            "connectors.auth.status" => self.data_connector_auth_status(params),
            "connectors.auth.revoke" => self.revoke_data_connector_auth(params),
            "connectors.sync" => self.sync_data_connector(params),
            "connectors.health" => self.data_connector_health(params),
            "connectors.queryLocal" => self.query_local_data_connectors(params),
            "context.compaction.preview" => self.context_compaction_preview(params),
            "context.compaction.run" => self.context_compaction_run(params),
            "context.compaction.records" => self.context_compaction_records(params),
            "context.session_memory.get" => self.context_session_memory_get(params),
            "context.session_memory.clear" => self.context_session_memory_clear(params),
            "agents.sync" => self.sync_agent_registry(params),
            "agents.list" => self.list_agent_registry(),
            "knowledge.change.queue" => self.queue_knowledge_change(params),
            "knowledge.outbox.list" => self.list_pending_knowledge_changes(),
            "upload.queue.enqueue" => self.upload_queue_enqueue(params),
            "upload.queue.list" => self.upload_queue_list(params),
            "upload.queue.get" => self.upload_queue_get(params),
            "upload.queue.pause" => self.upload_queue_pause(params),
            "upload.queue.resume" => self.upload_queue_resume(params),
            "upload.queue.cancel" => self.upload_queue_cancel(params),
            "upload.queue.retry" => self.upload_queue_retry(params),
            "upload.queue.clearCompleted" => self.upload_queue_clear_completed(params),
            "upload.queue.process" => self.upload_queue_process(params),
            "server.events.sync" => self.sync_server_events(params),
            "pipeline.submit" => self.submit_pipeline(params, task_id),
            "result.export" => self.export_result_artifact(params),
            "vocabulary.pull" => self.pull_vocabulary().map(|item| json!(item)),
            "vocabulary.applyToIndex" => self.apply_vocabulary_to_index().map(|item| json!(item)),
            "mail.index.stats" => self.mail_index_stats().map(|item| json!(item)),
            "mail.index.rebuild" => self.rebuild_mail_index(),
            "mail.index.search" => {
                let query = params
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let limit = params
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(50)
                    .min(200) as usize;
                let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
                self.search_mail_index(query, limit, offset)
                    .map(|item| json!(item))
            }
            "mail.index.open" | "mail.evidence.open" => {
                let doc_id = params.get("docId").and_then(Value::as_u64);
                let message_key = params
                    .get("messageKey")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.open_mail_index_item(doc_id, message_key)
            }
            "mail.auth.check" | "mail.auth.request" => self.request_mail_authorization(),
            "mail.import.start" => self.start_macos_mail_import(),
            "mail.import.status" => self.mail_import_status(),
            "mail.import.pause" => self.pause_macos_mail_import(),
            "mail.import.resume" => self.resume_macos_mail_import(),
            "mail.import.cancel" => self.cancel_macos_mail_import(),
            "task.cancel" => {
                let target = params
                    .get("taskId")
                    .or_else(|| params.get("commandId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.request_task_cancel(target)?;
                Ok(json!({ "ok": true, "cancelled": true, "taskId": target }))
            }
            "events.subscribe" => {
                let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0);
                let timeout_ms = params
                    .get("timeoutMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(25_000)
                    .min(60_000);
                self.read_events_since(offset, Duration::from_millis(timeout_ms))
            }
            _ => Err(anyhow!("unknown method: {}", method)),
        }
    }

    pub fn read_events_since(&self, offset: u64, wait_timeout: Duration) -> Result<Value> {
        let deadline = SystemTime::now() + wait_timeout;
        loop {
            let (events, next_offset) = read_events_file(&self.events_path(), offset)?;
            if !events.is_empty() || SystemTime::now() >= deadline {
                return Ok(json!({
                    "ok": true,
                    "mode": "long-poll",
                    "offset": offset,
                    "nextOffset": next_offset,
                    "events": events
                }));
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    pub fn handle_rpc(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let trace_id = normalize_trace_id(request.trace_id.as_deref().unwrap_or(""));
        if request.protocol_version.unwrap_or(PROTOCOL_VERSION) != PROTOCOL_VERSION {
            return JsonRpcResponse::error_with_trace(
                request.id,
                -32010,
                "unsupported protocolVersion",
                &trace_id,
            );
        }

        let result = self.execute_method_with_trace(
            &request.method,
            request.params.unwrap_or_else(|| json!({})),
            None,
            &trace_id,
            "local-rpc",
        );

        match result {
            Ok(value) => JsonRpcResponse::success_with_trace(request.id, value, &trace_id),
            Err(error) => {
                JsonRpcResponse::error_with_trace(request.id, -32000, &error.to_string(), &trace_id)
            }
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BackendCommand {
    pub schema_version: u32,
    pub protocol_version: u32,
    pub command_id: String,
    pub trace_id: String,
    pub method: String,
    pub params: Value,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendCommandResult {
    pub schema_version: u32,
    pub protocol_version: u32,
    pub command_id: String,
    #[serde(default)]
    pub trace_id: String,
    pub method: String,
    pub status: String,
    pub result: Option<Value>,
    pub error: Option<JsonRpcError>,
    pub started_at: String,
    pub finished_at: String,
}

impl BackendCommandResult {
    fn success(
        command_id: &str,
        method: &str,
        result: Value,
        started_at: &str,
        finished_at: &str,
        trace_id: &str,
    ) -> Self {
        Self {
            schema_version: BACKEND_SCHEMA_VERSION,
            protocol_version: PROTOCOL_VERSION,
            command_id: command_id.to_string(),
            trace_id: normalize_trace_id(trace_id),
            method: method.to_string(),
            status: "completed".to_string(),
            result: Some(result),
            error: None,
            started_at: started_at.to_string(),
            finished_at: finished_at.to_string(),
        }
    }

    fn error(command_id: &str, method: &str, code: i32, message: &str, trace_id: &str) -> Self {
        let now = timestamp();
        Self::error_with_time(command_id, method, code, message, &now, &now, trace_id)
    }

    fn error_with_time(
        command_id: &str,
        method: &str,
        code: i32,
        message: &str,
        started_at: &str,
        finished_at: &str,
        trace_id: &str,
    ) -> Self {
        Self {
            schema_version: BACKEND_SCHEMA_VERSION,
            protocol_version: PROTOCOL_VERSION,
            command_id: command_id.to_string(),
            trace_id: normalize_trace_id(trace_id),
            method: method.to_string(),
            status: "failed".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.to_string(),
            }),
            started_at: started_at.to_string(),
            finished_at: finished_at.to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ClientConfig {
    pub bootstrap_base_url: String,
    pub resolved_service_base_url: String,
    pub service_username: String,
    pub service_password: String,
    pub client_id: String,
    pub last_discovery_config_version: String,
    pub last_expert_vocabulary_version: u64,
    pub last_expert_vocabulary_checksum: String,
    pub last_expert_vocabulary_pulled_at: String,
    pub last_connected_at: String,
    pub expert_vocabulary_sync_policy: String,
    pub index_hot_update_policy: String,
    pub platform_capability_preference: String,
}

#[derive(Clone, Debug, Default)]
struct ConsoleServiceAuth {
    username: String,
    password: String,
}

#[derive(Clone, Debug, Default)]
struct ConsoleServiceSession {
    cookie: String,
    csrf: String,
}

#[derive(Clone, Debug)]
struct PipelineLocalFile {
    path: PathBuf,
    name: String,
    relative_path: String,
    media_type: String,
    client_uid: Option<String>,
    source_type: Option<String>,
    provider_id: Option<String>,
    external_id: Option<String>,
    sync_batch_id: Option<String>,
    content_hash: Option<String>,
    captured_at: Option<String>,
    source_metadata: Value,
    sha256: String,
    byte_size: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientBackendCapabilities {
    pub schema_version: u32,
    pub protocol_version: u32,
    pub platform: String,
    pub mail_import: bool,
    pub mail_index: bool,
    pub file_index: bool,
    pub local_rpc: bool,
    pub expert_vocabulary: bool,
    pub data_connectors: bool,
    pub chat_index: bool,
    pub platform_adapters: Vec<String>,
    pub connector_providers: Vec<String>,
    pub methods: Vec<String>,
    pub operations: Vec<ClientOperationDefinition>,
    pub updated_at: String,
}

impl ClientBackendCapabilities {
    pub fn current() -> Self {
        let mut adapters = vec!["filesystem".to_string()];
        if cfg!(target_os = "macos") {
            adapters.push("macos-mail".to_string());
        }
        adapters.push("data-connectors".to_string());
        Self {
            schema_version: BACKEND_SCHEMA_VERSION,
            protocol_version: PROTOCOL_VERSION,
            platform: env::consts::OS.to_string(),
            mail_import: cfg!(target_os = "macos"),
            mail_index: true,
            file_index: true,
            local_rpc: true,
            expert_vocabulary: true,
            data_connectors: true,
            chat_index: true,
            platform_adapters: adapters,
            connector_providers: connectors::built_in_connector_provider_ids(),
            methods: backend_methods(),
            operations: client_operation_registry(),
            updated_at: timestamp(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientOperationDefinition {
    pub method: String,
    pub risk: String,
    pub scope: String,
    pub read_only: bool,
    pub destructive: bool,
    pub concurrency_safe: bool,
    pub audit: Value,
    pub log: Value,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientBackendRuntimeState {
    pub schema_version: u32,
    pub protocol_version: u32,
    pub daemon_status: String,
    pub current_task: String,
    pub mail_index: MailIndexStats,
    pub vocabulary: ExpertVocabularyRuntimeState,
    pub recent_error: String,
    pub last_heartbeat_at: String,
    pub data_directory: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpertVocabularyRuntimeState {
    pub version: u64,
    pub checksum: String,
    pub active_entry_count: usize,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientBackendEvent {
    pub schema_version: u32,
    #[serde(default)]
    pub trace_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub created_at: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExpertVocabulary {
    pub schema_version: u32,
    pub version: u64,
    pub updated_at: String,
    pub published_at: String,
    pub source: String,
    pub checksum: String,
    pub entries: Vec<ExpertVocabularyEntry>,
}

impl ExpertVocabulary {
    pub fn active_entry_count(&self) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.status.eq_ignore_ascii_case("active"))
            .count()
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExpertVocabularyEntry {
    pub id: String,
    pub path_segments: Vec<String>,
    pub label: String,
    pub keywords: Vec<String>,
    pub domains: Vec<String>,
    pub status: String,
    pub notes: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyPullResult {
    pub changed: bool,
    pub vocabulary: ExpertVocabulary,
    pub apply_result: Option<VocabularyApplyResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyApplyResult {
    pub document_count: usize,
    pub updated_document_count: usize,
    pub taxonomy_signature: String,
    pub index_directory: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailIndexStats {
    #[serde(rename = "documentCount")]
    pub document_count: usize,
    #[serde(rename = "segmentCount")]
    pub segment_count: usize,
    #[serde(rename = "pendingCount")]
    pub pending_count: usize,
    #[serde(rename = "lastUpdatedAt")]
    pub last_updated_at: String,
    #[serde(rename = "indexDirectory")]
    pub index_directory: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailIndexSearchResponse {
    pub total: usize,
    pub results: Vec<MailIndexSearchResult>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MailIndexSearchResult {
    pub doc_id: u64,
    pub message_key: String,
    pub file_name: String,
    pub path: String,
    pub subject: String,
    pub sender: String,
    pub recipients: String,
    pub cc: String,
    pub date_sent: String,
    pub date_received: String,
    pub account: String,
    pub mailbox_path: String,
    pub status: String,
    pub last_seen_at: String,
    pub error: String,
    pub taxonomy_path: String,
}

impl MailIndexSearchResult {
    fn from_tsv_line(line: &str) -> Self {
        let parts = line.split('\t').collect::<Vec<_>>();
        Self {
            doc_id: part(&parts, 0).parse().unwrap_or(0),
            message_key: part(&parts, 1).to_string(),
            file_name: part(&parts, 2).to_string(),
            path: part(&parts, 2).to_string(),
            subject: part(&parts, 3).to_string(),
            sender: part(&parts, 4).to_string(),
            recipients: part(&parts, 5).to_string(),
            cc: part(&parts, 6).to_string(),
            date_sent: part(&parts, 7).to_string(),
            date_received: part(&parts, 8).to_string(),
            account: part(&parts, 9).to_string(),
            mailbox_path: part(&parts, 10).to_string(),
            status: part(&parts, 11).to_string(),
            last_seen_at: part(&parts, 12).to_string(),
            error: part(&parts, 13).to_string(),
            taxonomy_path: part(&parts, 16).to_string(),
        }
    }

    fn with_downloads_dir(mut self, downloads_dir: &Path) -> Self {
        if !self.file_name.trim().is_empty() {
            self.path = downloads_dir
                .join(&self.file_name)
                .to_string_lossy()
                .to_string();
        }
        self
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcEndpoint {
    pub schema_version: u32,
    pub protocol_version: u32,
    pub transport: String,
    pub base_url: String,
    pub token: String,
    pub local_socket_name: String,
    pub local_socket_transport: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRpcRequest {
    pub jsonrpc: Option<String>,
    pub id: Option<Value>,
    pub trace_id: Option<String>,
    pub method: String,
    pub params: Option<Value>,
    pub protocol_version: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(rename = "traceId", skip_serializing_if = "String::is_empty")]
    pub trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

impl JsonRpcResponse {
    fn success_with_trace(id: Option<Value>, result: Value, trace_id: &str) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            trace_id: trace_id.to_string(),
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Option<Value>, code: i32, message: &str) -> Self {
        Self::error_with_trace(id, code, message, "")
    }

    fn error_with_trace(id: Option<Value>, code: i32, message: &str, trace_id: &str) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            trace_id: trace_id.to_string(),
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

#[derive(Clone, Debug)]
struct TaxonomyRule {
    path: String,
    keywords: Vec<String>,
    domains: Vec<String>,
}

pub fn portable_data_dir() -> Result<PathBuf> {
    if let Ok(value) = env::var("PACT_PORTABLE_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            fs::create_dir_all(&path)?;
            return Ok(path);
        }
    }

    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            let candidate = parent.join("portable-data");
            if fs::create_dir_all(&candidate).is_ok() {
                return Ok(candidate);
            }
        }
    }

    let project_dirs = directories::ProjectDirs::from("com", "pact", "flutter-client")
        .ok_or_else(|| anyhow!("cannot resolve application support directory"))?;
    let fallback = project_dirs.config_dir().join("portable-data");
    fs::create_dir_all(&fallback)?;
    Ok(fallback)
}

pub fn run_daemon_forever() -> Result<()> {
    let backend = Backend::from_portable_data_dir()?;
    backend.initialize_shared_files()?;

    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let token = Uuid::new_v4().to_string();
    let running = Arc::new(AtomicBool::new(true));
    let local_socket_name = start_local_socket_rpc(backend.clone(), token.clone(), running.clone())
        .unwrap_or_else(|_| String::new());
    let endpoint = RpcEndpoint {
        schema_version: BACKEND_SCHEMA_VERSION,
        protocol_version: PROTOCOL_VERSION,
        transport: "http".to_string(),
        base_url: format!("http://{}", address),
        token: token.clone(),
        local_socket_transport: if local_socket_name.is_empty() {
            String::new()
        } else if cfg!(windows) {
            "namedPipe".to_string()
        } else {
            "unixSocket".to_string()
        },
        local_socket_name,
        updated_at: timestamp(),
    };
    atomic_write_json(&backend.rpc_path(), &endpoint)?;
    backend.append_event(
        "rpc.started",
        json!({ "transport": endpoint.transport, "baseUrl": endpoint.base_url }),
    )?;

    let (watch_tx, watch_rx) = mpsc::channel();
    let mut watcher = RecommendedWatcher::new(watch_tx, NotifyConfig::default())?;
    watcher.watch(&backend.command_inbox_dir(), RecursiveMode::NonRecursive)?;
    if let Some(settings_parent) = backend.settings_path().parent() {
        watcher.watch(settings_parent, RecursiveMode::NonRecursive)?;
    }

    let heartbeat_backend = backend.clone();
    let heartbeat_running = running.clone();
    thread::spawn(move || {
        while heartbeat_running.load(Ordering::Relaxed) {
            if let Ok(stats) = heartbeat_backend.mail_index_stats() {
                let vocabulary = heartbeat_backend
                    .load_expert_vocabulary()
                    .unwrap_or_default();
                let _ = heartbeat_backend.write_runtime_state("running", None, &stats, &vocabulary);
            }
            thread::sleep(Duration::from_secs(3));
        }
    });

    let mut last_settings_modified = modified_time(&backend.settings_path());
    let mut last_poll = SystemTime::now();
    let mut last_auto_sync = SystemTime::now();
    let mut last_knowledge_sync = SystemTime::now();
    let mut last_server_events_sync = SystemTime::now();
    let mut last_upload_queue_poll = SystemTime::now();
    let auto_sync_running = Arc::new(AtomicBool::new(false));
    let knowledge_sync_running = Arc::new(AtomicBool::new(false));
    let server_events_sync_running = Arc::new(AtomicBool::new(false));
    let upload_queue_running = Arc::new(AtomicBool::new(false));
    loop {
        if backend.shutdown_path().exists() {
            break;
        }

        let mut workspace_event = false;
        while let Ok(event) = watch_rx.try_recv() {
            if event.is_ok() {
                workspace_event = true;
            }
        }
        if workspace_event || elapsed_since(last_poll) >= Duration::from_millis(500) {
            last_poll = SystemTime::now();
            let _ = backend.process_pending_commands();
        }

        match listener.accept() {
            Ok((stream, _)) => {
                let request_backend = backend.clone();
                let request_token = token.clone();
                thread::spawn(move || {
                    let _ = handle_http_rpc(stream, &request_backend, &request_token);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(error.into()),
        }

        let modified = modified_time(&backend.settings_path());
        if modified.is_some() && modified != last_settings_modified {
            last_settings_modified = modified;
            let config = backend.load_config().unwrap_or_default();
            backend.append_event("config.applied", json!({ "clientId": config.client_id }))?;
            spawn_auto_sync_if_idle(
                backend.clone(),
                "settings-changed",
                auto_sync_running.clone(),
            );
            spawn_knowledge_sync_if_idle(
                backend.clone(),
                "settings-changed",
                knowledge_sync_running.clone(),
            );
            spawn_server_events_sync_if_idle(
                backend.clone(),
                "settings-changed",
                server_events_sync_running.clone(),
            );
        }

        if elapsed_since(last_auto_sync) >= Duration::from_secs(300) {
            last_auto_sync = SystemTime::now();
            spawn_auto_sync_if_idle(backend.clone(), "interval", auto_sync_running.clone());
        }

        if elapsed_since(last_knowledge_sync) >= Duration::from_secs(300) {
            last_knowledge_sync = SystemTime::now();
            spawn_knowledge_sync_if_idle(
                backend.clone(),
                "interval",
                knowledge_sync_running.clone(),
            );
        }

        if elapsed_since(last_server_events_sync) >= Duration::from_secs(30) {
            last_server_events_sync = SystemTime::now();
            spawn_server_events_sync_if_idle(
                backend.clone(),
                "interval",
                server_events_sync_running.clone(),
            );
        }

        if workspace_event || elapsed_since(last_upload_queue_poll) >= Duration::from_millis(500) {
            last_upload_queue_poll = SystemTime::now();
            spawn_upload_queue_worker_if_idle(backend.clone(), upload_queue_running.clone());
        }

        thread::sleep(Duration::from_millis(80));
    }

    running.store(false, Ordering::Relaxed);
    let stats = backend
        .mail_index_stats()
        .unwrap_or_else(|_| MailIndexStats {
            document_count: 0,
            segment_count: 0,
            pending_count: 0,
            last_updated_at: String::new(),
            index_directory: backend.mail_index_dir().to_string_lossy().to_string(),
        });
    let vocabulary = backend.load_expert_vocabulary().unwrap_or_default();
    let _ = backend.write_runtime_state("stopped", None, &stats, &vocabulary);
    let _ = backend.append_event("backend.stopped", json!({}));
    let _ = fs::remove_file(backend.rpc_path());
    let _ = fs::remove_file(backend.shutdown_path());
    Ok(())
}

pub fn rpc_call(endpoint: &RpcEndpoint, method: &str, params: Value) -> Result<Value> {
    let trace_id = new_client_trace_id();
    let request = json!({
        "jsonrpc": "2.0",
        "id": Uuid::new_v4().to_string(),
        "traceId": trace_id,
        "method": method,
        "params": params,
        "protocolVersion": PROTOCOL_VERSION
    });
    let response: Value = http_json_agent()
        .post(&format!("{}/rpc", endpoint.base_url.trim_end_matches('/')))
        .set("content-type", "application/json")
        .set("x-pact-client-token", &endpoint.token)
        .send_json(request)?
        .into_json()?;

    if let Some(error) = response.get("error") {
        return Err(anyhow!(
            "{}",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("rpc error")
        ));
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

pub fn load_rpc_endpoint(data_dir: &Path) -> Result<RpcEndpoint> {
    let path = data_dir.join(BACKEND_WORKSPACE).join("rpc.json");
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn load_rpc_endpoint_from_portable_data() -> Result<RpcEndpoint> {
    load_rpc_endpoint(&portable_data_dir()?)
}

fn spawn_auto_sync_if_idle(backend: Backend, reason: &'static str, running: Arc<AtomicBool>) {
    if running.swap(true, Ordering::AcqRel) {
        let _ = backend.append_event(
            "vocabulary.auto-sync.skipped",
            json!({ "reason": reason, "cause": "already-running" }),
        );
        return;
    }
    thread::spawn(move || {
        let _ = backend.try_auto_sync_vocabulary(reason);
        running.store(false, Ordering::Release);
    });
}

fn spawn_knowledge_sync_if_idle(backend: Backend, reason: &'static str, running: Arc<AtomicBool>) {
    if running.swap(true, Ordering::AcqRel) {
        let _ = backend.append_event(
            "knowledge.auto-sync.skipped",
            json!({ "reason": reason, "cause": "already-running" }),
        );
        return;
    }
    thread::spawn(move || {
        let result =
            backend.sync_knowledge_cache(json!({ "pushOutbox": false, "scope": "mirror" }));
        if let Err(error) = result {
            let _ = backend.append_event(
                "knowledge.auto-sync.failed",
                json!({ "reason": reason, "error": error.to_string() }),
            );
        }
        running.store(false, Ordering::Release);
    });
}

fn spawn_server_events_sync_if_idle(
    backend: Backend,
    reason: &'static str,
    running: Arc<AtomicBool>,
) {
    let config = backend.load_config().unwrap_or_default();
    if service_base_url(&config).is_err() {
        return;
    }
    if running.swap(true, Ordering::AcqRel) {
        return;
    }
    thread::spawn(move || {
        if let Err(error) = backend.sync_server_events(json!({ "limit": 200 })) {
            let _ = backend.append_event(
                "server.events.sync.failed",
                json!({ "reason": reason, "error": error.to_string() }),
            );
        }
        running.store(false, Ordering::Release);
    });
}

fn spawn_upload_queue_worker_if_idle(backend: Backend, running: Arc<AtomicBool>) {
    if running.load(Ordering::Acquire) {
        return;
    }
    let has_processable_task = backend
        .load_upload_queue_state()
        .map(|state| upload_queue::has_processable_task(&state, unix_epoch_millis()))
        .unwrap_or(false);
    if !has_processable_task {
        return;
    }
    if running.swap(true, Ordering::AcqRel) {
        return;
    }
    thread::spawn(move || {
        let _ = backend.upload_queue_process(json!({ "maxTasks": 10000 }));
        running.store(false, Ordering::Release);
    });
}

fn start_local_socket_rpc(
    backend: Backend,
    token: String,
    running: Arc<AtomicBool>,
) -> Result<String> {
    let print_name = if GenericNamespaced::is_supported() {
        format!("pact-clientd-{}.sock", workspace_token(&backend.data_dir))
    } else {
        backend
            .backend_dir()
            .join("pact-clientd.sock")
            .to_string_lossy()
            .to_string()
    };
    let name = if GenericNamespaced::is_supported() {
        print_name.clone().to_ns_name::<GenericNamespaced>()?
    } else {
        print_name.clone().to_fs_name::<GenericFilePath>()?
    };
    let listener = ListenerOptions::new()
        .name(name)
        .try_overwrite(true)
        .create_sync()?;
    let advertised_name = print_name.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            if !running.load(Ordering::Relaxed) {
                break;
            }
            match stream {
                Ok(stream) => {
                    let request_backend = backend.clone();
                    let request_token = token.clone();
                    thread::spawn(move || {
                        let _ = handle_rpc_stream(stream, &request_backend, &request_token);
                    });
                }
                Err(_) => thread::sleep(Duration::from_millis(50)),
            }
        }
    });
    Ok(advertised_name)
}

fn handle_http_rpc(stream: TcpStream, backend: &Backend, token: &str) -> Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    handle_rpc_stream(stream, backend, token)
}

fn handle_rpc_stream<S: Read + Write>(mut stream: S, backend: &Backend, token: &str) -> Result<()> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end;
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }
        if buffer.len() > 1024 * 1024 {
            return Err(anyhow!("http request header is too large"));
        }
    }

    let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let content_length = content_length(&header_text).unwrap_or(0);
    let provided_token = header_value(&header_text, "x-pact-client-token").unwrap_or_default();
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    let response = if provided_token != token {
        JsonRpcResponse::error(None, -32001, "invalid local rpc token")
    } else {
        let body = &buffer[body_start..buffer.len().min(body_start + content_length)];
        match serde_json::from_slice::<JsonRpcRequest>(body) {
            Ok(request) => backend.handle_rpc(request),
            Err(error) => JsonRpcResponse::error(None, -32700, &error.to_string()),
        }
    };

    let body = serde_json::to_vec(&response)?;
    write_http_json_response(&mut stream, 200, &body)?;
    Ok(())
}

fn write_http_json_response<S: Write>(stream: &mut S, status: u16, body: &[u8]) -> Result<()> {
    let reason = if status == 200 { "OK" } else { "ERROR" };
    let header = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        status,
        reason,
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    stream.write_all(body)?;
    Ok(())
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|item| item == b"\r\n\r\n")
}

fn content_length(header: &str) -> Option<usize> {
    header_value(header, "content-length")?.parse().ok()
}

fn header_value(header: &str, name: &str) -> Option<String> {
    let target = name.to_ascii_lowercase();
    for line in header.lines().skip(1) {
        let (raw_name, value) = line.split_once(':')?;
        if raw_name.trim().eq_ignore_ascii_case(&target) {
            return Some(value.trim().to_string());
        }
    }
    None
}

fn service_console_auth(config: &ClientConfig) -> Option<ConsoleServiceAuth> {
    let username = config.service_username.trim().to_string();
    let password = config.service_password.to_string();
    if username.is_empty() || password.trim().is_empty() {
        return None;
    }
    Some(ConsoleServiceAuth { username, password })
}

fn extract_console_session_cookie(header: &str) -> String {
    for part in header.split(',') {
        let cookie = part.split(';').next().unwrap_or("").trim();
        if cookie.starts_with("pact_console_session=") {
            return cookie.to_string();
        }
    }
    let cookie = header.split(';').next().unwrap_or("").trim();
    if cookie.starts_with("pact_console_session=") {
        return cookie.to_string();
    }
    String::new()
}

fn login_console_session(
    service_url: &str,
    auth: &ConsoleServiceAuth,
) -> Result<ConsoleServiceSession> {
    let login_url = format!("{}/api/auth/login", normalize_service_url(service_url));
    let response = http_json_agent()
        .post(&login_url)
        .set("accept", "application/json")
        .set("content-type", "application/json")
        .send_json(json!({
            "username": auth.username,
            "password": auth.password
        }))?;
    let set_cookie = response.header("set-cookie").unwrap_or("").to_string();
    let payload: Value = response.into_json()?;
    let cookie = extract_console_session_cookie(&set_cookie);
    let csrf = payload
        .get("csrfToken")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if cookie.is_empty() || csrf.is_empty() {
        return Err(anyhow!("console login did not return a usable session"));
    }
    Ok(ConsoleServiceSession { cookie, csrf })
}

fn console_session_for_config(
    service_url: &str,
    config: &ClientConfig,
) -> Result<Option<ConsoleServiceSession>> {
    let Some(auth) = service_console_auth(config) else {
        return Ok(None);
    };
    Ok(Some(login_console_session(service_url, &auth)?))
}

fn service_path_requires_console_auth(path: &str) -> bool {
    if !path.starts_with("/api/") {
        return false;
    }
    !(path.starts_with("/api/bootstrap")
        || path.starts_with("/api/healthz")
        || path.starts_with("/api/discovery/check-in")
        || path.starts_with("/api/auth/login")
        || path.starts_with("/api/auth/session"))
}

fn fetch_expert_vocabulary(
    config: &ClientConfig,
    session: Option<&ConsoleServiceSession>,
) -> Result<ExpertVocabulary> {
    let base = service_base_url(config)?;
    let response = http_json_with_auth(
        "GET",
        &format!("{}/api/expert-vocabulary", base),
        None,
        session,
    )?;
    let vocabulary = response
        .get("vocabulary")
        .cloned()
        .ok_or_else(|| anyhow!("server did not return vocabulary"))?;
    Ok(serde_json::from_value(vocabulary)?)
}

fn service_base_url(config: &ClientConfig) -> Result<String> {
    let raw = if !config.resolved_service_base_url.trim().is_empty() {
        config.resolved_service_base_url.trim()
    } else {
        config.bootstrap_base_url.trim()
    };
    if raw.is_empty() {
        return Err(anyhow!("missing service URL in settings.json"));
    }
    let trimmed = raw.trim_end_matches('/');
    let normalized = trimmed
        .strip_suffix("/api/bootstrap")
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    Ok(normalized.to_string())
}

fn json_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn first_json_string(value: &Value, paths: &[&str]) -> Option<String> {
    for path in paths {
        let Some(raw) = json_path(value, path) else {
            continue;
        };
        let normalized = match raw {
            Value::String(text) => text.trim().to_string(),
            Value::Number(_) | Value::Bool(_) => raw.to_string(),
            _ => String::new(),
        };
        if !normalized.is_empty() {
            return Some(normalized);
        }
    }
    None
}

fn first_json_array(value: &Value, paths: &[&str]) -> Vec<Value> {
    for path in paths {
        let Some(raw) = json_path(value, path) else {
            continue;
        };
        if let Some(items) = raw.as_array() {
            return items.clone();
        }
        if let Some(text) = raw.as_str() {
            let items = text
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(|item| json!(item))
                .collect::<Vec<_>>();
            if !items.is_empty() {
                return items;
            }
        }
    }
    Vec::new()
}

fn local_agent_registry(_config: &Value) -> Value {
    json!({
        "schemaVersion": 1,
        "source": "local",
        "provider": "model-forwarding",
        "defaultAlias": "",
        "agents": []
    })
}

fn merge_agent_lists(local: Vec<Value>, server: Vec<Value>) -> Value {
    let mut merged = Vec::new();
    let mut index_by_key = HashMap::new();
    for agent in local.into_iter().chain(server.into_iter()) {
        let alias = agent
            .get("alias")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let key = if alias.is_empty() {
            format!(
                "{}:{}",
                agent
                    .get("provider")
                    .and_then(Value::as_str)
                    .unwrap_or("custom-http"),
                agent
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            )
        } else {
            alias
        };
        if key.trim().is_empty() {
            continue;
        }
        if let Some(existing_index) = index_by_key.get(&key).copied() {
            let existing_configured = merged
                .get(existing_index)
                .and_then(|item: &Value| item.get("urlConfigured"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let current_configured = agent
                .get("urlConfigured")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !existing_configured && current_configured {
                merged[existing_index] = agent;
            }
            continue;
        }
        index_by_key.insert(key, merged.len());
        merged.push(agent);
    }
    json!(merged)
}

fn merge_json_object(target: &mut Value, patch: &Value) -> Result<()> {
    let target_object = target
        .as_object_mut()
        .ok_or_else(|| anyhow!("target config must be a JSON object"))?;
    let patch_object = patch
        .as_object()
        .ok_or_else(|| anyhow!("config patch must be a JSON object"))?;
    for (key, value) in patch_object {
        target_object.insert(key.clone(), value.clone());
    }
    Ok(())
}

fn default_state_value(name: &str) -> Value {
    match name {
        "recent-runs" | "recentRuns" => json!([]),
        "checkpoints" => json!({}),
        _ => json!(null),
    }
}

fn collect_files_under(
    root: &Path,
    path: &Path,
    include_all_files: bool,
    files: &mut Vec<Value>,
) -> Result<()> {
    let metadata = fs::metadata(path)?;
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_name().to_string_lossy() == ".DS_Store" {
                continue;
            }
            collect_files_under(root, &entry.path(), include_all_files, files)?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Ok(());
    }
    let extension = path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !include_all_files && !supported_extension(&extension) {
        return Ok(());
    }
    let relative_root = if root.is_file() {
        root.parent().unwrap_or_else(|| Path::new("."))
    } else {
        root.parent().unwrap_or_else(|| root)
    };
    let relative_path = path
        .strip_prefix(relative_root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    files.push(json!({
        "path": path.to_string_lossy().to_string(),
        "name": path.file_name().and_then(|item| item.to_str()).unwrap_or_default(),
        "relativePath": relative_path,
        "byteSize": metadata.len(),
        "mediaType": mime_guess::from_path(path).first_or_octet_stream().to_string()
    }));
    Ok(())
}

fn pipeline_files_from_params(params: &Value) -> Result<Vec<PipelineLocalFile>> {
    let raw_files = params
        .get("files")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut files = Vec::new();
    for item in raw_files {
        let path = item
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("pipeline file is missing path"))?;
        let path = PathBuf::from(path);
        let metadata = fs::metadata(&path)?;
        if !metadata.is_file() {
            continue;
        }
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "file".to_string());
        let relative_path = item
            .get("relativePath")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| name.clone());
        let media_type = item
            .get("mediaType")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                mime_guess::from_path(&path)
                    .first_or_octet_stream()
                    .to_string()
            });
        let bytes = fs::read(&path)?;
        let sha256 = sha256_hex(&bytes);
        files.push(PipelineLocalFile {
            path,
            name,
            relative_path,
            media_type,
            client_uid: string_param_from_file(&item, params, &["clientUid", "clientId"]),
            source_type: string_param_from_file(&item, params, &["sourceType", "resourceType"]),
            provider_id: string_param_from_file(&item, params, &["providerId"]),
            external_id: string_param_from_file(&item, params, &["externalId"]),
            sync_batch_id: string_param_from_file(
                &item,
                params,
                &["syncBatchId", "clientBatchId", "batchId"],
            ),
            content_hash: string_param_from_file(&item, params, &["contentHash"]),
            captured_at: string_param_from_file(&item, params, &["capturedAt"]),
            source_metadata: object_param_from_file(&item, params, "sourceMetadata"),
            sha256,
            byte_size: metadata.len(),
        });
    }
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

fn string_param(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
    })
}

fn string_param_from_file(item: &Value, params: &Value, keys: &[&str]) -> Option<String> {
    string_param(item, keys).or_else(|| string_param(params, keys))
}

fn object_param_from_file(item: &Value, params: &Value, key: &str) -> Value {
    item.get(key)
        .or_else(|| params.get(key))
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}))
}

fn pipeline_manifest_digest(files: &[PipelineLocalFile]) -> Result<String> {
    let manifest = files
        .iter()
        .map(|file| json!([file.relative_path, file.sha256, file.byte_size]))
        .collect::<Vec<_>>();
    Ok(sha256_hex(&serde_json::to_vec(&manifest)?))
}

fn pipeline_summary(files: &[PipelineLocalFile], input_text: &str) -> String {
    if files.is_empty() {
        if input_text.trim().is_empty() {
            "空输入".to_string()
        } else {
            "仅文本输入".to_string()
        }
    } else if files.len() > 3 {
        format!(
            "{} 等 {} 个文件",
            files
                .iter()
                .take(3)
                .map(|file| file.name.clone())
                .collect::<Vec<_>>()
                .join("、"),
            files.len()
        )
    } else {
        files
            .iter()
            .map(|file| file.name.clone())
            .collect::<Vec<_>>()
            .join("、")
    }
}

fn find_upload_session_file(
    session: &Value,
    file: &PipelineLocalFile,
    fallback_index: usize,
) -> Option<Value> {
    let files = session.get("files")?.as_array()?;
    files
        .iter()
        .find(|item| {
            item.get("index").and_then(Value::as_u64) == Some(fallback_index as u64)
                && item
                    .get("sha256")
                    .and_then(Value::as_str)
                    .map(|value| value.eq_ignore_ascii_case(&file.sha256))
                    .unwrap_or(false)
                && item.get("byteSize").and_then(Value::as_u64) == Some(file.byte_size)
        })
        .or_else(|| {
            files.iter().find(|item| {
                item.get("relativePath")
                    .and_then(Value::as_str)
                    .map(|value| value == file.relative_path)
                    .unwrap_or(false)
            })
        })
        .cloned()
}

fn read_file_chunk(path: &Path, offset: u64, max_len: usize) -> Result<Vec<u8>> {
    let mut file = OpenOptions::new().read(true).open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut buffer = vec![0; max_len];
    let read = file.read(&mut buffer)?;
    buffer.truncate(read);
    Ok(buffer)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{:02x}", byte)).collect()
}

fn normalize_service_url(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    trimmed
        .strip_suffix("/api/bootstrap")
        .unwrap_or(trimmed)
        .trim_end_matches('/')
        .to_string()
}

fn http_json_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(20))
        .timeout_write(Duration::from_secs(20))
        .build()
}

fn http_binary_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(60))
        .timeout_write(Duration::from_secs(60))
        .build()
}

fn request_is_safe(method: &str) -> bool {
    matches!(method, "GET" | "HEAD" | "OPTIONS")
}

fn apply_console_session_auth(
    request: ureq::Request,
    method: &str,
    session: Option<&ConsoleServiceSession>,
) -> ureq::Request {
    let Some(session) = session else {
        return request;
    };
    let mut request = request;
    if !session.cookie.trim().is_empty() {
        request = request.set("Cookie", session.cookie.trim());
    }
    if !request_is_safe(method) {
        if !session.csrf.trim().is_empty() {
            request = request.set("x-pact-csrf", session.csrf.trim());
        }
        request = request.set("x-pact-safety-confirm", "true");
    }
    request
}

fn http_json_with_auth(
    method: &str,
    url: &str,
    body: Option<Value>,
    session: Option<&ConsoleServiceSession>,
) -> Result<Value> {
    let agent = http_json_agent();
    let request = apply_console_session_auth(
        match method {
            "GET" => agent.get(url),
            "POST" => agent.post(url),
            "PUT" => agent.put(url),
            "DELETE" => agent.delete(url),
            _ => return Err(anyhow!("unsupported HTTP method: {}", method)),
        },
        method,
        session,
    )
    .set("accept", "application/json");
    let response = if let Some(body) = body {
        request
            .set("content-type", "application/json")
            .send_json(body)?
    } else {
        request.call()?
    };
    Ok(response.into_json()?)
}

fn http_json(method: &str, url: &str, body: Option<Value>) -> Result<Value> {
    http_json_with_auth(method, url, body, None)
}

fn http_checkpoint_chunk_with_auth(
    url: &str,
    body: &[u8],
    session: Option<&ConsoleServiceSession>,
) -> Result<Value> {
    let request = apply_console_session_auth(http_binary_agent().put(url), "PUT", session)
        .set("accept", "application/json")
        .set("content-type", "application/octet-stream");
    match request.send_bytes(body) {
        Ok(response) => Ok(response.into_json()?),
        Err(ureq::Error::Status(409, response)) => Ok(response.into_json()?),
        Err(error) => Err(error.into()),
    }
}

fn http_checkpoint_chunk(url: &str, body: &[u8]) -> Result<Value> {
    http_checkpoint_chunk_with_auth(url, body, None)
}

fn content_disposition_filename(value: &str) -> Option<String> {
    for part in value.split(';') {
        let trimmed = part.trim();
        if let Some(raw) = trimmed.strip_prefix("filename=") {
            return Some(raw.trim_matches('"').to_string());
        }
    }
    None
}

fn supported_extension(extension: &str) -> bool {
    matches!(
        extension,
        "txt"
            | "md"
            | "markdown"
            | "csv"
            | "json"
            | "yaml"
            | "yml"
            | "xml"
            | "html"
            | "htm"
            | "pdf"
            | "docx"
            | "doc"
            | "xlsx"
            | "xls"
            | "pptx"
            | "ppt"
            | "eml"
            | "msg"
            | "mbox"
            | "mbx"
            | "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "heic"
            | "gif"
    )
}

fn backend_methods() -> Vec<String> {
    [
        "system.ping",
        "system.capabilities",
        "system.operations",
        "config.get",
        "config.set",
        "config.patch",
        "config.reload",
        "state.recentRuns.get",
        "state.recentRuns.set",
        "state.recentRuns.clear",
        "state.checkpoints.get",
        "state.checkpoints.set",
        "state.checkpoints.clear",
        "state.logs.tail",
        "state.logs.append",
        "state.logs.clear",
        "state.exports.dir",
        "file.collect",
        "file.open",
        "server.cli",
        "server.api",
        "knowledge.cache.stats",
        "knowledge.status",
        "knowledge.sync",
        "knowledge.search",
        "knowledge.graph",
        "knowledge.document.get",
        "knowledge.document.open",
        "knowledge.export",
        "knowledge.agent.context",
        "connectors.list",
        "connectors.install",
        "connectors.enable",
        "connectors.disable",
        "connectors.uninstall",
        "connectors.auth.start",
        "connectors.auth.status",
        "connectors.auth.revoke",
        "connectors.sync",
        "connectors.health",
        "connectors.queryLocal",
        "context.compaction.preview",
        "context.compaction.run",
        "context.compaction.records",
        "context.session_memory.get",
        "context.session_memory.clear",
        "agents.sync",
        "agents.list",
        "knowledge.change.queue",
        "knowledge.outbox.list",
        "upload.queue.enqueue",
        "upload.queue.list",
        "upload.queue.get",
        "upload.queue.pause",
        "upload.queue.resume",
        "upload.queue.cancel",
        "upload.queue.retry",
        "upload.queue.clearCompleted",
        "upload.queue.process",
        "server.events.sync",
        "pipeline.submit",
        "result.export",
        "vocabulary.pull",
        "vocabulary.applyToIndex",
        "mail.auth.check",
        "mail.auth.request",
        "mail.import.start",
        "mail.import.status",
        "mail.import.pause",
        "mail.import.resume",
        "mail.import.cancel",
        "mail.index.stats",
        "mail.index.rebuild",
        "mail.index.search",
        "mail.index.open",
        "mail.evidence.open",
        "task.cancel",
        "events.subscribe",
    ]
    .iter()
    .map(|item| item.to_string())
    .collect()
}

fn client_operation_registry() -> Vec<ClientOperationDefinition> {
    backend_methods()
        .iter()
        .map(|method| client_operation_definition(method))
        .collect()
}

fn client_operation(method: &str) -> Option<ClientOperationDefinition> {
    backend_methods()
        .iter()
        .any(|candidate| candidate == method)
        .then(|| client_operation_definition(method))
}

fn client_operation_definition(method: &str) -> ClientOperationDefinition {
    let read_only = matches!(
        method,
        "system.ping"
            | "system.capabilities"
            | "system.operations"
            | "config.get"
            | "state.recentRuns.get"
            | "state.checkpoints.get"
            | "state.logs.tail"
            | "state.exports.dir"
            | "file.collect"
            | "knowledge.cache.stats"
            | "knowledge.status"
            | "knowledge.search"
            | "knowledge.graph"
            | "knowledge.document.get"
            | "knowledge.export"
            | "connectors.list"
            | "connectors.auth.status"
            | "connectors.health"
            | "connectors.queryLocal"
            | "context.compaction.preview"
            | "context.compaction.records"
            | "context.session_memory.get"
            | "agents.list"
            | "knowledge.outbox.list"
            | "upload.queue.list"
            | "upload.queue.get"
            | "mail.index.stats"
            | "mail.index.search"
            | "events.subscribe"
    );
    let repair_write = matches!(
        method,
        "config.set"
            | "config.patch"
            | "state.recentRuns.clear"
            | "state.checkpoints.clear"
            | "state.logs.clear"
            | "context.session_memory.clear"
            | "mail.index.rebuild"
    );
    let risk = if read_only {
        "read_only"
    } else if repair_write {
        "repair_write"
    } else {
        "safe_write"
    };
    let scope = method
        .split('.')
        .next()
        .unwrap_or("client")
        .replace('-', "_");
    ClientOperationDefinition {
        method: method.to_string(),
        risk: risk.to_string(),
        scope,
        read_only,
        destructive: false,
        concurrency_safe: read_only,
        audit: json!({
            "enabled": true,
            "recordInput": !read_only,
            "recordOutput": false,
            "redaction": "default"
        }),
        log: json!({
            "enabled": true,
            "recordInput": !read_only,
            "recordOutput": false,
            "redaction": "default"
        }),
        input_schema: json!({
            "type": "object",
            "additionalProperties": true
        }),
    }
}

fn rewrite_docs_tsv_with_taxonomy(
    path: &Path,
    vocabulary: &ExpertVocabulary,
) -> Result<VocabularyApplyResult> {
    let index_directory = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&index_directory)?;
    let taxonomy_signature = vocabulary_signature(vocabulary);
    if !path.exists() {
        return Ok(VocabularyApplyResult {
            document_count: 0,
            updated_document_count: 0,
            taxonomy_signature,
            index_directory: index_directory.to_string_lossy().to_string(),
        });
    }

    let rules = merged_taxonomy_rules(vocabulary);
    let raw = fs::read_to_string(path)?;
    let mut updated_lines = Vec::new();
    let mut document_count = 0;
    let mut updated_document_count = 0;

    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        document_count += 1;
        let mut parts = line.split('\t').map(str::to_string).collect::<Vec<_>>();
        while parts.len() <= 16 {
            parts.push(String::new());
        }
        let next_taxonomy = classify_taxonomy(&parts[3], &parts[4], &parts[10], &rules);
        if parts[16] != next_taxonomy {
            parts[16] = next_taxonomy;
            updated_document_count += 1;
        }
        updated_lines.push(parts.join("\t"));
    }

    if updated_document_count > 0 {
        let mut output = updated_lines.join("\n");
        if !output.is_empty() {
            output.push('\n');
        }
        atomic_write_text(path, &output)?;
    }

    Ok(VocabularyApplyResult {
        document_count,
        updated_document_count,
        taxonomy_signature,
        index_directory: index_directory.to_string_lossy().to_string(),
    })
}

fn merged_taxonomy_rules(vocabulary: &ExpertVocabulary) -> Vec<TaxonomyRule> {
    let mut rules = baseline_taxonomy_rules();
    let mut index_by_path = rules
        .iter()
        .enumerate()
        .map(|(index, rule)| (rule.path.clone(), index))
        .collect::<HashMap<_, _>>();

    for entry in &vocabulary.entries {
        let path = entry
            .path_segments
            .iter()
            .map(|part| part.trim())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("/");
        if path.is_empty() {
            continue;
        }
        let status = entry.status.to_ascii_lowercase();
        if status == "retired" {
            if let Some(existing) = index_by_path.get(&path).copied() {
                rules.remove(existing);
                index_by_path = rules
                    .iter()
                    .enumerate()
                    .map(|(index, rule)| (rule.path.clone(), index))
                    .collect();
            }
            continue;
        }
        if status != "active" {
            continue;
        }
        let rule = TaxonomyRule {
            path: path.clone(),
            keywords: normalized_strings(&entry.keywords),
            domains: normalized_domains(&entry.domains),
        };
        if let Some(existing) = index_by_path.get(&path).copied() {
            rules[existing] = rule;
        } else {
            index_by_path.insert(path, rules.len());
            rules.push(rule);
        }
    }

    if rules.is_empty() {
        baseline_taxonomy_rules()
    } else {
        rules
    }
}

fn classify_taxonomy(
    subject: &str,
    sender: &str,
    mailbox_path: &str,
    rules: &[TaxonomyRule],
) -> String {
    let haystack = format!("{} {} {}", subject, sender, mailbox_path).to_lowercase();
    let domain = email_domain(sender);
    let mut best_path = "未分类".to_string();
    let mut best_score = 0_usize;

    for rule in rules {
        let mut score = 0_usize;
        for keyword in &rule.keywords {
            if haystack.contains(&keyword.to_lowercase()) {
                score += if keyword.chars().count() >= 6 { 3 } else { 2 };
            }
        }
        for rule_domain in &rule.domains {
            let normalized = rule_domain.to_lowercase();
            if domain == normalized || domain.ends_with(&format!(".{}", normalized)) {
                score += 4;
            } else if haystack.contains(&normalized) {
                score += 3;
            }
        }
        if score > best_score {
            best_score = score;
            best_path = rule.path.clone();
        }
    }

    best_path
}

fn baseline_taxonomy_rules() -> Vec<TaxonomyRule> {
    vec![
        rule(
            "开发/客户端/macOS",
            &[
                "macos",
                "swift",
                "swiftui",
                "appkit",
                "xcode",
                "notarization",
                "签名",
            ],
            &[],
        ),
        rule(
            "开发/客户端/iOS",
            &[
                "ios",
                "iphone app",
                "ipad",
                "app store",
                "testflight",
                "swiftui",
            ],
            &[],
        ),
        rule(
            "开发/前端/Web",
            &[
                "frontend",
                "react",
                "nextjs",
                "vite",
                "typescript",
                "css",
                "html",
            ],
            &[],
        ),
        rule(
            "开发/后端/API",
            &[
                "backend", "server", "api", "database", "postgres", "redis", "docker",
            ],
            &[],
        ),
        rule(
            "开发/AI/模型",
            &["openai", "gpt", "llm", "embedding", "rag", "model", "ai"],
            &["openai.com", "github.com"],
        ),
        rule(
            "测试/自动化/E2E",
            &[
                "test",
                "testing",
                "playwright",
                "selenium",
                "e2e",
                "自动化",
                "测试",
            ],
            &[],
        ),
        rule(
            "测试/质量/性能",
            &[
                "performance",
                "benchmark",
                "latency",
                "profiling",
                "性能",
                "压测",
            ],
            &[],
        ),
        rule(
            "交付/发布/上线",
            &[
                "release",
                "deploy",
                "deployment",
                "launch",
                "上线",
                "发布",
                "交付",
            ],
            &[],
        ),
        rule(
            "交付/作业/提交",
            &[
                "assignment",
                "submission",
                "homework",
                "deadline",
                "coursework",
                "作业",
                "提交",
            ],
            &[],
        ),
        rule(
            "运营/云服务/监控",
            &[
                "cloud",
                "aws",
                "azure",
                "digitalocean",
                "monitoring",
                "alert",
                "incident",
            ],
            &["digitalocean.com", "amazonaws.com", "microsoft.com"],
        ),
        rule(
            "购物/电子产品/手机",
            &["iphone", "android phone", "smartphone", "手机"],
            &["apple.com", "samsung.com"],
        ),
        rule(
            "购物/电子产品/电脑",
            &[
                "macbook",
                "laptop",
                "surface",
                "pc",
                "computer",
                "电脑",
                "笔记本",
            ],
            &["apple.com", "microsoftstoreemail.com"],
        ),
        rule(
            "购物/电子产品/游戏设备",
            &[
                "xbox",
                "playstation",
                "controller",
                "gaming pc",
                "steam deck",
            ],
            &["microsoftstoreemail.com", "playstation.com"],
        ),
        rule(
            "购物/服装/运动鞋服",
            &[
                "nike",
                "adidas",
                "jordan",
                "shoes",
                "sneaker",
                "ultraboost",
                "air max",
                "服装",
            ],
            &["official.nike.com", "uk-news.adidas.com"],
        ),
        rule(
            "购物/美妆/护肤",
            &["beauty", "cosmetic", "skincare", "makeup", "美妆", "护肤"],
            &[],
        ),
        rule(
            "购物/家电/厨房",
            &[
                "appliance",
                "kitchen",
                "fridge",
                "washer",
                "vacuum",
                "家电",
                "厨房",
            ],
            &[],
        ),
        rule("购物/宠物/用品", &["pet", "dog", "cat", "宠物"], &[]),
        rule(
            "购物/乐器/音乐设备",
            &[
                "guitar",
                "piano",
                "midi",
                "audio interface",
                "presonus",
                "乐器",
            ],
            &["presonus.com"],
        ),
        rule(
            "账单/订阅/数字服务",
            &[
                "subscription",
                "receipt",
                "invoice",
                "renewal",
                "billing",
                "账单",
                "订阅",
            ],
            &["email.apple.com", "netflix.com"],
        ),
        rule(
            "账单/支付/交易",
            &[
                "payment",
                "purchase",
                "order",
                "paid",
                "transaction",
                "付款",
                "支付",
            ],
            &[],
        ),
        rule(
            "广告/促销/折扣",
            &[
                "sale",
                "discount",
                "offer",
                "coupon",
                "deal",
                "flash sale",
                "折扣",
                "促销",
            ],
            &[],
        ),
        rule(
            "投资/金融/转账",
            &[
                "bank",
                "finance",
                "investment",
                "stock",
                "crypto",
                "transfer",
                "western union",
                "投资",
                "转账",
            ],
            &["westernunion.com"],
        ),
        rule(
            "学习/语言/课程",
            &[
                "course", "lesson", "teacher", "learning", "italki", "language", "课程", "学习",
            ],
            &["italki.com", "sendgrid.net"],
        ),
        rule(
            "旅行/交通/票务",
            &[
                "ticket", "train", "flight", "hotel", "travel", "holiday", "旅行", "机票", "火车",
            ],
            &["thetrainline.com"],
        ),
        rule(
            "安全/账号/登录",
            &[
                "security",
                "sign-in",
                "login",
                "verification",
                "password",
                "account",
                "安全",
                "验证",
                "登录",
            ],
            &[
                "accountprotection.microsoft.com",
                "accounts.google.com",
                "id.apple.com",
            ],
        ),
        rule(
            "娱乐/游戏/发行",
            &[
                "game",
                "steam",
                "xbox",
                "play",
                "final fantasy",
                "elder scrolls",
                "blizzard",
                "游戏",
            ],
            &[
                "steampowered.com",
                "steamcommunity.com",
                "square-enix.com",
                "blizzard.com",
                "ea.com",
                "elderscrollsonline.com",
            ],
        ),
        rule(
            "娱乐/影视/流媒体",
            &["netflix", "movie", "series", "watch", "streaming", "影视"],
            &["mailer.netflix.com", "netflix.com"],
        ),
        rule(
            "生活/分享/日常",
            &[
                "newsletter",
                "weekly",
                "photo",
                "family",
                "life",
                "生活",
                "分享",
            ],
            &[],
        ),
    ]
}

fn rule(path: &str, keywords: &[&str], domains: &[&str]) -> TaxonomyRule {
    TaxonomyRule {
        path: path.to_string(),
        keywords: keywords.iter().map(|item| item.to_string()).collect(),
        domains: domains.iter().map(|item| item.to_string()).collect(),
    }
}

fn email_domain(raw: &str) -> String {
    for token in raw.to_lowercase().split(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                ',' | ';' | '<' | '>' | '"' | '\'' | '(' | ')' | '[' | ']'
            )
    }) {
        if !token.contains('@') {
            continue;
        }
        let cleaned = token.trim_matches(|c: char| c.is_ascii_punctuation());
        if let Some((_, domain)) = cleaned.rsplit_once('@') {
            return domain.to_string();
        }
    }
    String::new()
}

fn normalized_strings(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn normalized_domains(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|item| item.trim().trim_start_matches('@').to_lowercase())
        .filter(|item| !item.is_empty())
        .collect()
}

fn vocabulary_signature(vocabulary: &ExpertVocabulary) -> String {
    if vocabulary.checksum.trim().is_empty() {
        format!("builtin:{}", baseline_taxonomy_rules().len())
    } else {
        vocabulary.checksum.clone()
    }
}

fn write_index_state(
    index_dir: &Path,
    stats: &MailIndexStats,
    taxonomy_signature: &str,
) -> Result<()> {
    fs::create_dir_all(index_dir)?;
    let state = json!({
        "schemaVersion": 1,
        "indexAlgorithmVersion": 4,
        "documentCount": stats.document_count,
        "segmentCount": stats.segment_count,
        "pendingCount": stats.pending_count,
        "lastUpdatedAt": timestamp(),
        "taxonomySignature": taxonomy_signature
    });
    atomic_write_json(&index_dir.join("state.json"), &state)?;
    Ok(())
}

fn read_state_last_updated_at(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    value.get("lastUpdatedAt")?.as_str().map(str::to_string)
}

fn read_json_file(path: &Path) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    if raw.trim().is_empty() {
        return None;
    }
    serde_json::from_str(&raw).ok()
}

fn append_jsonl_value(path: &Path, value: &Value) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{}", serde_json::to_string(value)?)?;
    Ok(())
}

fn read_jsonl_tail(path: &Path, limit: usize) -> Result<Vec<Value>> {
    let raw = fs::read_to_string(path).unwrap_or_default();
    let mut items = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    let capped = limit.max(1).min(1000);
    if items.len() > capped {
        items = items.split_off(items.len() - capped);
    }
    items.reverse();
    Ok(items)
}

fn client_context_messages(params: &Value) -> Vec<Value> {
    if let Some(items) = params.get("messages").and_then(Value::as_array) {
        return items.clone();
    }
    if let Some(items) = params.get("transcript").and_then(Value::as_array) {
        return items.clone();
    }
    let mut messages = Vec::new();
    if let Some(history) = params
        .get("history")
        .or_else(|| params.get("compressedHistory"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        messages.push(json!({
            "id": "client-history",
            "role": "system",
            "content": history
        }));
    }
    if let Some(items) = params.get("recentTurns").and_then(Value::as_array) {
        messages.extend(items.clone());
    }
    if let Some(question) = params
        .get("question")
        .or_else(|| params.get("query"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        messages.push(json!({
            "id": "client-current-question",
            "role": "user",
            "content": question
        }));
    }
    messages
}

fn client_message_text(message: &Value) -> String {
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(text) = message.get("text").and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(text) = message.get("summary").and_then(Value::as_str) {
        return text.to_string();
    }
    serde_json::to_string(message).unwrap_or_default()
}

fn estimate_client_text_tokens(text: &str) -> usize {
    let mut tokens: f64 = 0.0;
    for ch in text.chars() {
        if ('\u{3400}'..='\u{9fff}').contains(&ch) {
            tokens += 0.9;
        } else {
            tokens += 0.25;
        }
    }
    tokens.ceil().max(1.0) as usize
}

fn estimate_client_context_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(|message| estimate_client_text_tokens(&client_message_text(message)))
        .sum()
}

fn compact_client_text(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let important = text
        .split(['\n', '。', '.', '!', '?'])
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            let lower = line.to_lowercase();
            lower.contains("must")
                || lower.contains("risk")
                || lower.contains("todo")
                || lower.contains("decision")
                || line.contains("必须")
                || line.contains("风险")
                || line.contains("证据")
                || line.contains("决定")
        })
        .take(24)
        .collect::<Vec<_>>()
        .join("\n");
    let source = if important.is_empty() {
        text
    } else {
        &important
    };
    source.chars().take(max_chars).collect()
}

fn client_context_summary(messages: &[Value], params: &Value) -> String {
    let task = params
        .get("taskBrief")
        .or_else(|| params.get("question"))
        .or_else(|| params.get("query"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let mut parts = vec![
        "Context compaction summary. This is auxiliary memory, not canonical evidence.".to_string(),
    ];
    if !task.trim().is_empty() {
        parts.push(format!("Current task: {}", task.trim()));
    }
    for message in messages.iter().rev().take(24).rev() {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        let id = message.get("id").and_then(Value::as_str).unwrap_or("");
        let text = compact_client_text(&client_message_text(message), 600);
        if !text.trim().is_empty() {
            parts.push(format!("- [{} {}] {}", role, id, text));
        }
    }
    parts.join("\n")
}

fn required_string(params: &Value, key: &str) -> Result<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("{} is required", key))
}

fn read_latest_mail_progress(progress_path: &Path, downloads_dir: &Path) -> Option<Value> {
    let raw = fs::read_to_string(progress_path).ok()?;
    let line = raw.lines().rev().find(|line| !line.trim().is_empty())?;
    let parts = line.split('\t').collect::<Vec<_>>();
    if parts.len() < 8 {
        return None;
    }
    let mut payload = json!({
        "kind": part(&parts, 0),
        "sequence": part(&parts, 1).parse::<u64>().unwrap_or(0),
        "totalCount": part(&parts, 2).parse::<u64>().unwrap_or(0),
        "exportedCount": part(&parts, 3).parse::<u64>().unwrap_or(0),
        "failedCount": part(&parts, 4).parse::<u64>().unwrap_or(0),
        "skippedCount": part(&parts, 5).parse::<u64>().unwrap_or(0),
        "title": part(&parts, 6),
        "detail": part(&parts, 7),
        "exportDirectory": downloads_dir.to_string_lossy().to_string()
    });
    let keys = [
        "messageKey",
        "account",
        "mailboxPath",
        "sender",
        "recipients",
        "cc",
        "dateSent",
        "dateReceived",
        "fileName",
        "sourceHash",
        "byteSize",
        "error",
        "status",
    ];
    if let Some(object) = payload.as_object_mut() {
        for (index, key) in keys.iter().enumerate() {
            let value = part(&parts, index + 8);
            if value.is_empty() {
                continue;
            }
            if *key == "byteSize" {
                object.insert(key.to_string(), json!(value.parse::<u64>().unwrap_or(0)));
            } else {
                object.insert(key.to_string(), json!(value));
            }
        }
    }
    Some(payload)
}

fn read_events_file(path: &Path, offset: u64) -> Result<(Vec<Value>, u64)> {
    if !path.exists() {
        return Ok((Vec::new(), 0));
    }
    let mut file = OpenOptions::new().read(true).open(path)?;
    let len = file.metadata()?.len();
    let start = offset.min(len);
    file.seek(SeekFrom::Start(start))?;
    let mut raw = String::new();
    file.read_to_string(&mut raw)?;
    let next_offset = len;
    let events = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    Ok((events, next_offset))
}

fn segment_count(index_dir: &Path) -> Result<usize> {
    if !index_dir.exists() {
        return Ok(0);
    }
    let mut count = 0;
    let segment_dir = index_dir.join("segments");
    let uses_segment_subdir = segment_dir.exists();
    let target_dir = if uses_segment_subdir {
        segment_dir
    } else {
        index_dir.to_path_buf()
    };
    for entry in fs::read_dir(target_dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".lex") || (!uses_segment_subdir && name.ends_with(".post")) {
            count += 1;
        }
    }
    Ok(count)
}

fn process_is_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        false
    }
}

fn terminate_process(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill").arg("-TERM").arg(pid.to_string()).status();
    }
}

fn modified_time(path: &Path) -> Option<SystemTime> {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
}

fn elapsed_since(instant: SystemTime) -> Duration {
    SystemTime::now()
        .duration_since(instant)
        .unwrap_or_else(|_| Duration::from_secs(0))
}

fn sanitize_file_token(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .collect::<String>()
}

fn workspace_token(path: &Path) -> String {
    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>()
}

fn atomic_write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    let text = serde_json::to_string_pretty(value)?;
    atomic_write_text(path, &text)
}

fn atomic_write_text(path: &Path, contents: &str) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let lock_path = parent.join(format!(
        "{}.lock",
        path.file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("shared")
    ));
    let lock = OpenOptions::new()
        .create(true)
        .write(true)
        .open(lock_path)?;
    lock.lock_exclusive()?;
    let result = (|| -> Result<()> {
        let file_name = path
            .file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("shared");
        let temp_path = parent.join(format!(
            ".{}.{}.{}.tmp",
            file_name,
            std::process::id(),
            Uuid::new_v4()
        ));
        fs::write(&temp_path, contents)?;
        if cfg!(windows) && path.exists() {
            let _ = fs::remove_file(path);
        }
        fs::rename(&temp_path, path)?;
        Ok(())
    })();
    let _ = lock.unlock();
    result
}

fn new_client_trace_id() -> String {
    format!("trace_{}", Uuid::new_v4())
}

fn normalize_trace_id(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        new_client_trace_id()
    } else {
        trimmed.to_string()
    }
}

fn attach_client_dispatch_metadata(
    value: Value,
    operation: &ClientOperationDefinition,
    trace_id: &str,
    status: &str,
    audit_id: &str,
    transport: &str,
    started_at: &str,
    finished_at: &str,
) -> Value {
    match value {
        Value::Object(mut map) => {
            insert_if_missing(&mut map, "traceId", json!(trace_id));
            insert_if_missing(&mut map, "operationId", json!(operation.method));
            insert_if_missing(&mut map, "operationRisk", json!(operation.risk));
            insert_if_missing(&mut map, "operationScope", json!(operation.scope));
            insert_if_missing(&mut map, "status", json!(status));
            insert_if_missing(&mut map, "transport", json!(transport));
            insert_if_missing(&mut map, "startedAt", json!(started_at));
            insert_if_missing(&mut map, "finishedAt", json!(finished_at));
            if !audit_id.is_empty() {
                insert_if_missing(&mut map, "auditId", json!(audit_id));
            }
            Value::Object(map)
        }
        other => json!({
            "traceId": trace_id,
            "operationId": operation.method,
            "operationRisk": operation.risk,
            "operationScope": operation.scope,
            "status": status,
            "transport": transport,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "auditId": audit_id,
            "value": other
        }),
    }
}

fn insert_if_missing(map: &mut Map<String, Value>, key: &str, value: Value) {
    if !map.contains_key(key) {
        map.insert(key.to_string(), value);
    }
}

fn timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    format!("unix:{}", duration.as_secs())
}

fn unix_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn timestamp_from_epoch_ms(epoch_ms: u64) -> String {
    format!("unix:{}", epoch_ms / 1000)
}

fn upload_queue_retry_delay_ms(attempt: u64) -> u64 {
    let exponent = attempt.saturating_sub(1).min(7) as u32;
    let delay = 2_000u64.saturating_mul(2u64.saturating_pow(exponent));
    delay.min(300_000)
}

fn recoverable_upload_error_kind(message: &str) -> Option<&'static str> {
    let normalized = message.to_ascii_lowercase();
    let network_markers = [
        "connection refused",
        "connection reset",
        "connection closed",
        "connection aborted",
        "failed to connect",
        "could not connect",
        "network is unreachable",
        "no route to host",
        "timed out",
        "timeout",
        "deadline",
        "dns",
        "temporary failure",
        "unexpected eof",
        "broken pipe",
        "transport",
        "tcp",
        "tls handshake",
    ];
    if network_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return Some("network");
    }
    let recoverable_statuses = ["408", "425", "429", "500", "502", "503", "504"];
    if recoverable_statuses.iter().any(|status| {
        normalized.contains(&format!("status: {status}"))
            || normalized.contains(&format!("status {status}"))
            || normalized.contains(&format!("http {status}"))
            || normalized.contains(&format!("http/{status}"))
    }) {
        return Some("server_transient");
    }
    None
}

fn normalize_topic_params(params: &Value) -> Vec<String> {
    let mut topics = Vec::new();
    for key in ["topic", "topics"] {
        let Some(value) = params.get(key) else {
            continue;
        };
        match value {
            Value::String(text) => {
                for topic in text.split(',') {
                    let trimmed = topic.trim();
                    if !trimmed.is_empty() && !topics.iter().any(|item| item == trimmed) {
                        topics.push(trimmed.to_string());
                    }
                }
            }
            Value::Array(items) => {
                for item in items {
                    let trimmed = item.as_str().unwrap_or_default().trim();
                    if !trimmed.is_empty() && !topics.iter().any(|topic| topic == trimmed) {
                        topics.push(trimmed.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    topics
}

fn part<'a>(parts: &'a [&str], index: usize) -> &'a str {
    parts.get(index).copied().unwrap_or("")
}

fn open_knowledge_cache(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS knowledge_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_items (
          item_id TEXT PRIMARY KEY,
          item_type TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          revision INTEGER NOT NULL DEFAULT 0,
          server_updated_at TEXT NOT NULL DEFAULT '',
          record_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          chunk_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          snippet TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL DEFAULT '',
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_evidence (
          evidence_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          snippet TEXT NOT NULL DEFAULT '',
          locator_json TEXT NOT NULL DEFAULT '{}',
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
          node_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT '',
          node_type TEXT NOT NULL DEFAULT '',
          weight REAL NOT NULL DEFAULT 0,
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
          edge_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          weight REAL NOT NULL DEFAULT 0,
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_outbox (
          operation_id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL,
          entity_type TEXT NOT NULL DEFAULT '',
          base_revision INTEGER NOT NULL DEFAULT 0,
          field_patch_json TEXT NOT NULL DEFAULT '{}',
          client_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          submitted_at TEXT NOT NULL DEFAULT '',
          server_response_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS knowledge_review_items (
          review_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT '',
          record_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_suggestions (
          suggestion_id TEXT PRIMARY KEY,
          suggestion_type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0,
          record_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_documents (
          document_id TEXT PRIMARY KEY,
          collection_id TEXT NOT NULL DEFAULT '',
          batch_id TEXT NOT NULL DEFAULT '',
          source_id TEXT NOT NULL DEFAULT '',
          document_type TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          source_path TEXT NOT NULL DEFAULT '',
          source_hash TEXT NOT NULL DEFAULT '',
          local_markdown_path TEXT NOT NULL DEFAULT '',
          local_json_path TEXT NOT NULL DEFAULT '',
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_sections (
          section_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          level INTEGER NOT NULL DEFAULT 1,
          position INTEGER NOT NULL DEFAULT 0,
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_blocks (
          block_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          section_id TEXT NOT NULL DEFAULT '',
          block_type TEXT NOT NULL DEFAULT 'text',
          title TEXT NOT NULL DEFAULT '',
          snippet TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_assets (
          asset_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          section_id TEXT NOT NULL DEFAULT '',
          block_id TEXT NOT NULL DEFAULT '',
          asset_type TEXT NOT NULL DEFAULT 'image',
          media_type TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          caption TEXT NOT NULL DEFAULT '',
          ocr_text TEXT NOT NULL DEFAULT '',
          sha256 TEXT NOT NULL DEFAULT '',
          byte_size INTEGER NOT NULL DEFAULT 0,
          local_path TEXT NOT NULL DEFAULT '',
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS knowledge_relationships (
          relationship_id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL DEFAULT '',
          target_id TEXT NOT NULL DEFAULT '',
          relation_type TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT '',
          weight REAL NOT NULL DEFAULT 0,
          record_json TEXT NOT NULL DEFAULT '{}',
          server_updated_at TEXT NOT NULL DEFAULT ''
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_blocks_fts USING fts5(
          block_id UNINDEXED,
          title,
          text,
          snippet,
          tokenize = 'unicode61 remove_diacritics 0'
        );

        CREATE INDEX IF NOT EXISTS idx_knowledge_cache_items_updated
          ON knowledge_items(server_updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_cache_chunks_item
          ON knowledge_chunks(item_id, server_updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_cache_evidence_item
          ON knowledge_evidence(item_id, server_updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_cache_edges_source
          ON knowledge_graph_edges(source_id, weight DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_cache_edges_target
          ON knowledge_graph_edges(target_id, weight DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_cache_outbox_status
          ON knowledge_outbox(status, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_status
          ON knowledge_suggestions(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_updated
          ON knowledge_documents(server_updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_documents_batch
          ON knowledge_documents(batch_id, document_type);
        CREATE INDEX IF NOT EXISTS idx_knowledge_sections_doc
          ON knowledge_sections(document_id, position);
        CREATE INDEX IF NOT EXISTS idx_knowledge_blocks_doc
          ON knowledge_blocks(document_id, section_id, position);
        CREATE INDEX IF NOT EXISTS idx_knowledge_assets_doc
          ON knowledge_assets(document_id, section_id, block_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_source
          ON knowledge_relationships(source_id, weight DESC);
        CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_target
          ON knowledge_relationships(target_id, weight DESC);
        ",
    )?;
    Ok(conn)
}

fn knowledge_meta_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT value FROM knowledge_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?)
}

fn knowledge_meta_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "
        INSERT INTO knowledge_meta (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        ",
        params![key, value, timestamp()],
    )?;
    Ok(())
}

fn knowledge_count(conn: &Connection, table: &str) -> Result<i64> {
    let sql = format!("SELECT COUNT(*) FROM {}", table);
    Ok(conn.query_row(&sql, [], |row| row.get(0))?)
}

fn knowledge_cache_stats_from_conn(
    conn: &Connection,
    path: &Path,
    backend: &Backend,
) -> Result<Value> {
    let cursor = knowledge_meta_get(conn, "serverCursor")?.unwrap_or_else(|| "0".to_string());
    Ok(json!({
        "ok": true,
        "databasePath": path.to_string_lossy().to_string(),
        "knowledgeDirectory": backend.knowledge_dir().to_string_lossy().to_string(),
        "documentsDirectory": backend.knowledge_documents_dir().to_string_lossy().to_string(),
        "assetsDirectory": backend.knowledge_assets_dir().to_string_lossy().to_string(),
        "normalizedDocumentsDirectory": backend.knowledge_normalized_documents_dir().to_string_lossy().to_string(),
        "serverCursor": cursor,
        "itemCount": knowledge_count(conn, "knowledge_items")?,
        "chunkCount": knowledge_count(conn, "knowledge_chunks")?,
        "evidenceCount": knowledge_count(conn, "knowledge_evidence")?,
        "documentCount": knowledge_count(conn, "knowledge_documents")?,
        "sectionCount": knowledge_count(conn, "knowledge_sections")?,
        "blockCount": knowledge_count(conn, "knowledge_blocks")?,
        "assetCount": knowledge_count(conn, "knowledge_assets")?,
        "missingAssetCount": conn.query_row(
            "SELECT COUNT(*) FROM knowledge_assets WHERE local_path = ''",
            [],
            |row| row.get::<_, i64>(0),
        )?,
        "graphNodeCount": knowledge_count(conn, "knowledge_graph_nodes")?,
        "graphEdgeCount": knowledge_count(conn, "knowledge_graph_edges")?,
        "pendingOutboxCount": conn.query_row(
            "SELECT COUNT(*) FROM knowledge_outbox WHERE status = 'pending'",
            [],
            |row| row.get::<_, i64>(0),
        )?,
        "conflictOutboxCount": conn.query_row(
            "SELECT COUNT(*) FROM knowledge_outbox WHERE status = 'conflict'",
            [],
            |row| row.get::<_, i64>(0),
        )?,
        "reviewItemCount": knowledge_count(conn, "knowledge_review_items")?,
        "suggestionCount": knowledge_count(conn, "knowledge_suggestions")?,
        "pendingSuggestionCount": conn.query_row(
            "SELECT COUNT(*) FROM knowledge_suggestions WHERE status = 'pending'",
            [],
            |row| row.get::<_, i64>(0),
        )?
    }))
}

fn value_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

trait IfEmptyString {
    fn if_empty(self, fallback: String) -> String;
}

impl IfEmptyString for String {
    fn if_empty(self, fallback: String) -> String {
        if self.trim().is_empty() {
            fallback
        } else {
            self
        }
    }
}

fn value_i64(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn record_json(value: &Value) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}

fn upsert_cached_item(conn: &Connection, record: &Value, server_updated_at: &str) -> Result<()> {
    let item_id = value_string(record, "itemId");
    if item_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_items (
          item_id, item_type, title, summary, status, revision, server_updated_at, record_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(item_id) DO UPDATE SET
          item_type = excluded.item_type,
          title = excluded.title,
          summary = excluded.summary,
          status = excluded.status,
          revision = excluded.revision,
          server_updated_at = excluded.server_updated_at,
          record_json = excluded.record_json
        ",
        params![
            item_id,
            value_string(record, "itemType"),
            value_string(record, "title"),
            value_string(record, "summary"),
            value_string(record, "status"),
            value_i64(record, "revision"),
            server_updated_at,
            record_json(record)?
        ],
    )?;
    Ok(())
}

fn upsert_cached_chunk(conn: &Connection, record: &Value, server_updated_at: &str) -> Result<()> {
    let chunk_id = value_string(record, "chunkId");
    if chunk_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_chunks (
          chunk_id, item_id, snippet, text, record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(chunk_id) DO UPDATE SET
          item_id = excluded.item_id,
          snippet = excluded.snippet,
          text = excluded.text,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            chunk_id,
            value_string(record, "itemId"),
            value_string(record, "snippet"),
            value_string(record, "text"),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(())
}

fn upsert_cached_evidence(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<()> {
    let evidence_id = value_string(record, "evidenceId");
    if evidence_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_evidence (
          evidence_id, item_id, snippet, locator_json, record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(evidence_id) DO UPDATE SET
          item_id = excluded.item_id,
          snippet = excluded.snippet,
          locator_json = excluded.locator_json,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            evidence_id,
            value_string(record, "itemId"),
            value_string(record, "snippet"),
            record
                .get("locator")
                .map(record_json)
                .transpose()?
                .unwrap_or_else(|| "{}".to_string()),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(())
}

fn upsert_cached_graph_node(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<()> {
    let node_id = value_string(record, "nodeId");
    if node_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_graph_nodes (
          node_id, item_id, label, node_type, weight, record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(node_id) DO UPDATE SET
          item_id = excluded.item_id,
          label = excluded.label,
          node_type = excluded.node_type,
          weight = excluded.weight,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            node_id,
            value_string(record, "itemId"),
            value_string(record, "label"),
            value_string(record, "nodeType"),
            record.get("weight").and_then(Value::as_f64).unwrap_or(0.0),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(())
}

fn upsert_cached_graph_edge(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<()> {
    let edge_id = value_string(record, "edgeId");
    if edge_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_graph_edges (
          edge_id, source_id, target_id, label, weight, record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(edge_id) DO UPDATE SET
          source_id = excluded.source_id,
          target_id = excluded.target_id,
          label = excluded.label,
          weight = excluded.weight,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            edge_id,
            value_string(record, "sourceId"),
            value_string(record, "targetId"),
            value_string(record, "label"),
            record.get("weight").and_then(Value::as_f64).unwrap_or(0.0),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(())
}

fn upsert_cached_review_item(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<()> {
    let review_id = value_string(record, "reviewId");
    if review_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_review_items (
          review_id, status, record_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(review_id) DO UPDATE SET
          status = excluded.status,
          record_json = excluded.record_json,
          updated_at = excluded.updated_at
        ",
        params![
            review_id,
            value_string(record, "status"),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(())
}

fn upsert_cached_suggestion(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<()> {
    let suggestion_id = value_string(record, "suggestionId");
    if suggestion_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_suggestions (
          suggestion_id, suggestion_type, status, confidence, record_json, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(suggestion_id) DO UPDATE SET
          suggestion_type = excluded.suggestion_type,
          status = excluded.status,
          confidence = excluded.confidence,
          record_json = excluded.record_json,
          updated_at = excluded.updated_at
        ",
        params![
            suggestion_id,
            value_string(record, "type"),
            value_string(record, "status"),
            record
                .get("confidence")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(())
}

fn upsert_cached_document(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
    backend: &Backend,
) -> Result<String> {
    let document_id = value_string(record, "documentId").if_empty(value_string(record, "itemId"));
    if document_id.trim().is_empty() {
        return Ok(String::new());
    }
    let title = value_string(record, "title");
    let local_markdown_path = backend
        .knowledge_documents_dir()
        .join(document_file_name(&title, &document_id, "md"))
        .to_string_lossy()
        .to_string();
    let local_json_path = backend
        .knowledge_documents_dir()
        .join(document_file_name(&title, &document_id, "json"))
        .to_string_lossy()
        .to_string();
    conn.execute(
        "
        INSERT INTO knowledge_documents (
          document_id, collection_id, batch_id, source_id, document_type, title, summary,
          source_path, source_hash, local_markdown_path, local_json_path, record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(document_id) DO UPDATE SET
          collection_id = excluded.collection_id,
          batch_id = excluded.batch_id,
          source_id = excluded.source_id,
          document_type = excluded.document_type,
          title = excluded.title,
          summary = excluded.summary,
          source_path = excluded.source_path,
          source_hash = excluded.source_hash,
          local_markdown_path = excluded.local_markdown_path,
          local_json_path = excluded.local_json_path,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            document_id,
            value_string(record, "collectionId"),
            value_string(record, "batchId"),
            value_string(record, "sourceId"),
            value_string(record, "documentType")
                .if_empty(value_string(record, "itemType")),
            title,
            value_string(record, "summary"),
            value_string(record, "sourcePath"),
            value_string(record, "sourceHash"),
            local_markdown_path,
            local_json_path,
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(document_id)
}

fn upsert_cached_section(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<String> {
    let section_id = value_string(record, "sectionId");
    let document_id = value_string(record, "documentId");
    if section_id.trim().is_empty() || document_id.trim().is_empty() {
        return Ok(String::new());
    }
    conn.execute(
        "
        INSERT INTO knowledge_sections (
          section_id, document_id, title, level, position, record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(section_id) DO UPDATE SET
          document_id = excluded.document_id,
          title = excluded.title,
          level = excluded.level,
          position = excluded.position,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            section_id,
            document_id,
            value_string(record, "title"),
            value_i64(record, "level").max(1),
            value_i64(record, "position"),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(document_id)
}

fn upsert_cached_block(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<String> {
    let block_id = value_string(record, "blockId");
    let document_id = value_string(record, "documentId");
    if block_id.trim().is_empty() || document_id.trim().is_empty() {
        return Ok(String::new());
    }
    conn.execute(
        "
        INSERT INTO knowledge_blocks (
          block_id, document_id, section_id, block_type, title, snippet, text, position,
          record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(block_id) DO UPDATE SET
          document_id = excluded.document_id,
          section_id = excluded.section_id,
          block_type = excluded.block_type,
          title = excluded.title,
          snippet = excluded.snippet,
          text = excluded.text,
          position = excluded.position,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            block_id,
            document_id,
            value_string(record, "sectionId"),
            value_string(record, "blockType"),
            value_string(record, "title"),
            value_string(record, "snippet"),
            value_string(record, "text"),
            value_i64(record, "position"),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    conn.execute(
        "DELETE FROM knowledge_blocks_fts WHERE block_id = ?1",
        params![block_id],
    )?;
    conn.execute(
        "
        INSERT INTO knowledge_blocks_fts (block_id, title, text, snippet)
        VALUES (?1, ?2, ?3, ?4)
        ",
        params![
            block_id,
            value_string(record, "title"),
            value_string(record, "text"),
            value_string(record, "snippet")
        ],
    )?;
    Ok(document_id)
}

fn upsert_cached_asset(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<String> {
    let asset_id = value_string(record, "assetId");
    let document_id = value_string(record, "documentId");
    if asset_id.trim().is_empty() || document_id.trim().is_empty() {
        return Ok(String::new());
    }
    let existing_path = conn
        .query_row(
            "SELECT local_path FROM knowledge_assets WHERE asset_id = ?1",
            params![asset_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();
    conn.execute(
        "
        INSERT INTO knowledge_assets (
          asset_id, document_id, section_id, block_id, asset_type, media_type, title,
          caption, ocr_text, sha256, byte_size, local_path, record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(asset_id) DO UPDATE SET
          document_id = excluded.document_id,
          section_id = excluded.section_id,
          block_id = excluded.block_id,
          asset_type = excluded.asset_type,
          media_type = excluded.media_type,
          title = excluded.title,
          caption = excluded.caption,
          ocr_text = excluded.ocr_text,
          sha256 = excluded.sha256,
          byte_size = excluded.byte_size,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            asset_id,
            document_id,
            value_string(record, "sectionId"),
            value_string(record, "blockId"),
            value_string(record, "assetType"),
            value_string(record, "mediaType"),
            value_string(record, "title"),
            value_string(record, "caption"),
            value_string(record, "ocrText"),
            value_string(record, "sha256"),
            value_i64(record, "byteSize"),
            existing_path,
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(document_id)
}

fn upsert_cached_relationship(
    conn: &Connection,
    record: &Value,
    server_updated_at: &str,
) -> Result<()> {
    let relationship_id =
        value_string(record, "relationshipId").if_empty(value_string(record, "edgeId"));
    if relationship_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO knowledge_relationships (
          relationship_id, source_id, target_id, relation_type, label, weight,
          record_json, server_updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(relationship_id) DO UPDATE SET
          source_id = excluded.source_id,
          target_id = excluded.target_id,
          relation_type = excluded.relation_type,
          label = excluded.label,
          weight = excluded.weight,
          record_json = excluded.record_json,
          server_updated_at = excluded.server_updated_at
        ",
        params![
            relationship_id,
            value_string(record, "sourceId"),
            value_string(record, "targetId"),
            value_string(record, "relationType"),
            value_string(record, "label"),
            record.get("weight").and_then(Value::as_f64).unwrap_or(0.0),
            record_json(record)?,
            server_updated_at
        ],
    )?;
    Ok(())
}

fn apply_knowledge_tombstone(
    conn: &Connection,
    record: &Value,
    backend: &Backend,
) -> Result<Option<String>> {
    let target_kind = value_string(record, "targetKind");
    let document_id = value_string(record, "documentId");
    match target_kind.as_str() {
        "document" => {
            let target = value_string(record, "documentId");
            if !target.is_empty() {
                remove_cached_document_files(conn, backend, &target)?;
                conn.execute("DELETE FROM knowledge_blocks_fts WHERE block_id IN (SELECT block_id FROM knowledge_blocks WHERE document_id = ?1)", params![target])?;
                conn.execute(
                    "DELETE FROM knowledge_assets WHERE document_id = ?1",
                    params![target],
                )?;
                conn.execute(
                    "DELETE FROM knowledge_blocks WHERE document_id = ?1",
                    params![target],
                )?;
                conn.execute(
                    "DELETE FROM knowledge_sections WHERE document_id = ?1",
                    params![target],
                )?;
                conn.execute(
                    "DELETE FROM knowledge_documents WHERE document_id = ?1",
                    params![target],
                )?;
                return Ok(Some(target));
            }
        }
        "section" => {
            let target = value_string(record, "sectionId");
            if !target.is_empty() {
                conn.execute(
                    "DELETE FROM knowledge_sections WHERE section_id = ?1",
                    params![target],
                )?;
                return Ok(Some(document_id));
            }
        }
        "block" => {
            let target = value_string(record, "blockId");
            if !target.is_empty() {
                conn.execute(
                    "DELETE FROM knowledge_blocks_fts WHERE block_id = ?1",
                    params![target],
                )?;
                conn.execute(
                    "DELETE FROM knowledge_blocks WHERE block_id = ?1",
                    params![target],
                )?;
                return Ok(Some(document_id));
            }
        }
        "asset" => {
            let target = value_string(record, "assetId");
            if !target.is_empty() {
                conn.execute(
                    "DELETE FROM knowledge_assets WHERE asset_id = ?1",
                    params![target],
                )?;
                return Ok(Some(document_id));
            }
        }
        _ => {}
    }
    Ok(None)
}

fn apply_knowledge_sync_payload(
    conn: &Connection,
    payload: &Value,
    backend: &Backend,
) -> Result<()> {
    let mut touched_documents = HashSet::<String>::new();
    for change in payload
        .get("changes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let kind = change
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let server_updated_at = change
            .get("serverUpdatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let record = change.get("record").cloned().unwrap_or_else(|| json!({}));
        match kind {
            "item" => upsert_cached_item(conn, &record, server_updated_at)?,
            "chunk" => upsert_cached_chunk(conn, &record, server_updated_at)?,
            "evidence" => upsert_cached_evidence(conn, &record, server_updated_at)?,
            "graphNode" => upsert_cached_graph_node(conn, &record, server_updated_at)?,
            "graphEdge" => upsert_cached_graph_edge(conn, &record, server_updated_at)?,
            "reviewItem" => upsert_cached_review_item(conn, &record, server_updated_at)?,
            "suggestion" => upsert_cached_suggestion(conn, &record, server_updated_at)?,
            "document" => {
                let document_id =
                    upsert_cached_document(conn, &record, server_updated_at, backend)?;
                if !document_id.is_empty() {
                    touched_documents.insert(document_id);
                }
            }
            "section" => {
                let document_id = upsert_cached_section(conn, &record, server_updated_at)?;
                if !document_id.is_empty() {
                    touched_documents.insert(document_id);
                }
            }
            "block" => {
                let document_id = upsert_cached_block(conn, &record, server_updated_at)?;
                if !document_id.is_empty() {
                    touched_documents.insert(document_id);
                }
            }
            "asset" => {
                let document_id = upsert_cached_asset(conn, &record, server_updated_at)?;
                if !document_id.is_empty() {
                    touched_documents.insert(document_id);
                }
            }
            "relationship" => upsert_cached_relationship(conn, &record, server_updated_at)?,
            "tombstone" => {
                if let Some(document_id) = apply_knowledge_tombstone(conn, &record, backend)? {
                    if !document_id.is_empty() {
                        touched_documents.insert(document_id);
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(cursor) = payload.get("cursor").and_then(Value::as_str) {
        knowledge_meta_set(conn, "serverCursor", cursor)?;
    }
    if let Some(cursor) = payload.get("latestCursor").and_then(Value::as_str) {
        knowledge_meta_set(conn, "latestServerCursor", cursor)?;
    }
    for document_id in touched_documents {
        if !document_id.trim().is_empty() {
            let _ = render_cached_document(conn, backend, &document_id);
        }
    }
    Ok(())
}

fn document_file_name(title: &str, document_id: &str, extension: &str) -> String {
    let mut base = sanitize_file_token(title);
    if base.is_empty() {
        base = "knowledge-document".to_string();
    }
    if base.len() > 72 {
        base.truncate(72);
    }
    let hash = sha256_hex(document_id.as_bytes());
    format!(
        "{}-{}.{}",
        base,
        &hash[..12.min(hash.len())],
        extension.trim_start_matches('.')
    )
}

fn asset_file_name(asset_id: &str, media_type: &str) -> String {
    let extension = media_type_extension(media_type);
    let hash = sha256_hex(asset_id.as_bytes());
    format!("asset-{}.{}", &hash[..24.min(hash.len())], extension)
}

fn media_type_extension(media_type: &str) -> &'static str {
    let lower = media_type.to_ascii_lowercase();
    if lower.contains("png") {
        "png"
    } else if lower.contains("jpeg") || lower.contains("jpg") {
        "jpg"
    } else if lower.contains("webp") {
        "webp"
    } else if lower.contains("gif") {
        "gif"
    } else if lower.contains("pdf") {
        "pdf"
    } else if lower.contains("wordprocessingml") || lower.contains("docx") {
        "docx"
    } else {
        "bin"
    }
}

fn remove_cached_document_files(
    conn: &Connection,
    backend: &Backend,
    document_id: &str,
) -> Result<()> {
    let paths = conn
        .query_row(
            "SELECT local_markdown_path, local_json_path FROM knowledge_documents WHERE document_id = ?1",
            params![document_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((markdown_path, json_path)) = paths {
        for raw_path in [markdown_path, json_path] {
            let path = PathBuf::from(raw_path);
            if path.starts_with(backend.knowledge_documents_dir()) {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

fn render_cached_document(
    conn: &Connection,
    _backend: &Backend,
    document_id: &str,
) -> Result<Value> {
    let row = conn
        .query_row(
            "
            SELECT document_id, batch_id, document_type, title, summary, source_path,
                   source_hash, local_markdown_path, local_json_path, record_json, server_updated_at
            FROM knowledge_documents
            WHERE document_id = ?1
            ",
            params![document_id],
            |row| {
                Ok(json!({
                    "documentId": row.get::<_, String>(0)?,
                    "batchId": row.get::<_, String>(1)?,
                    "documentType": row.get::<_, String>(2)?,
                    "title": row.get::<_, String>(3)?,
                    "summary": row.get::<_, String>(4)?,
                    "sourcePath": row.get::<_, String>(5)?,
                    "sourceHash": row.get::<_, String>(6)?,
                    "localMarkdownPath": row.get::<_, String>(7)?,
                    "localJsonPath": row.get::<_, String>(8)?,
                    "record": serde_json::from_str::<Value>(&row.get::<_, String>(9)?).unwrap_or_else(|_| json!({})),
                    "serverUpdatedAt": row.get::<_, String>(10)?
                }))
            },
        )
        .optional()?;
    let Some(document) = row else {
        return Ok(json!({ "ok": false, "missing": true, "documentId": document_id }));
    };
    let mut section_stmt = conn.prepare(
        "
        SELECT section_id, title, level, position, record_json
        FROM knowledge_sections
        WHERE document_id = ?1
        ORDER BY position ASC, section_id ASC
        ",
    )?;
    let sections = section_stmt
        .query_map(params![document_id], |row| {
            Ok(json!({
                "sectionId": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "level": row.get::<_, i64>(2)?,
                "position": row.get::<_, i64>(3)?,
                "record": serde_json::from_str::<Value>(&row.get::<_, String>(4)?).unwrap_or_else(|_| json!({}))
            }))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut block_stmt = conn.prepare(
        "
        SELECT block_id, section_id, block_type, title, snippet, text, position, record_json
        FROM knowledge_blocks
        WHERE document_id = ?1
        ORDER BY position ASC, block_id ASC
        ",
    )?;
    let blocks = block_stmt
        .query_map(params![document_id], |row| {
            Ok(json!({
                "blockId": row.get::<_, String>(0)?,
                "sectionId": row.get::<_, String>(1)?,
                "blockType": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "snippet": row.get::<_, String>(4)?,
                "text": row.get::<_, String>(5)?,
                "position": row.get::<_, i64>(6)?,
                "record": serde_json::from_str::<Value>(&row.get::<_, String>(7)?).unwrap_or_else(|_| json!({}))
            }))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut asset_stmt = conn.prepare(
        "
        SELECT asset_id, title, media_type, caption, ocr_text, local_path, record_json
        FROM knowledge_assets
        WHERE document_id = ?1
        ORDER BY title ASC, asset_id ASC
        ",
    )?;
    let assets = asset_stmt
        .query_map(params![document_id], |row| {
            Ok(json!({
                "assetId": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "mediaType": row.get::<_, String>(2)?,
                "caption": row.get::<_, String>(3)?,
                "ocrText": row.get::<_, String>(4)?,
                "localPath": row.get::<_, String>(5)?,
                "record": serde_json::from_str::<Value>(&row.get::<_, String>(6)?).unwrap_or_else(|_| json!({}))
            }))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let markdown = render_cached_document_markdown(&document, &sections, &blocks, &assets);
    let markdown_path = document
        .get("localMarkdownPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let json_path = document
        .get("localJsonPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !markdown_path.is_empty() {
        atomic_write_text(&PathBuf::from(markdown_path), &markdown)?;
    }
    if !json_path.is_empty() {
        atomic_write_json(
            &PathBuf::from(json_path),
            &json!({
                "schemaVersion": "pact.client.knowledge.document.v1",
                "document": document,
                "sections": sections,
                "blocks": blocks,
                "assets": assets
            }),
        )?;
    }
    Ok(json!({
        "ok": true,
        "documentId": document_id,
        "markdownPath": markdown_path,
        "jsonPath": json_path
    }))
}

fn markdown_heading(level: i64) -> &'static str {
    match level {
        1 => "#",
        2 => "##",
        3 => "###",
        4 => "####",
        _ => "#####",
    }
}

fn render_cached_document_markdown(
    document: &Value,
    sections: &[Value],
    blocks: &[Value],
    assets: &[Value],
) -> String {
    let title = document
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("未命名知识文档");
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", title));
    let summary = document
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !summary.trim().is_empty() {
        out.push_str(summary.trim());
        out.push_str("\n\n");
    }
    out.push_str("## 文档信息\n\n");
    for (label, key) in [
        ("文档 ID", "documentId"),
        ("批次", "batchId"),
        ("类型", "documentType"),
        ("来源", "sourcePath"),
        ("服务端更新时间", "serverUpdatedAt"),
    ] {
        let value = document
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !value.trim().is_empty() {
            out.push_str(&format!("- {}: `{}`\n", label, value));
        }
    }
    out.push('\n');

    for section in sections {
        let section_id = section
            .get("sectionId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let section_title = section
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("正文");
        let level = section
            .get("level")
            .and_then(Value::as_i64)
            .unwrap_or(2)
            .clamp(2, 5);
        out.push_str(&format!(
            "{} {}\n\n",
            markdown_heading(level),
            section_title
        ));
        for block in blocks.iter().filter(|block| {
            block
                .get("sectionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                == section_id
        }) {
            let block_title = block
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let text = block
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !block_title.trim().is_empty() && block_title.trim() != section_title.trim() {
                out.push_str(&format!("### {}\n\n", block_title.trim()));
            }
            if text.trim().is_empty() {
                let snippet = block
                    .get("snippet")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !snippet.trim().is_empty() {
                    out.push_str(snippet.trim());
                    out.push_str("\n\n");
                }
            } else {
                out.push_str(text.trim());
                out.push_str("\n\n");
            }
        }
    }
    let unsectioned = blocks
        .iter()
        .filter(|block| {
            block
                .get("sectionId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .is_empty()
        })
        .collect::<Vec<_>>();
    if !unsectioned.is_empty() {
        out.push_str("## 其他内容\n\n");
        for block in unsectioned {
            if let Some(text) = block.get("text").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    out.push_str(text.trim());
                    out.push_str("\n\n");
                }
            }
        }
    }
    if !assets.is_empty() {
        out.push_str("## 资产\n\n");
        for asset in assets {
            let title = asset.get("title").and_then(Value::as_str).unwrap_or("资产");
            let local_path = asset
                .get("localPath")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let caption = asset
                .get("caption")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !local_path.trim().is_empty() {
                out.push_str(&format!("![{}]({})\n\n", title, local_path));
            } else {
                out.push_str(&format!("- {}: 未下载本地资产。\n", title));
            }
            if !caption.trim().is_empty() {
                out.push_str(caption.trim());
                out.push_str("\n\n");
            }
        }
    }
    out
}

fn http_binary_with_auth(
    url: &str,
    session: Option<&ConsoleServiceSession>,
) -> Result<(Vec<u8>, String)> {
    let response = apply_console_session_auth(http_binary_agent().get(url), "GET", session)
        .set("accept", "*/*")
        .call()?;
    let content_type = response
        .header("content-type")
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut reader = response.into_reader();
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    Ok((bytes, content_type))
}

fn http_binary(url: &str) -> Result<(Vec<u8>, String)> {
    http_binary_with_auth(url, None)
}

fn atomic_write_bytes(path: &Path, contents: &[u8]) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temp_path = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("tmp"),
        Uuid::new_v4()
    ));
    fs::write(&temp_path, contents)?;
    if cfg!(windows) && path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(temp_path, path)?;
    Ok(())
}

fn download_missing_knowledge_assets(
    conn: &Connection,
    backend: &Backend,
    service_url: &str,
    session: Option<&ConsoleServiceSession>,
) -> Result<()> {
    let mut stmt = conn.prepare(
        "
        SELECT asset_id, media_type
        FROM knowledge_assets
        WHERE local_path = ''
        ORDER BY server_updated_at ASC, asset_id ASC
        LIMIT 200
        ",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (asset_id, media_type) in rows {
        let file_name = asset_file_name(&asset_id, &media_type);
        let target = backend.knowledge_assets_dir().join(file_name);
        let url = format!(
            "{}/api/knowledge/assets/{}",
            service_url,
            url_escape(&asset_id)
        );
        let (bytes, _) = http_binary_with_auth(&url, session)?;
        atomic_write_bytes(&target, &bytes)?;
        conn.execute(
            "UPDATE knowledge_assets SET local_path = ?2 WHERE asset_id = ?1",
            params![asset_id, target.to_string_lossy().to_string()],
        )?;
    }
    Ok(())
}

fn download_missing_normalized_documents(
    conn: &Connection,
    backend: &Backend,
    service_url: &str,
    session: Option<&ConsoleServiceSession>,
) -> Result<()> {
    let mut stmt = conn.prepare(
        "
        SELECT document_id, batch_id, record_json
        FROM knowledge_documents
        WHERE document_type = 'normalized-docx'
        ORDER BY server_updated_at ASC, document_id ASC
        LIMIT 200
        ",
    )?;
    let documents = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                serde_json::from_str::<Value>(&row.get::<_, String>(2)?)
                    .unwrap_or_else(|_| json!({})),
            ))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (document_id, batch_id, record) in documents {
        if batch_id.trim().is_empty() {
            continue;
        }
        let manifest_document_id = record
            .get("metadata")
            .and_then(|metadata| metadata.get("documentId"))
            .and_then(Value::as_str)
            .or_else(|| record.get("sourceId").and_then(Value::as_str))
            .unwrap_or_default();
        if manifest_document_id.trim().is_empty() {
            continue;
        }
        let dir = backend
            .knowledge_normalized_documents_dir()
            .join(sanitize_file_token(&batch_id));
        let target = dir.join(document_file_name(
            record
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("normalized-document"),
            &document_id,
            "docx",
        ));
        if target.exists() {
            continue;
        }
        let url = format!(
            "{}/api/jobs/{}/normalized-documents/{}",
            service_url,
            url_escape(&batch_id),
            url_escape(manifest_document_id)
        );
        let (bytes, _) = match http_binary_with_auth(&url, session) {
            Ok(value) => value,
            Err(_) => continue,
        };
        atomic_write_bytes(&target, &bytes)?;
    }
    Ok(())
}

fn pending_knowledge_outbox(conn: &Connection) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare(
        "
        SELECT operation_id, entity_id, entity_type, base_revision, field_patch_json, client_id, created_at
        FROM knowledge_outbox
        WHERE status = 'pending'
        ORDER BY created_at ASC
        ",
    )?;
    let rows = stmt.query_map([], |row| {
        let patch: String = row.get(4)?;
        Ok(json!({
            "operationId": row.get::<_, String>(0)?,
            "entityId": row.get::<_, String>(1)?,
            "entityType": row.get::<_, String>(2)?,
            "baseRevision": row.get::<_, i64>(3)?,
            "fieldPatch": serde_json::from_str::<Value>(&patch).unwrap_or_else(|_| json!({})),
            "clientId": row.get::<_, String>(5)?,
            "createdAt": row.get::<_, String>(6)?
        }))
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn mark_knowledge_outbox(
    conn: &Connection,
    operation_id: &str,
    status: &str,
    response: &Value,
) -> Result<()> {
    conn.execute(
        "
        UPDATE knowledge_outbox
        SET status = ?2, submitted_at = ?3, server_response_json = ?4
        WHERE operation_id = ?1
        ",
        params![operation_id, status, timestamp(), record_json(response)?],
    )?;
    Ok(())
}

fn apply_knowledge_push_result(conn: &Connection, payload: &Value) -> Result<()> {
    for item in payload
        .get("accepted")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if let Some(operation_id) = item.get("operationId").and_then(Value::as_str) {
            mark_knowledge_outbox(conn, operation_id, "synced", &item)?;
            if let Some(record) = item.get("item") {
                let updated_at = record
                    .get("serverUpdatedAt")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                upsert_cached_item(conn, record, updated_at)?;
            }
        }
    }
    for item in payload
        .get("duplicates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if let Some(operation_id) = item.get("operationId").and_then(Value::as_str) {
            mark_knowledge_outbox(conn, operation_id, "synced", &item)?;
        }
    }
    for item in payload
        .get("conflicts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if let Some(operation_id) = item.get("operationId").and_then(Value::as_str) {
            mark_knowledge_outbox(conn, operation_id, "conflict", &item)?;
        }
        if let Some(review_item) = item.get("reviewItem") {
            let updated_at = review_item
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or_default();
            upsert_cached_review_item(conn, review_item, updated_at)?;
        }
    }
    for item in payload
        .get("rejected")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        if let Some(operation_id) = item.get("operationId").and_then(Value::as_str) {
            mark_knowledge_outbox(conn, operation_id, "rejected", &item)?;
        }
    }
    Ok(())
}

fn queue_knowledge_change(
    conn: &Connection,
    config: &ClientConfig,
    params: &Value,
) -> Result<Value> {
    let entity_id = params
        .get("entityId")
        .or_else(|| params.get("itemId"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if entity_id.is_empty() {
        return Err(anyhow!("entityId is required"));
    }
    let operation_id = params
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let entity_type = params
        .get("entityType")
        .or_else(|| params.get("itemType"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let base_revision = params
        .get("baseRevision")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let field_patch = params
        .get("fieldPatch")
        .or_else(|| params.get("patch"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !field_patch.is_object() {
        return Err(anyhow!("fieldPatch must be an object"));
    }
    let client_id = params
        .get("clientId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            if config.client_id.trim().is_empty() {
                "local-client".to_string()
            } else {
                config.client_id.clone()
            }
        });
    let created_at = params
        .get("createdAt")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(timestamp);
    conn.execute(
        "
        INSERT INTO knowledge_outbox (
          operation_id, entity_id, entity_type, base_revision, field_patch_json, client_id,
          status, created_at, submitted_at, server_response_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, '', '{}')
        ON CONFLICT(operation_id) DO UPDATE SET
          entity_id = excluded.entity_id,
          entity_type = excluded.entity_type,
          base_revision = excluded.base_revision,
          field_patch_json = excluded.field_patch_json,
          client_id = excluded.client_id,
          status = 'pending',
          created_at = excluded.created_at,
          submitted_at = '',
          server_response_json = '{}'
        ",
        params![
            operation_id,
            entity_id,
            entity_type,
            base_revision,
            record_json(&field_patch)?,
            client_id,
            created_at
        ],
    )?;
    Ok(json!({
        "ok": true,
        "operationId": operation_id,
        "entityId": entity_id,
        "entityType": entity_type,
        "baseRevision": base_revision,
        "fieldPatch": field_patch,
        "clientId": client_id,
        "status": "pending",
        "createdAt": created_at
    }))
}

fn search_knowledge_cache(conn: &Connection, query: &str, limit: usize) -> Result<Value> {
    let safe_limit = limit.clamp(1, 200) as i64;
    let normalized = query.trim();
    let document_items = search_knowledge_documents(conn, normalized, safe_limit as usize)?;
    if !document_items.is_empty() {
        let total = document_items.len();
        return Ok(json!({
            "ok": true,
            "query": normalized,
            "limit": safe_limit,
            "items": document_items,
            "total": total,
            "source": "local-knowledge-mirror"
        }));
    }
    let rows = if normalized.is_empty() {
        let mut stmt = conn.prepare(
            "
            SELECT item_id, item_type, title, summary, status, revision, server_updated_at, record_json
            FROM knowledge_items
            ORDER BY server_updated_at DESC, revision DESC
            LIMIT ?1
            ",
        )?;
        stmt.query_map(params![safe_limit], cached_item_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?
    } else {
        let like = format!("%{}%", normalized);
        let mut stmt = conn.prepare(
            "
            SELECT item_id, item_type, title, summary, status, revision, server_updated_at, record_json
            FROM knowledge_items
            WHERE title LIKE ?1 OR summary LIKE ?1 OR item_type LIKE ?1 OR record_json LIKE ?1
            ORDER BY server_updated_at DESC, revision DESC
            LIMIT ?2
            ",
        )?;
        stmt.query_map(params![like, safe_limit], cached_item_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };

    let mut items = Vec::new();
    for mut item in rows {
        let item_id = item
            .get("itemId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let snippet: Option<String> = conn
            .query_row(
                "SELECT snippet FROM knowledge_chunks WHERE item_id = ?1 ORDER BY server_updated_at DESC LIMIT 1",
                params![item_id],
                |row| row.get(0),
            )
            .optional()?;
        let evidence_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM knowledge_evidence WHERE item_id = ?1",
            params![item_id],
            |row| row.get(0),
        )?;
        let fallback_summary = item
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .take(180)
            .collect::<String>();
        if let Some(object) = item.as_object_mut() {
            object.insert(
                "snippet".to_string(),
                json!(snippet.unwrap_or(fallback_summary)),
            );
            object.insert("evidenceCount".to_string(), json!(evidence_count));
        }
        items.push(item);
    }

    Ok(json!({
        "ok": true,
        "query": normalized,
        "limit": safe_limit,
        "items": items,
        "total": items.len(),
        "source": "knowledge-summary"
    }))
}

fn search_knowledge_documents(conn: &Connection, query: &str, limit: usize) -> Result<Vec<Value>> {
    let safe_limit = limit.clamp(1, 200) as i64;
    if query.trim().is_empty() {
        let mut stmt = conn.prepare(
            "
            SELECT document_id, title, summary, document_type, batch_id, local_markdown_path,
                   server_updated_at, record_json
            FROM knowledge_documents
            ORDER BY server_updated_at DESC, document_id ASC
            LIMIT ?1
            ",
        )?;
        return stmt
            .query_map(params![safe_limit], cached_document_search_row)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into);
    }

    let fts_query = query
        .split_whitespace()
        .filter(|token| !token.trim().is_empty())
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ");
    if !fts_query.trim().is_empty() {
        let stmt = conn.prepare(
            "
            SELECT d.document_id, d.title, d.summary, d.document_type, d.batch_id,
                   d.local_markdown_path, d.server_updated_at, d.record_json,
                   b.snippet
            FROM knowledge_blocks_fts f
            JOIN knowledge_blocks b ON b.block_id = f.block_id
            JOIN knowledge_documents d ON d.document_id = b.document_id
            WHERE knowledge_blocks_fts MATCH ?1
            GROUP BY d.document_id
            ORDER BY d.server_updated_at DESC
            LIMIT ?2
            ",
        );
        if let Ok(mut stmt) = stmt {
            if let Ok(rows) = stmt.query_map(params![fts_query, safe_limit], |row| {
                let mut item = cached_document_search_row(row)?;
                if let Some(object) = item.as_object_mut() {
                    object.insert("snippet".to_string(), json!(row.get::<_, String>(8)?));
                }
                Ok(item)
            }) {
                let found = rows.collect::<std::result::Result<Vec<_>, _>>()?;
                if !found.is_empty() {
                    return Ok(found);
                }
            }
        }
    }

    let like = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "
        SELECT d.document_id, d.title, d.summary, d.document_type, d.batch_id,
               d.local_markdown_path, d.server_updated_at, d.record_json,
               COALESCE((
                 SELECT snippet FROM knowledge_blocks
                 WHERE document_id = d.document_id
                   AND (title LIKE ?1 OR text LIKE ?1 OR snippet LIKE ?1)
                 ORDER BY position ASC
                 LIMIT 1
               ), d.summary) AS snippet
        FROM knowledge_documents d
        WHERE d.title LIKE ?1 OR d.summary LIKE ?1 OR d.document_type LIKE ?1
           OR EXISTS (
             SELECT 1 FROM knowledge_blocks b
             WHERE b.document_id = d.document_id
               AND (b.title LIKE ?1 OR b.text LIKE ?1 OR b.snippet LIKE ?1)
           )
        ORDER BY d.server_updated_at DESC, d.document_id ASC
        LIMIT ?2
        ",
    )?;
    stmt.query_map(params![like, safe_limit], |row| {
        let mut item = cached_document_search_row(row)?;
        if let Some(object) = item.as_object_mut() {
            object.insert("snippet".to_string(), json!(row.get::<_, String>(8)?));
        }
        Ok(item)
    })?
    .collect::<std::result::Result<Vec<_>, _>>()
    .map_err(Into::into)
}

fn cached_document_search_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let record_json: String = row.get(7)?;
    Ok(json!({
        "itemId": row.get::<_, String>(0)?,
        "documentId": row.get::<_, String>(0)?,
        "itemType": row.get::<_, String>(3)?,
        "documentType": row.get::<_, String>(3)?,
        "title": row.get::<_, String>(1)?,
        "summary": row.get::<_, String>(2)?,
        "batchId": row.get::<_, String>(4)?,
        "localMarkdownPath": row.get::<_, String>(5)?,
        "serverUpdatedAt": row.get::<_, String>(6)?,
        "record": serde_json::from_str::<Value>(&record_json).unwrap_or_else(|_| json!({})),
        "evidenceCount": 0
    }))
}

fn knowledge_cache_graph(
    conn: &Connection,
    seed: &str,
    depth: usize,
    limit: usize,
) -> Result<Value> {
    let safe_depth = depth.min(3);
    let safe_limit = limit.clamp(1, 500);
    let mut nodes = HashMap::<String, Value>::new();
    let mut edges = HashMap::<String, Value>::new();
    let mut queue = vec![(seed.trim().to_string(), 0usize)];
    let mut visited = HashMap::<String, bool>::new();

    while let Some((node_id, current_depth)) = queue.pop() {
        if node_id.is_empty() || visited.contains_key(&node_id) || nodes.len() >= safe_limit {
            continue;
        }
        visited.insert(node_id.clone(), true);

        if let Some(record_json) = conn
            .query_row(
                "SELECT record_json FROM knowledge_graph_nodes WHERE node_id = ?1",
                params![node_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            nodes.insert(
                node_id.clone(),
                serde_json::from_str(&record_json).unwrap_or_else(|_| json!({ "nodeId": node_id })),
            );
        }

        if current_depth >= safe_depth {
            continue;
        }

        let mut stmt = conn.prepare(
            "
            SELECT edge_id, source_id, target_id, record_json
            FROM knowledge_graph_edges
            WHERE source_id = ?1 OR target_id = ?1
            ORDER BY weight DESC, edge_id ASC
            LIMIT ?2
            ",
        )?;
        let rows = stmt.query_map(params![node_id, safe_limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        for row in rows {
            let (edge_id, source_id, target_id, raw_record) = row?;
            edges.insert(
                edge_id,
                serde_json::from_str(&raw_record).unwrap_or_else(|_| {
                    json!({
                        "sourceId": source_id,
                        "targetId": target_id
                    })
                }),
            );
            let next_id = if source_id == node_id {
                target_id
            } else {
                source_id
            };
            if !visited.contains_key(&next_id) {
                queue.push((next_id, current_depth + 1));
            }
        }
    }

    Ok(json!({
        "ok": true,
        "seed": seed.trim(),
        "depth": safe_depth,
        "nodes": nodes.values().cloned().collect::<Vec<_>>(),
        "edges": edges.values().cloned().collect::<Vec<_>>()
    }))
}

fn cached_item_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let record_json: String = row.get(7)?;
    Ok(json!({
        "itemId": row.get::<_, String>(0)?,
        "itemType": row.get::<_, String>(1)?,
        "title": row.get::<_, String>(2)?,
        "summary": row.get::<_, String>(3)?,
        "status": row.get::<_, String>(4)?,
        "revision": row.get::<_, i64>(5)?,
        "serverUpdatedAt": row.get::<_, String>(6)?,
        "record": serde_json::from_str::<Value>(&record_json).unwrap_or_else(|_| json!({}))
    }))
}

fn url_escape(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect::<Vec<_>>(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::{Arc, Mutex};
    use std::thread;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("pact-{}-{}", name, Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn cleanup(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }

    fn make_backend(name: &str) -> (PathBuf, Backend) {
        let dir = unique_temp_dir(name);
        let backend = Backend::new(dir.clone()).unwrap();
        (dir, backend)
    }

    #[derive(Debug, Clone)]
    struct TestHttpRequest {
        method: String,
        path: String,
        headers: BTreeMap<String, String>,
        body: Vec<u8>,
    }

    fn read_test_http_request(stream: &mut TcpStream) -> TestHttpRequest {
        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let read = stream.read(&mut chunk).unwrap();
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if find_header_end(&buffer).is_some() {
                break;
            }
        }

        let header_end = find_header_end(&buffer).expect("request should contain headers");
        let header_text = String::from_utf8_lossy(&buffer[..header_end]).to_string();
        let content_length = content_length(&header_text).unwrap_or(0);
        let body_start = header_end + 4;
        while buffer.len() < body_start + content_length {
            let read = stream.read(&mut chunk).unwrap();
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
        }

        let mut lines = header_text.lines();
        let request_line = lines.next().unwrap_or_default();
        let mut request_parts = request_line.split_whitespace();
        let method = request_parts.next().unwrap_or_default().to_string();
        let path = request_parts.next().unwrap_or_default().to_string();
        let headers = lines
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
            .collect::<BTreeMap<_, _>>();

        TestHttpRequest {
            method,
            path,
            headers,
            body: buffer[body_start..buffer.len().min(body_start + content_length)].to_vec(),
        }
    }

    fn write_test_json_response(
        stream: &mut TcpStream,
        status: u16,
        payload: &Value,
        extra_headers: &[(&str, &str)],
    ) {
        let reason = if status == 200 { "OK" } else { "ERROR" };
        let body = serde_json::to_vec(payload).unwrap();
        let mut header = format!(
            "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n",
            status,
            reason,
            body.len()
        );
        for (name, value) in extra_headers {
            header.push_str(&format!("{}: {}\r\n", name, value));
        }
        header.push_str("\r\n");
        stream.write_all(header.as_bytes()).unwrap();
        stream.write_all(&body).unwrap();
    }

    fn spawn_console_auth_test_server(
        expected_requests: usize,
    ) -> (
        String,
        Arc<Mutex<Vec<TestHttpRequest>>>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let seen_requests = Arc::new(Mutex::new(Vec::new()));
        let seen_requests_thread = Arc::clone(&seen_requests);
        let handle = thread::spawn(move || {
            for _ in 0..expected_requests {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_test_http_request(&mut stream);
                let path = request.path.clone();
                seen_requests_thread.lock().unwrap().push(request);
                if path == "/api/auth/login" {
                    write_test_json_response(
                        &mut stream,
                        200,
                        &json!({
                            "ok": true,
                            "csrfToken": "csrf_test"
                        }),
                        &[("Set-Cookie", "pact_console_session=session_test; Path=/")],
                    );
                } else {
                    write_test_json_response(
                        &mut stream,
                        200,
                        &json!({
                            "ok": true,
                            "path": path
                        }),
                        &[],
                    );
                }
            }
        });
        (base_url, seen_requests, handle)
    }

    fn sample_vocab(checksum: &str) -> ExpertVocabulary {
        ExpertVocabulary {
            schema_version: 1,
            version: 7,
            updated_at: "unix:7".into(),
            published_at: "unix:7".into(),
            source: "test".into(),
            checksum: checksum.into(),
            entries: vec![
                ExpertVocabularyEntry {
                    id: "contract".into(),
                    path_segments: vec!["专家".into(), "合同".into()],
                    label: "合同".into(),
                    keywords: vec!["msa".into(), "framework agreement".into()],
                    domains: vec!["legal.example".into()],
                    status: "active".into(),
                    notes: String::new(),
                },
                ExpertVocabularyEntry {
                    id: "finance".into(),
                    path_segments: vec!["专家".into(), "财务".into()],
                    label: "财务".into(),
                    keywords: vec!["settlement".into()],
                    domains: vec!["finance.example".into()],
                    status: "active".into(),
                    notes: String::new(),
                },
            ],
        }
    }

    fn save_vocab(backend: &Backend, vocabulary: &ExpertVocabulary) {
        backend.save_expert_vocabulary(vocabulary).unwrap();
    }

    #[test]
    fn prepare_mail_import_workspace_clears_stale_run_files() {
        let (dir, backend) = make_backend("mail-import-prepare");
        let tmp_dir = backend.mail_workspace().join("tmp");
        fs::create_dir_all(&tmp_dir).unwrap();
        fs::write(
            tmp_dir.join("progress.tsv"),
            "exported\t4\t75712\t4\t0\t0\tOld\told.eml\n",
        )
        .unwrap();
        fs::write(tmp_dir.join("manifest.tsv"), "4\tOld\n").unwrap();
        fs::write(tmp_dir.join("index-events.tsv"), "4\told\n").unwrap();
        fs::write(tmp_dir.join("dedupe-requests.tsv"), "4\told\n").unwrap();
        fs::write(tmp_dir.join("control.pause"), "paused").unwrap();
        fs::write(tmp_dir.join("control.cancel"), "cancelled").unwrap();
        atomic_write_json(
            &tmp_dir.join("diagnostics.json"),
            &json!({ "status": "completed", "exportedCount": 4 }),
        )
        .unwrap();

        backend.prepare_mail_import_workspace().unwrap();

        assert_eq!(
            fs::read_to_string(tmp_dir.join("progress.tsv")).unwrap(),
            ""
        );
        assert_eq!(
            fs::read_to_string(tmp_dir.join("manifest.tsv")).unwrap(),
            ""
        );
        assert_eq!(
            fs::read_to_string(tmp_dir.join("index-events.tsv")).unwrap(),
            ""
        );
        assert_eq!(
            fs::read_to_string(tmp_dir.join("dedupe-requests.tsv")).unwrap(),
            ""
        );
        assert!(!tmp_dir.join("control.pause").exists());
        assert!(!tmp_dir.join("control.cancel").exists());
        let diagnostics = read_json_file(&tmp_dir.join("diagnostics.json")).unwrap();
        assert_eq!(diagnostics["status"], "starting");
        assert!(diagnostics.get("exportedCount").is_none());
        cleanup(&dir);
    }

    #[test]
    fn mail_import_status_marks_dead_running_pid_failed() {
        let (dir, backend) = make_backend("mail-import-dead-pid");
        atomic_write_json(
            &backend.mail_import_state_path(),
            &json!({
                "schemaVersion": BACKEND_SCHEMA_VERSION,
                "protocolVersion": PROTOCOL_VERSION,
                "status": "running",
                "pid": 999_999_999_u64,
            }),
        )
        .unwrap();

        let status = backend.mail_import_status().unwrap();

        assert_eq!(status["running"], false);
        assert_eq!(status["status"], "failed");
        cleanup(&dir);
    }

    fn write_docs(backend: &Backend, lines: &[&str]) {
        fs::create_dir_all(backend.docs_tsv_path().parent().unwrap()).unwrap();
        let mut text = lines.join("\n");
        if !text.is_empty() {
            text.push('\n');
        }
        fs::write(backend.docs_tsv_path(), text).unwrap();
    }

    fn doc_line(id: u64, subject: &str, sender: &str, mailbox: &str, taxonomy: &str) -> String {
        format!(
            "{}\tm{}\tmail-{}.eml\t{}\t{}\t\t\t\t\t\t{}\tok\t\t\t\t0\t{}",
            id, id, id, subject, sender, mailbox, taxonomy
        )
    }

    #[test]
    fn merges_active_and_retired_vocabulary_rules() {
        let vocabulary = ExpertVocabulary {
            entries: vec![
                ExpertVocabularyEntry {
                    path_segments: vec!["开发".into(), "客户端".into(), "macOS".into()],
                    keywords: vec!["sonoma".into()],
                    domains: vec!["developer.apple.com".into()],
                    status: "active".into(),
                    ..ExpertVocabularyEntry::default()
                },
                ExpertVocabularyEntry {
                    path_segments: vec!["购物".into(), "宠物".into(), "用品".into()],
                    status: "retired".into(),
                    ..ExpertVocabularyEntry::default()
                },
                ExpertVocabularyEntry {
                    path_segments: vec!["专家".into(), "合同".into()],
                    keywords: vec!["msa".into()],
                    domains: vec!["legal.example".into()],
                    status: "active".into(),
                    ..ExpertVocabularyEntry::default()
                },
            ],
            ..ExpertVocabulary::default()
        };
        let rules = merged_taxonomy_rules(&vocabulary);
        assert!(rules.iter().any(|rule| rule.path == "专家/合同"));
        assert!(rules.iter().any(|rule| {
            rule.path == "开发/客户端/macOS" && rule.keywords == vec!["sonoma".to_string()]
        }));
        assert!(!rules.iter().any(|rule| rule.path == "购物/宠物/用品"));
    }

    #[test]
    fn rewrites_docs_tsv_taxonomy_with_expert_rules() {
        let dir = unique_temp_dir("docs");
        let docs = dir.join("index").join("docs.tsv");
        fs::create_dir_all(docs.parent().unwrap()).unwrap();
        fs::write(
            &docs,
            "1\tm1\tmail.eml\tMSA review\tlegal@example.com\t\t\t\t\t\tInbox\tok\t\t\t\t0\t未分类\n",
        )
        .unwrap();
        let vocabulary = ExpertVocabulary {
            checksum: "checksum-a".into(),
            entries: vec![ExpertVocabularyEntry {
                path_segments: vec!["专家".into(), "合同".into()],
                keywords: vec!["msa".into()],
                domains: vec!["example.com".into()],
                status: "active".into(),
                ..ExpertVocabularyEntry::default()
            }],
            ..ExpertVocabulary::default()
        };
        let result = rewrite_docs_tsv_with_taxonomy(&docs, &vocabulary).unwrap();
        assert_eq!(result.document_count, 1);
        assert_eq!(result.updated_document_count, 1);
        let updated = fs::read_to_string(&docs).unwrap();
        assert!(updated.contains("专家/合同"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn initialize_shared_files_creates_backend_protocol_files() {
        let (dir, backend) = make_backend("shared-init");
        backend.initialize_shared_files().unwrap();

        assert!(backend.capabilities_path().exists());
        assert!(backend.runtime_state_path().exists());
        assert!(backend.command_inbox_dir().is_dir());
        assert!(backend.command_results_dir().is_dir());
        assert!(backend.events_path().exists());

        let state: ClientBackendRuntimeState =
            serde_json::from_str(&fs::read_to_string(backend.runtime_state_path()).unwrap())
                .unwrap();
        assert_eq!(state.protocol_version, PROTOCOL_VERSION);
        assert_eq!(state.daemon_status, "running");
        assert_eq!(state.data_directory, dir.to_string_lossy());
        cleanup(&dir);
    }

    #[test]
    fn initialize_shared_files_recovers_stale_processing_commands() {
        let (dir, backend) = make_backend("shared-init-recover");
        fs::create_dir_all(backend.command_processing_dir()).unwrap();
        fs::create_dir_all(backend.command_results_dir()).unwrap();

        atomic_write_json(
            &backend.command_processing_dir().join("retry-me.json"),
            &json!({
                "schemaVersion": 1,
                "protocolVersion": PROTOCOL_VERSION,
                "commandId": "retry-me",
                "method": "mail.index.stats",
                "params": {},
                "createdAt": "unix:1"
            }),
        )
        .unwrap();
        atomic_write_json(
            &backend
                .command_processing_dir()
                .join("already-finished.json"),
            &json!({
                "schemaVersion": 1,
                "protocolVersion": PROTOCOL_VERSION,
                "commandId": "already-finished",
                "method": "mail.index.stats",
                "params": {},
                "createdAt": "unix:1"
            }),
        )
        .unwrap();
        atomic_write_json(
            &backend.command_result_path("already-finished"),
            &BackendCommandResult::success(
                "already-finished",
                "mail.index.stats",
                json!({ "ok": true }),
                "unix:1",
                "unix:2",
                "trace_test",
            ),
        )
        .unwrap();

        backend.initialize_shared_files().unwrap();

        assert!(backend.command_inbox_dir().join("retry-me.json").exists());
        assert!(backend
            .command_done_dir()
            .join("already-finished.json")
            .exists());
        assert!(!backend
            .command_processing_dir()
            .join("retry-me.json")
            .exists());
        assert!(!backend
            .command_processing_dir()
            .join("already-finished.json")
            .exists());
        cleanup(&dir);
    }

    #[test]
    fn patch_settings_preserves_unknown_fields_and_records_vocabulary() {
        let (dir, backend) = make_backend("settings-patch");
        atomic_write_json(
            &backend.settings_path(),
            &json!({
                "clientId": "client-a",
                "unknownFeatureFlag": true,
                "nested": { "keep": "me" }
            }),
        )
        .unwrap();

        let vocabulary = sample_vocab("checksum-settings");
        backend
            .patch_settings_after_vocabulary_pull(&vocabulary)
            .unwrap();

        let updated: Value =
            serde_json::from_str(&fs::read_to_string(backend.settings_path()).unwrap()).unwrap();
        assert_eq!(updated["clientId"], "client-a");
        assert_eq!(updated["unknownFeatureFlag"], true);
        assert_eq!(updated["nested"]["keep"], "me");
        assert_eq!(updated["lastExpertVocabularyVersion"], 7);
        assert_eq!(updated["lastExpertVocabularyChecksum"], "checksum-settings");
        assert!(updated["lastExpertVocabularyPulledAt"]
            .as_str()
            .unwrap()
            .starts_with("unix:"));
        cleanup(&dir);
    }

    #[test]
    fn mail_index_stats_counts_docs_and_segments() {
        let (dir, backend) = make_backend("mail-stats");
        write_docs(
            &backend,
            &[
                &doc_line(1, "MSA review", "legal@example.com", "Inbox", "未分类"),
                &doc_line(2, "Settlement", "finance@example.com", "Inbox", "未分类"),
                "",
            ],
        );
        fs::write(backend.mail_index_dir().join("a.lex"), "lex").unwrap();
        fs::write(backend.mail_index_dir().join("b.post"), "post").unwrap();
        write_index_state(
            &backend.mail_index_dir(),
            &MailIndexStats {
                document_count: 2,
                segment_count: 2,
                pending_count: 0,
                last_updated_at: String::new(),
                index_directory: backend.mail_index_dir().to_string_lossy().to_string(),
            },
            "sig",
        )
        .unwrap();

        let stats = backend.mail_index_stats().unwrap();
        assert_eq!(stats.document_count, 2);
        assert_eq!(stats.segment_count, 2);
        assert!(stats.last_updated_at.starts_with("unix:"));
        cleanup(&dir);
    }

    #[test]
    fn search_mail_index_applies_limit_and_offset() {
        let (dir, backend) = make_backend("mail-search");
        write_docs(
            &backend,
            &[
                &doc_line(
                    1,
                    "MSA review alpha",
                    "legal@example.com",
                    "Inbox",
                    "专家/合同",
                ),
                &doc_line(
                    2,
                    "MSA review beta",
                    "legal@example.com",
                    "Inbox",
                    "专家/合同",
                ),
                &doc_line(
                    3,
                    "MSA review gamma",
                    "legal@example.com",
                    "Inbox",
                    "专家/合同",
                ),
            ],
        );

        let response = backend.search_mail_index("msa", 1, 1).unwrap();
        assert_eq!(response.total, 3);
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].doc_id, 2);
        assert_eq!(response.results[0].taxonomy_path, "专家/合同");
        cleanup(&dir);
    }

    #[test]
    fn knowledge_cache_applies_sync_payload_and_searches_locally() {
        let (dir, backend) = make_backend("knowledge-cache");
        let payload = json!({
            "cursor": "4",
            "latestCursor": "4",
            "changes": [
                {
                    "kind": "item",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "itemId": "transaction::contract-renewal",
                        "entityId": "contract-renewal",
                        "itemType": "transaction",
                        "title": "合同续签推进",
                        "summary": "预算已经确认，等待盖章。",
                        "status": "active",
                        "revision": 2
                    }
                },
                {
                    "kind": "chunk",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "chunkId": "batch-1::chunk::a",
                        "itemId": "transaction::contract-renewal",
                        "snippet": "等待盖章",
                        "text": "预算已经确认，等待盖章。"
                    }
                },
                {
                    "kind": "evidence",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "evidenceId": "batch-1::evidence::a",
                        "itemId": "transaction::contract-renewal",
                        "snippet": "邮件证据",
                        "locator": { "batchId": "batch-1" }
                    }
                },
                {
                    "kind": "graphNode",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "nodeId": "transaction::contract-renewal",
                        "itemId": "transaction::contract-renewal",
                        "label": "合同续签推进",
                        "nodeType": "transaction",
                        "weight": 1
                    }
                },
                {
                    "kind": "graphNode",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "nodeId": "person::alice@example.com",
                        "itemId": "person::alice@example.com",
                        "label": "Alice",
                        "nodeType": "person",
                        "weight": 0.8
                    }
                },
                {
                    "kind": "graphEdge",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "edgeId": "edge::alice::contract",
                        "sourceId": "person::alice@example.com",
                        "targetId": "transaction::contract-renewal",
                        "label": "participates",
                        "weight": 0.8
                    }
                },
                {
                    "kind": "suggestion",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "suggestionId": "suggestion::rankingRule::contract",
                        "type": "rankingRule",
                        "status": "pending",
                        "confidence": 0.62,
                        "proposedPatch": {
                            "query": "合同"
                        }
                    }
                }
            ]
        });

        let stats = backend.apply_knowledge_sync_payload(&payload).unwrap();
        assert_eq!(stats["itemCount"], 1);
        assert_eq!(stats["pendingSuggestionCount"], 1);
        assert_eq!(stats["serverCursor"], "4");

        let search = backend
            .search_knowledge_cache(json!({ "query": "合同", "limit": 10 }))
            .unwrap();
        assert_eq!(search["total"], 1);
        assert_eq!(
            search["items"][0]["itemId"],
            "transaction::contract-renewal"
        );
        assert_eq!(search["items"][0]["snippet"], "等待盖章");
        assert_eq!(search["items"][0]["evidenceCount"], 1);

        let graph = backend
            .knowledge_cache_graph(json!({
                "seed": "transaction::contract-renewal",
                "depth": 1
            }))
            .unwrap();
        assert_eq!(graph["nodes"].as_array().unwrap().len(), 2);
        assert_eq!(graph["edges"].as_array().unwrap().len(), 1);
        cleanup(&dir);
    }

    #[test]
    fn knowledge_change_queue_persists_outbox_entry() {
        let (dir, backend) = make_backend("knowledge-outbox");
        backend
            .save_config_value(json!({ "clientId": "client-test" }))
            .unwrap();

        let queued = backend
            .queue_knowledge_change(json!({
                "operationId": "op-1",
                "entityId": "transaction::contract-renewal",
                "entityType": "transaction",
                "baseRevision": 2,
                "fieldPatch": {
                    "status": "watch",
                    "tags": ["盖章"]
                }
            }))
            .unwrap();
        assert_eq!(queued["operationId"], "op-1");
        assert_eq!(queued["clientId"], "client-test");

        let outbox = backend.list_pending_knowledge_changes().unwrap();
        assert_eq!(outbox["items"].as_array().unwrap().len(), 1);
        assert_eq!(outbox["items"][0]["fieldPatch"]["status"], "watch");
        cleanup(&dir);
    }

    #[test]
    fn knowledge_mirror_payload_renders_readable_markdown_and_tombstones() {
        let (dir, backend) = make_backend("knowledge-mirror");
        let payload = json!({
            "scope": "mirror",
            "cursor": "5",
            "latestCursor": "5",
            "changes": [
                {
                    "kind": "document",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "documentId": "doc-alpha",
                        "batchId": "job-alpha",
                        "documentType": "source",
                        "title": "Alpha Contract",
                        "summary": "Budget and signature workflow."
                    }
                },
                {
                    "kind": "section",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "sectionId": "section-alpha",
                        "documentId": "doc-alpha",
                        "title": "Overview",
                        "level": 2,
                        "position": 1
                    }
                },
                {
                    "kind": "block",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "blockId": "block-alpha",
                        "documentId": "doc-alpha",
                        "sectionId": "section-alpha",
                        "title": "Signature",
                        "text": "The Alpha contract waits for signature and invoice confirmation.",
                        "snippet": "waits for signature",
                        "position": 1
                    }
                },
                {
                    "kind": "asset",
                    "serverUpdatedAt": "2026-04-28T00:00:00.000Z",
                    "record": {
                        "assetId": "asset-alpha",
                        "documentId": "doc-alpha",
                        "sectionId": "section-alpha",
                        "mediaType": "image/png",
                        "title": "Contract screenshot",
                        "caption": "A readable image caption."
                    }
                }
            ]
        });
        let stats = backend.apply_knowledge_sync_payload(&payload).unwrap();
        assert_eq!(stats["documentCount"], 1);
        assert_eq!(stats["blockCount"], 1);
        assert_eq!(stats["serverCursor"], "5");

        let search = backend
            .search_knowledge_cache(json!({ "query": "signature", "limit": 10 }))
            .unwrap();
        assert_eq!(search["source"], "local-knowledge-mirror");
        assert_eq!(search["items"][0]["documentId"], "doc-alpha");

        let document = backend
            .get_knowledge_document(json!({ "documentId": "doc-alpha" }))
            .unwrap();
        let markdown_path = PathBuf::from(document["markdownPath"].as_str().unwrap());
        assert!(markdown_path.exists());
        let markdown = fs::read_to_string(markdown_path).unwrap();
        assert!(markdown.contains("# Alpha Contract"));
        assert!(markdown.contains("waits for signature"));

        backend
            .apply_knowledge_sync_payload(&json!({
                "cursor": "6",
                "latestCursor": "6",
                "changes": [
                    {
                        "kind": "tombstone",
                        "serverUpdatedAt": "2026-04-28T00:01:00.000Z",
                        "record": {
                            "targetKind": "document",
                            "documentId": "doc-alpha"
                        }
                    }
                ]
            }))
            .unwrap();
        let empty = backend
            .search_knowledge_cache(json!({ "query": "signature", "limit": 10 }))
            .unwrap();
        assert_eq!(empty["total"], 0);
        cleanup(&dir);
    }

    #[test]
    fn retired_vocabulary_rule_disables_builtin_path() {
        let vocabulary = ExpertVocabulary {
            entries: vec![ExpertVocabularyEntry {
                path_segments: vec!["购物".into(), "宠物".into(), "用品".into()],
                status: "retired".into(),
                ..ExpertVocabularyEntry::default()
            }],
            ..ExpertVocabulary::default()
        };
        let rules = merged_taxonomy_rules(&vocabulary);
        let taxonomy = classify_taxonomy(
            "Dog grooming appointment",
            "store@example.com",
            "Inbox",
            &rules,
        );
        assert_eq!(taxonomy, "未分类");
    }

    #[test]
    fn domain_suffix_classifies_taxonomy() {
        let vocabulary = ExpertVocabulary {
            entries: vec![ExpertVocabularyEntry {
                path_segments: vec!["专家".into(), "域名".into()],
                domains: vec!["example.com".into()],
                status: "active".into(),
                ..ExpertVocabularyEntry::default()
            }],
            ..ExpertVocabulary::default()
        };
        let taxonomy = classify_taxonomy(
            "Quarterly note",
            "Analyst <team@sub.example.com>",
            "Inbox",
            &merged_taxonomy_rules(&vocabulary),
        );
        assert_eq!(taxonomy, "专家/域名");
    }

    #[test]
    fn apply_vocabulary_without_docs_writes_state() {
        let (dir, backend) = make_backend("apply-no-docs");
        let vocabulary = sample_vocab("checksum-no-docs");
        save_vocab(&backend, &vocabulary);

        let result = backend.apply_vocabulary_to_index().unwrap();
        assert_eq!(result.document_count, 0);
        assert_eq!(result.updated_document_count, 0);
        assert!(backend.mail_index_dir().join("state.json").exists());

        let state: Value = serde_json::from_str(
            &fs::read_to_string(backend.mail_index_dir().join("state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(state["taxonomySignature"], "checksum-no-docs");
        cleanup(&dir);
    }

    #[test]
    fn unchanged_docs_report_zero_updates() {
        let (dir, backend) = make_backend("unchanged-docs");
        let vocabulary = sample_vocab("checksum-unchanged");
        save_vocab(&backend, &vocabulary);
        write_docs(
            &backend,
            &[&doc_line(
                1,
                "MSA review",
                "Legal <counsel@legal.example>",
                "Inbox",
                "专家/合同",
            )],
        );

        let result = backend.apply_vocabulary_to_index().unwrap();
        assert_eq!(result.document_count, 1);
        assert_eq!(result.updated_document_count, 0);
        cleanup(&dir);
    }

    #[test]
    fn process_pending_command_success_writes_result_and_done_file() {
        let (dir, backend) = make_backend("command-success");
        backend.initialize_shared_files().unwrap();
        let vocabulary = sample_vocab("checksum-command");
        save_vocab(&backend, &vocabulary);
        write_docs(
            &backend,
            &[&doc_line(
                1,
                "MSA review",
                "Legal <counsel@legal.example>",
                "Inbox",
                "未分类",
            )],
        );
        let command_id = "cmd-success";
        atomic_write_json(
            &backend
                .command_inbox_dir()
                .join(format!("{}.json", command_id)),
            &json!({
                "schemaVersion": 1,
                "protocolVersion": PROTOCOL_VERSION,
                "commandId": command_id,
                "method": "mail.index.rebuild",
                "params": {},
                "createdAt": "unix:1"
            }),
        )
        .unwrap();

        assert_eq!(backend.process_pending_commands().unwrap(), 1);
        assert!(backend.command_done_dir().join("cmd-success.json").exists());
        let result: BackendCommandResult = serde_json::from_str(
            &fs::read_to_string(backend.command_result_path(command_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(result.status, "completed");
        assert!(
            result.result.unwrap()["updatedDocumentCount"]
                .as_u64()
                .unwrap()
                >= 1
        );
        assert!(fs::read_to_string(backend.docs_tsv_path())
            .unwrap()
            .contains("专家/合同"));
        cleanup(&dir);
    }

    #[test]
    fn process_pending_command_error_writes_result() {
        let (dir, backend) = make_backend("command-error");
        backend.initialize_shared_files().unwrap();
        let command_id = "cmd-error";
        atomic_write_json(
            &backend
                .command_inbox_dir()
                .join(format!("{}.json", command_id)),
            &json!({
                "schemaVersion": 1,
                "protocolVersion": PROTOCOL_VERSION,
                "commandId": command_id,
                "method": "unknown.method",
                "params": {},
                "createdAt": "unix:1"
            }),
        )
        .unwrap();

        assert_eq!(backend.process_pending_commands().unwrap(), 1);
        let result: BackendCommandResult = serde_json::from_str(
            &fs::read_to_string(backend.command_result_path(command_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(result.status, "failed");
        assert!(result.error.unwrap().message.contains("unknown method"));
        cleanup(&dir);
    }

    #[test]
    fn task_cancel_command_creates_cancel_marker() {
        let (dir, backend) = make_backend("task-cancel");
        let value = backend
            .execute_method("task.cancel", json!({ "taskId": "blocked/../task" }), None)
            .unwrap();

        assert_eq!(value["cancelled"], true);
        assert!(backend.is_task_cancelled("blocked/../task"));
        assert!(backend
            .cancelled_tasks_dir()
            .join("blocked..task.cancel")
            .exists());
        cleanup(&dir);
    }

    #[test]
    fn cancelled_pending_command_writes_failed_result() {
        let (dir, backend) = make_backend("command-cancelled");
        backend.initialize_shared_files().unwrap();
        let command_id = "cmd-cancelled";
        backend.request_task_cancel(command_id).unwrap();
        atomic_write_json(
            &backend
                .command_inbox_dir()
                .join(format!("{}.json", command_id)),
            &json!({
                "schemaVersion": 1,
                "protocolVersion": PROTOCOL_VERSION,
                "commandId": command_id,
                "method": "mail.index.stats",
                "params": {},
                "createdAt": "unix:1"
            }),
        )
        .unwrap();

        assert_eq!(backend.process_pending_commands().unwrap(), 1);
        let result: BackendCommandResult = serde_json::from_str(
            &fs::read_to_string(backend.command_result_path(command_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(result.status, "failed");
        assert_eq!(result.error.unwrap().message, "task cancelled");
        cleanup(&dir);
    }

    #[test]
    fn events_subscribe_returns_offset_and_events() {
        let (dir, backend) = make_backend("events");
        backend
            .append_event("test.first", json!({ "n": 1 }))
            .unwrap();

        let first = backend
            .read_events_since(0, Duration::from_millis(0))
            .unwrap();
        assert_eq!(first["ok"], true);
        assert!(first["nextOffset"].as_u64().unwrap() > 0);
        assert_eq!(first["events"].as_array().unwrap().len(), 1);
        assert_eq!(first["events"][0]["type"], "test.first");

        let second = backend
            .read_events_since(
                first["nextOffset"].as_u64().unwrap(),
                Duration::from_millis(0),
            )
            .unwrap();
        assert!(second["events"].as_array().unwrap().is_empty());
        cleanup(&dir);
    }

    #[test]
    fn upload_queue_replays_control_events_from_event_log() {
        let (dir, backend) = make_backend("upload-queue-control");
        let fixture = dir.join("note.txt");
        fs::write(&fixture, "hello upload queue").unwrap();

        let enqueued = backend
            .upload_queue_enqueue(json!({
                "taskId": "task-a",
                "serviceBaseUrl": "http://127.0.0.1:9",
                "inputText": "Analyze this.",
                "files": [
                    {
                        "path": fixture.to_string_lossy().to_string(),
                        "relativePath": "docs/note.txt",
                        "name": "note.txt",
                        "mediaType": "text/plain"
                    }
                ],
                "settings": { "mode": "test" },
                "startPaused": true
            }))
            .unwrap();
        assert_eq!(enqueued["task"]["status"], "paused");
        assert_eq!(enqueued["task"]["files"][0]["status"], "pending");
        assert!(backend.upload_queue_events_path().exists());

        let listed = backend
            .upload_queue_list(json!({ "includeEvents": true, "offset": 0 }))
            .unwrap();
        let event_types = listed["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|event| event["type"].as_str())
            .collect::<Vec<_>>();
        assert!(event_types.contains(&"upload.queue.enqueued"));
        assert!(event_types.contains(&"upload.queue.paused"));

        let resumed = backend
            .upload_queue_resume(json!({ "taskId": "task-a" }))
            .unwrap();
        assert_eq!(resumed["task"]["status"], "queued");

        let cancelled = backend
            .upload_queue_cancel(json!({ "taskId": "task-a", "reason": "test" }))
            .unwrap();
        assert_eq!(cancelled["task"]["status"], "cancelled");

        let retried = backend
            .upload_queue_retry(json!({ "taskId": "task-a" }))
            .unwrap();
        assert_eq!(retried["task"]["status"], "queued");

        let paused = backend
            .upload_queue_pause(json!({ "taskId": "task-a" }))
            .unwrap();
        assert_eq!(paused["task"]["status"], "paused");

        let cancelled_again = backend
            .upload_queue_cancel(json!({ "taskId": "task-a" }))
            .unwrap();
        assert_eq!(cancelled_again["task"]["status"], "cancelled");

        let cleared = backend.upload_queue_clear_completed(json!({})).unwrap();
        assert!(cleared["state"]["tasks"].as_array().unwrap().is_empty());
        cleanup(&dir);
    }

    #[test]
    fn upload_queue_projection_tracks_progress_and_completion() {
        let (dir, backend) = make_backend("upload-queue-progress");
        let fixture = dir.join("report.txt");
        fs::write(&fixture, "0123456789").unwrap();

        backend
            .upload_queue_enqueue(json!({
                "taskId": "task-progress",
                "serviceBaseUrl": "http://127.0.0.1:9",
                "files": [
                    {
                        "path": fixture.to_string_lossy().to_string(),
                        "relativePath": "report.txt",
                        "name": "report.txt",
                        "mediaType": "text/plain"
                    }
                ],
                "startPaused": true
            }))
            .unwrap();
        backend
            .append_upload_queue_event("upload.queue.resumed", json!({ "taskId": "task-progress" }))
            .unwrap();
        backend
            .append_upload_queue_event(
                "upload.queue.started",
                json!({ "taskId": "task-progress", "attempt": 1 }),
            )
            .unwrap();
        backend
            .append_upload_queue_event(
                "upload.queue.session.created",
                json!({
                    "taskId": "task-progress",
                    "session": {
                        "sessionId": "session-progress",
                        "files": [
                            {
                                "relativePath": "report.txt",
                                "receivedBytes": 4,
                                "byteSize": 10,
                                "completed": false
                            }
                        ]
                    }
                }),
            )
            .unwrap();
        backend
            .append_upload_queue_event(
                "upload.queue.file.progress",
                json!({
                    "taskId": "task-progress",
                    "relativePath": "report.txt",
                    "receivedBytes": 10,
                    "byteSize": 10
                }),
            )
            .unwrap();
        backend
            .append_upload_queue_event(
                "upload.queue.job.completed",
                json!({
                    "taskId": "task-progress",
                    "job": { "id": "job-progress", "status": "completed" },
                    "result": { "summary": "done" },
                    "uploadSession": {
                        "sessionId": "session-progress",
                        "files": [
                            {
                                "relativePath": "report.txt",
                                "receivedBytes": 10,
                                "byteSize": 10,
                                "completed": true
                            }
                        ]
                    }
                }),
            )
            .unwrap();

        let state = backend.load_upload_queue_state().unwrap();
        let task = upload_queue::task_by_id(&state, "task-progress").unwrap();
        assert_eq!(task.status, "completed");
        assert_eq!(task.progress, 1.0);
        assert_eq!(task.files[0].received_bytes, 10);
        assert_eq!(task.files[0].status, "completed");
        assert_eq!(task.job["id"], "job-progress");
        assert_eq!(task.result["summary"], "done");

        let subscribed = backend
            .read_events_since(0, Duration::from_millis(0))
            .unwrap();
        assert!(subscribed["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["type"] == "upload.queue.file.progress"));
        cleanup(&dir);
    }

    #[test]
    fn upload_queue_defers_recoverable_network_failure() {
        let (dir, backend) = make_backend("upload-queue-network-deferred");
        let fixture = dir.join("offline.txt");
        fs::write(&fixture, "offline upload").unwrap();

        let response = backend
            .upload_queue_enqueue(json!({
                "taskId": "task-offline",
                "serviceBaseUrl": "http://127.0.0.1:1",
                "files": [
                    {
                        "path": fixture.to_string_lossy().to_string(),
                        "relativePath": "offline.txt",
                        "name": "offline.txt",
                        "mediaType": "text/plain"
                    }
                ],
                "process": true,
                "wait": false
            }))
            .unwrap();

        assert_eq!(response["task"]["status"], "waiting_server");
        assert_eq!(response["task"]["recoverable"], true);
        assert!(response["task"]["retryAfterEpochMs"].as_u64().unwrap() > 0);

        let listed = backend
            .upload_queue_list(json!({ "includeEvents": true, "offset": 0 }))
            .unwrap();
        assert!(listed["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["type"] == "upload.queue.deferred"));
        cleanup(&dir);
    }

    #[test]
    fn upload_queue_deferred_task_becomes_processable_after_retry_time() {
        let (dir, backend) = make_backend("upload-queue-retry-window");
        let fixture = dir.join("retry.txt");
        fs::write(&fixture, "retry upload").unwrap();
        backend
            .upload_queue_enqueue(json!({
                "taskId": "task-retry-window",
                "serviceBaseUrl": "http://127.0.0.1:1",
                "files": [
                    {
                        "path": fixture.to_string_lossy().to_string(),
                        "relativePath": "retry.txt",
                        "name": "retry.txt",
                        "mediaType": "text/plain"
                    }
                ],
                "startPaused": true
            }))
            .unwrap();
        backend
            .append_upload_queue_event(
                "upload.queue.resumed",
                json!({ "taskId": "task-retry-window" }),
            )
            .unwrap();
        let now = 10_000_u64;
        backend
            .append_upload_queue_event(
                "upload.queue.deferred",
                json!({
                    "taskId": "task-retry-window",
                    "error": "connection refused",
                    "failureKind": "network",
                    "retryAfterEpochMs": now + 5_000,
                    "retryAfterAt": timestamp_from_epoch_ms(now + 5_000)
                }),
            )
            .unwrap();
        let state = backend.load_upload_queue_state().unwrap();
        let task = upload_queue::task_by_id(&state, "task-retry-window").unwrap();
        assert_eq!(task.status, "waiting_server");
        assert!(upload_queue::processable_task_by_id(&state, "task-retry-window", now).is_none());
        assert!(
            upload_queue::processable_task_by_id(&state, "task-retry-window", now + 5_001)
                .is_some()
        );
        cleanup(&dir);
    }

    #[test]
    fn handle_rpc_rejects_protocol_mismatch() {
        let (dir, backend) = make_backend("rpc-protocol");
        let response = backend.handle_rpc(JsonRpcRequest {
            jsonrpc: Some("2.0".into()),
            id: Some(json!("1")),
            trace_id: None,
            method: "system.ping".into(),
            params: Some(json!({})),
            protocol_version: Some(PROTOCOL_VERSION + 1),
        });
        assert!(response.result.is_none());
        assert_eq!(response.error.unwrap().code, -32010);
        cleanup(&dir);
    }

    #[test]
    fn client_operation_registry_covers_backend_methods() {
        let methods = backend_methods();
        let operations = client_operation_registry();
        assert_eq!(methods.len(), operations.len());
        for method in methods {
            let operation = client_operation(&method).expect("operation should be registered");
            assert_eq!(operation.method, method);
            assert!(!operation.risk.is_empty());
            assert!(operation.audit.is_object());
            assert!(operation.log.is_object());
            assert!(operation.input_schema.is_object());
        }
        let rebuild = client_operation("mail.index.rebuild").unwrap();
        assert_eq!(rebuild.risk, "repair_write");
        assert!(!rebuild.read_only);
        let stats = client_operation("mail.index.stats").unwrap();
        assert_eq!(stats.risk, "read_only");
        assert!(stats.concurrency_safe);
        let context_run = client_operation("context.compaction.run").unwrap();
        assert_eq!(context_run.risk, "safe_write");
        assert!(!context_run.read_only);
        let context_records = client_operation("context.compaction.records").unwrap();
        assert_eq!(context_records.risk, "read_only");
        assert!(context_records.concurrency_safe);
    }

    #[test]
    fn client_context_compaction_persists_records_and_memory() {
        let (dir, backend) = make_backend("client-context-compaction");
        let result = backend
            .execute_method(
                "context.compaction.run",
                json!({
                    "sessionId": "client-session",
                    "force": true,
                    "recentMessageProtectionCount": 1,
                    "messages": [
                        {
                            "id": "client-old-1",
                            "role": "user",
                            "content": "必须保留 client-evidence-42 和 client-risk。".repeat(200)
                        },
                        {
                            "id": "client-current",
                            "role": "user",
                            "content": "当前问题。"
                        }
                    ]
                }),
                None,
            )
            .unwrap();
        assert_eq!(result["protocolVersion"], "pact.context.compaction.v1");
        assert_eq!(result["compacted"], true);
        assert!(result["summary"]
            .as_str()
            .unwrap()
            .contains("client-evidence-42"));
        assert!(backend.context_compaction_records_path().exists());
        assert!(backend.context_session_memory_path().exists());

        let records = backend
            .execute_method("context.compaction.records", json!({ "limit": 10 }), None)
            .unwrap();
        assert_eq!(records["records"].as_array().unwrap().len(), 1);

        let memory = backend
            .execute_method(
                "context.session_memory.get",
                json!({ "sessionId": "client-session" }),
                None,
            )
            .unwrap();
        assert_eq!(memory["records"].as_array().unwrap().len(), 1);

        let cleared = backend
            .execute_method(
                "context.session_memory.clear",
                json!({ "sessionId": "client-session", "reason": "verify" }),
                None,
            )
            .unwrap();
        assert_eq!(cleared["ok"], true);
        cleanup(&dir);
    }

    #[test]
    fn request_shutdown_creates_flag() {
        let (dir, backend) = make_backend("shutdown");
        backend.request_shutdown().unwrap();
        assert!(backend.shutdown_path().exists());
        assert!(fs::read_to_string(backend.shutdown_path())
            .unwrap()
            .starts_with("unix:"));
        cleanup(&dir);
    }

    #[test]
    fn auto_sync_policy_manual_returns_false() {
        let (dir, backend) = make_backend("auto-sync-manual");
        atomic_write_json(
            &backend.settings_path(),
            &json!({
                "bootstrapBaseUrl": "http://127.0.0.1:1",
                "expertVocabularySyncPolicy": "manual"
            }),
        )
        .unwrap();
        assert!(!backend.try_auto_sync_vocabulary("test").unwrap());
        cleanup(&dir);
    }

    #[test]
    fn server_api_request_authenticates_runtime_info_routes() {
        let (dir, backend) = make_backend("server-api-runtime-auth");
        let (base_url, seen_requests, handle) = spawn_console_auth_test_server(2);
        backend
            .save_config_value(json!({
                "serviceUsername": "owner",
                "servicePassword": "secret"
            }))
            .unwrap();

        let response = backend
            .server_api_request(json!({
                "serviceBaseUrl": base_url,
                "method": "GET",
                "path": "/api/runtime/info"
            }))
            .unwrap();
        assert_eq!(response["path"], "/api/runtime/info");

        handle.join().unwrap();
        let requests = seen_requests.lock().unwrap().clone();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].path, "/api/auth/login");
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            json!({
                "username": "owner",
                "password": "secret"
            })
        );
        assert_eq!(requests[1].method, "GET");
        assert_eq!(requests[1].path, "/api/runtime/info");
        assert_eq!(
            requests[1].headers.get("cookie").map(String::as_str),
            Some("pact_console_session=session_test")
        );
        cleanup(&dir);
    }

    #[test]
    fn server_api_request_keeps_bootstrap_public_even_with_credentials() {
        let (dir, backend) = make_backend("server-api-bootstrap-public");
        let (base_url, seen_requests, handle) = spawn_console_auth_test_server(1);
        backend
            .save_config_value(json!({
                "serviceUsername": "owner",
                "servicePassword": "secret"
            }))
            .unwrap();

        let response = backend
            .server_api_request(json!({
                "serviceBaseUrl": base_url,
                "method": "GET",
                "path": "/api/bootstrap"
            }))
            .unwrap();
        assert_eq!(response["path"], "/api/bootstrap");

        handle.join().unwrap();
        let requests = seen_requests.lock().unwrap().clone();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path, "/api/bootstrap");
        assert!(!requests[0].headers.contains_key("cookie"));
        cleanup(&dir);
    }
}
