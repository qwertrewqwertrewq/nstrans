# NSTrans Community

Vue 3 + Element Plus + Vue Router frontend, with Cloudflare Worker + D1 community dictionary service for NSTrans.

Community model relay setup, quota semantics, server-side routing and API details:
[MODEL_RELAY.md](./MODEL_RELAY.md). Apply all migrations through 0014 before the new Worker.

## Frontend development

The community frontend is independent from the React/Tauri OCR client.
Source lives in `community/web/src`; static logos and payment QR images live in
`community/web/public`. Vite builds into ignored `community/dist`, which is the
Worker's asset directory. Install its separate, locked dependency tree first:

```bash
npm ci --prefix community/web --ignore-scripts
npm run community:dev       # build frontend, run Worker on localhost:8787
# In another terminal, for frontend HMR and proxied /api /auth:
npm run community:web:dev   # localhost:4174
npm run community:build     # vue-tsc + production build
npm run community:deploy    # always rebuild before deploying Worker + assets
```

Public pages: `/`, `/how-it-works`, `/client`, `/download`, `/donate`, `/login`,
`/client-auth-complete`. Dashboard pages are separate lazy-loaded routes:
`/dashboard`, `/dashboard/keys`, `/dashboard/games`, `/dashboard/dictionary`,
`/dashboard/account`, `/dashboard/updates`, `/dashboard/relay` (the last two are admin only).
Legacy `/dashboard?view=keys` links redirect in the router, preserving other
query parameters, including the selected game. Worker serves `index.html` for
known page routes, so browser refresh/deep links work without swallowing API
or binary download routes. Vue renders user-provided text without HTML injection.
Element Plus needs inline positioning styles; CSP permits inline **styles**, not
inline scripts or eval. Authentication and permissions remain enforced by Worker.

After starting `community:dev`, run `node tools/testing/verify-community.mjs`
with Chrome installed (or `CHROME_PATH` set). It checks all public/dashboard
pages at desktop, tablet and phone widths; deep links, session/role guards,
search races, keys, game creation, edits/votes, download prompts and donation
tabs. It mocks only API responses in an isolated browser context and never
writes production data. Screenshots are saved under ignored `.build/community-qa`.
Worker page-routing regression tests are part of the root `npm test` suite.

Dashboard mutation operations preserve existing API scoring: web edits/adds +3,
key API edits/adds +1; identical content does not earn duplicate bonuses. Keys
are shown once in memory, never persisted in browser storage. Downloads use the
existing latest-release mirror routes; model sources, license notices, donation
images, support prompt and full API examples are retained.

## Production

- Site: `https://nstrans.221129.xyz`
- Worker fallback: `https://nstrans-community.ynqjzrjzrj.workers.dev`
- GitHub OAuth callback: `https://nstrans.221129.xyz/auth/github/callback`
- D1: `nstrans-community`
- R2 downloads: `nstrans-downloads`

Before OAuth can be used, configure both Worker secrets:

```bash
npx wrangler secret put GITHUB_CLIENT_ID --config community/wrangler.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --config community/wrangler.jsonc
```

## Official client account signing

Official GitHub Actions builds (macOS, Windows, Android and iPadOS; not the TV
subtitle client) embed an Ed25519 build certificate containing the app version,
platform, build variant, signing time and expiry time. Generate a signing pair
once with `node scripts/generate-client-signing-key.mjs`, then configure:

- GitHub Actions secret `CLIENT_BUILD_SIGNING_KEY` from `githubSecret`.
- Worker secret `CLIENT_BUILD_PUBLIC_KEYS` from `workerSecret`.
- Worker secret `CLIENT_ACCESS_SECRET` with a separate random value of at least
  32 bytes.

The private signing key must exist only in GitHub Actions. The Worker only gets
the public key. `CLIENT_BUILD_KEY_ID` in both build workflows selects the key;
`CLIENT_MIN_VERSION` in `wrangler.jsonc` controls the oldest accepted client.
Certificates record a 365-day validity window (configurable with the Actions env
`CLIENT_BUILD_ATTESTATION_DAYS`). The current gate verifies the Ed25519 signature
and minimum version; signing/expiry timestamps are retained for a later
rotation policy and are not yet used to reject an otherwise valid build.

