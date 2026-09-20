
/* ================================================================== страница */

const TRACK_SLIDERS = [
  ['#', 'Маршрут', 'b'],
  ['track.x', 'слева', 0, 1, 0.005],
  ['track.y', 'сверху', 0, 1, 0.005],
  ['track.size', 'размер', 0.1, 1, 0.005],
  ['track.rotate', 'поворот', 0, 360, 1, '°'],
  ['track.weight', 'толщина линии', 0.002, 0.03, 0.001],
];

const SLIDERS = {
  stats: [
    ['#', 'Цифры', 'a'],
    ['stats.x', 'слева', 0, 1, 0.005],
    ['stats.y', 'сверху', 0, 1, 0.005],
    ['stats.scale', 'кегль', 0.04, 0.2, 0.002],
    ['stats.gap', 'шаг строк', 1, 2, 0.01],
    ...TRACK_SLIDERS,
  ],
  intervals: [
    ['#', 'Интервалы', 'a'],
    ['intervals.x', 'слева', 0, 1, 0.005],
    ['intervals.y', 'сверху', 0, 1, 0.005],
    ['intervals.scale', 'кегль', 0.03, 0.12, 0.002],
    ['intervals.rowGap', 'шаг строк', 0, 1.2, 0.02],
    ...TRACK_SLIDERS,
  ],
};

const LOGO_SLIDERS = [
  ['logo.size', 'размер', 0.05, 0.4, 0.005],
  ['logo.x', 'слева', 0, 1, 0.01],
  ['logo.y', 'сверху', 0, 1, 0.01],
];

/** Предел стороны предпросмотра. Телефонный снимок — это восемнадцать
 *  миллионов точек; перерисовывать их на каждое движение ползунка незачем,
 *  раз вся раскладка задана в долях ширины и от разрешения не зависит.
 *  В файл картинка уходит в полном размере. */
const PREVIEW_MAX = 1400;

const $ = (id) => document.getElementById(id);
const at = (obj, key) => key.split('.').reduce((o, k) => o[k], obj);
const setAt = (obj, key, v) => {
  const parts = key.split('.');
  parts.slice(0, -1).reduce((o, k) => o[k], obj)[parts.at(-1)] = v;
};
/** Доли показываем с точностью до тысячных, градусы — целыми. */
const show = (value, unit) => (unit ? Math.round(value) + unit : (+value).toFixed(3));

const state = {
  track: SAMPLE_TRACK,
  stats: SAMPLE_STATS,
  intervals: SAMPLE_INTERVALS,
  photo: null,
  // раскладка при открытии: у DEFAULTS трек шире и наезжает на подписи единиц
  opts: Object.assign(structuredClone(DEFAULTS), {
    stats: { x: 0.055, y: 0.08, scale: 0.085, gap: 1.34 },
    track: { ...DEFAULTS.track, x: 0.56, y: 0.33, size: 0.4 },
  }),
};

/* ---------- сохранение файлов ---------- */

// песочница не даёт странице скачивать файлы сама — только через платформу,
// и та спрашивает согласие у того, кто смотрит
const downloads = (window.claude?.use ? window.claude.use('downloads') : Promise.resolve(null))
  .catch(() => null);

let canSave = true;
downloads.then((api) => {
  canSave = Boolean(api);
  if (!canSave) {
    $('save').disabled = true;
    $('ready').disabled = true;
    $('ready').textContent = 'Скачивание здесь недоступно';
    $('hint').innerHTML = 'Эта страница не может отдавать файлы: '
      + 'откройте её в приложении Claude или запустите демо у себя '
      + '(<code>npm run demo</code>). Предпросмотр работает как обычно.';
    $('hint').classList.add('warn');
  }
});

async function offer(blob, filename) {
  const api = await downloads;
  if (!api) return;
  try {
    await api.save({ filename, data: blob });
  } catch (e) {
    // отказ смотрящего — обычный ход событий, ругаться не на что
    if (e?.code !== 'declined') showError(`Не удалось сохранить: ${e?.message ?? e}`);
  }
}

