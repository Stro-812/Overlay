#!/usr/bin/env node
/**
 * Отдаёт демо-страницу по http: модули по file:// браузер не грузит.
 *
 *   npm run demo   →  http://127.0.0.1:4173
 *
 * Прогоны этим сервером не пользуются — они перехватывают запросы сами
 * (test/browser.mjs), чтобы не занимать порт.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const rel = pathname === '/' ? '/demo/index.html' : pathname;
  const file = path.join(root, path.normalize(rel));

  if (!file.startsWith(root)) {
    res.writeHead(403).end('нельзя выше корня проекта');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('нет такого файла');
  }
});

// подряд запущенные сессии спотыкались о занятый порт — берём следующий
function listen(port, left = 10) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && left > 0) {
      console.log(`порт ${port} занят, пробую ${port + 1}`);
      listen(port + 1, left - 1);
    } else throw e;
  });
  server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
}
listen(Number(process.env.PORT) || 4173);
