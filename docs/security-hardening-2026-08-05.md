# Security Hardening — 2026-08-05

**Host:** Aéza Frankfurt (79.137.202.225)
**Trigger:** Hosting provider abuse report — exposed unauthenticated Redis detected by automated scan (Censys/Shodam-like).
**Outcome:** Server was NOT compromised (verified). All attack vectors closed.

---

## TL;DR

The dev compose was exposing Redis:6379 and Postgres:15432 on 0.0.0.0 with **no Redis
password**. An exposed unauthenticated Redis is a well-documented root-compromise vector
(`CONFIG SET dir /root/.ssh` + `SAVE` writes `authorized_keys`). The hosting provider's
automated scan detected the exposure and sent an informational abuse report — no actual
breach occurred. Hardened: loopback bind + Redis auth + CONFIG disabled + SSH key-only +
fail2ban.

---

## Compromise check (clean)

| Check | Result |
|---|---|
| `/root/.ssh/authorized_keys` | 1 key (yours), no foreign keys ✅ |
| Cron jobs | Only system defaults (apport, apt-compat, dpkg) ✅ |
| Suspicious processes (xmrig/kdevtmpfs as user/nc) | None (kernel thread only) ✅ |
| Redis `CONFIG GET dir` | `/data` (NOT `/root/.ssh` or `/`) ✅ |
| Redis `CONFIG GET dbfilename` | `dump.rdb` (NOT `authorized_keys`) ✅ |
| SSH accepted sessions (7d) | All from your IP `81.90.1.254`, one key ✅ |

The abuse report was informational — the attacker scan recorded Redis version + IP but no
exploit followed.

---

## Hardening applied

### 1. UFW — emergency block (immediate)

```
6379/tcp on eth0  DENY  Anywhere  # Redis - lock down (abuse report 2026-08-05)
15432/tcp on eth0 DENY  Anywhere  # Postgres - lock down (abuse report 2026-08-05)
```

Belt-and-suspenders: even if a future compose misconfiguration re-exposes the ports,
UFW blocks the public interface.

### 2. Docker compose — bind to 127.0.0.1

`infra/docker-compose.dev.yml` (commits `8b457fc`, `5582ae2`, `c923ccf`):

```yaml
# Before (VULNERABLE):
ports:
  - '15432:5432'   # 0.0.0.0:15432 — exposed
  - '6379:6379'    # 0.0.0.0:6379 — exposed

# After (loopback only):
ports:
  - '127.0.0.1:15432:5432'
  - '127.0.0.1:6379:6379'
```

Postgres is unaffected functionally (Nest apps connect via `127.0.0.1:15432`).

### 3. Redis authentication + CONFIG rename

```yaml
command: >-
  sh -c 'exec redis-server --appendonly yes
  $${REDIS_PASSWORD:+--requirepass "$$REDIS_PASSWORD"
  --rename-command CONFIG ""}'
environment:
  REDIS_PASSWORD: ${REDIS_PASSWORD:-}
```

- `REDIS_PASSWORD` sourced from `.env` (48-char hex, generated via `openssl rand -hex 24`).
- `REDIS_URL=redis://:PASSWORD@127.0.0.1:6379` embedded in `.env` so Nest apps authenticate.
- `CONFIG` command renamed to empty string — kills the `CONFIG SET dir + SAVE → authorized_keys`
  root-compromise vector even if a future misconfiguration re-exposes the port.
- `FLUSHALL`/`FLUSHDB` left intact — renaming them broke AOF replay (existing appendonly.aof
  contained FLUSHALL commands and Redis aborted on start).

Verified live on Aéza:
- `redis-cli PING` without password → `NOAUTH Authentication required.`
- `redis-cli -a $PW PING` → `PONG`
- `redis-cli -a $PW CONFIG GET dir` → `ERR unknown command 'CONFIG'`

### 4. SSH hardening

`/etc/ssh/sshd_config`:
- `PermitRootLogin prohibit-password` (root login via key only — no password)
- `PasswordAuthentication no` (no password auth for any user — key only)

Verified: SSH session survives sshd restart (key auth).

### 5. fail2ban on SSH

`/etc/fail2ban/jail.d/sshd.local`:
- `maxretry = 3`, `findtime = 600s`, `bantime = 3600s`

Status after deploy: **444 IPs banned** (the abuse report also flagged brute-force attempts
— 1580 failed login attempts in 24h before fail2ban was enabled). Active filter on
`/var/log/auth.log`.

---

## Verification (final)

```
1. UFW (Redis/Postgres blocked from outside)         ✅ DENY on eth0
2. Redis auth (requirepass enforced)                 ✅ NOAUTH without password
3. Redis CONFIG (disabled)                           ✅ ERR unknown command 'CONFIG'
4. Ports bound to 127.0.0.1                          ✅ both redis + postgres
5. SSH hardening                                     ✅ prohibit-password + PasswordAuth no
6. fail2ban active                                   ✅ 444 banned
7. Service health                                    ✅ all 6 services health=200
8. Redis cache working                               ✅ "Cache hit" in config-service logs
```

---

## Commits on main

```
c923ccf  fix(compose): drop FLUSHALL/FLUSHDB rename — breaks loading existing AOF files
5582ae2  fix(compose): redis command shell-form (multi-line sh -c split the requirepass expansion)
8b457fc  security(hardening): bind Redis/Postgres to 127.0.0.1 + Redis auth + command rename
```

---

## Operational notes

- `REDIS_PASSWORD` is in `/root/Arbibot-2/.env` (chmod 600, root-only). NOT committed to git.
- To rotate: `openssl rand -hex 24` → edit `.env` → `docker compose --env-file .env -f infra/docker-compose.dev.yml up -d --force-recreate redis` → `pm2 delete all && pm2 start ecosystem.paper.config.cjs && pm2 save`.
- prod compose (`infra/docker-compose.prod.yml`) is unaffected — services talk over the docker network, no host ports exposed.
- If you need Redis/Postgres access from another host (e.g. local dev tools), use SSH tunnel: `ssh -L 6379:127.0.0.1:6379 arbibot-paper` — do NOT re-expose the port.
