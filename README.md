# Радар будущего — Telegram-бот

Система раннего обнаружения технологических изменений: сбор сигналов из RSS, анализ через OpenAI, публикация в Telegram-канал. Домашняя версия с веб-панелью и управлением из Telegram.

**Радар будущего — не новостной агрегатор.** Приоритет получают первоисточники, исследования, реальные внедрения и слабые сигналы будущего — а не количество новостей.

## Концепция канала

Канал отслеживает **направление развития технологий** на разных стадиях зрелости:

| Уровень | Название | Публикация |
|---|---|---|
| 1 | Наблюдение | Архив `data/observations.json` — **не** в канал |
| 2 | Сигнал | Публикуется в канал |
| 3 | Влияние | Публикуется в канал |
| 4 | Прорыв | Публикуется в канал |
| — | Сбой системы | Публикуется в канал |

Посты основного потока — **текст + превью ссылки** (HTML). В конце — один тематический хэштег (`#AI`, `#Space`, …) для навигации по каналу (`channelHashtag.ts`). Опционально блок **«📡 Наблюдение»** — комментарий наблюдателя 2.0 (`generateObserverComment`, gpt-4o при публикации).

Для уровней **влияние** и **прорыв** при совпадении с прошлым наблюдением может добавляться блок **«📡 Сигнал подтвердился»**.

## Расписание: основной поток и рубрики

### Основной поток (RSS → очередь → канал)

При включённой **равномерной публикации** (`publishEvenSpread: true`, по умолчанию):

| Что | Настройка | По умолчанию |
|---|---|---|
| Сбор RSS, пополнение очереди | `postIntervalCron` | каждые **6 ч** (`:15`) |
| Публикация из очереди по графику | `publishIntervalCron` | каждые **2 ч** (`:05`) |
| Лимит в сутки | `maxPostsPerDay` | **18** (в `settings.json`) |
| За один тик публикации | `maxPostsPerRun` | **3** |

Cron RSS **не публикует** в канал — только наполняет очередь. Отдельный cron равномерно «размазывает» `maxPostsPerDay` постов по 24 часам.

Ручной `/run` — с публикацией, как раньше.

### Еженедельные рубрики

