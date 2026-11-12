//! Локальный кэш: снимок архива и картинки публикаций.
//!
//! Всё лежит в `%APPDATA%\TitleWord-FileCache\cache`. Картинки сохраняются
//! файлами (имя — хэш адреса), поэтому архив с изображениями открывается и без
//! сети: фронтенд получает их как data-URL, а не как ссылку в интернет.

use crate::base64;
use crate::models::DataRoot;
use crate::paths;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// ============================================================
//  Кэш данных
// ============================================================

fn data_path() -> PathBuf {
    paths::cache_dir().join("data.json")
}

fn backup_path() -> PathBuf {
    paths::cache_dir().join("data.bak")
}

/// Сохраняет снимок данных. Запись идёт через временный файл, а предыдущий
/// снимок уходит в `.bak` — иначе при сбое посреди записи терялись бы оба файла.
pub fn save_json(data: &DataRoot) -> Result<(), String> {
    // Компактный JSON: кэш читает только приложение.
    let json = serde_json::to_string(data).map_err(|e| format!("сериализация кэша: {e}"))?;

    let tmp = paths::cache_dir().join("data.json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| format!("{}: {e}", tmp.display()))?;

    let path = data_path();
    if path.exists() {
        fs::copy(&path, backup_path()).map_err(|e| format!("{}: {e}", backup_path().display()))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(())
}

/// Читает сначала основной снимок, затем резервный.
pub fn load_json() -> Option<DataRoot> {
    for path in [data_path(), backup_path()] {
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        match serde_json::from_str::<DataRoot>(&content) {
            Ok(data) if !data.investigations.is_empty() => return Some(data),
            Ok(_) => eprintln!("[TitleWord] кэш пуст: {}", path.display()),
            Err(e) => eprintln!("[TitleWord] кэш повреждён ({}): {e}", path.display()),
        }
    }
    None
}

/// Время последней записи кэша в unix-секундах.
pub fn modified_unix() -> Option<i64> {
    let modified = fs::metadata(data_path()).ok()?.modified().ok()?;
    let secs = modified.duration_since(UNIX_EPOCH).ok()?.as_secs();
    i64::try_from(secs).ok()
}

/// Возраст кэша в секундах (отрицательный, если часы системы сбиты).
pub fn age_secs() -> Option<i64> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(i64::try_from(now).ok()? - modified_unix()?)
}

// ============================================================
//  Кэш картинок
// ============================================================

/// Хэш адреса: URL целиком в имя файла не помещается и содержит
/// недопустимые символы. FNV-1a — без внешних зависимостей.
fn fnv1a_64(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

pub fn image_path(url: &str) -> PathBuf {
    paths::images_dir().join(format!("{:016x}.bin", fnv1a_64(url.trim())))
}

pub fn read_image(url: &str) -> Option<Vec<u8>> {
    let bytes = fs::read(image_path(url)).ok()?;
    if bytes.is_empty() {
        None
    } else {
        Some(bytes)
    }
}

pub fn store_image(url: &str, bytes: &[u8]) -> Result<(), String> {
    let path = image_path(url);
    let tmp = path.with_extension("bin.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{}: {e}", path.display())
    })
}

/// data-URL для WebView: картинка на диске недоступна странице напрямую,
/// а `img-src data:` разрешён в CSP приложения.
pub fn data_url(bytes: &[u8]) -> String {
    format!("data:{};base64,{}", sniff_mime(bytes), base64::encode(bytes))
}

/// Тип картинки по сигнатуре файла: сервер может отдать что угодно,
/// а WebView рисует только то, что подписано корректным MIME.
fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        "image/svg+xml"
    } else {
        "image/png"
    }
}

// ============================================================
//  Статистика и очистка
// ============================================================

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct DirStat {
    pub files: u64,
    pub bytes: u64,
}

pub fn dir_stat(dir: &Path, recursive: bool) -> DirStat {
    dir_stat_at(dir, recursive, 0)
}

