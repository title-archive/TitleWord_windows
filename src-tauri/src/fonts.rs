//! Пользовательские шрифты: хранение в `%APPDATA%\TitleWord-FileCache\fonts`.
//!
//! Файл целиком читает только ядро, наружу он уходит в base64, а фронтенд
//! регистрирует его через `FontFace`. Так не нужны ни файловая система в
//! WebView, ни `asset:`-протокол с дополнительными правами.

use crate::base64;
use crate::paths;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

const MAX_FONT_BYTES: usize = 24 * 1024 * 1024;
const ALLOWED_EXTENSIONS: [&str; 4] = ["ttf", "otf", "woff", "woff2"];

#[derive(Debug, Clone, Serialize)]
pub struct FontInfo {
    pub id: String,
    /// Название семейства из таблицы `name` — именно его подставляет CSS.
    pub family: String,
    pub file: String,
    pub bytes: u64,
    pub format: String,
}

#[derive(Debug, Serialize)]
pub struct FontPayload {
    pub info: FontInfo,
    /// Содержимое файла шрифта в base64.
    pub data: String,
}

pub fn list() -> Vec<FontInfo> {
    let mut out: Vec<FontInfo> = fs::read_dir(paths::fonts_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|entry| describe(&entry.file_name().to_string_lossy()))
        .collect();

    out.sort_by(|a, b| {
        a.family
            .to_lowercase()
            .cmp(&b.family.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

pub fn install(file_name: &str, data: &str) -> Result<FontInfo, String> {
    let bytes = base64::decode(data).map_err(|e| format!("не удалось прочитать файл шрифта: {e}"))?;
    if bytes.is_empty() {
        return Err("файл шрифта пуст".into());
    }
    if bytes.len() > MAX_FONT_BYTES {
        return Err(format!("шрифт больше {} МБ", MAX_FONT_BYTES / (1024 * 1024)));
    }

    let ext = paths::extension(file_name);
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err("поддерживаются шрифты ttf, otf, woff и woff2".into());
    }
    if !looks_like_font(&bytes) {
        return Err("файл не похож на шрифт: неверная подпись".into());
    }

    let stem = file_name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(file_name);
    let id = paths::sanitize_id(stem).ok_or("некорректное имя файла шрифта")?;
    let family = family_name(&bytes, &ext).unwrap_or_else(|| prettify(&id));

    // Повторная загрузка файла с тем же именем заменяет прошлую версию.
    let _ = remove(&id);

    let target = paths::fonts_dir().join(format!("{id}.{ext}"));
    fs::write(&target, &bytes).map_err(|e| format!("{}: {e}", target.display()))?;

    Ok(FontInfo {
        family,
        file: format!("{id}.{ext}"),
        bytes: bytes.len() as u64,
        format: ext,
        id,
    })
}

pub fn read(id: &str) -> Result<FontPayload, String> {
    let id = paths::sanitize_id(id).ok_or("некорректный идентификатор шрифта")?;
    let path = font_file(&id).ok_or_else(|| "шрифт не найден".to_string())?;
    let data = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let info = describe(&file_name).ok_or("шрифт не найден")?;

    Ok(FontPayload {
        info,
        data: base64::encode(&data),
    })
}

pub fn remove(id: &str) -> Result<(), String> {
    let id = paths::sanitize_id(id).ok_or("некорректный идентификатор шрифта")?;
    for path in files_with_id(&id) {
        fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

pub fn remove_all() -> Result<u32, String> {
    let mut removed = 0u32;
    for entry in fs::read_dir(paths::fonts_dir()).into_iter().flatten().flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        fs::remove_file(entry.path()).map_err(|e| format!("{}: {e}", entry.path().display()))?;
        removed += 1;
    }
    Ok(removed)
}

/// Все файлы шрифта с данным идентификатором: расширение могло меняться.
fn files_with_id(id: &str) -> Vec<PathBuf> {
    fs::read_dir(paths::fonts_dir())
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| paths::sanitize_id(stem).as_deref() == Some(id))
                .unwrap_or(false)
        })
        .collect()
}

fn font_file(id: &str) -> Option<PathBuf> {
    fs::read_dir(paths::fonts_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|entry| entry.path())
        .find(|path| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| paths::sanitize_id(stem).as_deref() == Some(id))
                .unwrap_or(false)
        })
}

fn describe(file_name: &str) -> Option<FontInfo> {
    let (stem, ext) = file_name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return None;
    }

    let path = paths::fonts_dir().join(file_name);
    let bytes = fs::read(&path).ok()?;
    let family = family_name(&bytes, &ext).unwrap_or_else(|| prettify(stem));

    Some(FontInfo {
        id: paths::sanitize_id(stem)?,
        family,
        file: file_name.to_string(),
        bytes: bytes.len() as u64,
        format: ext,
    })
}

fn looks_like_font(bytes: &[u8]) -> bool {
    matches!(
        bytes.get(..4),
        Some(b"\x00\x01\x00\x00")
            | Some(b"\x00\x00\x01\x00")
            | Some(b"true")
            | Some(b"OTTO")
            | Some(b"ttcf")
            | Some(b"typ1")
            | Some(b"wOFF")
            | Some(b"wOF2")
    )
}

/// Название семейства есть только в sfnt-шрифтах (ttf/otf).
/// В woff/woff2 таблица `name` сжата, поэтому там используется имя файла.
fn family_name(bytes: &[u8], ext: &str) -> Option<String> {
    match ext {
        "ttf" | "otf" => sfnt_family(bytes).and_then(|name| clean_family(&name)),
        _ => None,
    }
}