| Когда (локальное время ПК) | Рубрика | Источник |
|---|---|---|
| **Среда и суббота** 10:25 | 📦 **Будущее в коробке** | Отдельные RSS о гаджетах |
| **Воскресенье** 10:40 | 🔮 **GitHub-сигналы** | [GitTrend](https://github.com/zobnin8-ux/gitrend) |
| **Воскресенье** 11:20 | 🧭 **Направление недели** | Сигналы RSS за 7 дней |
| **Воскресенье** 19:00 | 🧩 **Странный GitHub недели** | GitTrend `weirdFindOfTheWeek` |

> `node-cron` — **локальное время Windows**. Задачи на **разных минутах** (`:05` publish, `:15` RSS, рубрики `:25`/`:40`/`:20`), чтобы не блокировать друг друга.

**GitHub-сигналы:** GitTrend пушит JSON **суббота 21:00 МСК** (GitHub Actions). Radar забирает **воскресенье 10:40** локально. Пустой `trends: []` — тихая неделя. **Анонс рубрики** — только в **самом первом** GitTrend-посте за всё время (пока `data/gittrend.json` → `published` пустой). Повтор недели: `/github force`; переиздание с анонсом — очистить `published` в `gittrend.json`.

**Странный GitHub:** в том же JSON поле `weirdFindOfTheWeek` (готовый `telegramPost` из GitTrend). Radar публикует **воскресенье 19:00** или `/weird`. State: `data/gittrend-weird.json`. Повтор: `/weird force`.

> **Ручной push JSON в GitTrend** (вне субботы) **не меняет расписание** — только содержимое файла на GitHub. Cron GitTrend (сб) и Radar (вс) остаются прежними; автопубликация — только по воскресному cron или командам `/github` / `/weird`.

**Направление недели:** 3 направления из RSS за 7 дней. HTML-пост: жирные заголовки, **Горизонт:** у каждого тренда, разделители `━━━━━━━━━━━━━━━━`, хэштег `#Science`. Не входит в дневной лимит.

**Будущее в коробке:** только **физические устройства** с **фото устройства** в посте. Не платформы, не партнёрства, не SaaS. Рубрики **не входят** в дневной лимит.

### Лимиты длины еженедельных рубрик (Telegram)

| Рубрика | Как уходит в канал | Лимит генерации | Лимит Telegram |
|---|---|---|---|
| 🧭 Направление недели | `sendMessage` (HTML) | цель **1500–2000** симв., макс. **4096** | **4096** |
| 🔮 GitHub-сигналы | `sendMessage` (HTML) | макс. **4096** (с анонсом в 1-м посте) | **4096** |
| 🧩 Странный GitHub | `sendMessage` (текст из GitTrend) | готовый `telegramPost` | **4096** |
| 📦 Будущее в коробке | **фото** + **отдельное** текстовое сообщение | **2500** симв. | текст до **4096** (подпись к фото — только 1024, поэтому split) |

Текстовые рубрики больше **не режутся на 1024** — это был баг лимита подписи к фото в `sendPost.ts`.

## Иерархия источников

### Уровень 1 — первоисточники (trust = 1.0)

| Группа | Источники |
|---|---|
| AI | OpenAI, Anthropic, Google DeepMind, Google AI, Google Research, Meta AI, Microsoft AI, Mistral AI, xAI, Cohere |
| Космос | NASA, ESA |
| Исследования | Nature Technology, Nature AI, MIT Research, Stanford AI Lab, Berkeley AI Research, arXiv AI, arXiv Robotics |

### Уровень 2 — отраслевые издания (trust = 0.7–0.85)

TechCrunch, The Verge, Ars Technica, MIT Technology Review, IEEE Spectrum, New Atlas, Interesting Engineering, SpaceNews, Electrek.

### Российские источники (`region: ru`)

4 источника, лимит **2 поста в день** из RU. Проверка: `/rutest`.

## Что делает бот

1. Загружает RSS за 24 ч → pre-filter → content policy → OpenAI
2. Уровень 1 → `observations.json`; 2–4 → умная очередь `news.json` (TTL, score, prune)
3. Публикация: равномерно по графику и/или при `/run`
4. **Инъекция** `/inject N` — из очереди вне дневного лимита
5. Еженедельные рубрики по cron + команды в Telegram

### Рубрика «Направление недели»

Источник: RSS-сигналы за 7 дней (`getWeeklyTrendSources`). Команда: `/trends`, cron воскресенье 11:20.

**Формат поста (HTML):**

```text
🧭 НАПРАВЛЕНИЕ НЕДЕЛИ

Заголовок недели

Введение (2–3 предложения)

1. Название тренда
Текст тренда
Горизонт: 3–7 лет

━━━━━━━━━━━━━━━━

2. …
3. …

#Science
```

Файл: `generateWeeklyTrends.ts` → `runWeeklyTrends.ts` (`parseMode: HTML`).

### Рубрика «Будущее в коробке»

Допуск: `boxCandidate` + изображение (RSS или og:image со страницы) + vision-проверка.

**Источники (приоритет):** Engadget, Tom's Guide, T3, 3DNews, Mobile-Review, Apple/Samsung/Meta и др. (`inTheBoxSources.ts`).

**Пайплайн:**

1. Pre-filter (`gadgetPrefilter.ts`) — расширенный whitelist, обход для URL с `review` / `обзор`
2. Fallback картинки (`articleImage.ts`) — og:image, twitter:image, JSON-LD, если в RSS нет фото
3. AI batch (`analyzeGadget.ts`) — главный gate: `boxCandidate`; пост генерируется с автоподстановкой полей
4. Vision (`verifyDeviceImage.ts`) перед публикацией
5. Пост (`generateInTheBoxPost.ts`) — до **2500** символов; перебор кандидатов, если первый не собрался
6. Публикация: **фото устройства** + **полный текст отдельным сообщением** (`splitPhotoAndText` в `sendPost.ts`) — обход лимита подписи 1024

**Стратегический запас** (`data/in-the-box-reserve.json`):

| Параметр | Значение |
|---|---|
| Размер | до **3** готовых постов |
| Срок | **7 дней** |
| Пополняет | **cron** (среда/суббота) — лишние прошедшие vision+текст |
| Берёт | **cron** (ср/сб) и **ручной `/box`**, если live RSS не опубликовал |

**Прочее:**

- Отклонения → `data/in-the-box-rejections.json`; статистика прогонов → `data/in-the-box-stats.json`
- Интересные **не-устройства** могут уйти в основной Radar
- `/box` → канал; ручной запуск **не блокирует** cron-слоты среды/субботы

## Быстрый старт

```bash
cd D:\radar
npm install
cp .env.example .env
# Заполните OPENAI_API_KEY, TELEGRAM_* в .env
npm run build
npm start
```

**Windows (рекомендуется):** как у Gitrend / Jarvis — ярлык в корне проекта:

```bash
npm run launcher:shortcut
```

Двойной клик **`Radar Future.lnk`** в `D:\radar`:
- иконка **радарного дисплея** (кольца, луч сканирования, цели) — `launcher/Radar.ico`
- старт **без окна терминала** (`Radar.vbs` → `launch-radar.ps1 -Silent`)
- **без залпа в канал** (`RADAR_SKIP_INITIAL_PIPELINE`)
- логи: `data/launch.log`, `data/server.log`
- остановка: **`/stop`** в Telegram (как Ctrl+C в терминале)

Опционально: `npm run launcher:build` → `launcher/Radar.exe` (pkg, без Node в PATH).

При `npm start` вручную (если не на паузе) бот может сразу опубликовать до **3** постов. Без залпа: **ярлык launcher** или `paused` → `/resume`.

## Настройка Telegram

1. [@BotFather](https://t.me/BotFather) → токен → `TELEGRAM_BOT_TOKEN`
2. Бот — админ канала с правом **Публикация сообщений**
3. `/start` в личку → `TELEGRAM_ADMIN_USER_ID`

### `.env` (основное)

```env
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNEL_ID=@your_channel
TELEGRAM_ADMIN_USER_ID=...
MAX_POSTS_PER_DAY=15
MAX_POSTS_PER_RUN=3
POST_INTERVAL_CRON=15 */6 * * *
PUBLISH_INTERVAL_CRON=5 */2 * * *
WEEKLY_TRENDS_CRON=20 11 * * 0
WEEKLY_GITTREND_CRON=40 10 * * 0
WEEKLY_WEIRD_GITHUB_CRON=0 19 * * 0
WEEKLY_IN_THE_BOX_CRON=25 10 * * 3,6
GITTREND_RADAR_URL=https://raw.githubusercontent.com/zobnin8-ux/gitrend/main/reports/weekly-radar.json
GITTREND_MAX_POSTS=3
GITTREND_MIN_SIGNAL_STRENGTH=medium
GITTREND_CATEGORY_COOLDOWN_DAYS=14
DASHBOARD_PASSWORD=...
DRY_RUN=false
```

| Переменная | Описание |
|---|---|
| `POST_INTERVAL_CRON` | Сбор RSS (при even spread — без публикации) |
| `PUBLISH_INTERVAL_CRON` | Тики публикации из очереди |
| `WEEKLY_*_CRON` | Рубрики (локальное время ПК) |
| `GITTREND_*` | URL отчёта GitTrend и фильтры трендов |

Равномерная публикация и часть лимитов — также в **веб-панели** (`data/settings.json`).

## Управление

### Веб-панель

`http://<IP-ПК>:3847` — статус, запуск, лимиты, RSS, очередь, even spread.

### Telegram-команды (личка с ботом)

При старте бота и по `/help` / `/commands` приходит полный список.

| Команда | Действие |
|---|---|
| `/status` | Статус, график публикаций |
| `/run` | Пайплайн + публикация |
| `/dry` | Тест без канала |
| `/inject 5` | Инъекция из очереди (до 10) |
| `/pause` / `/resume` | Пауза cron (процесс живёт) |
| `/stop` | Полная остановка бота (для ярлыка без терминала) |
| `/today` | Посты за сегодня |
| `/panel` | Адрес панели |
| `/trends` | Направление недели (развёрнутая сводка 3 направлений) |
| `/github` | GitHub-сигналы; `/github force` — повтор недели (без анонса, если уже есть записи в `gittrend.json`) |
| `/weird` | Странный GitHub недели; `/weird force` — повтор |
| `/box` | Будущее в коробке → **канал** (live RSS → запас) |
| `/boxstats` | Статистика последних прогонов `/box` |
| `/boxreserve` | Запас рубрики (до 3 постов) |
| `/queue` | Очередь публикаций |
| `/queue-prune` | Очистка очереди |
| `/source-stats` | Статистика источников |
| `/observer-queue` | Наблюдатель 2.0 для очереди |
| `/rutest` | Тест RU RSS |
| `/help`, `/commands` | Список команд |

### Превью GitTrend (только вам, не в канал)

```bash
npx tsx scripts/preview-gittrend-admin.ts
```

Не трогает `data/gittrend.json` и не помечает неделю обработанной.

## Типичная неделя

1. Пн–вс: RSS каждые 6 ч → очередь; публикация каждые 2 ч по графику
2. **Среда и суббота 10:25:** «Будущее в коробке»
3. **Суббота 21:00 МСК:** GitTrend пушит `weekly-radar.json`
4. **Воскресенье 10:40:** GitHub-сигналы; **11:20** — «Направление недели»; **19:00** — странный GitHub
5. Вручную: `/run`, `/inject`, `/box`, `/github`, `/weird`; остановка: `/stop`

## Структура проекта

```text
src/
  pipeline/       runPipeline, runPublishTick, scheduler, рубрики
  gittrend/       fetch/validate/select GitTrend JSON, buildWeirdGitHubPost
  ai/             analyzeNews, generateTelegramPost, analyzeGadget,
                  verifyDeviceImage, enrichGitTrend, generateObserverComment
  rss/            fetchNews, inTheBoxSources
  telegram/       канал + admin-команды (sendPost: 4096 текст, split фото/текст)
  dashboard/      веб-панель
  storage/        news, published, observations, gittrend, gittrend-weird, inTheBox, inTheBoxReserve, settings
  utils/          queueScore, evenPublish, gadgetPrefilter, deviceImage, articleImage, boxRunReport, channelHashtag, cronSchedule
scripts/
  preview-gittrend-admin.ts   превью GitTrend в личку
launcher/
  Radar.vbs                   скрытый старт
  create-shortcut.ps1         Radar Future.lnk + Radar.ico (PPI radar)
  launch.cjs                  опционально → Radar.exe (pkg)
launch-radar.ps1              build, hidden npm start, health :3847
data/
  news.json                   очередь
  observations.json           уровень 1
  published.json              история канала
  gittrend.json               state GitHub-трендов
  gittrend-weird.json         state «Странный GitHub недели»
  in-the-box.json             опубликованные гаджеты
  in-the-box-rejections.json  архив отклонённых кандидатов
  in-the-box-reserve.json     запас готовых постов (макс. 3, 7 дней)
  in-the-box-stats.json       статистика прогонов /box
  settings.json               лимиты, RSS, even spread
docs/Радар будущего.md        заметка Obsidian
RADAR-SCHEDULE-UPDATE.md      расписание GitTrend ↔ Radar
```

## Команды npm

| Команда | Описание |
|---|---|
| `npm start` | Запуск (бот + панель + Telegram) |
| `npm run build` | Сборка TypeScript |
| `npm run dry` | `DRY_RUN=true` |
| `npm run observer:queue` | Наблюдатель для очереди |
| `npm run test:ru-sources` | Отчёт RU RSS в Telegram |
| `npm run launcher:shortcut` | `Radar Future.lnk` в корне + иконка радара |
| `npm run launcher:build` | Собрать `launcher/Radar.exe` (pkg) |
| `npm run launcher:setup` | То же, что `launcher:shortcut` |
| `npm run desktop` | Алиас → `launcher:shortcut` |

## Ограничения домашней версии

- ПК включён, бот запущен (`npm start`)
- Cron — локальное время Windows
- Telegram-команды работают, если бот онлайн
