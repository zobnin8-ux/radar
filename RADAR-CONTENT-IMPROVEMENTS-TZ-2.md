# ТЗ-2: оживление ленты канала «Радар будущего»

Продолжение `RADAR-CONTENT-IMPROVEMENTS-TZ.md`. Статус: **реализовано** в коде.

## Правки

1. **Наблюдатель** — запрет зачинов «Представьте/Кажется…», чередование риторических ходов, фильтр `CLICHE_PATTERNS` по началу строки.
2. **Частота наблюдателя** — `OBSERVER_SIGNAL_RATE` (default 0.45); impact/breakthrough/failure — всегда.
3. **Переменная форма поста** — `selectLayout`: compact для signal без «Что произошло», full для остальных.
4. **Заголовки EN** — радарный угол (сдвиг/следствие) в `SYSTEM_PROMPT`; RU без изменений.
5. **Калибровка уровней** — уточнённые критерии signal/impact/breakthrough в `analyzeNews.ts`.
6. **Температура** — `OPENAI_POST_TEMPERATURE` (default 0.55).

## Env

```env
OBSERVER_SIGNAL_RATE=0.45
OPENAI_POST_TEMPERATURE=0.55
```
