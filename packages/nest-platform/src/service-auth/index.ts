/**
 * Arbibot 2 — Service-to-service HMAC auth (F1 remediation, Phase C).
 *
 * Public surface:
 *   - Pure functions for signing/verifying (`signature.ts`).
 *   - Fastify preHandler (`fastify-guard.ts`) registered via `applyArbibotHttpSecurity`.
 *   - Outbound fetch wrapper (`fetch-signer.ts`) for callers that talk to other NestJS services.
 */

export {
  ARBIBOT_SERVICE_AUTH_ENABLED_ENV,
  ARBIBOT_SERVICE_AUTH_HEADER,
  ARBIBOT_SERVICE_AUTH_MAX_AGE_SECONDS,
  ARBIBOT_SERVICE_AUTH_PUBLIC_PATHS,
  ARBIBOT_SERVICE_AUTH_SECRET_ENV,
  canonicalSigningPayload,
  computeSignature,
  generateServiceAuthSecret,
  isPathPublic,
  isServiceAuthEnabled,
  parseSignatureHeader,
  readServiceAuthSecret,
  renderSignatureHeader,
  safeEqualHex,
  signServiceRequest,
  verifySignature,
  type ParsedSignatureHeader,
  type SignRequestOptions,
  type SignedRequestHeaders,
  type VerifyOptions,
  type VerifyOutcome,
} from './signature';

export {
  createServiceAuthPreHandler,
  resolveServiceAuthConfig,
  shouldEnableServiceAuth,
  type ServiceAuthPreHandlerOptions,
} from './fastify-guard';

export { signedFetch, type SignedFetchInit } from './fetch-signer';