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

## 2026-10-29, tuning on real filings (offline)
- A `fixtures` workflow captured 30 days of real BSE filings for the 18 holdings, the
  screener pages, eight results PDFs and 45 disclosure PDFs onto a `fixtures` branch.
  The sandbox cannot reach BSE; GitHub Actions can, so this is how real data got here.
- `scripts/dev/replay.ts` replays those filings through classification and grouping on
  an in-memory Postgres with no network and no model, and prints the ranked list.
- Classification: rules place 201 of 224 real filings (89.7%). A bare board outcome on a
  results day joins the results (3). Generic "Disclosure under Regulation 30" filings
  are read from the letter itself: the "Sub:" line, then the body's first sentences
  with regulation boilerplate and the signature removed. All 15 such filings in the
  sample now place without a model (customs and tax orders, DoT notices, a director
  re-appointment, a bank's business update, a subsidiary liquidation, a correction).
- Grouping: repeat filings of one action merge (Info Edge's MD transition was filed four
  times), a dividend joins its record date, and an IPO's two weeks of updates become one
  thread. Board notices feed the results calendar; a rescheduled meeting moves.
- Scoring: deals are sized against market value and orders against revenue. A ₹50 crore
  startup stake at a ₹1 lakh crore company is routine; subsidiary set-ups, closures and
  intra-group mergers are housekeeping.
- Results PDFs: the page finder now reads scanned statements (HDFC Bank's text layer
  writes the letter O for zero; Info Edge's OCR is garbled). When unsure it sends the
  model a few candidate pages and records which one it read.
- Research: lenders get bad-loan ratios (from the bank-level table when the consolidated
  one is blank) instead of cash conversion; no "% change" across a loss anywhere; one
  call per quarter in the dossier (no investor-day or duplicate-host repeats).
- Tests: 112, including real text layers, real letters and real filing subjects.

## 2026-10-29, live on Vercel and Supabase: QA on real data
- Deployed to Vercel (Mumbai) with Supabase Postgres through the transaction pooler; GitHub
  Actions runs the clock and every operator command (`ops`, `research`, `qa`, `eval`, `diag`,
  `dump`), so the whole system was run and debugged from this chat without database access.
- Second clock: GitHub's scheduler ran once in six hours, so a visit to the Brief or Alerts
  starts a background tick when the pipeline has been quiet for 15 minutes.
- Free-tier reality: Flash's daily quota ran out within an hour and Gemini 2.5 is closed to
  new keys. The router now skips spent models until the daily reset (shared through the
  database), keeps Flash-Lite at the end of every chain, and upgrades cached summaries
  written by a fallback model when the better one is back.
- A `qa` workflow takes phone screenshots of every screen in both themes, collects console
  errors and API timings, and runs Lighthouse (mobile: 97 / 100 / 100 / 100) onto a branch.
- Live fixes: alert a price move only after its filings are grouped; neutral empty states;
  handovers (an additional charge returned, a successor named, the CEO staying on the board)
  are not unplanned exits; a subsidiary board seat is not a new chairman; one letter filed
  under three subcategories (same attachment) is one event; rating actions are not sized
  by their bank lines; small exceptional items are not reasons.
- Say vs Do, the important one: L&T showed "0 resolved promises" because Flash-Lite had
  copied the prompt's "FY27" into every FY26 promise, kept "Rs 1,356 billion" as 1,356 crore
  and filed working capital under net debt. A `dump` workflow exported the real extracts;
  `normalize.ts` now re-derives each promise's period, units, metric and scope from its own
  quote and page, and the ledger chains revisions call to call. Replayed on the five dossiers:
  L&T's FY26 revenue promise (15%) is missed at 11.8%, its working-capital target (12%, cut
  to 10%) delivered at 4.1%; Infosys's FY26 guidance (3–3.5% in constant currency, 20–22%
  margin) delivered at 3.1% and 21%; Bajaj Finance's FY26 AUM growth delivered.
  The extraction prompt now gives each call its own year words and conversion examples.
- Tests: 149.