/* ---------- ползунки ---------- */

function buildSliders(list, box) {
  box.replaceChildren();
  for (const [key, title, min, max, step, unit] of list) {
    if (key === '#') {
      const head = document.createElement('p');
      head.className = `group ${min}`;
      head.textContent = title;
      box.append(head);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'slider';
    const id = 'sl-' + key.replace('.', '-');
    row.innerHTML = `<label for="${id}">${title}</label><div class="line">`
      + `<input id="${id}" type="range" min="${min}" max="${max}" step="${step}">`
      + '<output></output></div>';
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.value = at(state.opts, key);
    out.textContent = show(input.value, unit);
    input.addEventListener('input', () => {
      setAt(state.opts, key, +input.value);
      out.textContent = show(input.value, unit);
      draw();
    });
    box.append(row);
  }
}

for (const id of ['color', 'accent']) {
  $(id).addEventListener('input', () => {
    state.opts[id] = $(id).value;
    draw();
  });
}

/* ---------- знак и безопасная зона ---------- */

$('showSafe').addEventListener('change', () => {
  $('safe').hidden = !$('showSafe').checked;
});
for (const [side, v] of Object.entries(SAFE)) {
  $('safe').style.setProperty(`--safe-${side}`, `${v * 100}%`);
}

/* ---------- какой JSON рисовать ---------- */

function mode() {
  // два JSON — по умолчанию интервалы: ради них второй файл и присылают
  return state.opts.mode ?? (state.intervals ? 'intervals' : 'stats');
}

function syncMode() {
  const both = Boolean(state.intervals);
  $('switch').hidden = !both;
  const active = mode();
  for (const button of $('switch').querySelectorAll('button')) {
    button.classList.toggle('on', button.dataset.mode === active);
  }
  $('rowsBlock').hidden = active === 'intervals';
  buildSliders(SLIDERS[active], $('sliders'));
}

for (const button of $('switch').querySelectorAll('button')) {
  button.addEventListener('click', () => {
    state.opts.mode = button.dataset.mode;
    syncMode();
    draw();
  });
}

/* ---------- файлы ---------- */

function showError(text) {
  $('err').hidden = !text;
  $('err').textContent = text ?? '';
}

async function take(kind, file) {
  const label = document.querySelector(`[data-kind="${kind}"]`);
  try {
    if (kind === 'photo') {
      if (state.photo) URL.revokeObjectURL(state.photo);
      state.photo = URL.createObjectURL(file);
      // PNG делаем ровно под фотографию: тогда его кладут поверх без подгонки
      const size = await new Promise((done, fail) => {
        const img = new Image();
        img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => fail(new Error('не похоже на картинку'));
        img.src = state.photo;
      });
      Object.assign(state.opts, size);
    } else {
      const parsed = JSON.parse(await file.text());
      if (kind === 'stats' && !Array.isArray(parsed) && !Array.isArray(parsed.rows)) {
        throw new Error('в цифрах нет массива rows');
      }
      if (kind === 'intervals' && !columnsOf(parsed).length) {
        throw new Error('в интервалах нет колонок с данными');
      }
      if (kind === 'track' && !readPoints(parsed).length) {
        throw new Error('не нашёл координат');
      }
      state[kind] = parsed;
      if (kind === 'stats') renderRows();
      if (kind === 'intervals') {
        state.opts.mode = null;   // появились интервалы — показываем их
        syncMode();
      }
    }
    label.classList.add('ok');
    label.querySelector('.what').textContent = file.name;
    showError('');
  } catch (e) {
    label.classList.remove('ok');
    showError(`${file.name}: ${e.message}`);
  }
  draw();
}

for (const input of document.querySelectorAll('.drop input')) {
  input.addEventListener('change', () => {
    if (input.files[0]) take(input.closest('.drop').dataset.kind, input.files[0]);
  });
}
for (const label of document.querySelectorAll('.drop')) {
  label.addEventListener('dragover', (e) => {
    e.preventDefault();
    label.classList.add('over');
  });
  label.addEventListener('dragleave', () => label.classList.remove('over'));
  label.addEventListener('drop', (e) => {
    e.preventDefault();
    label.classList.remove('over');
    if (e.dataTransfer.files[0]) take(label.dataset.kind, e.dataTransfer.files[0]);
  });
}

/* ---------- какие строки рисовать ---------- */

function renderRows() {
  const box = $('rows');
  const rows = Array.isArray(state.stats) ? state.stats : state.stats?.rows ?? [];
  box.replaceChildren();
  if (!rows.length) {
    const none = document.createElement('p');
    none.className = 'none';
    none.textContent = 'Загрузите цифры забега.';
    box.append(none);
    return;
  }
  rows.forEach((row) => {
    const label = document.createElement('label');
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = row.show !== false;
    // строке без значения рисоваться нечем — не делаем вид, что её можно включить
    tick.disabled = row.value == null || row.value === '';
    const text = document.createElement('span');
    text.textContent = tick.disabled
      ? `${row.icon ?? 'строка'} — пусто`
      : `${row.value}${row.unit ? ' ' + row.unit : ''}`;
    label.classList.toggle('off', !tick.checked);
    label.append(tick, text);
    tick.addEventListener('change', () => {
      row.show = tick.checked;
      label.classList.toggle('off', !tick.checked);
      draw();
    });
    box.append(label);
  });
}

/* ---------- отрисовка ---------- */

let pending = null;

function draw() {
  $('frame').classList.toggle('on-photo', Boolean(state.photo));

  // правка ползунка идёт потоком — рисуем по кадру, а не по каждому событию
  if (pending) return;
  pending = requestAnimationFrame(async () => {
    pending = null;
    try {
      // со снимком рисуем ровно то, что уйдёт в файл: иначе знак не сможет
      // подобрать себе цвет по фотографии, которой на канве нет
      const preview = previewOpts();
      if (state.photo) await composeToCanvas(data(), preview, $('canvas'));
      else await renderToCanvas(data(), preview, $('canvas'));
      // в подписи показываем размер будущего файла, а не уменьшенного предпросмотра
      const { width, height } = state.opts;
      // поле подстраивается под пропорции того, что нарисовано: точная дробь
      // для aspect-ratio и число — для расчёта ширины по пределу высоты
      $('frame').style.setProperty('--ar', `${width} / ${height}`);
      $('frame').style.setProperty('--arn', (width / height).toFixed(6));
      $('size').textContent = `${width} × ${height}`;
      $('what').textContent = (mode() === 'intervals' ? 'интервалы' : 'цифры')
        + (state.track ? ' и трек' : ', трека нет');
      if (canSave) {
        $('ready').disabled = !state.photo;
        $('ready').textContent = state.photo
          ? 'Скачать готовую картинку'
          : 'Загрузите фотографию';
      }
    } catch (e) {
      showError(String(e?.message ?? e));
    }
  });
}

/* ---------- кнопки ---------- */

const data = () => ({
  track: state.track,
  stats: state.stats,
  intervals: state.intervals,
  photo: state.photo,
});

/** Те же настройки, но в размере, который не жалко перерисовывать. */
function previewOpts() {
  const { width, height } = state.opts;
  const k = Math.min(1, PREVIEW_MAX / Math.max(width, height));
  if (k === 1) return state.opts;
  return { ...state.opts, width: Math.round(width * k), height: Math.round(height * k) };
}

$('save').addEventListener('click', async () => {
  offer(await renderOverlay(data(), state.opts), 'overlay.png');
});

$('ready').addEventListener('click', async () => {
  offer(await renderComposite(data(), state.opts), 'zabeg.jpg');
});

buildSliders(LOGO_SLIDERS, $('logoSliders'));
syncMode();
renderRows();
draw();
