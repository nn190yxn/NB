# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions and customization.

## Entries

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while building and previewing the content IP workbench
- Category: Build Methods
- Instructions:
  - Install dependencies with `npm install` and build the frontend with `npm run build`.
  - Serve the production output with `python3 -m http.server 8000 --directory dist` for static preview.
- The frontend entry must mount React with `createRoot(document.getElementById('root')!).render(<App />)`.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while connecting the first content strategy API
- Category: Operations & Deployment
- Instructions:
  - Start the local API with `npm run server`; it listens on port `3001`.
  - Vite forwards `/api` requests to `http://localhost:3001` during development.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while adding Phase 8 validation coverage
- Category: Testing Methods
- Instructions:
  - Run `npm test` to execute the Node.js API validation tests.
  - Run `npm run typecheck` before the production build to verify TypeScript changes.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while validating session-based API requests
- Category: Environment Configuration
- Instructions:
  - The API allows the configured frontend origin through `APP_ORIGIN`; the local default is `http://localhost:5173`.
  - Cookie-authenticated browser requests require `credentials: 'include'` and the API's explicit CORS origin.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while integrating the RedFox research adapter
- Category: Environment Configuration
- Instructions:
  - Configure the project server-side RedFox endpoint with `REDFOX_API_URL`.
  - Configure the project server-side RedFox credential with `PROJECT_REDFOX_API_KEY`; never expose it through frontend code.
  - Without `REDFOX_API_URL`, research refresh uses the deterministic MVP sample for local development.

[User Instruction Summary]
- Date: 2026-08-29
- Context: Server deployment and database setup
- Category: Operations & Deployment
- Instructions:
  - Production host is `woyai.cn` with public IP `124.223.3.175`.
  - SSH uses port `22` and key-based authentication.
  - Nginx owns public ports `80` and `443`.
  - The server contains multiple projects; this project's database and configuration must remain isolated from other projects.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while performing the server preflight check
- Category: Operations & Deployment
- Instructions:
  - The production server runs Ubuntu 24.04.4 LTS and MySQL 8.0 on `127.0.0.1:3306`.
  - Existing server projects include `/home/ubuntu/woying-ai`, `/home/ubuntu/niuniu-parenting`, and `/opt/founder-workspace`.
  - The `ubuntu` SSH account does not have passwordless MySQL access; database creation requires an administrator to grant access or run the isolated provisioning commands.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while verifying the provisioned production database
- Category: Environment Configuration
- Instructions:
  - This project's production database is `content_ip_workbench` (utf8mb4 / utf8mb4_unicode_ci) on the server's local MySQL at `127.0.0.1:3306`.
  - The database user is `content_ip_app`, restricted to `content_ip_app@127.0.0.1` with `ALL PRIVILEGES` on `content_ip_workbench.*` only.
  - The user can only see its own database plus `information_schema`/`performance_schema`; other server projects remain isolated.
  - The database password is provided by the user at deploy time (temp file under `.monkeycode-tmp-files/`); never commit it or write it into code or docs.
  - `.monkeycode-tmp-files/` and `server/.env` are gitignored to keep credentials out of the repository.
  - The app selects MySQL `app_state` storage when all `PROJECT_DB_*` variables are configured and falls back to JSON when they are absent.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while deploying the isolated application service
