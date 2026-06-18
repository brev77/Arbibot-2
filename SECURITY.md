# Security Policy

## Supported Versions

Arbibot 2 is currently in pre-production development. Security fixes are applied
only to the latest `main` branch.

| Version | Supported          |
|---------|--------------------|
| `main`  | ✅ Active development |
| Tags    | ❌ Not released yet  |

## Reporting a Vulnerability

**⚠️ Please do NOT open public GitHub issues for security vulnerabilities.**

If you discover a security issue in Arbibot 2, report it privately:

1. **Preferred — GitHub Private Vulnerability Reporting**
   Use `Security` → `Report a vulnerability` on the GitHub repository page.
   This creates a private advisory visible only to repository maintainers.

2. **Alternative — Email**
   Send details to the maintainer via the email listed on the GitHub profile
   (`brev77@users.noreply.github.com`), with the subject prefix
   `[SECURITY] Arbibot 2:`.

Please include in your report:

- Affected component (service, package, or file path)
- Steps to reproduce (or proof-of-concept)
- Potential impact assessment
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: within 72 hours
- **Initial assessment**: within 7 days
- **Fix or mitigation**: depends on severity, target ≤ 30 days for `High`/`Critical`

## Scope

In scope:

- Backend services (`apps/*`): authentication, authorization, input validation,
  SQL injection, secrets leakage, unsafe deserialization.
- Frontend (`apps/web`): XSS, CSRF, RBAC bypass, sensitive data exposure.
- Infrastructure (`infra/`): misconfigured defaults, insecure container setup.
- Dependencies: known CVEs in production dependencies.

Out of scope:

- Self-hosted misconfiguration not covered by the default `infra/` config.
- Issues that require already-compromised credentials or network access.
- Denial-of-service via the public testnet/mainnet integration (rate-limit only).
- Findings from automated scanners without a working exploit.

## Safe Harbor

Arbibot 2 is an open-source project. Good-faith security research is appreciated
and will not result in legal action, provided it respects the project's license
and does not harm users or production infrastructure.

## Security Best Practices for Operators

If you plan to deploy Arbibot 2 (even in paper mode), follow the hardening
guides in the repository **before** bringing it online:

- [`docs/security-baseline.md`](docs/security-baseline.md)
- [`docs/security-hardening-guide.md`](docs/security-hardening-guide.md)
- [`docs/threat-model.md`](docs/threat-model.md)
- [`docs/vault-integration-guide.md`](docs/vault-integration-guide.md)
- [`docs/key-rotation-runbook.md`](docs/key-rotation-runbook.md)

Never commit real `.env`, API keys, RPC endpoints, or private keys to the
repository. GitHub Secret Scanning and Push Protection are enabled — any leaked
credential will be rejected on push.