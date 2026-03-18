# Agency SEO Control (Agency SaaS Beta)

Agency SEO Control is an agency-first SEO operations platform for teams that need a hosted app for humans and an authenticated API for agents.

Instead of modeling one local project, it models:
- one `organization` per agency
- one `workspace` per client
- org-scoped auth, invites, sessions, and shared provider credentials
- workspace-scoped reporting, rankings, audits, competitors, jobs, and source assignments

## What You Get
- Browser app for agency teams with email/password login
- Single-container Docker deployment behind your own reverse proxy
- SQLite persistence for organizations, workspaces, jobs, and reports
- Workspace-scoped bearer tokens for agents and automations
- Shared org credential vault for Google and provider integrations

## Stack
- React 19 + Vite frontend
- Node 24 + Express API
- SQLite via built-in `node:sqlite`
- Secure cookie sessions
- Bearer API tokens for agent access
- AES-256-GCM encrypted org credential vault

## Beta Scope
- Email/password auth with invite acceptance and password reset
- Organization owners/admins, team members, and org-scoped permissions
- Workspace switching and route-based app shell
- Org-level Google connection status and credential vault
- Workspace-level GSC, GA4, Google Ads, and rank configuration
- Rankings, site audit, competitors, reports, ads snapshot, and job history
- Fresh SaaS bootstrap with automatic backup of legacy `projects` databases

## Local Development
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

On first boot you can create the first owner account from the signup screen while there are zero users. For production, you can later disable public signup after bootstrap.

## Docker Hosting
The production container serves the built frontend and the Express API from the same origin.

### Quick Start
1. Set `WEB_ORIGIN` and `APP_BASE_URL` to the public HTTPS URL that your reverse proxy will expose.
2. Set `SECURE_COOKIES=true`, `TRUST_PROXY=true`, and `PUBLIC_SIGNUP_ENABLED=false` for hosted deployments.
3. Mount `/app/data` so the SQLite database and generated reports survive container restarts.
4. Build and run with Docker:

```bash
docker compose up --build -d
```

The sample [docker-compose.yml](./docker-compose.yml) expects your reverse proxy and TLS to be handled separately.

### Example Pull And Run
```bash
docker pull bluepointdigital/seo-control-app:latest

docker run -d \
  --name seo-control-app \
  -p 8787:8787 \
  -v seo-control-app-data:/app/data \
  -e NODE_ENV=production \
  -e PORT=8787 \
  -e DATA_DIR=/app/data \
  -e WEB_ORIGIN=https://seo.your-domain.com \
  -e APP_BASE_URL=https://seo.your-domain.com \
  -e SECURE_COOKIES=true \
  -e TRUST_PROXY=true \
  -e PUBLIC_SIGNUP_ENABLED=false \
  -e GOOGLE_REDIRECT_URI=https://seo.your-domain.com/api/org/google/callback \
  -e APP_MASTER_KEY=replace-with-a-long-random-secret \
  -e SESSION_SECRET=replace-with-a-long-random-secret \
  bluepointdigital/seo-control-app:latest
```

### Example Compose Configuration
Use the included [docker-compose.yml](./docker-compose.yml) as a starting point. Replace the placeholder env values before deploying.

## Environment Variables
Required:
- `APP_MASTER_KEY`: encryption key for stored org credentials. Keep it stable or saved credentials will become unreadable.
- `SESSION_SECRET`: secret used to sign session cookies. Keep it stable across restarts.
- `NODE_ENV`: use `production` in hosted containers.
- `PORT`: app listener port inside the container. Defaults to `8787`.
- `DATA_DIR`: persistent runtime data directory, `/app/data` in Docker.
- `WEB_ORIGIN`: browser origin for the frontend. In production this should be your public HTTPS URL.
- `APP_BASE_URL`: backend base URL used for callbacks and generated links. In single-origin hosting this should usually match `WEB_ORIGIN`.
- `SECURE_COOKIES`: set `true` for HTTPS deployments.
- `TRUST_PROXY`: set `true` when running behind Nginx, Caddy, Traefik, or another reverse proxy.
- `PUBLIC_SIGNUP_ENABLED`: set `false` for dedicated hosted copies after the first owner account is created.

Optional Google env:
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `GOOGLE_REDIRECT_URI`: must match your public callback URL, usually `https://your-domain/api/org/google/callback`

Optional SMTP placeholders:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Reference template:
- [`.env.example`](./.env.example)

## First Production Bootstrap
1. Start the app with `PUBLIC_SIGNUP_ENABLED=true`.
2. Visit the app and create the first owner account.
3. Confirm you can log in successfully.
4. Set `PUBLIC_SIGNUP_ENABLED=false`.
5. Restart the container.
6. Invite additional team members from the Team settings UI.

## Agent API Access
- Human users continue to sign in with the app's email/password flow and secure session cookies.
- External agents should use `Authorization: Bearer seo_pat_...` with tokens created in Organization Settings > API Access.
- v1 bearer tokens are scoped to selected workspaces and the `read`, `write`, and `run` permission buckets.
- Bearer tokens can access `GET /api/auth/me`, `GET /api/workspaces`, and workspace-scoped API routes only.
- Bearer tokens cannot be used for register/login/logout, invites, password resets, org membership management, org credential vault management, or Google connection management.

## Reverse Proxy Notes
- Terminate TLS at your reverse proxy and forward traffic to the container on port `8787`.
- Preserve the original host and forwarded proto headers.
- Run the app with `TRUST_PROXY=true` so secure cookies behave correctly behind the proxy.
- If you use Google OAuth, the public URL and callback URL must exactly match the values in your Google app configuration.

## Core API Surfaces
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

## Install-Ready Export
- Run `npm run export:portable` to create a smaller transfer package in `release/agency-seo-control-portable`.
- That package keeps only the files needed to install and run the app on another machine.
- Run `npm run export:install-ready` to create a clean package in `release/agency-seo-control-install-ready`.
- That folder excludes local runtime artifacts like `.env`, `data`, `dist`, and `node_modules`.
- On the target Windows machine, open that folder and run `install-windows.cmd`.

## Setup Helpers
- `npm run setup`: creates `.env` from `.env.example` if it does not exist and generates fresh local secrets for `APP_MASTER_KEY` and `SESSION_SECRET`
- `npm run doctor`: checks that the machine is running a supported Node version and confirms whether `.env` exists
- `npm run dev`: starts the frontend and API together and stops both processes if either one fails
- `npm run start`: runs the production Express server

`npm run setup` will not overwrite an existing `.env`.

## Validation
```bash
npm run lint
npm run test
npm run build
```

## Notes
- Legacy `data/app.db` files that still contain `projects` tables are backed up automatically on first SaaS boot.
- `node:sqlite` is currently experimental in Node 24, but it removed the native binary install fragility that was blocking earlier local beta work in this repo.
