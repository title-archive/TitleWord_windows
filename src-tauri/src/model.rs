//! Модель для пасхалки: папка `src/assets/model`.
//!
//! Файлы вшиты в бинарник (`include_str!`), потому что рядом с exe в
//! установленной сборке каталога `src/assets` нет, а `fetch` из фронтенда может
//! не найти файл. Фронтенд сначала пробует скачать модель как обычный ассет —
//! так пользователь может подменить её без пересборки — и только потом
//! обращается сюда.

const MODEL_OBJ: &str = include_str!("../../src/assets/model/model.obj");
const MODEL_JSON: &str = include_str!("../../src/assets/model/model.json");

pub fn asset(kind: &str) -> Result<String, String> {
    match kind {
        "model.obj" | "obj" => Ok(MODEL_OBJ.to_string()),
        "model.json" | "json" => Ok(MODEL_JSON.to_string()),
        other => Err(format!("неизвестный файл модели: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::asset;

    #[test]
    fn model_contains_vertices_and_faces() {
        let obj = asset("model.obj").expect("model.obj вшит в бинарник");
        assert!(obj.lines().any(|line| line.starts_with("v ")), "нет вершин");
        assert!(obj.lines().any(|line| line.starts_with("vn ")), "нет нормалей");
        assert!(obj.lines().any(|line| line.starts_with("f ")), "нет граней");

        let faces = obj.lines().filter(|line| line.starts_with("f ")).count();
        assert!(faces > 100, "модель подозрительно простая: {faces} граней");

        // Все индексы граней должны попадать в список вершин: иначе модель
        // отрисуется дырявой или не отрисуется вовсе.
        let vertices = obj.lines().filter(|line| line.starts_with("v ")).count();
        for line in obj.lines().filter(|line| line.starts_with("f ")) {
            for token in line.split_whitespace().skip(1) {
                let index: usize = token
                    .split('/')
                    .next()
                    .and_then(|value| value.parse().ok())
                    .expect("индекс грани");
                assert!(index <= vertices, "индекс {index} вне диапазона {vertices}");
            }
        }
    }

    #[test]
    fn model_config_is_valid_json() {
        let text = asset("model.json").expect("model.json вшит в бинарник");
        let config: serde_json::Value = serde_json::from_str(&text).expect("json");
        assert_eq!(config["text"].as_str(), Some("Title Rust"));
        assert!(config["duration_seconds"].as_f64().unwrap_or(0.0) > 0.0);
    }

    #[test]
    fn unknown_asset_is_rejected() {
        assert!(asset("../../etc/passwd").is_err());
    }
}
