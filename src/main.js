"use strict";

// ============================================================
//  Title Word — офлайн-читалка архива
//  Данные приходят из Rust-команды get_news (сеть + локальный кэш).
// ============================================================

const tauriApi = window.__TAURI__;
const invoke = tauriApi?.core?.invoke ?? tauriApi?.tauri?.invoke ?? null;

const PAGE_SIZE = 20;
// Служебные записи, которые не должны попадать в ленту.
const HIDDEN_IDS = new Set([40]);

const DEFAULT_CONFIG = {
  theme: "light",
  font_size: 16,
  font_family: "system",
  custom_font: "",
  text_color: "#1A1A1A",
  favorites: [],
  analytics_enabled: false,
  holidays_enabled: true,
  traffic_saving: false,
  cache_images: true,
  splash_enabled: true,
  active_pack: "",
};

const THEME_TEXT = { light: "#1A1A1A", dark: "#F2F2F2" };

const FONT_FAMILIES = {
  system: '"Segoe UI", system-ui, -apple-system, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Courier New", monospace',
};

const CATEGORY_NAMES = {
  tech: "Технологии",
  mystic: "Мистика",
  history: "История",
  science: "Наука",
  space: "Космос",
  news: "Новости",
  politics: "Политика",
  culture: "Культура",
  sport: "Спорт",
  economy: "Экономика",
  other: "Прочее",
};

// Ассеты лежат внутри фронтенда, поэтому пути относительные:
// convertFileSrc() здесь не нужен и только ломал картинки.
const asset = (path) => `assets/${path}`;

const BASE_ICONS = {
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
  heartFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,
};

// Слот в main.json → иконка интерфейса. Пак может заменить любую из них.
const ICON_SLOTS = {
  search: "search",
  folder: "folder",
  heart: "heart",
  "heart-filled": "heartFilled",
  settings: "settings",
  back: "arrowLeft",
  copy: "copy",
  share: "share",
  chevron: "chevronRight",
  close: "x",
  refresh: "refresh",
};

// Рабочая копия: текстуры пака заменяют отдельные иконки, а сброс пака
// возвращает исходные svg из BASE_ICONS.
const ICONS = { ...BASE_ICONS };

// ---------- Состояние ----------
let config = { ...DEFAULT_CONFIG };
let allNews = [];
let filteredNews = [];
let currentPage = 0;
let searchQuery = "";
let dateFrom = "";
let dateTo = "";
let holiday = null;
let appVersion = "";
let stack = [{ screen: "main", params: {} }];

// Активный zip-пак с текстурами: манифест и уже прочитанные картинки.
let packList = [];
const packState = { active: null, textures: new Map() };
let fontsList = [];
let cacheStats = null;
// Семейство подключённого пользовательского шрифта (пусто — системный).
let customFontFamily = "";
let splashNode = null;
// Счётчик нажатий на версию: семь раз открывают 3D-сцену.
let versionClicks = 0;
let versionClickTimer = null;
let sceneHandle = null;

const newsState = {
  loading: true,
  source: "", // "network" | "cache" | "error"
  fetchedAt: null,
  warning: "",
  error: "",
};

// ============================================================
//  Утилиты
// ============================================================

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function iconButton(icon, title, onClick) {
  const button = el("button", "icon-btn");
  button.type = "button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = icon;
  button.addEventListener("click", onClick);
  return button;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function formatRelative(timestamp) {
  if (!timestamp) return "";
  const diff = Math.round((Date.now() - timestamp) / 1000);
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
}

function categoryLabel(category) {
  return CATEGORY_NAMES[category] || category || CATEGORY_NAMES.other;
}

function stripHtml(markup) {
  const doc = new DOMParser().parseFromString(String(markup || ""), "text/html");
  return doc.body.textContent || "";
}

function copyText(text) {
  const value = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).then(
      () => true,
      () => legacyCopy(value),
    );
  }
  return Promise.resolve(legacyCopy(value));
}

function legacyCopy(value) {
  try {
    const area = el("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

let toastTimer = null;
function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = el("div", "toast");
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.remove("toast-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add("toast-hidden"), 2600);
}

// ============================================================
//  Безопасный HTML
//  Поле `full` приходит из внешнего JSON и вставляется в WebView,
//  где доступен window.__TAURI__: без фильтра это готовый XSS.
// ============================================================

const ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "br", "hr", "p", "div", "span",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
  "pre", "code", "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "td", "th", "sub", "sup",
]);

const DROPPED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "form", "input"]);

const ALLOWED_STYLES = {
  color: (v) => /^#[0-9a-f]{3,8}$/i.test(v) || /^[a-z]+$/i.test(v),
  "background-color": (v) => /^#[0-9a-f]{3,8}$/i.test(v) || /^[a-z]+$/i.test(v),
  "font-weight": (v) => /^(normal|bold|bolder|lighter|[1-9]00)$/i.test(v),
  "font-style": (v) => /^(normal|italic|oblique)$/i.test(v),
  "text-align": (v) => /^(left|right|center|justify)$/i.test(v),
  "text-decoration": (v) => /^(none|underline|line-through)$/i.test(v),
};

