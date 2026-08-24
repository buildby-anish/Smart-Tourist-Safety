# Suraksha Setu — Native iOS/Android (Capacitor, testing build)

This wraps the **existing** `frontend/` React app as-is — same components, same
`src/lib/api.ts`, same SOS offline queue — inside a native shell using
[Capacitor](https://capacitorjs.com/). No rewrite. It talks to your Railway
backend and Supabase DB exactly like the Vercel-hosted site does.

Since this is for **testing only** (no App Store / Play Store submission),
there's no signing key or developer account cost involved for Android, and
iOS just needs a free Apple ID + a Mac.

---

## 1. One-time local setup

```bash
cd frontend
npm install
npx cap add android   # creates frontend/android
npx cap add ios        # creates frontend/ios (only works on macOS)
```

Set your Railway API URL so the bundled build points at it (create
`frontend/.env.production`):

```
VITE_API_BASE_URL=https://<your-railway-app>.up.railway.app/api/v1
```

Your backend's CORS config (`backend/main.py`) already allows any `https://`
origin plus localhost, and Capacitor apps load from `https://localhost` by
default — so **no backend changes are needed**.

---

## 2. How "update on git push" works here

You chose **bundle everything** for the best offline experience, which means
the app's UI/JS/CSS is compiled *into* the binary, not fetched from the
network at runtime. That's what makes it work with zero connectivity — but it
also means a code change requires a new build, not just a server-side deploy.

I've added `.github/workflows/android-build.yml`, which does that rebuild for
you automatically:

1. You `git push` to `main`.
2. GitHub Actions checks out the code, runs `npm run build`, syncs it into
   the Android project, and builds a debug APK.
3. Go to the repo's **Actions** tab → the latest run → download the
   `suraksha-setu-debug-apk` artifact.
4. AirDrop/transfer the `.apk` to your Android phone, open it (enable
   "Install unknown apps" for your file manager/browser once), and it
   installs over the previous version.

Set `VITE_API_BASE_URL` as a repo **Variable** (Settings → Secrets and
variables → Actions → Variables) so the CI build knows your Railway URL.

**iOS has no equivalent free CI path** — Apple requires a Mac to sign
anything, even for your own device, and a free Apple ID's provisioning
profile expires every **7 days**. So for iOS: after `git push`, run this on
your Mac when you want the update on your phone:

```bash
cd frontend
npm run ios:sync
npx cap open ios
# In Xcode: select your device → ▶ Run. Trust the developer certificate
# once in Settings → General → VPN & Device Management on the iPhone.
```

If you don't have a physical iPhone handy, `npm run ios:run` targets the
Simulator instead and has no 7-day limit.

---

## 3. What already works offline

- **App shell** (every screen, nav, forms) — bundled locally, works with
  airplane mode on.
- **SOS panic button** — already offline-first (see
  `frontend/SOS_IMPLEMENTATION.md`): queues to IndexedDB, auto-syncs on
  reconnect.
- **Last-known GPS location** — cached locally for SOS fallback.

## 4. What still needs a connection

- Logging in, fetching live tourist/alert/geofence/incident lists, and
  real-time WebSocket updates (`ws.py`) all require reaching the Railway
  backend — there's no local cache for these yet. If you want the dashboards
  to show last-seen data while offline too (not just SOS), that's a follow-up
  I can build: a small IndexedDB cache-and-fallback wrapper around the
  existing `fetch` calls in `src/lib/api.ts`, following the same pattern
  already used for SOS.

## 5. Android: local build without CI (optional)

```bash
cd frontend
npm run android:sync
npx cap open android
# In Android Studio: ▶ Run, or Build > Build Bundle(s)/APK(s) > Build APK(s)
```

## 6. App icon / splash screen (cosmetic, optional)

Default Capacitor icon is used for now. To brand it, drop a 1024×1024 PNG at
`frontend/resources/icon.png` and a 2732×2732 PNG at
`frontend/resources/splash.png`, then:

```bash
npx @capacitor/assets generate
```