fn sfnt_family(bytes: &[u8]) -> Option<String> {
    // Коллекция шрифтов: берём первый шрифт.
    let offset = if bytes.get(..4) == Some(b"ttcf") {
        read_u32(bytes, 12)? as usize
    } else {
        0
    };

    let tables = read_u16(bytes, offset + 4)? as usize;
    let mut name_table: Option<(usize, usize)> = None;
    for index in 0..tables {
        let record = offset + 12 + index * 16;
        if bytes.get(record..record + 4) == Some(b"name") {
            let start = read_u32(bytes, record + 8)? as usize;
            let len = read_u32(bytes, record + 12)? as usize;
            name_table = Some((start, len));
            break;
        }
    }

    let (start, len) = name_table?;
    let table = bytes.get(start..start.checked_add(len)?)?;
    let count = read_u16(table, 2)? as usize;
    let strings = read_u16(table, 4)? as usize;

    let mut best: Option<(u8, String)> = None;
    for index in 0..count {
        let record = 6 + index * 12;
        let platform = read_u16(table, record)?;
        let name_id = read_u16(table, record + 6)?;
        if name_id != 1 && name_id != 4 && name_id != 16 {
            continue;
        }

        let len = read_u16(table, record + 8)? as usize;
        let offset = strings.checked_add(read_u16(table, record + 10)? as usize)?;
        let raw = table.get(offset..offset.checked_add(len)?)?;

        // Платформы 0 и 3 хранят строки в UTF-16BE, остальные — в однобайтовой кодировке.
        let text = if platform == 0 || platform == 3 {
            decode_utf16_be(raw)
        } else {
            decode_latin1(raw)
        };
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            continue;
        }

        let priority = match (platform, name_id) {
            (3, 1) => 0,
            (3, 16) => 1,
            (1, 1) => 2,
            (3, 4) => 3,
            _ => 4,
        };
        if best.as_ref().map(|(current, _)| priority < *current).unwrap_or(true) {
            best = Some((priority, text));
        }
    }

    best.map(|(_, text)| text)
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let slice = bytes.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn decode_utf16_be(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

fn decode_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| *byte as char).collect()
}

fn clean_family(name: &str) -> Option<String> {
    let clean: String = name
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(60)
        .collect();

    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

/// «my-font_v2» → «My Font V2»: запасной вариант, когда имени в файле нет.
fn prettify(value: &str) -> String {
    let text = value
        .split(['-', '_', '.'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    if text.is_empty() {
        "Пользовательский шрифт".into()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Собирает минимальный sfnt с одной записью `name` (платформа 3 = UTF-16BE).
    fn synthetic_font(family: &str) -> Vec<u8> {
        let utf16: Vec<u8> = family
            .encode_utf16()
            .flat_map(|unit| unit.to_be_bytes())
            .collect();

        let mut name = Vec::new();
        name.extend_from_slice(&0u16.to_be_bytes()); // format
        name.extend_from_slice(&1u16.to_be_bytes()); // count
        name.extend_from_slice(&(6u16 + 12).to_be_bytes()); // stringOffset
        name.extend_from_slice(&3u16.to_be_bytes()); // platformID
        name.extend_from_slice(&1u16.to_be_bytes()); // encodingID
        name.extend_from_slice(&0x0409u16.to_be_bytes()); // languageID
        name.extend_from_slice(&1u16.to_be_bytes()); // nameID = family
        name.extend_from_slice(&(utf16.len() as u16).to_be_bytes()); // length
        name.extend_from_slice(&0u16.to_be_bytes()); // offset
        name.extend_from_slice(&utf16);

        let mut font = Vec::new();
        font.extend_from_slice(&0x00010000u32.to_be_bytes()); // sfnt version
        font.extend_from_slice(&1u16.to_be_bytes()); // numTables
        font.extend_from_slice(&[0u8; 6]); // searchRange/entrySelector/rangeShift
        font.extend_from_slice(b"name");
        font.extend_from_slice(&0u32.to_be_bytes()); // checksum
        font.extend_from_slice(&28u32.to_be_bytes()); // offset (12 + 16)
        font.extend_from_slice(&(name.len() as u32).to_be_bytes());
        font.extend_from_slice(&name);
        font
    }

    #[test]
    fn reads_family_from_name_table() {
        let font = synthetic_font("Test Family");
        assert_eq!(family_name(&font, "ttf").as_deref(), Some("Test Family"));
    }

    #[test]
    fn broken_font_does_not_panic() {
        assert_eq!(family_name(&[], "ttf"), None);
        assert_eq!(family_name(&[0, 1, 0, 0], "ttf"), None);
        assert_eq!(family_name(b"\x00\x01\x00\x00\xff\xff\xff\xff", "ttf"), None);
        // Усечённый sfnt: таблица объявлена, но данных нет.
        let font = synthetic_font("Cut");
        assert_eq!(family_name(&font[..20], "ttf"), None);
    }

    #[test]
    fn woff_has_no_readable_family() {
        let mut font = synthetic_font("X");
        font[..4].copy_from_slice(b"wOFF");
        assert_eq!(family_name(&font, "woff"), None);
    }

    #[test]
    fn signature_check_rejects_text_files() {
        assert!(looks_like_font(b"\x00\x01\x00\x00\x00"));
        assert!(looks_like_font(b"wOF2\x00\x00"));
        assert!(!looks_like_font(b"just a text file"));
        assert!(!looks_like_font(b""));
    }

    #[test]
    fn pretty_names_are_human_readable() {
        assert_eq!(prettify("jetbrains-mono_v2"), "Jetbrains Mono V2");
        assert_eq!(prettify("---"), "Пользовательский шрифт");
    }

    #[test]
    fn family_names_are_cleaned() {
        assert_eq!(clean_family("  A\u{0007}rial  Bold ").as_deref(), Some("Arial Bold"));
        assert_eq!(clean_family("   "), None);
    }
}
