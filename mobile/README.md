# Soro X Mobile

The Soro X interview assistant for Android phones (and iPhone/iPad). It runs on
**your own AI key** (Claude, OpenAI, Gemini or Groq) and needs no computer:

- **Live** — listens to the interview, spots the interviewer's questions and drafts
  an answer from your CV and the job (STAR for behavioural questions).
- **Practice** — a mock interviewer for your target job; answer out loud, get a
  score, what to fix and a stronger answer.
- **Prep** — "Tell me about yourself", likely questions, role fit, STAR stories,
  company brief, questions to ask, salary negotiation script, cover letter.
- **Profile** — your CV (PDF / Word / text) and the job description.
- **Settings → Connect to Soro X on your computer** — opens the desktop app's
  phone view over Wi-Fi (Settings → Sync on the computer).

Keys, CV and documents stay on the phone and are sent only to the AI / speech
provider you chose.

## Build

```
npm ci
npm test
npm run build && npx cap sync
cd android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions builds the APK and an unsigned iOS app on every push to
`mobile/` (workflow "Soro X Mobile apps"); "Publish Soro X release" puts them on
the Releases page as `SoroX-Android.apk` and `SoroX-iPhone-unsigned.ipa`.

Icons: `python3 tablet/scripts/generate-icons.py mobile`.

On iPhone/iPad, "Phone" listening is not available yet (the speech plugin has no
Swift package); choose Deepgram, Groq or OpenAI listening there.

---

This project is based on Natively, originally developed by Natively AI Private
Limited. Natively Personal Use Source License v1.0: personal, educational,
research and non-commercial use only.
