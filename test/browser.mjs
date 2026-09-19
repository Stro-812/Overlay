/**
 * Общая обвязка прогонов: браузер, в котором файлы проекта отдаются по
 * настоящему http-адресу.
 *
 * Отдельный сервер не поднимаем нарочно — он занимает порт, а прогоны
 * случается запускать подряд, и второй падал на «адрес уже занят».
 * Перехват запросов делает то же самое и ничего не занимает.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** @returns {{ browser, page, problems: string[], close: () => Promise<void> }} */
export async function open(root, { entry = null, viewport } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage(viewport ? { viewport } : {});

  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'overlay.test') return route.continue();

    const rel = url.pathname === '/' ? entry : url.pathname.slice(1);
    if (!rel) {
      return route.fulfill({ contentType: TYPES['.html'], body: '<!doctype html><meta charset="utf-8"><body>' });
    }
    try {
      return route.fulfill({
        contentType: TYPES[path.extname(rel)] ?? 'application/octet-stream',
        body: await readFile(path.join(root, rel)),
      });
    } catch {
      return route.fulfill({ status: 404, body: 'нет такого файла' });
    }
  });

  await page.goto('http://overlay.test/');
  return { browser, page, problems, close: () => browser.close() };
}
