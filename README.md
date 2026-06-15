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

## Бизнес-правила

### Defaults + overrides

Effective state пользователя вычисляется на чтении:

```
defaults + user overrides
```

Дефолтные настройки не копируются на каждого пользователя при регистрации. Хранятся только строки, где пользователь явно переопределил значение.

### Обязательные типы уведомлений

`security` и `transactional` считаются mandatory. Они разрешены даже если пользователь выключил их через override.

Единственное исключение — наличие global deny policy: она имеет наивысший приоритет.

### Quiet hours

Quiet hours блокируют уведомление только если одновременно выполняются три условия:

- тип уведомления не critical (`security`, `transactional` — critical)
- канал interruptive (`sms`, `push`, `messenger` — interruptive; `email` — нет)
- локальное время пользователя попадает в окно quiet hours

Временное окно: start inclusive, end exclusive. Поддерживается переход через полночь (например, 22:00–08:00).

### Global policies

Global policy — только deny, allow-политик нет. Наличие записи означает запрет. При поиске: specific region > GLOBAL.

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

## Запуск локально

```bash
cp .env.example .env
npm install
docker compose up -d
npm run db:generate
npm run db:migrate:dev
npm run db:seed
npm run dev
```

Проверка:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Тесты

```bash
npm test
```

45 unit-тестов: доменный слой, quiet hours, application layer (с замоканными repositories).

## API

### GET /users/:id/preferences

Возвращает effective state пользователя — defaults + overrides с указанием источника.

```bash
curl http://localhost:3000/users/user-1/preferences
```

```json
[
  { "notificationType": "marketing",     "channel": "email", "enabled": false, "source": "default"  },
  { "notificationType": "marketing",     "channel": "push",  "enabled": true,  "source": "override" },
  { "notificationType": "transactional", "channel": "email", "enabled": true,  "source": "default"  }
]
```

### POST /users/:id/preferences

Merge-upsert настроек. Можно передавать `preferences`, `quietHours` или оба поля — не зависят друг от друга. Пары, не указанные в запросе, не затрагиваются.

```bash
curl -X POST http://localhost:3000/users/user-1/preferences \
  -H "Content-Type: application/json" \
  -d '{
    "preferences": [
      { "notificationType": "marketing", "channel": "email", "enabled": true }
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

```json
{ "decision": "deny", "reason": "blocked_by_quiet_hours" }
```

Возможные значения `reason`:

| reason | описание |
|--------|----------|
| `allowed` | разрешено |
| `allowed_mandatory` | разрешено как mandatory тип |
| `blocked_by_global_policy` | запрещено глобальной политикой |
| `disabled_by_user_preference` | пользователь выключил |
| `disabled_by_default` | выключено по умолчанию |
| `blocked_by_quiet_hours` | тихие часы |

## Trade-offs

### Validation в updateUserPreferences

Сейчас `updateUserPreferences()` валидирует каждую входящую пару `notificationType + channel` отдельным запросом `getDefaultPreference()`.

Это означает, что N обновляемых предпочтений могут привести к N validation queries.

Для текущего тестового задания это осознанный trade-off:

- количество возможных пар маленькое и ограниченное
- код проще читать
- поведение явно следует из доменной модели
- преждевременная оптимизация здесь не нужна

В production я бы оптимизировал это так:

1. загрузить все поддерживаемые пары одним запросом
2. собрать in-memory `Set`
3. валидировать входящий batch локально
4. затем выполнять batch upsert

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
