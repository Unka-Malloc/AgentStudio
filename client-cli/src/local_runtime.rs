use crate::client_state::{ActivityLog, ClientStateStore};
use crate::process_identity;
use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose};
use rand::RngCore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::fs::{PermissionsExt, symlink};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const STATE_SCHEMA_VERSION: &str = "v0.0.1:schema:definition-1";
const LOCAL_RUNTIME_DIR: &str = "local-runtime";
const DEFAULT_PORT: u16 = 17328;
const HEALTH_PATH: &str = "/api/healthz";
const MAX_PORT_PROBE_OFFSET: u16 = 10;
const DEFAULT_HEALTH_TIMEOUT_MS: u64 = 30_000;

#[derive(Clone, Debug)]
struct RuntimePaths {
    root: PathBuf,
    install_dir: PathBuf,
    install_source_dir: PathBuf,
    data_dir: PathBuf,
    logs_dir: PathBuf,
    bootstrap_dir: PathBuf,
    runtime_config_path: PathBuf,
    state_path: PathBuf,
    pid_path: PathBuf,
    log_path: PathBuf,
    claim_token_path: PathBuf,
}

#[derive(Clone, Debug)]
struct HealthCheck {
    url: String,
    port: u16,
    payload: Value,
}

pub fn ensure(params: &Value) -> Result<Value> {
    let paths = runtime_paths()?;
    fs::create_dir_all(&paths.root)?;
    let rebuild = bool_param(params, &["rebuild"]).unwrap_or(false);
    if rebuild && process_alive(read_pid(&paths.pid_path)?) {
        stop_process(&paths)?;
    }
    let install = ensure_installed(params, rebuild)?;
    let start_result = start_with_paths(params, &paths, true)?;
    Ok(json!({
        "ok": true,
        "status": "ready",
        "install": install,
        "runtime": start_result
    }))
}

pub fn build(params: &Value) -> Result<Value> {
    let paths = runtime_paths()?;
    if process_alive(read_pid(&paths.pid_path)?) {
        stop_process(&paths)?;
    }
    ensure_installed(params, true)
}

pub fn start(params: &Value) -> Result<Value> {
    let paths = runtime_paths()?;
    if !paths
        .install_source_dir
        .join("server/scripts/start-server.mjs")
        .exists()
    {
        ensure_installed(params, false)?;
    }
    start_with_paths(params, &paths, false)
}

pub fn restart(params: &Value) -> Result<Value> {
    let paths = runtime_paths()?;
    stop_process(&paths)?;
    start(params)
}

pub fn stop(_params: &Value) -> Result<Value> {
    let paths = runtime_paths()?;
    let stopped = stop_process(&paths)?;
    let mut state = read_state(&paths.state_path)?;
    state["status"] = json!("stopped");
    state["running"] = json!(false);
    state["updatedAtUnix"] = json!(unix_seconds());
    write_json_private(&paths.state_path, &state)?;
    append_activity(
        "local_runtime.stopped",
        json!({
            "target": "local-runtime",
            "pid": stopped.get("pid").cloned().unwrap_or_else(|| json!(0))
        }),
    );
    Ok(json!({
        "ok": true,
        "status": "stopped",
        "dataRoot": display_path(&paths.root),
        "stopped": stopped
    }))
}

pub fn status(_params: &Value) -> Result<Value> {
    let paths = runtime_paths()?;
    fs::create_dir_all(&paths.root)?;
    let mut state = read_state(&paths.state_path)?;
    let pid = read_pid(&paths.pid_path)?;
    let running = process_alive(pid);
    if !running
        && state
            .get("running")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        state["status"] = json!("stopped");
        state["running"] = json!(false);
        state["updatedAtUnix"] = json!(unix_seconds());
        write_json_private(&paths.state_path, &state)?;
    }
    let server_url = state
        .get("serverUrl")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("http://127.0.0.1:{}", DEFAULT_PORT));
    let health = if running {
        one_health_check(&server_url).ok()
    } else {
        None
    };
    let identity = process_identity::status(&json!({ "serverUrl": server_url })).ok();
    let runtime_modules = read_runtime_modules(&paths);
    Ok(json!({
        "ok": true,
        "status": if running { "running" } else { "stopped" },
        "running": running,
        "pid": pid.unwrap_or(0),
        "serverUrl": state.get("serverUrl").cloned().unwrap_or_else(|| json!("")),
        "port": state.get("port").cloned().unwrap_or_else(|| json!(DEFAULT_PORT)),
        "dataRoot": display_path(&paths.root),
        "installSourceDir": display_path(&paths.install_source_dir),
        "runtimeConfigPath": display_path(&paths.runtime_config_path),
        "logPath": display_path(&paths.log_path),
        "health": health.map(|item| item.payload).unwrap_or_else(|| json!(null)),
        "identity": identity.unwrap_or_else(|| json!(null)),
        "runtimeModules": runtime_modules,
        "state": state
    }))
}