function sanitizeStyle(value) {
  return String(value || "")
    .split(";")
    .map((rule) => {
      const index = rule.indexOf(":");
      if (index < 0) return "";
      const name = rule.slice(0, index).trim().toLowerCase();
      const raw = rule.slice(index + 1).trim();
      const check = ALLOWED_STYLES[name];
      return check && check(raw) ? `${name}: ${raw}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeHtml(markup) {
  const template = document.createElement("template");
  template.innerHTML = String(markup || "");

  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove(); // комментарии и прочие узлы не нужны
        continue;
      }

      const tag = child.tagName.toLowerCase();

      if (DROPPED_TAGS.has(tag)) {
        child.remove();
        continue;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        // Неизвестный тег разворачиваем: текст остаётся, разметка — нет.
        walk(child);
        const fragment = document.createDocumentFragment();
        while (child.firstChild) fragment.appendChild(child.firstChild);
        child.replaceWith(fragment);
        continue;
      }

      for (const attribute of Array.from(child.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        let keep = false;

        if (name === "href" && tag === "a") keep = /^(https?:\/\/|mailto:)/i.test(value);
        else if (name === "src" && tag === "img") keep = /^https?:\/\//i.test(value);
        else if (name === "alt" && tag === "img") keep = true;
        else if (name === "style" && tag === "span") keep = true;

        if (!keep) {
          child.removeAttribute(attribute.name);
          continue;
        }
        if (name === "style") child.setAttribute("style", sanitizeStyle(value));
      }

      if (tag === "a") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }

      walk(child);
    }
  };

  walk(template.content);
  return template.innerHTML;
}

// ============================================================
//  Загрузка данных и настроек
// ============================================================

function slugId(value) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || "";
}

function normalizeConfig(raw) {
  const base = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== "object") return base;

  const favorites = Array.isArray(raw.favorites)
    ? [...new Set(raw.favorites.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  const customFont = typeof raw.custom_font === "string" ? slugId(raw.custom_font) : "";
  const family = raw.font_family === "custom" || FONT_FAMILIES[raw.font_family]
    ? raw.font_family
    : base.font_family;

  return {
    theme: raw.theme === "dark" ? "dark" : "light",
    font_size: clampNumber(raw.font_size, 10, 32, base.font_size),
    // Без загруженного шрифта режим "custom" бессмысленен — падаем на системный.
    font_family: family === "custom" && !customFont ? "system" : family,
    custom_font: customFont,
    text_color: /^#[0-9a-f]{6}$/i.test(String(raw.text_color || "")) ? raw.text_color : base.text_color,
    favorites,
    analytics_enabled: raw.analytics_enabled === true,
    holidays_enabled: raw.holidays_enabled !== false,
    traffic_saving: raw.traffic_saving === true,
    cache_images: raw.cache_images !== false,
    splash_enabled: raw.splash_enabled !== false,
    active_pack: typeof raw.active_pack === "string" ? slugId(raw.active_pack) : "",
  };
}

function normalizeItem(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const numericId = Number(source.id);
  const id = Number.isFinite(numericId) ? Math.trunc(numericId) : 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(source.date || "").trim())
    ? String(source.date).trim()
    : "";

  return {
    key: `${id}#${index}`, // id в источнике повторяется, индекс делает ключ уникальным
    id,
    title: String(source.title ?? "").trim(),
    short: String(source.short ?? "").trim(),
    full: String(source.full ?? ""),
    date,
    image: typeof source.image === "string" ? source.image.trim() : "",
    images: Array.isArray(source.images) ? source.images.filter((s) => typeof s === "string" && s.trim()) : [],
    category: String(source.category || "other").trim().toLowerCase() || "other",
    tags: Array.isArray(source.tags) ? source.tags.filter((t) => typeof t === "string" && t.trim()) : [],
    author: String(source.author || "").trim(),
    source: String(source.source || "").trim(),
    pinned: source.pinned === true || id === 1,
  };
}

async function loadConfig() {
  try {
    config = normalizeConfig(await invoke("get_config"));
  } catch (e) {
    console.warn("[TitleWord] настройки не загружены:", e);
    config = { ...DEFAULT_CONFIG };
  }
}

async function loadNews({ force = false } = {}) {
  newsState.loading = true;
  newsState.error = "";
  try {
    const response = await invoke("get_news", {
      trafficSaving: config.traffic_saving,
      force,
    });
    const list = Array.isArray(response?.investigations) ? response.investigations : [];
    allNews = list
      .map(normalizeItem)
      .filter((item) => !HIDDEN_IDS.has(item.id) && (item.title || item.short));
    newsState.source = response?.source === "cache" ? "cache" : "network";
    newsState.fetchedAt = typeof response?.fetched_at === "number" ? response.fetched_at * 1000 : null;
    newsState.warning = response?.warning ? String(response.warning) : "";
  } catch (e) {
    allNews = [];
    newsState.source = "error";
    newsState.fetchedAt = null;
    newsState.error = String(e?.message || e);
  } finally {
    newsState.loading = false;
    currentPage = 0;
  }
}

async function loadMeta() {
  try {
    holiday = await invoke("current_holiday");
  } catch (e) {
    holiday = null;
  }
  try {
    appVersion = String(await invoke("app_version"));
  } catch (e) {
    appVersion = "";
  }
}

async function persistConfig() {
  try {
    await invoke("set_config", { cfg: config });
  } catch (e) {
    console.warn("[TitleWord] настройки не сохранены:", e);
    toast("Не удалось сохранить настройки");
  }
}

// ============================================================
//  Экран загрузки
// ============================================================

function splashStatus(text) {
  const node = document.getElementById("splashStatus");
  if (node && text) node.textContent = text;
}

function hideSplash() {
  splashNode = splashNode || document.getElementById("splash");
  if (!splashNode || splashNode.classList.contains("splash-hidden")) return;
  splashNode.classList.add("splash-hidden");
  setTimeout(() => splashNode?.remove(), 400);
}

// ============================================================
//  Шрифты и zip-паки с текстурами
// ============================================================

function fromBase64(text) {
  return window.TitleWordZip ? window.TitleWordZip.fromBase64(text) : new Uint8Array(0);
}

function toBase64(bytes) {
  return window.TitleWordZip ? window.TitleWordZip.toBase64(bytes) : "";
}

async function loadFonts() {
  try {
    fontsList = await invoke("list_fonts");
  } catch (e) {
    console.warn("[TitleWord] список шрифтов не получен:", e);
    fontsList = [];
  }
  return fontsList;
}

/**
 * Подключает выбранный пользовательский шрифт через FontFace.
 * Файл читает ядро, наружу он уходит в base64 — WebView не нужен доступ к диску.
 */
async function loadCustomFont() {
  customFontFamily = "";
  if (config.font_family !== "custom" || !config.custom_font) return;

  try {
    const payload = await invoke("read_font", { id: config.custom_font });
    const bytes = fromBase64(payload.data);
    if (!bytes.length) throw new Error("пустой файл шрифта");

    // Кавычки и точка с запятой в имени сломали бы значение CSS.
    const family = String(payload.info?.family || "Title Word Font").replace(/[";\\]/g, "").trim();
    const face = new FontFace(family, bytes.buffer);
    await face.load();
    document.fonts.add(face);
    customFontFamily = family;
    console.log("[TitleWord] шрифт подключён:", family);
  } catch (e) {
    console.warn("[TitleWord] пользовательский шрифт не подключён:", e);
    config.font_family = "system";
    config.custom_font = "";
    toast("Шрифт недоступен, используется системный");
  }
}

function fontStack() {
  if (config.font_family === "custom" && customFontFamily) {
    return `"${customFontFamily}", ${FONT_FAMILIES.system}`;
  }
  return FONT_FAMILIES[config.font_family] || FONT_FAMILIES.system;
}

function packManifest() {
  return packState.active?.manifest || null;
}

function packTextureUrl(rel) {
  return (rel && packState.textures.get(rel)) || "";
}

/**
 * Читает список паков и подготавливает активный.
 *
 * Все текстуры активного пака загружаются сразу: иконки подставляются
 * синхронно при отрисовке, когда ждать ответа ядра уже нельзя.
 */
async function loadPacks() {
  try {
    packList = await invoke("list_packs");
  } catch (e) {
    console.warn("[TitleWord] список паков не получен:", e);
    packList = [];
  }

  const active = config.active_pack
    ? packList.find((pack) => pack.id === config.active_pack)
    : null;

  if (!active) {
    if (config.active_pack) {
      // Пак удалили: возвращаемся к стандартным текстурам.
      config.active_pack = "";
      persistConfig();
    }
    packState.active = null;
    packState.textures.clear();
    Object.assign(ICONS, BASE_ICONS);
    applyPackTheme(null);
    return;
  }

  packState.active = active;
  packState.textures.clear();

  const references = [
    active.manifest.logo,
    active.manifest.placeholder,
    active.manifest.background,
    ...Object.values(active.manifest.icons || {}),
    ...Object.values(active.manifest.categories || {}),
    ...Object.values(active.manifest.holidays || {}).flatMap((textures) => Object.values(textures)),
  ].filter(Boolean);

  await Promise.all([...new Set(references)].map(async (rel) => {
    try {
      packState.textures.set(rel, await invoke("read_pack_image", { pack: active.id, rel }));
    } catch (e) {
      console.warn("[TitleWord] текстура не прочитана:", rel, e);
    }
  }));

  Object.assign(ICONS, BASE_ICONS);
  for (const [slot, key] of Object.entries(ICON_SLOTS)) {
    const url = packTextureUrl(active.manifest.icons?.[slot]);
    if (url) ICONS[key] = `<img class="pack-icon" src="${url}" alt="" />`;
  }

  applyPackTheme(active.manifest);
  console.log(`[TitleWord] пак «${active.name}»: ${packState.textures.size} текстур`);
}

/** Акцент и фон из пака живут в CSS-переменных, как и тема. */
function applyPackTheme(manifest) {
  const root = document.documentElement;

  if (!manifest) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--app-background");
    document.body.classList.remove("has-pack-background");
    return;
  }

  const accent = /^#[0-9a-f]{6}$/i.test(String(manifest.accent || "")) ? manifest.accent : "";
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-hover", shade(accent, -0.18));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
  }

  const background = packTextureUrl(manifest.background);
  if (background) {
    root.style.setProperty("--app-background", `url("${background}")`);
    document.body.classList.add("has-pack-background");
  } else {
    root.style.removeProperty("--app-background");
    document.body.classList.remove("has-pack-background");
  }
}

function shade(hex, amount) {
  const number = Number.parseInt(String(hex).slice(1), 16);
  const channel = (value) => {
    const shifted = amount < 0 ? value * (1 + amount) : value + (255 - value) * amount;
    return Math.max(0, Math.min(255, Math.round(shifted)));
  };

  const parts = [channel((number >> 16) & 255), channel((number >> 8) & 255), channel(number & 255)];
  return `#${parts.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function boot() {
  const splashStarted = Date.now();
  splashNode = document.getElementById("splash");
  render(); // скелетон под сплешем, пока идёт загрузка

  if (!invoke) {
    newsState.loading = false;
    newsState.source = "error";
    newsState.error = "Нет доступа к ядру приложения (страница открыта вне Tauri).";
    hideSplash();
    render();
    return;
  }

  splashStatus("Загружаем настройки…");
  await loadConfig();
  if (!config.splash_enabled) hideSplash();

  splashStatus("Подключаем шрифты и текстуры…");
  await Promise.all([loadFonts(), loadCustomFont(), loadPacks()]);
  applyTheme();

  splashStatus("Загружаем архив…");
  const news = (async () => {
    await Promise.all([loadNews(), loadMeta()]);
    applyTheme();
    render();
  })();

  // Медленная сеть не должна держать экран загрузки: интерфейс открывается
  // сразу, а список обновится сам, когда данные придут.
  await Promise.race([news, new Promise((resolve) => setTimeout(resolve, 1500))]);

  if (config.analytics_enabled) {
    invoke("track_visit", { enabled: true }).catch(() => {});
  }

  // Сплеш не должен мигать: показываем его хотя бы мгновение.
  setTimeout(hideSplash, Math.max(0, 450 - (Date.now() - splashStarted)));
}

// ============================================================
//  Тема и оформление
// ============================================================

function effectiveTextColor(theme) {
  const otherTheme = theme === "dark" ? "light" : "dark";
  const chosen = String(config.text_color || "").toLowerCase();
  // Цвет по умолчанию «другой» темы сделал бы текст нечитаемым — подменяем.
  return chosen === THEME_TEXT[otherTheme].toLowerCase() ? THEME_TEXT[theme] : config.text_color;
}

function applyTheme() {
  const theme = config.theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = theme;
  const root = document.documentElement;
  root.style.setProperty("--font-size", `${config.font_size}px`);
  root.style.setProperty("--text-color", effectiveTextColor(theme));
  root.style.setProperty("--font-family", fontStack());
}

// ============================================================
//  Навигация
// ============================================================

function currentScreen() {
  return stack[stack.length - 1];
}

function push(screen, params = {}) {
  stack.push({ screen, params });
  render();
  window.scrollTo(0, 0);
}

function back() {
  if (stack.length > 1) {
    stack.pop();
    render();
    window.scrollTo(0, 0);
  }
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  const { screen, params } = currentScreen();
  // Уход с экрана пасхалки должен остановить запрос кадров.
  if (screen !== "easterEgg") stopScene();
  const fragment = document.createDocumentFragment();

  switch (screen) {
    case "full": renderFullView(fragment, params); break;
    case "categories": renderCategories(fragment); break;
    case "categoryList": renderCategoryList(fragment, params); break;
    case "favorites": renderFavorites(fragment); break;
    case "settings": renderSettings(fragment); break;
    case "legal": renderLegalView(fragment, params); break;
    case "easterEgg": renderEasterEgg(fragment); break;
    default: renderMain(fragment); break;
  }

  app.replaceChildren(fragment);
}

function topbar(title) {
  const bar = el("div", "topbar");
  const backButton = el("button", "back-btn");
  backButton.type = "button";
  backButton.innerHTML = ICONS.arrowLeft;
  backButton.appendChild(document.createTextNode(" Назад"));
  backButton.addEventListener("click", back);
  bar.appendChild(backButton);
  bar.appendChild(el("div", "topbar-title", title));
  return bar;
}

// ============================================================
//  Главный экран
// ============================================================

function renderMain(root) {
  const wrapper = el("div", "top-wrapper");
  const header = el("div", "topbar-header");

  const logo = el("img", "main-logo");
  logo.alt = "Title word";
  logo.addEventListener("error", () => {
    // Логотипа в сборке нет — показываем текстовый вариант вместо пустого места.
    const fallback = el("div", "logo-text", "Title word");
    logo.replaceWith(fallback);
  });
  logo.src = packTextureUrl(packManifest()?.logo) || asset("logo.png");
  header.appendChild(logo);

  const actions = el("div", "header-actions");
  const refreshButton = iconButton(ICONS.refresh, "Обновить", () => refreshNews(refreshButton));
  if (newsState.loading) refreshButton.classList.add("spinning");
  actions.appendChild(refreshButton);
  actions.appendChild(iconButton(ICONS.folder, "Разделы", () => push("categories")));
  actions.appendChild(iconButton(ICONS.heart, "Избранное", () => push("favorites")));
  actions.appendChild(iconButton(ICONS.settings, "Настройки", () => push("settings")));
  header.appendChild(actions);
  wrapper.appendChild(header);

  wrapper.appendChild(buildStatusBar());

  const searchBar = el("div", "search-bar");
  searchBar.innerHTML = ICONS.search;
  const input = el("input");
  input.type = "search";
  input.placeholder = "Поиск по заголовкам, тексту, тегам…";
  input.value = searchQuery;
  input.setAttribute("aria-label", "Поиск");
  input.addEventListener("input", () => {
    searchQuery = input.value;
    currentPage = 0;
    updateNewsList(list, pagination);
  });
  searchBar.appendChild(input);
  wrapper.appendChild(searchBar);

  const dateFilter = el("div", "date-filter");
  dateFilter.innerHTML = `
    <span>С</span>
    <input type="date" id="df" value="${dateFrom}" aria-label="Дата с" />
    <span>по</span>
    <input type="date" id="dt" value="${dateTo}" aria-label="Дата по" />
    <button class="date-clear" id="dclear" type="button" title="Сбросить фильтр по датам">${ICONS.x}</button>
  `;
  wrapper.appendChild(dateFilter);
  root.appendChild(wrapper);

  const list = el("div", "news-list");
  root.appendChild(list);

  const pagination = el("div", "pagination");
  // Счётчик страниц обновляется до вставки разметки в документ, поэтому
  // подписывается явно, а не ищется через document.querySelector.
  pagination.innerHTML = `
    <button id="prevBtn" type="button">← Назад</button>
    <span id="pageInfo">— / —</span>
    <button id="nextBtn" type="button">Вперёд →</button>
  `;
  root.appendChild(pagination);

  dateFilter.querySelector("#df").addEventListener("change", (event) => {
    dateFrom = event.target.value;
    currentPage = 0;
    updateNewsList(list, pagination);
  });
  dateFilter.querySelector("#dt").addEventListener("change", (event) => {
    dateTo = event.target.value;
    currentPage = 0;
    updateNewsList(list, pagination);
  });
  dateFilter.querySelector("#dclear").addEventListener("click", () => {
    dateFrom = "";
    dateTo = "";
    dateFilter.querySelector("#df").value = "";
    dateFilter.querySelector("#dt").value = "";
    currentPage = 0;
    updateNewsList(list, pagination);
  });

  pagination.querySelector("#prevBtn").addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage -= 1;
      updateNewsList(list, pagination);
      window.scrollTo(0, 0);
    }
  });
  pagination.querySelector("#nextBtn").addEventListener("click", () => {
    if (currentPage < pageCount() - 1) {
      currentPage += 1;
      updateNewsList(list, pagination);
      window.scrollTo(0, 0);
    }
  });

  updateNewsList(list, pagination);
}

function buildStatusBar() {
  const bar = el("div", "status-bar");
  let visible = false;

  if (newsState.source === "cache") {
    visible = true;
    const badge = el("span", "offline-badge", "Офлайн");
    bar.appendChild(badge);
    const when = formatRelative(newsState.fetchedAt);
    bar.appendChild(el("span", "status-text", when ? `кэш обновлён ${when}` : "показаны сохранённые данные"));
    if (newsState.warning) bar.title = newsState.warning;
  }

  if (newsState.source === "error") {
    visible = true;
    bar.appendChild(el("span", "offline-badge error", "Ошибка"));
    bar.appendChild(el("span", "status-text", newsState.error));
  }

  if (visible) bar.classList.add("visible");
  return bar;
}

function renderLoadingCard() {
  const card = el("div", "empty");
  card.appendChild(el("div", "spinner"));
  card.appendChild(el("div", null, "Загружаем архив…"));
  return card;
}

function pageCount() {
  return Math.max(1, Math.ceil(filteredNews.length / PAGE_SIZE));
}

function matchesQuery(item, query) {
  if (item.title.toLowerCase().includes(query)) return true;
  if (item.short.toLowerCase().includes(query)) return true;
  if (item.author.toLowerCase().includes(query)) return true;
  if (item.category.includes(query)) return true;
  if (categoryLabel(item.category).toLowerCase().includes(query)) return true;
  if (item.tags.some((tag) => tag.toLowerCase().includes(query))) return true;
  return stripHtml(item.full).toLowerCase().includes(query);
}

function compareNews(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.date !== b.date) return (b.date || "").localeCompare(a.date || "");
  return b.id - a.id;
}

function visibleNews() {
  const query = searchQuery.trim().toLowerCase();
  const items = allNews.filter((item) => {
    if ((dateFrom || dateTo) && !item.date) return false;
    if (dateFrom && item.date < dateFrom) return false;
    if (dateTo && item.date > dateTo) return false;
    return !query || matchesQuery(item, query);
  });
  return items.sort(compareNews);
}

function updateNewsList(container, pagination) {
  if (!container) return;
  filteredNews = visibleNews();

  if (currentPage > pageCount() - 1) currentPage = pageCount() - 1;
  if (currentPage < 0) currentPage = 0;

  container.replaceChildren();

  if (newsState.loading && allNews.length === 0) {
    container.appendChild(renderLoadingCard());
    updatePagination(pagination);
    return;
  }

  if (filteredNews.length === 0) {
    const empty = el("div", "empty", newsState.source === "error"
      ? "Не удалось загрузить архив"
      : allNews.length === 0 ? "Архив пуст" : "Ничего не найдено");
    if (newsState.source === "error") {
      const retry = el("button", "action-btn primary", "Повторить");
      retry.type = "button";
      retry.addEventListener("click", () => refreshNews(retry));
      empty.appendChild(el("div", "empty-actions"));
      empty.querySelector(".empty-actions").appendChild(retry);
    }
    container.appendChild(empty);
    updatePagination(pagination);
    return;
  }

  const start = currentPage * PAGE_SIZE;
  const fragment = document.createDocumentFragment();
  filteredNews.slice(start, start + PAGE_SIZE).forEach((item) => fragment.appendChild(newsCard(item)));
  container.appendChild(fragment);
  updatePagination(pagination);
}

/**
 * Пересчитывает номер страницы и доступность кнопок.
 *
 * Элемент передаётся напрямую: `document.querySelector` не нашёл бы разметку
 * до её вставки в документ, и счётчик оставался бы исходным «1 / 1»,
 * пока пользователь не нажмёт кнопку перехода.
 */
function updatePagination(pagination) {
  const node = pagination || document.querySelector(".pagination");
  if (!node) return;

  const total = pageCount();
  const info = node.querySelector("#pageInfo");
  if (info) info.textContent = `${currentPage + 1} / ${total}`;

  const prev = node.querySelector("#prevBtn");
  const next = node.querySelector("#nextBtn");
  if (prev) prev.disabled = currentPage <= 0;
  if (next) next.disabled = currentPage >= total - 1;
}

function placeholderAsset() {
  return packTextureUrl(packManifest()?.placeholder) || asset("placeholder.png");
}

function imageSrc(value) {
  const raw = String(value || "").trim();
  if (!raw) return placeholderAsset();
  if (/^https?:\/\//i.test(raw)) return raw;
  // data-URL приходит из пака текстур, локальные пути — из архива.
  if (raw.startsWith("data:") || raw.startsWith("assets/")) return raw;
  return asset(`images/${raw.replace(/^\/+/, "")}`);
}

/**
 * Картинка из сети сохраняется в кэш ядра и показывается как data-URL:
 * без этого она пропадала бы без интернета.
 */
async function resolveImage(value) {
  const src = imageSrc(value);
  if (!/^https?:\/\//i.test(src)) return src;
  if (!config.cache_images) return src;

  try {
    return await invoke("get_cached_image", { url: src });
  } catch (e) {
    // Ни кэша, ни сети: пусть WebView попробует загрузить напрямую.
    return src;
  }
}

function setImageWithFallback(img, candidates) {
  const list = candidates.filter((value) => value != null);
  let index = 0;

  const next = async () => {
    if (index >= list.length) {
      img.onerror = null;
      // Снимаем src: с пустым src браузер не рисует «битую» иконку,
      // остаётся нейтральный блок размером с картинку.
      img.removeAttribute("src");
      img.classList.add("img-missing");
      return;
    }

    try {
      const src = await resolveImage(list[index++]);
      if (!src) return next();
      img.src = src;
    } catch (e) {
      next();
    }
  };

  img.addEventListener("error", () => { next(); });
  next();
}

function newsCard(item) {
  const card = el("article", "news-card" + (item.pinned ? " pinned" : ""));
  card.tabIndex = 0;
  card.setAttribute("role", "button");

  const thumb = el("img", "thumb");
  thumb.alt = "";
  thumb.loading = "lazy";
  setImageWithFallback(thumb, [imageSrc(item.image), asset("placeholder.png")]);
  card.appendChild(thumb);

  const body = el("div", "body");
  body.appendChild(el("h2", "title", item.title || "Без названия"));
  if (item.short) body.appendChild(el("p", "short", item.short));
  const meta = el("div", "date");
  const dateText = formatDate(item.date);
  meta.textContent = dateText ? `${dateText} · ${categoryLabel(item.category)}` : categoryLabel(item.category);
  body.appendChild(meta);
  card.appendChild(body);

  const favorite = el("button", "fav" + (isFavorite(item.id) ? " active" : ""));
  favorite.type = "button";
  favorite.innerHTML = isFavorite(item.id) ? ICONS.heartFilled : ICONS.heart;
  favorite.title = isFavorite(item.id) ? "Убрать из избранного" : "В избранное";
  favorite.addEventListener("click", async (event) => {
    event.stopPropagation();
    await toggleFavorite(item.id);
    const active = isFavorite(item.id);
    favorite.className = "fav" + (active ? " active" : "");
    favorite.innerHTML = active ? ICONS.heartFilled : ICONS.heart;
    favorite.title = active ? "Убрать из избранного" : "В избранное";
  });
  card.appendChild(favorite);

  const open = () => push("full", { key: item.key });
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  return card;
}

// ============================================================
//  Полная публикация
// ============================================================

function renderFullView(root, params) {
  const item = allNews.find((entry) => entry.key === params?.key)
    || allNews.find((entry) => entry.id === Number(params?.id));

  if (!item) {
    root.appendChild(topbar("Публикация"));
    root.appendChild(el("div", "empty", "Публикация не найдена"));
    return;
  }

  root.appendChild(topbar("Публикация"));

  const article = el("article", "full-article");
  article.appendChild(el("h1", null, item.title || "Без названия"));

  const meta = el("div", "article-meta");
  const dateText = formatDate(item.date);
  if (dateText) meta.appendChild(el("span", null, dateText));
  meta.appendChild(el("span", null, categoryLabel(item.category)));
  if (item.author) meta.appendChild(el("span", null, item.author));
  article.appendChild(meta);

  if (item.tags.length) {
    const tags = el("div", "tags");
    item.tags.forEach((tag) => tags.appendChild(el("span", "tag", tag)));
    article.appendChild(tags);
  }

  const gallerySources = item.images.length ? item.images : [];
  if (gallerySources.length) {
    const gallery = el("div", "gallery");
    gallerySources.forEach((source) => {
      const image = el("img");
      image.alt = item.title;
      image.loading = "lazy";
      setImageWithFallback(image, [imageSrc(source)]);
      image.addEventListener("click", () => openLightbox(image.src));
      gallery.appendChild(image);
    });
    article.appendChild(gallery);
  }

  const actions = el("div", "actions");

  const favoriteButton = el("button", "action-btn primary");
  favoriteButton.type = "button";
  const renderFavorite = () => {
    const active = isFavorite(item.id);
    favoriteButton.innerHTML = (active ? ICONS.heartFilled : ICONS.heart)
      + `<span>${active ? "В избранном" : "В избранное"}</span>`;
  };
  renderFavorite();
  favoriteButton.addEventListener("click", async () => {
    await toggleFavorite(item.id);
    renderFavorite();
  });
  actions.appendChild(favoriteButton);

  const copyButton = el("button", "action-btn");
  copyButton.type = "button";
  copyButton.innerHTML = ICONS.copy + "<span>Копировать</span>";
  copyButton.addEventListener("click", async () => {
    const text = `${item.title}\n\n${stripHtml(item.full || item.short).trim()}`.trim();
    toast((await copyText(text)) ? "Текст скопирован" : "Не удалось скопировать");
  });
  actions.appendChild(copyButton);

  const shareButton = el("button", "action-btn");
  shareButton.type = "button";
  shareButton.innerHTML = ICONS.share + "<span>Поделиться</span>";
  shareButton.addEventListener("click", async () => {
    const url = `https://title-word.vercel.app/?id=${encodeURIComponent(item.id)}`;
    toast((await copyText(url)) ? "Ссылка скопирована" : "Не удалось скопировать ссылку");
  });
  actions.appendChild(shareButton);

  article.appendChild(actions);

  const content = el("div", "content");
  content.innerHTML = item.full ? sanitizeHtml(item.full) : sanitizeHtml(item.short);
  // Внешние ссылки открываем копированием адреса: переход в системный браузер
  // требует отдельного плагина, а навигация внутри окна выкинула бы из приложения.
  content.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const href = link.getAttribute("href") || "";
      toast((await copyText(href)) ? `Ссылка скопирована: ${href}` : href);
    });
  });
  article.appendChild(content);

  root.appendChild(article);
}

