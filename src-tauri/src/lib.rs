mod analytics;
mod base64;
mod cache;
mod config;
mod fonts;
mod holidays;
mod model;
mod models;
mod network;
mod packs;
mod paths;

use models::{AppConfig, NewsResponse};

/// Свежий кэш, который можно отдать без похода в сеть в режиме экономии трафика.
const CACHE_TTL_SECS: i64 = 10 * 60;

const ABOUT_TEXT: &str = include_str!("../../src/assets/about.txt");
const PRIVACY_TEXT: &str = include_str!("../../src/assets/privacy.txt");
const AGREEMENT_TEXT: &str = include_str!("../../src/assets/agreement.txt");

#[tauri::command]
async fn get_news(traffic_saving: Option<bool>, force: Option<bool>) -> Result<NewsResponse, String> {
    let traffic_saving = traffic_saving.unwrap_or(false);
    let force = force.unwrap_or(false);

    if traffic_saving && !force {
        if let (Some(data), Some(age)) = (cache::load_json(), cache::age_secs()) {
            if (0..CACHE_TTL_SECS).contains(&age) {
                println!(
                    "[TitleWord] свежий кэш ({} c), сеть не нужна: {} публикаций",
                    age,
                    data.investigations.len()
                );
                return Ok(NewsResponse::from_cache(data, None));
            }
        }
    }

    match network::fetch_data().await {
        Ok(data) => {
            println!("[TitleWord] загружено публикаций: {}", data.investigations.len());
            if let Err(e) = cache::save_json(&data) {
                eprintln!("[TitleWord] не удалось сохранить кэш: {e}");
            }
            Ok(NewsResponse {
                investigations: data.investigations,
                source: "network".into(),
                fetched_at: cache::modified_unix(),
                warning: None,
            })
        }
        Err(e) => {
            eprintln!("[TitleWord] ошибка сети: {e}");
            match cache::load_json() {
                Some(cached) => {
                    println!("[TitleWord] работаю из кэша: {} публикаций", cached.investigations.len());
                    Ok(NewsResponse::from_cache(cached, Some(e)))
                }
                None => Err(format!("Нет связи с источником данных и кэш пуст: {e}")),
            }
        }
    }
}

// ============================================================
//  Кэш картинок
// ============================================================

/// Картинка из локального кэша, а при первом обращении — из сети с сохранением.
///
/// Наружу отдаётся data-URL: страница не имеет доступа к диску, и это
/// единственный способ показать сохранённую картинку офлайн.
#[tauri::command]
async fn get_cached_image(url: String) -> Result<String, String> {
    if let Some(bytes) = cache::read_image(&url) {
        return Ok(cache::data_url(&bytes));
    }

    let bytes = network::fetch_image(&url).await?;
    if let Err(e) = cache::store_image(&url, &bytes) {
        eprintln!("[TitleWord] картинка не сохранена в кэш: {e}");
    }

    Ok(cache::data_url(&bytes))
}

#[tauri::command]
fn cache_stats() -> cache::CacheStats {
    cache::stats()
}

#[tauri::command]
fn clear_cache(scope: String) -> Result<cache::CacheStats, String> {
    cache::clear(&scope)?;
    Ok(cache::stats())
}

// ============================================================
//  Шрифты и zip-паки с текстурами
// ============================================================

#[tauri::command]
fn list_fonts() -> Vec<fonts::FontInfo> {
    fonts::list()
}

#[tauri::command]
fn install_font(name: String, data: String) -> Result<fonts::FontInfo, String> {
    fonts::install(&name, &data)
}

#[tauri::command]
fn read_font(id: String) -> Result<fonts::FontPayload, String> {
    fonts::read(&id)
}

#[tauri::command]
fn delete_font(id: String) -> Result<(), String> {
    fonts::remove(&id)
}

#[tauri::command]
fn list_packs() -> Vec<packs::PackInfo> {
    packs::list()
}

#[tauri::command]
fn install_pack(source: String, files: Vec<packs::PackFile>) -> Result<packs::PackInfo, String> {
    packs::install(&source, files)
}

