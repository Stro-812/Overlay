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
  if (!process.exitCode) console.log('проверки прошли');
}
