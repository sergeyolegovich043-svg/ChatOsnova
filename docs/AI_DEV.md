# Барсик ИИ: dev-пилот

## Статус

ИИ доступен только в development. Production не монтирует `/api/ai`, не запускает AI-миграцию и не содержит worker. Единственный внешний провайдер — OpenAI GPT-5.6 Luna (`gpt-5.6-luna`). Llama и переключатель провайдеров намеренно отсутствуют.

Пилот работает только в режиме чтения:

- поиск по доступным сообщениям;
- сводка явно выбранного чата;
- подготовка черновика без отправки;
- ссылки на реальные сообщения-источники.

Отправка, удаление и пересылка не предоставлены модели. В коде они отмечены как действия, которые в будущем потребуют отдельного подтверждения пользователя.

## Безопасное подключение Luna

Ранее опубликованный в переписке ключ необходимо отозвать. Создайте новый ключ и храните его только в окружении dev-сервера. Не добавляйте его в GitHub, клиентский `VITE_*`, Dockerfile или логи.

```powershell
Copy-Item .env.example .env.development
# В .env.development установите AI_ENABLED=true и новый OPENAI_API_KEY.
docker compose --env-file .env.development -p barsikchat-dev -f compose.dev.yml up --build
```

`.env*` исключены из Git и Docker build context, кроме безопасного `.env.example`.

## Архитектура

```mermaid
flowchart LR
  UI["BarsikChat / модальное окно Барсика"] -->|"SSE, cookie session"| ROUTE["server/routes/ai.ts"]
  ROUTE --> ORCH["AI orchestrator"]
  ORCH --> GUARD["Moderation + prompt-injection guardrails"]
  ORCH --> ACL["ACL retrieval"]
  ACL --> PG[("PostgreSQL + pgvector")]
  ORCH --> BUDGET["Rate limit + monthly budget + audit"]
  ORCH --> LUNA["OpenAI Responses API / GPT-5.6 Luna"]
  MSG["Message transaction"] --> OUTBOX["outbox_events"]
  OUTBOX --> WORKER["AI worker"]
  WORKER --> PG
```

Новые модули изолированы в `server/routes`, `server/services`, `server/repositories` и `server/ai`; AI-код не добавлен в существующий монолит маршрутов.

## Граница доступа

Фрагменты выбираются до обращения к Luna:

- обязательна актуальная запись в `conversation_members`;
- удалённые, истёкшие, скрытые и одноразовые сообщения исключаются;
- удаление сообщения каскадно удаляет его AI-фрагменты;
- личный чат доступен только при явном `conversationId` и никогда не входит в общий поиск;
- после удаления участника ACL прекращает доступ без ожидания переиндексации;
- citations принимаются только из реально переданного модели списка источников, подпись источника формирует сервер.

Текст сообщений и файлов не записывается в `ai_audit_log`: хранятся SHA-256 запроса, идентификаторы источников, статус, токены, стоимость и очищенный код ошибки. Responses вызывается с `store: false` и псевдонимизированным `safety_identifier`.

## Обработка файлов

На первом пилоте Барсик не открывает содержимое файлов и никогда не распаковывает ZIP/RAR. Индексируется только имя, MIME и размер прикреплённого файла. Одноразовые файлы не индексируются. Активный HTML/SVG/JS/XML запрещён при загрузке, неизвестные типы скачиваются как `application/octet-stream`, а личная квота по умолчанию — 500 МБ.

## Надёжность и стоимость

- `outbox_events` записывается триггерами в одной транзакции с сообщением;
- worker использует `FOR UPDATE SKIP LOCKED`, повторные попытки и terminal failure после 8 ошибок;
- миграции сериализованы advisory lock, поэтому web и worker безопасно стартуют одновременно;
- таймаут Luna по умолчанию 45 секунд, 3 попытки только для временных HTTP-ошибок;
- circuit breaker выключает вызовы на минуту после трёх сбоев;
- лимит 8 запросов в минуту на пользователя и месячный бюджет $5, оба настраиваются ENV;
- API-ключ и полные приватные сообщения не попадают в аудит.

## Backup и восстановление dev

Сервис `backup` сразу создаёт PostgreSQL dump и архив пользовательских файлов, затем повторяет это ежедневно; локальная история хранится 7 дней. Проверка восстановления выполняется отдельно:

```bash
npm run backup:verify
```

Backup не считается рабочим, пока эта команда не завершилась сообщением `Development backup restored successfully`.

## Проверки

```bash
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:ai
npm audit --audit-level=high
docker compose -p barsikchat-dev -f compose.dev.yml config --quiet
```

AI-smoke требует dev PostgreSQL с pgvector, запущенные web/worker и `DATABASE_URL`. Он проверяет outbox, ACL чужого чата, исключение личных чатов из общего поиска, удаление из RAG и prompt injection. Unit-тесты дополнительно покрывают русский язык, сводки, citations, превышение бюджета, недоступность Luna, отмену и подтверждение потенциальных действий.

## Ограничения пилота

- настоящий ключ не включён в репозиторий, поэтому без серверной настройки UI показывает «Luna не подключена»;
- содержимое документов пока не разбирается;
- embedding-индекс создаётся worker, retrieval в пилоте также имеет безопасный полнотекстовый fallback;
- модель не выполняет действия;
- выкатывать AI в production до пилота на 5–10 коллегах и повторного security review запрещено.
