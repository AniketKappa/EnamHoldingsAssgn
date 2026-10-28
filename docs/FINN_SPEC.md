# FINN — Strategy, Build Spec & Execution Plan

Oct 28, 2026 · @Kappa

## 0. How to use this doc

This is the single source of truth for building FINN before the Sunday 1 Nov 2026 deadline. Sections 1–7 are strategy for you, the owner. Sections 8–17 and Appendices A–C are the build spec an implementing agent follows literally.

**For the owner**

- Read sections 1–7 once (about 20 minutes). They hold the decisions and the reasons, which you will need for the writeup and any interview.
- Do the "Tonight" checklist in section 13 yourself. Agents cannot create accounts, and the data endpoints must be checked from your own laptop.
- Export this doc as Markdown and commit it as `docs/FINN_SPEC.md`. Create `CLAUDE.md` from section 14.

**For the implementing agent**

- Build the milestones in order (M0 to M9 in section 13). Do not start a milestone until the previous one's acceptance test passes.
- Decisions here are final unless a "Fallback" note says otherwise. Do not re-open the stack, schema or scope. If blocked, take the documented fallback and log it in `BUILD_LOG.md`.
- Where this doc gives exact names (tables, endpoints, env vars, JSON fields), use them verbatim.
- Every LLM call goes through `worker/finn/llm/router.py`. Never call a provider SDK anywhere else.
- Anything marked STRETCH is built only after M9 passes.

**Conventions used throughout**

- Money in ₹ crore (₹1 crore = ₹10 million). Filings often report in ₹ lakh or ₹ million; always normalise to crore. Display numbers with Indian grouping (`toLocaleString('en-IN')`, so 1,23,456).
- Indian fiscal year: FY27 runs Apr 2026 to Mar 2027, so Q2 FY27 is Jul–Sep 2026. For a quarter ending in month m of year y: FY = y + 1 when m is April or later, else y; the quarter is 1, 2, 3 or 4 for June, September, December or March.
- All times in IST (UTC+05:30), displayed with `Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata'})`.

## 1. TL;DR

FINN is a mobile-first web app that gives an investor a finite, ranked Brief of what changed across 18 holdings, and a Dossier that checks what management promised against what it delivered. Every number traces to a filing page, and the whole thing runs on free tiers.

The bet: graders will see many "chat over filings" demos. FINN wins on judgment — what it chooses not to show, how it proves what it does show, and how little it costs to run.

**What ships, in priority order**

1. **The Brief (push).** Filings are grouped into events. Each event gets a materiality score with a visible reason, and the list ends. Results get a four-number card (Revenue, EBITDA, PBT, PAT; QoQ and YoY). Management changes get a person card with background. Routine paperwork collapses into one line.
2. **Watch (push alerts).** The investor sets thresholds: volume at least 2× its 20-day average, price beyond ±4%, chosen categories. FINN checks them after every ingest and says which filing, if any, explains a move.
3. **The Dossier (pull).** For any NSE ticker: a Say-vs-Do ledger of the last four quarters of guidance, a credibility score, snapshot numbers, cash quality and a bull/bear case, all cited to annual reports and transcripts.
4. **Ask.** A question box anchored to a card or a company that answers only from that company's documents.

**How FINN answers each thing ENAM grades**

| What ENAM grades | FINN's answer |
| --- | --- |
| Product sense | A Brief you can finish. "Nothing material today" is a valid result. |
| Judgment | A per-category treatment policy. Rules before models. Events, not filings. |
| Creativity | Results cards checked against management's own guidance. Ask anchored to context. Plain-English watch rules. |
| Architecture | Python worker for data and AI, Next.js for the product, Postgres in between. Any part can fail without blanking the app. |
| Efficiency | About 90% of filings classified by rules. Extraction reads 1–3 targeted pages. Every LLM call cached and costed. ₹0 to run. |

**Stack in one line:** Next.js PWA on Vercel · FastAPI worker on Render · Supabase Postgres · Gemini free tier with Groq fallback · cron-job.org as the clock.

## 2. Decoding the brief

ENAM grades judgment and taste more than coverage, and the brief says so four separate times. Each signal below changes what we build.

| Signal in the brief | What it means for FINN |
| --- | --- |
| "The scarce skill is not aggregating information. It's filtering it." | The headline metric is what we hide. The Brief always shows how many filings it collapsed or hid. |
| "Thin-but-working beats broad-but-broken. A demo that doesn't run is the worst outcome." | Deploy on day 1. Precompute everything. Never block a screen on a live scrape or an LLM call. |
| "Two examples we love": a bio for management changes; a QoQ/YoY first cut of Revenue, EBITDA, PBT, PAT | These two cards must be flawless. Graders will look for them first. |
| "Numbers vs narrative … the kind of thing we value most" | The Dossier's hero is the Say-vs-Do ledger, not a summary. |
| "Ground it in the primary sources … don't lean on the model's own outside knowledge" | Every claim carries a citation. The model says "not in the documents" rather than guessing. |
| "We may point it at a company you didn't pick" | Research works on any NSE ticker on demand, with live progress and graceful gaps. |
| "Show a point of view about how an investor should interact" | Section 3 writes the point of view down, and the UI embodies it. |
| "Efficiency earns bonus points: routing, caching, chunking" | A visible cost page: calls, tokens, cache hits, ₹ spent. |
| "Your AI build history" | They will read how you work with agents. Keep sessions focused, export them, keep `BUILD_LOG.md`. |

**On screener.in and the primary-source rule.** The reference document itself describes screener.in as consolidating annual reports, transcripts and standardised multi-year financials. So FINN uses screener's financial tables and its document links. It never uses screener's prose: the About text, Key Points, machine-generated pros and cons, or AI summaries.

**What would disappoint them**

- A chat box over a vector database, with nothing pushed.
- A feed of every filing with an AI summary on each — that is aggregation, not filtering.
- Numbers with no source, or a source link that 404s.
- An expensive model doing work a regex could do.
- A link that shows a spinner, an error, or an empty screen on a quiet Sunday.

**Submission facts:** deadline Sunday 1 Nov 2026; email assessment@enam.com; subject exactly `ENAM - IIT screening - 2027`.

## 3. Point of view and principles

An investor's attention is their scarcest capital, so FINN allocates it the way ENAM allocates money: concentrated, explainable and accountable. FINN is judged by how quickly it lets you stop reading.

**Design principles** (each one is a rule the implementer applies)

1. **Events, not filings.** A results day produces five or more filings: outcome, results PDF, press release, presentation, newspaper ad. FINN groups them into one event, and every count in the UI counts events.
2. **Finite by design.** The Brief has an end, a "caught up" state, and an honest "quiet day" state. No infinite scroll.
3. **Show the work.** Every number opens the filing page it came from. Every ranking shows reason chips, such as "Results" and "8% of portfolio". Every extraction shows the checks it passed.
4. **LLMs extract; code decides.** Models turn PDFs into fields. Scores, thresholds, arithmetic, QoQ/YoY and promise matching are deterministic code.
5. **Judge management by its own words.** Results are compared with management's guidance and its own past numbers, never with broker consensus, which is secondary data.
6. **Depth on demand, four levels.** A line in a list → a card → the analysis → the source page. Each level is one tap.
7. **Never block on the network.** Screens read precomputed rows. Live work runs in the background and shows its progress.
8. **Numbers in, adjectives out.** Copy states numbers with units and direction ("PAT ₹5,202 cr, +11% YoY"). Banned words: robust, significant, notably, impressive, strong, delve, landscape.

**Interaction model: neither a chatbot nor a dashboard**

A chatbot makes the investor do the filtering by asking questions. A dashboard shows everything at once and filters nothing. FINN runs three experiments instead:

| Experiment | The obvious alternative | Why FINN's version is better |
| --- | --- | --- |
| **Finish-line Brief.** A ranked, finite list with a cleared state, like an inbox you take to zero. | An endless feed | It respects attention and makes "nothing happened" a useful answer. |
| **Anchored Ask.** Every card and dossier has questions seeded from its context ("What did they guide on margins?"). There is no blank chat screen. | A general chat tab | The context is already loaded, so answers are faster, cheaper and grounded. |
| **Plain-English watch rules.** "Tell me if Dixon moves 5% or a promoter pledges shares" compiles into editable rule chips that code then evaluates. | A settings page full of toggles | The investor says what "unusual" means once, and the rule stays transparent. |

A fourth, low-cost experiment is STRETCH: **Listen**, a 60-second spoken version of the Brief for the commute, using the browser's built-in speech synthesis at zero cost.

## 4. FINN in one day, and what is in scope

A day with FINN takes about five minutes of the investor's time. This journey is also the demo script in section 17.

1. **08:30 — push notification:** "FINN Brief: 3 matter, 6 worth a look, 38 routine hidden." It opens the Brief on the last 24 hours.
2. **Top card:** Reliance Q2 FY27 results. Four numbers with QoQ and YoY, EBITDA margin in bps, and a line comparing the margin with what management guided. Tapping a number opens the results page it came from.
3. **Person card:** HDFC Bank's new MD & CEO, Anup Bagchi, effective 27 Oct 2026. The card shows his previous role (MD & CEO, ICICI Prudential Life), three decades in the ICICI Group, and IIT Kanpur and IIM Bangalore, each with a source chip.
4. **Worth a look:** one-line rows, such as "Order win ₹1,200 cr (3% of FY26 revenue)" or "NCD issue approved, up to ₹X cr".
5. **Routine:** a single collapsed row, "38 routine filings", which expands for audit.
6. **Caught up:** the investor marks the last card done and sees "You're caught up. Next: Bharti Airtel results, 5 Nov."
7. **16:45 — alert** after the end-of-day run: "Suzlon volume 3.1× its 20-day average, price −6.4%. No filing explains this move."
8. **17:00 — research:** the investor types DIXON. The Dossier builds in about two minutes with visible steps, then opens on Say vs Do. They tap "What did they guide on mobile volumes?"
9. **Evening — a new rule** in plain English: "Tell me if any promoter pledges shares." FINN shows the compiled rule as a chip to confirm.

The example figures in steps 4 and 7 are illustrative; real ones come from the live feed.

**Scope**

| Feature | Tier | Notes |
| --- | --- | --- |
| Brief with 24h / 3d / 7d / 30d / custom windows | MVP | Default 24h, quiet-day state, counts of hidden items |
| Event grouping, materiality score, tiers, reason chips | MVP | Deterministic; Appendix B holds the tables |
| Results card (Revenue, EBITDA, PBT, PAT; QoQ, YoY) | MVP | Arithmetic checks, verified badge, bank variant |
| Person card for management changes | MVP | Profile from the filing plus grounded web background |
| One-line summaries for mid-tier events | MVP | Batched cheap-model call |
| Alert rules: category, price move, volume spike | MVP | In-app inbox plus Web Push |
| Portfolio editing, including any NSE stock with backfill | MVP | 30 days of filings, 250 days of prices |
| Dossier for any NSE ticker | MVP | Ledger, snapshot, trajectory, cash, balance sheet, bull/bear |
| Source drawer and citations everywhere | MVP | Page-level citations |
| Cost and efficiency page | MVP | Reads the `llm_calls` table |
| Ask (anchored Q&A) | MVP+ | Postgres full-text retrieval, cited answers |
| "Explained by" links on price and volume alerts | MVP+ | Joins signals to filings from the prior 24 hours |
| "vs guidance" line on results cards | MVP+ | Reads the Dossier ledger when one exists |
| Upcoming results strip | MVP+ | BSE result calendar |
| "Unusual for this stock" (2.5σ) moves | MVP+ | 60-day return volatility |
| Plain-English rules | MVP+ | Cheap model compiles the text to rule JSON |
| 08:30 daily digest push | MVP+ | Scheduled task in the worker |
| Listen (spoken Brief) | STRETCH | Browser speech synthesis |
| Guidance band chart | STRETCH | Guidance range by quarter, with the actual as a dot |
| Telegram alert channel | STRETCH | Bot API is free |
| Delivery-% spikes, weekly insider aggregation, short-tenure flags | STRETCH |  |
| Intraday prices, consensus estimates, news, social, P&L tracking, login, native app | Out | Off-brief, secondary data, or not worth the time |

## 5. Push: the Brief, materiality and alerts

Push is one pipeline that runs every 10 minutes: ingest, normalise, classify, group, extract, score, alert. The Brief and the alerts read its output, so nothing on screen waits for it.

### 5.1 Pipeline stages

1. **Ingest.** Every 10 minutes from 07:00 to 23:59 IST, hourly overnight. Fetch BSE announcements for each portfolio scrip for the last 2 days and upsert by `NEWSID`. NSE is optional (section 9).
2. **Normalise.** One row per filing in `announcements`: subject, headline, exchange category and subcategory, `filed_at` in IST, PDF URL.
3. **Classify.** Ordered rules (Appendix B) set `category` and `subtype`. Unmatched rows go to a cheap model in batches of up to 25, each with its headline and the first 1,500 characters of the PDF.
4. **Group.** Set `event_key`. Results-family filings share `{symbol}:results:{period_end}`; every other filing is its own event.
5. **Extract.** Results go to the results extractor and management changes to the people extractor. Mid-tier categories get a batched one-liner with amounts. Routine filings get nothing.
6. **Score.** Base score plus modifiers gives materiality 0–100, a tier and up to three reasons.
7. **Alert.** Each user's rules run against new events and end-of-day signals, writing `alerts` rows and sending pushes.

Every stage is idempotent and keyed by a status column, so any stage can be re-run safely.

**Backfill.** Adding a stock to a portfolio queues a `backfill` job. It runs the same stages over that stock's last 30 days of filings, loads one year of prices, then sets `companies.backfilled_at`.

### 5.2 Materiality score

```latex
\text{score} = \operatorname{clamp}\big(\text{base}(\text{category}, \text{subtype}) + \textstyle\sum \text{modifiers},\ 0,\ 100\big) \times \text{feedback}
```

Base scores per category and subtype are in Appendix B.

| Modifier | Points | Applied when |
| --- | --- | --- |
| Governance red flag | +15 | CEO, MD, CFO, auditor or independent-director exit not due to retirement; rating downgrade; new pledge; regulatory order with a penalty |
| Size vs company | +5 / +15 | Extracted amount is at least 5% / 10% of market cap (deals, orders, fund raises, capex, litigation) |
| Market confirmation | +10 | Same or next session moved beyond the user's price or volume threshold (added at end of day) |
| Position weight | +5 / +10 | Holding is at least 5% / 10% of the user's portfolio (applied at read time) |

Feedback multipliers are per user: "Not useful" on an event sets that category-and-company multiplier to ×0.7; "Mute category" sets ×0.3.

Tiers: **Top** at 70 or more, **Worth a look** 40–69, **Routine** 15–39 (collapsed), **Hidden** below 15 (counted only). Reason chips are short strings such as "Results", "CFO exit", "₹2,400 cr = 6% of mcap", "Volume 3.1×".

### 5.3 Treatment policy: what each category earns

