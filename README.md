# ChatOsnova

A Kotlin/Compose Android messenger skeleton inspired by ChatGPT. It demonstrates clean architecture layers, secure-ready abstractions, and realtime chat/call placeholders.

## Ключевые возможности
- Jetpack Compose UI с пузырями в стиле ChatGPT, кнопками для текста/голоса/видео и навигацией между авторизацией, списком чатов, экраном чата и вызовом.
- Чистая архитектура с разделением на data/domain/presentation и подготовленными интерфейсами репозиториев.
- Безопасность по умолчанию: контракт Retrofit рассчитан на HTTPS, хранение токена через `EncryptedSharedPreferences`, абстракция `SecureMessageService` для дальнейшей интеграции криптографии (например, Tink/Signal).
- Демонстрационные репозитории для чатов и звонков, а также заготовки под WebRTC и MediaRecorder.

## Быстрый старт
1. Откройте проект в Android Studio Giraffe или новее.
2. Запустите модуль `app` на устройстве/эмуляторе с API 26+.
3. Фейковые репозитории автоматически создадут приветственный чат и позволят отправлять текстовые сообщения/заготовки голосовых сообщений и инициировать тестовые вызовы.

## Архитектура
Проект следует лёгкой вариации Clean Architecture:

- **presentation** (`app/src/main/java/com/example/chatosnova/presentation`): Jetpack Compose-экран для каждой фичи (Login/Register, ChatList, Chat, Call, UserProfile), навигация в `MainActivity` через `NavHost`, состояния управляются `ViewModel` с фабриками.
- **domain** (`app/src/main/java/com/example/chatosnova/domain`): модели (`auth`, `chat`, `call`), интерфейсы репозиториев и наборы use-case сгруппированы по сущностям.
- **data** (`app/src/main/java/com/example/chatosnova/data`): реализации интерфейсов, включая `AuthRepositoryImpl` с `EncryptedSharedPreferences`, `FakeChatRepository` с отправкой/подпиской на сообщения и `FakeCallRepository`.

Дополнительные детали структуры доступны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Пользовательские сценарии
- **Аутентификация:** `LoginScreen` и `RegisterScreen` работают через `AuthViewModel`, после успешного входа устанавливается текущий пользователь и выполняется переход к списку чатов.
- **Список чатов:** `ChatListScreen` отображает данные `ChatListViewModel`; выбор чата открывает `ChatScreen`, карточка пользователя ведёт на `UserProfileScreen`.
- **Экран чата:** `ChatScreen` подписывается на поток сообщений, умеет отправлять текст/голос (фиктивно), запускать вызов (`CallScreen`) и отображать статус доставки.
- **Вызовы:** `CallScreen` опирается на `CallViewModel` и демонстрирует установку/завершение звонка с макетами для видео/аудио.
- **Профиль пользователя:** `UserProfileScreen` позволяет начать чат с выбранным контактом через `ChatListViewModel`.

## Соображения безопасности
- Секреты и токены сохраняются в `EncryptedSharedPreferences` через `MasterKey` (`AuthRepositoryImpl`).
- `SecureMessageService` изолирует шифрование/проверку подписей; текущая реализация `NoopSecureMessageService` является заглушкой и должна быть заменена на проверенную библиотеку.
- Рекомендуется вызывать все сетевые операции поверх HTTPS; в комментариях `AuthRepositoryImpl` и `ApiService` оставлены напоминания для будущей интеграции.

## Как развивать дальше
- Подменить фейковые репозитории на реальный стек (Retrofit/WebSockets/WebRTC) с сохранением интерфейсов `domain`.
- Расширить `SecureMessageService`, добавив шифрование сообщений и валидацию ключей на приёме.
- Добавить юнит- и UI-тесты на основные сценарии (аутентификация, отправка сообщения, запуск вызова).
