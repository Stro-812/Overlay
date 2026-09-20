/**
 * Оверлей забега: два JSON — на выходе прозрачный PNG.
 *
 * Картинка кладётся поверх фотографии с забега, поэтому фон остаётся
 * прозрачным, а рисуются только цифры, значки и контур маршрута.
 *
 *   const blob = await renderOverlay({ track, stats }, { width: 1080 });
 *
 * Первый аргумент — данные: трек с координатами и цифры забега. Второй —
 * как их разложить. Разделены нарочно: в первом лежит то, что меняется с
 * каждым забегом, во втором — то, что подобрано один раз и живёт в коде
 * кнопки.
 *
 * Считать цифры из трека модуль не пытается, и это тоже нарочно: платформа
 * сглаживает набор высоты, а каденс отдаёт на одну ногу, так что пересчёт
 * по точкам разошёлся бы с тем, что человек видит у себя в дневнике.
 */
import { trackPath } from './track.js';
import { drawIcon } from './icons.js';
import { drawIntervals } from './intervals.js';
import { drawLogo } from './logo.js';

/** @typedef {{ icon?: string, value: string|number, unit?: string, accent?: boolean, show?: boolean }} Row */
/** @typedef {{ track?: unknown, stats: { rows: Row[] } | Row[] }} OverlayData */

export const DEFAULTS = {
  width: 1080,
  height: 1080,
  color: '#1b3a93',
  accent: '#ff2d20',
  fontFamily: 'Montserrat',
  loadFont: true,
  /** раскладка столбика цифр; доли — от ширины картинки */
  stats: { x: 0.06, y: 0.08, scale: 0.1, gap: 1.32 },
  /** раскладка контура маршрута */
  track: { show: true, x: 0.34, y: 0.3, size: 0.62, rotate: 0, accent: true, weight: 0.009, opacity: 1 },
  /** что показывать: 'stats' — общие цифры забега, 'intervals' — разбор
   *  интервалов. Пусто — выбирается само: интервалы, если они переданы */
  mode: null,
  /** раскладка разбора интервалов */
  intervals: {
    // кегль подобран так, чтобы семь строк с заголовком помещались
    // в квадрат 1080×1080 — на вертикальном снимке места ещё больше
    x: 0.06, y: 0.04, scale: 0.055,
    colGap: 0.045, rowGap: 0.38, headGap: 1.5,
    labelMax: 0.24, ink: '#111111',
  },
  /** знак: x и y — доли свободного хода внутри безопасной зоны соцсетей.
   *  По умолчанию правый верхний угол — там свободно при любой раскладке цифр */
  logo: { show: false, x: 1, y: 0, size: 0.16, opacity: 1 },
};

const GOOGLE_FONT = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@600;800&display=swap';

/**
 * Без загруженного шрифта канва молча подставит системный, и цифры уедут:
 * ширину строки она меряет тем, что есть в эту секунду. Поэтому ждём шрифт
 * до первого измерения, а не до первой отрисовки.
 */
