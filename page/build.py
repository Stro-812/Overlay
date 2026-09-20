#!/usr/bin/env python3
"""Собирает страницу подбора в один файл.

    python3 page/build.py        →  page/out/overlay-demo.html

Публикуется этот файл как артефакт Claude; он же открывается локально.
Модули из src/ вшиваются в один <script type="module">, потому что
артефакт — это одна страница без сети: импортов между файлами там нет.

Отсюда же и проверки: в общей области видимости два одинаковых имени из
разных файлов — это не «затенение», а SyntaxError на весь скрипт, и
страница не заводится вовсе. Поэтому сборка падает на совпадении имён
раньше, чем страница уедет в браузер.
"""
import re, pathlib, collections, sys

root = pathlib.Path(__file__).resolve().parent.parent
page = root / 'page'
out = page / 'out'
FILES = ['src/track.js', 'src/icons.js', 'src/intervals.js', 'src/logo.js', 'src/overlay.js']


def strip(text):
    """Убирает импорты и export — внутри одного скрипта они не нужны."""
    text = re.sub(r"^import .*?;\n", "", text, flags=re.M)
    return re.sub(r"^export (const|function|async function) ", r"\1 ", text, flags=re.M).strip()


sources = {f: (root / f).read_text(encoding='utf-8') for f in FILES}
sources['controller'] = (page / 'controller.js').read_text(encoding='utf-8')

seen = collections.defaultdict(list)
for name, text in sources.items():
    for m in re.finditer(r'^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)', text, re.M):
        seen[m.group(1)].append(name)
dupes = {k: v for k, v in seen.items() if len(v) > 1}
if dupes:
    sys.exit(f'столкновение имён при вшивании: {dupes}')

fixtures = root / 'test/fixtures'
parts = ['<script type="module">',
         '/* Код рендера — копия src/ из github.com/Stro-812/Overlay, один в один,',
         '   только вшитая в страницу: импортов между файлами здесь нет. */\n',
         f"const SAMPLE_TRACK = {(page / 'sample-coords.json').read_text()};",
         f"const SAMPLE_STATS = {(fixtures / 'stats.json').read_text(encoding='utf-8').strip()};",
         f"const SAMPLE_INTERVALS = {(fixtures / 'intervals.json').read_text(encoding='utf-8').strip()};\n"]
for f in FILES:
    parts += [strip(sources[f]), '']
parts += [sources['controller'], '</script>']

html = (page / 'shell.html').read_text(encoding='utf-8') + "\n" + "\n".join(parts) + "\n"

# закрывающий тег внутри строки оборвал бы скрипт посреди кода
script = html.split('<script type="module">', 1)[1]
if '</script' in script[:-12]:
    sys.exit('внутри скрипта встретился закрывающий тег')

out.mkdir(exist_ok=True)
(out / 'overlay-demo.html').write_text(html, encoding='utf-8')
(out / 'preview.html').write_text(
    '<!doctype html><html><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui;background:#fafaf9}'
    'img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + html + '</body></html>',
    encoding='utf-8')
print(f'собрано: {len(html) // 1024} КБ, столкновений нет')
