//! Zip-паки с текстурами и иконками.
//!
//! Архив распаковывает фронтенд (в WebView есть `DecompressionStream`), а ядро
//! проверяет пути и содержимое: пак не должен выйти за пределы своего каталога
//! и не должен принести ничего, кроме картинок и `main.json`.
//!
//! Формат `main.json`:
//! ```json
//! {
//!   "name": "Ночной пак",
//!   "version": "1.0.0",
//!   "description": "Тёмные текстуры",
//!   "accent": "#7C3AED",
//!   "logo": "images/logo.png",
//!   "placeholder": "images/placeholder.png",
//!   "background": "backgrounds/main.png",
//!   "icons": { "search": "icons/search.png" },
//!   "categories": { "tech": "categories/tech.png", "default": "categories/default.png" },
//!   "holidays": { "halloween": { "tech": "holidays/halloween/tech.png" } }
//! }
//! ```

use crate::base64;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILES: usize = 2000;
const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "gif"];

#[derive(Debug, Deserialize)]
pub struct PackFile {
    /// Путь внутри архива, например `icons/search.png`.
    pub path: String,
    /// Содержимое файла в base64.
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PackManifest {
    pub name: String,
    pub version: String,
    pub description: String,
    /// Акцентный цвет интерфейса, если пак его задаёт.
    pub accent: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub placeholder: Option<String>,
    /// Иконки интерфейса: `search`, `folder`, `heart`, `heart-filled`, `settings`,
    /// `back`, `copy`, `share`, `chevron`, `close`, `refresh`.
    pub icons: BTreeMap<String, String>,
    /// Текстуры разделов: ключ — идентификатор категории.
    pub categories: BTreeMap<String, String>,
    /// Праздничные текстуры: праздник → категория → файл.
    pub holidays: BTreeMap<String, BTreeMap<String, String>>,
}

impl Default for PackManifest {
    fn default() -> Self {
        Self {
            name: "Пак текстур".into(),
            version: String::new(),
            description: String::new(),
            accent: None,
            background: None,
            logo: None,
            placeholder: None,
            icons: BTreeMap::new(),
            categories: BTreeMap::new(),
            holidays: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub files: u64,
    /// Сколько файлов архива пропущено (служебные записи, битые пути).
    pub skipped: u32,
    pub manifest: PackManifest,
}

fn pack_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

fn manifest_path(root: &Path, id: &str) -> PathBuf {
    pack_dir(root, id).join("pack.json")
}

fn resolve_id(value: &str) -> Result<String, String> {
    paths::sanitize_id(value).ok_or_else(|| "некорректный идентификатор пака".to_string())
}

pub fn list() -> Vec<PackInfo> {
    list_in(&paths::packs_dir())
}

fn list_in(root: &Path) -> Vec<PackInfo> {
    let mut packs: Vec<PackInfo> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|entry| load_info(root, &entry.file_name().to_string_lossy()))
        .collect();

    packs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    packs
}

fn load_info(root: &Path, id: &str) -> Option<PackInfo> {
    let text = fs::read_to_string(manifest_path(root, id)).ok()?;
    let manifest: PackManifest = serde_json::from_str(&text).ok()?;
    let stat = crate::cache::dir_stat(&pack_dir(root, id), true);

    Some(PackInfo {
        id: id.to_string(),
        name: manifest.name.clone(),
        bytes: stat.bytes,
        files: stat.files,
        skipped: 0,
        manifest,
    })
}

/// Устанавливает пак из распакованного архива.
///
/// `source` — имя zip-файла: из него берётся идентификатор пака, если в
/// `main.json` нет пригодного названия.
pub fn install(source: &str, files: Vec<PackFile>) -> Result<PackInfo, String> {
    install_in(&paths::packs_dir(), source, files)
}

/// Каталог паков передаётся явно: так установку можно проверить на временной
/// папке, не трогая данные пользователя.
fn install_in(root: &Path, source: &str, files: Vec<PackFile>) -> Result<PackInfo, String> {
    if files.is_empty() {
        return Err("архив пуст".into());
    }
    if files.len() > MAX_FILES {
        return Err(format!("в архиве слишком много файлов (максимум {MAX_FILES})"));
    }

    let mut skipped = 0u32;
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total = 0usize;

    for file in files {
        let path = match paths::sanitize_rel_path(&file.path) {
            Some(path) => path,
            None => {
                skipped += 1;
                continue;
            }
        };
        let bytes = match base64::decode(&file.data) {
            Ok(bytes) => bytes,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        // Записи каталогов приходят пустыми — они не нужны.
        if bytes.is_empty() {
            continue;
        }
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!(
                "{path}: файл больше {} МБ",
                MAX_FILE_BYTES / (1024 * 1024)
            ));
        }

        total += bytes.len();
        if total > MAX_TOTAL_BYTES {
            return Err("после распаковки архив больше 32 МБ".into());
        }
        entries.push((path, bytes));
    }

