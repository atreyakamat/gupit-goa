# Build the Gupit Goa APK

This guide is written so a coding agent (or a person) can follow it top to bottom and end with an APK installed on an Android phone. Every step says what to run and what to expect.

The APK works with **no accounts and no keys**: the map uses OpenFreeMap (no API key), and with no backend configured the app opens in **preview mode** with labelled sample places. Connecting the real backend is the optional Part C.

## Rules for the agent

- Work on a branch. Never push to `main`.
- Never commit `apps/mobile/android/`, `apps/mobile/ios/`, any `.env` file, a keystore or a key. They are git-ignored; keep it that way.
- Never put a Supabase **service-role** or **secret** key anywhere under `apps/mobile`. The app refuses to start if it sees one.
- Do not add web dependencies (`react-dom`, `react-native-web`) or a web target. This app is native only.
- If a step fails, stop and report the exact command and the last 40 lines of output. Do not "fix" the build by deleting checks, downgrading packages or disabling the new architecture.

---

## Part A: fastest route, download the APK that CI already built

Every pull request and every push to `main` builds an APK in GitHub Actions (workflow: **Android APK**).

With the GitHub CLI:

```bash
gh run list --repo atreyakamat/gupit-goa --workflow "Android APK" --status success --limit 1
gh run download <RUN_ID> --repo atreyakamat/gupit-goa --name gupit-goa-apk --dir ./apk-out
# -> ./apk-out/gupit-goa.apk
```

Or in a browser: repository -> **Actions** -> **Android APK** -> latest green run -> **Artifacts** -> `gupit-goa-apk` (a zip containing `gupit-goa.apk`).

Then go to **Part D** to install it. If there is no green run, use Part B.

---

## Part B: build it locally

### B1. Check the tools

| Tool        | Needed                                               | Check                                                       | Expect                    |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| Node.js     | 22 or newer                                          | `node -v`                                                   | `v22.x` or higher         |
| Java (JDK)  | 17                                                   | `java -version`                                             | `17.x`                    |
| Android SDK | Platform + build tools (installed by Android Studio) | `echo $ANDROID_HOME` (PowerShell: `echo $env:ANDROID_HOME`) | a folder path that exists |
| Git         | any                                                  | `git --version`                                             | a version                 |

If something is missing:

- **Node 22:** https://nodejs.org (LTS installer), or `nvm install 22`.
- **JDK 17:** Windows `winget install EclipseAdoptium.Temurin.17.JDK`; macOS `brew install --cask temurin@17`; Debian/Ubuntu `sudo apt install openjdk-17-jdk`; Arch `sudo pacman -S jdk17-openjdk`.
- **Android SDK:** install Android Studio, open it once, and let the setup wizard install the SDK. Then set `ANDROID_HOME`:
  - Windows (PowerShell, then reopen the terminal): `setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"`
  - macOS: `export ANDROID_HOME="$HOME/Library/Android/sdk"`
  - Linux: `export ANDROID_HOME="$HOME/Android/Sdk"`

The build downloads the exact NDK and CMake versions it needs on its own. Allow it; do not install a different NDK by hand.

**Windows only, do this first:** React Native builds create very long file paths.

1. Clone into a short path such as `C:\gg` or `G:\gg` (not a deep folder).
2. Enable long paths once, in an **Administrator** PowerShell:
   ```powershell
   git config --system core.longpaths true
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
   ```

### B2. Get the code and install

```bash
git clone https://github.com/atreyakamat/gupit-goa.git gg
cd gg
npm ci
```

Expect: `npm ci` finishes without errors (warnings about deprecated packages are fine). Use `npm`, not yarn or pnpm: the lockfile is npm's.

### B3. Sanity check before the slow part (about 1 minute)

```bash
npm run typecheck
npm test
```

Expect: no TypeScript errors and all tests passing. If this fails, stop: the checkout is broken and the APK build will not fix it.

### B4. Generate the Android project

```bash
cd apps/mobile
npx expo prebuild --platform android --no-install
```

Expect: `Finished prebuild` and a new `apps/mobile/android/` folder. It is generated output; never edit or commit it. To regenerate from scratch, add `--clean`.

### B5. Build the APK

macOS / Linux:

```bash
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Windows (PowerShell):

```powershell
cd android
.\gradlew.bat assembleRelease "-PreactNativeArchitectures=arm64-v8a"
```

- First build: **15 to 40 minutes** and several GB of downloads (Gradle, NDK, compiling native code). Later builds take a few minutes. It can look stuck on `:app:buildCMake...` for a long time; it is not.
- `arm64-v8a` covers practically every Android phone sold since about 2017. For very old 32-bit phones or an x86 emulator, use `-PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64` (slower, bigger APK).
- Expect the last lines to include `BUILD SUCCESSFUL`.

The APK is at:

```
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Check it exists and is a sensible size (roughly 30 to 80 MB):

```bash
ls -lh app/build/outputs/apk/release/app-release.apk
```

---

