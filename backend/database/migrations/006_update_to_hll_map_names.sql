-- Update existing map names to use HLL package canonical names
-- This migration converts the old normalized map names to the official HLL package map names

-- Update matches table
UPDATE matches SET map_name = 'stmereeglise' WHERE map_name = 'smdm';
UPDATE matches SET map_name = 'stmariedumont' WHERE map_name = 'sme';
UPDATE matches SET map_name = 'utahbeach' WHERE map_name = 'utah';
UPDATE matches SET map_name = 'omahabeach' WHERE map_name = 'omaha';
UPDATE matches SET map_name = 'purpleheartlane' WHERE map_name = 'phl';
UPDATE matches SET map_name = 'hurtgenforest' WHERE map_name = 'hurtgen';
UPDATE matches SET map_name = 'elsenbornridge' WHERE map_name = 'elsenborn';

-- Update player_positions table
UPDATE player_positions SET map_name = 'stmereeglise' WHERE map_name = 'smdm';
UPDATE player_positions SET map_name = 'stmariedumont' WHERE map_name = 'sme';
UPDATE player_positions SET map_name = 'utahbeach' WHERE map_name = 'utah';
UPDATE player_positions SET map_name = 'omahabeach' WHERE map_name = 'omaha';
UPDATE player_positions SET map_name = 'purpleheartlane' WHERE map_name = 'phl';
UPDATE player_positions SET map_name = 'hurtgenforest' WHERE map_name = 'hurtgen';
UPDATE player_positions SET map_name = 'elsenbornridge' WHERE map_name = 'elsenborn';

-- Log the migration completion
INSERT INTO match_events (match_id, event_type, message, details, timestamp)
SELECT 
    id,
    'system',
    'Map names updated to HLL package canonical names',
    'migration_006',
    NOW()
FROM matches 
WHERE id = (SELECT MAX(id) FROM matches)
LIMIT 1;
