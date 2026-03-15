package webserver

import "hll-radar/database"

// WSMessageType represents the type of WebSocket message
type WSMessageType string

const (
	// PlayerUpdateMsg is sent when player positions are updated
	PlayerUpdateMsg WSMessageType = "player_update"
	// PlayerDeltaMsg is sent when only changed player positions are updated
	PlayerDeltaMsg WSMessageType = "player_delta"
	// MatchUpdateMsg is sent when match information changes
	MatchUpdateMsg WSMessageType = "match_update"
	// MatchStartMsg is sent when a new match starts
	MatchStartMsg WSMessageType = "match_start"
	// MatchEndMsg is sent when a match ends
	MatchEndMsg WSMessageType = "match_end"
	// MatchEventMsg is sent when a match event occurs
	MatchEventMsg WSMessageType = "match_event"
)

// WebSocketMessage is the base structure for all WebSocket messages
type WebSocketMessage struct {
	Type    WSMessageType `json:"type"`
	Payload interface{}   `json:"payload"`
}

// PlayerUpdatePayload contains player position data and match scores
type PlayerUpdatePayload struct {
	Players     []database.PlayerPosition `json:"players"`
	AlliedScore int                       `json:"allied_score"`
	AxisScore   int                       `json:"axis_score"`
	ServerID    int64                     `json:"server_id"`
}

// MatchUpdatePayload contains match state information
type MatchUpdatePayload struct {
	Match    *database.Match `json:"match"`
	ServerID int64           `json:"server_id"`
	IsActive bool            `json:"is_active"`
}

// MatchEventPayload contains a single match event
type MatchEventPayload struct {
	Event    database.MatchEvent `json:"event"`
	ServerID int64               `json:"server_id"`
}

// PlayerDeltaUpdate contains only changed player positions for efficient updates
type PlayerDeltaUpdate struct {
	Added       []database.PlayerPosition `json:"added"`
	Updated     []database.PlayerPosition `json:"updated"`
	Removed     []string                  `json:"removed"` // player names
	AlliedScore int                       `json:"allied_score"`
	AxisScore   int                       `json:"axis_score"`
	ServerID    int64                     `json:"server_id"`
}