function openLightbox(src) {
  const overlay = el("div", "lightbox");
  const image = el("img");
  image.src = src;
  image.alt = "";
  overlay.appendChild(image);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };

  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}

// ============================================================
//  Разделы
// ============================================================

function categoryIconCandidates(category) {
  const candidates = [];
  const manifest = packManifest();

  // Текстуры пака важнее встроенных: он для этого и загружается.
  if (manifest) {
    const holidayTextures = config.holidays_enabled && holiday ? manifest.holidays?.[holiday] : null;
    if (holidayTextures) {
      const url = packTextureUrl(holidayTextures[category]);
      if (url) candidates.push(url);
      const fallback = packTextureUrl(holidayTextures.default);
      if (fallback) candidates.push(fallback);
    }

    const url = packTextureUrl(manifest.categories?.[category]);
    if (url) candidates.push(url);
    const fallback = packTextureUrl(manifest.categories?.default);
    if (fallback) candidates.push(fallback);
  }

  if (config.holidays_enabled && holiday) {
    candidates.push(asset(`holidays/${holiday}/${category}.png`));
    candidates.push(asset(`holidays/${holiday}/default.png`));
  }
  candidates.push(asset(`categories/${category}.png`));
  candidates.push(asset("categories/default.png"));
  return candidates;
}

