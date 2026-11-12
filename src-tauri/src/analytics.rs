use reqwest::Client;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Отправляется только при явно включённой в настройках аналитике.
/// Имя компьютера, IP и прочие идентификаторы не передаём.
const ENDPOINT: &str = "https://title-word.cloudpub.ru/api/analytics";

static ALREADY_SENT: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct AnalyticsPayload {
    app: &'static str,
    os: &'static str,
    arch: &'static str,
    app_version: &'static str,
    dev_mode: bool,
}

pub async fn send_analytics(enabled: bool) {
    if !enabled {
        return;
    }
    // Один запрос за запуск даже при повторных переключениях настройки.
    if ALREADY_SENT.swap(true, Ordering::SeqCst) {
        return;
    }

    let payload = AnalyticsPayload {
        app: "title-word-windows",
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        app_version: env!("CARGO_PKG_VERSION"),
        dev_mode: cfg!(debug_assertions),
    };

    let client = match Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent(concat!("TitleWord/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            ALREADY_SENT.store(false, Ordering::SeqCst);
            eprintln!("[TitleWord] analytics client: {e}");
            return;
        }
    };

    match client.post(ENDPOINT).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => {}
        Ok(resp) => {
            ALREADY_SENT.store(false, Ordering::SeqCst);
            eprintln!("[TitleWord] analytics HTTP {}", resp.status());
        }
        Err(e) => {
            // Не считаем отправку состоявшейся: попробуем при следующем запуске.
            ALREADY_SENT.store(false, Ordering::SeqCst);
            eprintln!("[TitleWord] analytics network: {e}");
        }
    }
}