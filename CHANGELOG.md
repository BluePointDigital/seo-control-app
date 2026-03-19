# Changelog

All notable changes to this project will be documented in this file.

## 2026-03-19

### Added
- True SerpApi search-location targeting for rank profiles with `searchLocationId`, `searchLocationName`, and `businessName`.
- Workspace-authenticated rank-location lookup endpoint at `GET /api/workspaces/:workspaceId/rank/locations`.
- Separate map-pack tracking fields in `rank_daily` for matched position, URL, and listing name.
- Rankings UI support for search-location lookup, business-name matching, display labels, and an `Organic / Map Pack` view toggle.
- Test coverage for rank-location lookup, map-pack matching, summary output, and migration backfills.
- Owner/admin workspace creation directly from the header workspace switcher.
- Workspace-selectable credential labels for rank API keys, PageSpeed keys, and Google Ads developer tokens.
- Workspace settings controls for choosing credential labels, plus org-vault guidance for managing multiple labeled keys per provider.
- Dedicated workspace `Setup` surface for source mapping, rank defaults, audit defaults, and workspace run actions.
- Detailed in-app Lighthouse review with mobile/desktop tabs, core metrics, opportunities, diagnostics, passed audits, and direct PageSpeed links.
- Shared Tailwind/Radix UI primitives for cards, tabs, dropdowns, accordions, scroll areas, and form controls across the app shell and workspace pages.

### Changed
- Rank sync now sends SerpApi a real `location` value per profile, preferring the stored location id and falling back to the location name.
- Rank sync stores organic rankings and map-pack rankings independently from the same Google result set.
- Rank summaries now keep the existing organic response shape and include a parallel `mapPack` summary for Rankings-only views.
- Rank-profile migrations now backfill search location and business identity fields from legacy profile data when available.
- Overview, portfolio, and generated report surfaces now include map-pack visibility and coverage metrics alongside organic rankings.
- Stored report summaries now preserve organic and map-pack ranking metrics for report history and preview views.
- Workspace settings and Google Ads asset APIs now persist and preview credential-label selection per workspace.
- Audit runs, rank sync, Google Ads sync, and scheduler readiness now resolve labeled credentials by selected label first and exact `default` second.
- Audit messaging and workspace Google Ads customer selection now reflect the effective workspace credential label and fallback state.
- The browser app now uses a compact sticky shell with a single reporting-window control, consolidated admin/account menus, and denser workspace layouts.
- Workspace-scoped configuration has been removed from Overview, Rankings, and Site Audit in favor of the dedicated `Setup` route.
- Site Audit now persists richer normalized Lighthouse detail inside the existing audit payload while keeping the existing top-level score fields compatible.
- Workspace navigation now places `Setup` last so the flow emphasizes monitoring and reporting before configuration.

### Fixed
- Profiles without a configured search location are skipped during sync instead of writing misleading null ranking rows.
- Existing workspace surfaces outside Rankings continue to use organic data only, preventing behavior changes in alerts, reports, overview, portfolio, and competitor tracking.
- Missing non-default credential labels now fall back cleanly to `default`, while unreadable selected credentials continue surfacing the underlying validation error.
- Docker builds now include the shared credential-provider module required by the workspace credential-label flow.
- Site Audit grouped findings now render every affected URL without clipping and each URL opens as a clickable external link.
- Site Audit no longer stops at category score summaries when Lighthouse detail is available.
