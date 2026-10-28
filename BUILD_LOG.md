# Build log

One entry per working session: what changed, how it was tested, which fallbacks were taken.

## 2026-10-28, planning
- Read the brief and the reference document; researched BSE/NSE endpoints from the
  maintained open-source wrappers' source, screener's live page structure, Gemini/Groq
  free tiers and hosting limits. Wrote the strategy and build spec (`docs/FINN_SPEC.md`).

## 2026-10-28 to 29, build
- **Architecture change from the spec (deliberate):** one TypeScript Next.js app on Vercel
  instead of Next.js + a Python worker on Render. GitHub Actions is the clock and the
  heavy runner (it runs `scripts/finn.ts tick` every 10 minutes); Vercel runs the web app
  and on-demand dossier builds in resumable steps under a lease (client polling drives
  continuation within the 300-second function limit). Reasons: one language, two fewer
  accounts, and the sandbox this was built in can reach GitHub but not Render.
- Pipeline: ordered regex rules (41, tested), set-based grouping (results day = one
  event), results extraction from the one statement page (pdf-lib subset sent to Gemini),
  six arithmetic and sanity checks with one corrective retry, people extraction with
  quote checks and grounded background search, batched one-liners with amount grounding,
  scoring, signals with "explained by", alert rules, Web Push with VAPID keys generated
  into the database (no human ever handles the private key).
- Research: screener tables -> facts in code; transcript and annual-report passes with
  quote validation; the Say-vs-Do ledger computed by code (delivered / near miss / missed /
  on track / off track / revised / pending / basis differs); judge for qualitative claims;
  strongest model writes only cited bullets from compact JSON; number grounding drops
  any bullet whose numbers are not in the facts or cited pages.
- Tests: 51 vitest tests, including two end-to-end runs on PGlite (real Postgres in
  process) with real PDFs served from localhost and deterministic model stand-ins.
- UI: reviewed at 390x844 in light and dark from a synthetic preview database
  (`scripts/dev/preview-db.ts`, never deployed).