pub fn logs(params: &Value) -> Result<Value> {
    let paths = runtime_paths()?;
    let tail = number_param(params, &["tail", "limit"])
        .unwrap_or(200)
        .max(1) as usize;
    let lines = tail_lines(&paths.log_path, tail)?;
    Ok(json!({
        "ok": true,
        "status": "ok",
        "logPath": display_path(&paths.log_path),
        "tail": tail,
        "lines": lines
    }))
}

fn ensure_installed(params: &Value, force_rebuild: bool) -> Result<Value> {
    let paths = runtime_paths()?;
    let already_installed = paths
        .install_source_dir
        .join("server/scripts/start-server.mjs")
        .exists();
    if already_installed && !force_rebuild {
        return Ok(json!({
            "ok": true,
            "status": "installed",
            "changed": false,
            "installSourceDir": display_path(&paths.install_source_dir)
        }));
    }

    let source_root = resolve_source_root(params)?;
    let preset_config = resolve_preset_config(params)?;
    let output_root = resolve_output_root(params, &source_root, &preset_config)?;
    let generated_source = output_root.join("source");
    if force_rebuild
        || !generated_source
            .join("server/scripts/start-server.mjs")
            .exists()
    {
        run_composition_build(params, &source_root, &preset_config)?;
    }
    if !generated_source
        .join("server/scripts/start-server.mjs")
        .exists()
    {
        return Err(anyhow!(
            "client-local-runtime source was not generated at {}",
            generated_source.display()
        ));
    }
    install_source_runtime(&source_root, &generated_source, &paths)?;
    let mut state = read_state(&paths.state_path)?;
    state["schemaVersion"] = json!(STATE_SCHEMA_VERSION);
    state["runtimeKind"] = json!("client-local");
    state["sourceRoot"] = json!(display_path(&source_root));
    state["presetConfig"] = json!(display_path(&preset_config));
    state["buildOutputRoot"] = json!(display_path(&output_root));
    state["installSourceDir"] = json!(display_path(&paths.install_source_dir));
    state["updatedAtUnix"] = json!(unix_seconds());
    write_json_private(&paths.state_path, &state)?;
    append_activity(
        "local_runtime.installed",
        json!({
            "target": "local-runtime",
            "sourceRoot": display_path(&source_root),
            "installSourceDir": display_path(&paths.install_source_dir)
        }),
    );
    Ok(json!({
        "ok": true,
        "status": "installed",
        "changed": true,
        "sourceRoot": display_path(&source_root),
        "presetConfig": display_path(&preset_config),
        "buildOutputRoot": display_path(&output_root),
        "installSourceDir": display_path(&paths.install_source_dir)
    }))
}

