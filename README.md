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
  Other languages are applied at runtime. The choice is stored in `localStorage` (and in
  `profiles.locale` once the user is logged in — step 3). `?lang=en` forces a language.
- **Turn a language on/off:** edit `ENABLED_LOCALES` in `config/app.json`. Disabled locales
  are not included in the build at all. `ru` is currently off.

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
