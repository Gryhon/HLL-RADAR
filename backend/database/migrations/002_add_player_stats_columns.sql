-- Add player stats columns to player_positions table
-- Add final score columns to matches table
-- This migration adds columns that were previously added dynamically

-- Add player stats columns to player_positions table
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS clan_tag TEXT;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS level INTEGER;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS loadout TEXT;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS kills INTEGER;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS deaths INTEGER;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS combat INTEGER;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS offensive INTEGER;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS defensive INTEGER;
ALTER TABLE player_positions ADD COLUMN IF NOT EXISTS support INTEGER;

-- Add final score columns to matches table
ALTER TABLE matches ADD COLUMN IF NOT EXISTS final_score_allies INTEGER DEFAULT 2;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS final_score_axis INTEGER DEFAULT 2;
