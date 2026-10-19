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
