use crate::models::AppConfig;
use crate::paths;
use std::fs;
use std::path::{Path, PathBuf};

pub fn config_path() -> PathBuf {
    paths::config_file()
}

pub fn load_config() -> AppConfig {
    match fs::read_to_string(config_path()) {
        Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
            Ok(cfg) => cfg.sanitized(),
            Err(e) => {
                eprintln!("[TitleWord] config.json повреждён, беру значения по умолчанию: {e}");
                AppConfig::default()
            }
        },
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config(cfg: &AppConfig) -> Result<(), String> {
    let cfg = cfg.clone().sanitized();
    let json =
        serde_json::to_string_pretty(&cfg).map_err(|e| format!("сериализация настроек: {e}"))?;
    write_atomic(&config_path(), json.as_bytes())
}

/// Возврат к значениям по умолчанию.
///
/// Избранное остаётся: это не настройка, а подборка публикаций, и терять её
/// при сбросе оформления пользователь не ожидает.
pub fn reset_config() -> Result<AppConfig, String> {
    let favorites = load_config().favorites;
    let cfg = AppConfig {
        favorites,
        ..AppConfig::default()
    };
    save_config(&cfg)?;
    println!("[TitleWord] настройки сброшены к значениям по умолчанию");
    Ok(cfg)
}

/// Пишем через временный файл и переименовываем: обрыв записи не оставит
/// полупустой config.json, из-за которого сбросились бы все настройки.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_lives_in_file_cache_dir() {
        let path = config_path();
        assert_eq!(path.file_name().and_then(|name| name.to_str()), Some("config.json"));
        assert!(
            path.to_string_lossy().contains(paths::ROOT_NAME),
            "{}",
            path.display()
        );
    }

    #[test]
    fn atomic_write_replaces_file_completely() {
        let dir = std::env::temp_dir().join("titleword-config-test");
        fs::create_dir_all(&dir).expect("temp dir");
        let target = dir.join("config.json");

        write_atomic(&target, br#"{"theme":"dark"}"#).expect("первая запись");
        write_atomic(&target, br#"{"theme":"light"}"#).expect("вторая запись");

        let content = fs::read_to_string(&target).expect("чтение");
        assert_eq!(content, r#"{"theme":"light"}"#);
        assert!(!dir.join("config.json.tmp").exists(), "временный файл убран");

        let _ = fs::remove_dir_all(&dir);
    }
}
