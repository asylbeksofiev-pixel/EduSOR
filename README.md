# EduSOR

EduSOR is a modern platform for running and checking **СОР / СОЧ** (summative assessments) in Kazakhstan schools. Teachers create assessments manually, import them from documents, or check written/scanned СОР/СОЧ papers via **Google Gemini AI** (`/teacher/ai-checker`). Students take assessments comfortably on mobile phones or laptops, objective questions are graded automatically, Gemini suggests descriptor-based scores for open answers, and teachers approve and release results with AI mistake explanations.

The interface supports **Russian** and **Kazakh**, **Light** and **Dark** Liquid Glass + Soft Plasmamorphism themes, and 4 roles: platform super admin, school administrator, teacher, and student.

## Stack

Next.js 15 (App Router, Server Actions, Route Handlers) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Radix UI · Montserrat & Poppins · Lucide · React Hook Form + Zod · Recharts · KaTeX · Dual-Mode Database (**Built-in Local SQLite WAL** + **Supabase Postgres/Auth/Storage/RLS**) · **Google Gemini API** (+ OpenAI-compatible fallback) · Vitest · Playwright.

## Quick start (Local SQLite Mode — works immediately without Docker)

Requirements: **Node 22+**.

```bash
npm install
npm run dev
```

1. On first run, EduSOR automatically initializes and seeds `data/edusor.sqlite` and local storage in `data/storage/`.
2. Open `.env` and paste your **Google Gemini API key** into the placeholder slot:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. Open `http://localhost:3000`:
   - Register a new **Student** (enter class code `7AMATH` to join 7А immediately), **Teacher** (school code `GYM1AST`), or **School Admin** (creates your new school immediately), OR
   - Use the **1-click Demo Login** buttons on `/login` (password for seeded accounts: `EduSor-dev-2026`):

| Role | Sign in with |
|---|---|
| Platform super admin | `superadmin@edusor.local` |
| School admin (Школа-гимназия № 1, code `GYM1AST`) | `admin@gym1.edusor.local` |
| Teacher (math 7А `7AMATH`, 7Б `7BMATH`, physics 9А `9APHYS`) | `teacher@gym1.edusor.local` |
| Teacher (Kazakh 7А, biology 9А) | `teacher2@gym1.edusor.local` |
| Students of 7А (login, no email) | `aidar.s`, `aruzhan.k`, `daniyar.n`, `madina.t`, `timur.b`, `amina.zh` |
| Second school (isolation tests) | `teacher@lyc2.edusor.local`, `lyc2.student` |

## Cloud Supabase Mode (optional)

Set `DATABASE_MODE=supabase` in `.env` along with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, and apply all migrations in `supabase/migrations/`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | RLS/security tests |
| `npm run test:e2e` | Playwright end-to-end tests |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — structure, data model, security model, workflows
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Supabase + Vercel production setup
- [docs/AI.md](docs/AI.md) — Google Gemini API & OpenAI-compatible configuration, privacy, and validation
- [docs/TESTING.md](docs/TESTING.md) — test layers and how to run them
- [docs/SECURITY.md](docs/SECURITY.md) — security review and known limitations