function renderCategories(root) {
  root.appendChild(topbar("Разделы"));

  const counts = new Map();
  allNews.forEach((item) => {
    const key = item.category || "other";
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  if (counts.size === 0) {
    root.appendChild(el("div", "empty", "Разделы пока недоступны"));
    return;
  }

  const grid = el("div", "categories-grid");
  [...counts.entries()]
    .sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0]), "ru"))
    .forEach(([category, count]) => {
      const card = el("button", "category-card");
      card.type = "button";

      const icon = el("img", "cat-icon");
      icon.alt = "";
      setImageWithFallback(icon, categoryIconCandidates(category));
      card.appendChild(icon);

      card.appendChild(el("span", "name", categoryLabel(category)));
      card.appendChild(el("span", "count", `${count} ${pluralNews(count)}`));
      card.addEventListener("click", () => push("categoryList", { category }));
      grid.appendChild(card);
    });

  root.appendChild(grid);
}

function pluralNews(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "новостей";
  if (mod10 === 1) return "новость";
  if (mod10 >= 2 && mod10 <= 4) return "новости";
  return "новостей";
}

function renderCategoryList(root, params) {
  const category = params?.category || "other";
  root.appendChild(topbar(categoryLabel(category)));

  const items = allNews.filter((item) => item.category === category).sort(compareNews);
  const list = el("div", "news-list");
  if (items.length === 0) {
    list.appendChild(el("div", "empty", "В этом разделе пока пусто"));
  } else {
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.appendChild(newsCard(item)));
    list.appendChild(fragment);
  }
  root.appendChild(list);
}

