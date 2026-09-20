#!/usr/bin/env node
/**
 * Прогон рендера в настоящем браузере: страница собирается на лету,
 * оверлей рисуется из тех же файлов, что уйдут на сайт, и кладётся в
 * test/out/. Там же — версия поверх шахматки, чтобы глазами увидеть,
 * что прозрачность действительно прозрачность, а не белый фон.
 *
 *   npm run render          собрать картинки
 *   npm test                то же плюс проверки
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { open } from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'test/out');
const check = process.argv.includes('--check');

// настоящий трек в гит не кладётся, поэтому берём его, только если он рядом
const trackFile = ['test/fixtures/track.json', 'test/fixtures/track.sample.json']
  .map((rel) => path.join(root, rel));
const track = JSON.parse(await readFile(trackFile[0], 'utf8').catch(() => readFile(trackFile[1], 'utf8')));
const stats = JSON.parse(await readFile(path.join(root, 'test/fixtures/stats.json'), 'utf8'));
const intervals = JSON.parse(await readFile(path.join(root, 'test/fixtures/intervals.json'), 'utf8'));

await mkdir(out, { recursive: true });

const { page, problems: errors, close } = await open(root);

const result = await page.evaluate(async ({ track, stats }) => {
  const { renderToCanvas } = await import('/src/overlay.js');
  const canvas = document.createElement('canvas');
  await renderToCanvas({ track, stats }, {}, canvas);

  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;

  return {
    png: canvas.toDataURL('image/png').split(',')[1],
    width: canvas.width,
    height: canvas.height,
    // доля непрозрачных пикселей: ноль — ничего не нарисовалось, единица — фон залит
    inked: opaque / (canvas.width * canvas.height),
    corner: [...data.slice(0, 4)],
  };
}, { track, stats });

await writeFile(path.join(out, 'overlay.png'), Buffer.from(result.png, 'base64'));

/* ---------- фотография с оверлеем: путь, по которому ничего не теряется ---------- */

// настоящий снимок в гит не кладём — для проверки хватает рисованного фона
const composite = await page.evaluate(async ({ track, stats }) => {
  const { renderComposite } = await import('/src/overlay.js');

  const photo = document.createElement('canvas');
  photo.width = 1200;
  photo.height = 1500;
  const pctx = photo.getContext('2d');
  const sky = pctx.createLinearGradient(0, 0, 0, 1500);
  sky.addColorStop(0, '#2f7fd0');
  sky.addColorStop(1, '#d8c39a');
  pctx.fillStyle = sky;
  pctx.fillRect(0, 0, 1200, 1500);

  const blob = await renderComposite({ photo, track, stats }, { format: 'image/png' });

  const bitmap = await createImageBitmap(blob);
  const probe = document.createElement('canvas');
  probe.width = bitmap.width;
  probe.height = bitmap.height;
  probe.getContext('2d').drawImage(bitmap, 0, 0);
  const { data } = probe.getContext('2d').getImageData(0, 0, bitmap.width, bitmap.height);

  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) clear++;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return {
    png: btoa(binary),
    width: bitmap.width,
    height: bitmap.height,
    seeThrough: clear,
    corner: [...data.slice(0, 4)],
  };
}, { track, stats });

await writeFile(path.join(out, 'composite.png'), Buffer.from(composite.png, 'base64'));

/* ---------- поворот маршрута и выбор строк ---------- */

const knobs = await page.evaluate(async ({ track, stats }) => {
  const { trackPath } = await import('/src/track.js');
  const { renderToCanvas } = await import('/src/overlay.js');

  const box = { width: 600, height: 600 };
  const upright = trackPath(track, box);
  const turned = trackPath(track, box, { rotate: 90 });
  const full = trackPath(track, box, { rotate: 360 });

  // сколько строк рисуется при разном составе
  const ink = async (rows) => {
    const canvas = document.createElement('canvas');
    await renderToCanvas({ stats: { rows } }, { height: 'auto', track: { show: false } }, canvas);
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let on = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) on++;
    return { on, height: canvas.height };
  };

  const all = await ink(stats.rows);
  const hidden = await ink(stats.rows.map((r, i) => (i === 1 ? { ...r, show: false } : r)));
  const empty = await ink(stats.rows.map((r, i) => (i === 1 ? { ...r, value: '' } : r)));

  return {
    // поворот на 90° меняет местами стороны описанного прямоугольника
    upright: [Math.round(upright.width), Math.round(upright.height)],
    turned: [Math.round(turned.width), Math.round(turned.height)],
    // полный оборот обязан вернуть ровно то же самое
    fullCircle: Math.abs(full.width - upright.width) < 1 && Math.abs(full.height - upright.height) < 1,
    all,
    hidden,
    empty,
  };
}, { track, stats });