#[tauri::command]
fn read_pack_image(pack: String, rel: String) -> Result<String, String> {
    packs::image(&pack, &rel)
}

#[tauri::command]
fn delete_pack(id: String) -> Result<(), String> {
    packs::remove(&id)
}

// ============================================================
//  Настройки и служебное
// ============================================================

#[tauri::command]
fn get_config() -> AppConfig {
    config::load_config()
}

#[tauri::command]
fn set_config(cfg: AppConfig) -> Result<(), String> {
    config::save_config(&cfg)
}

/// Сброс настроек к значениям по умолчанию (избранное сохраняется).
#[tauri::command]
fn reset_config() -> Result<AppConfig, String> {
    config::reset_config()
}

#[tauri::command]
async fn track_visit(enabled: bool) {
    analytics::send_analytics(enabled).await;
}

#[tauri::command]
fn current_holiday() -> Option<String> {
    holidays::current_holiday().map(String::from)
}

/// Версия показывается пользователю целиком, вместе с каналом сборки.
#[tauri::command]
fn app_version() -> String {
    format!("{} release", env!("CARGO_PKG_VERSION"))
}

/// Тексты документов вшиты в бинарник: в установленном приложении каталога
/// `src/assets` рядом с exe нет, поэтому чтение с диска не работало.
/// Заодно исчезает любой путь для обхода каталогов через имя файла.
#[tauri::command]
fn read_text_asset(name: String) -> Result<String, String> {
    let text = match name.as_str() {
        "about.txt" | "about" => ABOUT_TEXT,
        "privacy.txt" | "privacy" => PRIVACY_TEXT,
        "agreement.txt" | "agreement" | "terms" => AGREEMENT_TEXT,
        other => return Err(format!("Неизвестный документ: {other}")),
    };
    Ok(text.to_string())
}

/// 3D-модель пасхалки из `src/assets/model` (запасной источник, если
/// фронтенд не смог прочитать файл как обычный ассет).
#[tauri::command]
fn embedded_model(kind: String) -> Result<String, String> {
    model::asset(&kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// В установленной сборке рядом с exe нет каталога `src/assets`, поэтому
    /// документы обязаны быть вшиты в бинарник и читаться без файловой системы.
    #[test]
    fn embedded_documents_are_available() {
        for name in ["about.txt", "privacy.txt", "agreement.txt"] {
            let text = read_text_asset(name.to_string()).expect("документ должен читаться");
            assert!(!text.trim().is_empty(), "{name}: документ пуст");
            assert!(text.chars().count() > 200, "{name}: текст подозрительно короткий");
        }
    }

    #[test]
    fn documents_are_distinct_and_unknown_name_is_rejected() {
        let about = read_text_asset("about".into()).expect("about");
        let privacy = read_text_asset("privacy".into()).expect("privacy");
        let terms = read_text_asset("terms".into()).expect("terms");
        assert_ne!(about, privacy);
        assert_ne!(privacy, terms);
        // Имя файла не должно открывать доступ к произвольным путям на диске.
        assert!(read_text_asset("../../etc/passwd".into()).is_err());
    }

    #[test]
    fn version_is_shown_with_release_channel() {
        let version = app_version();
        assert!(version.starts_with(env!("CARGO_PKG_VERSION")), "{version}");
        assert!(version.ends_with(" release"), "{version}");
    }

    #[test]
    fn unknown_clearing_scope_is_rejected() {
        assert!(cache::clear("../../").is_err());
        assert!(cache::clear("").is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Перенос данных из старого каталога до любых чтений настроек.
    paths::migrate_legacy();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_news,
            get_config,
            set_config,
            reset_config,
            track_visit,
            current_holiday,
            app_version,
            read_text_asset,
            get_cached_image,
            cache_stats,
            clear_cache,
            list_fonts,
            install_font,
            read_font,
            delete_font,
            list_packs,
            install_pack,
            read_pack_image,
            delete_pack,
            embedded_model
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
