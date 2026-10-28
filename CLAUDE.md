# FINN: notes for coding agents

FINN is a mobile-first investing agent: a ranked Brief of what changed across a
portfolio (push) and a Dossier that checks management's promises against what it
delivered (pull). `docs/FINN_SPEC.md` is the product and build spec; this file says
how the code is laid out and the rules that keep it honest.

## Layout
- `src/lib/sources/`: BSE, screener, Yahoo, PDF utilities. Pure fetch and parse.
- `src/lib/pipeline/`: ingest -> classify (rules first) -> group into events -> extract
  (results, people, one-liners) -> score -> signals -> alerts -> push. Each stage is
  idempotent and driven by status columns.
- `src/lib/research/`: dossier jobs: documents, transcript and annual-report extraction,
  facts (code only), the Say-vs-Do ledger (code only), synthesis with grounding, Ask.
- `src/lib/llm/`: the router (the only place that calls a model), schemas, pricing.
- `src/lib/tasks.ts`: the tick orchestrator (schedule, lease, deadlines).
- `src/app/`: static page shells (client components) and JSON route handlers.
- `scripts/finn.ts`: CLI used by GitHub Actions: probe, migrate, seed, backfill, tick, research.
- `db/schema.sql`: the only contract between the app and the pipeline.

## Commands
- `npm test` (vitest, includes PGlite end-to-end runs), `npx tsc --noEmit`, `npx eslint .`, `npx next build`
- `npx tsx scripts/finn.ts <command>` with DATABASE_URL set
- Local UI preview with synthetic data: `npx tsx scripts/dev/preview-db.ts`, then
  `DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres DB_POOL_MAX=1 npx next dev`

## Hard rules
1. Every model call goes through `src/lib/llm/router.ts`.
2. LLMs extract; code decides. Scores, arithmetic, QoQ/YoY, ledger statuses are code with tests.
3. Every extracted fact carries a quote and a page; drop facts whose quote is not on that page.
4. Money is Rs crore after extraction. Convert lakh, million and rupees at the boundary.
5. No page load calls a model or a scraper. Pages read the JSON API; the API reads Postgres.
6. Never request linkedin.com. Never use screener's prose (About, pros and cons, summaries).
7. UI copy: sentence case, numbers with units and signs, none of: robust, significant,
   notably, impressive, strong, delve, landscape.
8. This is Next.js 16 with Cache Components: no `runtime` or `dynamic` segment exports;
   route handlers call `connection()` (via `handle()`) before touching the database.
