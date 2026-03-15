-- Add remaining_match_time column to matches table
-- This stores the current remaining match time from RCON for UI clock synchronization

ALTER TABLE matches ADD COLUMN IF NOT EXISTS remaining_match_time_seconds INTEGER DEFAULT 0;

-- Add index for active matches with remaining time
CREATE INDEX IF NOT EXISTS idx_matches_active_remaining_time ON matches (is_active, remaining_match_time_seconds) WHERE is_active = TRUE;
