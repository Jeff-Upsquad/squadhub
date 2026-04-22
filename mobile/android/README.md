# Squad Chat — Android

Native Kotlin Android apps for Squad Chat. One Gradle project, two product flavors → two APKs:

| Flavor | Application ID | Users |
|---|---|---|
| `clients` | `com.squadhub.chat.clients` | `client` + `client_staff` |
| `team` | `com.squadhub.chat.team` | `partner` + `internal` + `admin` |

Written in Kotlin with Jetpack Compose, Hilt, Retrofit, Room, Coil, Navigation Compose. Min SDK 26, target SDK 35.

## Prerequisites

1. **Android Studio** (Ladybug or newer).
   ```bash
   brew install --cask android-studio
   ```
   On first launch, accept the default Android SDK install.

2. **JDK 17+** — Android Studio bundles one; you can also use the system `java` if it's 17 or newer.

## Open the project

1. Android Studio → **Open** → select `mobile/android`.
2. Studio will download Gradle and sync dependencies. First sync takes a few minutes.
3. If Studio prompts about missing Gradle wrapper, accept its offer to generate one.

## Build & run

### Pick a flavor + build variant in Studio

**Build → Select Build Variant…** → set `app` to either:
- `clientsDebug` (installs as Squad Chat — clients)
- `teamDebug` (installs as Squad Chat Team)

Two separate APKs with different application IDs. Both can be installed on the same device at the same time.

### Run on a physical Android phone (USB)

1. On your phone: Settings → About phone → tap **Build number** 7 times. Developer options unlock.
2. Settings → System → Developer options → enable **USB debugging**.
3. Plug the phone into your Mac with USB. When prompted, tap **Allow USB debugging** on the phone.
4. In Studio, the phone appears in the device dropdown (top bar). Click **Run** (▶) to install and launch.

Or from CLI in this directory:

```bash
./gradlew :app:installClientsDebug   # installs clients variant
./gradlew :app:installTeamDebug      # installs team variant
```

### Run on the emulator

1. In Studio: **Tools → Device Manager → Create device**. Pick a Pixel 7 profile, any API 31+ system image. ~3 GB download.
2. Boot the emulator from Device Manager. Click **Run** with the emulator selected.

## Architecture

```
app/src/main/java/com/squadhub/chat/
├── SquadChatApplication.kt     # @HiltAndroidApp, registers push channel
├── MainActivity.kt             # Single activity, Compose root
├── di/                         # Hilt modules (Network, Database)
├── data/
│   ├── model/                  # Kotlin mirrors of shared TS types
│   ├── remote/                 # Retrofit API, auth interceptor, token store
│   ├── local/                  # Room database, entities, DAOs
│   └── repo/                   # Auth, Group, Dm, AppConfig repositories
└── ui/
    ├── theme/                  # Material 3 theme, typography
    ├── bootstrap/              # Decides Login vs Inbox vs Update on app start
    ├── auth/                   # LoginScreen + LoginViewModel
    ├── inbox/                  # InboxScreen + InboxViewModel (Groups | DMs tabs)
    └── update/                 # UpdateRequiredScreen (version gate)
```

Data flow: UI → ViewModel → Repository → (Room DAO + Retrofit API). Repositories are offline-first: the UI observes the local DB via `Flow`, and `refresh()` writes the server response into Room which re-emits to the UI.

## Backend

The app talks to the existing SquadHub server. Base URL is set in `BuildConfig.API_BASE_URL` (`app/build.gradle.kts`) — currently `https://squadhub.in/` (the production backend).

## Testing against a local backend

Temporarily override the base URL for dev:

1. In `app/build.gradle.kts`, change `buildConfigField("String", "API_BASE_URL", "\"https://squadhub.in/\"")` to your local URL.
   - Emulator: `http://10.0.2.2:4000/` (the emulator's loopback to host)
   - Physical phone: `http://<your-mac-ip>:4000/` (Mac and phone on same Wi-Fi)
2. Cleartext is already allowed via `network_security_config.xml` for debug builds.

## Firebase Cloud Messaging

Each flavor ships with its own `google-services.json` under `app/src/<flavor>/`. These are already in place. Push is wired in Phase 3.

## What's in Phase 1

- Gradle + Hilt scaffold
- Data layer (Retrofit + Room + repositories)
- Auth flow with variant check (wrong-app detection)
- LoginScreen
- InboxScreen (Groups tab, plus DMs tab on team flavor)
- UpdateRequiredScreen (version gate from `/chat/app/config`)

## What's NOT in Phase 1

- ChatScreen (messages) — Phase 2
- Realtime Socket.IO — Phase 3
- FCM push service — Phase 3
- File uploads — Phase 4
- Group settings (add/remove members) — Phase 4
- Reactions, threads — v2

## Common issues

**"Failed to parse google-services.json"**: the file's `package_name` must match the flavor's applicationId. Re-download from Firebase Console if you changed package names.

**Build complains about `BuildConfig` not found**: run a Gradle sync (**File → Sync Project with Gradle Files**). `BuildConfig` is generated.

**Login fails with "Network error"**: ensure the phone/emulator can reach `API_BASE_URL`. For local backend, see "Testing against a local backend" above.
