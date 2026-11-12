"use strict";

// ============================================================
//  Zip-архивы для паков с текстурами и шрифтов
//
//  Архив распаковывается прямо в WebView: браузерный движок умеет
//  `DecompressionStream("deflate-raw")`, поэтому внешние библиотеки не нужны.
//  Разобранные файлы уходят в ядро, где пути и содержимое проверяются ещё раз.
// ============================================================

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

// Служебный мусор архиваторов: он не относится к паку.
const IGNORED_PREFIXES = ["__MACOSX/", ".DS_Store", "Thumbs.db"];

function findEndRecord(view) {
  const length = view.byteLength;
  const limit = Math.max(0, length - 66000); // комментарий архива бывает длинным

  for (let offset = length - 22; offset >= limit; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END) return offset;
  }
  return -1;
}

/**
 * Имена в архивах Windows записаны не в UTF-8, если не выставлен флаг.
 * UTF-8 пробуем первым (так пишет большинство архиваторов), затем OEM-кодировку.
 */
function decodeName(bytes, flags) {
  const utf8Flag = (flags & 0x800) !== 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    if (utf8Flag) throw new Error("имя файла в архиве не читается как UTF-8");
  }

  for (const label of ["ibm866", "windows-1251"]) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch (e) {
      // Кодировка недоступна — пробуем следующую.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("эта сборка WebView не умеет распаковывать deflate (нужен Edge WebView2 103+)");
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000; // по частям: apply() не переживает очень длинные строки
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(String(text || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Читает zip и возвращает список файлов `{ path, data }` (data — base64).
 * Читается оглавление в конце файла: только в нём размеры записи всегда верны.
 */
async function readArchive(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const end = findEndRecord(view);
  if (end < 0) {
    throw new Error("файл не похож на zip-архив");
  }

  const count = view.getUint16(end + 10, true);
  if (count === 0) throw new Error("архив пуст");
  if (count > MAX_ENTRIES) throw new Error(`в архиве слишком много файлов (${count})`);

  let offset = view.getUint32(end + 16, true);
  const files = [];
  let total = 0;

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL) {
      throw new Error("архив повреждён: оглавление обрывается");
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeName(nameBytes, flags);

    offset += 46 + nameLength + extraLength + commentLength;

    if (!name || name.endsWith("/")) continue; // запись каталога
    if (IGNORED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    if (flags & 0x1) throw new Error(`${name}: архив защищён паролем, снимите его`);

    if (size === 0xffffffff || compressed === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("архивы больше 4 ГБ (zip64) не поддерживаются");
    }
    if (size > MAX_ENTRY_BYTES) {
      throw new Error(`${name}: файл больше ${MAX_ENTRY_BYTES / 1024 / 1024} МБ`);
    }

    // У локального заголовка свои длины имени и дополнительных полей.
    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== ZIP_LOCAL) {
      throw new Error(`${name}: повреждённый заголовок файла`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressed);

    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      data = await inflateRaw(raw);
    } else {
      throw new Error(`${name}: метод сжатия ${method} не поддерживается`);
    }

    if (data.length > MAX_ENTRY_BYTES) {
      throw new Error(`${name}: после распаковки файл слишком большой`);
    }

    total += data.length;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error("после распаковки архив больше 32 МБ");
    }

    files.push({ path: name.replace(/\\/g, "/"), data: toBase64(data) });
  }

  return files;
}

window.TitleWordZip = { readArchive, toBase64, fromBase64 };