| Category | Treatment | Fields extracted | Why |
| --- | --- | --- | --- |
| results | Rich card | Four lines × three periods, margins, exceptional items, basis | The most important recurring event |
| management\_change | Person card | Name, role, in or out, effective date, reason, profile, background | Who runs the capital matters; unexplained exits are red flags |
| M&A | One-liner + size chip | Target, stake %, consideration ₹ cr, % of mcap, related-party flag | Materiality depends on size relative to the company |
| fund\_raise | One-liner + dilution chip | Instrument, amount, price vs last close, dilution % | The dilution maths is the news |
| credit\_rating | Direction chip | Agency, instrument, old → new rating, outlook | Reaffirmations are noise; downgrades are not |
| litigation | One-liner + amount | Authority, nature, amount, % of net worth | Most are routine; size and regulator decide |
| pledging | Chip | Promoter, % of holding pledged before → after | Rising pledges are a classic risk signal |
| insider\_trading | One-liner, promoters only | Who, buy or sell, value | Non-promoter disclosures are noise |
| capex | One-liner + size chip | Capacity, amount, timeline | A growth signal relative to existing assets |
| press\_release | One-liner; order wins get a size chip | Order value, client, % of revenue | Order size relative to revenue |
| dividend, bonus\_split | Title + record-date chip | Amount per share or ratio, record date | Useful for the calendar, rarely moves a thesis |
| earnings\_call | Hidden; a new transcript refreshes the Dossier | — | Transform it, don't show it |
| investor\_meetings, agm\_egm, postal\_ballot, unclassified | Counted in Routine or Hidden | — | Paperwork, unless a shareholder resolution fails |

### 5.4 Results card

SEBI's results format prints the current quarter, the preceding quarter and the same quarter last year side by side, so one page gives QoQ and YoY. FINN prefers consolidated figures and falls back to standalone.

The expected period end is the latest quarter end (30 Jun, 30 Sep, 31 Dec or 31 Mar) on or before the filing date. The extracted current column must match it.

Lines extracted, normalised to ₹ crore: revenue from operations, other income, total income, finance costs, depreciation and amortisation, total expenses, exceptional items, PBT, tax, PAT (total) and PAT attributable to owners.

```latex
\text{EBITDA} = \text{PBT}_{\text{before exceptional}} + \text{finance costs} + \text{D\&A} - \text{other income}
```

This equals revenue minus operating expenses and matches screener's "Operating Profit". The card's tooltip states the definition. Headline PAT is the owners' share; the total is used for checks.

**Checks**, each stored in `checks` with pass or fail:

1. Total income is within 0.5% of revenue plus other income.
2. PBT before exceptional items is within 0.5% of total income minus total expenses.
3. PBT is within 0.5% of PBT before exceptional items plus exceptional items. A share-of-associates line is allowed.
4. Total PAT is within 1% of PBT minus tax, allowing for a share-of-associates line.
5. Units: revenue is between 0.3× and 3× the previous quarter's revenue in `financials`. This catches lakh-versus-crore errors.
6. Periods: three distinct column dates, the latest equal to the latest quarter end.

If a check fails, retry once with the failures in the prompt. If it still fails, the card shows "Unverified" and the raw filing.

**Verification.** Six hours after filing, compare with screener's quarterly row (Sales, Operating Profit, Net Profit) and BSE's results snapshot (Revenue, Net Profit). Within 1% earns a "Matches exchange data" badge. Screener's Net Profit includes minority interest, so it is compared with total PAT.

**Worked example for tests** — L&T Q2 FY27 consolidated, from screener's table on 28 Oct 2026 (₹ crore):

| Line | Sep 2026 | Jun 2026 | Sep 2025 | QoQ | YoY |
| --- | --- | --- | --- | --- | --- |
| Revenue | 78,750 | 67,942 | 67,984 | +15.9% | +15.8% |
| EBITDA (ex other income) | 8,814 | 8,149 | 8,513 | +8.2% | +3.5% |
| EBITDA margin | 11.2% | 12.0% | 12.5% | −80 bps | −133 bps |
| PBT | 7,641 | 6,922 | 6,336 | +10.4% | +20.6% |
| PAT, total | 5,949 | 4,988 | 4,678 | +19.3% | +27.2% |

The announcement summary on screener and L&T's analyst presentation both put PAT at about ₹5,202 crore, which is the owners' share. Confirm it against the filing page during M4; the card's headline PAT should match it.

**Layout.** A header with company, "Q2 FY27 results, consolidated" and filing time. A 2×2 grid of tiles, each with value, YoY chip and QoQ chip; the EBITDA tile adds margin and bps change. A footer with an exceptional-items warning when non-zero, the "vs guidance" line (MVP+), the verified badge and "Open filing (p. N)".

**Banks and NBFCs** (`is_financial = true`): tiles are Net interest income, Pre-provision operating profit, PBT and PAT, plus gross NPA % when printed. EBITDA means nothing for a lender.

### 5.5 Person card

The extraction mirrors the disclosure SEBI requires for a change in directors or key managerial personnel (Regulation 30 read with Annexure 18 of the SEBI Master Circular of 30 Jan 2026): reason for change, date, brief profile on appointment, relationships between directors, and the resignation letter.

Fields: name, designation, change type (appointment, resignation, retirement, cessation, re-designation, re-appointment), effective date, reason, the profile quoted from the filing (up to 600 characters), relationships, and whether a resignation letter is attached.

**Enrichment**, only for CEO, MD, Chairman, CFO, whole-time director and auditor changes: a grounded web search returns previous roles, education, years of experience, a LinkedIn URL only if a search result shows it, and sources. FINN never scrapes LinkedIn (Proxycurl shut down in 2025 after LinkedIn sued it). A field with no source stays empty. Results are cached for 30 days per name and company.

**Red flags** (deterministic): a CEO, CFO or auditor resignation whose reason is not retirement or end of term is "Unplanned exit". An auditor resignation is always Top. Two key-personnel exits within 90 days is "Leadership churn" (MVP+).

**Layout:** initials avatar, name, "Appointed MD & CEO, effective 27 Oct 2026", a one-line headline ("Joins from ICICI Prudential Life, where he was MD & CEO"), up to three career rows, education, flags, source chips, "Open filing".

### 5.6 Price and volume signals

Computed once per trading day at 16:15 IST and re-run at 19:00 IST:

- `ret_1d` = close ÷ previous close − 1
- `vol_ratio` = volume ÷ mean volume of the previous 20 sessions
- `ret_z` = `ret_1d` ÷ standard deviation of daily returns over the previous 60 sessions
- Skip a stock with fewer than 21 sessions of history.

Defaults, editable per user and per stock: price ±4%, volume at least 2.0×, unusual at 2.5σ (MVP+).

**Explained by.** Look for that stock's events filed between the previous session's close (15:30 IST) and this close. If one exists: "Explained by: Q2 results, filed 15:47 yesterday". If none: "No filing explains this move." That second line is often the most valuable alert FINN sends.

### 5.7 Alerts and delivery

- **Rule kinds:** `category` (categories and subtypes), `price_move` (percent), `volume_spike` (multiple), `sigma_move` (z), each optionally scoped to one symbol.
- **Defaults for a new user:** results; top-role management changes; M\&A; fund raises; rating downgrades; new pledges; auditor changes; price ±4%; volume 2×.
- **Evaluation:** after each run, match every new scored event or signal against the rules of each user holding that symbol. Insert into `alerts`, unique on user, rule and source row.
- **Channels:** the in-app Alerts tab always works. Web Push (VAPID) works in Android Chrome directly; on iPhone it needs FINN added to the Home Screen on iOS 16.4 or later, with permission requested from a button tap. Settings has "Send test alert".
- **Digest (MVP+):** at 08:30 IST, push "FINN Brief: N matter" when the last 24 hours hold any Top events.

**Push implementation**

- The web app registers `/sw.js`, calls `PushManager.subscribe({userVisibleOnly: true, applicationServerKey: NEXT_PUBLIC_VAPID_PUBLIC_KEY})` from the "Enable alerts" button, and posts the subscription to `/api/push/subscribe`.
- The service worker shows a notification on `push` with the title, body and a `url` in `data`, and opens that URL on `notificationclick`.
- The worker sends with `pywebpush` using the VAPID private key and `sub: VAPID_SUBJECT`. A 404 or 410 response deletes that subscription.
- Every push also exists as an `alerts` row, so nothing is lost when a push fails.

### 5.8 The Brief

- **Windows:** 24h (default), 3d, 7d, 30d and a custom range. The window filters on the event's first filing time.
- **Sections:** Top as cards; Worth a look as one-line rows; Routine as one collapsed row with a count; Hidden as a footer count ("12 compliance filings not shown").
- **Sort:** score descending, then newest first.
- **Quiet state:** with no Top or Worth events, show "Quiet day across your 18 holdings. 9 routine filings. Last material event: Reliance results, 2 days ago" and a "Show 7 days" button.
- **Caught-up state:** each card has Done (tap the tick or swipe right). When every Top and Worth item is done, show "You're caught up" and the next upcoming result.
- **Header line:** date, the window chips, and the funnel line "212 filings → 9 events → 3 matter".

**Funnel counts:** filings = every filing in the window for the user's holdings; events = Top and Worth events after grouping; matter = Top events.

## 6. Pull: the Dossier

The Dossier answers one question for any NSE company: is management doing what it said? It is built from the company's own documents in about two minutes, then cached and refreshed only when a new document appears.

### 6.1 Build pipeline

A research job runs these steps and writes each one to `jobs` so the client can show progress. The label in quotes is what the user sees.

1. Resolve the symbol from the symbol master — "Finding LT".
2. Fetch the screener page (consolidated, else standalone) and parse tables and document links — "Reading 12 years of financials".
3. Pick documents: the newest 5 call transcripts (four quarters of promises plus their outcomes) and the newest annual report — "Found 5 transcripts and the FY26 annual report".
4. Download each PDF and store its text page by page — "Reading the Q1 FY27 call (22 pages)".
5. Extract from each transcript, up to 3 in parallel — "Extracting guidance from 5 calls".
6. Extract from targeted annual-report pages — "Reading 6 sections of the FY26 annual report".
7. Compute financial facts in code — "Computing margins, cash conversion and leverage".
8. Build the Say-vs-Do ledger — "Checking 14 promises".
9. Synthesise the case — "Writing the bull and bear case".
10. Validate citations and numbers — "Checking every citation".
11. Save a dossier version.

The client polls job status every 2 seconds. The cache key is a hash of the document URLs plus the financials. When a new transcript appears, only steps 5 and 8–11 re-run, and only for that document.

### 6.2 Documents

Screener's Documents section (checked 28 Oct 2026) lists annual reports linking to BSE PDFs, and a concalls list with Transcript, PPT and REC links per quarter. The newest quarter often has no transcript link yet, because transcripts can arrive up to five working days after a call.

- **Transcripts:** the newest 5 that have a transcript link. With fewer than 3, add investor presentations (PPT links) as guidance sources, labelled "presentation".
- **Annual report:** the newest one.
- **Download rules:** stream to `/tmp`, at most 60 MB, 60-second timeout, BSE headers for bseindia.com links, cached by URL hash for good.
- **Text:** PyMuPDF `page.get_text("text")` per page. A page with under 50 characters is marked `needs_ocr`. If more than 30% of a transcript's pages need it, send those pages to Gemini as images.

### 6.3 Extraction passes

**Transcript pass** — one call per transcript on the mid-tier model, using the full text (split at the Q&A if over 40k tokens). It returns four lists:

- `guidance_items`: metric key (6.5), raw label, target low and high, unit, basis (reported, constant currency, organic, excluding one-offs), horizon ("FY27", "Q3 FY27", "next 2–3 years"), direction (range, at least, at most, point, qualitative), a verbatim quote of up to 30 words, page and speaker.
- `reported_kpis`: numbers management states as actuals, with metric, value, unit, period, quote and page.
- `narrative_claims`: qualitative claims such as "rural demand is recovering", with horizon, quote and page.
- `analyst_concerns`: what analysts pressed on, one line each with page.

**Annual-report pass** — only targeted pages, found by keyword search over page text, at most 40 pages in total.

| Section | Keywords that locate the pages | Output |
| --- | --- | --- |
| Business and segments | Management Discussion and Analysis; Segment; Business overview | Two-sentence description; segments with revenue and share % |
| Risks | Risk Management, within MD&A | The top 5 risks management names |
| Contingent liabilities | Contingent liabilities (notes) | Total ₹ crore and the largest items |
| Related-party transactions | Related party | Notable transactions and total value |
| Auditor | Independent Auditor's Report; Qualified Opinion; Emphasis of Matter; Key Audit Matters | Opinion type and the list of key audit matters |
| Key ratios | Key Financial Ratios; significant changes | Ratios with management's explanation of changes over 25% |

### 6.4 Financial facts (code only)

From screener's tables in ₹ crore, consolidated where available:

