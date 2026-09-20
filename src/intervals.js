/**
 * Разбор интервальной тренировки: две колонки, быстрые отрезки и медленные.
 *
 * Строки выровнены по горизонтали между колонками: «средний пульс» слева и
 * справа стоят на одной линии, чтобы их можно было сравнивать взглядом.
 * Поэтому высота строки — наибольшая из двух колонок, а `null` в списке
 * оставляет пустое место. Так каденс, который есть только у быстрых
 * отрезков, не сдвигает всё, что под ним, в соседней колонке.
 */
import { drawIcon } from './icons.js';

/** @typedef {{ icon?: string, label?: string, value: string|number, unit?: string }} Line */

/** Приводит второй JSON к списку колонок, каким бы видом он ни пришёл. */
export function columnsOf(intervals) {
  const raw = Array.isArray(intervals) ? intervals : intervals?.columns ?? [];
  return raw
    .filter(Boolean)
    .map((col) => ({
      title: col.title ?? '',
      accent: Boolean(col.accent),
      // null сохраняем: это пустой слот, который держит выравнивание
      rows: (col.rows ?? []).map((r) => (r && r.value != null && r.value !== '' && r.show !== false ? r : null)),
    }))
    .filter((col) => col.rows.some(Boolean));
}

function intervalMetrics(unit) {
  return {
    head: unit * 1.05,
    label: unit * 0.4,
    value: unit,
    icon: unit * 1.06,
    iconGap: unit * 0.32,
    unitSize: unit * 0.4,
    unitGap: unit * 0.14,
    labelLine: unit * 0.5,
  };
}

/** Делит подпись на строки так, чтобы она не вылезала за отведённую ширину. */
function wrap(ctx, text, max) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [words[0]];
  for (const word of words.slice(1)) {
    const merged = lines.at(-1) + ' ' + word;
    if (ctx.measureText(merged).width <= max) lines[lines.length - 1] = merged;
    else lines.push(word);
  }
  return lines;
}

/**
 * Рисует разбор интервалов и возвращает занятый прямоугольник.
 * @returns {{x: number, y: number, width: number, height: number} | null}
 */
export function drawIntervals(ctx, intervals, opts) {
  const cols = columnsOf(intervals);
  if (!cols.length) return null;

  const L = opts.intervals;
  const W = opts.width;
  const u = W * L.scale;
  const m = intervalMetrics(u);
  const font = opts.fontFamily;
  const labelFont = `600 ${m.label}px "${font}", Arial, sans-serif`;
  const valueFont = `800 ${m.value}px "${font}", "Arial Black", sans-serif`;
  const unitFont = `600 ${m.unitSize}px "${font}", Arial, sans-serif`;
  const headFont = `800 ${m.head}px "${font}", "Arial Black", sans-serif`;
  const labelMax = W * L.labelMax;

  /* ---------- раскладка считается целиком до первой отрисовки ---------- */

  const measured = cols.map((col) => {
    const rows = col.rows.map((row) => {
      if (!row) return null;
      ctx.font = labelFont;
      const lines = wrap(ctx, row.label ?? '', labelMax);
      const labelW = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
      ctx.font = valueFont;
      let valueW = ctx.measureText(String(row.value)).width;
      if (row.unit) {
        ctx.font = unitFont;
        valueW += m.unitGap + ctx.measureText(row.unit).width;
      }
      return { row, lines, text: Math.max(labelW, valueW) };
    });
    ctx.font = headFont;
    const width = Math.max(
      ctx.measureText(col.title).width,
      ...rows.filter(Boolean).map((r) => m.icon + m.iconGap + r.text),
    );
    return { col, rows, width };
  });

  // высота строки — наибольшая из колонок, иначе строки разъедутся
  const depth = Math.max(...measured.map((c) => c.rows.length));
  const heights = [];
  for (let i = 0; i < depth; i++) {
    const lines = Math.max(1, ...measured.map((c) => c.rows[i]?.lines.length ?? 1));
    heights.push(lines * m.labelLine + m.value + u * L.rowGap);
  }

  const gap = W * L.colGap;
  const total = measured.reduce((sum, c) => sum + c.width, 0) + gap * (measured.length - 1);
  const height = m.head * L.headGap + heights.reduce((a, b) => a + b, 0);
  const left = W * L.x;
  const top = opts.height * L.y;

  /* ---------- отрисовка ---------- */

  let x = left;
  for (const { col, rows, width } of measured) {
    const colour = col.accent ? opts.accent : opts.color;
    ctx.fillStyle = colour;
    ctx.font = headFont;
    ctx.fillText(col.title, x, top + m.head * 0.78);

    let y = top + m.head * L.headGap;
    rows.forEach((entry, i) => {
      if (entry) {
        const { row, lines } = entry;
        const textX = x + m.icon + m.iconGap;
        const labelTop = y;
        ctx.fillStyle = L.ink;
        ctx.font = labelFont;
        lines.forEach((line, n) => ctx.fillText(line, textX, labelTop + m.label * 0.8 + n * m.labelLine));

        const baseline = labelTop + lines.length * m.labelLine + m.value * 0.78;
        ctx.font = valueFont;
        const value = String(row.value);
        ctx.fillText(value, textX, baseline);

        if (row.unit) {
          const after = textX + ctx.measureText(value).width;
          ctx.font = unitFont;
          ctx.fillText(row.unit, after + m.unitGap, baseline);
        }
        // значок держится оптического центра значения, как в столбике цифр
        drawIcon(ctx, row.icon, x, baseline - m.value * 0.35 - m.icon / 2, m.icon,
          { color: colour, width: m.value * 0.07 });
      }
      y += heights[i];
    });
    x += width + gap;
  }

  return { x: left, y: top, width: total, height };
}
