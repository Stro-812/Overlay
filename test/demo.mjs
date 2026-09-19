#!/usr/bin/env node
/**
 * Прогон демо-страницы: загружаем оба JSON и, если дали, фотографию, снимаем
 * экран и проверяем, что страница не ругалась в консоль.
 *
 *   node test/demo.mjs [путь-к-фотографии]
 */
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { open } from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const photo = process.argv[2];
await mkdir(path.join(root, 'test/out'), { recursive: true });

const { page, problems, close } = await open(root, {
  entry: 'demo/index.html',
  viewport: { width: 1400, height: 1000 },
});

// настоящий трек в гит не кладётся — если его нет рядом, берём образец
const real = path.join(root, 'test/fixtures/track.json');
await page.setInputFiles('input[data-for=track]', existsSync(real)
  ? real
  : path.join(root, 'test/fixtures/track.sample.json'));
await page.setInputFiles('input[data-for=stats]', path.join(root, 'test/fixtures/stats.json'));
if (photo) await page.setInputFiles('input[data-for=photo]', photo);

await page.waitForFunction(() => !document.getElementById('save').disabled);
await page.waitForFunction(() => document.fonts.check('800 100px "Montserrat"'));

const status = await page.textContent('#status');
const error = await page.evaluate(() => {
  const box = document.getElementById('err');
  return box.hidden ? '' : box.textContent;
});

await page.screenshot({ path: path.join(root, 'test/out/demo.png') });
if (photo) await page.locator('#frame').screenshot({ path: path.join(root, 'test/out/on-photo.png') });
await close();

console.log('статус страницы:', status);
if (error) console.error('страница показала ошибку:', error);
for (const p of problems) console.error('проблема:', p);
if (error || problems.length) process.exitCode = 1;
else console.log('демо-страница прошла прогон');
