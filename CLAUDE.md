# CFA Study Hub: notes for Claude

Marcus's personal study app for the CFA Level I exam (May 11–17, 2027). Read this before changing anything.

## Stack and deploy
- Single file app: `index.html` (HTML + CSS + vanilla JS, no build step, no framework).
- `config.js` holds the Supabase project URL and publishable key (safe to commit; never add a service_role/secret key).
- Hosting: Vercel, auto-deploys on every push to `main` (repo `mwbooth98/cfa-hub`). No preview workflow; test before pushing.
- Data + auth: Supabase project `ubuhfsfbmqzlbimwpurk`. One table `public.docs (user_id, coll, id, data jsonb)` with row-level security (own rows only). Sign-ups are disabled; Marcus is the only user. Schema lives in `setup.sql`.
- Supabase JS client is loaded from jsDelivr, pinned to an exact version.

## Data model (collections in `docs.coll`)
- `modules/<topicKey>` → `{items:[{id,name,est,done,doneOn,rating,ratedOn,hist[]}]}`. `est` = CFA Institute planner minutes.
- `sessions/<id>` → `{date,ts,tpl,topic,module,moduleId,minutes,quizzes[],focus,note,...}`. `tpl` ∈ module, deep (new material) | review, mixed, mock (review).
- `scores/<id>` → `{type: test|quiz|checkpoint|mock|revisit, topic, date, c, n, pct, rev}`.
- `notes/<topicKey>` → `{formulas, notes, mods:{<moduleId>:{formulas, notes}}}`: one collapsible section per module (subtopics are CFA modules); the top-level fields are the General section. Capture appends formulas to the session's module.
- `mistakes` and `cards` carry an optional `moduleId`; Anki export tags are `cfa::<topic>::<moduleId>_<slug>`.
- `cards`, `mistakes`, `checkins/<date>` (Anki done), `settings/plan` ({order, weeks}), `settings/curriculum` ({v}).
- Topic keys: ethics, quant, econ, corp, fsa, equity, fi, deriv, alts, pm. Never rename keys or module ids; data is keyed on them.
- Curriculum changes go through `CURRICULUM` + `migrateCurriculum()` (bump `CURRICULUM_V`), which preserves done/rating by module id.

## Study method the app encodes (keep consistent)
- Sessions: preview LOS → learn → blurt from memory (check against Key Concepts) → quiz → capture. Familiarity changes the order (high = quiz cold first).
- Anki (external) for spaced-repetition cards; the hub only queues cards for import and logs a daily check-in.
- Module ratings 1–4: Can't do it / Shaky / Solid with effort / Could teach it.
- Topic revisits: adaptive gaps (initial 4/7/10/14 days by weakest rating; after a revisit: <55% → 4 days, 55–64% → same gap, 65–74% → ×2.5, 75%+ → ×3.5). Score overrides rating. Max 2 revisits a week (Sunday review), 1 in catch-up mode (≥3 modules behind). Nothing scheduled into the review phase.
- Review budget ~20% of weekly hours during learning; pace = actual minutes ÷ CFA estimate, assumed 70% until 3 modules are timed.
- Plan: learning Nov 2, 2026 – Mar 21, 2027, review to Apr 11, mocks Apr 17 / Apr 24 / May 1. Topic order follows Schweser (Ethics last); weeks are editable in the Plan tab.

## Conventions
- Colours only via the CSS tokens at the top of the style block; light and dark themes both defined.
- Must work at 400px wide and on public computers (non-trusted sign-in uses sessionStorage + 1 h idle sign-out).
- Plain, direct UI copy; no emoji as decoration.

## Saving
- All writes go through `put`/`del`, which queue the change in an outbox (localStorage when trusted, else sessionStorage), show it on screen at once and retry until Supabase confirms. `loadAll` re-applies queued changes over server data. Never write to Supabase directly.
- Session quiz steps carry their own topic (`mixed` allowed); mixed scores never count toward a topic average. Only module/deep sessions carry a `moduleId`. Sessions saved from now on have `v:2`.

## Testing before a push
- `node --check` on the extracted `<script>` block.
- `node tests/smoke.js`: renders every view at 1280px and 400px (fails on page errors or sideways scroll) and runs behaviour checks (offline save, score validation, mistakes, sign-in expiry, idle sign-out, notes, backup) against the stub in `tests/stub-supabase.js`. Add a check when you change behaviour.
