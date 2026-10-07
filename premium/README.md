# Soro X `premium/`

This folder was Natively's private `premium` submodule. Soro X does not have that
code. What is here now is **Soro X's own implementation** of the parts of the
interface the core app loads at runtime. Everything else the core app asks
`premium/` for is left out of the build and reported as "not available".

This project is based on Natively, originally developed by Natively AI Private
Limited, and this folder is distributed under the same license as the rest of
the repository (see `../LICENSE`).

## What is implemented

| Module | Loaded by | What it does |
|---|---|---|
| `electron/knowledge/KnowledgeOrchestrator.ts` | `electron/main.ts` | Profile engine: résumé / job-description ingest, profile mode, the context block added to live answers, Profile screen data |
| `electron/knowledge/KnowledgeDatabaseManager.ts` | `electron/main.ts` | Stores the active résumé and JD in the app's SQLite database (`sorox_profile_documents`) |
| `electron/knowledge/ProfileExtractor.ts` | the orchestrator | Turns document text into structured facts with your own AI provider; falls back to a plain-text heuristic |
| `electron/knowledge/NegotiationConversationTracker.ts` | `electron/main.ts` | `textHasCompEvidence()`: spots salary talk so it is not treated as résumé recall |
| `electron/knowledge/types.ts` | `electron/ipcHandlers.ts` | `DocType` |
| `src/ModesSettings.tsx` | `src/premium/index.tsx` | Modes screen: switch modes, add/remove modes, and the Soro X switch |

## What is not implemented

Company research, Tavily search, negotiation coaching, cover letters, Role
Insight, licensing and the promo pop-ups. These stay behind Natively's own
Pro / trial check, so they show "Pro license required" or "not available".

## Turning it on

The profile engine is unlocked by the **Soro X profile engine** switch, not by
Natively's Pro check (`electron/services/soroxLocalFeatures.ts`). Turn it on
from the Profile Intelligence screen ("Use Soro X profile engine") or the
Modes screen.

## Tests

```
npm run build:electron
node --test premium/electron/knowledge/__tests__/SoroxProfileEngine.test.mjs
```
