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

Посты — **текст + превью ссылки** (HTML). Опционально блок **«📡 Наблюдение»** — живой комментарий наблюдателя (`observerComment`), если он не банальный и не повторяет текст поста.

Для уровней **влияние** и **прорыв** при совпадении с прошлым наблюдением может добавляться блок **«📡 Сигнал подтвердился»**.

## Еженедельные рубрики

| Когда (UTC) | Рубрика | Источник |
|---|---|---|
| Суббота 10:00 | 📦 **Будущее в коробке** | Отдельные RSS о гаджетах |
| Воскресенье 11:00 | 🧭 **Направление недели** | Сигналы RSS за 7 дней |
| Воскресенье 11:30 | 🔮 **GitHub-сигналы** | [GitTrend](https://github.com/zobnin8-ux/gitrend) — мониторинг трендов на GitHub |

**GitHub-сигналы** — не топ репозиториев, а устойчивые направления (несколько проектов в одной категории растут одновременно). Радар добавляет интерпретацию «почему это может быть важно для будущего». Первый пост серии содержит анонс рубрики. Публикаций может быть 0–3 за неделю.

Рубрики **не входят** в дневной лимит постов.

## Иерархия источников

### Уровень 1 — первоисточники (trust = 1.0)

| Группа | Источники |
|---|---|
| AI | OpenAI, Anthropic, Google DeepMind, Google AI, Google Research, Meta AI, Microsoft AI, Mistral AI, xAI, Cohere |
| Космос | NASA, ESA (SpaceX и Rocket Lab не имеют публичного RSS — через SpaceNews) |
| Исследования | Nature Technology, Nature AI, MIT Research, Stanford AI Lab, Berkeley AI Research, arXiv AI, arXiv Robotics |

### Уровень 2 — отраслевые издания (trust = 0.7–0.85)

| Группа | Источники |
|---|---|
| Технологии | TechCrunch (0.8), The Verge (0.8), Ars Technica (0.8), MIT Technology Review (0.85), IEEE Spectrum (0.85), New Atlas (0.7), Interesting Engineering (0.75) |
| Космос | SpaceNews (0.85) |
| Энергетика | Electrek (0.8) |

### Российские источники — дополнительный контур (`region: ru`, `language: ru`)

После RSS-теста оставлены **4 источника**. Они не формируют основную повестку: лимит **2 поста в день** из RU-источников. Основа канала — международные исследования, AI-компании, космические агентства и tier-1 первоисточники.

| Приоритет | Источник | trust | Назначение |
|---|---|---:|---|
| Высокий | N+1 | 0.85 | Космос, AI, робототехника, наука, инженерия |
| Средний | 3DNews | 0.75 | Полупроводники, AI-железо, гаджеты; также «Будущее в коробке» |
| Средний | Naked Science | 0.75 | Исследования, космос, биотех (без рубрики «Оружие и техника») |
| Тестовый | Хайтек | 0.60 | AI, роботы, медицина, энергетика — оценка качества |

**Исключены после теста:** Хабр, CNews, TAdviser, Indicator.ru, Элементы, Наука.рф, а также РИА, ТАСС, РБК и прочие общеновостные СМИ.

**Язык публикации:** `language: ru` → без перевода: заголовок, описание, AI-анализ и пост на русском.

При равной важности предпочтение — первоисточнику. Вес: `уровень + score × trust × горизонт`.

Список источников обновляется при запуске бота (сохраняется только `enabled` для каждого).

**Без официального RSS:** Anthropic, Meta AI, Mistral, xAI, Cohere — через [Olshansk/rss-feeds](https://github.com/Olshansk/rss-feeds). Nature требует браузерный User-Agent — настроен в боте.

## Что делает бот

1. Загружает новости из RSS за последние 24 часа (tier 1, затем tier 2)
2. Pre-filter отсекает шум **до** OpenAI
3. AI оценивает: уровень, score, категорию, горизонт, `observerComment`, `technology`
4. Уровень 1 → `data/observations.json`
5. Уровень 2–4 + сбои → очередь `data/news.json` → публикация (до 3 за запуск, лимит в день — в настройках)
6. Квоты категорий, микс горизонтов, минимум AI-постов в день
7. **Инъекция** `/inject N` — публикация из очереди вне дневного лимита

### Категории

`ai`, `robotics`, `space`, `aviation`, `energy`, `transport`, `biotech`, `engineering`, `science`, `materials`, `climate`, `defense-tech`, `semiconductors`, `startups`, `other`

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

### 1. Создать бота через BotFather

1. [@BotFather](https://t.me/BotFather) → `/newbot`
2. Токен → `TELEGRAM_BOT_TOKEN`

### 2. Добавить бота админом в канал

1. Канал → Администраторы → добавить бота
2. Включите **Публикация сообщений**
3. ID канала: `@username` или `-100...`

### 3. Узнать свой Telegram ID

1. Напишите боту `/start` в личку
2. Добавьте в `.env`: `TELEGRAM_ADMIN_USER_ID=...`

### 4. Заполнить `.env`

```env
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNEL_ID=@your_channel
TELEGRAM_ADMIN_USER_ID=...
MAX_POSTS_PER_DAY=15
MAX_POSTS_PER_RUN=3
POST_INTERVAL_CRON=0 */6 * * *
WEEKLY_TRENDS_CRON=0 11 * * 0
WEEKLY_GITTREND_CRON=30 11 * * 0
WEEKLY_IN_THE_BOX_CRON=0 10 * * 6
GITTREND_RADAR_URL=https://raw.githubusercontent.com/zobnin8-ux/gitrend/main/reports/weekly-radar.json
GITTREND_MAX_POSTS=3
GITTREND_MIN_SIGNAL_STRENGTH=medium
GITTREND_CATEGORY_COOLDOWN_DAYS=14
DASHBOARD_PASSWORD=...
DRY_RUN=false
```

| Переменная | Описание |
|---|---|
| `OPENAI_API_KEY` | Ключ OpenAI (обязателен) |
| `TELEGRAM_BOT_TOKEN` | Токен бота |
| `TELEGRAM_CHANNEL_ID` | Канал для публикации |
| `TELEGRAM_ADMIN_USER_ID` | Ваш Telegram ID для команд |
| `WEEKLY_*_CRON` | Расписание рубрик (node-cron, локальное время ПК) |
| `GITTREND_*` | Интеграция с GitTrend |
| `DASHBOARD_PASSWORD` | Пароль веб-панели |
| `DRY_RUN` | Тест без отправки в канал |

> Cron в `node-cron` использует **локальное время Windows**, не UTC. Пересчитайте при необходимости.

## Управление

### Запуск

```bash
npm start
```

### Веб-панель

`http://<IP-ПК>:3847` — пароль из `DASHBOARD_PASSWORD`. Статус, запуск, лимиты, cron, RSS, очередь, логи.

### Telegram-команды (личка с ботом)

| Команда | Действие |
|---|---|
| `/status` | Статус бота |
| `/run` | Запустить публикацию сейчас |
| `/inject 5` | Инъекция из очереди (вне лимита, до 10) |
| `/dry` | Тест без публикации |
| `/pause` / `/resume` | Пауза / возобновить cron |
| `/today` | Посты за сегодня |
| `/panel` | Адрес панели |
| `/trends` | Направление недели (RSS) |
| `/github` | GitHub-сигналы (GitTrend); `/github force` — повтор недели |
| `/box` | Будущее в коробке |
| `/help` | Справка |

## Типичный сценарий

1. Включили ПК → `npm start` (или ярлык «Радар будущего»)
2. Каждые 6 ч: очередь → RSS → AI → публикация
3. Суббота: рубрика «Будущее в коробке»
4. Воскресенье: «Направление недели» + «GitHub-сигналы»
5. Вручную: `/run`, `/inject`, `/trends`, `/github`, `/box`

## Структура проекта

```text
src/
  index.ts              — запуск
  pipeline/             — runPipeline, scheduler, рубрики, инъекция
  gittrend/             — fetch/validate GitTrend JSON
  ai/                   — analyzeNews, generateTelegramPost, enrichGitTrend, backfillObserver
  content/              — анонс рубрики GitHub
  rss/                  — fetchNews, inTheBoxSources
  telegram/             — канал + admin-команды
  dashboard/            — веб-панель
  storage/              — news, published, observations, gittrend, settings, state
  utils/                — prefilter, квоты, observerComment, observationMatch
public/index.html       — интерфейс панели
data/
  news.json             — очередь публикации
  observations.json     — архив наблюдений (уровень 1)
  published.json        — история канала
  gittrend.json         — state GitHub-рубрики
  in-the-box.json       — история рубрики гаджетов
  trends.json           — история «Направление недели»
  settings.json         — лимиты, RSS, пауза
  state.json            — статус, логи
docs/Радар будущего.md  — заметка Obsidian
RADAR-FUTURE-INTEGRATION-TZ.md — ТЗ интеграции GitTrend
```

## Команды npm

| Команда | Описание |
|---|---|
| `npm start` | Запуск (бот + панель + Telegram) |
| `npm run dev` | Разработка |
| `npm run build` | Сборка |
| `npm run dry` | Тест без Telegram |
| `npm run desktop` | Ярлык на рабочем столе |
| `npm run backfill:observer` | Добавить наблюдателя в очередь без переанализа |
| `npm run backfill:observer:dry` | То же, без записи |

## Ярлык на рабочем столе

```cmd
cd D:\radar
npm run desktop
```

## Ограничения домашней версии

- ПК должен быть включён и бот запущен
- Панель — только в домашней Wi‑Fi
- Telegram-команды работают откуда угодно, если ПК онлайн
- Лимиты настраиваются в панели (`maxPostsPerDay`, `maxPostsPerRun`)