After verification the official client can authenticate directly with a username and password, or start a ten-minute GitHub authorization flow in the browser. The resulting client key is returned to the application without exposing it on the web page.
Password setup and native registration share salted PBKDF2-SHA256 hashing.
New hashes use 100,000 iterations: the production Workers native operation
rejects higher counts, although Node.js and local Miniflare may accept them.
The salt and actual iteration count are stored alongside each hash and reused
for verification. Regression tests emulate this production-only limit. This
work factor is platform-constrained, not a claim of meeting stronger KDF
recommendations; do not increase it without validating the deployed runtime.
Users can register a username/password account, use the same permissions and
API-key system as GitHub users, and bind GitHub later. Existing GitHub users can
set a password and custom username in “账号与绑定”. This build certificate is a
distribution-origin check, not device-bound attestation; future versions can
replace it with Apple App Attest, Play Integrity, or platform signing checks.

Official clients use `/api/v1/auth/client/login` and `register` for native
username/password access. GitHub authorization uses the short-lived
`start`/`poll` device flow: the browser never exposes the API key, and the
client receives it exactly once after OAuth succeeds. A generated key is bound
to the local device ID; signing in again on that device revokes and replaces
only its previous key.

Deploy schema and Worker:

```bash
npm run community:migrate
npm run community:deploy
```

The Worker checks GitHub Releases every five minutes and mirrors only the nine
binary files linked by `/download` into R2. The manifest is switched only after
all current-release binaries are present; objects from older releases are then
deleted. Public downloads are served from
`https://nstrans.221129.xyz/download/file/{platform}` without redirecting users
to GitHub.

For an immediate manual sync after deployment, configure `RELEASE_SYNC_TOKEN`
as a Worker secret and call `POST /api/admin/releases/sync` with the same bearer
token.

## Client API

Anonymous dictionary download:

```http
GET /api/v1/dictionaries/{gameId}
```

Contribution upload (1–100 records):

```http
POST /api/v1/contributions
Authorization: Bearer nst_live_...
Content-Type: application/json

{"items":[{"gameId":"general","kind":"phrase","source":"設定","target":"设置","provenance":"translategemma"}]}
```

Each source retains at most three distinct translations. A fourth distinct
translation replaces a lowest-scored existing option; ties are randomized.
Public dictionary responses contain only the highest-scored translation.

Public game catalog:

```http
GET /api/v1/games
```

Authenticated data management API:

```http
POST /api/v1/games
POST /api/v1/dictionaries/batch
POST /api/v1/translations
POST /api/v1/translations/batch
PATCH /api/v1/translations/{translationId}
PATCH /api/v1/translations/batch
Authorization: Bearer nst_live_...
```

The batch dictionary request accepts `{"gameIds":["general","zelda-totk"]}`.
Single edits accept either or both of `source` and `target`; batch edits accept
1–100 items containing `translationId`. New entries require `gameId`, `kind`,
`source`, and `target`. `score` is the unified credibility score: upvotes add 1,
downvotes subtract 1, API additions/edits add 1, and dashboard additions/edits
add 3. The edit contribution is retained when later votes change.

Game creation requires only `chineseName`; `japaneseName` and an HTTPS
`posterUrl` are optional. Newly created games are immediately available and do
not enter a moderation queue. Administrators may edit or delete games from the
dashboard; deleting a game also deletes its dictionary through D1 foreign-key
cascades.
### Wiki mirror

`POST /api/v1/wiki-mirror` requires an active community API key in the
`Authorization: Bearer …` header. The client reads its existing login credential;
dictionary sharing is not required. Available as `wiki镜像` in primary, fallback
and manual terminology searches. Original Wiki evidence URLs are retained.

The JSON body contains `site` (`ja`, `zh`, or `wikidata`) and `params` (the
existing Wikimedia query parameters). Only title lookup, search, language links
and Wikidata entity search are supported. The Worker builds a fixed upstream URL,
limits result counts, rejects redirects and uses a 12-second upstream timeout.
Community credentials are validated before every request and never sent upstream.
