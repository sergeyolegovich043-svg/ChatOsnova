# Модель угроз BarsikChat

## Защищаемые активы

- пароли, cookie и активные сессии;
- сообщения, реакции, профили, голосовые/видео и файлы;
- PostgreSQL, upload volume и резервные копии;
- VAPID private key и production ENV;
- исходный код, GitHub Actions, GHCR-образ и VPS updater;
- service worker/PWA: его подмена даёт долговременный контроль над фронтендом.

## Границы доверия

```text
Браузер/устройство
       │ HTTPS + WSS
       ▼
Caddy/TLS ──► Node API + Socket.IO ──► PostgreSQL
                    │
                    ├──► upload volume
                    └──► Web Push providers

GitHub source ──► GitHub Actions ──► GHCR ──► VPS pull updater
```

Администраторы GitHub и VPS являются привилегированными субъектами. Без E2E они технически способны получить доступ к содержимому.

## Основные сценарии

| Угроза | Влияние | Текущая защита | Остаток/следующий шаг |
|---|---|---|---|
| MITM и подмена фронта/service worker | кража пароля, cookie, постоянный вредоносный PWA | production требует HTTPS; Caddy получает TLS и включает HSTS | нужен домен и фактическая миграция live-сервера |
| XSS/HTML-вложение или cache leak | выполнение кода/чтение файла в чужой сессии | React escaping, CSP, запрет SVG/HTML/JS/XML, `nosniff`, download-only unknown types, `no-store`, API denylist в service worker | CodeQL, review markdown/link rendering, антивирус файлов |
| CSRF и cross-site WebSocket hijacking | действия от имени пользователя | SameSite cookie и точный `Origin` для mutations/Socket.IO | добавить тесты через reverse proxy после домена |
| IDOR/доступ к чужому чату | утечка/изменение сообщений | проверка актуального membership во всех маршрутах и сокет-комнатах | расширять negative integration tests при каждом endpoint |
| Credential stuffing/brute force | захват аккаунта | scrypt и rate limit | Redis/shared limiter, MFA, breached-password check, session UI |
| Опасный upload/zip bomb | заражение клиента, заполнение диска | лимиты, случайное имя, хранение вне web-root, active-type denylist | AV/CDR, квоты, disk alerts; не распаковывать архивы сервером |
| SSRF через Web Push | доступ к внутренней сети | HTTPS-only, блок private literal IP/localhost/credentials/ports | egress proxy или allowlist, защита DNS rebinding |
| SQL injection | чтение/порча БД | параметризованные запросы и Zod | CodeQL и review новых raw queries |
| Supply-chain/захват CI | вредоносный production-образ | action SHA pinning, read-only checkout token, audit/typecheck/tests, candidate/production separation, manual immutable SHA | Environment approval настроить в GitHub; подписывать и проверять OCI |
| Утечка ENV | полный захват приложения/БД | `.env*` исключены из Git/Docker, mode 600 на VPS | secret scanning, ротация ранее раскрытых credentials, Vault при росте |
| Захват/потеря VPS | чтение/удаление всех данных | non-root app, internal DB, read-only containers, predeploy DB backup/rollback | SSH hardening, firewall, off-site encrypted DB+files backup, restore drill |
| DDoS/ресурсное истощение | недоступность, потеря диска | request/file limits, health checks, restart/rollback | CDN/WAF, shared limiter, storage quota, monitoring и alerting |
| Prompt injection в будущем AI | утечка чужих чатов, опасный tool call | AI пока не включён | ACL до retrieval, least-privilege tools, output validation, audit/evals |

## Критерии допуска релиза

Production-релиз запрещён, если не проходят audit, typecheck, tests или build; если указан не полный source SHA; если `APP_ORIGIN` не HTTPS; либо если health-check после обновления не проходит. Релиз также нельзя одобрять без актуального backup и проверенного плана rollback.
