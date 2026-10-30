# AI configuration

EduSOR natively supports **Google Gemini REST API** (`generativelanguage.googleapis.com/v1beta/models/...:generateContent`) as the primary AI provider (`AI_PROVIDER=gemini`, configured via `GEMINI_API_KEY` in `.env`), as well as any **OpenAI-compatible Chat Completions API** (`AI_PROVIDER=openai`).

| Variable | Example |
|---|---|
| `AI_PROVIDER` | `gemini` (default) or `openai` |
| `GEMINI_API_KEY` | Google AI Studio Gemini API key (server only — put in `.env`) |
| `GEMINI_MODEL_TEXT` | `gemini-2.5-flash` (used for СОР/СОЧ grading, structuring, explanations) |
| `GEMINI_MODEL_VISION` | `gemini-2.5-flash` (used for multimodal photo/scan СОР/СОЧ checking & OCR) |
| `AI_API_BASE_URL` | `https://api.openai.com/v1` (fallback when `AI_PROVIDER=openai`) |
| `AI_API_KEY` | OpenAI-compatible provider key (server only) |
| `AI_MODEL_TEXT` / `AI_MODEL_VISION` | OpenAI-compatible model names |
| `AI_TIMEOUT_MS` | default 60000 |
| `AI_MAX_RETRIES` | default 2 (429/5xx/timeouts, exponential backoff) |

Leave `GEMINI_API_KEY` (and `AI_API_KEY`) empty to disable AI. The UI then clearly prompts to add `GEMINI_API_KEY` in `.env`.

## Where AI is used

| Feature | Code | Output validation |
|---|---|---|
| Full СОР/СОЧ paper checking | `ai/tasks.ts › checkExamPaperWithGemini` + `POST /api/ai/check-exam` | task & descriptor scores clamped server-side; persisted in `ai_exam_checks` |
| OCR of scanned pages/photos | `ai/tasks.ts › ocrImage` | `{text, uncertain, notes}`; unclear fragments are marked `⟦?…?⟧` |
| Document → questions | `structureDocument` → `toEditableQuestion` | strict conversion; missing keys stay empty and block publishing |
| Grading suggestion | `suggestGrade` (grading worker) | criterion scores clamped to rubric maxima server-side; confidence < 0.7 → manual review |
| Error summary for teachers | `summarizeErrors` | anonymized answers only |
| Mistake explanation / follow-up | `explainMistake`, `followUp` | context built with the student's RLS client |
| Practice question | `generatePractice` | key stored server-side; checked deterministically |

Every response is parsed as JSON and validated with Zod; one corrective retry is made if the
model returns an invalid shape. Usage (tokens, latency, success) goes to `ai_usage`; failures to
`system_errors`.

## Data protection

- Student names, emails and logins are **never** sent to the provider. Grading prompts contain only
  the question, rubric, reference answer and the answer content.
- Student-facing AI only receives data the student can read after release: their answer, the
  released key/rubric (if the teacher allowed it) and released feedback. If the key was not
  released, explanations are disabled.
- Untrusted content (documents, student answers, chat messages) is fenced in tags, the model is
  told it is data, and tag look-alikes inside it are neutralized. Prompt-injection attempts in
  answers are expected to lower confidence and force manual review — the teacher always approves.

## Teacher controls (per assessment)

Show correct answers · AI explanations · follow-up questions · practice · release mode ·
grading profile (strict / balanced / supportive — affects only borderline interpretation, never the
maximum or factual correctness) · per-question “reveal after release”.

## Mock server (development only)

`scripts/mock-ai-server.ts` imitates the API deterministically so pipelines can be tested without a
key. All of its text starts with `[MOCK AI]`. Never point production at it.

## Status in this repository

The integration with a real provider has **not** been exercised in the development environment
where EduSOR was built (no provider key was available); all AI flows were verified end-to-end
against the mock server. Before production, run the super-admin connection test and try one
document, one grading suggestion and one explanation with the real model.