    if entries.is_empty() {
        return Err("в архиве нет подходящих файлов".into());
    }

    // main.json ищется на самом верхнем уровне: он же задаёт корень пака.
    let manifest_rel = entries
        .iter()
        .map(|(path, _)| path.as_str())
        .filter(|path| {
            path.rsplit('/')
                .next()
                .map(|name| name.eq_ignore_ascii_case("main.json"))
                .unwrap_or(false)
        })
        .min_by_key(|path| path.matches('/').count())
        .ok_or_else(|| "в архиве нет main.json с описанием текстур".to_string())?
        .to_string();

    let prefix = match manifest_rel.rfind('/') {
        Some(index) => manifest_rel[..=index].to_string(),
        None => String::new(),
    };

    let mut relative: Vec<(String, Vec<u8>)> = Vec::new();
    for (path, bytes) in entries {
        let rel = if prefix.is_empty() {
            path
        } else {
            match path.strip_prefix(&prefix) {
                Some(rel) if !rel.is_empty() => rel.to_string(),
                // Файлы вне корневой папки пака (например, __MACOSX) не нужны.
                _ => {
                    skipped += 1;
                    continue;
                }
            }
        };
        relative.push((rel, bytes));
    }

    let available: BTreeSet<String> = relative.iter().map(|(path, _)| path.clone()).collect();

    let manifest_bytes = relative
        .iter()
        .find(|(path, _)| path == "main.json")
        .map(|(_, bytes)| bytes.clone())
        .ok_or("в архиве нет main.json")?;
    let raw: PackManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|e| format!("main.json: {e}"))?;
    let manifest = clean_manifest(&raw, &available);

    if texture_count(&manifest) == 0 {
        return Err(
            "в main.json нет ни одной существующей текстуры: проверьте пути к png-файлам".into(),
        );
    }

    let id = resolve_id(&manifest.name)
        .or_else(|_| resolve_id(source))
        .unwrap_or_else(|_| "pack".to_string());

    let dir = pack_dir(root, &id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;

    for (rel, bytes) in &relative {
        let target = dir.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        fs::write(&target, bytes).map_err(|e| format!("{}: {e}", target.display()))?;
    }

    // Нормализованный манифест: по нему приложение читает пак при следующем старте.
    let normalized = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("не удалось сохранить описание пака: {e}"))?;
    fs::write(manifest_path(root, &id), normalized)
        .map_err(|e| format!("{}: {e}", manifest_path(root, &id).display()))?;

    let stat = crate::cache::dir_stat(&dir, true);
    Ok(PackInfo {
        id,
        name: manifest.name.clone(),
        bytes: stat.bytes,
        files: stat.files,
        skipped,
        manifest,
    })
}

pub fn remove(id: &str) -> Result<(), String> {
    remove_in(&paths::packs_dir(), id)
}

fn remove_in(root: &Path, id: &str) -> Result<(), String> {
    let id = resolve_id(id)?;
    let dir = pack_dir(root, &id);
    if !dir.is_dir() {
        return Err("пак не найден".into());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))
}

pub fn remove_all() -> Result<u32, String> {
    let mut removed = 0u32;
    for entry in fs::read_dir(paths::packs_dir()).into_iter().flatten().flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        fs::remove_dir_all(entry.path()).map_err(|e| format!("{}: {e}", entry.path().display()))?;
        removed += 1;
    }
    Ok(removed)
}

/// Отдаёт текстуру пака как data-URL: WebView не имеет доступа к диску,
/// а `img-src data:` уже разрешён в CSP.
pub fn image(pack_id: &str, rel: &str) -> Result<String, String> {
    image_in(&paths::packs_dir(), pack_id, rel)
}