/* ---------- интервалы и знак ---------- */

const extra = await page.evaluate(async ({ intervals, stats }) => {
  const { renderToCanvas } = await import('/src/overlay.js');
  const { safeRect, drawLogo, logoRect, sampleBackdrop, SAFE } = await import('/src/logo.js');

  const ink = async (data, options) => {
    const canvas = document.createElement('canvas');
    await renderToCanvas(data, options, canvas);
    const { data: px } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let on = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) on++;
    return on;
  };

  // второй JSON есть — по умолчанию должны рисоваться интервалы
  const auto = await ink({ stats, intervals }, { width: 1080, height: 1350 });
  const forced = await ink({ stats, intervals }, { width: 1080, height: 1350, mode: 'stats' });
  const onlyIntervals = await ink({ intervals }, { width: 1080, height: 1350 });
  const onlyStats = await ink({ stats }, { width: 1080, height: 1350 });

  // знак не должен вылезать за безопасную зону ни в одном углу
  const box = safeRect(1080, 1350, SAFE);
  const corners = [];
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [-5, 9]]) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1350;
    const spot = await drawLogo(canvas.getContext('2d'),
      { width: 1080, height: 1350, logo: { x, y, size: 0.16 } });
    corners.push([
      spot.x >= box.x - 0.5,
      spot.y >= box.y - 0.5,
      spot.x + spot.side <= box.x + box.width + 0.5,
      spot.y + spot.side <= box.y + box.height + 0.5,
    ].every(Boolean));
  }
  // вариант знака выбирает подложка: на тёмной — белый, на светлой — цветной
  const onBackdrop = async (paint, logo = { x: 1, y: 0, size: 0.16 }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1350;
    const c = canvas.getContext('2d');
    if (paint) paint(c);
    const backdrop = sampleBackdrop(c, logoRect(1080, 1350, logo), { width: 1080, height: 1350 });
    const spot = await drawLogo(c, { width: 1080, height: 1350, logo, backdrop });
    return { white: spot.white, luma: +backdrop.luma.toFixed(2), coverage: +backdrop.coverage.toFixed(2) };
  };
  const flat = (fill) => (c) => { c.fillStyle = fill; c.fillRect(0, 0, 1080, 1350); };
  const dark = await onBackdrop(flat('#101418'));
  const light = await onBackdrop(flat('#f2f4f8'));
  const none = await onBackdrop(null);

  // ради этого замер и переехал под знак: верх кадра тёмный, низ светлый.
  // По среднему всей зоны вышло бы серединное значение на оба угла
  const split = (c) => {
    c.fillStyle = '#12161c'; c.fillRect(0, 0, 1080, 675);
    c.fillStyle = '#eef1f6'; c.fillRect(0, 675, 1080, 675);
  };
  const splitTop = await onBackdrop(split, { x: 1, y: 0, size: 0.16 });
  const splitBottom = await onBackdrop(split, { x: 1, y: 1, size: 0.16 });

  // знак обязателен: без всяких настроек он всё равно на картинке
  const bare = document.createElement('canvas');
  await renderToCanvas({ stats }, { width: 600, height: 600 }, bare);
  const corner = bare.getContext('2d').getImageData(520, 100, 60, 60).data;
  let logoInk = 0;
  for (let i = 3; i < corner.length; i += 4) if (corner[i] > 0) logoInk++;

  return { auto, forced, onlyIntervals, onlyStats, вЗоне: corners.every(Boolean),
           dark, light, none, splitTop, splitBottom, logoInk };
}, { intervals, stats });

console.log(`интервалы: сами ${extra.auto} точек, принудительно цифры ${extra.forced}`);
console.log(`знак внутри безопасной зоны во всех углах: ${extra.вЗоне ? 'да' : 'НЕТ'}`);
console.log(`вариант знака: тёмная подложка → ${extra.dark.white ? 'белый' : 'цветной'}`
  + ` (яркость ${extra.dark.luma}), светлая → ${extra.light.white ? 'белый' : 'цветной'}`
  + ` (яркость ${extra.light.luma}), без подложки → ${extra.none.white ? 'белый' : 'цветной'}`);