- **Latest quarter and TTM:** revenue, EBITDA (screener's Operating Profit), OPM %, PBT, PAT, EPS.
- **Growth:** latest-quarter YoY; 3-year and 5-year CAGR for revenue, EBITDA and PAT.
- **Returns:** ROCE % from the ratios table, ROE % from the header ratios.
- **Leverage:** borrowings; debt-to-equity = borrowings ÷ (equity capital + reserves); interest cover = (PBT + interest) ÷ interest.
- **Working capital:** debtor days, inventory days, days payable and cash conversion cycle, five-year trend.
- **Cash quality:** cash from operations (CFO), free cash flow, CFO ÷ EBITDA, and five-year cumulative CFO ÷ cumulative PAT. Below 0.7 raises "Profits are not turning into cash".

Every fact is stored with its table, row and column so the UI can cite "Screener consolidated P&L, Mar 2026 column".

### 6.5 The Say-vs-Do ledger

**Metric keys** (closed set plus an escape): `revenue_growth`, `revenue`, `ebitda_margin`, `ebit_margin`, `ebitda`, `pat_growth`, `pat`, `capex`, `net_debt`, `order_inflow`, `order_book`, `volume_growth`, `aum_growth`, `credit_cost`, `nim`, `gnpa`, `capacity`, `store_count`, `other:<label>`.

**Matching**

1. Turn each item's horizon into evaluation periods.
2. Find the actual, in priority order: financial facts for table metrics (revenue growth, EBITDA margin, PAT, capex, net debt); then `reported_kpis` from later documents for the same metric and period; otherwise none.
3. Check the basis. A constant-currency or organic target set against a reported actual is marked "basis differs", never "missed" by code alone.

| Status | Rule |
| --- | --- |
| Delivered | Period complete; actual inside the range, or beats an at-least or at-most target |
| Near miss | Period complete; within 1 percentage point (rates) or 5% relative (values) of the range edge |
| Missed | Period complete; outside the near-miss band |
| On track / Off track | Period in progress; year-to-date run-rate inside or outside the range |
| Revised | A later call changed the target for the same metric and horizon; show old → new |
| Pending | Period not started, or no data yet |
| Unverifiable | No numeric target, or no actual in any document |

```latex
\text{credibility} = \frac{\text{delivered} + 0.5 \times \text{near miss}}{\text{delivered} + \text{near miss} + \text{missed}}
```

It is shown as "7 of 9 resolved promises met (78%)" with the pending count, and hidden when fewer than 3 items are resolved. Qualitative claims go to a mid-tier judge with the facts table and come back as agree, diverge or too early, each with one line of numbers.

**Guidance changes are push events.** When a new transcript raises or cuts guidance, FINN creates an event such as "Guidance cut: FY27 revenue growth 15% → 10–12%" (category `earnings_call`, subtype `guidance_change`, base score 75). A routine filing becomes a material one.

### 6.6 Synthesis and grounding

The strongest tier never sees raw documents. Its input is the facts table, the ledger, the annual-report extracts, analyst concerns and the top narrative claims, all as compact JSON. Its output:

- `what_matters_now`: 3 bullets of up to 25 words.
- `narrative_vs_numbers`: 3–6 items, each a claim, a verdict (agree, diverge, too early) and evidence with numbers.
- `bull` and `bear`: 3 points each, up to 25 words.

Every bullet cites at least one id, either `doc:<document_id>:p<page>` or `fact:<fact_key>`. Code then validates:

1. Every cited id exists.
2. **Number grounding:** every number in the text (digits with %, ₹, cr, bps or ×) must match a fact or a cited page within 1% after unit normalisation. A bullet that fails is dropped and logged.
3. Banned adjectives trigger one regeneration.
4. No URL outside the company's own documents.

### 6.7 Dossier layout, top to bottom

1. **Header:** name, symbol, sector, market cap, price and day change, and "Built on 28 Oct 2026 from 5 transcripts and the FY26 annual report".
2. **What matters now:** three bullets.
3. **Say vs Do:** the credibility score, then the ledger grouped by call, newest first. Each row has a quote snippet, target chip, outcome chip and actual value; tapping opens the source drawer.
4. **Numbers:** latest-quarter tiles; 10-year sparklines for revenue, OPM %, PAT and ROCE, with 3-year and 5-year CAGR.
5. **Cash quality:** CFO against PAT for five years, CFO ÷ EBITDA, free cash flow, and the red flag when it applies.
6. **Balance sheet:** borrowings, debt-to-equity, interest cover, working-capital days, contingent liabilities as % of net worth, auditor opinion.
7. **Business snapshot:** two sentences and a segment-mix bar.
8. **Bull vs Bear:** a toggle on mobile.
9. **Sources:** every document with its link and the pages used.
10. **Ask bar,** pinned at the bottom with three seeded questions.

### 6.8 Ask FINN

- **Scope:** one company at a time.
- **Retrieval:** Postgres full-text search (`websearch_to_tsquery`) over that company's `doc_pages`, top 8 pages by `ts_rank_cd`, plus the facts table.
- **Answer:** mid-tier model, from the excerpts only, citing pages. When the answer is absent: "Not in FINN's documents for this company", plus the closest available fact.
- **Seeds:** three questions generated with each dossier, such as "Why did EBITDA margin fall 133 bps YoY?" From a push card, "Ask about this" pre-fills the event's context.
- **Cache:** identical questions per dossier version are answered from `qa_messages`.

### 6.9 Degradation rules

| Situation | Behaviour |
| --- | --- |
| No transcripts | Build the ledger from investor presentations; if none, hide Say vs Do and say "No call transcripts published" |
| Standalone financials only | Use them and label every number "Standalone" |
| Bank or NBFC | Replace EBITDA and OPM with NII, pre-provision profit, credit cost and gross NPA; skip working-capital days |
| Listed under 3 years | Show CAGR only for the years available |
| Screener unreachable | Retry 3 times with backoff, then fail with "Source unavailable, try again later"; never show partial numbers as complete |
| Model quota exhausted | Fall back down the routing chain; if all fail, finish the deterministic sections and mark AI sections "Pending" with a retry button |

## 7. Interaction model and UX spec

FINN's one memorable element is the filter itself: the Brief opens on a funnel line, "212 filings → 9 events → 3 matter", and everything else stays quiet. Design for one thumb, sessions of 30 seconds, and depth one tap away.

### 7.1 Navigation

A bottom tab bar with four tabs: **Brief** (home), **Alerts** (badge shows unread), **Portfolio**, **Research**. Settings opens from the Brief header. Details open as bottom sheets (the `vaul` drawer), so the list underneath keeps its scroll position.

### 7.2 Screens

**Brief**

```text
+--------------------------------+
| Wed 28 Oct                 (o) |  (o) = settings
| 212 filings -> 9 events -> 3   |  funnel line: the hero
| [24h] [3d] [7d] [30d] [Custom] |
+--------------------------------+
|# RELIANCE   Q2 FY27 results    |  # = materiality rail (accent)
|# Revenue  ...      YoY  QoQ    |
|# EBITDA   ...  margin  bps     |
|# PBT      ...                  |
|# PAT      ...                  |
|# vs guidance: ...              |
|# [Open filing p.4] [Ask] [Done]|
+--------------------------------+
|# HDFCBANK   New MD & CEO       |  person card
|# Anup Bagchi, from ICICI Pru   |
+--------------------------------+
| Worth a look                   |
|: LT  Order win ...             |  : = thin rail
|: TATASTEEL  Rating affirmed .. |
+--------------------------------+
| 38 routine filings         [+] |
| 12 compliance filings hidden   |
+--------------------------------+
 [Brief] [Alerts] [Portfolio] [Research]
```

**Event sheet** opens from any card or row. It holds the full card, the reasons ("Why this is here"), the source drawer (filing link, page, the extracted lines and their checks), feedback buttons (Useful, Not useful, Mute this category), and "Ask about this".

**Alerts** has two parts. The inbox lists alerts newest first; each links to its event or signal and shows the "Explained by" line. Watch rules lists the active rules as editable chips, with a plain-English input ("Tell me if…") and sliders for the price and volume thresholds.

**Portfolio** lists holdings: symbol, name, last close, day change, a small bar for volume against its 20-day average, and the latest event. "Add stock" searches the symbol master; adding starts a backfill and shows "Fetching 30 days of filings". Tapping a holding opens the company page.

**Company page:** a 120-session price line with event markers (results, management change, rating), the recent events list, the next results date, and "Open Dossier".

**Research:** a search box with autocomplete, recent dossiers, and five suggested picks. Starting a build shows the job's steps with ticks, then opens the Dossier.

**Dossier**

```text
+--------------------------------+
| <  Larsen & Toubro         LT  |
| Rs 3,801  +3.7%  mcap 5.2L cr  |
| Built from 5 calls, FY26 AR    |
+--------------------------------+
| What matters now   (serif)     |
| - ...                          |
+--------------------------------+
| Say vs Do         7 of 9 met   |
|  Q4 FY26 call                  |
|  "FY27 revenue growth 15%"     |
|   H1 actual ...   [On track]   |
+--------------------------------+
| Numbers | Cash | Balance sheet |  sticky section tabs
| Business | Bull vs Bear        |
+--------------------------------+
| [ Ask about L&T ...         > ]|
+--------------------------------+
```

**Settings and About:** enable alerts, send test alert, default thresholds, "How FINN decides" (the scoring and treatment tables in plain words), the Cost page, and the line "FINN is a research prototype, not investment advice."

### 7.3 Components

| Component | Spec |
| --- | --- |
| `FunnelLine` | Three numbers shrinking left to right: filings, events, matter. It animates once per session on load; this is FINN's only unprompted motion. |
| `WindowChips` | 24h, 3d, 7d, 30d, Custom (opens a date-range sheet). The selection is stored in the URL (`?w=7d`). |
| `MaterialityRail` | A 3 px left edge. Top: full accent. Worth: 40% accent. Routine: hairline grey. |
| `ResultsCard` | 2×2 metric tiles with value, YoY and QoQ chips; footer as in 5.4. |
| `PersonCard` | As in 5.5. |
| `EventRow` | One line: symbol, one-liner, size chip, time. No card chrome. |
| `RoutineGroup` | One row with a count; expands to a plain list of exchange subjects. |
| `SignalCard` | Sparkline of 20 sessions with today highlighted, the move, the volume ratio, and "Explained by". |
| `SourceDrawer` | Filing title, date, page, quoted lines, checks with pass or fail, "Open PDF". |
| `LedgerRow` | Call, quote, target chip, outcome chip, actual; tap opens the source drawer. |
| `Sparkline` | Custom SVG: one line, the last point marked, no axes. |
| `AskBar` | Pinned input with three seeded question chips above it. |
| `RuleChip` | Readable rule text ("DIXON moves 5% in a day") with edit and delete. |

### 7.4 Design tokens

The palette avoids the usual finance-app look (near-black with a neon accent). FINN is light by default, with one accent used only for materiality and primary actions.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | #EDF0F3 | #10151F | App background |
| `--surface` | #FFFFFF | #171E2B | Top cards and sheets only |
| `--ink` | #18212B | #E6E9EF | Primary text |
| `--ink-2` | #5E6A78 | #9AA5B4 | Secondary text |
| `--rule` | #D9DEE5 | #273042 | 1 px borders |
| `--accent` | #3D4FD1 | #8E9BFF | Materiality rail, primary buttons, links |
| `--up` | #18794E | #4CC38A | Positive deltas only |
| `--down` | #C23B32 | #F0776F | Negative deltas only |

- **Type:** IBM Plex Sans for UI and numbers, with `font-variant-numeric: tabular-nums` on every number. Literata (serif) only for the one-sentence headline of a Top card and the Dossier's "What matters now". Check the rupee sign renders; keep Noto Sans in the fallback stack.
- **Scale:** 13 / 15 / 17 / 22 / 28 px; line height 1.45 for body, 1.5 for the serif.
- **Spacing:** 4 px grid; 16 px side gutter; 12 px between rows, 16 px between cards.
- **Shape:** Top cards radius 14 with a 1 px rule border and no shadow. Rows have no box. Sheets radius 20 at the top. Hierarchy shows through surface and rail, not identical cards.

### 7.5 States, motion, copy, accessibility

- **Loading:** skeleton rows after 300 ms; never a lone spinner. A Dossier build shows its step list.
- **Empty and error:** say what happened and the next action. "Screener didn't respond. Try again in a minute." Never apologise; never be vague.
- **Motion:** only the funnel line moves unprompted. Action motion is allowed: Done slides a card out, sheets rise, a rule chip pops in on save. Respect `prefers-reduced-motion`.
- **Copy:** sentence case, plain verbs, numbers with units and direction. No all-caps labels, no labels above every block, no arrows appended to buttons. The button says what happens ("Build dossier"), and the result uses the same word ("Dossier built").
- **Accessibility:** 44 px tap targets, WCAG AA contrast, visible focus rings, `aria-label` on icon buttons, colour never the only signal (deltas carry + or −).
- **PWA:** web manifest (name FINN, theme colour `--accent`), icons, and a service worker used only for push. On iPhone, "Enable alerts" first explains Add to Home Screen.

The implementing agent should load the `frontend-design` skill before building the UI and follow it where this spec is silent.

## 8. Architecture

Three parts talk only through Postgres: a Next.js app for the product, a Python worker for data and AI, and an external clock that wakes the worker every 10 minutes. Any one of them can fail without blanking the app.

&#91;embedded content: FINN architecture · 6 parts, solid lines are always on, dashed lines are on demand\]

Screens only ever talk to Postgres and, on demand, to the worker; the GitHub Actions fallback (not drawn) runs the same CLI against the same database.

| Component | Runs on | Owns | Talks to |
| --- | --- | --- | --- |
| Web app (Next.js, TypeScript) | Vercel Hobby, functions in `bom1` (Mumbai) | Every screen; CRUD for portfolio, rules, feedback and push subscriptions; Brief ranking at read time | Postgres directly; worker HTTP to start research, Ask and rule parsing |
| Worker (Python 3.12, FastAPI + Typer CLI) | Render free web service, Singapore | Ingestion, classification, extraction, scoring, signals, alerts, push sending, research jobs, Ask | Postgres; BSE, NSE, Yahoo, screener; Gemini, Groq; Web Push services |
| Database (Postgres) | Supabase free, Mumbai | All state; full-text search for Ask | — |
| Clock | cron-job.org free | `POST /tasks/tick` every 10 minutes, which also keeps Render awake | Worker |
| Fallback runner | GitHub Actions on the public repo | The same CLI, a daily end-of-day job, used if Render is down | Postgres |

**Why this split**

- Reads never depend on the worker. The Brief, Alerts, Portfolio and cached Dossiers render from Postgres even while the worker is asleep.
- Python has the data libraries: yfinance, the BSE and NSE wrappers, PyMuPDF, pandas. TypeScript has the product: Next.js, the PWA, push subscriptions.
- Each stage is idempotent and tracked by status columns, so a failed run is re-run, not debugged in production.

**Options rejected**

- Hugging Face Spaces: Docker Spaces now need a paid plan; only static Spaces are free.
- Vercel Cron on Hobby: runs at most once a day, too slow for 10-minute polling.
- Render's free Postgres: it expires after 30 days.
- Vercel Python functions alone: 300-second cap per call; workable, but long PDF jobs fit a long-running worker better.

**Network notes the implementer must follow**

- Supabase direct connections use IPv6, which Render may not reach. The worker uses the **Session pooler** connection string. Vercel uses the **Transaction pooler** (port 6543) with prepared statements off.
- cron-job.org times out after 30 seconds. `/tasks/tick` returns 202 at once and runs work in a background task under a Postgres advisory lock, so runs never overlap.
- Render spins down after 15 minutes without inbound traffic and takes about a minute to wake; the 10-minute tick prevents this. The 750 free instance hours a month cover exactly one always-on service, so never create a second free service in that workspace.

**Data flow**

1. The tick reaches the worker, which takes the lock and runs whatever is due (schedule below).
2. The worker writes rows; the web app reads them.
3. A user action that needs compute (build a dossier, ask, parse a rule, add a stock) inserts a job row, then calls the worker with a 2-second timeout. The worker also drains queued jobs on every tick, so a lost call delays work by at most 10 minutes.
4. The client polls job status through the web API, which reads Postgres.

**Schedule (IST)**

| Task | When | Notes |
| --- | --- | --- |
| `announcements.poll` | Every tick 07:00–24:00; hourly overnight | Last 2 days, per scrip |
| `pipeline.process` | After each poll | Classify, group, extract, score, alert |
| `prices.eod` | 16:15 and 19:00, Mon–Fri | yfinance batch, then signals and alerts |
| `results.verify` | Hourly | Results filed over 6 hours ago and not yet verified |
| `calendar.refresh` | 07:30 daily | BSE result calendar per scrip |
| `digest.push` | 08:30 daily | Only if the last 24 hours hold Top events |
| `jobs.drain` | Every tick | Queued research and backfill jobs |

A task is due when its last successful run in `task_runs` is older than its interval. A timed task is due once its time has passed today and no successful run has happened since.

## 9. Data source playbook

BSE is the primary source for filings: its API is wrapped by a maintained open-source library and serves PDFs directly. NSE is optional, Yahoo supplies prices, and screener supplies standardised financials and document links. Endpoints below were read from the `bse` 3.3.4 and `nse` 5.1.0 source code and checked against screener's live page on 28 Oct 2026.

### 9.0 Day-0 probe

`python -m finn probe` sends one request to each source below and prints status, latency and bytes. Run it on your laptop and again on Render (`GET /probe`). If BSE fails only from Render, take the fallback in section 16 (run ingestion from GitHub Actions or your laptop).

### 9.1 Symbol master

- Build it once, locally. BSE `ListofScripData` (all active equity groups) gives `SCRIP_CD`, `scrip_id`, ISIN, industry and market cap. NSE's equity list CSV gives symbol, name and ISIN. Join on ISIN.
- Commit the result as `data/symbols.csv` with columns `symbol, name, isin, bse_code, industry, mcap_cr`. Seeding loads it into `companies`.
- If the NSE list is unreachable, use BSE's `scrip_id` as the symbol (it matches the NSE symbol for most large caps) and hand-check the portfolio rows.
- Set `is_financial` for banks and NBFCs from the industry field.

### 9.2 BSE announcements (primary)

- **Endpoint:** `GET https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w`
- **Params:** `pageno=1`, `strCat=-1`, `subcategory=-1`, `strPrevDate=YYYYMMDD`, `strToDate=YYYYMMDD`, `strSearch=P`, `strScrip=<bse_code>`, `strType=C`
- **Headers:** a current desktop Chrome `User-Agent`; `Accept: application/json, text/plain, */*`; `Origin` and `Referer` both `https://www.bseindia.com/`; `Sec-Fetch-Site: same-site`. The `bse` package sets these and throttles requests.
- **Response:** `{"Table": [...], "Table1": [{"ROWCNT": n}]}`. Increment `pageno` until all rows are read.
- **Rate:** about 1 request per second; one request per scrip per tick.

| BSE field | FINN column |
| --- | --- |
| `NEWSID` | `native_id` |
| `SCRIP_CD` | `bse_code` |
| `NEWSSUB` | `subject` |
| `HEADLINE` | `headline` |
| `CATEGORYNAME` (can be null) | `exchange_category` |
| `SUBCATNAME` | `exchange_subcategory` |
| `NEWS_DT` (no timezone; treat as IST) | `filed_at` |
| `ATTACHMENTNAME` | builds `pdf_url` |
| `Fld_Attachsize` | `pdf_bytes` |

- **PDF URL:** `https://www.bseindia.com/xml-data/corpfiling/AttachLive/{ATTACHMENTNAME}`; on 404, the same path with `AttachHis`. The link shown to users is `https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname={ATTACHMENTNAME}`, which is what screener links to.
- **Exchange categories:** AGM/EGM, Board Meeting, Company Update, Corp. Action, Insider Trading / SAST, New Listing, Result, Integrated Filing, Others. Because the category can be null, classification relies on the subcategory and subject.

### 9.3 BSE extras

| Use | Endpoint (same base URL and headers) |
| --- | --- |
| Upcoming results strip | `Corpforthresults/w?scripcode=<code>` returns `meeting_date` |
| Results verification | `TabResults_PAR/w?scripcode=<code>&tabtype=RESULTS` returns Revenue, Net Profit and OPM % for the last two quarters and last year |
| Price fallback | `StockReachGraph/w?scripcode=<code>&flag=12M&fromdate=&todate=&seriesid=` returns 12 months of price and volume |
| Scrip lookup | `PeerSmartSearch/w?Type=SS&text=<symbol>` (or `bse.getScripCode`) |

### 9.4 NSE (optional, behind `NSE_ENABLED`)

- Use the `nse` package; it fetches session cookies and throttles to 3 requests per second.
- `GET /api/corporate-announcements?index=equities&symbol=X&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY` gives `desc`, `attchmntText` (a clean one-line description), `attchmntFile` and `an_dt`.
- `GET /api/results-comparision?symbol=X` (NSE's spelling) gives a structured quarterly P&L in ₹ lakh; divide by 100 for crore. It is a second check for results.
- `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` gives daily delivery % (STRETCH).
- Forum reports show NSE timing out or refusing cloud-hosted clients. After 3 consecutive 401, 403 or timeout responses, disable NSE for 24 hours and log it.
- **Dedupe with BSE:** same symbol, filed within 30 minutes, subject similarity at least 60 (`rapidfuzz` `token_set_ratio`). Keep the BSE row and store NSE's text in `nse_text`.

### 9.5 Prices (yfinance)

- Pin `yfinance>=1.7.0`. It impersonates a browser via `curl_cffi`; do not pass a custom session.
- One batch call: `yf.download([f"{s}.NS" for s in symbols], period="1y", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)`.
- Upsert open, high, low, close, adjusted close and volume per symbol and date. Run at 16:15 and 19:00 IST on weekdays; skip when there is no new bar.
- On `YFRateLimitError`, wait 60 seconds and retry once, then use BSE `StockReachGraph` for the missing symbols.
- A newly added symbol gets one year of backfill.

### 9.6 Screener (fundamentals and documents)

- **URL:** `https://www.screener.in/company/{SYMBOL}/consolidated/`. If the consolidated tables are empty, use `https://www.screener.in/company/{SYMBOL}/`.
- **Parse** with `selectolax` by section id: `#quarters`, `#profit-loss`, `#balance-sheet`, `#cash-flow`, `#ratios`, `#shareholding`, `#documents`, and `#top-ratios` for the header.
- **Row labels seen on 28 Oct 2026:**
  - Quarterly: Sales, Expenses, Operating Profit, OPM %, Other Income, Interest, Depreciation, Profit before tax, Tax %, Net Profit, EPS in Rs, Raw PDF (13 quarters).
  - Balance sheet: Equity Capital, Reserves, Borrowings, Other Liabilities, Total Liabilities, Fixed Assets, CWIP, Investments, Other Assets, Total Assets.
  - Cash flows: Cash from Operating Activity, Cash from Investing Activity, Cash from Financing Activity, Net Cash Flow, Free Cash Flow, CFO/EBITDA.
  - Ratios: Debtor Days, Inventory Days, Days Payable, Cash Conversion Cycle, Working Capital Days, ROCE %.
  - Header: Market Cap, Current Price, High / Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE, Face Value.
- **Normalise labels:** labels end in a non-breaking space and "+" ("Sales\\xa0+"). Strip both and collapse whitespace. Store every row as a `line_item`, and map known labels to canonical keys with a dictionary. Bank pages use different rows; unknown labels are stored but unused.
- **Numbers:** remove commas; "%" becomes a float; blanks become null; negatives look like "-350". Column headers such as "Sep 2026" map to that month's last day; "TTM" has no date.
- **Documents:** annual reports as (year, URL); concalls as (label such as "Jul 2026", transcript URL or null, PPT URL or null, recording URL or null). The header's BSE link contains the BSE code.
- **Politeness:** one request every 3 seconds, a real User-Agent, HTML cached for 12 hours in `http_cache`.
- **Never use:** About, Key Points, Pros and Cons, AI Summary, or Insights (which needs login).

### 9.7 PDFs

- Download with `httpx`, streamed, at most 60 MB, 60-second timeout, following redirects; BSE URLs need the BSE headers.
- Extract text with PyMuPDF page by page into `doc_pages`. PyMuPDF is AGPL, which is fine for this public prototype.
- **Results page finder:** score each page +3 "Revenue from operations", +3 "Profit before tax", +2 "Quarter ended" or "Three months ended", +2 "Consolidated", +1 "Total income", +1 "Finance costs", and −2 "Standalone" when seeking consolidated. Copy the best 1–2 pages into a small PDF (`insert_pdf`) and send only that to the model. If no page scores 6 or more (a scanned filing), send the first 8 pages.

### 9.8 Person background

- **First,** the filing's own brief profile.
- **Then,** Gemini with the Google Search tool, which has a free grounded-search allowance. Ask for previous roles and education with source URLs, then convert the answer to JSON with a second, cheap call.
- **Fallback:** the Tavily search API (1,000 free credits a month, no card). Take the top 5 results and extract JSON from the snippets only.
- Never request linkedin.com pages. Show a LinkedIn URL only if one appears in search results.

## 10. AI layer: routing, validation, caching, cost

Work goes to the cheapest thing that can do it. Code makes about 90% of decisions, a Flash-Lite model handles bulk text, a Flash model extracts, and the newest Flash with high thinking writes the few synthesis pieces. Model names live in environment variables, because Gemini's free catalogue changes.

### 10.1 Routing table

Each tier uses a different model, so each draws on its own free per-model quota.

| Task | Tier | Default model | Fallback chain | Input size |
| --- | --- | --- | --- | --- |
| `classify_batch` (ambiguous filings) | T1 | `gemini-3.5-flash-lite` | `gemini-3.1-flash-lite` → Groq `openai/gpt-oss-20b` | 25 filings × \~400 tokens |
| `one_liners_batch` | T1 | same | same | 25 × \~600 tokens |
| `parse_rule` | T1 | same | same | \~300 tokens |
| `results_extract` | T2 | `gemini-3.6-flash` | `gemini-3.8-flash` → `gemini-2.5-flash` | 1–2 PDF pages |
| `people_extract` | T2 | same | same | up to 6 pages of text |
| `person_background` | T2 | `gemini-2.5-flash` with Google Search | Tavily + T1 | search results |
| `transcript_extract` | T2 | `gemini-3.6-flash` | `gemini-3.8-flash` → `gemini-2.5-flash` | up to 40k tokens |
| `ar_extract` | T2 | same | same | up to 40 pages |
| `ledger_judge` | T2 | same | same | up to 8k tokens |
| `ask` | T2 | same | same | up to 12k tokens |
| `synthesize` | T3 | `gemini-3.8-flash`, thinking HIGH | `gemini-2.5-pro` → T2 | up to 15k tokens |

- Gemini's free limits are set per project and shown in AI Studio; Google no longer publishes fixed numbers. Free-tier inputs may be used to improve Google's products, which is acceptable because every input is a public filing.
- Groq's free tier (checked Oct 2026) allows 30 requests a minute and 1,000 a day but only 8,000 tokens a minute. That suits short batches, not transcripts, so Groq never appears in a T2 chain.
- `python -m finn doctor` lists the available models at startup and fails loudly if a configured one is missing.

### 10.2 Router contract

```python
def call(task: str, *, prompt: str, schema: type[BaseModel] | None = None,
         parts: list | None = None, tools: list | None = None) -> RouterResult:
    """The only way any code calls a model."""
```

1. Look up the task's tier, model chain, temperature (0.1 for extraction, 0.3 for writing), thinking level and output cap.
2. Build the cache key: SHA-256 of task, model, prompt version, prompt, attached parts and schema name. A hit returns at once and is logged as a cache hit.
3. Call the provider with structured output: for Gemini, `response_mime_type="application/json"` and `response_schema=<Pydantic model>`; for OpenAI-compatible providers, JSON-schema mode.
4. Validate with Pydantic. On failure, retry once with the validation error appended.
5. On 429 or 5xx, back off 2 s then 8 s, then move to the next model in the chain.
6. Log every attempt to `llm_calls`: task, model, provider, input and output tokens from usage metadata, latency, ok, error, cache hit and estimated cost.
7. Return the data, the model used, whether it was cached, and token counts.

A semaphore per provider (Gemini 4, Groq 2) keeps calls inside per-minute limits.

### 10.3 Prompt conventions

- Prompts live in `worker/finn/llm/prompts/<task>.md` with a version line; editing a prompt bumps its version and so invalidates its cache.
- Shared preamble: "You extract facts from Indian stock-exchange filings. Use only the text provided. If a field is absent, return null. Never infer or compute numbers. Write numbers as plain decimals without commas, in the units the document states."
- Every extracted fact carries a verbatim `quote` (up to 30 words) and a `page`. Code checks the quote appears on that page (`rapidfuzz.partial_ratio` at least 85) and drops facts that fail.
- Every writing prompt includes the banned-words list from section 3.

### 10.4 Efficiency mechanics

1. **Rules before models:** the Appendix B rules should classify about 90% of filings; measure it on day 1.
2. **Routine filings cost nothing:** no model call at all.
3. **Page targeting:** results extraction sends 1–2 pages, not a 20–60-page filing; the annual-report pass reads at most 40 of 300-plus pages.
4. **Batching:** up to 25 filings per classification or one-liner call.
5. **Caching:** model responses by content hash, documents by URL, dossiers by document set, screener HTML for 12 hours.
6. **Incremental refresh:** a new transcript re-runs only its own extraction, the ledger and the synthesis.
7. **Precompute:** no page load calls a model. Only Ask and on-demand research run models on request.
8. **Cost page:** calls, tokens, cache-hit rate, ₹ spent (zero on free tiers) and the estimated cost at paid prices per Brief and per Dossier.

Rough expected volume: 8–15 model calls a day for 18 holdings in results season; 8–10 calls and 150–250k input tokens for a first-time dossier; zero for a repeat view.

The cost page estimates what the same calls would cost on paid tiers, using this table in `llm/pricing.py` (USD per 1M tokens, from the providers' pricing pages in Oct 2026):

| Model | Input | Output |
| --- | --- | --- |
| `gemini-3.8-flash`, `gemini-3.6-flash` | 0.75 | 3.75 (rising to 1.50 / 7.50 on 1 Jan 2027) |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 |
| Groq `openai/gpt-oss-20b` | 0.075 | 0.30 |
| Groq `openai/gpt-oss-120b` | 0.15 | 0.60 |

Read the Gemini 2.5 prices from the pricing page when filling in the table.

## 11. Data model and API contracts

One Postgres schema holds global facts (companies, prices, filings, documents) and a per-user lens (holdings, rules, feedback, alerts). Save it as `db/schema.sql` and apply it in the Supabase SQL editor.

### 11.1 Schema

```sql
create extension if not exists pgcrypto;

-- Global facts ---------------------------------------------------------
create table companies (
  symbol text primary key,              -- NSE symbol, e.g. 'LT'
  name text not null,
  isin text unique,
  bse_code text unique,
  industry text,
  mcap_cr numeric,
  is_financial boolean not null default false,
  backfilled_at timestamptz,
  created_at timestamptz not null default now()
);

create table prices (
  symbol text references companies(symbol),
  d date,
  open numeric, high numeric, low numeric, close numeric, adj_close numeric,
  volume bigint,
  source text not null default 'yahoo',
  primary key (symbol, d)
);

create table price_signals (
  symbol text references companies(symbol),
  d date,
  ret_pct numeric,          -- 1-day % change
  vol_ratio numeric,        -- volume / mean of previous 20 sessions
  ret_z numeric,            -- return / stdev of previous 60 sessions
  explained_by text,        -- event_key or null
  primary key (symbol, d)
);

create table announcements (
  id text primary key,                  -- 'BSE:<NEWSID>' or 'NSE:<seq_id>'
  source text not null,                 -- 'BSE' | 'NSE'
  symbol text references companies(symbol),
  subject text not null,
  headline text,
  exchange_category text,
  exchange_subcategory text,
  filed_at timestamptz not null,
  pdf_url text,
  pdf_bytes int,
  nse_text text,
  raw jsonb not null,
  category text,                        -- Appendix B
  subtype text,
  classified_by text,                   -- 'rule:<id>' | 'llm'
  event_key text,                       -- grouping key
  is_primary boolean not null default true,
  one_liner text,
  amount_cr numeric,
  base_score int,                       -- category + governance + size
  market_bonus int not null default 0,  -- added at end of day
  reasons jsonb not null default '[]',
  red_flags jsonb not null default '[]',
  also jsonb not null default '[]',     -- extra categories in a results filing (Appendix B)
  status text not null default 'new',   -- new|classified|extracted|scored|failed
  error text,
  created_at timestamptz not null default now()
);
create index on announcements (symbol, filed_at desc);
create index on announcements (event_key);
create index on announcements (status);

create table results_extracts (
  announcement_id text primary key references announcements(id) on delete cascade,
  symbol text not null,
  period_end date not null,
  basis text not null,                  -- consolidated | standalone
  template text not null default 'corporate',  -- corporate | lender
  unit_in_doc text,                     -- lakh | crore | million
  periods jsonb not null,               -- {current, prev_q, yoy_q}: lines in Rs crore
  metrics jsonb not null,               -- ebitda, margins, qoq/yoy %, bps
  checks jsonb not null,                -- [{name, ok, detail}]
  verified text,                        -- null | match | mismatch
  verified_detail jsonb,
  source_pages int[],
  model text,
  created_at timestamptz not null default now()
);

create table people_events (
  id bigserial primary key,
  announcement_id text references announcements(id) on delete cascade,
  symbol text not null,
  person_name text not null,
  designation text,
  role_class text,                      -- top | kmp | independent | auditor | other
  change_type text,                     -- appointment | resignation | retirement | cessation | redesignation | reappointment
  effective_date date,
  reason text,
  profile_from_filing text,
  relationships text,
  background jsonb,                     -- {headline, previous_roles[], education[], linkedin_url, sources[]}
  flags jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table upcoming_results (
  symbol text references companies(symbol),
  meeting_date date,
  fetched_at timestamptz not null default now(),
  primary key (symbol, meeting_date)
);

-- Per-user lens --------------------------------------------------------
create table users (
  id text primary key,                  -- 'demo' or the finn_uid cookie value
  settings jsonb not null default '{}',
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table holdings (
  user_id text references users(id) on delete cascade,
  symbol text references companies(symbol),
  weight_pct numeric,
  thesis text,
  added_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

create table alert_rules (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  kind text not null,                   -- category | price_move | volume_spike | sigma_move
  symbol text,                          -- null = all holdings
  params jsonb not null,                -- {categories, subtypes} | {pct} | {multiple} | {z}
  label text not null,                  -- chip text
  source_text text,                     -- the plain-English input, if any
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table alerts (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  rule_id bigint references alert_rules(id) on delete set null,
  symbol text,
  kind text not null,                   -- event | signal
  ref_id text not null,                 -- event_key or '<symbol>:<date>'
  title text not null,
  body text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  unique (user_id, rule_id, ref_id)
);

create table push_subscriptions (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table feedback (
  id bigserial primary key,
  user_id text references users(id) on delete cascade,
  event_key text not null,
  action text not null,                 -- useful | not_useful | mute_category | done
  category text,
  symbol text,
  created_at timestamptz not null default now()
);

-- Research ---------------------------------------------------------------
create table documents (
  id bigserial primary key,
  symbol text references companies(symbol),
  doc_type text not null,               -- annual_report | transcript | presentation | results
  period_label text,                    -- 'Jul 2026', 'FY26'
  period_end date,
  url text not null,
  url_hash text unique not null,
  status text not null default 'new',   -- new | fetched | parsed | extracted | failed
  pages int,
  error text,
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table doc_pages (
  document_id bigint references documents(id) on delete cascade,
  page_no int,
  text text not null,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  primary key (document_id, page_no)
);
create index on doc_pages using gin (tsv);

create table financials (
  symbol text references companies(symbol),
  statement text,                       -- quarters | profit_loss | balance_sheet | cash_flow | ratios | shareholding | top
  basis text,                           -- consolidated | standalone
  period text,                          -- 'Sep 2026', 'Mar 2026', 'TTM'
  period_end date,
  line_item text,                       -- canonical key, else the raw label
  value numeric,
  unit text,                            -- cr | pct | days | x | rs
  fetched_at timestamptz not null default now(),
  primary key (symbol, statement, basis, period, line_item)
);

create table guidance_items (
  id bigserial primary key,
  symbol text references companies(symbol),
  document_id bigint references documents(id) on delete cascade,
  said_period text,                     -- 'Q1 FY27'
  said_on date,
  speaker text,
  metric text not null,                 -- section 6.5 keys
  label_raw text,
  target_low numeric,
  target_high numeric,
  unit text,
  basis text,
  horizon text,                         -- 'FY27' | 'Q3 FY27' | 'medium_term'
  direction text,                       -- range | at_least | at_most | point | qualitative
  quote text not null,
  page_no int
);

create table reported_kpis (
  id bigserial primary key,
  symbol text references companies(symbol),
  document_id bigint references documents(id) on delete cascade,
  metric text, value numeric, unit text, period text, quote text, page_no int
);

create table ledger (
  guidance_id bigint primary key references guidance_items(id) on delete cascade,
  status text not null,                 -- delivered | near_miss | missed | on_track | off_track | revised | pending | unverifiable
  actual_value numeric,
  actual_unit text,
  actual_source text,                   -- 'fact:<key>' | 'doc:<id>:p<n>'
  revised_to jsonb,
  explanation text,
  evaluated_at timestamptz not null default now()
);

create table dossiers (
  symbol text references companies(symbol),
  version text,                         -- hash of document set + financials
  sections jsonb not null,              -- DossierV1, Appendix A
  sources jsonb not null,
  stats jsonb not null,                 -- {calls, tokens_in, tokens_out, cost_usd_est, seconds}
  created_at timestamptz not null default now(),
  primary key (symbol, version)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                   -- research | backfill
  symbol text,
  user_id text,
  status text not null default 'queued',  -- queued | running | done | failed
  step text,
  progress int not null default 0,
  log jsonb not null default '[]',
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table qa_messages (
  id bigserial primary key,
  symbol text, dossier_version text, user_id text,
  question text not null, answer text not null,
  citations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- Operations ---------------------------------------------------------------
create table llm_calls (
  id bigserial primary key,
  task text not null, model text not null, provider text not null,
  tokens_in int, tokens_out int, latency_ms int,
  ok boolean not null, cache_hit boolean not null default false,
  cost_usd_est numeric, error text, ref text,
  created_at timestamptz not null default now()
);
create table llm_cache (key text primary key, response jsonb not null, model text, created_at timestamptz not null default now());
create table http_cache (url_hash text primary key, url text not null, status int, body text, fetched_at timestamptz not null default now());
create table task_runs (id bigserial primary key, task text not null, started_at timestamptz not null default now(), finished_at timestamptz, ok boolean, detail jsonb);
```

**Ranking at read time** (web API): `final = (base_score + market_bonus + position_bonus) × feedback_multiplier`, then tier by the thresholds in 5.2. Only the primary filing of each `event_key` is ranked; the others are listed in the event sheet.

**Users:** Next.js middleware sets a `finn_uid` cookie (UUID) when absent. On a user's first request, copy the `demo` user's holdings and rules to them, so every evaluator gets their own editable copy.

**Seed:** `python -m finn seed` loads `data/symbols.csv` into `companies`, then creates the `demo` user with its holdings from `data/portfolio.yaml` (section 12) and the default rules (5.7).

### 11.2 Web API (Next.js route handlers)

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/brief?w=24h\|3d\|7d\|30d\|custom&from=&to=` | — | `{window, funnel:{filings, events, matter}, top[], worth[], routine:{count, items[]}, hidden_count, quiet, upcoming[]}` |
| `GET /api/events/:event_key` | — | `{event, filings[], results?, people?[], reasons, checks}` |
| `POST /api/feedback` | `{event_key, action}` | `{ok}` |
| `GET /api/alerts` | — | `{alerts[], unread}` |
| `POST /api/alerts/read` | `{ids[]}` | `{ok}` |
| `GET, POST /api/rules`; `PATCH, DELETE /api/rules/:id` | rule JSON | rule |
| `POST /api/rules/parse` | `{text}` | `{rules[], unparsed}`, via the worker |
| `GET, POST /api/portfolio`; `DELETE /api/portfolio/:symbol` | `{symbol, weight_pct?}` | holdings with last price, signal and latest event; an unknown symbol queues a backfill job |
| `GET /api/symbols?q=` | — | top 8 `{symbol, name}` |
| `GET /api/company/:symbol` | — | `{company, prices[120], events[], upcoming}` |
| `POST /api/research` | `{symbol}` | `{job_id}`, or `{dossier_version}` when the cache is fresh |
| `GET /api/jobs/:id` | — | `{status, step, progress, log, error}`; the client polls every 2 s |
| `GET /api/dossier/:symbol` | — | latest `DossierV1` |
| `POST /api/ask` | `{symbol, question, context?}` | `{answer, citations[]}`, via the worker, within 30 s |
| `POST /api/push/subscribe` | browser `PushSubscription` JSON | `{ok}` |
| `POST /api/push/test` | — | `{ok}`, via the worker |
| `GET /api/cost` | — | totals by task and model, cache-hit rate, estimated cost |

Limit `/api/research` to 5 builds and `/api/ask` to 30 questions an hour per `finn_uid`, to protect the free quotas. When the worker is cold, the UI says "Waking the research engine" and retries once after 30 seconds.

### 11.3 Worker API and CLI

Every endpoint except `/health` requires the header `X-Finn-Key: $WORKER_KEY`.

| Endpoint | Does |
| --- | --- |
| `GET /health` | `{ok, version, db}` |
| `GET /probe` | Status of every data source from this host |
| `POST /tasks/tick` | Returns 202 and runs due tasks in the background |
| `POST /tasks/run/{task}` | Runs one task now (admin) |
| `POST /jobs/{id}/kick` | Starts a queued job now |
| `POST /ask` | `{symbol, question, context}` returns `{answer, citations}` |
| `POST /rules/parse` | `{text, holdings}` returns `{rules, unparsed}` |
| `POST /push/test` | Sends a test push to a user |

CLI (`python -m finn <command>`): `probe`, `doctor`, `seed`, `ingest-announcements --since 7d [--symbol X]`, `ingest-prices --period 1y`, `process`, `signals`, `alerts`, `research SYMBOL`, `verify-results`, `taxonomy`, `eval results`, `eval classify`, `serve`.

## 12. Demo portfolio and research picks

The build week sits in the middle of Q2 FY27 results season (quarter ended 30 Sep 2026), so the portfolio is chosen for results landing between 27 Oct and 5 Nov. That gives live test data during the build and a busy feed while ENAM evaluates. It also includes two fresh management changes for the person card.

| Symbol | Company | Sector | Size | Weight % | Expected event in the window |
| --- | --- | --- | --- | --- | --- |
| RELIANCE | Reliance Industries | Energy, telecom, retail | Large | 10 | Q2 results on 30 Oct, with an NCD fund raise on the board agenda ([Upstox](https://upstox.com/news/market-news/earnings/reliance-industries-sets-october-30-for-q2-fy-27-results-ncd-fundraise-on-board-agenda/article-202491/)) |
| HDFCBANK | HDFC Bank | Private bank | Large | 10 | New MD & CEO Anup Bagchi from 27 Oct; tests the lender template ([Business Today](https://www.businesstoday.in/latest/corporate/story/hdfc-bank-appoints-anup-bagchi-as-md-ceo-for-three-year-term-from-october-27-559151-2026-10-01)) |
| LT | Larsen & Toubro | Capital goods, EPC | Large | 9 | Q2 results filed 27 Oct; also the deep research demo |
| BHARTIARTL | Bharti Airtel | Telecom | Large | 8 | Q2 results tentatively 5 Nov, during evaluation ([Airtel IR](https://www.airtel.in/about-bharti/equity/results/quarterly-calendar)) |
| SUNPHARMA | Sun Pharmaceutical | Pharma | Large | 7 | Q2 results 30 Oct |
| MARUTI | Maruti Suzuki | Autos | Large | 6 | Q2 results 27 Oct |
| HINDUNILVR | Hindustan Unilever | FMCG | Large | 5 | Q2 results 28 Oct; a low-volatility contrast for 2.5σ moves |
| HAL | Hindustan Aeronautics | Defence PSU | Large | 5 | Director (Operations) appointed effective 28 Oct ([Indian Masterminds](https://indianmasterminds.com/news/hal-appoints-p-b-rangarao-director-operations-246395/)) |
| TRENT | Trent | Retail | Large | 5 | Q2 results 29 Oct |
| INDIGO | InterGlobe Aviation | Aviation | Large | 5 | Q2 results 29 Oct |
| DIXON | Dixon Technologies | Electronics manufacturing | Mid | 5 | Q2 results 30 Oct |
| ASIANPAINT | Asian Paints | Paints | Large | 4 | Q2 results 29 Oct |
| TATASTEEL | Tata Steel | Metals | Large | 4 | Q2 results 27 Oct |
| KPITTECH | KPIT Technologies | Auto software | Mid | 4 | Q2 results 28 Oct |
| MAXHEALTH | Max Healthcare | Hospitals | Mid | 4 | Q2 results 30 Oct |
| NAUKRI | Info Edge | Internet | Mid | 4 | Q2 results 28 Oct |
| WAAREEENER | Waaree Energies | Solar manufacturing | Mid | 3 | Q2 results 27 Oct; large volume swings |
| SUZLON | Suzlon Energy | Wind | Small to mid | 2 | Q2 results 29 Oct; frequent volume spikes |

Results dates for 26–30 Oct come from CNBC-TV18's weekly list ([TradingView](https://www.tradingview.com/news/cnbctv:ff0962a73094b:0/)) and the flashfinance calendar ([flashfinance](https://flashfinance.news/results-calendar/)). Before seeding, confirm each date with BSE's result calendar endpoint (9.3) and swap any company whose results have moved.

The weights are illustrative. They drive the position-weight modifier and show a concentrated book of 18 names, the largest at 10%.

**Research picks** — chosen because each has a long record of explicit, numeric guidance, which makes Say vs Do rich:

| Symbol | Why it shows off the ledger |
| --- | --- |
| LT | Annual order-inflow, revenue and margin guidance; already in the portfolio, so push and pull connect |
| INFY | Revenue-growth guidance bands that are revised every quarter, a near-perfect test of "Revised" |
| BAJFINANCE | Lender guidance on AUM growth and credit cost; exercises the lender template |
| ETERNAL | Operating targets such as store counts alongside margin commentary |
| POLYCAB | Multi-year revenue and margin targets |

On day 1, check that screener lists at least four transcripts for each pick. The README should invite graders to try any other ticker, such as ASIANPAINT, HCLTECH or TITAN.

## 13. Execution plan

Four working days remain, Thursday 29 Oct to Sunday 1 Nov. The plan puts a working skeleton on a phone by Thursday noon, finishes push by Friday night and pull by Saturday night, and keeps Sunday for polish. Submit by 18:00 IST on Sunday.

&#91;embedded content: Build plan · target end time printed beside each milestone, IST\]

Each bar ends at its milestone's target time; the cut lines in 13.3 are checked at those ends.

### 13.1 Tonight (Wed 28 Oct): owner checklist, 2–3 hours

- [ ] Create accounts and keys: GitHub (public repo `finn`), Vercel Hobby, Supabase (Mumbai region), Render (Singapore), Google AI Studio (Gemini key; screenshot the project's rate limits), Groq, cron-job.org, and optionally Tavily.
- [ ] Generate VAPID keys with `npx web-push generate-vapid-keys`.
- [ ] Create the repo with `docs/FINN_SPEC.md` (this doc exported as Markdown), `CLAUDE.md` (section 14) and an empty `BUILD_LOG.md`.
- [ ] Open the BSE announcements URL (9.2) for one scrip code in your browser and confirm it returns JSON.
- [ ] Confirm the portfolio's results dates with BSE's result calendar.
- [ ] Save this conversation's share link for the AI build history.

### 13.2 Milestones and acceptance tests

| ID | Milestone | Done when | Target |
| --- | --- | --- | --- |
| M0 | Skeleton deployed | A phone opens the Vercel URL and sees the FINN shell with four tabs; Render's `/health` returns ok; the schema is applied; `probe` shows BSE returning 200 from both laptop and Render | Thu 12:00 |
| M1 | Prices and signals | `ingest-prices` stores at least 240 sessions for all 18 symbols; `signals` writes today's rows; a unit test checks `vol_ratio` and `ret_z` on a fixture | Thu 15:00 |
| M2 | Filings ingested, classified, grouped, scored | `ingest-announcements --since 30d` loads all 18; the `taxonomy` report shows at least 90% classified by rules; every row has a category, event key and base score | Thu 20:00 |
| M3 | Brief UI v1 | Window chips change the counts; tiers render; routine collapses; the quiet state shows on an empty window; funnel counts are correct | Thu 23:00 |
| M4 | Results card | `eval results` passes on the golden set (at least 95% of numbers within 0.5%); cards render for L&T, Maruti, Tata Steel and HUL; checks show in the source drawer | Fri 15:00 |
| M5 | Person card | HDFC Bank (Anup Bagchi) and HAL (P B Rangarao) render with the filing's profile, sourced background and flags | Fri 19:00 |
| M6 | Alerts and push | Default rules are seeded; the end-of-day run creates a price or volume alert with "Explained by"; a test push reaches an Android phone; the inbox shows unread count | Fri 23:00 |
| M7 | Research engine | `research LT` finishes in under 4 minutes with at least 8 guidance items and 3 resolved ledger items; steps are visible; a repeat call returns from cache in under 1 second | Sat 15:00 |
| M8 | Dossier UI and Ask | The Dossier renders every section for LT and for an unseen ticker (ASIANPAINT) built from the UI; every bullet opens a source; Ask answers with citations | Sat 23:00 |
| M9 | Polish and submission | Lighthouse mobile performance at least 85; cost page live; README, writeup, AI build history and a 90-second video done; email sent | Sun 18:00 |

### 13.3 Cut lines

Decide at these times, not later.

| Checkpoint | If this is not done | Cut |
| --- | --- | --- |
| Thu 20:00 | M2 | Drop NSE; group only results filings; classify by rules only |
| Fri 19:00 | M5 | Show the filing's profile only; move background enrichment to Sunday |
| Fri 23:00 | M6 | Keep in-app alerts; drop Web Push and the digest |
| Sat 15:00 | M7 | Build the ledger from transcripts only; skip the annual-report pass; drop Ask |
| Sun 12:00 | Anything still broken | Freeze features; fix, re-seed, record the video |

**Never cut:** the deployed link working on a phone, the Brief with tiers, the results card, and one complete Dossier with Say vs Do.

### 13.4 The owner's daily rhythm

- **Morning:** read `BUILD_LOG.md`, use the deployed app on your phone, decide on cut lines.
- **During the day:** give the agent one milestone at a time, with its acceptance test pasted in.
- **Evening:** run the acceptance tests yourself, commit, and export the agent session into `docs/ai-build-history/`.

## 14. Operating instructions for the implementing agent

Save the block below as `CLAUDE.md` at the repo root. It tells a coding agent the order of work, the layout, the conventions and the hard rules, so a lighter model can build FINN without re-deciding anything.

```markdown
# FINN: instructions for coding agents

## Read first
- docs/FINN_SPEC.md is the source of truth. Build milestones M0 to M9 in order (spec section 13).
- Each milestone has an acceptance test. Do not start the next milestone until it passes.
- Read only the spec sections listed for the current milestone (table below).

| Milestone | Spec sections |
| --- | --- |
| M0 Skeleton | 8, 11, Appendix C |
| M1 Prices and signals | 5.6, 9.5 |
| M2 Filings | 5.1-5.3, 9.1-9.4, Appendix B |
| M3 Brief UI | 5.8, 7 |
| M4 Results card | 5.4, 9.7, 10, Appendix A (results) |
| M5 Person card | 5.5, 9.8, Appendix A (people) |
| M6 Alerts and push | 5.6, 5.7, 7.2 |
| M7 Research engine | 6.1-6.6, 9.6, 10, Appendix A |
| M8 Dossier UI and Ask | 6.7-6.9, 7 |
| M9 Polish | 15, 17 |

## Repository layout
finn/
  CLAUDE.md  BUILD_LOG.md  README.md
  docs/FINN_SPEC.md  docs/ai-build-history/
  db/schema.sql  db/seed.sql
  data/symbols.csv  data/portfolio.yaml  data/golden/results/*.json
  worker/                 # Python 3.12
    pyproject.toml  Dockerfile
    finn/
      __main__.py         # Typer CLI
      config.py  db.py  log.py  api.py (FastAPI)
      sources/   bse.py nse.py prices.py screener.py pdf.py http.py
      pipeline/  rules.py classify.py group.py score.py results.py people.py
                 oneliners.py signals.py alerts.py push.py tasks.py
      research/  job.py docs.py transcript.py annual_report.py facts.py
                 ledger.py synthesize.py ask.py validate.py
      llm/       router.py cache.py schemas.py pricing.py prompts/*.md
    tests/
  web/                    # Next.js, App Router, TypeScript
    app/  components/  lib/db.ts  lib/rank.ts
    public/sw.js  public/manifest.webmanifest
  .github/workflows/ci.yml  .github/workflows/ingest-fallback.yml

## Commands
- Worker: cd worker && pip install -e ".[dev]"; python -m finn doctor; python -m finn serve; pytest -q
- Web: cd web && pnpm i; pnpm dev; pnpm build; pnpm lint
- Database: apply db/schema.sql in the Supabase SQL editor, then python -m finn seed

## Hard rules
1. Every model call goes through worker/finn/llm/router.py. Never import a provider SDK anywhere else.
2. LLMs extract; code decides. Scores, thresholds, arithmetic, QoQ/YoY and ledger statuses are Python functions with unit tests.
3. Every extracted fact carries a quote and a page. Drop facts whose quote is not on that page.
4. After extraction, money is Rs crore everywhere. Convert lakh (divide by 100) and million (divide by 10) at the boundary.
5. No page load calls a model or a scraper. Pages read Postgres only.
6. Every pipeline stage is idempotent and driven by status columns. Use upserts on natural keys so re-runs never duplicate rows.
7. Secrets come only from environment variables (spec Appendix C). Never commit .env.
8. Be polite to sources: BSE about 1 request/second, screener 1 request/3 seconds, NSE through the nse package's limiter. Cache HTTP responses.
9. Never request linkedin.com. Never use screener's prose (About, Key Points, pros and cons, AI summaries).
10. UI copy: sentence case, numbers with units, none of the banned words in spec section 3, no all-caps labels.
11. Stuck for more than 30 minutes? Take the fallback written in the spec, log it in BUILD_LOG.md, move on.
12. Commit after each passing acceptance test: "M<n>: <milestone name>".
13. Before any UI work, load the frontend-design skill and follow spec section 7.

## Definition of done for any task
- Code plus tests: pure functions get unit tests; each source gets a test against a saved fixture.
- pytest -q and pnpm build both pass.
- BUILD_LOG.md updated: what changed, how it was tested, any fallback taken.

## Libraries
Worker: fastapi, uvicorn[standard], typer, httpx, pydantic>=2, psycopg[binary,pool]>=3.2,
  yfinance>=1.7.0, bse>=3.3.4, nse>=5.1.0 (optional), pymupdf, selectolax, pandas, numpy,
  rapidfuzz, google-genai>=2.33, openai (for Groq), pywebpush, tenacity, python-dateutil, tzdata
Web: next (latest stable), react, typescript, tailwindcss@4, @radix-ui primitives, vaul, motion,
  lucide-react, postgres (porsager), zod
```

**Prompt template the owner pastes for each milestone:**

```text
Implement milestone M4 (Results card) from docs/FINN_SPEC.md, sections 5.4, 9.7, 10 and
Appendix A (results_extract). Follow CLAUDE.md.
Acceptance test: <paste the row from spec 13.2>.
Work in small commits. When the acceptance test passes, update BUILD_LOG.md and stop.
If blocked for 30 minutes, take the documented fallback and say which one you took.
```

## 15. Quality, evaluation and testing

Three small evaluation sets turn extraction quality into numbers you can quote in the writeup, and unit tests guard every deterministic rule. Report the results in the README's Quality table.

### 15.1 Golden sets

| Set | Size | How labels are made | Pass bar | Command |
| --- | --- | --- | --- | --- |
| Results | 10 Q2 FY27 filings: LT, MARUTI, TATASTEEL, WAAREEENER, HINDUNILVR, NAUKRI, KPITTECH, ASIANPAINT, TRENT, INDIGO | Auto-labelled from screener's quarterly table (Sales, Operating Profit, PBT, Net Profit) for all three periods; spot-check 3 by hand against the PDF | At least 95% of the 120 numbers within 0.5% | `python -m finn eval results` |
| Classification | 150 filings from the 30-day backfill | Rules label most; the owner hand-labels the 30 ambiguous ones in a CSV (about 10 minutes) | At least 90% category accuracy; report model-only accuracy separately | `python -m finn eval classify` |
| Ledger | LT and INFY | The owner checks 10 items each against the transcripts | At least 8 of 10 with the correct status and quote | Manual checklist |

Screener's Net Profit includes minority interest, so the results set compares it with total PAT, not the owners' share.

### 15.2 Unit tests that must exist

- `rules.py`: a positive and a negative example for every rule in Appendix B.
- `score.py`: each modifier and tier boundary on fixtures.
- Results maths: EBITDA, margins, bps, QoQ and YoY, unit conversion (lakh, crore, million) and each check in 5.4.
- `signals.py`: `vol_ratio` and `ret_z` on a synthetic series, including holiday gaps.
- `ledger.py`: each status rule with synthetic guidance and facts.
- `validate.py`: number grounding for Indian digit grouping ("₹1,23,456.7 cr"), percentages, bps and multiples.
- Screener parser: a saved HTML fixture of the LT page produces the expected tables and document links.
- BSE source: a saved JSON fixture produces normalised rows with IST timestamps.

### 15.3 Runtime guards

- Extraction checks (5.4) and quote-on-page checks (10.3) run on every extraction.
- Number grounding (6.6) runs on every synthesis.
- **Freshness:** Settings shows "Filings checked 6 min ago; prices at 16:15" from `task_runs`. If filings are more than 30 minutes stale during market hours, the Brief shows a small "Data may be delayed" line.
- A failed extraction never hides an event. It falls back to the title and the filing link.

### 15.4 Pre-submission check on a real phone

- [ ] The link opens in Android Chrome and iPhone Safari, and the Brief renders within 2 seconds on 4G.
- [ ] The 24h, 7d and 30d windows all show sensible content; an empty custom range shows the quiet state.
- [ ] Results cards for three companies match the PDF page shown in the source drawer.
- [ ] The HDFC Bank person card's sources open.
- [ ] Adding TITAN completes its backfill and it appears in the Brief.
- [ ] A dossier for an unseen ticker builds from the UI, and its sources open.
- [ ] Ask gives a cited answer, and says "Not in FINN's documents" for an unanswerable question.
- [ ] A plain-English rule becomes a chip and fires on a test signal.
- [ ] A test push arrives on Android.
- [ ] The cost page shows calls and cache hits.
- [ ] No console errors; Lighthouse mobile performance at least 85.

## 16. Risks and mitigations

The two risks most likely to sink the submission are time and a source blocking the cloud worker; both have fixed fallbacks. Rows are ordered by how much damage each risk could do.

| Risk | Mitigation | Fallback if it happens |
| --- | --- | --- |
| Time overrun | Milestones with acceptance tests; cut lines at fixed checkpoints (13.3) | The never-cut list: link on a phone, Brief, results card, one full Dossier |
| BSE refuses requests from Render's IPs | Probe on day 1; browser headers; about 1 request per second | Run the same CLI from GitHub Actions on a cron, or from the owner's laptop on a schedule. The app is unaffected because it reads Postgres |
| Wrong numbers on a results card | Page targeting, six checks, one retry, verification against exchange data | Show "Unverified" with the filing link instead of numbers |
| Lakh, crore and million confused | Unit field required in the schema; previous-quarter sanity check | Mark the card unverified |
| Screener blocks requests or changes its HTML | 12-hour HTML cache; fixture tests; generic row parsing | Pre-build dossiers for the portfolio and the five research picks before submitting; show a clear job error for new tickers |
| Gemini quota exhausted or a model renamed | A different model per tier; `doctor` check; caching; fallback chains | Groq for T1; deterministic sections still render; AI sections show "Pending" with a retry |
| Supabase pauses after a week without activity | The 10-minute tick writes `task_runs`, which keeps the project active | Restore it from the Supabase dashboard; the README says how |
| Render sleeps or the tick stops | The tick keeps it awake; cron-job.org emails on failure | GitHub Actions runs the daily job; reads never depend on the worker |
| Graders open FINN on a quiet day | Quiet state with "Show 7 days"; a results-season portfolio | The 30-day window |
| NSE blocks cloud clients | NSE is optional and auto-disables | BSE only |
| Yahoo rate-limits | One batch per run; yfinance 1.7 or later | BSE price history |
| Push on iPhone is unreliable | The in-app inbox is the primary channel | Demonstrate push on Android in the video |
| Gemini's free tier may use inputs for training | Only public filings are ever sent | State this in the writeup |
| Source terms of use | Public pages only, polite rates, no login walls, no LinkedIn requests | Cite every source; keep it a personal prototype |

## 17. Submission kit

The submission is four links and a short email. Draft the writeup on Saturday night and fill in the measured numbers on Sunday, so Sunday is for checking, not writing.

### 17.1 README outline

1. One-line pitch, the app link and the 90-second video.
2. **Try it on your phone:** open the Brief, switch to 7d, open a results card and tap a number to see its source page, then go to Research and type any NSE ticker.
3. What FINN does: Brief, Watch, Dossier, Ask, in four bullets.
4. How FINN decides: the scoring formula and the treatment table, briefly.
5. Architecture diagram and stack.
6. Data sources and the primary-source rule.
7. Models and cost: the routing table plus measured calls per day, cache-hit rate and ₹ spent.
8. Quality: the golden-set results.
9. What was left out, and why.
10. Running it locally: environment variables and commands.
11. Known limitations.

### 17.2 Writeup (email body)

Edit the draft below, replacing the bracketed figures with measured ones.

```text
To: assessment@enam.com
Subject: ENAM - IIT screening - 2027

Hello ENAM team,

I'm submitting FINN, a mobile-first investing agent, for the AI Engineer Build Challenge.

Links
- Prototype (best on a phone): [Vercel URL]
- Repository: [GitHub URL]
- AI build history: [this planning chat's share link]; Claude Code session exports in docs/ai-build-history/
- 90-second walkthrough: [video URL]

What I built
FINN treats an investor's attention as scarce capital. The Brief groups about [N] filings a day
across 18 holdings into events, ranks them by materiality with a visible reason, and collapses
the routine. Results get a card with Revenue, EBITDA, PBT and PAT, QoQ and YoY, checked
arithmetically and against exchange data. Management changes get a person card with sourced
background. Watch rules flag price and volume moves and say which filing, if any, explains them.
For any NSE ticker, the Dossier tracks management's last four quarters of guidance against what
was delivered, with a credibility score, using only annual reports and transcripts. Every claim
is cited to a page.

Key decisions and trade-offs
1. Events, not filings, and a Brief that ends. Some filings are counted rather than shown.
2. LLMs extract; code decides. Scores, arithmetic and promise matching are deterministic and
   tested: less flexible than letting a model rank, but explainable and nearly free.
3. BSE as the primary filings source, NSE optional, because NSE is unreliable from cloud hosts.
4. Results numbers come from the filing itself, read from 1-2 targeted pages, with six checks
   and a verification badge.
5. Postgres is the only contract between the Next.js app and the Python worker, so no screen
   waits on a scraper or a model.
6. Model routing: rules classify [90]% of filings; Flash-Lite handles bulk text; Flash extracts;
   the newest Flash with high thinking writes the synthesis. Measured: [X] calls a day, [Y]%
   cache hits, Rs 0 spent.

Left out on purpose
Intraday prices, broker estimates and news (secondary data), login, a native app, P&L tracking.

Next
1. Thesis tracking: one line of thesis per holding, with every event scored against it.
2. Guidance-drift charts across years and against peers.
3. Delivery-% and bulk-deal signals; weekly insider aggregation.
4. Alerts on WhatsApp or Telegram, and the morning Brief as audio.
5. An evaluation set that grows with every corrected extraction.

Thanks,
[Name], [IIT, programme, year], [phone]
```

### 17.3 AI build history

- **This planning conversation:** create a share link and put it in the README and the email.
- **Each Claude Code session:** run `/export` at the end (it saves the conversation to a file or the clipboard) and save it as `docs/ai-build-history/YYYY-MM-DD-M<n>.md`. Use `/resume` to continue a session rather than starting cold.
- **`BUILD_LOG.md`:** one entry per milestone with what changed, how it was tested and any fallback taken.
- Keep one milestone per session; the history then reads as a disciplined process.

### 17.4 The 90-second video

1. **0–10 s:** the funnel line on the Brief; "FINN shows what matters and hides the rest."
2. **10–30 s:** a results card; tap a number to open its filing page; show the checks.
3. **30–45 s:** the HDFC Bank person card and its sources.
4. **45–60 s:** an alert with "No filing explains this move"; a push arriving on Android.
5. **60–80 s:** build a dossier for a ticker typed live; open Say vs Do and one ledger row's source.
6. **80–90 s:** the cost page, "₹0 spent, most calls served from cache".

### 17.5 Before you send

- [ ] The subject line is exactly `ENAM - IIT screening - 2027`.
- [ ] Every link opens in a private browser window, signed out.
- [ ] The repo is public, has no secrets, and the README's first screen has the app link.
- [ ] Dossiers are pre-built for the portfolio and the five research picks.
- [ ] cron-job.org shows green runs for the last 24 hours.
- [ ] Send by 18:00 IST on Sunday 1 Nov.

## Appendix A. Prompts and JSON schemas

These are the starting prompts and output schemas for every model task. Save schemas in `worker/finn/llm/schemas.py` and prompts in `worker/finn/llm/prompts/<task>.md`. Gemini's structured output does not accept free-form objects, so every object below has named fields.

### A.1 Schemas

```python
from typing import Literal, Optional
from pydantic import BaseModel, Field

Category = Literal["results", "M&A", "fund_raise", "management_change", "litigation",
    "insider_trading", "earnings_call", "investor_meetings", "credit_rating", "dividend",
    "bonus_split", "capex", "press_release", "postal_ballot", "agm_egm", "pledging",
    "unclassified"]

class ClassifiedItem(BaseModel):
    id: str
    category: Category
    subtype: Optional[str] = None          # Appendix B subtypes
    confidence: float = Field(ge=0, le=1)

class ClassifyBatch(BaseModel):
    items: list[ClassifiedItem]

class OneLiner(BaseModel):
    id: str
    one_liner: str = Field(max_length=140)
    amount_cr: Optional[float] = None       # deal, order, fund raise, capex or penalty, in Rs crore
    amount_quote: Optional[str] = None
    direction: Optional[Literal["up", "down", "same"]] = None   # ratings, pledges

class OneLinerBatch(BaseModel):
    items: list[OneLiner]

class ResultLines(BaseModel):
    period_end: str                         # YYYY-MM-DD
    revenue_from_operations: Optional[float] = None
    other_income: Optional[float] = None
    total_income: Optional[float] = None
    finance_costs: Optional[float] = None
    depreciation_amortisation: Optional[float] = None
    total_expenses: Optional[float] = None
    profit_before_exceptional_and_tax: Optional[float] = None
    exceptional_items: Optional[float] = None
    share_of_associates_jv: Optional[float] = None
    profit_before_tax: float
    tax_expense: Optional[float] = None
    profit_after_tax_total: float
    profit_after_tax_owners: Optional[float] = None
    interest_earned: Optional[float] = None     # lender template
    interest_expended: Optional[float] = None
    operating_expenses: Optional[float] = None
    provisions: Optional[float] = None
    gross_npa_pct: Optional[float] = None

class ResultsExtract(BaseModel):
    basis: Literal["consolidated", "standalone"]
    unit: Literal["lakh", "crore", "million", "thousand", "rupees"]
    page_numbers: list[int]
    current: ResultLines
    previous_quarter: ResultLines
    year_ago_quarter: ResultLines
    note: Optional[str] = Field(default=None, max_length=200)   # e.g. what an exceptional item is

class PersonChange(BaseModel):
    person_name: str
    designation: str
    role_class: Literal["top", "kmp", "independent", "auditor", "other"]
    change_type: Literal["appointment", "resignation", "retirement", "cessation",
                         "redesignation", "reappointment"]
    effective_date: Optional[str] = None
    reason: Optional[str] = None
    brief_profile: Optional[str] = Field(default=None, max_length=600)
    relationships: Optional[str] = None
    resignation_letter_attached: Optional[bool] = None
    quote: str
    page: int

class PeopleExtract(BaseModel):
    changes: list[PersonChange]

class Source(BaseModel):
    title: str
    url: str

class Role(BaseModel):
    organisation: str
    title: str
    start_year: Optional[int] = None
    end_year: Optional[int] = None
    source_url: str

class PersonBackground(BaseModel):
    headline: Optional[str] = Field(default=None, max_length=120)  # "Joins from X, where he was Y"
    previous_roles: list[Role]
    education: list[str]
    years_experience: Optional[int] = None
    linkedin_url: Optional[str] = None
    sources: list[Source]

class GuidanceItem(BaseModel):
    metric: str                             # key from spec 6.5, or "other:<label>"
    label_raw: str
    target_low: Optional[float] = None
    target_high: Optional[float] = None
    unit: Literal["pct", "cr", "bps", "count", "x", "other"]
    basis: Literal["reported", "constant_currency", "organic", "ex_one_offs", "unspecified"]
    horizon: str                            # "FY27", "Q3 FY27", "H2 FY27", "medium_term"
    direction: Literal["range", "at_least", "at_most", "point", "qualitative"]
    speaker: Optional[str] = None
    quote: str = Field(max_length=300)
    page: int

class ReportedKPI(BaseModel):
    metric: str
    value: float
    unit: str
    period: str
    quote: str
    page: int

class NarrativeClaim(BaseModel):
    claim: str = Field(max_length=160)
    horizon: Optional[str] = None
    quote: str
    page: int

class AnalystConcern(BaseModel):
    topic: str = Field(max_length=80)
    summary: str = Field(max_length=160)
    page: int

class TranscriptExtract(BaseModel):
    call_period: str                        # "Q1 FY27"
    call_date: Optional[str] = None
    guidance: list[GuidanceItem]
    reported_kpis: list[ReportedKPI]
    narrative_claims: list[NarrativeClaim]
    analyst_concerns: list[AnalystConcern]

class Segment(BaseModel):
    name: str
    revenue_cr: Optional[float] = None
    share_pct: Optional[float] = None
    page: int

class Citation(BaseModel):
    field: str
    page: int
    quote: str

class AnnualReportExtract(BaseModel):
    fiscal_year: str
    business_description: str = Field(max_length=300)
    segments: list[Segment]
    top_risks: list[str]
    contingent_liabilities_cr: Optional[float] = None
    related_party_highlights: list[str]
    auditor_opinion: Literal["unmodified", "qualified", "adverse", "disclaimer", "unknown"]
    key_audit_matters: list[str]
    citations: list[Citation]

class JudgedClaim(BaseModel):
    claim_id: int
    verdict: Literal["agree", "diverge", "too_early"]
    evidence: str = Field(max_length=200)
    cites: list[str]

class LedgerJudge(BaseModel):
    items: list[JudgedClaim]

class Bullet(BaseModel):
    text: str = Field(max_length=200)
    cites: list[str] = Field(min_length=1)  # "doc:<id>:p<n>" or "fact:<key>"

class NarrativeCheck(BaseModel):
    claim: str
    verdict: Literal["agree", "diverge", "too_early"]
    evidence: str
    cites: list[str] = Field(min_length=1)

class Synthesis(BaseModel):
    what_matters_now: list[Bullet] = Field(min_length=3, max_length=3)
    narrative_vs_numbers: list[NarrativeCheck] = Field(min_length=3, max_length=6)
    bull: list[Bullet] = Field(min_length=3, max_length=3)
    bear: list[Bullet] = Field(min_length=3, max_length=3)
    seed_questions: list[str] = Field(min_length=3, max_length=3)

class Answer(BaseModel):
    answer: str = Field(max_length=900)
    cites: list[str]
    found: bool

class RuleDraft(BaseModel):
    kind: Literal["category", "price_move", "volume_spike", "sigma_move"]
    symbol: Optional[str] = None            # None = all holdings
    categories: Optional[list[Category]] = None
    subtypes: Optional[list[str]] = None
    pct: Optional[float] = None
    multiple: Optional[float] = None
    z: Optional[float] = None
    label: str

class ParsedRules(BaseModel):
    rules: list[RuleDraft]
    unparsed: Optional[str] = None
```

The stored `DossierV1` is assembled by code, not by a model: `{symbol, name, built_at, basis, documents[], header, what_matters_now[], say_vs_do: {credibility, items[]}, numbers, cash, balance_sheet, business, narrative_vs_numbers[], bull[], bear[], seed_questions[], stats}`.

### A.2 Prompts

**Shared preamble** (system instruction for every extraction task):

```text
You extract facts from Indian stock-exchange filings for an investment research tool.
Use only the text provided. If a field is not stated, return null.
Never infer, estimate or calculate numbers. Copy numbers as plain decimals without
thousands separators, in the units the document states. Every fact must carry a short
verbatim quote and the page number where it appears. Pages are marked [p.N].
```

**classify\_batch**

```text
Classify each filing into exactly one category, plus a subtype from the list when one fits.
Categories and subtypes: {appendix_b_table}
If a filing covers several items, pick the most material, in this order: results,
management_change, M&A, fund_raise, litigation, credit_rating, pledging, capex,
insider_trading, dividend, bonus_split, press_release, earnings_call, agm_egm,
postal_ballot, investor_meetings, unclassified.
A board-meeting outcome that approves financial results is results. A newspaper
advertisement of results is results with subtype results_admin.
Filings:
{for each: <f id="..."><subject>...</subject><headline>...</headline><excerpt>first 1,500 characters</excerpt></f>}
```

**one\_liners\_batch**

```text
For each filing, write one line of at most 140 characters telling an investor what
happened, numbers first. No adjectives and no company name (it is shown separately).
If a main amount is stated, give it in Rs crore (lakh / 100, million / 10, billion x 100)
with the quote it came from. For ratings and pledges, give the direction.
Never use: robust, significant, notably, impressive, strong, delve, landscape.
```

**results\_extract** (input: the 1–2 targeted pages as a PDF)

```text
These pages hold the financial results of {company} for the quarter ended {period_end}.
Extract the {preferred_basis} statement of profit and loss, using three columns only: the
current quarter, the immediately preceding quarter, and the same quarter last year.
Ignore half-year and full-year columns. Report the unit printed on the page.
Line mapping: revenue_from_operations = "Revenue from operations" (never "Total income");
profit_before_tax = after exceptional items; profit_after_tax_total = "Profit for the period";
profit_after_tax_owners = the share attributable to owners or equity holders of the parent.
For a bank or NBFC, fill the lender fields as well.
{on retry: Your previous answer failed these checks: {failures}. Re-read the page and correct it.}
```

**people\_extract**

```text
This filing discloses a change in directors, key managerial personnel, senior management or
auditors under SEBI LODR Regulation 30. List every person whose position changes.
role_class: top = MD, CEO, Chairman, CFO, whole-time or executive director; kmp = company
secretary, compliance officer or other senior management; independent = independent or
non-executive director; auditor = statutory or secretarial audit firm.
Copy the brief profile and the stated reason exactly as written.
```

**person\_background** (two calls)

```text
Call 1, with the Google Search tool:
Find the professional background of {name}, {change_type} as {designation} of {company}
(India), effective {date}. List previous roles with organisation, title and years;
education; total years of experience. Report only what the search results state, each with
its source URL. Include a LinkedIn profile URL only if one appears in the results.
If nothing reliable is found, say so.

Call 2, T1, no tools: convert these notes into the PersonBackground schema.
Keep only facts that have a source URL.
```

**transcript\_extract**

```text
This is the transcript of {company}'s earnings call for {call_period}.
1. guidance: every forward-looking target stated by management (growth, margins, capex,
   debt, order inflow, volumes, capacity or stores, credit cost, NIM, AUM). Directional
   statements count, with direction = qualitative. Use a metric key from {metric_keys},
   else "other:<short label>". Record the basis exactly as stated, or "unspecified".
   Record the horizon (FY27, Q3 FY27, H2 FY27, medium_term). Analysts' questions are
   never guidance.
2. reported_kpis: numbers management states as actual results for a past period.
3. narrative_claims: at most 8 qualitative claims about demand, pricing, competition, margins.
4. analyst_concerns: at most 6 topics analysts pressed on.
```

**ar\_extract** (input: the targeted pages from 6.3)

```text
These are selected pages of {company}'s annual report for {fiscal_year}.
Fill the schema: a two-sentence description of the business; segments with revenue and
share where a segment table exists; the top risks management names; total contingent
liabilities in Rs crore; notable related-party transactions; the auditor's opinion type and
key audit matters. Add a citation (field, page, quote) for every item.
```

**ledger\_judge**

```text
For each management claim below, decide whether the financial facts agree with it, diverge
from it, or whether it is too early to tell. Use only the facts given. The evidence must
quote numbers from the facts, with their keys in cites.
```

**synthesize** (T3)

```text
Write the research summary of {company} for a concentrated public-markets investor.
Use only the facts, ledger and extracts below; do not use any outside knowledge of the
company. Every bullet cites at least one input id (doc:... or fact:...). Numbers carry units.
At most 25 words per bullet. Never use: robust, significant, notably, impressive, strong,
delve, landscape.
Produce: what_matters_now (3), narrative_vs_numbers (3 to 6), bull (3), bear (3), and
seed_questions (3 questions an investor would ask next that these documents can answer).
```

**ask**

```text
Answer the investor's question about {company} using only the excerpts and facts below.
Cite a page or fact id for every statement. If the answer is not there, set found = false
and give the closest available fact. At most 120 words.
Question: {question}
Context: {event context, if asked from a card}
```

**parse\_rule**

```text
Turn the investor's request into alert rules. Kinds: category (categories and subtypes from
Appendix B), price_move (pct), volume_spike (multiple of the 20-day average), sigma_move (z).
Symbols must come from these holdings: {symbols}. With no symbol named, use null (all
holdings). Write a short plain-English label. Put anything you cannot map into unparsed.
Request: {text}
```

## Appendix B. Classification rules and base scores

The rules run in order on one lower-cased string, `subcategory | subject | headline`, and the first match wins. They are a starting set: on day 1, run `python -m finn taxonomy` on the 30-day backfill, read the unmatched subjects, and add rules until at least 90% of filings match. Categories follow ENAM's reference document; subtypes are FINN's.

### B.1 Ordered rules

```python
# worker/finn/pipeline/rules.py  (id, regex, category, subtype or resolver)
# Order matters. Tested on 28 realistic BSE and NSE subjects: 28 of 28 correct.
RULES = [
  ("R01", r"auditor.*(resign|cessation)|resignation of (the )?statutory auditor", "management_change", "auditor_exit"),
  ("R02", r"(re-?)?appointment of (the )?(statutory|secretarial|internal|cost) auditor", "unclassified", "auditor_appointment"),
  ("R03", r"statement of deviation|monitoring agency|utili[sz]ation of (issue )?(proceeds|funds)", "unclassified", "compliance"),
  ("R04", r"insolvency|\bnclt\b|\bcirp\b|\bibc\b", "litigation", "insolvency"),
  ("R05", r"(sebi|\brbi\b|enforcement directorate|\bcbi\b|income tax|\bgst\b|customs|competition commission).*(order|penalty|show cause|search|notice)|action\(s\) (taken|initiated)|orders? passed", "litigation", "regulatory_action"),
  ("R06", r"litigation|dispute|arbitration|legal proceeding", "litigation", "dispute"),
  ("R07", r"pledge|encumbrance", "pledging", "resolve:pledge_direction"),
  ("R08", r"credit rating|rating.*(assign|reaffirm|affirm|upgrad|downgrad|revis|withdraw)|\bcrisil\b|\bicra\b|care ratings|india ratings|acuite", "credit_rating", "resolve:rating_direction"),
  # SAST disclosures say "acquisition", so insider rules must run before M&A.
  # Do not match bare "regulation 29" (LODR Reg 29 is board-meeting intimation)
  # or bare "regulation 31" (LODR Reg 31 is the shareholding pattern).
  ("R09", r"insider trading|\bsast\b|takeover|substantial acquisition|\bpit\b|regulation 7\s?\(2\)|reg\.? ?7\s?\(2\)", "insider_trading", "resolve:insider"),
  ("R10", r"integrated filing", "results", "results_admin"),
  ("R11", r"newspaper|advertisement", "resolve:newspaper", None),
  ("R12", r"transcript", "earnings_call", "transcript"),
  ("R13", r"(audio|video|recording).*(call|meet)|(call|meet).*(audio|video|recording)", "earnings_call", "recording"),
  ("R14", r"investor presentation|analyst presentation|earnings presentation", "earnings_call", "presentation"),
  ("R15", r"(earnings|conference|con\.) ?call|call.*(result|q[1-4])", "earnings_call", "call_notice"),
  ("R16", r"(prior )?intimation of board meeting|board meeting.*(intimation|to consider)", "resolve:board_notice", None),
  ("R17", r"financial results?|unaudited|audited.*results|results? for the (quarter|period|year)|q[1-4] ?(fy)? ?\d{2,4}.*(revenue|profit|ebitda|\bpat\b)", "results", "financial_results"),
  ("R18", r"buy ?back", "fund_raise", "buyback"),
  ("R19", r"\besop\b|\besos\b|\besps\b|employee stock option|allotment.*(esop|employee)", "unclassified", "esop"),
  ("R20", r"qualified institutions? placement|\bqip\b|rights issue|preferential (issue|allotment)|issue of (equity|warrants)", "fund_raise", "equity_raise"),
  ("R21", r"non-?convertible debenture|\bncds?\b|commercial paper|\bbonds?\b", "fund_raise", "debt_raise"),
  ("R22", r"fund ?rais|raising of funds|issue of securities", "fund_raise", "fund_raise_other"),
  ("R23", r"amalgamation|merger|demerger|scheme of arrangement", "M&A", "restructuring"),
  ("R24", r"joint venture|\bjv\b", "M&A", "jv"),
  ("R25", r"divest|stake sale|sale of (stake|shares|investment)|slump sale", "M&A", "divestment"),
  ("R26", r"incorporation of .*subsidiar|investment in .*subsidiar", "M&A", "subsidiary"),
  ("R27", r"acqui(re|sition)", "M&A", "acquisition"),
  ("R28", r"change in (director|management|kmp|key managerial|senior management)|appointment of|resignation of|cessation|retire|superannuat|re-?designat|managing director|chief executive|\bceo\b|chief financial|\bcfo\b|whole[- ]?time director|company secretary|compliance officer|independent director", "management_change", "resolve:people"),
  ("R29", r"analyst|institutional investor|investor meet|investor conference|one-on-one|group meeting", "investor_meetings", "meeting"),
  ("R30", r"special dividend", "dividend", "special_dividend"),
  ("R31", r"dividend", "dividend", "dividend"),
  ("R32", r"bonus|sub-?division|stock split|split of", "bonus_split", "bonus_split"),
  ("R33", r"capital expenditure|\bcapex\b|capacity (addition|expansion)|new (plant|facility)|greenfield|brownfield", "capex", "capex"),
  ("R34", r"commencement of commercial (production|operations)|commissioning", "capex", "commissioning"),
  ("R35", r"postal ballot", "postal_ballot", "postal_ballot"),
  ("R36", r"annual general meeting|\bagm\b|extra-?ordinary general meeting|\begm\b|book closure|e-?voting", "agm_egm", "agm_egm"),
  ("R37", r"bagging|receiving of (orders|contracts)|award of (order|contract)|receipt of order|order (win|received|inflow)|wins? .*(order|contract)|letter of (award|intent)", "press_release", "order_win"),
  ("R38", r"clarification|rumou?r|news item|spurt in (volume|price)|price movement", "press_release", "clarification"),
  ("R39", r"trading window|share certificate|74\s?\(5\)|39\s?\(3\)|compliance certificate|certificate under|\bbrsr\b|business responsibility|\besg\b|investor complaints|registrar|registered office|shareholding pattern|reconciliation of share capital|corporate governance report", "unclassified", "compliance"),
  ("R40", r"press release|media release|launch|partnership|agreement|\bmou\b|memorandum of understanding|collaborat", "press_release", "general"),
  ("R41", r"outcome of (the )?board meeting", "resolve:board_outcome", None),
]
# No match -> status 'needs_llm' -> classify_batch (Appendix A).
# When the first match is results and a later rule matches management_change,
# fund_raise, M&A or capex, store those categories in announcements.also; their
# extractors also run and each creates its own event (for example a results
# outcome that also approves an NCD issue).
```

**Resolvers** are small functions that settle a subtype from the same text:

| Resolver | Rule |
| --- | --- |
| `pledge_direction` | "revok", "release" or "invocation" gives `pledge_release` (invocation also adds a red flag); otherwise `pledge_create` |
| `rating_direction` | "downgrad" gives `downgrade`; "upgrad" `upgrade`; "outlook" `outlook_change`; "reaffirm" or "affirm" `reaffirm`; otherwise `rating_action` |
| `people` | Subtype comes from the people extractor's `role_class` (`top`, `kmp`, `independent`, `other`) |
| `newspaper` | Text mentions "result": `results` / `results_admin`; otherwise `unclassified` / `compliance` |
| `board_notice` | Text mentions "result": `results` / `results_notice`, which also feeds the Upcoming strip; otherwise `unclassified` / `board_notice` |
| `board_outcome` | Text mentions "result": `results` / `financial_results`; otherwise send to the model, because outcomes bundle capex, dividends and fund raises |
| `insider` | "promoter" and an acquisition word gives `promoter_buy`; "promoter" and a disposal word gives `promoter_sell`; otherwise `other_insider` |

### B.2 Base scores

| Category | Subtype | Base |
| --- | --- | --- |
| results | financial\_results | 90 |
| results | results\_notice, results\_admin | 20 |
| management\_change | auditor\_exit | 95 |
| management\_change | top | 85 |
| management\_change | independent | 45 |
| management\_change | kmp | 30 |
| management\_change | other | 25 |
| M&A | acquisition, restructuring | 80 |
| M&A | divestment | 70 |
| M&A | jv | 60 |
| M&A | subsidiary | 30 |
| fund\_raise | equity\_raise | 75 |
| fund\_raise | buyback | 70 |
| fund\_raise | fund\_raise\_other | 55 |
| fund\_raise | debt\_raise | 40 |
| litigation | insolvency | 90 |
| litigation | regulatory\_action | 65 |
| litigation | dispute | 40 |
| credit\_rating | downgrade | 75 |
| credit\_rating | upgrade | 55 |
| credit\_rating | outlook\_change | 45 |
| credit\_rating | rating\_action | 30 |
| credit\_rating | reaffirm | 15 |
| pledging | pledge\_create | 70 |
| pledging | pledge\_release | 35 |
| insider\_trading | promoter\_sell | 60 |
| insider\_trading | promoter\_buy | 55 |
| insider\_trading | other\_insider | 20 |
| earnings\_call | guidance\_change | 75 |
| earnings\_call | transcript | 30 |
| earnings\_call | presentation | 20 |
| earnings\_call | call\_notice, recording | 10 |
| capex | capex | 60 |
| capex | commissioning | 50 |
| press\_release | clarification | 60 |
| press\_release | order\_win | 50 |
| press\_release | general | 30 |
| bonus\_split | bonus\_split | 55 |
| dividend | special\_dividend | 50 |
| dividend | dividend | 35 |
| postal\_ballot | postal\_ballot | 15 |
| agm\_egm | agm\_egm | 15 |
| investor\_meetings | meeting | 5 |
| unclassified | any | 5 |

A failed shareholder vote, found by the one-liner pass, raises a postal ballot or AGM item to 60.

### B.3 Grouping the results family

Once a symbol has a `financial_results` filing, any of these filed within 36 hours either side join its event, `event_key = {symbol}:results:{period_end}`: other `results` subtypes, `earnings_call` presentations and call notices, and `press_release` items that mention "result". The `financial_results` filing is the primary. The rest are listed in the event sheet and never ranked separately.

## Appendix C. Accounts, keys and environment variables

Everything runs on free tiers: eight accounts, about 30 minutes to set up. Commit a `.env.example` with these names and no values.

| Service | Plan | Used for | Notes |
| --- | --- | --- | --- |
| GitHub | Free, public repo | Code, CI, fallback runner | Scheduled workflows in public repos stop after 60 days without repo activity |
| Vercel | Hobby | Web app | Set the functions region to `bom1` (Mumbai) |
| Supabase | Free | Postgres | South Asia (Mumbai); 500 MB; pauses after a week idle, which the tick prevents |
| Render | Free web service | Worker | Singapore; 512 MB RAM; only one free service per workspace |
| Google AI Studio | Free tier | Gemini | Check per-model limits on the project's rate-limit page |
| Groq | Free | T1 fallback | 8,000 tokens a minute |
| cron-job.org | Free | The 10-minute tick | 30-second timeout, so the endpoint returns 202 at once |
| Tavily (optional) | Free, 1,000 credits a month | Person-background fallback | No card needed |

**Worker environment (Render, and `worker/.env` locally)**

```bash
DATABASE_URL=postgresql://...      # Supabase Session pooler URI, sslmode=require
WORKER_KEY=...                     # 32 random characters, shared with the web app
GEMINI_API_KEY=...
GROQ_API_KEY=...
TAVILY_API_KEY=...                 # optional
MODEL_T1=gemini-3.5-flash-lite
MODEL_T1_FALLBACK=gemini-3.1-flash-lite
MODEL_T2=gemini-3.6-flash
MODEL_T2_FALLBACK=gemini-3.8-flash,gemini-2.5-flash
MODEL_T3=gemini-3.8-flash
MODEL_T3_FALLBACK=gemini-2.5-pro
MODEL_GROUNDED=gemini-2.5-flash
GROQ_MODEL_T1=openai/gpt-oss-20b
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
NSE_ENABLED=false
TZ=Asia/Kolkata
LOG_LEVEL=INFO
```

**Web environment (Vercel, and `web/.env.local` locally)**

```bash
DATABASE_URL=postgresql://...      # Supabase Transaction pooler URI (port 6543); postgres client with prepare: false
WORKER_URL=https://<your-worker>.onrender.com
WORKER_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
```

**cron-job.org job:** `POST https://<your-worker>.onrender.com/tasks/tick` with header `X-Finn-Key: <WORKER_KEY>`, every 10 minutes, 30-second timeout, email on failure.

**GitHub Actions fallback** (`.github/workflows/ingest-fallback.yml`): scheduled `45 11 * * 1-5` (17:15 IST) plus manual dispatch. It installs the worker and runs `ingest-announcements --since 2d`, `process`, `ingest-prices --period 5d`, `signals` and `alerts`, with `DATABASE_URL` and the API keys as repository secrets.

## Sources

Every page below was opened while writing this doc on 28 Oct 2026; the library sources were downloaded and read directly.

**Data sources and libraries**

- [BseIndiaApi](https://github.com/BennyThadikaran/BseIndiaApi) and the `bse` 3.3.4 package: announcements, result calendar, results snapshot, price history and scrip list endpoints, headers and sample responses.
- [NseIndiaApi](https://github.com/BennyThadikaran/NseIndiaApi) and the `nse` 5.1.0 package: announcements, results comparison (₹ lakh), financial-results filings, delivery bhavcopy, cookie handling and rate limits.
- `yfinance` 1.7.0 package metadata: `curl_cffi` dependency and the `YFRateLimitError` exception.
- `google-genai` 2.33.0 package: `response_schema`, `thinking_level` and tools in `GenerateContentConfig`.
- [Screener: Larsen & Toubro](https://www.screener.in/company/LT/consolidated/): page sections, row labels, document and concall links, L&T Q2 FY27 figures.
- [NSEPython on cloud servers (Unofficed forum)](https://forum.unofficed.com/t/update-nsepython-not-working-in-aws-google-cloud-and-webservers/670/23): reports of NSE failing from cloud hosts.
- [A KMP-change filing on NSE](https://nsearchives.nseindia.com/corporate/SANGINITA_25042026183613_20260425_Resignation_App_CFO_NSE.pdf): the Annexure 18 disclosure structure.
- [SEBI integrated filing (Business Standard)](https://www.business-standard.com/amp/markets/news/sebi-simplifies-disclosures-for-listed-companies-through-integrated-filing-125010100713_1.html): what the financial integrated filing contains.

**Models and free tiers**

- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing?authuser=3): which models are free, paid prices, grounding allowance.
- [Gemini free-tier guide (Memetik, Sept 2026)](https://www.memetik.ai/guides/gemini-api-free-tier-limits): limits shown per project; free-tier data use.
- [Groq free tier (Developers Digest, verified 18 Oct 2026)](https://www.developersdigest.tech/models/free-api/groq): free models and limits.
- [Groq pricing (eesel)](https://eesel.ai/blog/groq-pricing): paid prices and earlier limits.
- [Free web search APIs (Parallel)](https://parallel.ai/ai/articles/best-free-web-search-api): Tavily, Brave and others.
- [Proxycurl shutdown (StartupHub)](https://www.startuphub.ai/ai-news/startup-news/2025/the-1-linkedin-scraping-startup-proxycurl-shuts-down): why FINN never scrapes LinkedIn.

**Hosting and delivery**

- [Vercel Functions limits](https://vercel.com/docs/functions/limitations): Hobby 300-second maximum, 2 GB, Python bundle size.
- [Render free tier](https://render.com/docs/free) and [Render pricing 2026 (Temps)](https://temps.sh/blog/render-pricing-2026): spin-down, 750 hours, 512 MB, Postgres expiry.
- [Hugging Face Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview): Docker Spaces need a paid plan.
- [Supabase free tier (Automation Atlas)](https://automationatlas.io/answers/supabase-free-tier-limits-2026/): 500 MB and the one-week pause.
- [Free cron schedulers compared (MerginIT)](https://merginit.com/blog/26062026-free-cron-job-scheduler-comparison): cron-job.org's 30-second timeout; Vercel Cron's daily limit.
- [PWA push on iOS in 2026 (Webscraft)](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en): Home Screen requirement and reliability caveats.
- [Claude Code cheatsheet](https://support.claude.com/en/articles/14553413-claude-code-cheatsheet): `/export` and `/resume`.

**Portfolio events**

- [Results week 26–30 Oct (CNBC-TV18 via TradingView)](https://www.tradingview.com/news/cnbctv:ff0962a73094b:0/), [Q2 FY27 calendar (flashfinance)](https://flashfinance.news/results-calendar/), [27 Oct reporters (Multibagg)](https://www.multibagg.ai/market-pulse/articles/q2-fy27-results-october-27-cmvqhmcms001b2vqnk5k8y1ey).
- [Reliance results on 30 Oct (Upstox)](https://upstox.com/news/market-news/earnings/reliance-industries-sets-october-30-for-q2-fy-27-results-ncd-fundraise-on-board-agenda/article-202491/), [Airtel results calendar](https://www.airtel.in/about-bharti/equity/results/quarterly-calendar), [HDFC Bank MD & CEO (Business Today)](https://www.businesstoday.in/latest/corporate/story/hdfc-bank-appoints-anup-bagchi-as-md-ceo-for-three-year-term-from-october-27-559151-2026-10-01), [HAL Director (Operations) (Indian Masterminds)](https://indianmasterminds.com/news/hal-appoints-p-b-rangarao-director-operations-246395/).

**Similar tools**

- [Where to track guidance in Indian earnings calls (Multibagg)](https://www.multibagg.ai/feeds/management-guidance-earnings-calls-cmudzbqxv000404l5f2fyu9fg): no mainstream tool scores promise against delivery.
- [PromiseTrack AI](https://harisri-promisetrack-ai.hf.space/): a public prototype with a commitment tracker. Expect other entrants to build one too, so FINN's edge is the push-pull link, basis-aware matching and citations.
