# Notification Preferences Service

## Что это

Сервис управления предпочтениями уведомлений.

Сервис не отправляет уведомления сам — он является единым источником правды для других компонентов платформы. Его задача — ответить на вопрос:

> Можно ли отправить пользователю уведомление определённого типа по определённому каналу прямо сейчас?

Другие сервисы-отправители обращаются к `POST /evaluate` перед каждой отправкой и получают решение `allow` или `deny` с объяснением причины.

## Возможности

- Хранение дефолтных предпочтений для всех типов и каналов
- Хранение пользовательских override-настроек поверх дефолтов
- Настройка quiet hours с учётом IANA-таймзоны пользователя
- Глобальные deny-политики по типу уведомления, каналу и региону
- Evaluate endpoint — принятие решения allow/deny с указанием причины
- Идемпотентное обновление настроек через upsert

---

## Запуск локально

### Требования

- Node.js 18+
- npm 9+
- Docker и Docker Compose (для PostgreSQL)

### 1. Переменные окружения

```bash
cp .env.example .env
```

`.env.example` содержит:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/notification_preferences"
PORT=3000
NODE_ENV=development
```

Для локального запуска менять ничего не нужно — значения соответствуют `docker-compose.yml`.

### 2. Установка зависимостей

```bash
npm install
```

### 3. Запуск PostgreSQL

```bash
docker compose up -d
```

Поднимает PostgreSQL 16 на порту `5432`. Данные сохраняются в Docker volume `postgres_data`.

Проверить, что база доступна:

```bash
docker compose ps
# postgres   running (healthy)
```

### 4. Генерация Prisma Client

```bash
npm run db:generate
```

Генерирует TypeScript-типы из `prisma/schema.prisma` в `node_modules/@prisma/client`. Нужно выполнить один раз после `npm install` и при каждом изменении схемы.

### 5. Миграции

```bash
npm run db:migrate:dev
```

Применяет SQL-миграции и создаёт таблицы:

- `default_preferences` — допустимые комбинации type × channel и их дефолтный enabled
- `user_preference_overrides` — пользовательские override-настройки
- `user_quiet_hours` — тихие часы пользователя
- `global_policies` — глобальные deny-политики

### 6. Seed начальных данных

```bash
npm run db:seed
```

Заполняет таблицу `default_preferences` 16 записями (4 типа × 4 канала):

| Тип | Email | SMS | Push | Messenger |
|-----|-------|-----|------|-----------|
| `security` | ✓ | ✓ | ✓ | ✓ |
| `transactional` | ✓ | ✓ | ✓ | ✓ |
| `system` | ✓ | ✓ | ✓ | ✓ |
| `marketing` | ✗ | ✗ | ✗ | ✗ |

Seed идемпотентен — повторный запуск не создаёт дублей.

### 7. Запуск сервиса

```bash
npm run dev
```

Запускает сервис в режиме watch (перезапускается при изменении файлов). Логи — JSON через Pino.

Проверка:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Полная последовательность (первый запуск)

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:generate
npm run db:migrate:dev
npm run db:seed
npm run dev
```

---

## Тесты

### Запуск

```bash
npm test
```

Запускает все unit-тесты через Vitest и выводит результат.

Пример вывода:

```
✓ src/domain/__tests__/quietHours.test.ts           (14 tests)
✓ src/domain/__tests__/evaluateNotification.test.ts (17 tests)
✓ src/application/__tests__/preferenceService.test.ts (14 tests)

Test Files  3 passed
Tests       45 passed
```

### Watch-режим (при разработке)

```bash
npm run test:watch
```

Перезапускает тесты при изменении файлов.

### Что покрывают тесты

**`quietHours.test.ts`** — 14 тестов:
- same-day окно (внутри / снаружи / inclusive start / exclusive end)
- cross-midnight окно (вечер / раннее утро / граничные случаи)
- start == end → window disabled
- конвертация таймзоны (Europe/Moscow, Europe/Berlin с учётом DST зима/лето)

**`evaluateNotification.test.ts`** — 17 тестов:
- все 6 ветвей порядка принятия решения
- global policy перекрывает mandatory тип
- marketing + email не блокируется quiet hours (email не interruptive)
- security проходит через quiet hours (critical priority)
- cross-midnight quiet hours
- start == end window
- детерминизм: одинаковый вход → одинаковый выход

