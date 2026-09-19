#!/usr/bin/env node
/** Лист иконок крупно — чтобы править контуры глазами. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { open } from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
await mkdir(path.join(root, 'test/out'), { recursive: true });

const { page, close } = await open(root);

const png = await page.evaluate(async () => {
  const { ICONS, drawIcon } = await import('/src/icons.js');
  const names = Object.keys(ICONS);
  const cell = 220, pad = 20;
  const canvas = document.createElement('canvas');
  canvas.width = cell * names.length;
  canvas.height = cell + 40;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  names.forEach((name, i) => {
    const x = i * cell + pad;
    ctx.strokeStyle = '#e4e7ee';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, pad, cell - pad * 2, cell - pad * 2);   // рамка 32×32
    drawIcon(ctx, name, x, pad, cell - pad * 2, { color: '#1b3a93', width: 13 });
    ctx.fillStyle = '#64708a';
    ctx.font = '16px sans-serif';
    ctx.fillText(name, x, cell + 20);
  });
  return canvas.toDataURL('image/png').split(',')[1];
});

await writeFile(path.join(root, 'test/out/icons.png'), Buffer.from(png, 'base64'));
await close();
console.log('test/out/icons.png');
