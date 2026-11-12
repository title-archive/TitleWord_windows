//! Хранение данных приложения: один каталог в профиле пользователя.
//!
//! `%APPDATA%\TitleWord-FileCache` (Roaming). Внутри — настройки, кэш данных,
//! кэш картинок, пользовательские шрифты и zip-паки с текстурами.
//! Старый каталог `%LOCALAPPDATA%\TitleWord` переносится один раз при старте.

use std::fs;
use std::path::{Path, PathBuf};

pub const ROOT_NAME: &str = "TitleWord-FileCache";
const LEGACY_ROOT_NAME: &str = "TitleWord";

pub fn root_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(ROOT_NAME)
}

fn legacy_root_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(LEGACY_ROOT_NAME)
}

/// Создаёт каталог, если его ещё нет: без этого первая же запись упадёт.
fn ensure(dir: PathBuf) -> PathBuf {
    if let Err(e) = fs::create_dir_all(&dir) {
        eprintln!("[TitleWord] не удалось создать {}: {e}", dir.display());
    }
    dir
}

pub fn config_file() -> PathBuf {
    root_dir().join("config.json")
}

pub fn cache_dir() -> PathBuf {
    ensure(root_dir().join("cache"))
}

pub fn images_dir() -> PathBuf {
    ensure(cache_dir().join("images"))
}

pub fn fonts_dir() -> PathBuf {
    ensure(root_dir().join("fonts"))
}

pub fn packs_dir() -> PathBuf {
    ensure(root_dir().join("packs"))
}

/// Переносит настройки и кэш данных из старого каталога.
///
/// Копируем, а не переносим: если что-то пойдёт не так, прежние данные останутся
/// на месте и приложение всё равно запустится. Существующие файлы не трогаем.
pub fn migrate_legacy() {
    let old = legacy_root_dir();
    if !old.is_dir() || old == root_dir() {
        return;
    }

    let moved_config = copy_if_missing(&old.join("config.json"), &config_file());

    let mut moved_cache = false;
    for name in ["data.json", "data.bak"] {
        moved_cache |= copy_if_missing(&old.join("cache").join(name), &cache_dir().join(name));
    }

    if moved_config || moved_cache {
        println!(
            "[TitleWord] данные перенесены в {} (настройки: {moved_config}, кэш: {moved_cache})",
            root_dir().display()
        );
    }
}

fn copy_if_missing(from: &Path, to: &Path) -> bool {
    if !from.is_file() || to.exists() {
        return false;
    }
    match fs::copy(from, to) {
        Ok(_) => true,
        Err(e) => {
            eprintln!(
                "[TitleWord] перенос {} → {} не удался: {e}",
                from.display(),
                to.display()
            );
            false
        }
    }
}

/// Приводит пользовательский идентификатор (имя пака, шрифта) к безопасному
/// виду: он становится именем каталога и сравнивается со строками настроек.
pub fn sanitize_id(value: &str) -> Option<String> {
    let mut out = String::new();
    let mut last_dash = true; // не начинать с дефиса

    for ch in value.trim().chars() {
        // Разрешены буквы любого языка: имена паков и шрифтов бывают русскими.
        if ch.is_alphanumeric() {
            // to_ascii_lowercase не трогает кириллицу — регистр снимаем полностью.
            out.extend(ch.to_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
        if out.chars().count() >= 48 {
            break;
        }
    }

    while out.ends_with('-') {
        out.pop();
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Ключ внутри манифеста пака: латиница в нижнем регистре, цифры, `-`, `_`.
pub fn sanitize_key(value: &str) -> Option<String> {
    let clean: String = value
        .trim()
        .chars()
        .map(|ch| ch.to_ascii_lowercase())
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(32)
        .collect();

    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

/// Проверяет относительный путь внутри архива/пака.
///
/// Отбрасывает абсолютные пути, `..`, диски (`C:`), управляющие символы,
/// слишком глубокие и слишком длинные пути — иначе распаковка архива могла бы
/// писать файлы куда угодно.
pub fn sanitize_rel_path(value: &str) -> Option<String> {
    let trimmed = value.trim();
    // Замыкающий разделитель означает запись каталога: данных у неё нет.
    if trimmed.is_empty() || trimmed.ends_with('/') || trimmed.ends_with('\\') {
        return None;
    }

    let mut parts: Vec<String> = Vec::new();
    for raw in trimmed.split(['/', '\\']) {
        let part = raw.trim();
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        // Двоеточие — это диск или поток NTFS, управляющие символы — подмена пути.
        if part.contains(':') || part.chars().any(|ch| ch.is_control()) {
            return None;
        }
        if part.chars().count() > 80 {
            return None;
        }
        parts.push(part.to_string());
    }

    if parts.is_empty() || parts.len() > 8 {
        return None;
    }

    let joined = parts.join("/");
    if joined.chars().count() > 200 {
        return None;
    }

    Some(joined)
}

/// Расширение файла в нижнем регистре (без точки).
pub fn extension(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_is_roaming_file_cache() {
        let root = root_dir();
        assert!(root.ends_with(ROOT_NAME), "{}", root.display());
        // Roaming, а не Local — так каталог переживает переустановку.
        let roaming = dirs::data_dir();
        if let Some(roaming) = roaming {
            assert!(root.starts_with(roaming));
        }
    }

    #[test]
    fn ids_are_slugified() {
        assert_eq!(sanitize_id("  My Pack 1.0 ").as_deref(), Some("my-pack-1-0"));
        assert_eq!(sanitize_id("../../etc/passwd").as_deref(), Some("etc-passwd"));
        assert_eq!(sanitize_id("Ночной пак").as_deref(), Some("ночной-пак"));
        assert_eq!(sanitize_id("   "), None);
        assert!(sanitize_id(&"a".repeat(200)).unwrap().chars().count() <= 48);
    }

    #[test]
    fn keys_are_restricted() {
        assert_eq!(sanitize_key(" Tech ").as_deref(), Some("tech"));
        assert_eq!(sanitize_key("heart-filled").as_deref(), Some("heart-filled"));
        assert_eq!(sanitize_key("../evil"), Some("evil".to_string()));
        assert_eq!(sanitize_key("!!!"), None);
    }

    #[test]
    fn traversal_paths_are_rejected() {
        assert_eq!(sanitize_rel_path("icons/search.png").as_deref(), Some("icons/search.png"));
        assert_eq!(sanitize_rel_path("pack\\icons\\x.png").as_deref(), Some("pack/icons/x.png"));
        assert!(sanitize_rel_path("../secret.png").is_none());
        assert!(sanitize_rel_path("icons/../../secret.png").is_none());
        assert!(sanitize_rel_path("/etc/passwd").is_none());
        assert!(sanitize_rel_path("C:/Windows/system32/x.png").is_none());
        assert!(sanitize_rel_path("icons/").is_none());
        assert!(sanitize_rel_path("").is_none());
        assert!(sanitize_rel_path("a/b/c/d/e/f/g/h/i.png").is_none());
    }

    #[test]
    fn extension_is_lowercased() {
        assert_eq!(extension("icons/ICON.PNG"), "png");
        assert_eq!(extension("noext"), "");
    }
}