async function ensureFont(family, loadFont) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const faces = [`800 100px "${family}"`, `600 100px "${family}"`];

  if (loadFont && family === DEFAULTS.fontFamily && !faces.every((f) => document.fonts.check(f))) {
    if (!document.querySelector(`link[href="${GOOGLE_FONT}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = GOOGLE_FONT;
      document.head.append(link);
    }
  }
  // сеть может шрифт не дать — это не повод не отдать картинку вовсе
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => {})));
}

function settings(options = {}, stats) {
  const out = { ...DEFAULTS, ...options };
  for (const key of ['stats', 'intervals', 'logo']) {
    out[key] = { ...DEFAULTS[key], ...options[key] };
  }
  // второй JSON может сам сказать, показывать ли маршрут, — это свойство забега,
  // а не раскладки: у трека по стадиону показывать нечего
  out.track = { ...DEFAULTS.track, ...options.track, ...(Array.isArray(stats) ? {} : stats?.track) };
  return out;
}

/** Метрики строки, все производные от кегля числа. */
function metrics(unit) {
  return { value: unit, label: unit * 0.4, icon: unit * 0.92, iconGap: unit * 0.3, labelGap: unit * 0.14 };
}

/**
 * Какие строки рисовать. Убрать метрику можно двумя способами: выключить
 * её через `show: false` или оставить пустое значение. Второе удобно, когда
 * JSON собирается шаблоном и вырезать поле неоткуда.
 */
function rowsOf(stats) {
  const rows = Array.isArray(stats) ? stats : stats?.rows ?? [];
  return rows.filter((row) => row && row.show !== false && row.value != null && row.value !== '');
}

/**
 * Рисует оверлей на переданной канве и возвращает её.
 * @param {OverlayData} data
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export async function renderToCanvas(data, options, canvas, { keep = false } = {}) {
  const opts = settings(options, data.stats);
  const rows = rowsOf(data.stats);
  await ensureFont(opts.fontFamily, opts.loadFont);

  const width = opts.width;
  const m = metrics(width * opts.stats.scale);
  const rowHeight = m.value * opts.stats.gap;

  // «auto» — высота ровно под столбик цифр: удобно, когда маршрут не нужен
  // «auto» подгоняет высоту под столбик цифр; у интервалов две колонки,
  // и такой подгонки для них нет
  const auto = opts.height === 'auto' && !data.intervals;
  const height = auto
    ? Math.ceil(width * opts.stats.y * 2 + rowHeight * rows.length)
    : opts.height;

  // выставление размера само очищает канву, поэтому при keep его не трогаем
  if (!keep) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  if (!keep) ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'alphabetic';

  /* ---------- контур маршрута ---------- */

  if (opts.track.show && data.track) {
    const side = width * opts.track.size;
    const fitted = trackPath(data.track, { width: side, height: side }, { rotate: opts.track.rotate });
    if (fitted) {
      ctx.save();
      ctx.globalAlpha = opts.track.opacity;
      // якорь — центр отведённой клетки: иначе маршрут прыгает, когда у
      // следующего забега другая форма
      ctx.translate(
        width * opts.track.x + (side - fitted.width) / 2,
        height * opts.track.y + (side - fitted.height) / 2,
      );
      ctx.strokeStyle = opts.track.accent ? opts.accent : opts.color;
      ctx.lineWidth = width * opts.track.weight;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(fitted.path);
      ctx.restore();
    }
  }

  /* ---------- разбор интервалов или столбик цифр ---------- */

  const mode = opts.mode ?? (data.intervals ? 'intervals' : 'stats');
  if (mode === 'intervals' && data.intervals) {
    drawIntervals(ctx, data.intervals, { ...opts, width, height });
    await drawLogo(ctx, { width, height, logo: opts.logo });
    return canvas;
  }

  // при «auto» отступ сверху считается от ширины: высота ведь и зависит от него
  let y = (auto ? width : height) * opts.stats.y;
  const x = width * opts.stats.x;

  for (const row of rows) {
    const color = row.accent ? opts.accent : opts.color;
    const baseline = y + m.value * 0.78;
    let cursor = x;

    // иконка выше прописных, поэтому её центруют по оптическому центру цифр,
    // а не по верху строки
    const iconTop = baseline - m.value * 0.35 - m.icon / 2;
    if (drawIcon(ctx, row.icon, cursor, iconTop, m.icon, { color, width: m.value * 0.07 })) {
      cursor += m.icon + m.iconGap;
    }

    const value = String(row.value);
    ctx.font = `800 ${m.value}px "${opts.fontFamily}", "Arial Black", sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(value, cursor, baseline);
    cursor += ctx.measureText(value).width;

    if (row.unit) {
      ctx.font = `600 ${m.label}px "${opts.fontFamily}", Arial, sans-serif`;
      ctx.fillText(row.unit, cursor + m.labelGap, baseline);
    }
    y += rowHeight;
  }

  await drawLogo(ctx, { width, height, logo: opts.logo });
  return canvas;
}

/**
 * Собирает оверлей и отдаёт его прозрачным PNG.
 * @param {OverlayData} data
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {Promise<Blob>}
 */
export async function renderOverlay(data, options) {
  const canvas = document.createElement('canvas');
  await renderToCanvas(data, options, canvas);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('браузер не отдал PNG'))),
      'image/png',
    );
  });
}

/** Приводит фотографию к тому, что умеет рисовать канва. */
async function loadPhoto(photo) {
  if (typeof photo === 'string') {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // иначе канва «пачкается» и toBlob откажет
    img.src = photo;
    await img.decode();
    return img;
  }
  if (photo instanceof Blob) return createImageBitmap(photo);
  return photo;                       // уже <img>, <canvas> или ImageBitmap
}

/**
 * Собирает фотографию вместе с оверлеем в одну непрозрачную картинку.
 *
 * Это надёжный путь до соцсетей. Прозрачный PNG по дороге теряет альфу:
 * телефон и приложения охотно пережимают его в JPEG, а просмотрщики
 * подкладывают под прозрачность шахматку, и в ленту уезжает она. Здесь
 * накладывать нечего — всё уже наложено.
 *
 * Размер берётся у фотографии, поэтому раскладка в долях ширины ложится
 * на неё как есть.
 */
export async function renderComposite(data, options = {}) {
  const image = await loadPhoto(data.photo);
  const width = options.width ?? image.naturalWidth ?? image.width;
  const height = options.height ?? image.naturalHeight ?? image.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);

  // оверлей рисуем поверх на той же канве: своей она её не очищает,
  // потому что размеры уже выставлены
  await renderToCanvas(data, { ...options, width, height }, canvas, { keep: true });

  const type = options.format ?? 'image/jpeg';
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('браузер не отдал картинку'))),
      type,
      options.quality ?? 0.92,
    );
  });
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // отзываем не сразу: Safari успевает потерять ссылку до начала скачивания
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Кнопка «картинка для соцсетей»: фотография с оверлеем, одним файлом. */
export async function downloadComposite(data, options, filename = 'zabeg.jpg') {
  const blob = await renderComposite(data, options);
  save(blob, filename);
  return blob;
}

/** Кнопка «прозрачный PNG»: для тех, кто накладывает сам в редакторе. */
export async function downloadOverlay(data, options, filename = 'overlay.png') {
  const blob = await renderOverlay(data, options);
  save(blob, filename);
  return blob;
}
