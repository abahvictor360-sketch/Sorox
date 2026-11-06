# Soro X Mobile

The Soro X interview assistant for Android phones (and iPhone/iPad). It runs on
**your own AI key** (Claude, OpenAI, Gemini or Groq) and needs no computer:

- **Live**: listens, tells the interviewer from you, spots questions (even
  ones split over two sentences) and answers them on the spot from your CV and
  the job. Your own words and the questions you ask them are skipped. Quick
  actions like the desktop: What should I say?, Shorten, Recap, Follow-up
  questions, Clarify, an "Ask anything" box, **Read screen** (photograph a
  question on a screen, whiteboard or paper and get the answer) and **Note**.
  When pay comes up, the **negotiation coach** says what to do and what to say.
- **Knows your voice**: record about 15 seconds once (Me > Settings > Your
  voice). Every line is then matched against your voice print, so your own
  words and questions are never answered; it also learns the interviewer's
  voice as the interview goes, and from any line you correct. Only a voice
  print (numbers) is kept, on the phone. Works with Offline (Whisper),
  Deepgram, Groq and OpenAI listening.
- **Modes**: Job interview, Technical interview, Sales call, Meeting,
  Class / lecture, General, each with your own instructions.
- **Notes**: every session is saved with AI-written notes (summary, questions
  asked, action items, how it went), your own notes, the answers and the
  transcript; search, share or copy.
- **Practice**: full **mock interviews** (the AI interviews you for your target
  job one question at a time, follows up on thin answers, can read questions
  aloud and research the company on the web first, then writes a scored report
  saved to Notes), plus quick single-question practice with a score and a
  better answer.
- **Take note**: a Take note button on Live and in the glass view, and New note
  in Notes for notes outside a session.
- **Web search**: tap the globe in the Ask bar to answer from the web, with the
  pages used listed as links. Uses your Tavily key (Me > Settings > Web search,
  works with every AI), or Claude, Gemini or OpenRouter's own search. Prep's
  company brief, negotiation and questions-to-ask use the web too.
- **Prep**: pitch, likely questions, role fit, STAR stories, company brief,
  questions to ask, salary script, cover letter.
- **Me**: Profile (CV + job), Schedule (interviews: at the start time a
  notification opens Soro X already listening), Settings.
- **Turns itself on**: optionally when the app opens, when a scheduled
  interview starts, or when you return to the app during one. **Standby**
  listens quietly and turns on by itself at the first question.
- **Glass view**: the latest question and answer in large text on a
  translucent panel (adjustable size, earlier answers), good for a tablet on a
  stand or in split screen next to another app.
- **AI providers**: Claude, OpenAI, Gemini, Groq, OpenRouter, NVIDIA (your key).
- **Listening**: the phone's own recognition (free), **offline Whisper on the
  phone** (one-time download, then no internet needed; audio never leaves the
  phone), Deepgram (tells speakers apart: the most reliable way to know who
  asked), Groq or OpenAI.
- **Tablets**: side rail and transcript + answers side by side.
- **Connect to Soro X on your computer**: opens the desktop app's phone view
  over Wi-Fi.

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
Swift package); choose Offline (Whisper), Deepgram, Groq or OpenAI there.

---

This project is based on Natively, originally developed by Natively AI Private
Limited. Natively Personal Use Source License v1.0: personal, educational,
research and non-commercial use only.