- Category: Operations & Deployment
- Instructions:
  - The isolated production service runs under PM2 as `content-ip-workbench` from `/home/ubuntu/content-ip-workbench` on port `3003`.
  - The service reports `storage: mysql` at `/healthz` and requires a valid production session for business APIs.
  - Nginx was intentionally left unchanged during the isolated deployment; public routing must be configured only after the desired hostname/path is confirmed.
  - Production database credentials are loaded from `/home/ubuntu/content-ip-workbench/.env.production` with mode `600`; PM2 starts Node with `--env-file`.
  - Database backups are created by `npm run db:backup` under `/home/ubuntu/content-ip-workbench/backups`; failed attempts are retained separately under `backup-failed`.
  - API production responses include `x-request-id`; structured request logs and configurable rate limiting use `API_RATE_LIMIT_WINDOW_MS` and `API_RATE_LIMIT_MAX`.

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while configuring the public domain entry
- Category: Operations & Deployment
- Instructions:
  - Public entry is live at `https://content.woyai.cn`; HTTP redirects to HTTPS with a Let's Encrypt cert (auto-renew via certbot, expires 2026-11-27).
  - DNS warning: the `content.woyai.cn` subdomain lives as a separate zone in DNSPod (not a record in the `woyai.cn` zone); its A record must use host `@`. Adding host `content` inside it creates `content.content.woyai.cn`.
  - Nginx site config: `/etc/nginx/sites-available/content.woyai.cn` serves `dist/` static files and proxies `/api/` plus `/healthz` to `127.0.0.1:3003`.
  - `APP_ORIGIN=https://content.woyai.cn` in `.env.production` matches the public origin, so same-origin browser requests pass the CORS check.
  - Main site `woyai.cn`, `woying-backend`, and `niuniu-backend` were verified unaffected after the Nginx reload.

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while deploying frontend builds to production
- Category: Operations & Deployment
- Instructions:
  - Frontend deploy flow (no rsync on server): `tar -C /workspace/dist -czf /tmp/opencode/deploy/dist.tar.gz .`, then `scp` to `ubuntu@124.223.3.175:/tmp/dist.tar.gz`, then SSH and atomically swap: `rm -rf dist.new && mkdir dist.new && tar -xzf /tmp/dist.tar.gz -C dist.new && rm -rf dist.old && mv dist dist.old && mv dist.new dist && rm -rf dist.old` under `/home/ubuntu/content-ip-workbench`.
  - SSH key for the server is stored locally at `D:\ChromeDownload\私钥\WOYING.pem`; add `-o StrictHostKeyChecking=no` on first contact. Record only the location, never the private-key content.
  - Font variables `--font-body/--font-heading/--font-mono` are defined on `.app` (defaults) with overrides in `.font-sans/.font-hand` classes; a `.font-{key}` class is set on the `<main className="app">` element and persists via `localStorage['dingweipai:font']`.
  - LXGW WenKai is loaded from `https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css` (not available on Google Fonts).
  - Build command is `npm run typecheck && npm run build` (outputs legacy + modern bundles under `dist/`); verify the new `index-*.js` appears on the live site after deploy.

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while implementing the MySQL split-table migration
- Category: Environment Configuration
- Instructions:
  - Collections (materials/research/structures/topics/drafts/shooting/sync_jobs/profile_reviews/conflicts) now live in `ip_collections` rows keyed by `(collection, item_id)`; per-user docs (positioning/strategy/profile/positioning_candidates) live in `ip_user_docs` keyed by `(user_id, doc_key)`. The legacy `app_state` single-row JSON table is kept only as a migration seed/rollback source.
  - `saveState(...collections)` in `server/index.mjs` accepts collection names: with args it syncs only those collections (row-level UPSERT + prune of missing ids); with no args it syncs everything. Call sites pass the collections they mutate.
  - Startup load order: read legacy `app_state` (seed fallback) -> load `ip_collections` + `ip_user_docs`; if split tables are empty, they are seeded from legacy state automatically.
  - `npm run db:migrate` (server/migrate.mjs) migrates legacy `app_state` JSON into split tables idempotently; it exits 1 on row-count mismatch and never deletes the legacy row.
  - Production session bootstrap: `NODE_ENV=production` rejects the `x-user-id` header and `POST /api/auth/session` returns 503, so business write APIs are unreachable until real auth lands; storage-layer writes can be verified by running a Node script on the server with `.env.production` loaded.

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while implementing production access-password authentication
- Category: Operations & Deployment
- Instructions:
  - Production auth is a single access password: `PRODUCT_ACCESS_PASSWORD` in `.env.production`; `POST /api/auth/session` with `{ "password": "..." }` returns a 30-day `content_ip_session` cookie (Secure, HttpOnly). Change the password by editing `.env.production` and `pm2 restart content-ip-workbench --update-env`.
  - The frontend shows a PasswordGate when session checks fail; logged-out users land on the password screen instead of the workspace.
  - CRITICAL deploy trap: long SSH command chains joined with `&&` abort silently after a failing step (e.g. `rm -rf dist.old` permission errors) and skip later steps like `cp server/index.mjs` - the server then runs stale code while everything looks deployed. Always verify a code signature on the server after deploy (e.g. `grep -c timingSafeEqual server/index.mjs`) and never chain the final verification into the same `&&` chain.
  - PM2 env precedence: variables exported in the starting shell are inherited by `pm2 start`; `--env-file` values never override already-present environment variables. After restarts, confirm the process actually picked up new env-file keys.
  - Daily MySQL backup cron (3:10 AM, 30-day retention) is installed in the ubuntu crontab alongside pre-existing niuniu jobs - append only, never rewrite the crontab.

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while shipping theme/font/global-search iterations
- Category: Operations & Deployment
- Instructions:
  - Live bundle tracking: production bundle name changes every frontend deploy (current: `index-CoVUcrNV.js`); always verify via `curl -s https://content.woyai.cn/ | grep -oP "index-[A-Za-z0-9_-]+\.js"`.
  - Frontend-only deploys need no `pm2 restart` (static files served by Nginx from `dist/`); server-side changes require restart.
  - Theme system: four themes (`warm` default, `editorial`, `fresh`, `midnight`) defined as `.theme-{key}` variable blocks in `src/styles.css`; user selection persists in `localStorage['dingweipai:theme']` and is validated against the full theme list in `main.tsx`.
  - Global font sizing was bumped one step (9->10.5, 10->11.5, 11->12.5, 12->13.5, 13->14.5, 14->15, 15->16px) across `src/styles.css` after user feedback; new UI should follow the 11.5/12.5/13.5px ladder for secondary/primary text.
  - Topbar GlobalSearch (`main.tsx`) indexes research/drafts/materials/structures via their GET APIs (research/materials/drafts return arrays, structures returns `{items}` under `?page=1`); index is built once per session on first search and filtered locally.
  - Sub-page layout audit (2026-08-30): `.workspace-view` is now a transparent page container (no card shell); dashboard page-heading is hidden in workspace-mode (`.workspace-mode > *:not(.workspace-view)`); asset rows are standalone cards with hover lift (result-item style); filter rows use `.filter-label` group labels; empty states use centered dashed `.structure-empty` blocks.
  - Material atomization shipped (2026-08-30, spec `.monkeycode/specs/material-atomization/`): materials carry `material_kind` (article/quote/hotspot/insight/experience, legacy rows read as article); `POST /api/materials/atoms` creates atoms (dedup by origin_source_id+origin_text, marks `extracted_fields.collected` on source, DELETE restores); `GET /api/materials` supports `kind` + `kind_counts=1`; `POST /api/drafts/generate` accepts `quote_ids`/`experience_ids` and composes them into draft bodies with source_refs; frontend has kind filter chips, "收为素材" buttons, atom mini-form, and a ComposePanel on the 内容创作 page.
  - AI memory layer shipped (2026-08-30, spec `.monkeycode/specs/ai-memory-layer/`): new `memories` collection (added to `collectionNames` in `mysql.mjs` AND the `state` init in `index.mjs` - both places, missing the latter causes `owned()` TypeError); CRUD at `/api/memories` (+`?type=`), dedup on active same-type content; `/api/memories/extract` is a stub returning 422 `llm_not_configured` until LLM keys land; drafts/generate injects active style+feedback memories as a "创作风格要求" section, topics/generate carries `memory_count`. Manageable in Settings > AI 记忆 panel. Upgrade path reserved via `provider` field for TencentDB Agent Memory / Mem0.
  - Deploy trap repeat: server-side changes require scp of `server/*.mjs` files + `pm2 restart` (dist-only deploy leaves stale server code; caught by verifying a new route signature after deploy).
