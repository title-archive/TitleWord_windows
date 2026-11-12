use serde::{Deserialize, Serialize};

/// Одна публикация из архива.
///
/// Данные приходят из внешнего JSON, поэтому все поля, кроме `id`,
/// объявлены необязательными: одна битая запись не должна ломать весь список.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Investigation {
    #[serde(default, deserialize_with = "de_id")]
    pub id: i32,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub short: String,
    #[serde(default)]
    pub full: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub images: Option<Vec<String>>,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub published: Option<String>,
    #[serde(default)]
    pub updated: Option<String>,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub author: Option<String>,
}

/// id в источнике бывает и числом, и строкой ("1", "2", …).
/// Неизвестные типы приводим к 0 вместо ошибки разбора всего документа.
fn de_id<'de, D>(d: D) -> Result<i32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) as i32,
        serde_json::Value::String(s) => s.trim().parse::<i32>().unwrap_or(0),
        _ => 0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataRoot {
    #[serde(default)]
    pub investigations: Vec<Investigation>,
}

/// Ответ команды `get_news`: данные + сведения об их происхождении.
#[derive(Debug, Clone, Serialize)]
pub struct NewsResponse {
    pub investigations: Vec<Investigation>,
    /// "network" — свежая загрузка, "cache" — локальный кэш.
    pub source: String,
    /// Время последней записи кэша (unix-секунды), если кэш есть.
    pub fetched_at: Option<i64>,
    /// Текст ошибки сети, если данные взяты из кэша.
    pub warning: Option<String>,
}

impl NewsResponse {
    pub fn from_cache(data: DataRoot, warning: Option<String>) -> Self {
        let fetched_at = crate::cache::modified_unix();
        Self {
            investigations: data.investigations,
            source: "cache".into(),
            fetched_at,
            warning,
        }
    }
}

pub const FONT_SIZE_MIN: f32 = 10.0;
pub const FONT_SIZE_MAX: f32 = 32.0;

/// Настройки приложения.
///
/// `#[serde(default)]` на структуре позволяет читать старые config.json,
/// в которых ещё нет новых полей: отсутствующие значения берутся из `Default`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub theme: String,
    pub font_size: f32,
    /// "system" | "serif" | "mono" | "custom" (см. `custom_font`).
    pub font_family: String,
    /// Идентификатор загруженного пользователем шрифта.
    pub custom_font: String,
    pub text_color: String,
    pub favorites: Vec<i32>,
    pub analytics_enabled: bool,
    pub holidays_enabled: bool,
    pub traffic_saving: bool,
    /// Сохранять картинки публикаций в кэш для офлайн-чтения.
    pub cache_images: bool,
    /// Показывать экран загрузки при старте.
    pub splash_enabled: bool,
    /// Идентификатор активного zip-пака с текстурами ("" — стандартные).
    pub active_pack: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            font_size: 16.0,
            font_family: "system".into(),
            custom_font: String::new(),
            text_color: "#1A1A1A".into(),
            favorites: vec![],
            analytics_enabled: false,
            holidays_enabled: true,
            traffic_saving: false,
            cache_images: true,
            splash_enabled: true,
            active_pack: String::new(),
        }
    }
}

impl AppConfig {
    /// Приводит значения к допустимым: файл настроек мог быть испорчен вручную.
    pub fn sanitized(mut self) -> Self {
        self.theme = match self.theme.trim().to_ascii_lowercase().as_str() {
            "dark" => "dark".into(),
            _ => "light".into(),
        };

        if !self.font_size.is_finite() {
            self.font_size = AppConfig::default().font_size;
        }
        self.font_size = self.font_size.clamp(FONT_SIZE_MIN, FONT_SIZE_MAX);

        self.font_family = match self.font_family.trim().to_ascii_lowercase().as_str() {
            "serif" => "serif".into(),
            "mono" => "mono".into(),
            "custom" => "custom".into(),
            _ => "system".into(),
        };

        // Идентификаторы становятся именами каталогов — их фильтрует paths.
        self.custom_font = crate::paths::sanitize_id(&self.custom_font).unwrap_or_default();
        self.active_pack = crate::paths::sanitize_id(&self.active_pack).unwrap_or_default();

        // Выбранный пользовательский шрифт мог быть удалён.
        if self.font_family == "custom" && self.custom_font.is_empty() {
            self.font_family = "system".into();
        }

        if !is_hex_color(&self.text_color) {
            self.text_color = AppConfig::default().text_color;
        }

        self.favorites.retain(|id| *id > 0);
        self.favorites.sort_unstable();
        self.favorites.dedup();

        self
    }
}

pub fn is_hex_color(value: &str) -> bool {
    let v = value.trim();
    matches!(v.len(), 4 | 7) && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_numeric_and_string_ids() {
        let json = r#"{"investigations":[
            {"id": 7, "title": "a"},
            {"id": "8", "title": "b"},
            {"title": "без id"}
        ]}"#;
        let root: DataRoot = serde_json::from_str(json).expect("json");
        let ids: Vec<i32> = root.investigations.iter().map(|i| i.id).collect();
        assert_eq!(ids, vec![7, 8, 0]);
    }

    #[test]
    fn old_config_gets_defaults() {
        let cfg: AppConfig = serde_json::from_str(r#"{"theme":"dark"}"#).expect("json");
        assert_eq!(cfg.theme, "dark");
        assert_eq!(cfg.font_size, AppConfig::default().font_size);
        assert!(!cfg.traffic_saving);
    }

    #[test]
    fn sanitize_clamps_values() {
        let cfg = AppConfig {
            theme: "  DARK ".into(),
            font_size: 99.0,
            font_family: "comic".into(),
            text_color: "red".into(),
            favorites: vec![3, 3, -1, 0, 5],
            ..AppConfig::default()
        }
        .sanitized();

        assert_eq!(cfg.theme, "dark");
        assert_eq!(cfg.font_size, FONT_SIZE_MAX);
        assert_eq!(cfg.font_family, "system");
        assert_eq!(cfg.text_color, AppConfig::default().text_color);
        assert_eq!(cfg.favorites, vec![3, 5]);
    }

    #[test]
    fn new_settings_have_defaults() {
        let cfg = AppConfig::default();
        assert!(cfg.cache_images, "картинки кэшируются по умолчанию");
        assert!(cfg.splash_enabled);
        assert!(cfg.active_pack.is_empty());
        assert!(cfg.custom_font.is_empty());
    }

    #[test]
    fn custom_font_requires_identifier() {
        let dangling = AppConfig {
            font_family: "custom".into(),
            ..AppConfig::default()
        }
        .sanitized();
        assert_eq!(dangling.font_family, "system", "шрифт удалён — падаем на системный");

        let chosen = AppConfig {
            font_family: "CUSTOM".into(),
            custom_font: "../../JetBrains Mono.ttf".into(),
            active_pack: "Ночной пак 1.0".into(),
            ..AppConfig::default()
        }
        .sanitized();
        assert_eq!(chosen.font_family, "custom");
        assert_eq!(chosen.custom_font, "jetbrains-mono-ttf");
        assert_eq!(chosen.active_pack, "ночной-пак-1-0");
    }
}