-- 005_add_spawn_tracking.sql
-- Add spawn tracking columns to match_events table

-- Add spawn tracking columns to match_events table
ALTER TABLE match_events 
ADD COLUMN IF NOT EXISTS spawn_type TEXT,
ADD COLUMN IF NOT EXISTS spawn_location TEXT,
ADD COLUMN IF NOT EXISTS spawn_team TEXT,
ADD COLUMN IF NOT EXISTS spawn_unit TEXT;

-- Create index for spawn event queries
CREATE INDEX IF NOT EXISTS idx_match_events_spawns 
ON match_events (match_id, event_type, timestamp DESC) 
WHERE event_type = 'spawn';

-- Add comments to document the new columns
COMMENT ON COLUMN match_events.spawn_type IS 'Type of spawn: garrison, outpost, hq, etc.';
COMMENT ON COLUMN match_events.spawn_location IS 'Location identifier for the spawn point';
COMMENT ON COLUMN match_events.spawn_team IS 'Team that owns the spawn: Allies or Axis';
COMMENT ON COLUMN match_events.spawn_unit IS 'Squad/unit name for the spawn';
