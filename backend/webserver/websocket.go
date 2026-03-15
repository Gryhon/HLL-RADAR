package webserver

import (
	"context"
	"encoding/json"
	"fmt"
	"hll-radar/database"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// wsClient wraps a WebSocket connection with a write mutex and send channel
type wsClient struct {
	conn    *websocket.Conn
	send    chan []byte
	writeMu sync.Mutex
}

// writeMessage safely writes a message to the WebSocket connection
func (c *wsClient) writeMessage(messageType int, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.WriteMessage(messageType, data)
}

// writePump sends messages from the send channel to the WebSocket connection
func (c *wsClient) writePump() {
	for msg := range c.send {
		if err := c.writeMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func (ws *WebServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := ws.upgrader.Upgrade(w, r, nil)
	if err != nil {
		ws.log.Error("Failed to upgrade WebSocket connection", "error", err)
		return
	}
	defer conn.Close()

	client := &wsClient{
		conn: conn,
		send: make(chan []byte, 256),
	}

	ws.clientMu.Lock()
	ws.clients[client] = true
	ws.clientMu.Unlock()

	ws.log.Info("New WebSocket client connected", "remote_addr", r.RemoteAddr)

	// Set up ping/pong handlers for connection health monitoring
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Start ping ticker to keep connection alive
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Channel to signal when to stop goroutines
	done := make(chan struct{})
	defer close(done)

	// Send pings in a goroutine using the write mutex
	go func() {
		for {
			select {
			case <-ticker.C:
				if err := client.writeMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			case <-done:
				return
			}
		}
	}()

	// Start write pump goroutine
	go client.writePump()

	// Send initial data for all servers
	ctx := context.Background()
	servers, err := ws.db.ListServers(ctx)
	if err == nil {
		for _, server := range servers {
			activeMatch, err := ws.db.GetActiveMatch(ctx, server.ID)
			if err == nil && activeMatch != nil {
				players, err := ws.db.GetCurrentPlayerPositions(ctx, activeMatch.ID)
				if err == nil {
					message := WebSocketMessage{
						Type: PlayerUpdateMsg,
						Payload: PlayerUpdatePayload{
							Players:  players,
							ServerID: server.ID,
						},
					}

					data, err := json.Marshal(message)
					if err == nil {
						client.writeMessage(websocket.TextMessage, data)
					}
				}
			}
		}
	}

	// Keep connection alive and handle disconnection
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			ws.log.Info("WebSocket client disconnected", "error", err)
			break
		}
	}

	// Close the send channel to stop the write pump
	close(client.send)

	ws.clientMu.Lock()
	delete(ws.clients, client)
	ws.clientMu.Unlock()
}

// handleBroadcasts reads from the broadcast channel and sends messages to all connected clients
func (ws *WebServer) handleBroadcasts() {
	for data := range ws.broadcast {
		ws.clientMu.RLock()
		ws.log.Debug("Broadcasting to clients", "client_count", len(ws.clients), "data_size", len(data))

		var failedClients []*wsClient
		for client := range ws.clients {
			select {
			case client.send <- data:
			default:
				// Client's send buffer is full, mark for removal
				failedClients = append(failedClients, client)
			}
		}
		ws.clientMu.RUnlock()

		// Remove failed clients outside the read lock
		if len(failedClients) > 0 {
			ws.clientMu.Lock()
			for _, client := range failedClients {
				delete(ws.clients, client)
				client.conn.Close()
			}
			ws.clientMu.Unlock()
		}
	}
}

func (ws *WebServer) BroadcastPlayerUpdate(players []database.PlayerPosition, alliedScore, axisScore int, serverID int64) {
	ws.log.Debug("BroadcastPlayerUpdate called", "player_count", len(players), "score", fmt.Sprintf("%d-%d", alliedScore, axisScore), "server_id", serverID)

	message := WebSocketMessage{
		Type: PlayerUpdateMsg,
		Payload: PlayerUpdatePayload{
			Players:     players,
			AlliedScore: alliedScore,
			AxisScore:   axisScore,
			ServerID:    serverID,
		},
	}

	data, err := json.Marshal(message)
	if err != nil {
		ws.log.Error("Failed to marshal player update", "error", err)
		return
	}

	select {
	case ws.broadcast <- data:
		ws.log.Debug("Player update sent to broadcast channel", "player_count", len(players))
	default:
		ws.log.Warn("Broadcast channel full, skipping player update", "player_count", len(players))
	}
}

// BroadcastPlayerDeltaUpdate broadcasts only changed player positions for efficient updates
func (ws *WebServer) BroadcastPlayerDeltaUpdate(players []database.PlayerPosition, alliedScore, axisScore int, serverID int64) {
	ws.positionsMu.Lock()
	defer ws.positionsMu.Unlock()

	lastPositions := ws.lastBroadcastPositions[serverID]
	if lastPositions == nil {
		lastPositions = make(map[string]database.PlayerPosition)
	}

	delta := PlayerDeltaUpdate{
		Added:       []database.PlayerPosition{},
		Updated:     []database.PlayerPosition{},
		Removed:     []string{},
		AlliedScore: alliedScore,
		AxisScore:   axisScore,
		ServerID:    serverID,
	}

	currentPlayers := make(map[string]bool)
	for _, player := range players {
		currentPlayers[player.PlayerName] = true
		if lastPos, exists := lastPositions[player.PlayerName]; !exists {
			delta.Added = append(delta.Added, player)
		} else if ws.hasPlayerChanged(lastPos, player) {
			delta.Updated = append(delta.Updated, player)
		}
		lastPositions[player.PlayerName] = player
	}

	for name := range lastPositions {
		if !currentPlayers[name] {
			delta.Removed = append(delta.Removed, name)
			delete(lastPositions, name)
		}
	}

	ws.lastBroadcastPositions[serverID] = lastPositions

	// Only broadcast if there are changes
	if len(delta.Added) > 0 || len(delta.Updated) > 0 || len(delta.Removed) > 0 {
		ws.broadcastDelta(delta)
	}
}

// hasPlayerChanged checks if a player's position or stats have changed significantly
func (ws *WebServer) hasPlayerChanged(old, new database.PlayerPosition) bool {
	// Check position changes (with small tolerance for floating point precision)
	positionThreshold := 0.1
	if math.Abs(old.X-new.X) > positionThreshold || math.Abs(old.Y-new.Y) > positionThreshold || math.Abs(old.Z-new.Z) > positionThreshold {
		return true
	}

	// Check if stats have changed
	if old.Kills != new.Kills || old.Deaths != new.Deaths || old.Combat != new.Combat ||
		old.Offensive != new.Offensive || old.Defensive != new.Defensive || old.Support != new.Support {
		return true
	}

	// Check if role or unit changed
	if old.Role != new.Role || old.Unit != new.Unit {
		return true
	}

	return false
}

// broadcastDelta sends delta update to all connected clients
func (ws *WebServer) broadcastDelta(delta PlayerDeltaUpdate) {
	message := WebSocketMessage{
		Type:    PlayerDeltaMsg,
		Payload: delta,
	}

	data, err := json.Marshal(message)
	if err != nil {
		ws.log.Error("Failed to marshal player delta update", "error", err)
		return
	}

	ws.log.Debug("Broadcasting player delta update",
		"added", len(delta.Added),
		"updated", len(delta.Updated),
		"removed", len(delta.Removed),
		"server_id", delta.ServerID)

	select {
	case ws.broadcast <- data:
		ws.log.Debug("Player delta update sent to broadcast channel")
	default:
		ws.log.Warn("Broadcast channel full, skipping player delta update")
	}
}

// BroadcastMatchEvent broadcasts a match event to all connected WebSocket clients
func (ws *WebServer) BroadcastMatchEvent(event database.MatchEvent, serverID int64) {
	ws.log.Debug("Broadcasting match event", "type", event.EventType, "match_id", event.MatchID, "server_id", serverID)

	message := WebSocketMessage{
		Type: MatchEventMsg,
		Payload: MatchEventPayload{
			Event:    event,
			ServerID: serverID,
		},
	}

	data, err := json.Marshal(message)
	if err != nil {
		ws.log.Error("Failed to marshal match event", "error", err)
		return
	}

	select {
	case ws.broadcast <- data:
		ws.log.Debug("Match event sent to broadcast channel", "type", event.EventType)
	default:
		ws.log.Warn("Broadcast channel full, skipping match event", "type", event.EventType)
	}
}

// BroadcastMatchStart broadcasts a match start event to all connected WebSocket clients
func (ws *WebServer) BroadcastMatchStart(match *database.Match) {
	message := WebSocketMessage{
		Type: MatchStartMsg,
		Payload: MatchUpdatePayload{
			Match:    match,
			ServerID: match.ServerID,
			IsActive: true,
		},
	}

	data, err := json.Marshal(message)
	if err != nil {
		ws.log.Error("Failed to marshal match start", "error", err)
		return
	}

	select {
	case ws.broadcast <- data:
		ws.log.Info("Broadcasting match start", "match_id", match.ID, "map", match.MapName, "server_id", match.ServerID)
	default:
		// Channel is full, skip this update
	}
}

// BroadcastMatchEnd broadcasts a match end event to all connected WebSocket clients
func (ws *WebServer) BroadcastMatchEnd(matchID int64, serverID int64) {
	message := WebSocketMessage{
		Type: MatchEndMsg,
		Payload: map[string]interface{}{
			"match_id":  matchID,
			"server_id": serverID,
		},
	}

	data, err := json.Marshal(message)
	if err != nil {
		ws.log.Error("Failed to marshal match end", "error", err)
		return
	}

	select {
	case ws.broadcast <- data:
		ws.log.Info("Broadcasting match end", "match_id", matchID)
	default:
		// Channel is full, skip this update
	}
}
