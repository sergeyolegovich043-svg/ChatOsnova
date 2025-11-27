# Архитектура ChatOsnova

Документ описывает устройство демонстрационного мессенджера и отвечает на вопросы, где искать ключевые элементы.

## Слои
- **Presentation** (`app/src/main/java/com/example/chatosnova/presentation`): Jetpack Compose-экраны, объединённые `NavHost` из `MainActivity`. Каждый экран имеет свой `ViewModel` с фабрикой, что упрощает замену зависимостей.
- **Domain** (`app/src/main/java/com/example/chatosnova/domain`): модели (`auth`, `chat`, `call`), интерфейсы репозиториев и наборы use-case (пакет `usecase`) для группировки сценариев по фичам.
- **Data** (`app/src/main/java/com/example/chatosnova/data`): конкретные реализации интерфейсов домена, адаптеры хранения и сетевые контракты.

## Навигация и состояние
- `MainActivity` создаёт репозитории и поднимает `NavHost` с маршрутами `Login`, `Register`, `ChatList`, `Chat/{chatId}`, `UserProfile/{userId}` и `Call/{callId}`.
- `AuthViewModel`, `ChatViewModel`, `ChatListViewModel`, `CallViewModel` и `UserProfileViewModel` управляют состояниями экранов и получают зависимости через фабрики, чтобы не тянуть `Context` в Compose.

## Данные и демо-реализации
- **Аутентификация:** `AuthRepositoryImpl` использует `EncryptedSharedPreferences` + `MasterKey` для хранения токена, `username` и `userId`. Сетевые вызовы замоканы комментариями под будущий Retrofit.
- **Чаты:** `FakeChatRepository` хранит состояние в `MutableStateFlow`, рассылает сообщения через `SharedFlow` и пропускает их через `SecureMessageService` (сейчас `NoopSecureMessageService`). В демо создаётся приветственный чат с ботом.
- **Звонки:** `FakeCallRepository` реализует простую модель вызова на основе `Flow` и служит заглушкой под WebRTC/MediaRecorder.
- **Пользователи:** `InMemoryUserRepository` хранит список контактов в памяти и позволяет создавать чат с выбранным пользователем.

## Безопасность и расширение
- Все криптографически значимые операции вынесены в `SecureMessageService`; интеграция сторонней библиотеки выполняется внутри этой абстракции.
- Предполагается использование HTTPS для всех реальных сетевых вызовов (см. комментарии в `ApiService` и `AuthRepositoryImpl`).
- Для продакшена рекомендуется заменить фейковые репозитории, добавить слой кэширования/БД, а также покрыть use-case тестами.

## Сборка и зависимости
- Минимальная версия Android — API 26.
- Основные зависимости: Jetpack Compose Material3, Navigation Compose, lifecycle-viewmodel-compose, Kotlin coroutines, Security Crypto, Retrofit (контракт для будущего API).
- Запуск проекта осуществляется из Android Studio; отдельный Gradle-профиль не требуется.
