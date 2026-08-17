# HTTP API и WebSocket BarsikChat

API предназначен для встроенного клиента BarsikChat. Отдельного публичного API-токена пока нет.

## Общие правила

- base URL совпадает с origin приложения;
- аутентификация — `__Host-barsik_session` в production (`cs_session` только в локальной HTTP-разработке);
- JSON-запросы используют `Content-Type: application/json`;
- загрузки используют `multipart/form-data`;
- изменяющие запросы в production обязаны иметь допустимый `Origin`;
- успешное удаление часто возвращает `204 No Content`;
- ошибки имеют форму `{ "error": "Описание" }`;
- приватные JSON-ответы содержат `Cache-Control: no-store`.

## Авторизация

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/auth/register` | Регистрация |
| `POST` | `/api/auth/login` | Вход |
| `POST` | `/api/auth/logout` | Завершение текущей сессии |
| `GET` | `/api/auth/me` | Текущий пользователь |

Регистрация:

```json
{
  "email": "user@example.com",
  "username": "user_name",
  "displayName": "Имя пользователя",
  "password": "long password"
}
```

Код приглашения отсутствует. Логин принимает поле `login` с email или username и поле `password`.

## Профиль и каталог

| Метод | Путь | Назначение |
|---|---|---|
| `PATCH` | `/api/profile` | Изменить имя и bio |
| `POST` | `/api/profile/avatar` | Загрузить поле `avatar` |
| `DELETE` | `/api/profile/avatar` | Удалить аватар |
| `GET` | `/api/users/:userId/avatar` | Получить аватар |
| `GET` | `/api/users?search=` | Найти пользователей |

## Чаты

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/conversations` | Список видимых чатов |
| `POST` | `/api/conversations/direct` | Создать/открыть личный чат |
| `POST` | `/api/conversations/saved` | Создать/открыть «Избранное» |
| `POST` | `/api/conversations/group` | Создать группу |
| `PATCH` | `/api/conversations/:id/group` | Изменить название группы (owner/admin) |
| `POST` | `/api/conversations/:id/members` | Добавить участников (owner/admin) |
| `DELETE` | `/api/conversations/:id/members/:userId` | Удалить участника |
| `PATCH` | `/api/conversations/:id/members/:userId/role` | Назначить/снять администратора (owner) |
| `POST` / `DELETE` | `/api/conversations/:id/avatar` | Загрузить/удалить аватар группы |
| `GET` | `/api/conversations/:id/avatar` | Получить аватар группы |
| `PATCH` | `/api/conversations/:id/notifications` | Настроить уведомления текущего участника |
| `PATCH` | `/api/conversations/:id/pin` | Закрепить или открепить |
| `PATCH` | `/api/conversations/:id/archive` | Переместить в архив или вернуть |
| `DELETE` | `/api/conversations/:id` | Скрыть личный чат или удалить свою группу |
| `POST` | `/api/conversations/:id/leave` | Покинуть группу |
| `POST` | `/api/conversations/:id/read` | Отметить чат прочитанным |
| `POST` | `/api/conversations/:id/unread` | Отметить чат непрочитанным |

Личный чат создаётся с `{ "userId": "uuid" }`. Группа — с `{ "title": "Название", "memberIds": ["uuid"] }`. Закрепление принимает `{ "pinned": true }`.

Уведомления принимают `{ "mode": "all|mentions|muted", "muteUntil": "ISO date|null" }`. Для бессрочного отключения используется `mode=muted` и `muteUntil=null`.

Папки: `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id` и `PUT /api/folders/:id/items`. Папки принадлежат пользователю и содержат только доступные ему чаты.

