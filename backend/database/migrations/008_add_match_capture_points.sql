-- Add capture_points JSONB column to matches table for per-match CP overrides

ALTER TABLE matches ADD COLUMN IF NOT EXISTS capture_points JSONB;
