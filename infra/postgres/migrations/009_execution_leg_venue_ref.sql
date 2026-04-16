-- Optional venue correlation for ExecutionLeg (P2-2.1-EPL / venue adapter integration).
ALTER TABLE execution_legs
  ADD COLUMN IF NOT EXISTS venue_ref TEXT;
