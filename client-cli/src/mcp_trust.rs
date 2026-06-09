use anyhow::Result;
use serde_json::{Value, json};
use std::env;
use std::fs;

#[derive(Debug, PartialEq, Clone)]
pub enum VerificationStatus {
    Verified,
    Unverified,
    Missing,
    DevUnverifiedOverride,
}

impl VerificationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            VerificationStatus::Verified => "verified",
            VerificationStatus::Unverified => "unverified",
            VerificationStatus::Missing => "missing",
            VerificationStatus::DevUnverifiedOverride => "dev-unverified-override",
        }
    }
}

pub struct EndpointVerification {
    pub endpoint: String,
    pub source: String,
    pub status: VerificationStatus,
}

pub fn resolve_and_verify_endpoint(params: &Value) -> Result<EndpointVerification> {
    let endpoint = extract_endpoint(params);
    
    if endpoint.is_empty() {
        return Ok(EndpointVerification {
            endpoint: "http://127.0.0.1:7228".to_string(), // Keep default for display, but mark missing
            source: "default".to_string(),
            status: VerificationStatus::Missing,
        });
    }

    let status = verify_endpoint_trust(&endpoint, params);
    let source = if params.get("baseUrl").is_some() {
        "params"
    } else if params.get("discoveryFile").is_some() {
        "discovery-file"
    } else if params.get("registryFile").is_some() {
        "registry-file"
    } else if env::var("PACT_CLIENT_MCP_URL").is_ok() {
        "environment"
    } else {
        "default"
    };

    Ok(EndpointVerification {
        endpoint,
        source: source.to_string(),
        status,
    })
}

fn extract_endpoint(params: &Value) -> String {
    if let Some(url) = params.get("baseUrl").and_then(Value::as_str) {
        return url.to_string();
    }
    
    if let Ok(url) = env::var("PACT_CLIENT_MCP_URL") {
        if !url.trim().is_empty() {
            return url.trim().to_string();
        }
    }

    if let Some(discovery_path) = params.get("discoveryFile").and_then(Value::as_str) {
        if let Ok(discovery_json) = fs::read_to_string(discovery_path) {
            if let Ok(discovery) = serde_json::from_str::<Value>(&discovery_json) {
                if let Some(url) = discovery.get("url").and_then(Value::as_str).or_else(|| discovery.get("httpUrl").and_then(Value::as_str)) {
                    return url.to_string();
                }
            }
        }
    }

    if let Some(registry_path) = params.get("registryFile").and_then(Value::as_str) {
        if let Ok(registry_json) = fs::read_to_string(registry_path) {
            if let Ok(registry) = serde_json::from_str::<Value>(&registry_json) {
                if let Some(url) = registry.get("url").and_then(Value::as_str) {
                    return url.to_string();
                }
                if let Some(active_server) = registry.get("activeServer").and_then(Value::as_str) {
                    if let Some(url) = registry.get("servers").and_then(|s| s.get(active_server)).and_then(|s| s.get("httpUrl")).and_then(Value::as_str) {
                         return url.to_string();
                    }
                }
            }
        }
    }

    "".to_string()
}

fn verify_endpoint_trust(_endpoint: &str, params: &Value) -> VerificationStatus {
    // 1. Check for dev bypass
    if let Ok(dev_override) = env::var("PACT_CLIENT_DEV_ALLOW_UNVERIFIED_MCP") {
        if dev_override == "1" {
            return VerificationStatus::DevUnverifiedOverride;
        }
    }

    // 2. Check if discovery/registry file has verified handshake metadata
    let check_file = |path_key: &str| -> Option<VerificationStatus> {
        if let Some(file_path) = params.get(path_key).and_then(Value::as_str) {
            if let Ok(json_str) = fs::read_to_string(file_path) {
                if let Ok(json) = serde_json::from_str::<Value>(&json_str) {
                    // Check for signature or verified flag written by connector
                    if json.get("handshakeVerified").and_then(Value::as_bool).unwrap_or(false) {
                         return Some(VerificationStatus::Verified);
                    }
                    if json.get("metadata").and_then(|m| m.get("signature")).is_some() {
                        return Some(VerificationStatus::Verified);
                    }
                }
            }
        }
        None
    };

    if let Some(status) = check_file("discoveryFile") {
        return status;
    }
    
    if let Some(status) = check_file("registryFile") {
        return status;
    }

    // 3. Fallback to unverified (we don't perform live handshake in the CLI by default yet)
    // In the future, this is where we would do an actual HTTP /api/mcp/handshake call
    // and verify the Ed25519 signature.
    VerificationStatus::Unverified
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("pact-trust-tests-{}", name));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn resolve_missing_endpoint_returns_missing_status() {
        let result = resolve_and_verify_endpoint(&json!({})).unwrap();
        assert_eq!(result.status, VerificationStatus::Missing);
        assert_eq!(result.source, "default");
    }

    #[test]
    fn resolve_with_base_url_returns_unverified_by_default() {
        unsafe { env::remove_var("PACT_CLIENT_DEV_ALLOW_UNVERIFIED_MCP") };
        let result = resolve_and_verify_endpoint(&serde_json::json!({
            "baseUrl": "http://127.0.0.1:8888"
        })).unwrap();
        assert_eq!(result.status, VerificationStatus::Unverified);
        assert_eq!(result.endpoint, "http://127.0.0.1:8888");
        assert_eq!(result.source, "params");
    }

    #[test]
    fn resolve_with_verified_discovery_file() {
        let dir = temp_test_dir("verified");
        let discovery_path = dir.join("discovery.json");
        fs::write(&discovery_path, r#"{"url": "http://127.0.0.1:9999", "handshakeVerified": true}"#).unwrap();

        let result = resolve_and_verify_endpoint(&json!({
            "discoveryFile": discovery_path.to_string_lossy().to_string()
        })).unwrap();

        assert_eq!(result.status, VerificationStatus::Verified);
        assert_eq!(result.endpoint, "http://127.0.0.1:9999");
        assert_eq!(result.source, "discovery-file");
    }

    #[test]
    fn resolve_with_verified_registry_file() {
        let dir = temp_test_dir("verified_registry");
        let registry_path = dir.join("registry.json");
        fs::write(&registry_path, r#"{"url": "http://127.0.0.1:7777", "handshakeVerified": true}"#).unwrap();
        let result = resolve_and_verify_endpoint(&serde_json::json!({
            "registryFile": registry_path.to_string_lossy().to_string()
        })).unwrap();
        assert_eq!(result.status, VerificationStatus::Verified);
    }
}
