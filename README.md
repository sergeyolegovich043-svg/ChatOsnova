# ChatOsnova

A Kotlin/Compose Android messenger skeleton inspired by ChatGPT. It demonstrates clean architecture layers, secure-ready abstractions, and realtime chat/call placeholders.

## Highlights
- Jetpack Compose UI with ChatGPT-like bubbles, voice/video affordances, and navigation across auth, chat list, chat, and call flows.
- Clean architecture layers (data/domain/presentation) with repository interfaces and sample use cases.
- Security-conscious defaults: HTTPS-only Retrofit contract, EncryptedSharedPreferences token storage, and a `SecureMessageService` abstraction with TODO for integrating audited crypto (e.g., Tink/Signal protocol).
- Mock repositories for chats and calls plus placeholders for WebRTC and MediaRecorder integration.

## Running
Open the project in Android Studio (Giraffe or later) and run the `app` module on an API 26+ device/emulator. The fake repositories seed a demo chat and allow composing text/voice placeholders and starting mock calls.