function renderFavorites(root) {
  root.appendChild(topbar("Избранное"));

  const items = allNews.filter((item) => isFavorite(item.id)).sort(compareNews);
  const list = el("div", "news-list");
  if (items.length === 0) {
    list.appendChild(el("div", "empty", "Пока ничего не добавлено: отметьте публикацию сердечком"));
  } else {
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.appendChild(newsCard(item)));
    list.appendChild(fragment);
  }
  root.appendChild(list);
}

// ============================================================
//  Настройки
// ============================================================

function settingRow(labelText, control) {
  const row = el("div", "setting-row");
  row.appendChild(el("label", null, labelText));
  row.appendChild(control);
  return row;
}

function renderSettings(root) {
  root.appendChild(topbar("Настройки"));

  // --- Оформление ---
  const appearance = el("section", "settings-section");
  appearance.appendChild(el("h3", null, "Оформление"));

  const themeSelect = el("select");
  themeSelect.id = "themeSel";
  [["light", "Светлая"], ["dark", "Тёмная"]].forEach(([value, label]) => {
    const option = el("option", null, label);
    option.value = value;
    themeSelect.appendChild(option);
  });
  themeSelect.value = config.theme;
  themeSelect.addEventListener("change", () => {
    const previous = config.theme;
    config.theme = themeSelect.value === "dark" ? "dark" : "light";
    // Если пользователь не выбирал свой цвет, переносим его на новую тему.
    if (String(config.text_color).toLowerCase() === THEME_TEXT[previous].toLowerCase()) {
      config.text_color = THEME_TEXT[config.theme];
      colorInput.value = config.text_color;
    }
    applyTheme();
    persistConfig();
  });
  appearance.appendChild(settingRow("Тема", themeSelect));

  const familySelect = el("select");
  familySelect.id = "familySel";
  [
    ["system", "Системный"],
    ["serif", "С засечками"],
    ["mono", "Моноширинный"],
  ].forEach(([value, label]) => {
    const option = el("option", null, label);
    option.value = value;
    familySelect.appendChild(option);
  });
  // Загруженные шрифты попадают в тот же список выбора.
  fontsList.forEach((font) => {
    const option = el("option", null, `${font.family} — свой`);
    option.value = `custom:${font.id}`;
    familySelect.appendChild(option);
  });
  if (config.font_family === "custom" && !fontsList.some((font) => font.id === config.custom_font)) {
    // Шрифт выбран, но файла нет: вариант нужен, чтобы выбор не потерялся молча.
    const option = el("option", null, "Свой шрифт (файл не найден)");
    option.value = `custom:${config.custom_font}`;
    familySelect.appendChild(option);
  }
  familySelect.value = config.font_family === "custom"
    ? `custom:${config.custom_font}`
    : config.font_family;
  familySelect.addEventListener("change", async () => {
    const value = familySelect.value;
    if (value.startsWith("custom:")) {
      config.font_family = "custom";
      config.custom_font = value.slice("custom:".length);
    } else {
      config.font_family = FONT_FAMILIES[value] ? value : "system";
      config.custom_font = "";
    }
    await persistConfig();
    await loadCustomFont();
    applyTheme();
  });
  appearance.appendChild(settingRow("Шрифт", familySelect));

  const sizeValue = el("span", "value", `${config.font_size}px`);
  const sizeRange = el("input");
  sizeRange.type = "range";
  sizeRange.id = "fsRange";
  sizeRange.min = "10";
  sizeRange.max = "32";
  sizeRange.step = "1";
  sizeRange.value = String(config.font_size);
  const sizeWrap = el("div", "range-wrap");
  sizeWrap.appendChild(sizeRange);
  sizeWrap.appendChild(sizeValue);
  sizeRange.addEventListener("input", () => {
    config.font_size = clampNumber(sizeRange.value, 10, 32, DEFAULT_CONFIG.font_size);
    sizeValue.textContent = `${config.font_size}px`;
    applyTheme();
  });
  sizeRange.addEventListener("change", persistConfig);
  appearance.appendChild(settingRow("Размер текста", sizeWrap));

  const colorInput = el("input");
  colorInput.type = "color";
  colorInput.id = "colorPick";
  colorInput.value = /^#[0-9a-f]{6}$/i.test(config.text_color) ? config.text_color : THEME_TEXT[config.theme];
  colorInput.addEventListener("input", () => {
    config.text_color = colorInput.value;
    applyTheme();
  });
  colorInput.addEventListener("change", persistConfig);
  appearance.appendChild(settingRow("Цвет текста", colorInput));

  root.appendChild(appearance);

  // --- Свои шрифты ---
  const fontsSection = el("section", "settings-section");
  fontsSection.appendChild(el("h3", null, "Свои шрифты"));
  fontsSection.appendChild(el("p", "settings-hint",
    "Поддерживаются файлы .ttf, .otf, .woff и .woff2. Они лежат в папке данных приложения и подключаются при каждом запуске; повторная загрузка файла с тем же именем заменяет шрифт."));

  const fontList = el("div", "item-list");
  fontsSection.appendChild(fontList);
  renderFontList(fontList);

  const fontActions = el("div", "item-actions");
  const fontInput = el("input");
  fontInput.type = "file";
  fontInput.accept = ".ttf,.otf,.woff,.woff2";
  fontInput.style.display = "none";
  fontInput.addEventListener("change", async () => {
    const file = fontInput.files?.[0];
    fontInput.value = "";
    if (file) await installFontFile(file);
  });
  const addFontButton = el("button", "action-btn primary", "Загрузить шрифт");
  addFontButton.type = "button";
  addFontButton.addEventListener("click", () => fontInput.click());
  fontActions.appendChild(addFontButton);
  fontActions.appendChild(fontInput);
  fontsSection.appendChild(fontActions);
  root.appendChild(fontsSection);

  // --- Свои текстуры и иконки ---
  const packsSection = el("section", "settings-section");
  packsSection.appendChild(el("h3", null, "Свои текстуры и иконки"));
  packsSection.appendChild(el("p", "settings-hint",
    "Zip-архив с файлом main.json в корне: он описывает, какие png заменяют иконки интерфейса, текстуры разделов и праздничные картинки. Остальные png можно раскладывать по любым папкам внутри архива."));

  const packListBox = el("div", "item-list");
  packsSection.appendChild(packListBox);
  renderPackList(packListBox);

  const packActions = el("div", "item-actions");
  const packInput = el("input");
  packInput.type = "file";
  packInput.accept = ".zip,application/zip";
  packInput.style.display = "none";
  packInput.addEventListener("change", async () => {
    const file = packInput.files?.[0];
    packInput.value = "";
    if (file) await installPackFile(file);
  });
  const addPackButton = el("button", "action-btn primary", "Загрузить zip-пак");
  addPackButton.type = "button";
  addPackButton.addEventListener("click", () => packInput.click());
  packActions.appendChild(addPackButton);
  packActions.appendChild(packInput);

  const resetPackButton = el("button", "action-btn", "Вернуть стандартные текстуры");
  resetPackButton.type = "button";
  resetPackButton.disabled = !config.active_pack;
  resetPackButton.addEventListener("click", async () => {
    config.active_pack = "";
    await persistConfig();
    await loadPacks();
    applyTheme();
    render();
    toast("Используются стандартные текстуры");
  });
  packActions.appendChild(resetPackButton);
  packsSection.appendChild(packActions);

  const format = el("details");
  format.appendChild(el("summary", null, "Формат main.json"));
  format.appendChild(el("pre", null, `{
  "name": "Ночной пак",
  "version": "1.0.0",
  "description": "Тёмные текстуры",
  "accent": "#7C3AED",
  "logo": "images/logo.png",
  "placeholder": "images/placeholder.png",
  "background": "backgrounds/main.png",
  "icons": { "search": "icons/search.png", "heart": "icons/heart.png" },
  "categories": { "tech": "categories/tech.png", "default": "categories/default.png" },
  "holidays": { "halloween": { "tech": "holidays/halloween/tech.png" } }
}`));
  format.appendChild(el("p", "settings-hint",
    "Иконки интерфейса: search, folder, heart, heart-filled, settings, back, copy, share, chevron, close, refresh. Ссылки на несуществующие файлы просто игнорируются."));
  packsSection.appendChild(format);
  root.appendChild(packsSection);

  // --- Данные и кэш ---
  const dataSection = el("section", "settings-section");
  dataSection.appendChild(el("h3", null, "Данные и кэш"));

  const pathValue = el("span", "value mono-path", cacheStats?.root || "…");
  dataSection.appendChild(settingRow("Папка данных", pathValue));

  const statsValue = el("span", "value", statsText(cacheStats));
  dataSection.appendChild(settingRow("Занято", statsValue));

  // Размеры меняются от действий пользователя — обновляем их после ответа ядра.
  invoke("cache_stats").then((stats) => {
    cacheStats = stats;
    if (pathValue.isConnected) pathValue.textContent = stats.root;
    if (statsValue.isConnected) statsValue.textContent = statsText(stats);
  }).catch(() => {});

  const imagesInput = checkbox(config.cache_images, (checked) => {
    config.cache_images = checked;
    persistConfig();
  });
  dataSection.appendChild(settingRow("Сохранять картинки в кэш", imagesInput));

  const trafficInput = checkbox(config.traffic_saving, (checked) => {
    config.traffic_saving = checked;
    persistConfig();
  });
  dataSection.appendChild(settingRow("Экономить трафик (кэш 10 минут)", trafficInput));

  const holidaysInput = checkbox(config.holidays_enabled, (checked) => {
    config.holidays_enabled = checked;
    persistConfig();
    render();
  });
  dataSection.appendChild(settingRow("Праздничные иконки разделов", holidaysInput));

  const splashInput = checkbox(config.splash_enabled, (checked) => {
    config.splash_enabled = checked;
    persistConfig();
  });
  dataSection.appendChild(settingRow("Показывать экран загрузки", splashInput));

  const cacheActions = el("div", "item-actions");
  [
    ["images", "Очистить кэш картинок", "Удалить сохранённые картинки публикаций?"],
    ["data", "Очистить кэш данных", "Удалить сохранённый список публикаций?"],
    ["all", "Очистить всё", "Удалить кэш данных, картинки, загруженные шрифты и паки? Настройки и избранное останутся."],
  ].forEach(([scope, label, question]) => {
    const button = el("button", "action-btn" + (scope === "all" ? " danger" : ""), label);
    button.type = "button";
    button.addEventListener("click", async () => {
      if (!(await confirmDialog(question, { confirmLabel: "Очистить" }))) return;

      const before = totalBytes(cacheStats);
      try {
        cacheStats = await invoke("clear_cache", { scope });
        if (scope === "all") {
          await Promise.all([loadFonts(), loadCustomFont(), loadPacks()]);
          applyTheme();
        }
        const freed = Math.max(0, before - totalBytes(cacheStats));
        render();
        toast(freed > 0 ? `Очищено: ${humanBytes(freed)}` : "Кэш уже пуст");
      } catch (e) {
        toast("Не удалось очистить: " + errorText(e));
      }
    });
    cacheActions.appendChild(button);
  });
  dataSection.appendChild(cacheActions);
  root.appendChild(dataSection);

  // --- Приватность ---
  const privacy = el("section", "settings-section");
  privacy.appendChild(el("h3", null, "Приватность"));

  const analyticsInput = checkbox(config.analytics_enabled, (checked) => {
    config.analytics_enabled = checked;
    persistConfig();
    if (checked) invoke("track_visit", { enabled: true }).catch(() => {});
  });
  privacy.appendChild(settingRow("Отправка анонимной статистики", analyticsInput));
  privacy.appendChild(el("p", "settings-hint",
    "Статистика отправляется один раз за запуск и только если включена: версия приложения, ОС, архитектура, режим отладки. Имя устройства, IP и содержимое файлов не передаются."));
  root.appendChild(privacy);

  // --- О приложении ---
  const about = el("section", "settings-section");
  about.appendChild(el("h3", null, "О приложении"));

  const versionRow = el("div", "setting-row");
  versionRow.appendChild(el("label", null, "Версия"));
  const versionValue = el("span", "value", appVersion || "—");
  versionValue.style.cursor = "pointer";
  versionValue.title = "Нажмите 7 раз";
  versionValue.addEventListener("click", registerVersionClick);
  versionRow.appendChild(versionValue);
  about.appendChild(versionRow);

  about.appendChild(settingRow("Публикаций в архиве", el("span", "value", String(allNews.length))));

  const sourceText = newsState.source === "cache"
    ? `кэш (${formatRelative(newsState.fetchedAt) || "без даты"})`
    : newsState.source === "network" ? "сеть" : "нет данных";
  about.appendChild(settingRow("Источник данных", el("span", "value", sourceText)));

  const legalRow = el("button", "setting-row clickable");
  legalRow.type = "button";
  legalRow.appendChild(el("label", null, "Правовая информация"));
  const chevron = el("span", "value");
  chevron.innerHTML = ICONS.chevronRight;
  legalRow.appendChild(chevron);
  legalRow.addEventListener("click", () => push("legal", { tab: "about" }));
  about.appendChild(legalRow);

  root.appendChild(about);

  // --- Сброс ---
  const reset = el("section", "settings-section");
  reset.appendChild(el("h3", null, "Сброс"));
  reset.appendChild(el("p", "settings-hint",
    "Вернёт тему, шрифт, цвет текста, текстуры и настройки кэша к значениям по умолчанию. Избранное и загруженные файлы останутся на месте."));

  const resetActions = el("div", "item-actions");
  const resetButton = el("button", "action-btn danger", "Сбросить настройки");
  resetButton.type = "button";
  resetButton.addEventListener("click", async () => {
    if (!(await confirmDialog("Сбросить все настройки к значениям по умолчанию?", { confirmLabel: "Сбросить" }))) return;
    try {
      config = normalizeConfig(await invoke("reset_config"));
      await Promise.all([loadCustomFont(), loadPacks()]);
      applyTheme();
      render();
      toast("Настройки сброшены");
    } catch (e) {
      toast("Не удалось сбросить: " + errorText(e));
    }
  });
  resetActions.appendChild(resetButton);
  reset.appendChild(resetActions);
  root.appendChild(reset);
}

