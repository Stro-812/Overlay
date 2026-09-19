/**
 * Трек забега: из точек дневника — в контур на канве.
 *
 * Масштаб забега — километры, поэтому хватает равнопромежуточной проекции
 * с поправкой на косинус широты: на 20 км её расхождение с настоящей
 * меркаторовской меньше толщины линии.
 */

/** Достаёт [lon, lat] из всех форматов, в которых приходит трек. */
export function readPoints(track) {
  const raw = Array.isArray(track) ? track : (track?.points ?? track?.coordinates ?? []);
  const out = [];
  for (const item of raw) {
    const pair = Array.isArray(item) ? item : item?.coordinate ?? item?.coordinates;
    const lon = Array.isArray(pair) ? pair[0] : item?.lon ?? item?.lng ?? item?.longitude;
    const lat = Array.isArray(pair) ? pair[1] : item?.lat ?? item?.latitude;
    // у хвостовых точек часть полей бывает null — такую точку просто пропускаем
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  return out;
}

/**
 * Выбрасывает точки, которые не меняют форму линии (Рамер — Дуглас — Пекер).
 * Трек на 20 км приходит двумя тысячами точек, на 100 км — десятками тысяч;
 * без прореживания рисование начинает заметно тормозить на телефоне.
 */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);

    let worst = 0;
    let at = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const d = len === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Укладывает трек в прямоугольник, сохраняя пропорции: форма маршрута
 * не должна растягиваться под рамку, иначе он перестаёт быть узнаваемым.
 *
 * @returns {{path: Path2D, width: number, height: number} | null}
 */
export function trackPath(track, box) {
  const points = readPoints(track);
  if (points.length < 2) return null;

  const lat0 = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const flat = points.map(([lon, lat]) => [lon * kx, -lat]);

  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-9;
  const spanY = maxY - minY || 1e-9;

  const scale = Math.min(box.width / spanX, box.height / spanY);
  const width = spanX * scale;
  const height = spanY * scale;

  // допуск в полпикселя итоговой картинки: глазу такое смещение недоступно
  const thinned = simplify(flat, 0.5 / scale);

  const path = new Path2D();
  thinned.forEach(([x, y], i) => {
    const px = (x - minX) * scale;
    const py = (y - minY) * scale;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  });

  return { path, width, height };
}
