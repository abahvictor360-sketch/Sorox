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
| `electron/knowledge/CompanyResearchEngine.ts` | the orchestrator | Company Intel dossier: your Tavily key's web search (optional) summarised by your AI provider; LLM-only and marked as such without a key |
| `electron/knowledge/TavilySearchProvider.ts` | `electron/services/resolveCompanySearchProvider.ts` | Tavily search + page extract with your own key |
| `electron/knowledge/ProfileGenerators.ts` | the orchestrator | Cover letter and salary negotiation script |
| `electron/knowledge/roleInsight/RoleInsightService.ts` | the orchestrator | Role Insight: requirement-by-requirement fit, talking points, likely questions, "I have this" corrections |
| `electron/knowledge/roleInsight/JdSourceResolver.ts` | `roleInsight:import-jd-url` | Import a job description from its URL (Tavily) |
| `src/ModesSettings.tsx` | `src/premium/index.tsx` | Modes screen: switch/add/remove modes, describe-a-mode generation, per-mode instructions and reference files, and the Soro X switch |
| `src/RoleInsightPanel.tsx` | `src/premium/index.tsx` | Role Insight screen and the negotiation script |

The switch also opens mode features whose code was already public and runs on
your own AI key: mode instructions, reference files, note sections, "describe a
mode" generation and re-summarising a meeting in a different mode.

## What is not implemented

Live negotiation coaching during a call, automatic company research on job
upload (it spends your credits; Soro X researches when you ask), Natively's
experimental knowledge packs, licensing, Natively's hosted API and the promo
pop-ups. These stay behind Natively's own Pro / trial check or are absent.

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
