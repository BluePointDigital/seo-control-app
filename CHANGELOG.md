# Changelog

All notable changes to this project will be documented in this file.

## 2026-03-19

### Added
- True SerpApi search-location targeting for rank profiles with `searchLocationId`, `searchLocationName`, and `businessName`.
- Workspace-authenticated rank-location lookup endpoint at `GET /api/workspaces/:workspaceId/rank/locations`.
- Separate map-pack tracking fields in `rank_daily` for matched position, URL, and listing name.
- Rankings UI support for search-location lookup, business-name matching, display labels, and an `Organic / Map Pack` view toggle.
- Test coverage for rank-location lookup, map-pack matching, summary output, and migration backfills.

### Changed
- Rank sync now sends SerpApi a real `location` value per profile, preferring the stored location id and falling back to the location name.
- Rank sync stores organic rankings and map-pack rankings independently from the same Google result set.
- Rank summaries now keep the existing organic response shape and include a parallel `mapPack` summary for Rankings-only views.
- Rank-profile migrations now backfill search location and business identity fields from legacy profile data when available.

### Fixed
- Profiles without a configured search location are skipped during sync instead of writing misleading null ranking rows.
- Existing workspace surfaces outside Rankings continue to use organic data only, preventing behavior changes in alerts, reports, overview, portfolio, and competitor tracking.