fn start_with_paths(params: &Value, paths: &RuntimePaths, allow_claim: bool) -> Result<Value> {
    fs::create_dir_all(&paths.root)?;
    fs::create_dir_all(&paths.data_dir)?;
    fs::create_dir_all(&paths.logs_dir)?;
    fs::create_dir_all(&paths.bootstrap_dir)?;

    let host = text_param(params, &["host"]).unwrap_or_else(|| "127.0.0.1".to_string());
    if !is_loopback_host(&host) {
        return Err(anyhow!("client local runtime must listen on loopback host"));
    }
    let port = port_param(params)?.unwrap_or_else(|| state_port(paths).unwrap_or(DEFAULT_PORT));
    let server_url = format!("http://{}:{}", host, port);
    let runtime_config = write_runtime_config(paths, &host, port, &server_url)?;
    let mut identity_status = process_identity::status(&json!({ "serverUrl": server_url })).ok();
    let mut needs_claim = identity_status.is_none() && allow_claim;

    let pid = read_pid(&paths.pid_path)?;
    if process_alive(pid) {
        let health = wait_for_health(&host, port, Duration::from_secs(2))?;
        if needs_claim {
            stop_process(paths)?;
        } else {
            update_running_state(paths, &server_url, port, pid.unwrap_or(0), &health, false)?;
            let runtime_modules = read_runtime_modules(paths);
            return Ok(json!({
                "ok": true,
                "status": "running",
                "changed": false,
                "pid": pid.unwrap_or(0),
                "serverUrl": health.url,
                "runtimeConfigPath": display_path(&runtime_config),
                "logPath": display_path(&paths.log_path),
                "health": health.payload,
                "identity": identity_status.unwrap_or_else(|| json!(null)),
                "runtimeModules": runtime_modules
            }));
        }
    }

    let claim_token = if needs_claim {
        Some(write_claim_token(&paths.claim_token_path)?)
    } else {
        None
    };
    let pid = spawn_server(paths, &runtime_config, claim_token.as_ref())?;
    let health = wait_for_health(&host, port, health_timeout(params))?;
    if health.url != server_url {
        return Err(anyhow!(
            "local runtime started on {}, expected {}; strict port binding failed",
            health.url,
            server_url
        ));
    }

    let mut claim_result = Value::Null;
    if needs_claim {
        let ids = ensure_identity_ids(paths)?;
        let default_hash = default_identity_hash(params, paths);
        match process_identity::bootstrap_claim(&json!({
            "serverUrl": health.url,
            "claimTokenFile": display_path(&paths.claim_token_path),
            "defaultIdentityHash": default_hash,
            "clientId": ids.0,
            "installationId": ids.1,
            "runtimeInstanceId": ids.2
        })) {
            Ok(result) => {
                claim_result = result.clone();
                if result.get("ok").and_then(Value::as_bool) != Some(true) {
                    let _ = fs::remove_file(&paths.claim_token_path);
                    return Err(anyhow!("process identity claim failed: {}", result));
                }
                identity_status =
                    process_identity::status(&json!({ "serverUrl": health.url })).ok();
            }
            Err(error) => {
                let _ = fs::remove_file(&paths.claim_token_path);
                return Err(error.context("process identity claim failed"));
            }
        }
        needs_claim = false;
    }

    update_running_state(
        paths,
        &health.url,
        port,
        pid,
        &health,
        claim_result != Value::Null,
    )?;
    append_activity(
        "local_runtime.started",
        json!({
            "target": "local-runtime",
            "serverUrl": health.url,
            "pid": pid,
            "claimed": claim_result != Value::Null
        }),
    );
    let runtime_modules = read_runtime_modules(paths);
    Ok(json!({
        "ok": true,
        "status": "running",
        "changed": true,
        "pid": pid,
        "serverUrl": health.url,
        "runtimeConfigPath": display_path(&runtime_config),
        "logPath": display_path(&paths.log_path),
        "health": health.payload,
        "claimed": claim_result != Value::Null,
        "claim": if claim_result != Value::Null { claim_result } else { json!(null) },
        "identity": identity_status.unwrap_or_else(|| json!(null)),
        "needsClaim": needs_claim,
        "runtimeModules": runtime_modules
    }))
}

fn runtime_paths() -> Result<RuntimePaths> {
    let store = ClientStateStore::portable()?;
    let root = store.root().join(LOCAL_RUNTIME_DIR);
    Ok(RuntimePaths {
        install_dir: root.join("runtime"),
        install_source_dir: root.join("runtime").join("source"),
        data_dir: root.join("data"),
        logs_dir: root.join("logs"),
        bootstrap_dir: root.join("bootstrap"),
        runtime_config_path: root.join("runtime-instance.json"),
        state_path: root.join("state.json"),
        pid_path: root.join("runtime.pid"),
        log_path: root.join("logs").join("server.log"),
        claim_token_path: root.join("bootstrap").join("claim-token"),
        root,
    })
}

fn run_composition_build(params: &Value, source_root: &Path, preset_config: &Path) -> Result<()> {
    let npm = text_param(params, &["npmPath", "npm-path"])
        .or_else(|| env::var("PACT_NPM_PATH").ok())
        .unwrap_or_else(|| "npm".to_string());
    let status = Command::new(npm)
        .args([
            "run",
            "composition:dehydrate",
            "--",
            "--preset-config",
            preset_config
                .to_str()
                .ok_or_else(|| anyhow!("preset config path is not valid UTF-8"))?,
            "--skip-ui-build",
        ])
        .current_dir(source_root)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("client-local-runtime build exited with {}", status))
    }
}