## Сообщения

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/conversations/:id/messages?before=&limit=` | История сообщений |
| `GET` | `/api/messages/search` | Глобальный/локальный поиск с фильтрами |
| `GET` | `/api/messages/:id/context` | Контекст вокруг найденного сообщения |
| `POST` | `/api/conversations/:id/messages` | Отправить сообщение |
| `PATCH` | `/api/messages/:id` | Изменить собственное сообщение |
| `DELETE` | `/api/messages/:id?scope=self|everyone` | Удалить у себя или у всех |
| `GET` | `/api/conversations/:id/pins` | Закреплённые сообщения |
| `POST` / `DELETE` | `/api/messages/:id/pin` | Закрепить/открепить сообщение |
| `POST` | `/api/messages/:id/view-once` | Однократно открыть вложение |
| `POST` | `/api/messages/:id/forward` | Переслать в другой доступный чат |
| `POST` | `/api/messages/:id/reactions` | Переключить реакцию |

Отправка:

```json
{
  "body": "Текст",
  "replyToId": null,
  "clientId": "uuid",
  "attachmentIds": [],
  "silent": false,
  "scheduleAt": null,
  "expireSeconds": null,
  "viewOnce": false
}
```

`clientId` создаёт клиент и не повторяет для новых сообщений. Сервер принимает до 4000 символов и до пяти attachment ID. `scheduleAt` задаётся в ISO 8601, `expireSeconds` — от 60 секунд до 7 дней. `viewOnce` требует хотя бы одно вложение.

Поиск принимает `q`, `conversationId`, `senderId`, `dateFrom`, `dateTo`, `type` и `limit`. `type`: `all`, `text`, `files`, `image`, `video`, `audio`, `voice` или `video_circle`. Сообщение содержит массив `readBy` с `userId` и точным `readAt`; клиент на его основе показывает состояние прочтения.

Пересылка принимает `{ "targetConversationId": "uuid" }`. Реакция принимает один поддерживаемый emoji: `{ "emoji": "🔥" }`.

## Файлы

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/uploads` | Загрузить поля `files`, максимум пять |
| `GET` | `/api/files/:attachmentId` | Скачать доступный файл |

Для голосового сообщения или видеокружка multipart дополнительно содержит:

- `mediaKind`: `voice` либо `video_circle`;
- `durationMs`: целое число миллисекунд.

Обычные вложения получают `mediaKind=file`. Неинлайновые форматы отдаются как `application/octet-stream` с `Content-Disposition: attachment`.

## Web Push

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/push/public-key` | Получить публичный VAPID-ключ |
| `POST` | `/api/push/subscribe` | Сохранить браузерную подписку |
| `DELETE` | `/api/push/subscribe` | Удалить подписку |

Endpoint должен использовать публичный HTTPS-адрес без нестандартного порта, credentials, localhost или приватного IP.

## Health-check

`GET /api/health` не требует авторизации и возвращает `{"status":"ok"}`, если API может выполнить запрос к PostgreSQL.

## Socket.IO

Handshake использует cookie-сессию и проверенный `Origin`. После подключения сервер автоматически присоединяет сокет к `user:<id>` и комнатам текущих чатов.

События от клиента:

| Событие | Payload |
|---|---|
| `conversation:join` | conversation UUID |
| `typing:start` | conversation UUID |
| `typing:stop` | conversation UUID |

События от сервера:

| Событие | Назначение |
|---|---|
| `message:new` | новое сообщение |
| `message:updated` | изменение, удаление или реакция |
| `message:hidden` / `message:expired` | сообщение скрыто у пользователя или исчезло |
| `conversation:new` | пользователь добавлен в чат |
| `conversation:updated` | изменился чат/последнее сообщение |
| `conversation:pinned` | изменено личное закрепление |
| `conversation:archived` / `conversation:unread` | изменён архив или ручная непрочитанность |
| `conversation:removed` | чат скрыт, удалён или пользователь вышел |
| `read:update` | обновлено прочтение |
| `typing:update` | собеседник печатает |
| `presence:update` | пользователь онлайн/офлайн |
| `profile:updated` | изменился профиль участника |

REST остаётся источником истины: после reconnect клиент повторно загружает список и историю.