## Part C (optional): connect the real backend

Without this the app runs in preview mode, which is fine for looking at the UI. For real data:

1. Follow **section 1** of [`docs/runbook.md`](docs/runbook.md): create a Supabase project, run `npx supabase db push`, add yourself to `admins`.
2. Create `apps/mobile/.env` (it is git-ignored) with the project's **public** values:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
   ```
   Only these two. Never the service-role key. `EXPO_PUBLIC_MAP_STYLE_URL` is optional; leave it out to keep OpenFreeMap.
3. Rebuild from **B5** (the values are compiled in at build time; `prebuild` does not need to run again).
4. For CI builds, add the same two names under repository **Settings -> Secrets and variables -> Actions -> Variables** (Variables, not Secrets: they are public values) and re-run the **Android APK** workflow.

The catalogue starts empty. Add and publish places from inside the app: More -> Team sign-in -> Review and admin.

---

After the backend is connected, follow `docs/runbook.md` section 1, steps 6 and 7, to switch on optional accounts (email code template) and load the first research leads for review.

## Part D: install and check

### Install

With a phone connected by USB (Developer options -> USB debugging on):

```bash
adb devices                      # the phone must be listed as "device"
adb install -r path/to/gupit-goa.apk
adb shell monkey -p app.gupitgoa.mobile -c android.intent.category.LAUNCHER 1
```

Without a cable: send the APK to the phone (Drive, WhatsApp to yourself, USB copy), tap it, and allow "Install unknown apps" for the app you opened it from. Play Protect may warn because the APK is not from the Play Store; choose "Install anyway".

### Smoke test (2 minutes)

- [ ] The app opens to a welcome screen, then **Explore Goa** shows a list of places.
- [ ] In preview mode a blue "Preview data" banner is visible.
- [ ] The map button (top right) shows a map of Goa with pins; tapping a pin shows a card.
- [ ] Opening a place shows details, a crowd card, and **Try instead** on a busy place.
- [ ] **Save** adds the place to a list under the Saved tab; it still opens in airplane mode.
- [ ] **Near me** explains why it wants location before the system prompt, and the app keeps working if you decline.
- [ ] Search for "forts" returns forts.

If the app closes immediately on launch, capture the reason:

```bash
adb logcat -d -t 300 | grep -iE "AndroidRuntime|FATAL|ReactNative|gupit" | tail -60
```

---

## Troubleshooting

| Symptom                                                                                | Cause                                                                                 | Fix                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SDK location not found`                                                               | `ANDROID_HOME` is not set in this terminal                                            | Set it (B1) and reopen the terminal. Or create `apps/mobile/android/local.properties` with `sdk.dir=/full/path/to/Android/Sdk` (on Windows use `\\` between folders) |
| `Unsupported class file major version` or a Java version complaint                     | Wrong JDK                                                                             | `java -version` must say 17. Point `JAVA_HOME` at JDK 17                                                                                                             |
| `Filename longer than 260 characters`, or CMake/ninja "No such file" on Windows        | Long paths                                                                            | Do the Windows steps in B1 and clone into a short folder                                                                                                             |
| `Could not determine the dependencies of task ':app:...'` right after pulling new code | Stale generated project                                                               | `cd apps/mobile && npx expo prebuild --platform android --no-install --clean`, then B5                                                                               |
| Out of memory / Gradle daemon disappeared                                              | Not enough RAM for the build                                                          | Close other apps, then add `-Dorg.gradle.jvmargs="-Xmx4g"` to the gradlew command. Build only `arm64-v8a`                                                            |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY is a Supabase service-role key` at launch               | The wrong key was put in `.env`                                                       | Use the anon / publishable key. Rotate the service-role key, because it has been on this machine in a file meant for public values                                   |
| Map area is blank but the rest works                                                   | The phone cannot reach `tiles.openfreemap.org` (offline, or a network that blocks it) | Check the connection. To use another provider set `EXPO_PUBLIC_MAP_STYLE_URL` and rebuild                                                                            |
| App shows "Preview data" after you set up the backend                                  | The env file was missing or misnamed at build time                                    | The file must be `apps/mobile/.env`, with both values, **before** running B5. Rebuild                                                                                |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE`                                                   | An APK signed with a different key is installed                                       | `adb uninstall app.gupitgoa.mobile`, then install again                                                                                                              |

---

## What this APK is, and is not

- It is a **release build** (fast, JavaScript bundled inside) signed with Android's **debug key**. That is right for testing and sending to friends or partners.
- It is **not** a Play Store build. For the store you need your own upload keystore and an AAB. The simplest route is EAS: `npm i -g eas-cli && eas login && eas build --platform android --profile production` from `apps/mobile` (`eas.json` is already set up). EAS creates and stores the keystore for you. Do that only when you are ready to publish.
- The app ID is `app.gupitgoa.mobile`. Change `android.package` in `apps/mobile/app.config.ts` before your first store upload if you want a different one; it cannot be changed afterwards.
