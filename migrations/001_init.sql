-- Enables gen_random_uuid() on Postgres < 13
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Applications table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_name  VARCHAR(255) NOT NULL,
  applicant_email VARCHAR(255) NOT NULL,
  status          VARCHAR(50)  NOT NULL DEFAULT 'submitted',
  data            JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Outbox Events table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbox_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type  VARCHAR(100) NOT NULL,          -- e.g. 'Application'
  aggregate_id    UUID         NOT NULL,           -- FK to the source row
  event_type      VARCHAR(100) NOT NULL,           -- e.g. 'ApplicationSubmitted'
  payload         JSONB        NOT NULL,
  published       BOOLEAN      NOT NULL DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  sns_message_id  VARCHAR(255),                    -- returned by SNS on publish
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Partial index for the worker's poll query (only unpublished rows)
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON outbox_events (created_at ASC)
  WHERE published = FALSE;