fn dir_stat_at(dir: &Path, recursive: bool, depth: usize) -> DirStat {
    // Ограничение глубины: обход не должен уйти в бесконечность на ссылках.
    if depth > 6 {
        return DirStat::default();
    }

    let mut stat = DirStat::default();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if recursive {
                let inner = dir_stat_at(&entry.path(), true, depth + 1);
                stat.files += inner.files;
                stat.bytes += inner.bytes;
            }
            continue;
        }

        stat.files += 1;
        stat.bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
    }
    stat
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheStats {
    /// Каталог, в котором лежат все данные приложения.
    pub root: String,
    pub data: DirStat,
    pub images: DirStat,
    pub packs: DirStat,
    pub fonts: DirStat,
}

pub fn stats() -> CacheStats {
    CacheStats {
        root: paths::root_dir().display().to_string(),
        data: dir_stat(&paths::cache_dir(), false),
        images: dir_stat(&paths::images_dir(), true),
        packs: crate::packs::list()
            .iter()
            .fold(DirStat::default(), |acc, pack| DirStat {
                files: acc.files + pack.files,
                bytes: acc.bytes + pack.bytes,
            }),
        fonts: dir_stat(&paths::fonts_dir(), false),
    }
}

/// Удаляет файлы каталога (и подкаталоги при `recursive`) и сообщает,
/// сколько освободилось. Сам каталог остаётся: приложение пишет в него снова.
pub fn remove_entries(dir: &Path, recursive: bool) -> DirStat {
    let mut stat = DirStat::default();

    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if !recursive {
                continue;
            }
            let inner = dir_stat(&path, true);
            if fs::remove_dir_all(&path).is_ok() {
                stat.files += inner.files;
                stat.bytes += inner.bytes;
            }
            continue;
        }

        let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if fs::remove_file(&path).is_ok() {
            stat.files += 1;
            stat.bytes += size;
        }
    }

    stat
}

/// Очистка по области: "images", "data", "cache", "fonts", "packs", "all".
pub fn clear(scope: &str) -> Result<DirStat, String> {
    let mut freed = DirStat::default();

    let mut merge = |part: DirStat| {
        freed.files += part.files;
        freed.bytes += part.bytes;
    };

    match scope {
        "images" => merge(remove_entries(&paths::images_dir(), true)),
        "data" => merge(remove_entries(&paths::cache_dir(), false)),
        "cache" => {
            merge(remove_entries(&paths::images_dir(), true));
            merge(remove_entries(&paths::cache_dir(), false));
        }
        "fonts" => {
            let before = dir_stat(&paths::fonts_dir(), true);
            crate::fonts::remove_all()?;
            merge(before);
        }
        "packs" => {
            let before = dir_stat(&paths::packs_dir(), true);
            crate::packs::remove_all()?;
            merge(before);
        }
        "all" => {
            merge(remove_entries(&paths::images_dir(), true));
            merge(remove_entries(&paths::cache_dir(), false));
            let packs = dir_stat(&paths::packs_dir(), true);
            let fonts = dir_stat(&paths::fonts_dir(), true);
            crate::packs::remove_all()?;
            crate::fonts::remove_all()?;
            merge(DirStat {
                files: packs.files + fonts.files,
                bytes: packs.bytes + fonts.bytes,
            });
        }
        other => return Err(format!("неизвестная область очистки: {other}")),
    }

    println!(
        "[TitleWord] очистка {scope}: удалено {} файлов",
        freed.files
    );
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_names_are_stable_and_distinct() {
        let a = image_path("https://example.com/a.png");
        assert_eq!(a, image_path("https://example.com/a.png"));
        assert_eq!(a, image_path("  https://example.com/a.png  "));
        assert_ne!(a, image_path("https://example.com/b.png"));
        assert_eq!(a.parent(), Some(paths::images_dir().as_path()));
        assert_eq!(a.extension().and_then(|e| e.to_str()), Some("bin"));
    }

    #[test]
    fn mime_is_detected_from_signature() {
        assert_eq!(sniff_mime(b"\x89PNG\r\n\x1a\n\x00\x00"), "image/png");
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(sniff_mime(b"GIF89a..."), "image/gif");
        assert_eq!(sniff_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp");
        // Неизвестная подпись не должна ломать отрисовку.
        assert_eq!(sniff_mime(b"\x00\x01\x02\x03"), "image/png");
    }

    #[test]
    fn data_url_is_base64_of_bytes() {
        assert_eq!(data_url(b"foobar"), "data:image/png;base64,Zm9vYmFy");
    }
}
