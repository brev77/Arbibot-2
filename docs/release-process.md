# Release process

**Versioning scheme:** Semantic Versioning with phase suffixes until 1.0:
`v<major>.<minor>.<patch>-<phase>` where `<phase>` is `paper` or `live`.

| Phase | Tag shape | Meaning |
|-------|-----------|---------|
| Paper | `v0.1.0-paper`, `v0.2.0-paper` | Paper-deploy baseline / paper-phase releases. Pre-1.0 — **minors may be breaking.** |
| Live  | `v1.0.0-live`, `v1.1.0-live` | First live release and subsequent live releases. After 1.0 the `-live` suffix drops. |

See [`CHANGELOG.md`](../CHANGELOG.md) for the release history and [ADR](adr-observability-logging-release.md) §2 for the rationale (manual Keep-a-Changelog; no `semantic-release` automation — paper-phase does not justify the tooling overhead).

## Cutting a release

Run this procedure from the repository root on a clean `main`.

1. **Write the changelog.** Under `CHANGELOG.md`, promote the `## [Unreleased]` entries to a new version header:
   ```markdown
   ## [0.2.0-paper] — 2026-08-01
   ```
   Add a fresh empty `## [Unreleased]` section above it. Update the two `compare` links at the bottom.

2. **Bump the version.** Edit `package.json`:
   ```json
   "version": "0.2.0"
   ```
   (Root package only — workspace packages stay at `0.0.1` until they are published, which is not planned.)

3. **Commit:**
   ```bash
   git add CHANGELOG.md package.json
   git commit -m "chore(release): v0.2.0-paper"
   ```

4. **Tag** (the tag **is** outward-facing — pushed to remote):
   ```bash
   git tag v0.2.0-paper
   git push origin main
   git push origin v0.2.0-paper
   ```

5. **Verify the CD pipeline.** The `cd.yml` workflow triggers on the tag push and builds all 13 images (12 Nest services + web) with **three** tag rules per image:
   - `latest` (or the `workflow_dispatch` `tag` input)
   - `<git-sha>` (short SHA, for traceability)
   - `v0.2.0-paper` (the semver tag, from `type=ref,event=tag`)
   
   Confirm in the GitHub Actions run that each image now carries the semver tag in GHCR.

6. **Smoke.** Pull the new tag and run it:
   ```bash
   IMAGE_TAG=v0.2.0-paper docker compose -f infra/docker-compose.prod.yml up -d
   npm run verify:deployment
   ```

## Rollback to a previous release

Because images carry semver tags, rollback is a one-line image-pin change:

```bash
# Pin every service to the previous known-good release
IMAGE_TAG=v0.1.0-paper docker compose -f infra/docker-compose.prod.yml up -d
npm run verify:deployment
```

> **Database migrations are forward-only.** If the release you are rolling back from
> applied a new migration, rolling the image back does **not** roll the schema back.
> Restore the DB from the pre-deploy backup instead: `npm run db:restore -- backups/<file>.sql.gz`.
> See [`docs/deployment-guide.md`](deployment-guide.md) §11 for the full procedure.

## Hotfix (backport)

For a critical fix on a released version while `main` has moved on:

1. Branch from the release tag: `git checkout -b hotfix/0.2.1 v0.2.0-paper`.
2. Apply the minimal fix + a new `## [0.2.1-paper]` entry in `CHANGELOG.md`.
3. Tag `v0.2.1-paper`, push the tag, let CD build the hotfix image.
4. Cherry-pick the fix commit onto `main` so the next regular release includes it.

## Pre-1.0 instability contract

Until `v1.0.0`:
- **Minor** bumps (`0.1.0` → `0.2.0`) **may include breaking changes** (API shape, env var renames, schema). Read the CHANGELOG `Changed` / `Removed` sections before bumping.
- **Patch** bumps (`0.2.0` → `0.2.1`) are backwards-compatible fixes only.
- The `-paper` / `-live` suffix carries the lifecycle stage and is not part of semver precedence beyond tag ordering.

After `v1.0.0` standard semver applies (minor = backwards-compatible, major = breaking) and the phase suffix is dropped.
