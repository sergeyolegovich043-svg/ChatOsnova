# HTTP API и WebSocket BarsikChat

API предназначен для встроенного клиента BarsikChat. Отдельного публичного API-токена пока нет.

## Общие правила

- base URL совпадает с origin приложения;
- аутентификация — cookie `cs_session`;
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
| `POST` | `/api/conversations/group` | Создать группу |
| `PATCH` | `/api/conversations/:id/pin` | Закрепить или открепить |
| `DELETE` | `/api/conversations/:id` | Скрыть личный чат или удалить свою группу |
| `POST` | `/api/conversations/:id/leave` | Покинуть группу |
| `POST` | `/api/conversations/:id/read` | Отметить чат прочитанным |

Личный чат создаётся с `{ "userId": "uuid" }`. Группа — с `{ "title": "Название", "memberIds": ["uuid"] }`. Закрепление принимает `{ "pinned": true }`.

## Сообщения

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/conversations/:id/messages?before=&limit=` | История сообщений |
| `POST` | `/api/conversations/:id/messages` | Отправить сообщение |
| `PATCH` | `/api/messages/:id` | Изменить собственное сообщение |
| `DELETE` | `/api/messages/:id` | Удалить собственное сообщение |
| `POST` | `/api/messages/:id/forward` | Переслать в другой доступный чат |
| `POST` | `/api/messages/:id/reactions` | Переключить реакцию |

Отправка:

```json
{
  "body": "Текст",
  "replyToId": null,
  "clientId": "uuid",
  "attachmentIds": []
}
```

`clientId` создаёт клиент и не повторяет для новых сообщений. Сервер принимает до 4000 символов и до пяти attachment ID.

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
| `conversation:new` | пользователь добавлен в чат |
| `conversation:updated` | изменился чат/последнее сообщение |
| `conversation:pinned` | изменено личное закрепление |
| `conversation:removed` | чат скрыт, удалён или пользователь вышел |
| `read:update` | обновлено прочтение |
| `typing:update` | собеседник печатает |
| `presence:update` | пользователь онлайн/офлайн |
| `profile:updated` | изменился профиль участника |

REST остаётся источником истины: после reconnect клиент повторно загружает список и историю.
