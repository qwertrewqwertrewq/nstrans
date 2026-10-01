# NSTrans Community

Cloudflare Worker + D1 community dictionary service for NSTrans.

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