function checkbox(checked, onChange) {
  const input = el("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

// ============================================================
//  Общие помощники настроек
// ============================================================

function errorText(error) {
  if (!error) return "неизвестная ошибка";
  if (typeof error === "string") return error;
  return String(error.message || error);
}

function humanBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

function totalBytes(stats) {
  if (!stats) return 0;
  return ["data", "images", "packs", "fonts"]
    .map((key) => stats[key]?.bytes || 0)
    .reduce((sum, value) => sum + value, 0);
}

function statsText(stats) {
  if (!stats) return "…";
  const cache = (stats.data?.bytes || 0) + (stats.images?.bytes || 0);
  return `кэш ${humanBytes(cache)} · паки ${humanBytes(stats.packs?.bytes || 0)} · шрифты ${humanBytes(stats.fonts?.bytes || 0)}`;
}

/** Перерисовывает экран настроек, сохраняя позицию прокрутки. */
function rerenderSettings() {
  const scroll = window.scrollY;
  render();
  window.scrollTo(0, scroll);
}

/** Подтверждение вместо window.confirm: он не везде доступен в WebView. */
function confirmDialog(message, { confirmLabel = "Да", cancelLabel = "Отмена" } = {}) {
  return new Promise((resolve) => {
    const overlay = el("div", "modal");
    const box = el("div", "modal-box");
    box.appendChild(el("p", "modal-text", message));

    const actions = el("div", "modal-actions");
    const cancel = el("button", "action-btn", cancelLabel);
    cancel.type = "button";
    const confirm = el("button", "action-btn danger", confirmLabel);
    confirm.type = "button";

    const close = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(false);
      }
    };

    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);

    actions.appendChild(cancel);
    actions.appendChild(confirm);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    confirm.focus();
  });
}

