# Staging / production: applying database migrations

After releases that add SQL under `infra/postgres/migrations/`, apply them on **every** environment (dev, staging, prod) before rolling out services that depend on new columns or tables.

## Standard apply

1. **Backup** the database (snapshot or logical dump) before migrating production.
2. Set `DATABASE_URL` to the target database (see [`.env.example`](../../.env.example); dev compose maps Postgres to host port **15432**).
3. From repo root:

```bash
npm run db:migrate
```

The runner applies any `*.sql` files not yet recorded in `schema_migrations` (lexical order).

## Verify recent migrations (030 / 031)

Production-readiness slice (2026-04-21) added:

- `030_paper_promotion_quality_fields.sql` — paper promotion `quality_score` / `quality_tier`
- `031_portfolio_position_close_idempotency.sql` — idempotency rows for `POST /positions/:id/close`

After `npm run db:migrate`, confirm they are recorded:

```bash
node tools/verify-migrations-applied.mjs
```

Optional: require specific files:

```bash
node tools/verify-migrations-applied.mjs 030_paper_promotion_quality_fields.sql 031_portfolio_position_close_idempotency.sql
```

### Full set (001–031)

To assert **every** migration file under `infra/postgres/migrations/` is recorded (e.g. after a fresh staging bootstrap):

```bash
npm run db:verify-migrations:all
```

Equivalent: `node tools/verify-migrations-applied.mjs --all`

## Rollback

Down migrations are not shipped in-repo. For production issues, restore from backup or prepare a forward-fix migration (preferred).
