# Soro X Tablet (Android tablet + iPad)

A companion app for **Soro X on your computer**. Soro X itself is a desktop app:
it listens to the meeting, captures the screen and runs the AI on your Mac or PC.
The tablet app pairs with it over your Wi-Fi and gives you a large, touch-friendly
view of it:

- live answers as they stream, and the transcript beside them (split view on tablets)
- ask questions, tap quick actions (*What to answer*, *Follow up*, *Recap*…)
- capture your computer's screen, or send a photo from the tablet to the AI

It is the desktop's **Phone Mirror** page (Settings → **Sync**) inside a native
app with QR pairing. Nothing goes through a cloud server: the tablet talks only
to your computer, on your local network. Answers use the AI keys set on your
computer.

## Use it

1. On your computer: **Soro X → Settings → Sync** → turn on **Enable Phone Mirror**
   and **Allow LAN access**.
2. Tablet and computer on the **same Wi-Fi**.
3. Open Soro X on the tablet → **Scan QR code** (or *Photo of QR code*, or paste
   the link).
4. To get back to the pairing screen: **Back** on Android, **swipe from the left
   edge** on iPad.

The pairing code changes each time Soro X restarts on your computer; scan the
new code (the tablet remembers the computer's address).

## Get the app

**From GitHub Actions (no tools needed):** every push that touches `tablet/` runs
the *Soro X Tablet apps* workflow. Open the run → *Artifacts*:

- `soro-x-tablet-android-apk` → `app-debug.apk`. Copy it to the tablet and open
  it (allow "Install unknown apps" for your file manager or browser).
- `soro-x-tablet-ios-unsigned-ipa` → `SoroX-Tablet-unsigned.ipa`. iPadOS only
  installs signed apps: sign and install it with your Apple ID using a sideloading
  tool (e.g. AltStore or Sideloadly), or build it yourself in Xcode (below).

**Build it yourself**

```bash
cd tablet
npm ci
npm run sync            # copies the web app into android/ and ios/
```

- Android: open `tablet/android` in Android Studio and press Run, or
  `cd android && ./gradlew assembleDebug` (needs the Android SDK and JDK 21).
- iPad: on a Mac with Xcode 26, open `tablet/ios/App/App.xcodeproj`, choose your
  Apple ID team under *Signing & Capabilities*, connect the iPad and press Run.

Icons and splash screens: `python3 tablet/scripts/generate-icons.py`.
Tests: `npm test` (pairing-link rules).

## Security notes

- The companion page is plain `http` on your LAN (that is how the desktop serves
  it). The pairing code is in the link: only scan it on a network you trust, and
  use *Rotate token* in Settings → Sync if a link leaked.
- The app only opens private-network addresses (192.168.x.x, 10.x.x.x,
  172.16–31.x.x, 169.254.x.x, *.local); everything else is refused.

This project is based on Natively, originally developed by Natively AI Private
Limited. Personal, non-commercial use only (see `../LICENSE`).