fn image_in(root: &Path, pack_id: &str, rel: &str) -> Result<String, String> {
    let id = resolve_id(pack_id)?;
    let clean = paths::sanitize_rel_path(rel).ok_or("некорректный путь текстуры")?;
    if !is_image_path(&clean) {
        return Err("текстура должна быть png, jpg, webp или gif".into());
    }

    let dir = pack_dir(root, &id);
    let path = dir.join(clean.replace('/', std::path::MAIN_SEPARATOR_STR));

    // Проверяем по каноническому пути: символическая ссылка не должна
    // вывести чтение за пределы каталога пака.
    let base = dir.canonicalize().map_err(|e| format!("{}: {e}", dir.display()))?;
    let target = path
        .canonicalize()
        .map_err(|_| format!("текстура не найдена: {clean}"))?;
    if !target.starts_with(&base) {
        return Err("путь текстуры выходит за пределы пака".into());
    }

    let bytes = fs::read(&target).map_err(|e| format!("{}: {e}", target.display()))?;
    if bytes.is_empty() {
        return Err("файл текстуры пуст".into());
    }
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("текстура больше 4 МБ".into());
    }

    Ok(crate::cache::data_url(&bytes))
}

fn clean_manifest(raw: &PackManifest, available: &BTreeSet<String>) -> PackManifest {
    let mut clean = PackManifest {
        name: clean_text(&raw.name, 60).unwrap_or_else(|| PackManifest::default().name),
        version: clean_text(&raw.version, 24).unwrap_or_default(),
        description: clean_text(&raw.description, 200).unwrap_or_default(),
        accent: raw
            .accent
            .as_deref()
            .map(str::trim)
            .filter(|value| crate::models::is_hex_color(value))
            .map(|value| value.to_ascii_lowercase()),
        ..PackManifest::default()
    };

    clean.background = pick_image(raw.background.as_deref(), available);
    clean.logo = pick_image(raw.logo.as_deref(), available);
    clean.placeholder = pick_image(raw.placeholder.as_deref(), available);

    // Несуществующие ссылки выбрасываются: лучше пак без части текстур,
    // чем падающая отрисовка из-за отсутствующего файла.
    clean.icons = raw
        .icons
        .iter()
        .filter_map(|(key, value)| Some((paths::sanitize_key(key)?, pick_image(Some(value), available)?)))
        .collect();
    clean.categories = raw
        .categories
        .iter()
        .filter_map(|(key, value)| Some((paths::sanitize_key(key)?, pick_image(Some(value), available)?)))
        .collect();
    clean.holidays = raw
        .holidays
        .iter()
        .filter_map(|(holiday, textures)| {
            let holiday = paths::sanitize_key(holiday)?;
            let inner: BTreeMap<String, String> = textures
                .iter()
                .filter_map(|(key, value)| {
                    Some((paths::sanitize_key(key)?, pick_image(Some(value), available)?))
                })
                .collect();
            if inner.is_empty() {
                None
            } else {
                Some((holiday, inner))
            }
        })
        .collect();

    clean
}

fn pick_image(value: Option<&str>, available: &BTreeSet<String>) -> Option<String> {
    let clean = paths::sanitize_rel_path(value?)?;
    if !is_image_path(&clean) {
        return None;
    }
    available.contains(&clean).then_some(clean)
}

fn texture_count(manifest: &PackManifest) -> usize {
    let extras = [&manifest.logo, &manifest.placeholder, &manifest.background]
        .iter()
        .filter(|value| value.is_some())
        .count();

    manifest.icons.len()
        + manifest.categories.len()
        + manifest.holidays.values().map(|textures| textures.len()).sum::<usize>()
        + extras
}

fn is_image_path(path: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&paths::extension(path).as_str())
}

