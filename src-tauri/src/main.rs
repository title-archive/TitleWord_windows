// Windows: без отдельного окна консоли в релизной сборке.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Вся логика (команды, плагины, обработчики) живёт в библиотеке,
    // чтобы не дублировать код между main.rs и lib.rs.
    title_word_lib::run()
}