use chrono::{Datelike, Local};

/// Название праздника совпадает с именем папки в `src/assets/holidays`.
pub fn current_holiday() -> Option<&'static str> {
    let today = Local::now().date_naive();
    holiday_for(today.month(), today.day())
}

/// Отдельная чистая функция: её можно проверить тестами без привязки к «сегодня».
pub fn holiday_for(month: u32, day: u32) -> Option<&'static str> {
    match (month, day) {
        (10, _) => Some("halloween"),
        (12, d) if d >= 5 => Some("newyear"),
        (1, d) if d <= 15 => Some("newyear"),
        (3, 8) => Some("march8"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::holiday_for;

    #[test]
    fn halloween_covers_october() {
        assert_eq!(holiday_for(10, 1), Some("halloween"));
        assert_eq!(holiday_for(10, 31), Some("halloween"));
    }

    #[test]
    fn newyear_spans_year_boundary() {
        assert_eq!(holiday_for(12, 5), Some("newyear"));
        assert_eq!(holiday_for(12, 4), None);
        assert_eq!(holiday_for(1, 15), Some("newyear"));
        assert_eq!(holiday_for(1, 16), None);
    }

    #[test]
    fn march8_is_single_day() {
        assert_eq!(holiday_for(3, 8), Some("march8"));
        assert_eq!(holiday_for(3, 9), None);
    }

    #[test]
    fn ordinary_day_has_no_holiday() {
        assert_eq!(holiday_for(6, 15), None);
    }
}