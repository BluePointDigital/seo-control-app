# Agency SEO Control (Agency SaaS Beta)

Agency SEO Control is an agency-first SEO operations platform.

Instead of modeling one local project, it now models:
- one `organization` per agency
- one `workspace` per client
- org-scoped auth, invites, sessions, and shared provider credentials
- workspace-scoped reporting, rankings, audits, competitors, jobs, and source assignments

## Stack
- React 19 + Vite frontend
- Node 24 + Express API
- SQLite via built-in `node:sqlite`
- Secure cookie sessions
- Bearer API tokens for agent access
- AES-256-GCM encrypted org credential vault

## Beta scope
- Email/password auth with invite acceptance and password reset
- Organization owners/admins, team members, and org-scoped permissions
- Workspace switching and route-based app shell
- Org-level Google connection status and credential vault
- Workspace-level GSC, GA4, Google Ads, and rank configuration
- Rankings, site audit, competitors, reports, ads snapshot, and job history
- Fresh SaaS bootstrap with automatic backup of legacy `projects` databases

## Install-ready quick start
This repo requires Node `24+`.

If you copy the project to another machine and use Node 20 or 22, `npm install` can appear to work while `npm run dev` fails later because this app uses the built-in `node:sqlite` module.

```bash
cd seo-control-app
npm install
npm run setup
npm run doctor
npm run dev
```

Frontend: `http://localhost:5173`
API: `http://localhost:8787`

## Docker hosting
The production container serves the built frontend and the Express API from the same origin.

1. Set `WEB_ORIGIN` and `APP_BASE_URL` to the public HTTPS URL that your reverse proxy will expose.
2. Set `SECURE_COOKIES=true`, `TRUST_PROXY=true`, and `PUBLIC_SIGNUP_ENABLED=false` for hosted deployments.
3. Mount `/app/data` so the SQLite database and generated reports survive container restarts.
4. Build and run with Docker:

```bash
docker compose up --build -d
```

The sample [docker-compose.yml](./docker-compose.yml) expects your reverse proxy and TLS to be handled separately.

## Install-ready export
- Run `npm run export:portable` to create a smaller transfer package in `release/agency-seo-control-portable`.
- That package keeps only the files needed to install and run the app on another machine.
- Run `npm run export:install-ready` to create a clean package in `release/agency-seo-control-install-ready`.
- That folder excludes local runtime artifacts like `.env`, `data`, `dist`, and `node_modules`.
- On the target Windows machine, open that folder and run `install-windows.cmd`.

## What the setup commands do
- `npm run setup`: creates `.env` from `.env.example` if it does not exist and generates fresh local secrets for `APP_MASTER_KEY` and `SESSION_SECRET`
- `npm run doctor`: checks that the machine is running a supported Node version and confirms whether `.env` exists
- `npm run dev`: starts the frontend and API together and now stops both processes if one of them fails

`npm run setup` will not overwrite an existing `.env`.

## Required environment
- `APP_MASTER_KEY`: encryption key for stored org credentials
- `SESSION_SECRET`: secret used to sign session cookies
- `NODE_ENV`: use `production` in hosted containers
- `DATA_DIR`: persistent runtime data directory, `/app/data` in Docker
- `WEB_ORIGIN`: frontend origin
- `APP_BASE_URL`: backend base URL used for OAuth callback generation
- `SECURE_COOKIES`: set `true` for HTTPS deployments
- `TRUST_PROXY`: set `true` when running behind Nginx, Caddy, or another reverse proxy
- `PUBLIC_SIGNUP_ENABLED`: set `false` for dedicated hosted copies after bootstrap

Optional Google env:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Optional SMTP placeholders:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## Core API surfaces
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/invite/:token`
- `POST /api/auth/accept-invite`
- `POST /api/auth/password/request-reset`
- `POST /api/auth/password/reset`
- `GET /api/org`
- `GET /api/org/members`
- `GET /api/org/invitations`
- `POST /api/org/invitations`
- `GET /api/org/credentials`
- `POST /api/org/credentials`
- `GET /api/org/api-tokens`
- `POST /api/org/api-tokens`
- `POST /api/org/api-tokens/:tokenId/revoke`
- `GET /api/org/google/status`
- `GET /api/org/google/connect/start`
- `GET /api/org/google/callback`
- `GET /api/workspaces`
- `POST /api/workspaces`
- `PATCH /api/workspaces/:workspaceId/settings`
- `POST /api/workspaces/:workspaceId/jobs/run-sync`
- `POST /api/workspaces/:workspaceId/audit/run`
- `POST /api/workspaces/:workspaceId/reports/generate`

## Validation
```bash
npm run lint
npm run test
npm run build
```

## Agent API access
- Human users continue to sign in with the app’s email/password flow and secure session cookies.
- External agents should use `Authorization: Bearer seo_pat_...` with tokens created in Organization Settings > API Access.
- v1 bearer tokens are scoped to selected workspaces and the `read`, `write`, and `run` permission buckets.

## Notes
- Legacy `data/app.db` files that still contain `projects` tables are backed up automatically on first SaaS boot.
- `node:sqlite` is currently experimental in Node 24, but it removed the native binary install fragility that was blocking earlier local beta work in this repo.