console.log(`кадр «тёмный верх, светлый низ»: сверху → ${extra.splitTop.white ? 'белый' : 'цветной'}`
  + ` (${extra.splitTop.luma}), снизу → ${extra.splitBottom.white ? 'белый' : 'цветной'} (${extra.splitBottom.luma})`);

console.log(`поворот: ${knobs.upright.join('×')} → ${knobs.turned.join('×')} при 90°`);
console.log(`строки: все ${knobs.all.height}px, со скрытой ${knobs.hidden.height}px`);
console.log(`test/out/composite.png — ${composite.width}×${composite.height}, `
  + `просвечивает пикселей: ${composite.seeThrough}`);

// та же картинка на шахматке — так видно и прозрачность, и раскладку
await page.setViewportSize({ width: result.width, height: result.height });
await page.setContent(`<style>
  html,body{margin:0}
  body{width:${result.width}px;height:${result.height}px;
    background-color:#fff;
    background-image:linear-gradient(45deg,#d8dbe2 25%,transparent 25%,transparent 75%,#d8dbe2 75%),
                     linear-gradient(45deg,#d8dbe2 25%,transparent 25%,transparent 75%,#d8dbe2 75%);
    background-size:48px 48px;background-position:0 0,24px 24px}
  img{position:absolute;inset:0;width:100%}
</style><img src="data:image/png;base64,${result.png}">`);
await page.screenshot({ path: path.join(out, 'overlay-on-checker.png') });

await close();

console.log(`test/out/overlay.png — ${result.width}×${result.height}, закрашено ${(result.inked * 100).toFixed(1)}%`);
console.log(`угловой пиксель rgba(${result.corner.join(', ')})`);
for (const e of errors) console.error('ошибка страницы:', e);

if (check) {
  const fail = (m) => { console.error('ПРОВАЛ:', m); process.exitCode = 1; };
  if (errors.length) fail('страница ругалась в консоль');
  if (result.corner[3] !== 0) fail('угол непрозрачный — фон не пустой');
  if (result.inked < 0.005) fail('почти ничего не нарисовано');
  if (result.inked > 0.5) fail('закрашено слишком много — похоже на залитый фон');
  if (composite.width !== 1200 || composite.height !== 1500) fail('размер не взят у фотографии');
  if (composite.seeThrough !== 0) fail(`в готовой картинке ${composite.seeThrough} просвечивающих пикселей`);
  if (composite.corner[3] !== 255) fail('угол готовой картинки не залит — фотография не подложилась');

  const [w, h] = knobs.upright;
  const [tw, th] = knobs.turned;
  if (Math.abs(tw - h) > 2 || Math.abs(th - w) > 2) fail('поворот на 90° не поменял стороны местами');
  if (!knobs.fullCircle) fail('полный оборот сдвинул маршрут');
  if (knobs.hidden.height >= knobs.all.height) fail('show: false не убрал строку');
  if (knobs.hidden.on >= knobs.all.on) fail('скрытая строка всё равно нарисовалась');
  if (knobs.empty.height !== knobs.hidden.height) fail('пустое значение и show: false убирают строку по-разному');

  if (extra.auto !== extra.onlyIntervals) fail('при двух JSON по умолчанию нарисовались не интервалы');
  if (extra.forced !== extra.onlyStats) fail('mode: stats не вернул общие цифры');
  if (extra.auto === extra.forced) fail('интервалы и общие цифры дали одинаковую картинку');
  if (!extra.вЗоне) fail('знак вышел за безопасную зону');
  if (!extra.dark.white) fail('на тёмной подложке знак остался цветным');
  if (extra.light.white) fail('на светлой подложке знак стал белым');
  if (extra.none.white) fail('без подложки знак должен быть цветным');
  if (extra.none.coverage > 0.05) fail('пустая канва посчиталась непрозрачной');
  if (!extra.logoInk) fail('знак не нарисовался без настроек — он обязателен');
  if (!extra.splitTop.white) fail('в тёмном верху кадра знак остался цветным');
  if (extra.splitBottom.white) fail('в светлом низу кадра знак стал белым');
  if (!process.exitCode) console.log('проверки прошли');
}