fn install_source_runtime(
    source_root: &Path,
    generated_source: &Path,
    paths: &RuntimePaths,
) -> Result<()> {
    let node_modules = source_root.join("node_modules");
    if !node_modules.exists() {
        return Err(anyhow!(
            "source root dependencies are missing at {}; run npm install in the source repository first",
            node_modules.display()
        ));
    }
    if paths.install_source_dir.exists() {
        fs::remove_dir_all(&paths.install_source_dir)?;
    }
    fs::create_dir_all(&paths.install_dir)?;
    copy_dir_recursive(generated_source, &paths.install_source_dir)?;
    let installed_node_modules = paths.install_source_dir.join("node_modules");
    if installed_node_modules.exists() {
        remove_path(&installed_node_modules)?;
    }
    #[cfg(unix)]
    symlink(&node_modules, &installed_node_modules)?;
    #[cfg(not(unix))]
    copy_dir_recursive(&node_modules, &installed_node_modules)?;
    Ok(())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let Some(name_text) = name.to_str() else {
            continue;
        };
        if matches!(name_text, "node_modules" | ".git" | ".dart_tool") {
            continue;
        }
        let target = destination.join(name);
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else if file_type.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

fn remove_path(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn write_runtime_config(
    paths: &RuntimePaths,
    host: &str,
    port: u16,
    server_url: &str,
) -> Result<PathBuf> {
    let feature_profile = paths
        .install_source_dir
        .join("feature-profile")
        .join("feature-profile.json");
    if !feature_profile.exists() {
        return Err(anyhow!(
            "local runtime feature profile is missing at {}",
            feature_profile.display()
        ));
    }
    let config = json!({
        "schemaVersion": STATE_SCHEMA_VERSION,
        "runtimeKind": "client-local",
        "host": host,
        "port": port,
        "strictPort": true,
        "dataDir": display_path(&paths.data_dir),
        "profile": "minimal",
        "edition": "client-local",
        "featureProfile": display_path(&feature_profile),
        "withUi": false,
        "discovery": {
            "mode": "active",
            "serverId": format!("pact-client-local-runtime-{}", port),
            "serverLabel": "Pact Client Local Runtime",
            "configVersion": format!("client-local-runtime-{}", unix_seconds()),
            "bootstrapBaseUrl": server_url,
            "activeServiceUrl": server_url,
            "advertisedBaseUrl": server_url
        }
    });
    write_json_private(&paths.runtime_config_path, &config)?;
    Ok(paths.runtime_config_path.clone())
}

fn spawn_server(
    paths: &RuntimePaths,
    runtime_config: &Path,
    claim_token: Option<&String>,
) -> Result<u32> {
    let node = env::var("PACT_NODE_PATH").unwrap_or_else(|_| "node".to_string());
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.log_path)?;
    let stderr = stdout.try_clone()?;
    write_log_preamble(&paths.log_path, runtime_config)?;
    let mut command = Command::new(node);
    command
        .arg("server/scripts/start-server.mjs")
        .arg("--runtime-config")
        .arg(runtime_config)
        .arg("--require-runtime-config")
        .arg("--expected-runtime-kind")
        .arg("client-local")
        .arg("--expected-edition")
        .arg("client-local")
        .current_dir(&paths.install_source_dir)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .stdin(Stdio::null())
        .env("NODE_ENV", "production");
    if claim_token.is_some() {
        command.env(
            "PACT_PROCESS_IDENTITY_CLAIM_TOKEN_FILE",
            &paths.claim_token_path,
        );
    }
    #[cfg(unix)]
    command.process_group(0);
    let child = command.spawn()?;
    let pid = child.id();
    write_text_private(&paths.pid_path, &format!("{}\n", pid))?;
    Ok(pid)
}

fn wait_for_health(host: &str, port: u16, timeout: Duration) -> Result<HealthCheck> {
    let deadline = Instant::now() + timeout;
    let mut last_error = String::new();
    while Instant::now() < deadline {
        for candidate in port..=port.saturating_add(MAX_PORT_PROBE_OFFSET) {
            let url = format!("http://{}:{}{}", host, candidate, HEALTH_PATH);
            match get_json(&url) {
                Ok(payload) => {
                    if payload.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                        return Ok(HealthCheck {
                            url: format!("http://{}:{}", host, candidate),
                            port: candidate,
                            payload,
                        });
                    }
                    last_error = format!("{} returned non-ok health payload", url);
                }
                Err(error) => {
                    last_error = error.to_string();
                }
            }
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(anyhow!("local runtime health check failed: {}", last_error))
}

fn one_health_check(server_url: &str) -> Result<HealthCheck> {
    let url = format!("{}{}", server_url.trim_end_matches('/'), HEALTH_PATH);
    let payload = get_json(&url)?;
    Ok(HealthCheck {
        url: server_url.trim_end_matches('/').to_string(),
        port: parse_url_port(server_url).unwrap_or(DEFAULT_PORT),
        payload,
    })
}

fn get_json(url: &str) -> Result<Value> {
    let response = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(750))
        .build()
        .get(url)
        .call()?;
    Ok(response.into_json::<Value>()?)
}

fn stop_process(paths: &RuntimePaths) -> Result<Value> {
    let pid = read_pid(&paths.pid_path)?;
    let Some(pid) = pid else {
        return Ok(json!({"ok": true, "status": "not-running", "pid": 0}));
    };
    if !process_alive(Some(pid)) {
        let _ = fs::remove_file(&paths.pid_path);
        return Ok(json!({"ok": true, "status": "not-running", "pid": pid}));
    }
    terminate_pid(pid, false)?;
    for _ in 0..40 {
        if !process_alive(Some(pid)) {
            let _ = fs::remove_file(&paths.pid_path);
            return Ok(json!({"ok": true, "status": "stopped", "pid": pid}));
        }
        thread::sleep(Duration::from_millis(250));
    }
    terminate_pid(pid, true)?;
    let _ = fs::remove_file(&paths.pid_path);
    Ok(json!({"ok": true, "status": "killed", "pid": pid}))
}

fn terminate_pid(pid: u32, force: bool) -> Result<()> {
    #[cfg(unix)]
    {
        let signal = if force { "-KILL" } else { "-TERM" };
        let status = Command::new("kill")
            .arg(signal)
            .arg(pid.to_string())
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(anyhow!("kill {} {} exited with {}", signal, pid, status))
        }
    }
    #[cfg(windows)]
    {
        let mut args = vec!["/PID".to_string(), pid.to_string(), "/T".to_string()];
        if force {
            args.push("/F".to_string());
        }
        let status = Command::new("taskkill").args(args).status()?;
        if status.success() {
            Ok(())
        } else {
            Err(anyhow!("taskkill {} exited with {}", pid, status))
        }
    }
}

