use anyhow::{Result, anyhow};
use std::{cell::RefCell, env, fs, path::PathBuf};

thread_local! {
    static PORTABLE_DATA_DIR_OVERRIDE: RefCell<Option<PathBuf>> = RefCell::new(None);
}

#[doc(hidden)]
pub fn set_portable_data_dir_override(path: Option<PathBuf>) -> Option<PathBuf> {
    PORTABLE_DATA_DIR_OVERRIDE.with(|value| value.replace(path))
}

pub fn portable_data_dir() -> Result<PathBuf> {
    if let Some(path) = portable_data_dir_override() {
        fs::create_dir_all(&path)?;
        return Ok(path);
    }

    portable_data_dir_from_env(env::var("PACT_PORTABLE_DIR").ok())
}

fn portable_data_dir_override() -> Option<PathBuf> {
    PORTABLE_DATA_DIR_OVERRIDE.with(|value| value.borrow().clone())
}

fn portable_data_dir_from_env(portable_dir: Option<String>) -> Result<PathBuf> {
    if let Some(value) = portable_dir {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_data_uses_portable_dir_env_when_set() {
        let dir = std::env::temp_dir().join("pact-portable-env-override");
        let resolved =
            portable_data_dir_from_env(Some(dir.to_string_lossy().into_owned())).unwrap();
        assert_eq!(resolved, dir);
        assert!(resolved.exists());
    }

    #[test]
    fn portable_data_falls_back_when_portable_dir_is_empty() {
        let resolved = portable_data_dir_from_env(Some("   ".to_string())).unwrap();
        assert_eq!(
            resolved.file_name().and_then(|value| value.to_str()),
            Some("portable-data")
        );
        assert!(resolved.exists());
    }

    #[test]
    fn portable_data_uses_override_when_set() {
        let dir = std::env::temp_dir().join("pact-portable-dir-override");
        let _guard = PortableDataDirOverrideGuard::set(dir.clone());
        let resolved = portable_data_dir().unwrap();
        assert_eq!(resolved, dir);
        assert!(resolved.exists());
    }

    struct PortableDataDirOverrideGuard {
        previous: Option<PathBuf>,
    }

    impl PortableDataDirOverrideGuard {
        fn set(path: PathBuf) -> Self {
            let previous = set_portable_data_dir_override(Some(path));
            Self { previous }
        }
    }

    impl Drop for PortableDataDirOverrideGuard {
        fn drop(&mut self) {
            set_portable_data_dir_override(self.previous.take());
        }
    }
}
