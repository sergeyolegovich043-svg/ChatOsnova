# Безопасность BarsikChat

Дата последнего аудита: 18 августа 2026 года.

## Граница защиты

BarsikChat защищает аккаунты, сообщения и файлы от посторонних посетителей и участников чужих чатов. Система не защищает содержимое от администратора VPS, владельца PostgreSQL/volume или злоумышленника, полностью захватившего сервер: сквозного шифрования нет. HTTPS обязателен для защиты паролей, cookie, сообщений, файлов и service worker в сети.

Полная модель угроз находится в [THREAT_MODEL.md](./THREAT_MODEL.md).

## Реализованные меры

- scrypt с индивидуальной солью для паролей;
- случайные 256-битные session tokens, в БД хранится только SHA-256 токена;
- `HttpOnly`, `SameSite=Strict`, high-priority, а в production всегда `Secure` cookie с префиксом `__Host-`;
- точное сравнение HTTP/Socket.IO `Origin` только с настроенным `APP_ORIGIN`, без доверия клиентскому `Host`;
- production отказывается запускаться с HTTP `APP_ORIGIN`, отсутствующим `DATABASE_URL` или шаблонным паролем;
- проверка текущего членства во всех защищённых операциях и немедленный отзыв Socket.IO-комнат;
- CSP с запретом framing/plugins, Helmet, `nosniff`, same-origin resource policy;
- параметризованный SQL, Zod-валидация и ограничения размера JSON/загрузок;
- общий и authentication rate limit;
- случайные серверные имена файлов, хранение вне web-root, блокировка HTML/SVG/JS/XML и выдача неизвестных типов как attachment;
- Web Push принимает только публичные HTTPS endpoint без credentials, нестандартного порта и literal private IP;
- приватные API-ответы не кэшируются;
- service worker исключает `/api` и Socket.IO из navigation cache; приватные файлы и аватары выдаются с `no-store`;
- Node работает не от root, без Linux capabilities, с read-only root filesystem;
- PostgreSQL не публикуется наружу;
- npm и build-инструменты отсутствуют в runtime-образе;
- `.env*` исключены из Git и Docker build context, кроме безопасного `.env.example`;
- GitHub Actions закреплены на полных commit SHA, права workflow минимальны;
- CI запускает audit, typecheck, тесты и build; CodeQL запускается на push/PR и еженедельно;
- автоматический workflow публикует только `candidate`; `production` требует ручного запуска по полному commit SHA и GitHub Environment;
- VPS делает backup PostgreSQL перед обновлением, health-check и автоматический rollback.
- dev AI отсутствует в production route graph и использует отдельные routes/services/repositories/worker;
- Luna вызывается только сервером с `store: false`, ограничением контекста, бюджетом, rate limit, circuit breaker и аудитом без полного текста;
- RAG применяет актуальный ACL до модели, исключает удалённые/истёкшие/одноразовые сообщения и личные чаты из глобального поиска;
- transactional outbox сохраняет AI-события вместе с изменением сообщения, worker обрабатывает их с блокировкой и повторами;
- AI-очередь уведомлений персональна, учитывает доступ/настройки оповещений и удаляется вместе с источником или членством;
- модель не может создать задачу или отправить черновик: личная задача сохраняется только отдельным идемпотентным подтверждающим API-запросом;
- citations и sourceId извлечённых задач проверяются по фактически доступным модели сообщениям;
- dev использует pgvector, ежедневный backup PostgreSQL и файлов, 7-дневную ротацию и отдельный restore-check;
- пользовательская дисковая квота ограничена (500 МБ по умолчанию), AI не распаковывает архивы и не читает содержимое файлов.

## Текущие автоматические результаты

- `npm audit`: 0 известных уязвимостей во всех production и build-зависимостях;
- TypeScript: без ошибок;
- Vitest: 35/35 тестов;
- production build: успешно;
- ENV-файлы, кроме `.env.example`, не отслеживаются Git и не попадают в Docker context.

Это не означает отсутствие неизвестных уязвимостей. CodeQL и dependency audit выполняются независимо от ручного анализа, а результат меняется при обновлении CVE-баз.

## Блокеры перед следующим production-релизом

1. Настроить публичный DNS либо использовать IPv4 VPS и открыть TCP 80/443 и UDP 443. Новый production-шаблон требует `BARSIKCHAT_DOMAIN` и получает TLS через Caddy; для IP используется короткоживущий ACME-профиль.
2. Перевести существующий `/opt/barsikchat/shared/.env` на `APP_ORIGIN=https://<домен>` установщиком; до этого новый образ намеренно не запустится.
3. В GitHub создать Environment `production`, включить required reviewers и ограничить deployment веткой управления релизами.
4. Сменить оба ранее переданных в чат root-пароля, удалить password login после проверки SSH-ключа и отозвать ранее показанные runner/registration tokens.
5. Сделать зашифрованный off-site backup PostgreSQL и volume с файлами, затем проверить восстановление на отдельном стенде.
6. Добавить проверку подписи OCI-образа (Cosign/keyless) на VPS. Сейчас целостность зависит от GitHub/GHCR, защиты аккаунта и TLS.

## Остаточные риски

1. Регистрация открыта; нет административного подтверждения, MFA, подтверждения email, recovery и UI управления сессиями.
2. Нет E2E-шифрования и прикладного шифрования БД/файлов.
3. Вложения не проверяются антивирусом, архивы могут быть опасны для получателя; AI поэтому не открывает и не распаковывает их.
4. Rate limit хранится в памяти одного процесса; нет общей защиты от распределённого DDoS.
5. Push endpoint не разрешает literal private IP, но DNS rebinding полностью не исключён без egress proxy/allowlist.
6. Backup updater покрывает PostgreSQL, но не пользовательские файлы; локальная копия не спасает при потере VPS.
7. Single-node Socket.IO/presence не рассчитан на несколько реплик без внешнего адаптера.
8. Скомпрометированный администратор GitHub/GHCR или VPS остаётся критической угрозой; нужны MFA, branch/environment protection, журнал аудита и подпись образов.
9. AI остаётся dev-пилотом: перед production нужны отдельная DB service identity, антивирус/безопасный document parser, off-site backup и пилот на 5–10 коллегах.

## Production-проверка

```bash
npm audit --audit-level=high
npm run typecheck
npm test
npm run build
docker compose -f compose.prod.yml config --quiet
```

После привязки домена дополнительно проверяются redirect HTTP→HTTPS, сертификат, HSTS, CSP, cookie flags, WebSocket и Web Push. Проверка восстановления backup обязательна: наличие файла backup без успешного restore не считается резервным копированием.

## Сообщение об уязвимости

Не публикуйте секреты, дампы, токены, ключи, exploit или персональные данные в публичном issue. Передавайте описание, затронутый endpoint, воспроизводимые шаги и влияние администратору через закрытый канал.