fn process_alive(pid: Option<u32>) -> bool {
    let Some(pid) = pid else {
        return false;
    };
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid)])
            .output()
            .map(|output| {
                output.status.success()
                    && String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
}

fn write_claim_token(path: &Path) -> Result<String> {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    write_text_private(path, &format!("{}\n", token))?;
    Ok(token)
}

fn ensure_identity_ids(paths: &RuntimePaths) -> Result<(String, String, String)> {
    let mut state = read_state(&paths.state_path)?;
    let client_id = state
        .get("clientId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("client_{}", Uuid::new_v4()));
    let installation_id = state
        .get("installationId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("install_{}", Uuid::new_v4()));
    let runtime_instance_id = state
        .get("runtimeInstanceId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("runtime_{}", Uuid::new_v4()));
    state["clientId"] = json!(client_id.clone());
    state["installationId"] = json!(installation_id.clone());
    state["runtimeInstanceId"] = json!(runtime_instance_id.clone());
    state["updatedAtUnix"] = json!(unix_seconds());
    write_json_private(&paths.state_path, &state)?;
    Ok((client_id, installation_id, runtime_instance_id))
}

fn update_running_state(
    paths: &RuntimePaths,
    server_url: &str,
    port: u16,
    pid: u32,
    health: &HealthCheck,
    claimed: bool,
) -> Result<()> {
    let mut state = read_state(&paths.state_path)?;
    state["schemaVersion"] = json!(STATE_SCHEMA_VERSION);
    state["runtimeKind"] = json!("client-local");
    state["status"] = json!("running");
    state["running"] = json!(true);
    state["pid"] = json!(pid);
    state["serverUrl"] = json!(server_url);
    state["port"] = json!(port);
    state["actualPort"] = json!(health.port);
    state["dataRoot"] = json!(display_path(&paths.root));
    state["dataDir"] = json!(display_path(&paths.data_dir));
    state["runtimeConfigPath"] = json!(display_path(&paths.runtime_config_path));
    state["installSourceDir"] = json!(display_path(&paths.install_source_dir));
    state["logPath"] = json!(display_path(&paths.log_path));
    state["lastHealth"] = health.payload.clone();
    if claimed {
        state["processIdentityClaimedAtUnix"] = json!(unix_seconds());
    }
    state["updatedAtUnix"] = json!(unix_seconds());
    write_json_private(&paths.state_path, &state)
}

fn read_state(path: &Path) -> Result<Value> {
    if !path.exists() {
        return Ok(json!({
            "schemaVersion": STATE_SCHEMA_VERSION,
            "runtimeKind": "client-local"
        }));
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(json!({
            "schemaVersion": STATE_SCHEMA_VERSION,
            "runtimeKind": "client-local"
        }));
    }
    Ok(serde_json::from_str(&raw)?)
}

fn read_pid(path: &Path) -> Result<Option<u32>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    Ok(raw.trim().parse::<u32>().ok())
}

fn write_json_private(path: &Path, value: &Value) -> Result<()> {
    write_text_private(path, &format!("{}\n", serde_json::to_string_pretty(value)?))
}

fn write_text_private(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", unix_nanos()));
    fs::write(&tmp, content)?;
    #[cfg(unix)]
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    fs::rename(&tmp, path)?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

fn write_log_preamble(log_path: &Path, runtime_config: &Path) -> Result<()> {
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    writeln!(
        file,
        "\n[pact-client] starting local runtime at {} with config {}\n",
        unix_seconds(),
        runtime_config.display()
    )?;
    Ok(())
}

fn resolve_source_root(params: &Value) -> Result<PathBuf> {
    if let Some(value) = text_param(
        params,
        &["sourceRoot", "source-root", "repoRoot", "repo-root"],
    ) {
        return canonical_existing_dir(&value);
    }
    if let Ok(value) = env::var("PACT_SOURCE_ROOT") {
        if !value.trim().is_empty() {
            return canonical_existing_dir(&value);
        }
    }
    if let Some(found) = discover_source_root(env::current_dir()?) {
        return Ok(found);
    }
    Err(anyhow!(
        "local runtime build requires --source-root or PACT_SOURCE_ROOT"
    ))
}

fn resolve_preset_config(params: &Value) -> Result<PathBuf> {
    let raw = text_param(
        params,
        &["presetConfig", "preset-config", "config", "configPath", "config-path"],
    )
    .ok_or_else(|| {
        anyhow!("local runtime build requires explicit --preset-config /path/to/client-local-runtime.preset.json")
    })?;
    let path = PathBuf::from(raw);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()?.join(path)
    };
    if !absolute.exists() {
        return Err(anyhow!(
            "preset config does not exist: {}",
            absolute.display()
        ));
    }
    Ok(fs::canonicalize(absolute)?)
}

fn resolve_output_root(
    params: &Value,
    source_root: &Path,
    preset_config: &Path,
) -> Result<PathBuf> {
    if let Some(value) = text_param(params, &["outputRoot", "output-root"]) {
        let path = PathBuf::from(value);
        return Ok(if path.is_absolute() {
            path
        } else {
            source_root.join(path)
        });
    }
    let preset = read_json_file(preset_config)?;
    let output = preset
        .get("deploymentTarget")
        .and_then(|value| value.get("outputRoot"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("build/composition-packages/client-local-runtime");
    Ok(source_root.join(output))
}

fn discover_source_root(start: PathBuf) -> Option<PathBuf> {
    let mut current = Some(start.as_path());
    while let Some(path) = current {
        if path.join("package.json").exists()
            && path.join("server/scripts/composition-presets.mjs").exists()
        {
            return fs::canonicalize(path).ok();
        }
        current = path.parent();
    }
    None
}

fn canonical_existing_dir(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()?.join(path)
    };
    if !absolute.is_dir() {
        return Err(anyhow!(
            "source root is not a directory: {}",
            absolute.display()
        ));
    }
    Ok(fs::canonicalize(absolute)?)
}

fn read_json_file(path: &Path) -> Result<Value> {
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_optional_json_file(path: &Path) -> Result<Option<Value>> {
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_json_file(path)?))
}

fn read_runtime_modules(paths: &RuntimePaths) -> Value {
    match read_runtime_modules_result(paths) {
        Ok(value) => value,
        Err(error) => json!({
            "ok": false,
            "status": "unavailable",
            "error": error.to_string()
        }),
    }
}

fn read_runtime_modules_result(paths: &RuntimePaths) -> Result<Value> {
    let candidates = runtime_module_metadata_candidates(paths);
    let mut first_missing = None;
    for candidate in candidates {
        let modules = read_runtime_modules_from_candidate(&candidate)?;
        if modules.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            return Ok(modules);
        }
        if first_missing.is_none() {
            first_missing = Some(modules);
        }
    }
    Ok(first_missing.unwrap_or_else(|| {
        json!({
            "ok": false,
            "status": "missing",
            "source": "unavailable",
            "activeFeatureIds": [],
            "activeFeatures": [],
            "disabledFeatureIds": [],
            "disabledFeatures": [],
            "serverModules": [],
            "mounts": [],
            "eventTopics": []
        })
    }))
}

#[derive(Clone, Debug)]
struct RuntimeModuleMetadataCandidate {
    source: String,
    root: PathBuf,
}

impl RuntimeModuleMetadataCandidate {
    fn new(source: &str, root: PathBuf) -> Self {
        Self {
            source: source.to_string(),
            root,
        }
    }

    fn feature_profile_path(&self) -> PathBuf {
        self.root
            .join("feature-profile")
            .join("feature-profile.json")
    }

    fn active_features_path(&self) -> PathBuf {
        self.root
            .join("feature-profile")
            .join("active-features.json")
    }

    fn disabled_features_path(&self) -> PathBuf {
        self.root
            .join("feature-profile")
            .join("disabled-features.json")
    }

    fn composition_plan_path(&self) -> PathBuf {
        self.root.join("composition").join("composition-plan.json")
    }
}

fn runtime_module_metadata_candidates(paths: &RuntimePaths) -> Vec<RuntimeModuleMetadataCandidate> {
    let mut candidates = Vec::new();
    candidates.push(RuntimeModuleMetadataCandidate::new(
        "installed-runtime",
        paths.install_source_dir.clone(),
    ));
    candidates.extend(state_runtime_module_metadata_candidates(paths));
    if let Some(candidate) = bundled_runtime_module_metadata_candidate() {
        candidates.push(candidate);
    }
    if let Some(candidate) = source_build_runtime_module_metadata_candidate() {
        candidates.push(candidate);
    }
    dedupe_runtime_module_metadata_candidates(candidates)
}

fn state_runtime_module_metadata_candidates(
    paths: &RuntimePaths,
) -> Vec<RuntimeModuleMetadataCandidate> {
    let Ok(state) = read_state(&paths.state_path) else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    if let Some(build_output_root) = state.get("buildOutputRoot").and_then(Value::as_str) {
        if !build_output_root.trim().is_empty() {
            candidates.push(RuntimeModuleMetadataCandidate::new(
                "state-build-output",
                PathBuf::from(build_output_root).join("source"),
            ));
        }
    }
    if let Some(source_root) = state.get("sourceRoot").and_then(Value::as_str) {
        if !source_root.trim().is_empty() {
            candidates.push(RuntimeModuleMetadataCandidate::new(
                "state-source-build-output",
                PathBuf::from(source_root)
                    .join("build")
                    .join("composition-packages")
                    .join("client-local-runtime")
                    .join("source"),
            ));
        }
    }
    candidates
}

fn bundled_runtime_module_metadata_candidate() -> Option<RuntimeModuleMetadataCandidate> {
    let executable = env::current_exe().ok()?;
    let executable_dir = executable.parent()?;
    let contents_dir = executable_dir.parent()?;
    let app_dir = contents_dir.parent()?;
    if executable_dir.file_name().and_then(|value| value.to_str()) != Some("MacOS")
        || contents_dir.file_name().and_then(|value| value.to_str()) != Some("Contents")
        || app_dir.extension().and_then(|value| value.to_str()) != Some("app")
    {
        return None;
    }
    Some(RuntimeModuleMetadataCandidate::new(
        "packaged-client",
        contents_dir
            .join("Resources")
            .join("pact-runtime")
            .join("client-local-runtime"),
    ))
}

fn source_build_runtime_module_metadata_candidate() -> Option<RuntimeModuleMetadataCandidate> {
    let source_root = discover_source_root(env::current_dir().ok()?)?;
    Some(RuntimeModuleMetadataCandidate::new(
        "source-build-output",
        source_root
            .join("build")
            .join("composition-packages")
            .join("client-local-runtime")
            .join("source"),
    ))
}

fn dedupe_runtime_module_metadata_candidates(
    candidates: Vec<RuntimeModuleMetadataCandidate>,
) -> Vec<RuntimeModuleMetadataCandidate> {
    let mut seen = Vec::<PathBuf>::new();
    let mut deduped = Vec::new();
    for candidate in candidates {
        if seen.iter().any(|path| path == &candidate.root) {
            continue;
        }
        seen.push(candidate.root.clone());
        deduped.push(candidate);
    }
    deduped
}

fn read_runtime_modules_from_candidate(
    candidate: &RuntimeModuleMetadataCandidate,
) -> Result<Value> {
    let feature_profile_path = candidate.feature_profile_path();
    let active_features_path = candidate.active_features_path();
    let disabled_features_path = candidate.disabled_features_path();
    let composition_plan_path = candidate.composition_plan_path();

    let feature_profile = read_optional_json_file(&feature_profile_path)?.unwrap_or(Value::Null);
    let active_features = read_optional_json_file(&active_features_path)?.unwrap_or(Value::Null);
    let disabled_features =
        read_optional_json_file(&disabled_features_path)?.unwrap_or(Value::Null);
    let composition_plan = read_optional_json_file(&composition_plan_path)?.unwrap_or(Value::Null);
    let loaded =
        feature_profile.is_object() || active_features.is_object() || composition_plan.is_object();

    Ok(json!({
        "ok": loaded,
        "status": if loaded { "loaded" } else { "missing" },
        "source": candidate.source,
        "metadataRoot": display_path(&candidate.root),
        "edition": first_json_text(&[
            active_features.get("edition"),
            feature_profile.get("edition"),
            composition_plan.pointer("/featureRuntime/edition")
        ]),
        "featureProfilePath": display_path(&feature_profile_path),
        "activeFeaturesPath": display_path(&active_features_path),
        "compositionPlanPath": display_path(&composition_plan_path),
        "activeFeatureIds": first_json_array(&[
            active_features.get("activeFeatureIds"),
            feature_profile.get("features"),
            composition_plan.pointer("/featureRuntime/activeFeatureIds")
        ]),
        "activeFeatures": first_json_array(&[
            active_features.get("activeFeatures"),
            composition_plan.pointer("/featureRuntime/activeFeatures")
        ]),
        "disabledFeatureIds": first_json_array(&[
            disabled_features.get("disabledFeatureIds"),
            composition_plan.pointer("/featureRuntime/disabledFeatureIds")
        ]),
        "disabledFeatures": first_json_array(&[
            disabled_features.get("disabledFeatures"),
            composition_plan.pointer("/featureRuntime/disabledFeatures")
        ]),
        "serverModules": first_json_array(&[
            composition_plan.pointer("/packagePlan/serverModules")
        ]),
        "mounts": first_json_array(&[
            composition_plan.pointer("/packagePlan/mounts")
        ]),
        "eventTopics": first_json_array(&[
            composition_plan.pointer("/packagePlan/eventTopics")
        ])
    }))
}

fn first_json_array(candidates: &[Option<&Value>]) -> Value {
    for candidate in candidates {
        if let Some(Value::Array(items)) = *candidate {
            return Value::Array(items.clone());
        }
    }
    json!([])
}

fn first_json_text(candidates: &[Option<&Value>]) -> String {
    for candidate in candidates {
        if let Some(Value::String(value)) = *candidate {
            if !value.trim().is_empty() {
                return value.trim().to_string();
            }
        }
    }
    String::new()
}

fn state_port(paths: &RuntimePaths) -> Option<u16> {
    read_state(&paths.state_path).ok().and_then(|state| {
        state
            .get("port")
            .and_then(Value::as_u64)
            .map(|value| value as u16)
    })
}

fn port_param(params: &Value) -> Result<Option<u16>> {
    let Some(value) = text_param(params, &["port"]) else {
        return Ok(None);
    };
    let port = value
        .parse::<u16>()
        .map_err(|_| anyhow!("invalid local runtime port: {}", value))?;
    Ok(Some(port))
}

fn health_timeout(params: &Value) -> Duration {
    let millis = number_param(params, &["healthTimeoutMs", "health-timeout-ms"])
        .unwrap_or(DEFAULT_HEALTH_TIMEOUT_MS);
    Duration::from_millis(millis.max(1))
}

fn default_identity_hash(params: &Value, paths: &RuntimePaths) -> String {
    if let Some(value) = text_param(params, &["defaultIdentityHash", "default-identity-hash"]) {
        if !value.trim().is_empty() {
            return value;
        }
    }
    let seed = format!(
        "pact-client-bootstrap-default-identity-v1\0{}",
        paths.root.display()
    );
    format!("sha256:{}", sha256_hex(seed.as_bytes()))
}

fn tail_lines(path: &Path, limit: usize) -> Result<Vec<String>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = fs::File::open(path)?;
    let mut lines = BufReader::new(file)
        .lines()
        .collect::<std::io::Result<Vec<_>>>()?;
    if lines.len() > limit {
        lines = lines[lines.len() - limit..].to_vec();
    }
    Ok(lines)
}

fn append_activity(event_type: &str, payload: Value) {
    if let Ok(log) = ActivityLog::portable() {
        let _ = log.append(event_type, payload);
    }
}

fn text_param(params: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| params.get(*key).and_then(Value::as_str).map(str::to_string))
}

