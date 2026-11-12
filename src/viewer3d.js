"use strict";

// ============================================================
//  Минимальный 3D-просмотрщик OBJ для пасхалки
//
//  Внешние библиотеки не подключаются: CSP приложения запрещает сторонние
//  скрипты, а модель лежит рядом с приложением (`src/assets/model`).
//  Модель рисуется на WebGL, воспроизводится один раз и затем показывается
//  надпись из `model.json`.
// ============================================================

const DEG = Math.PI / 180;

// ---------- Разбор OBJ ----------

function resolveIndex(value, count) {
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index)) return -1;
  // В OBJ индексы бывают отрицательными (счёт с конца списка).
  return index < 0 ? count + index : index - 1;
}

/**
 * Возвращает плоские массивы вершин и нормалей, приведённые к единичному
 * размеру: так модель не зависит от масштаба исходного файла.
 */
function parseObj(text, scale = 1) {
  const vertices = [];
  const normals = [];
  const triangles = [];
  let missingNormals = 0;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    const tag = parts[0];

    if (tag === "v" && parts.length >= 4) {
      vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (tag === "vn" && parts.length >= 4) {
      normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (tag === "f" && parts.length >= 4) {
      const face = parts.slice(1).map((token) => {
        const [position, , normal] = token.split("/");
        return {
          p: resolveIndex(position, vertices.length),
          n: normal ? resolveIndex(normal, normals.length) : -1,
        };
      });

      // Веерная триангуляция: OBJ допускает многоугольники.
      for (let index = 1; index + 1 < face.length; index += 1) {
        const corner = [face[0], face[index], face[index + 1]];
        if (corner.some((item) => item.p < 0 || item.p >= vertices.length)) continue;
        if (corner.some((item) => item.n < 0 || item.n >= normals.length)) missingNormals += 1;
        triangles.push(corner);
      }
    }
  }

  if (triangles.length === 0) {
    throw new Error("в модели не найдено ни одной грани");
  }

  // Центр и размер: без этого модель может оказаться за пределами камеры.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex[0]); maxX = Math.max(maxX, vertex[0]);
    minY = Math.min(minY, vertex[1]); maxY = Math.max(maxY, vertex[1]);
    minZ = Math.min(minZ, vertex[2]); maxZ = Math.max(maxZ, vertex[2]);
  }
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 || 1;
  const factor = scale / radius;

  const positions = new Float32Array(triangles.length * 9);
  const outNormals = new Float32Array(triangles.length * 9);
  let cursor = 0;

  for (const corner of triangles) {
    const points = corner.map((item) => {
      const vertex = vertices[item.p];
      return [
        (vertex[0] - center[0]) * factor,
        (vertex[1] - center[1]) * factor,
        (vertex[2] - center[2]) * factor,
      ];
    });

    // Геометрическая нормаль нужна, если в файле нет `vn`.
    const [a, b, c] = points;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const fallback = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const fallbackLength = Math.hypot(fallback[0], fallback[1], fallback[2]) || 1;
    const fallbackUnit = fallback.map((value) => value / fallbackLength);

    corner.forEach((item, cornerIndex) => {
      const point = points[cornerIndex];
      const normal = item.n >= 0 && normals[item.n] ? normals[item.n] : fallbackUnit;
      const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;

      positions[cursor] = point[0];
      positions[cursor + 1] = point[1];
      positions[cursor + 2] = point[2];
      outNormals[cursor] = normal[0] / length;
      outNormals[cursor + 1] = normal[1] / length;
      outNormals[cursor + 2] = normal[2] / length;
      cursor += 3;
    });
  }

  return {
    positions,
    normals: outNormals,
    triangles: triangles.length,
    vertices: vertices.length,
    missingNormals,
  };
}

