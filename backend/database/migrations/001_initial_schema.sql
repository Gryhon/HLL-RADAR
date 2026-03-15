-- Initial database schema for HLL RADAR 📡
-- This migration creates all base tables and indexes

-- Servers table
CREATE TABLE IF NOT EXISTS servers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    password TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL DEFAULT 1,
    map_name TEXT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    player_count_peak INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

-- Player positions table
CREATE TABLE IF NOT EXISTS player_positions (
    id SERIAL PRIMARY KEY,
    match_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    team TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    z DOUBLE PRECISION NOT NULL,
    rotation DOUBLE PRECISION DEFAULT 0,
    map_name TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

-- Match events table
CREATE TABLE IF NOT EXISTS match_events (
    id SERIAL PRIMARY KEY,
    match_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    player_ids TEXT,
    player_names TEXT,
    position_x DOUBLE PRECISION,
    position_y DOUBLE PRECISION,
    position_z DOUBLE PRECISION,
    victim_x DOUBLE PRECISION,
    victim_y DOUBLE PRECISION,
    victim_z DOUBLE PRECISION,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

-- Indexes for match queries
CREATE INDEX IF NOT EXISTS idx_matches_start_time ON matches (start_time DESC);
CREATE INDEX IF NOT EXISTS idx_matches_is_active ON matches (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_matches_server_id ON matches (server_id);
CREATE INDEX IF NOT EXISTS idx_matches_server_active ON matches (server_id, is_active) WHERE is_active = TRUE;

-- Composite indexes for player position queries - critical for match replay performance
CREATE INDEX IF NOT EXISTS idx_player_positions_match_timestamp ON player_positions (match_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_player_positions_match_player_timestamp ON player_positions (match_id, player_name, timestamp DESC);

-- Keep existing single-column indexes for backwards compatibility
CREATE INDEX IF NOT EXISTS idx_player_positions_timestamp ON player_positions (timestamp);
CREATE INDEX IF NOT EXISTS idx_player_positions_player_name ON player_positions (player_name);

-- Index for match events
CREATE INDEX IF NOT EXISTS idx_match_events_match_timestamp ON match_events (match_id, timestamp DESC);
