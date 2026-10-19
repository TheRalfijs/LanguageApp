# [BRAND] — Latvian B1 practice (PWA)

Independent practice platform for the Latvian state language proficiency test (B1).
Vanilla JS + Vite (multi-page), Supabase, Netlify Functions.

> This README grows with each build step. Full setup (Supabase migrations, Stripe
> webhook, env vars, deploy) is completed in step 10.

## Local setup

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (node:test, no extra libraries)
npm run build    # production build into dist/
npm run preview  # serve dist/ at http://localhost:4173 (service worker active here only)
```

## Project layout (so far)

| Path | What |
|---|---|
| `index.html`, `404.html`, `pages/**.html` | Pages. Every `.html` file is a build entry. |
| `partials/` | `head`, `header`, `footer` — included with `<!-- @include name -->`. |
| `config/app.json` | Brand, domain, `ENABLED_LOCALES`, default locale. |
| `locales/*.json` | UI strings. `lv` is the source of truth; tests check other files have the same keys. |
| `shared/` | Pure JS used by browser, functions and tests. |
| `src/` | Browser code (`main.js`, `i18n.js`, components, styles). |
| `public/` | Copied as-is: `manifest.webmanifest`, `sw.js`, icons. |
| `netlify.toml` | Build, functions dir, security headers (CSP). |

## Languages

- Latvian text is written inline in the HTML (`data-i18n="key"`), so pages render without JS.
- **Static pages** (`<html data-static>`: landing, terms, privacy, exam guide) are
  **pre-rendered per language** at build time: `/`, `/en/`, `/uk/` (+ `hreflang`, canonical,
  `sitemap.xml`, `robots.txt`). In static pages, `data-i18n` elements must contain plain text
  only (the build fails otherwise). Long texts live in `content/<name>.<locale>.html` and are
  pulled in with `<!-- @content name -->`.
- **App pages** (login, diagnostic, account…) translate at runtime. Links from a static page
  carry `?lang=xx`, so the choice follows the user.
- The choice is stored in `localStorage` and in `profiles.locale` when logged in. A visitor
  with a stored choice who opens a static page in another language is redirected to their
  language (`public/locale-redirect.js`); search engines have no stored choice.
- **Turn a language on/off:** edit `ENABLED_LOCALES` in `config/app.json`. Disabled locales
  are not built at all (no `/ru/` pages, no `ru.json` in the bundle). `ru` is currently off.
  Turning a locale on also needs its `content/**/<name>.<locale>.html` files (a test checks).

## Placeholders to fill before launch

Search the repo for these tokens:

| Token | Where | What |
|---|---|---|
| `[BRAND]`, `[DOMAIN]` | `config/app.json`, `public/manifest.webmanifest` | Product name and domain |
| `[COMPANY]`, `[REG_NO]`, `[ADDRESS]`, `[EMAIL]`, `[VAT_STATUS]` | `content/legal/*` | Legal entity details |
| `[LAUNCH_DATE]`, `[DATE]` | locales, `content/legal/*` | Planned launch, "last updated" |
| `[CHECK VIAA]`, `[VIAA_URL]` | `content/legal/exam-guide.*` | Exam facts to verify on the VIAA site |
| `[CHECK]`, `[CHECK: …]` | `content/legal/*` | Legal/processor facts to verify |
| `[DRAFT]` | top of each legal page | Remove the whole notice after legal review |

## Branding placeholders

`[BRAND]` / `[DOMAIN]` live in `config/app.json` and are filled into all HTML at build time.
`public/manifest.webmanifest` is a static file — update its `name`/`short_name` by hand.
Icons in `public/icons/` are placeholders (keep the file names when replacing).

## Exam configs (`config/exams/<code>.json`)

Everything about an exam's format lives here; no exam rules are hard-coded. Adding
`lv-a1`, `lv-b2` or `et-b1` means adding a file with the same shape.

| Key | Meaning |
|---|---|
| `passRule.minRatio` | Each skill must reach this share of its own max (0.6 = 60%). |
| `passRule.estimate` | Thresholds for diagnostic labels: ≥ `likelyPassFrom` → likely pass, < `likelyFailBelow` → likely fail, else borderline. |
| `skills[]` | Skill ids + duration. |
| `taskTypes[]` | Per task type: skill, `answerType`, `items`, `pointsPerItem` (objective) or `rubric` (writing/speaking), `wordLimits`, `contentPoints`, optional `maxPoints` to rescale a rubric total. Skill maxima are derived from these. |
| `rubrics.<id>.criteria[]` | `id`, `max`, `descriptor`, `bands[]` (`band`, `min`, `max`, `descriptor`) — bands must cover 0..max with no gaps. |
| `diagnostic.sections[]` | Which task types/how many items the free diagnostic uses. |

`"_placeholder": true` marks values not yet checked against the VIAA programme. In
`npm run dev` a yellow banner (and console warnings) appear while any placeholder remains.
`npm test` validates every exam config.

## Scoring, access and calibration (`shared/`)

- `scoring.js` — per-skill 60% rule (`examResult`), display percent (always rounded **down**),
  estimate status, rubric totals and band mapping.
- `access.js` — `access_until` maths: passes stack; founding pass access starts at
  `launch.fullProductLaunchDate` in `config/app.json` (null = not launched yet).
- `calibration.js` — AI vs teacher agreement; gate opens at `calibration.minScripts` scripts
  with ≥ `calibration.minAgreement` within `maxBandDiff` band on every criterion.

## Supabase setup

1. **Create a project** at supabase.com — region **EU (Frankfurt)**.
2. **Run the migrations** in `supabase/migrations/` in file-name order, either:
   - SQL editor: paste each file and run it, **or**
   - CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. **Local env** — copy `.env.example` to `.env` and fill in from *Project Settings → API*:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public), `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (secret — server only, never commit, never prefix with `VITE_`).
4. **Auth → URL configuration**
   - Site URL: `https://[DOMAIN]`
   - Redirect URLs: `http://localhost:5173/**`, `http://localhost:8888/**`, `https://[DOMAIN]/**`,
     and your Netlify preview pattern, e.g. `https://*--<site>.netlify.app/**`.
5. **Auth → Email templates** — edit **Magic Link** *and* **Confirm signup** so the email has
   both the link and the code (users on phones often open mail in another app):

   Subject: `Pieteikšanās kods / Login code / Код для входу`
   ```html
   <h2>{{ .Token }}</h2>
   <p>Tavs pieteikšanās kods. <a href="{{ .ConfirmationURL }}">Ieiet ar saiti</a>.</p>
   <p>Your login code. <a href="{{ .ConfirmationURL }}">Log in with the link</a>.</p>
   <p>Ваш код для входу. <a href="{{ .ConfirmationURL }}">Увійти за посиланням</a>.</p>
   <p style="color:#666">Ja tu to nepieprasīji, ignorē šo e-pastu. / If you didn't ask for this, ignore this email. / Якщо ви цього не запитували, проігноруйте цей лист.</p>
   ```
6. **Make yourself admin** (after logging in once), in the SQL editor:
   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
   `is_admin` can only be changed this way — the API does not let users write that column.

> The built-in Supabase mailer is heavily rate limited (a few emails per hour) — fine for
> testing. Step 7 switches Auth email to Resend SMTP.

### Security model

- RLS is enabled on **every** table; the API grants are revoked and re-granted explicitly.
- The browser can only **read its own** rows, and update its own `locale` / `target_level` /
  `exam_date`. Everything else (attempts, responses, purchases, grading) is written by Netlify
  Functions with the service role key.
- Items are never readable from the browser directly; functions serve them without
  `answer_key_json`. Responses are only visible once `released_at` is set.
- Deleting an auth user deletes profile, attempts and responses; purchases are kept with
  `user_id = null` (accounting records).

### Testing migrations + RLS locally

`npm run test:db` creates a throwaway database on a **local** Postgres (15+), applies small
stand-ins for Supabase's `auth`/`storage` schemas (`supabase/tests/00_local_stubs.sql`), runs
all migrations and then `supabase/tests/rls_test.sql`. Set `PGHOST`/`PGPORT`/`PGUSER` as needed.
It never touches your Supabase project.

## Server (Netlify Functions)

All API keys live only in Netlify env vars (see `.env.example`). Functions use the modern
Netlify API (`export default async (req) => Response`, `export const config = { path }`) and are
served under `/api/…`. Run them locally with `npx netlify dev` (http://localhost:8888) — it reads
`.env` and serves Vite + functions together.

`netlify/functions/_lib/`:

| Module | What |
|---|---|
| `http.js` | `handler()` wrapper (errors → JSON; never leaks internals), `json()`, `readJson()` |
| `auth.js` | `getCaller()` (Supabase JWT or hashed `X-Anon-Token`), `requireUser`, `requireAdmin`, `ownerOf` |
| `rate-limit.js` | Daily limits from `config/app.json → rateLimits`; anonymous visitors are limited per token **and** per hashed IP |
| `ai-usage.js` | Cost estimate (`config/ai-pricing.json`) + `logUsage()` into `ai_usage` for every paid call |
| `llm.js` | Structured JSON calls: `output_config.format` + Ajv validation + semantic check, one retry with the errors, refusal handling, server-side fallback |
| `stt/` | Speech-to-text adapter (`transcribe()` interface); `elevenlabs.js` = Scribe. Switch with `STT_PROVIDER` |
| `tts/` | Azure neural TTS + permanent cache in the `tts-cache` bucket (content-hash file names) |

**Note on "temperature 0":** Claude models newer than Opus 4.6 reject any temperature other
than 1 (HTTP 400), so `llm.js` only sends `temperature: 0` to older models. Consistency comes
from the fixed rubric in the prompt, forced JSON output with schema validation, a fixed
`LLM_EFFORT`, and storing the full output + prompt version for calibration.

**TTS is generated once:** `ensureTtsAudio()` is called when items are created/approved (admin)
or by a script — never on a user request. Users only get the stored public URL.

`GET /api/health` shows which services are configured (booleans only).

### Trying the AI providers with real keys

```bash
node --env-file=.env scripts/smoke-ai.js          # llm + tts + stt (a few cents)
node --env-file=.env scripts/smoke-ai.js llm      # just one
```
