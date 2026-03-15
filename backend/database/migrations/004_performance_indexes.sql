-- 004_performance_indexes.sql
-- Performance optimization indexes for timeline queries and data processing

-- Optimize timeline queries with composite index for efficient sorting
-- This index is optimized for queries that need player positions ordered by time
CREATE INDEX IF NOT EXISTS idx_player_positions_recent 
ON player_positions (match_id, timestamp DESC, player_name);

-- Optimize kill event queries with composite index
-- This index is optimized for timeline-based kill event filtering
CREATE INDEX IF NOT EXISTS idx_match_events_timeline 
ON match_events (match_id, timestamp DESC, event_type) 
WHERE event_type IN ('kill', 'teamkill');

-- Add index for player position deduplication
-- This index helps with finding the latest position per player efficiently
CREATE INDEX IF NOT EXISTS idx_player_positions_latest 
ON player_positions (match_id, player_name, timestamp DESC);

-- Optimize current player position queries (for live mode)
-- This index is specifically for the GetCurrentPlayerPositions query
CREATE INDEX IF NOT EXISTS idx_player_positions_current 
ON player_positions (match_id, timestamp DESC);

-- Optimize event queries by type and time
-- This index helps with event filtering and timeline queries
CREATE INDEX IF NOT EXISTS idx_match_events_type_time 
ON match_events (match_id, event_type, timestamp DESC);

-- Add comment to document the performance indexes
COMMENT ON INDEX idx_player_positions_recent IS 'Optimizes timeline queries with efficient sorting by match_id, timestamp, and player_name';
COMMENT ON INDEX idx_match_events_timeline IS 'Optimizes kill event timeline filtering';
COMMENT ON INDEX idx_player_positions_latest IS 'Optimizes player position deduplication queries';
COMMENT ON INDEX idx_player_positions_current IS 'Optimizes current player position queries for live mode';
COMMENT ON INDEX idx_match_events_type_time IS 'Optimizes event filtering by type and time';