fn clean_text(value: &str, limit: usize) -> Option<String> {
    let clean: String = value
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect();

    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn available(paths: &[&str]) -> BTreeSet<String> {
        paths.iter().map(|path| path.to_string()).collect()
    }

    fn manifest(json: &str) -> PackManifest {
        serde_json::from_str(json).expect("main.json")
    }

    #[test]
    fn empty_manifest_gets_defaults() {
        let parsed = manifest("{}");
        assert_eq!(parsed.name, PackManifest::default().name);
        assert!(parsed.icons.is_empty());
    }

    #[test]
    fn missing_references_are_dropped() {
        let raw = manifest(
            r#"{
                "name": "Пак",
                "accent": "не цвет",
                "icons": { "search": "icons/search.png", "broken": "icons/none.png" },
                "categories": { "tech": "categories/tech.png" },
                "holidays": { "halloween": { "tech": "holidays/halloween/tech.png" } },
                "logo": "images/logo.png"
            }"#,
        );
        let files = available(&["icons/search.png", "categories/tech.png"]);
        let clean = clean_manifest(&raw, &files);

        assert_eq!(clean.icons.keys().collect::<Vec<_>>(), vec!["search"]);
        assert_eq!(clean.categories.keys().collect::<Vec<_>>(), vec!["tech"]);
        assert!(clean.holidays.is_empty(), "праздничных текстур в архиве нет");
        assert!(clean.logo.is_none(), "логотипа в архиве нет");
        assert!(clean.accent.is_none(), "некорректный цвет отброшен");
        assert_eq!(texture_count(&clean), 2);
    }

    #[test]
    fn non_image_and_traversal_references_are_rejected() {
        let raw = manifest(
            r##"{
                "name": "Пак",
                "accent": "#7C3AED",
                "icons": { "search": "../secret.png", "folder": "notes.txt" },
                "background": "bg.png"
            }"##,
        );
        let files = available(&["../secret.png", "notes.txt", "bg.png"]);
        let clean = clean_manifest(&raw, &files);

        assert!(clean.icons.is_empty());
        assert_eq!(clean.background.as_deref(), Some("bg.png"));
        assert_eq!(clean.accent.as_deref(), Some("#7c3aed"));
    }

    #[test]
    fn names_are_trimmed_and_limited() {
        let raw = manifest(&format!(r#"{{"name":"  {}  "}}"#, "я".repeat(100)));
        let clean = clean_manifest(&raw, &available(&[]));
        assert_eq!(clean.name.chars().count(), 60);
        assert!(!clean.name.starts_with(' '));
    }

    #[test]
    fn ids_come_from_names_and_files() {
        assert_eq!(resolve_id("Ночной пак").unwrap(), "ночной-пак");
        assert!(resolve_id("...").is_err());
        assert!(resolve_id(&"a".repeat(200)).unwrap().len() <= 48);
    }

    #[test]
    fn install_writes_pack_into_given_directory() {
        let root = std::env::temp_dir().join("titleword-pack-install-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temp dir");

        let files = vec![
            PackFile {
                path: "pack/main.json".into(),
                data: base64::encode(
                    r#"{"name":"Тестовый пак","icons":{"search":"icons/search.png"}}"#.as_bytes(),
                ),
            },
            PackFile {
                path: "pack/icons/search.png".into(),
                data: base64::encode(b"\x89PNG\r\n\x1a\n\x00"),
            },
            PackFile {
                path: "__MACOSX/._main.json".into(),
                data: base64::encode(b"junk"),
            },
        ];

        let info = install_in(&root, "test-pack.zip", files).expect("установка пака");
        assert_eq!(info.id, "тестовый-пак");
        assert_eq!(info.manifest.icons.len(), 1);
        assert_eq!(info.skipped, 1, "служебный файл вне корня пака пропущен");

        let dir = root.join(&info.id);
        assert!(dir.join("icons").join("search.png").is_file(), "текстура записана");
        assert!(dir.join("pack.json").is_file(), "манифест нормализован");

        let listed = list_in(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Тестовый пак");

        let url = image_in(&root, &info.id, "icons/search.png").expect("текстура");
        assert!(url.starts_with("data:image/png;base64,"), "{url}");

        // Путь за пределы пака и файл не-картинка запрещены.
        assert!(image_in(&root, &info.id, "../pack.json").is_err());
        assert!(image_in(&root, &info.id, "pack.json").is_err());
        assert!(image_in(&root, "../packs", "icons/search.png").is_err());

        // Повторная установка заменяет пак, а не добавляет второй.
        let again = install_in(
            &root,
            "test-pack.zip",
            vec![
                PackFile {
                    path: "main.json".into(),
                    data: base64::encode(
                        r#"{"name":"Тестовый пак","categories":{"tech":"c/tech.png"}}"#.as_bytes(),
                    ),
                },
                PackFile {
                    path: "c/tech.png".into(),
                    data: base64::encode(b"\x89PNG\r\n\x1a\n\x01"),
                },
            ],
        )
        .expect("переустановка");
        assert_eq!(again.id, info.id);
        assert!(again.manifest.icons.is_empty(), "старый манифест заменён");
        assert_eq!(list_in(&root).len(), 1);

        // Пустой архив и архив без main.json отклоняются.
        assert!(install_in(&root, "empty.zip", Vec::new()).is_err());
        assert!(install_in(
            &root,
            "no-manifest.zip",
            vec![PackFile {
                path: "icons/search.png".into(),
                data: base64::encode(b"\x89PNG\r\n\x1a\n\x02"),
            }],
        )
        .is_err());

        let _ = fs::remove_dir_all(&root);
    }
}
