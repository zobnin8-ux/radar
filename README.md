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
| Лимит в сутки | `maxPostsPerDay` | **15** |
| За один тик публикации | `maxPostsPerRun` | **3** |

Cron RSS **не публикует** в канал — только наполняет очередь. Отдельный cron равномерно «размазывает» `maxPostsPerDay` постов по 24 часам.

Ручной `/run` — с публикацией, как раньше.

### Еженедельные рубрики

| Когда (локальное время ПК) | Рубрика | Источник |
|---|---|---|
| **Среда и суббота** 10:25 | 📦 **Будущее в коробке** | Отдельные RSS о гаджетах |
| **Воскресенье** 11:20 | 🧭 **Направление недели** | Сигналы RSS за 7 дней |
| **Воскресенье** 10:40 | 🔮 **GitHub-сигналы** | [GitTrend](https://github.com/zobnin8-ux/gitrend) |

> `node-cron` — **локальное время Windows**. Задачи на **разных минутах** (`:05` publish, `:15` RSS, рубрики `:25`/`:40`/`:20`), чтобы не блокировать друг друга.

**GitHub-сигналы:** GitTrend пушит JSON **суббота 21:00 МСК**. Radar забирает **воскресенье 10:40** локально. Пустой `trends: []` — тихая неделя. `/github force` — повтор.

**Будущее в коробке:** только **физические устройства** с **фото устройства** в посте (`sendPhoto`). Не платформы, не партнёрства, не SaaS. Рубрики **не входят** в дневной лимит.

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

### Рубрика «Будущее в коробке»

Допуск: `boxCandidate` + изображение (RSS или og:image со страницы) + vision-проверка.

**Источники (приоритет):** Engadget, Tom's Guide, T3, 3DNews, Mobile-Review, Apple/Samsung/Meta и др. (`inTheBoxSources.ts`).

**Пайплайн:**

1. Pre-filter (`gadgetPrefilter.ts`) — расширенный whitelist, обход для URL с `review` / `обзор`
2. Fallback картинки (`articleImage.ts`) — og:image, twitter:image, JSON-LD, если в RSS нет фото
3. AI batch (`analyzeGadget.ts`) — главный gate: `boxCandidate`; пост генерируется с автоподстановкой полей
4. Vision (`verifyDeviceImage.ts`) перед публикацией
5. Пост (`generateInTheBoxPost.ts`) — обрезка до лимита Telegram; перебор кандидатов, если первый не собрался
6. Публикация: **фото устройства + подпись** (`sendPhoto`)

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
| `/pause` / `/resume` | Пауза cron |
| `/today` | Посты за сегодня |
| `/panel` | Адрес панели |
| `/trends` | Направление недели |
| `/github` | GitHub-сигналы; `/github force` — повтор недели |
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

1. Пн–вс: RSS каждые 6 ч → очередь; публикация каждые 30 мин по графику
2. **Среда и суббота 10:25:** «Будущее в коробке»
3. **Воскресенье 10:40:** GitHub-сигналы; **11:20** — «Направление недели»
4. Вручную: `/run`, `/inject`, `/box`, `/github`

## Структура проекта

```text
src/
  pipeline/       runPipeline, runPublishTick, scheduler, рубрики
  gittrend/       fetch/validate/select GitTrend JSON
  ai/             analyzeNews, generateTelegramPost, analyzeGadget,
                  verifyDeviceImage, enrichGitTrend, generateObserverComment
  rss/            fetchNews, inTheBoxSources
  telegram/       канал + admin-команды
  dashboard/      веб-панель
  storage/        news, published, observations, gittrend, inTheBox, inTheBoxReserve, settings
  utils/          queueScore, evenPublish, gadgetPrefilter, deviceImage, articleImage, boxRunReport, channelHashtag, cronSchedule
scripts/
  preview-gittrend-admin.ts   превью GitTrend в личку
data/
  news.json                   очередь
  observations.json           уровень 1
  published.json              история канала
  gittrend.json               state GitHub-рубрики
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
| `npm run desktop` | Ярлык на рабочем столе |

## Ограничения домашней версии

- ПК включён, бот запущен (`npm start`)
- Cron — локальное время Windows
- Telegram-команды работают, если бот онлайн
