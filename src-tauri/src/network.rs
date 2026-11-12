use crate::models::DataRoot;
use reqwest::header::ACCEPT;
use reqwest::Client;
use std::time::Duration;

const GITHUB_URL: &str =
    "https://raw.githubusercontent.com/title-archive/data-title/refs/heads/main/data.json";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Картинки кэшируются целиком в память, поэтому размер ограничен:
/// одна публикация не должна занять весь кэш.
const IMAGE_MAX_BYTES: usize = 6 * 1024 * 1024;
const IMAGE_TIMEOUT: Duration = Duration::from_secs(20);

pub async fn fetch_data() -> Result<DataRoot, String> {
    let client = Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        // Без явного User-Agent GitHub отдаёт 403 на часть запросов.
        .user_agent(concat!(
            "TitleWord/",
            env!("CARGO_PKG_VERSION"),
            " (Windows; +https://title-word.vercel.app)"
        ))
        .build()
        .map_err(|e| format!("не удалось создать HTTP-клиент: {e}"))?;

    let resp = client
        .get(GITHUB_URL)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("сеть недоступна: {e}"))?
        .error_for_status()
        .map_err(|e| format!("источник данных вернул ошибку: {e}"))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("не удалось прочитать ответ: {e}"))?;

    let data: DataRoot =
        serde_json::from_str(&body).map_err(|e| format!("источник данных отдал битый JSON: {e}"))?;

    if data.investigations.is_empty() {
        return Err("источник данных вернул пустой список публикаций".into());
    }

    Ok(data)
}

/// Адреса картинок приходят из внешнего JSON, а скачивает их ядро по просьбе
/// страницы — поэтому схему проверяем сами, а не доверяем входным данным.
pub fn validate_image_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("пустой адрес картинки".into());
    }
    if trimmed.len() > 2048 {
        return Err("адрес картинки слишком длинный".into());
    }

    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("адрес картинки должен начинаться с http:// или https://".into());
    }

    Ok(())
}

pub async fn fetch_image(url: &str) -> Result<Vec<u8>, String> {
    validate_image_url(url)?;

    let client = Client::builder()
        .timeout(IMAGE_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("TitleWord/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("не удалось создать HTTP-клиент: {e}"))?;

    let response = client
        .get(url.trim())
        .send()
        .await
        .map_err(|e| format!("картинка недоступна: {e}"))?
        .error_for_status()
        .map_err(|e| format!("источник картинки вернул ошибку: {e}"))?;

    if let Some(length) = response.content_length() {
        if length as usize > IMAGE_MAX_BYTES {
            return Err("картинка больше 6 МБ".into());
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("не удалось прочитать картинку: {e}"))?;

    if bytes.is_empty() {
        return Err("источник вернул пустую картинку".into());
    }
    if bytes.len() > IMAGE_MAX_BYTES {
        return Err("картинка больше 6 МБ".into());
    }

    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::validate_image_url;

    #[test]
    fn only_http_urls_are_accepted() {
        assert!(validate_image_url("https://example.com/a.png").is_ok());
        assert!(validate_image_url("http://example.com/a.png").is_ok());
        assert!(validate_image_url("HTTPS://example.com/a.png").is_ok());

        assert!(validate_image_url("file:///C:/Windows/system32/logo.png").is_err());
        assert!(validate_image_url("assets/images/a.png").is_err());
        assert!(validate_image_url("data:image/png;base64,AAAA").is_err());
        assert!(validate_image_url("").is_err());
        assert!(validate_image_url(&format!("https://example.com/{}", "a".repeat(3000))).is_err());
    }
}