fn bool_param(params: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter().find_map(|key| {
        params.get(*key).and_then(|value| {
            value.as_bool().or_else(|| {
                value.as_str().map(|text| {
                    matches!(
                        text.trim().to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes"
                    )
                })
            })
        })
    })
}

fn number_param(params: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        params.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
        })
    })
}

fn parse_url_port(server_url: &str) -> Option<u16> {
    server_url
        .trim_end_matches('/')
        .rsplit(':')
        .next()
        .and_then(|value| value.parse::<u16>().ok())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host.trim(), "127.0.0.1" | "localhost" | "::1")
}

fn sha256_hex(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    format!("{:x}", hasher.finalize())
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::set_portable_data_dir_override;

    #[test]
    fn default_identity_hash_is_stable_for_runtime_root() {
        let temp = env::temp_dir().join(format!("pact-local-runtime-test-{}", unix_nanos()));
        fs::create_dir_all(&temp).unwrap();
        let previous = set_portable_data_dir_override(Some(temp));
        let paths = runtime_paths().unwrap();
        let first = default_identity_hash(&json!({}), &paths);
        let second = default_identity_hash(&json!({}), &paths);
        assert!(first.starts_with("sha256:"));
        assert_eq!(first, second);
        set_portable_data_dir_override(previous);
    }

    #[test]
    fn status_is_safe_before_runtime_exists() {
        let temp = env::temp_dir().join(format!("pact-local-runtime-status-{}", unix_nanos()));
        fs::create_dir_all(&temp).unwrap();
        let previous = set_portable_data_dir_override(Some(temp));
        let result = status(&json!({})).unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["status"], "stopped");
        set_portable_data_dir_override(previous);
    }
}