// ---------- Матрицы ----------

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * range * 2, 0,
  ]);
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let index = 0; index < 4; index += 1) {
        sum += a[index * 4 + row] * b[column * 4 + index];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Поворот вокруг Y, затем наклон вокруг X: модель «крутится» на месте. */
function rotationMatrix(angleY, angleX) {
  const cy = Math.cos(angleY), sy = Math.sin(angleY);
  const cx = Math.cos(angleX), sx = Math.sin(angleX);
  const rotateY = new Float32Array([
    cy, 0, -sy, 0,
    0, 1, 0, 0,
    sy, 0, cy, 0,
    0, 0, 0, 1,
  ]);
  const rotateX = new Float32Array([
    1, 0, 0, 0,
    0, cx, sx, 0,
    0, -sx, cx, 0,
    0, 0, 0, 1,
  ]);
  return multiply(rotateX, rotateY);
}

// ---------- Шейдеры ----------

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uProjection;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vEye;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  // Нормали поворачиваются той же матрицей: она без неоднородного масштаба,
  // а mat3(mat4) в GLSL ES 1.00 недоступен.
  vNormal = (uModel * vec4(aNormal, 0.0)).xyz;
  vEye = -world.xyz;
  gl_Position = uProjection * vec4(world.xyz, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vEye;
uniform vec3 uColorA;
uniform vec3 uColorB;

void main() {
  vec3 normal = normalize(vNormal);
  vec3 key = normalize(vec3(0.45, 0.6, 1.0));
  vec3 fill = normalize(vec3(-0.75, -0.35, 0.45));

  float keyLight = max(dot(normal, key), 0.0);
  float fillLight = max(dot(normal, fill), 0.0);
  float rim = pow(1.0 - max(dot(normal, normalize(vEye)), 0.0), 2.5);

  vec3 base = mix(uColorB, uColorA, clamp(0.5 + 0.5 * normal.y, 0.0, 1.0));
  vec3 color = base * (0.22 + 0.85 * keyLight + 0.30 * fillLight) + vec3(0.5, 0.28, 0.14) * rim;
  gl_FragColor = vec4(color, 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`не удалось собрать шейдер: ${log}`);
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`не удалось собрать программу: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function hexToRgb(value, fallback) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!match) return fallback;
  const number = Number.parseInt(match[1], 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

/**
 * Запускает одно воспроизведение модели.
 *
 * Возвращает объект с `stop()`: экран можно закрыть до конца анимации,
 * и тогда кадры больше не запрашиваются.
 */
function createScene(canvas, mesh, options = {}) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false })
    || canvas.getContext("experimental-webgl");
  if (!gl) throw new Error("WebGL недоступен в этой системе");

  const duration = Math.max(0.5, Number(options.duration) || 5);
  const turns = Number(options.turns) || 1.25;
  const colorA = hexToRgb(options.colorA, [0.78, 0.36, 0.18]);
  const colorB = hexToRgb(options.colorB, [0.28, 0.22, 0.20]);

  const program = createProgram(gl);
  const positionBuffer = gl.createBuffer();
  const normalBuffer = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, "aPosition");
  const aNormal = gl.getAttribLocation(program, "aNormal");
  const uProjection = gl.getUniformLocation(program, "uProjection");
  const uModel = gl.getUniformLocation(program, "uModel");
  const uColorA = gl.getUniformLocation(program, "uColorA");
  const uColorB = gl.getUniformLocation(program, "uColorB");

  gl.enable(gl.DEPTH_TEST);
  // Отсечение задних граней выключено намеренно: модель может прийти от
  // пользователя с любым обходом вершин, и тогда часть её исчезла бы.
  gl.disable(gl.CULL_FACE);

  let frame = 0;
  let stopped = false;
  let started = 0;

  // Плавное появление и мягкое затухание вращения в конце.
  const easeOut = (value) => 1 - (1 - value) ** 3;
  const easeIn = (value) => value * value;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    // Сцена может быть ещё не разложена — тогда берём размеры контейнера,
    // иначе canvas получился бы однопиксельным и модель была бы не видна.
    const cssWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 640;
    const cssHeight = canvas.clientHeight || canvas.parentElement?.clientHeight || 420;
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(progress) {
    resize();

    const appear = Math.min(1, progress / 0.35);
    const spin = easeOut(progress) * 360 * turns * DEG;
    const tilt = -18 * DEG + 10 * DEG * Math.sin(progress * Math.PI);
    const model = rotationMatrix(spin, tilt);
    const scale = 0.55 + 0.45 * easeIn(appear);
    for (let index = 0; index < 12; index += 1) model[index] *= scale;

    const aspect = canvas.width / Math.max(1, canvas.height);
    const projection = perspective(38 * DEG, aspect, 0.1, 40);
    const distance = 3.1 / Math.max(0.2, scale);

    // Камера отодвигается на distance: дописываем сдвиг в матрицу проекции.
    const view = multiply(projection, new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, -distance, 1,
    ]));

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(uProjection, false, view);
    gl.uniformMatrix4fv(uModel, false, model);
    gl.uniform3fv(uColorA, colorA);
    gl.uniform3fv(uColorB, colorB);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.positions.length / 3);
  }

  function tick(timestamp) {
    if (stopped) return;
    if (!started) started = timestamp;

    const progress = Math.min(1, (timestamp - started) / (duration * 1000));
    draw(progress);

    if (progress < 1) {
      frame = requestAnimationFrame(tick);
    } else if (typeof options.onFinish === "function") {
      options.onFinish();
    }
  }

  return {
    start() {
      stopped = false;
      started = 0;
      draw(0);
      frame = requestAnimationFrame(tick);
    },
    resize,
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
    },
  };
}

window.TitleWordViewer = { parseObj, createScene };
