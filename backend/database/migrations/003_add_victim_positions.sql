-- Migration to add victim position columns to match_events table
-- This migration adds victim_x, victim_y, and victim_z columns to store victim positions in kill events

-- Add victim position columns to match_events table
ALTER TABLE match_events 
ADD COLUMN IF NOT EXISTS victim_x DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS victim_y DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS victim_z DOUBLE PRECISION;

-- Add comment to document the new columns
COMMENT ON COLUMN match_events.victim_x IS 'Victim X coordinate for kill events';
COMMENT ON COLUMN match_events.victim_y IS 'Victim Y coordinate for kill events';
COMMENT ON COLUMN match_events.victim_z IS 'Victim Z coordinate for kill events';