**`preferenceService.test.ts`** — 14 тестов (repositories замоканы, domain запускается по-настоящему):
- `getUserPreferences`: defaults only, override заменяет default, source корректно выставляется
- `updateUserPreferences`: валидная пара проходит, невалидная бросает ошибку, quiet hours обновляются
- `evaluateForUser`: unsupported combination, quiet hours и global policy сквозь service

Integration tests (с реальной БД) в рамках этого задания не написаны — это осознанная граница, подробнее в разделе [Trade-offs](#trade-offs).

---

## Архитектура

```
src/
├── domain/           — чистая бизнес-логика, без зависимостей на БД и HTTP
│   ├── types.ts          константы и типы (NotificationType, Channel, Region, ...)
│   ├── quietHours.ts     isInQuietHours — перевод UTC в local wall-clock через Luxon
│   └── evaluateNotification.ts  главная функция принятия решения
│
├── application/      — оркестрация: собирает данные из repositories, вызывает domain
│   └── preferenceService.ts  getUserPreferences / updateUserPreferences / evaluateForUser
│
├── infrastructure/   — всё, что работает с PostgreSQL
│   └── prisma/
│       ├── client.ts        singleton PrismaClient
│       └── repositories.ts  тонкие функции для каждой модели
│
└── http/             — Fastify routes и Zod validation, без бизнес-логики
    ├── schemas.ts         Zod-схемы для всех входящих данных
    ├── registerRoutes.ts  регистрация маршрутов
    └── routes/
        ├── preferences.ts  GET + POST /users/:id/preferences
        └── evaluate.ts     POST /evaluate
```

Слои зависят только вниз: `http → application → domain`, `application → infrastructure`. Domain не знает ни о Prisma, ни о Fastify.

---

## Бизнес-правила

### Defaults + overrides

Effective state пользователя вычисляется на чтении:

```
effective = defaults + user overrides
```

Дефолтные настройки не копируются на каждого пользователя при регистрации. Хранятся только строки, где пользователь явно переопределил значение. Если у пользователя нет override для пары `notificationType + channel`, используется значение из `default_preferences`.

### Обязательные типы уведомлений

`security` и `transactional` считаются mandatory. Они разрешены даже если пользователь выключил их через override.

Единственное исключение — наличие global deny policy: она имеет наивысший приоритет.

### Quiet hours

Quiet hours блокируют уведомление только если одновременно выполняются три условия:

- тип уведомления не critical (`security`, `transactional` — critical)
- канал interruptive (`sms`, `push`, `messenger` — interruptive; `email` — нет)
- локальное время пользователя попадает в окно quiet hours

Временное окно: start inclusive, end exclusive. Поддерживается переход через полночь (например, 22:00–08:00). Если start == end, окно считается отключённым.

### Global policies

Global policy — только deny, allow-политик нет. Наличие записи означает запрет. При поиске применяется приоритет: specific region > GLOBAL.

### Порядок принятия решения

```
1. Global deny policy        → deny  / blocked_by_global_policy
2. Mandatory critical type   → allow / allowed_mandatory
3. User override disabled    → deny  / disabled_by_user_preference
4. Default disabled          → deny  / disabled_by_default
5. Quiet hours               → deny  / blocked_by_quiet_hours
6. Allow                     → allow / allowed
```

### User не моделируется

В этом сервисе нет таблицы User. `userId` — внешний идентификатор из основной платформы. Notification Preferences Service хранит только настройки, связанные с этим идентификатором.

---

## API

### GET /users/:id/preferences

Возвращает effective state пользователя — defaults + overrides с указанием источника каждого значения.

```bash
curl http://localhost:3000/users/user-1/preferences
```

```json
[
  { "notificationType": "marketing",     "channel": "email",     "enabled": false, "source": "default"  },
  { "notificationType": "marketing",     "channel": "sms",       "enabled": false, "source": "default"  },
  { "notificationType": "marketing",     "channel": "push",      "enabled": true,  "source": "override" },
  { "notificationType": "marketing",     "channel": "messenger", "enabled": false, "source": "default"  },
  { "notificationType": "transactional", "channel": "email",     "enabled": true,  "source": "default"  }
]
```

`source: "override"` означает, что пользователь явно переопределил это значение. `source: "default"` — используется системный дефолт.

---

### POST /users/:id/preferences

Merge-upsert настроек. Можно передавать `preferences`, `quietHours` или оба поля одновременно — они независимы. Пары, не указанные в запросе, не затрагиваются.

Операция идемпотентна: повторный запрос с теми же данными не изменяет состояние.

**Обновление предпочтений:**

```bash
curl -X POST http://localhost:3000/users/user-1/preferences \
  -H "Content-Type: application/json" \
  -d '{
    "preferences": [
      { "notificationType": "marketing", "channel": "email", "enabled": true }
    ]
  }'
```

**Настройка quiet hours:**

```bash
curl -X POST http://localhost:3000/users/user-1/preferences \
  -H "Content-Type: application/json" \
  -d '{
    "quietHours": {
      "enabled": true,
      "startTime": "22:00",
      "endTime": "08:00",
      "timezone": "Europe/Moscow"
    }
  }'
```

**Оба поля сразу:**

```bash
curl -X POST http://localhost:3000/users/user-1/preferences \
  -H "Content-Type: application/json" \
  -d '{
    "preferences": [
      { "notificationType": "marketing", "channel": "push", "enabled": false }
    ],
    "quietHours": {
      "enabled": true,
      "startTime": "22:00",
      "endTime": "08:00",
      "timezone": "Europe/Moscow"
    }
  }'
```

Ответ: `204 No Content`

**Ошибка — неподдерживаемая комбинация:**

```json
{ "error": "Unsupported combination: marketing/unknown_channel" }
```

**Ошибка — невалидные данные:**

```json
{
  "error": "Validation error",
  "details": [
    { "code": "custom", "message": "Must be a valid IANA timezone (e.g. Europe/Moscow)", "path": ["quietHours", "timezone"] }
  ]
}
```

---

### POST /evaluate

Принятие решения о возможности отправки. `timestamp` — UTC ISO 8601, обязательно с `Z`.

```bash
curl -X POST http://localhost:3000/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-1",
    "notificationType": "marketing",
    "channel": "push",
    "region": "EU",
    "timestamp": "2026-01-15T23:00:00Z"
  }'
```

**Разрешено:**

```json
{ "decision": "allow", "reason": "allowed" }
```

**Заблокировано глобальной политикой:**

```json
{ "decision": "deny", "reason": "blocked_by_global_policy" }
```

**Заблокировано quiet hours:**

```json
{ "decision": "deny", "reason": "blocked_by_quiet_hours" }
```

Возможные значения `reason`:

| reason | когда |
|--------|-------|
| `allowed` | все проверки пройдены |
| `allowed_mandatory` | `security` или `transactional` — всегда разрешены |
| `blocked_by_global_policy` | есть запись в `global_policies` для этого type/channel/region |
| `disabled_by_user_preference` | пользователь явно выключил этот канал |
| `disabled_by_default` | нет override, дефолт выключен |
| `blocked_by_quiet_hours` | interruptive канал + не critical тип + попадает в окно |

---

## Trade-offs

### Validation в updateUserPreferences

Сейчас `updateUserPreferences()` валидирует каждую входящую пару `notificationType + channel` отдельным запросом `getDefaultPreference()`.

Это означает, что N обновляемых предпочтений приводят к N validation queries.

Для текущего задания это осознанный trade-off:

- количество возможных пар маленькое и ограниченное
- код проще читать
- поведение явно следует из доменной модели
- преждевременная оптимизация здесь не нужна

В production я бы оптимизировал это так:

1. загрузить все поддерживаемые пары одним запросом
2. собрать in-memory `Set`
3. валидировать входящий batch локально
4. затем выполнять batch upsert

### Integration tests

Unit-тесты покрывают доменную логику и application layer (с замоканными repositories). Integration tests с реальной БД не написаны — это граница тестового задания. В production нужны тесты, которые проверяют реальный upsert, работу composite PK и behaviour seed-данных.

---

## Что добавить в production

- Service-to-service auth (API key или JWT)
- Audit log изменений preferences
- Нормальная иерархия application errors (вместо `Error.message.startsWith(...)`)
- Integration tests с отдельной тестовой БД
- CI pipeline (GitHub Actions)
- Метрики по allow/deny решениям (счётчики по `reason`)
- Rate limiting на evaluate endpoint
- Graceful shutdown Prisma и Fastify
- OpenAPI/Swagger документация
- Admin API для управления global policies
- Более детальная модель типов уведомлений: `password_reset`, `order_paid`, `promo_campaign` вместо плоских `marketing`/`transactional`
