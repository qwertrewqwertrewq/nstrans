# NSTrans Community

Cloudflare Worker + D1 community dictionary service for NSTrans.

## Production

- Site: `https://nstrans.221129.xyz`
- Worker fallback: `https://nstrans-community.ynqjzrjzrj.workers.dev`
- GitHub OAuth callback: `https://nstrans.221129.xyz/auth/github/callback`
- D1: `nstrans-community`

Before OAuth can be used, configure both Worker secrets:

```bash
npx wrangler secret put GITHUB_CLIENT_ID --config community/wrangler.jsonc
npx wrangler secret put GITHUB_CLIENT_SECRET --config community/wrangler.jsonc
```

Deploy schema and Worker:

```bash
npm run community:migrate
npm run community:deploy
```

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

Authenticated data management API:

```http
GET /api/v1/games
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