// ============================================================
//  Свои шрифты
// ============================================================

function renderFontList(container) {
  container.replaceChildren();

  if (!fontsList.length) {
    container.appendChild(el("p", "item-empty", "Загруженных шрифтов нет."));
    return;
  }

  fontsList.forEach((font) => {
    const active = config.font_family === "custom" && config.custom_font === font.id;
    const row = el("div", "item-row" + (active ? " active" : ""));

    const main = el("div", "item-main");
    main.appendChild(el("span", "item-name", font.family));
    main.appendChild(el("span", "item-meta",
      `${font.file} · ${String(font.format || "").toUpperCase()} · ${humanBytes(font.bytes)}${active ? " · активен" : ""}`));
    row.appendChild(main);

    if (!active) {
      const apply = el("button", "action-btn", "Применить");
      apply.type = "button";
      apply.addEventListener("click", async () => {
        config.font_family = "custom";
        config.custom_font = font.id;
        await persistConfig();
        await loadCustomFont();
        applyTheme();
        rerenderSettings();
      });
      row.appendChild(apply);
    }

    const remove = el("button", "action-btn danger", "Удалить");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog(`Удалить шрифт «${font.family}»?`))) return;
      try {
        await invoke("delete_font", { id: font.id });
        if (config.custom_font === font.id) {
          config.font_family = "system";
          config.custom_font = "";
          await persistConfig();
          await loadCustomFont();
          applyTheme();
        }
        await loadFonts();
        rerenderSettings();
        toast("Шрифт удалён");
      } catch (e) {
        toast("Не удалось удалить шрифт: " + errorText(e));
      }
    });
    row.appendChild(remove);
    container.appendChild(row);
  });
}

async function installFontFile(file) {
  if (!window.TitleWordZip) {
    toast("Не удалось прочитать файл: модуль кодирования не загрузился");
    return;
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = await invoke("install_font", { name: file.name, data: toBase64(bytes) });
    await loadFonts();

    // Новый шрифт сразу становится активным: иначе непонятно, что он загрузился.
    config.font_family = "custom";
    config.custom_font = info.id;
    await persistConfig();
    await loadCustomFont();
    applyTheme();
    rerenderSettings();
    toast(`Шрифт «${info.family}» подключён`);
  } catch (e) {
    toast("Шрифт не загружен: " + errorText(e));
  }
}

// ============================================================
//  Свои текстуры и иконки (zip-паки)
// ============================================================

function textureCount(manifest) {
  const holidays = Object.values(manifest.holidays || {})
    .reduce((sum, textures) => sum + Object.keys(textures).length, 0);

  return Object.keys(manifest.icons || {}).length
    + Object.keys(manifest.categories || {}).length
    + holidays
    + [manifest.logo, manifest.placeholder, manifest.background].filter(Boolean).length;
}

function renderPackList(container) {
  container.replaceChildren();

  if (!packList.length) {
    container.appendChild(el("p", "item-empty", "Паков пока нет — используются встроенные текстуры."));
    return;
  }

  packList.forEach((pack) => {
    const active = config.active_pack === pack.id;
    const row = el("div", "item-row" + (active ? " active" : ""));

    const main = el("div", "item-main");
    main.appendChild(el("span", "item-name", pack.name));
    const parts = [];
    if (pack.manifest.version) parts.push(`v${pack.manifest.version}`);
    parts.push(`текстур: ${textureCount(pack.manifest)}`);
    parts.push(humanBytes(pack.bytes));
    if (active) parts.push("активен");
    main.appendChild(el("span", "item-meta", parts.join(" · ")));
    if (pack.manifest.description) {
      main.appendChild(el("span", "item-meta", pack.manifest.description));
    }
    row.appendChild(main);

    if (!active) {
      const apply = el("button", "action-btn", "Применить");
      apply.type = "button";
      apply.addEventListener("click", async () => {
        config.active_pack = pack.id;
        await persistConfig();
        await loadPacks();
        applyTheme();
        render();
        toast(`Пак «${pack.name}» применён`);
      });
      row.appendChild(apply);
    }

    const remove = el("button", "action-btn danger", "Удалить");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!(await confirmDialog(`Удалить пак «${pack.name}»?`))) return;
      try {
        await invoke("delete_pack", { id: pack.id });
        if (config.active_pack === pack.id) {
          config.active_pack = "";
          await persistConfig();
        }
        await loadPacks();
        applyTheme();
        render();
        toast("Пак удалён");
      } catch (e) {
        toast("Не удалось удалить пак: " + errorText(e));
      }
    });
    row.appendChild(remove);
    container.appendChild(row);
  });
}

