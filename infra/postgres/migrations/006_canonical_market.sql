-- Canonical market registry (P1-1.2-MKT). Owner: canonical-market-service.

CREATE TABLE venue_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code TEXT NOT NULL,
  display_name TEXT,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_code)
);

CREATE TABLE canonical_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_ref_id UUID NOT NULL REFERENCES venue_refs (id),
  venue_symbol TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_ref_id, venue_symbol),
  UNIQUE (canonical_key)
);

CREATE INDEX idx_canonical_instruments_venue ON canonical_instruments (venue_ref_id);

CREATE TABLE canonical_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key TEXT NOT NULL,
  source_instrument_id UUID NOT NULL REFERENCES canonical_instruments (id),
  target_instrument_id UUID NOT NULL REFERENCES canonical_instruments (id),
  hops JSONB NOT NULL DEFAULT '[]'::jsonb,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_key)
);

CREATE INDEX idx_canonical_routes_pair ON canonical_routes (source_instrument_id, target_instrument_id);