async function installPackFile(file) {
  if (!window.TitleWordZip) {
    toast("Не удалось прочитать архив: модуль распаковки не загрузился");
    return;
  }

  toast(`Разбираем архив ${file.name}…`);
  try {
    const files = await window.TitleWordZip.readArchive(await file.arrayBuffer());
    const pack = await invoke("install_pack", { source: file.name, files });

    config.active_pack = pack.id;
    await persistConfig();
    await loadPacks();
    applyTheme();
    render();

    const skipped = pack.skipped ? `, пропущено файлов: ${pack.skipped}` : "";
    toast(`Пак «${pack.name}» подключён: текстур ${textureCount(pack.manifest)}${skipped}`);
  } catch (e) {
    toast("Пак не установлен: " + errorText(e));
  }
}

// ============================================================
//  Пасхалка: 3D-модель из src/assets/model
// ============================================================

/** Семь нажатий на версию приложения открывают 3D-сцену. */
function registerVersionClick() {
  versionClicks += 1;
  clearTimeout(versionClickTimer);
  versionClickTimer = setTimeout(() => { versionClicks = 0; }, 2000);

  if (versionClicks >= 7) {
    versionClicks = 0;
    push("easterEgg");
    return;
  }

  if (versionClicks >= 4) toast(`Ещё ${7 - versionClicks}…`);
}

function stopScene() {
  if (!sceneHandle) return;
  sceneHandle.stop();
  sceneHandle = null;
}

function renderEasterEgg(root) {
  root.appendChild(topbar("Title eggs"));

  const stage = el("div", "egg-stage");
  const canvas = el("canvas", "egg-canvas");
  stage.appendChild(canvas);

  const status = el("div", "egg-status", "Загружаем…");
  stage.appendChild(status);

  const title = el("h1", "egg-title");
  stage.appendChild(title);

  const close = iconButton(ICONS.close, "Закрыть", () => {
    stopScene();
    back();
  });
  close.classList.add("egg-close");
  stage.appendChild(close);

  root.appendChild(stage);
  root.appendChild(el("p", "egg-hint", "спасибо"));

  // Разметка собрана синхронно, поэтому сцена стартует отдельно.
  startEasterEgg(canvas, status, title);
}

async function startEasterEgg(canvas, status, title) {
  if (!window.TitleWordViewer) {
    status.textContent = "Модуль 3D-просмотра не загрузился";
    return;
  }

  try {
    const [options, source] = await Promise.all([loadModelConfig(), loadModelAsset("model.obj", "model.obj")]);
    const mesh = window.TitleWordViewer.parseObj(source, options.scale);

    status.remove();
    sceneHandle = window.TitleWordViewer.createScene(canvas, mesh, {
      duration: options.duration,
      turns: options.turns,
      colorA: rgbToHex(options.color),
      colorB: rgbToHex(options.colorAlt),
      onFinish: () => {
        title.textContent = options.text;
        title.classList.add("visible");
      },
    });
    sceneHandle.start();
  } catch (e) {
    status.textContent = "Не удалось: " + errorText(e);
  }
}

/**
 * Модель читается как обычный ассет (её можно заменить в папке без пересборки),
 * а если файла рядом нет — берётся копия, вшитая в бинарник.
 */
async function loadModelAsset(name, kind) {
  try {
    const response = await fetch(asset(`model/${name}`));
    if (response.ok) {
      const text = await response.text();
      if (text.trim()) return text;
    }
  } catch (e) {
    // Файл недоступен — берём вшитую копию.
  }

  return await invoke("embedded_model", { kind });
}

function numberOr(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function loadModelConfig() {
  const fallback = {
    text: "Title Rust",
    duration: 5,
    scale: 1,
    turns: 1.25,
    color: [0.78, 0.36, 0.18],
    colorAlt: [0.28, 0.22, 0.2],
  };

  try {
    const parsed = JSON.parse(await loadModelAsset("model.json", "model.json"));
    return {
      text: typeof parsed.text === "string" && parsed.text.trim()
        ? parsed.text.trim().slice(0, 40)
        : fallback.text,
      duration: numberOr(parsed.duration_seconds, fallback.duration, 0.5, 60),
      scale: numberOr(parsed.scale, fallback.scale, 0.05, 10),
      turns: numberOr(parsed.spin_turns, fallback.turns, 0, 20),
      color: parsed.color || fallback.color,
      colorAlt: parsed.color_alt || fallback.colorAlt,
    };
  } catch (e) {
    console.warn("[TitleWord] model.json не прочитан, беру значения по умолчанию:", e);
    return fallback;
  }
}

/** Цвет из model.json: и «#RRGGBB», и массив долей от 0 до 1. */
function rgbToHex(value) {
  if (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())) {
    const text = value.trim();
    return text.startsWith("#") ? text : `#${text}`;
  }

  if (Array.isArray(value) && value.length >= 3) {
    const parts = value.slice(0, 3).map((channel) => {
      const num = Math.max(0, Math.min(1, Number(channel) || 0));
      return Math.round(num * 255).toString(16).padStart(2, "0");
    });
    return `#${parts.join("")}`;
  }

  return "";
}

// ============================================================
//  Правовая информация
// ============================================================

const LEGAL_TABS = [
  { id: "about", file: "about.txt", label: "О проекте" },
  { id: "privacy", file: "privacy.txt", label: "Политика" },
  { id: "terms", file: "agreement.txt", label: "Соглашение" },
];

function renderLegalView(root, params) {
  const activeTab = LEGAL_TABS.find((tab) => tab.id === params?.tab) || LEGAL_TABS[0];
  root.appendChild(topbar("Правовая информация"));

  const tabs = el("div", "legal-tabs");
  LEGAL_TABS.forEach((tab) => {
    const button = el("button", "legal-tab" + (tab.id === activeTab.id ? " active" : ""));
    button.type = "button";
    button.textContent = tab.label;
    button.addEventListener("click", () => {
      stack[stack.length - 1] = { screen: "legal", params: { tab: tab.id } };
      render();
    });
    tabs.appendChild(button);
  });
  root.appendChild(tabs);

  const body = el("div", "legal-body", "Загрузка…");
  root.appendChild(body);

  invoke("read_text_asset", { name: activeTab.file })
    .then((text) => {
      body.textContent = text || "Документ пуст.";
    })
    .catch((error) => {
      body.textContent = `Не удалось открыть документ.\n${error}`;
    });
}

// ============================================================
//  Действия
// ============================================================

function isFavorite(id) {
  return id > 0 && config.favorites.includes(id);
}

async function toggleFavorite(id) {
  if (!(id > 0)) return;
  const index = config.favorites.indexOf(id);
  if (index >= 0) config.favorites.splice(index, 1);
  else config.favorites.push(id);
  await persistConfig();
}

async function refreshNews(button) {
  if (newsState.loading) return;
  button?.classList.add("spinning");
  const previousScreen = currentScreen();
  await loadNews({ force: true });
  if (previousScreen.screen === "main") render();

  if (newsState.source === "error") toast("Не удалось обновить: " + newsState.error);
  else if (newsState.source === "cache") toast("Обновлено из кэша: сеть недоступна");
  else toast(`Обновлено: ${allNews.length} публикаций`);

  button?.classList.remove("spinning");
}

// ============================================================
//  Старт
// ============================================================

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  // Открытое подтверждение и 3D-сцена обрабатывают Esc сами.
  if (document.querySelector(".modal")) return;
  if (currentScreen().screen === "easterEgg") {
    stopScene();
    back();
    return;
  }
  if (!document.querySelector(".lightbox")) back();
});

boot();