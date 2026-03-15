package tracker

import (
	"context"
	"fmt"
	"hll-radar/database"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/zMoooooritz/go-let-loose/pkg/hll"
)

// SpawnType represents the type of spawn point
type SpawnType string

const (
	SpawnTypeGarrison SpawnType = "garrison"
	SpawnTypeOutpost  SpawnType = "outpost"
	SpawnTypeHQ       SpawnType = "hq"
	SpawnTypeNone     SpawnType = "unknown"
)

// Distance constants for spawn detection
const (
	// Players spawn in a radius around the structure — jitter can be 10-20m
	SPAWN_CLUSTERING_DISTANCE = 2000.0 // 20m - spawn radius jitter around structure

	// HQ edge detection threshold
	HQ_EDGE_THRESHOLD = 5000.0 // 50m from map edge
)

// TTL for different spawn types — if no one spawns within this window, assume destroyed
var spawnTTL = map[SpawnType]time.Duration{
	SpawnTypeGarrison: 60 * time.Minute, // Garrisons are permanent until actively destroyed
	SpawnTypeOutpost:  10 * time.Minute, // Outposts expire after 10 min of no spawns
	SpawnTypeHQ:       60 * time.Minute, // HQs are effectively permanent
	SpawnTypeNone:     2 * time.Minute,  // Unknown spawns expire quickly
}

// SpawnPoint represents a detected spawn point
type SpawnPoint struct {
	Position   hll.Position    `json:"position"`
	Team       hll.Team        `json:"team"`
	SpawnType  SpawnType       `json:"spawn_type"`
	LastSeen   time.Time       `json:"last_seen"`
	SpawnCount int             `json:"spawn_count"`
	Unit       string          `json:"unit"`    // Primary unit (first unit seen)
	UsedBy     map[string]bool `json:"used_by"` // All units that have spawned here
	MatchID    int64           `json:"match_id"`
	Confidence float64         `json:"confidence"` // 0-1 confidence score
}

// SpawnPosition represents a calculated spawn position (for backward compatibility)
type SpawnPosition struct {
	PlayerID   string    `json:"player_id"`
	PlayerName string    `json:"player_name"`
	Team       string    `json:"team"`
	Unit       string    `json:"unit"`
	X          float64   `json:"x"`
	Y          float64   `json:"y"`
	Z          float64   `json:"z"`
	SpawnType  string    `json:"spawn_type"` // "garrison", "outpost", "hq", "unknown"
	Timestamp  time.Time `json:"timestamp"`
	MatchID    int64     `json:"match_id"`
	Confidence float64   `json:"confidence"` // 0-1 confidence score
}

// SpawnTracker tracks and calculates spawn positions
type SpawnTracker struct {
	db          *database.Database
	log         *slog.Logger
	webServer   WebServerInterface
	serverID    int64
	spawns      []SpawnPoint                       // Detected spawn points
	players     map[string]hll.DetailedPlayerInfo   // Previous player states
	unitOutpost map[string]map[string]int           // team -> unit -> spawn index (each unit has exactly 1 OP)
	lastCleanup time.Time                           // Last cleanup timestamp
	spawnsMu    sync.RWMutex                        // Mutex for spawns slice
	playersMu   sync.RWMutex                        // Mutex for players map
}

// NewSpawnTracker creates a new SpawnTracker instance
func NewSpawnTracker(db *database.Database, log *slog.Logger, webServer WebServerInterface, serverID int64) *SpawnTracker {
	return &SpawnTracker{
		db:          db,
		log:         log,
		webServer:   webServer,
		serverID:    serverID,
		spawns:      []SpawnPoint{},
		players:     make(map[string]hll.DetailedPlayerInfo),
		unitOutpost: make(map[string]map[string]int),
		lastCleanup: time.Now(),
	}
}

// ProcessPlayerPosition analyzes player position to detect spawns
func (st *SpawnTracker) ProcessPlayerPosition(ctx context.Context, player hll.DetailedPlayerInfo, matchID int64) error {
	// Track previous player state
	st.playersMu.Lock()
	previousState, exists := st.players[player.ID]
	st.players[player.ID] = player
	st.playersMu.Unlock()

	// Detect spawn event
	if exists && st.hasJustSpawned(previousState, player) {
		st.handlePlayerSpawn(ctx, player, matchID)
	}

	// Periodic cleanup of expired spawns
	if time.Since(st.lastCleanup) > 30*time.Second {
		st.cleanExpiredSpawns()
	}

	return nil
}

// hasJustSpawned checks if a player has just spawned using multiple heuristics:
// 1. Player transitioned from not-spawned (position 0,0,0) to spawned (non-zero position)
// 2. Player's death count increased AND position changed significantly (catches fast respawns
//    where the 0,0,0 state was missed between polling intervals)
func (st *SpawnTracker) hasJustSpawned(previous, current hll.DetailedPlayerInfo) bool {
	if previous.ID != current.ID {
		return false
	}

	// Classic detection: player went from dead (0,0,0) to alive
	if !previous.IsSpawned() && current.IsSpawned() {
		return true
	}

	// Fast respawn detection: death count increased and position jumped significantly
	// This catches cases where the player died and respawned between two polls
	if current.Deaths > previous.Deaths && current.IsSpawned() && previous.IsSpawned() {
		distance := float64(current.PlanarDistanceTo(previous.Position))
		// A large position jump (>50m) with increased deaths = respawn
		if distance > 5000 {
			return true
		}
	}

	return false
}

// handlePlayerSpawn processes a player spawn event
func (st *SpawnTracker) handlePlayerSpawn(ctx context.Context, player hll.DetailedPlayerInfo, matchID int64) {
	st.log.Debug("Spawn detected",
		"player", player.Name,
		"position", fmt.Sprintf("(%.1f,%.1f,%.1f)", player.Position.X, player.Position.Y, player.Position.Z),
		"team", player.Team,
		"unit", player.Unit.Name)

	// Check if this is an HQ spawn first
	if st.isAtMapEdge(player.Position.X, player.Position.Y) {
		st.handleHQSpawn(ctx, player, matchID)
		return
	}

	// Try to match to existing same-team spawn point (but never merge outpost with garrison)
	index, matched := st.findMatchingSpawn(player, matchID)

	if matched {
		st.updateSpawnPoint(index, player)
	} else {
		st.addNewSpawnPoint(player, matchID)
	}

	// Reclassify all spawns based on updated usage patterns
	st.classifySpawns(matchID)

	if err := st.logSpawnEvent(ctx, player, matchID); err != nil {
		st.log.Error("Failed to log spawn event", "error", err, "player", player.Name)
	}
}

// handleHQSpawn handles a spawn at the map edge (HQ)
func (st *SpawnTracker) handleHQSpawn(ctx context.Context, player hll.DetailedPlayerInfo, matchID int64) {
	// Find existing HQ spawn for this team nearby
	st.spawnsMu.Lock()
	found := false
	for i := range st.spawns {
		spawn := &st.spawns[i]
		if spawn.MatchID != matchID || spawn.Team != player.Team || spawn.SpawnType != SpawnTypeHQ {
			continue
		}
		distance := float64(player.PlanarDistanceTo(spawn.Position))
		if distance <= 5000 { // HQ spawns cluster within 50m
			spawn.LastSeen = time.Now()
			spawn.SpawnCount++
			if spawn.UsedBy == nil {
				spawn.UsedBy = make(map[string]bool)
			}
			spawn.UsedBy[player.Unit.Name] = true
			found = true
			break
		}
	}
	if !found {
		usedBy := make(map[string]bool)
		usedBy[player.Unit.Name] = true
		st.spawns = append(st.spawns, SpawnPoint{
			Position:   player.Position,
			Team:       player.Team,
			SpawnType:  SpawnTypeHQ,
			LastSeen:   time.Now(),
			SpawnCount: 1,
			Unit:       player.Unit.Name,
			UsedBy:     usedBy,
			MatchID:    matchID,
			Confidence: 1.0,
		})
	}
	st.spawnsMu.Unlock()

	if err := st.logSpawnEvent(ctx, player, matchID); err != nil {
		st.log.Error("Failed to log HQ spawn event", "error", err, "player", player.Name)
	}
}

// findMatchingSpawn finds an existing spawn point that this player likely spawned at.
// Priority: prefer same-unit match (outpost), then closest any same-team match (garrison).
// When a different unit matches a spawn, classifySpawns will reclassify it as garrison.
func (st *SpawnTracker) findMatchingSpawn(player hll.DetailedPlayerInfo, matchID int64) (int, bool) {
	st.spawnsMu.RLock()
	defer st.spawnsMu.RUnlock()

	sameUnitIndex := -1
	sameUnitDist := SPAWN_CLUSTERING_DISTANCE + 1.0
	anyTeamIndex := -1
	anyTeamDist := SPAWN_CLUSTERING_DISTANCE + 1.0

	for i, spawn := range st.spawns {
		if spawn.MatchID != matchID || spawn.Team != player.Team {
			continue
		}
		if spawn.SpawnType == SpawnTypeHQ {
			continue
		}

		distance := float64(player.PlanarDistanceTo(spawn.Position))
		if distance > SPAWN_CLUSTERING_DISTANCE {
			continue
		}

		// Track best same-unit match (could be outpost or garrison)
		if spawn.Unit == player.Unit.Name || spawn.UsedBy[player.Unit.Name] {
			if distance < sameUnitDist {
				sameUnitDist = distance
				sameUnitIndex = i
			}
		}

		// Track closest any same-team match (allows detecting garrisons
		// when a different unit spawns near an existing spawn point)
		if distance < anyTeamDist {
			anyTeamDist = distance
			anyTeamIndex = i
		}
	}

	// Prefer same-unit match (keeps outpost clustering tight)
	if sameUnitIndex >= 0 {
		return sameUnitIndex, true
	}
	// Fall back to any same-team match — classifySpawns will reclassify as garrison
	if anyTeamIndex >= 0 {
		return anyTeamIndex, true
	}
	return -1, false
}

// updateSpawnPoint updates an existing spawn point with new spawn data
func (st *SpawnTracker) updateSpawnPoint(index int, player hll.DetailedPlayerInfo) {
	st.spawnsMu.Lock()
	defer st.spawnsMu.Unlock()

	spawn := &st.spawns[index]
	spawn.LastSeen = time.Now()
	spawn.SpawnCount++

	// Average the position to reduce jitter
	count := float64(spawn.SpawnCount)
	spawn.Position.X = (spawn.Position.X*(count-1) + player.Position.X) / count
	spawn.Position.Y = (spawn.Position.Y*(count-1) + player.Position.Y) / count
	spawn.Position.Z = (spawn.Position.Z*(count-1) + player.Position.Z) / count

	// Track which units have used this spawn
	if spawn.UsedBy == nil {
		spawn.UsedBy = make(map[string]bool)
	}
	spawn.UsedBy[player.Unit.Name] = true
}

// addNewSpawnPoint creates a new spawn point
func (st *SpawnTracker) addNewSpawnPoint(player hll.DetailedPlayerInfo, matchID int64) {
	st.spawnsMu.Lock()
	defer st.spawnsMu.Unlock()

	usedBy := make(map[string]bool)
	usedBy[player.Unit.Name] = true

	st.spawns = append(st.spawns, SpawnPoint{
		Position:   player.Position,
		Team:       player.Team,
		SpawnType:  SpawnTypeNone, // Will be classified in classifySpawns
		LastSeen:   time.Now(),
		SpawnCount: 1,
		Unit:       player.Unit.Name,
		UsedBy:     usedBy,
		MatchID:    matchID,
		Confidence: 0.5,
	})
}

// classifySpawns classifies spawn points and enforces per-unit outpost rules.
// Each unit can have exactly 1 outpost — if a new outpost is detected for a unit,
// the old one is removed.
func (st *SpawnTracker) classifySpawns(matchID int64) {
	st.spawnsMu.Lock()
	defer st.spawnsMu.Unlock()

	// First pass: classify based on usage patterns
	for i := range st.spawns {
		spawn := &st.spawns[i]
		if spawn.MatchID != matchID || spawn.SpawnType == SpawnTypeHQ {
			continue
		}

		if len(spawn.UsedBy) > 1 {
			// Multiple units spawning here = Garrison
			spawn.SpawnType = SpawnTypeGarrison
			spawn.Confidence = math.Min(0.7+float64(len(spawn.UsedBy))*0.1, 1.0)
		} else {
			// Single unit spawning here = Outpost (or garrison used by only 1 unit so far)
			spawn.SpawnType = SpawnTypeOutpost
			// Low confidence until we see more spawns — could be a garrison
			spawn.Confidence = math.Min(0.4+float64(spawn.SpawnCount)*0.1, 0.8)
		}
	}

	// Second pass: enforce garrison rules
	// - Only 1 garrison within 200m (20000 units) of another on the same team;
	//   if a newer one exists, the older one was likely destroyed
	// - Max 8 garrisons per team
	const garrisonProximity = 20000.0 // 200m
	const maxGarrisonsPerTeam = 8

	removeSet := make(map[int]bool)

	// Garrison proximity: if two same-team garrisons are within 200m, remove the older one
	for i := range st.spawns {
		if st.spawns[i].MatchID != matchID || st.spawns[i].SpawnType != SpawnTypeGarrison {
			continue
		}
		if removeSet[i] {
			continue
		}
		for j := i + 1; j < len(st.spawns); j++ {
			if st.spawns[j].MatchID != matchID || st.spawns[j].SpawnType != SpawnTypeGarrison {
				continue
			}
			if st.spawns[j].Team != st.spawns[i].Team || removeSet[j] {
				continue
			}
			dist := float64(math.Sqrt(
				(st.spawns[i].Position.X-st.spawns[j].Position.X)*(st.spawns[i].Position.X-st.spawns[j].Position.X) +
					(st.spawns[i].Position.Y-st.spawns[j].Position.Y)*(st.spawns[i].Position.Y-st.spawns[j].Position.Y)))
			if dist <= garrisonProximity {
				// Remove the older garrison
				if st.spawns[i].LastSeen.Before(st.spawns[j].LastSeen) {
					st.log.Debug("Garrison proximity removal",
						"team", st.spawns[i].Team,
						"removed_pos", fmt.Sprintf("(%.0f,%.0f)", st.spawns[i].Position.X, st.spawns[i].Position.Y),
						"kept_pos", fmt.Sprintf("(%.0f,%.0f)", st.spawns[j].Position.X, st.spawns[j].Position.Y))
					removeSet[i] = true
					break
				} else {
					st.log.Debug("Garrison proximity removal",
						"team", st.spawns[j].Team,
						"removed_pos", fmt.Sprintf("(%.0f,%.0f)", st.spawns[j].Position.X, st.spawns[j].Position.Y),
						"kept_pos", fmt.Sprintf("(%.0f,%.0f)", st.spawns[i].Position.X, st.spawns[i].Position.Y))
					removeSet[j] = true
				}
			}
		}
	}

	// Garrison cap: max 8 per team, keep most recently seen
	type teamKey string
	teamGarrisons := make(map[teamKey][]int) // team -> list of garrison indices
	for i := range st.spawns {
		if st.spawns[i].MatchID != matchID || st.spawns[i].SpawnType != SpawnTypeGarrison || removeSet[i] {
			continue
		}
		tk := teamKey(st.spawns[i].Team)
		teamGarrisons[tk] = append(teamGarrisons[tk], i)
	}
	for _, indices := range teamGarrisons {
		if len(indices) <= maxGarrisonsPerTeam {
			continue
		}
		// Sort by LastSeen descending (keep most recent), remove oldest
		// Simple selection: find and remove oldest until within cap
		for len(indices) > maxGarrisonsPerTeam {
			oldestIdx := 0
			for k := 1; k < len(indices); k++ {
				if st.spawns[indices[k]].LastSeen.Before(st.spawns[indices[oldestIdx]].LastSeen) {
					oldestIdx = k
				}
			}
			removeSet[indices[oldestIdx]] = true
			indices = append(indices[:oldestIdx], indices[oldestIdx+1:]...)
		}
	}

	// Third pass: enforce 1 outpost per unit per team
	type teamUnit struct {
		team string
		unit string
	}
	latestOutpost := make(map[teamUnit]int) // team+unit -> index of latest outpost

	for i := range st.spawns {
		spawn := &st.spawns[i]
		if spawn.MatchID != matchID || spawn.SpawnType != SpawnTypeOutpost || removeSet[i] {
			continue
		}

		key := teamUnit{team: string(spawn.Team), unit: spawn.Unit}
		if existing, ok := latestOutpost[key]; ok {
			if st.spawns[i].LastSeen.After(st.spawns[existing].LastSeen) {
				st.log.Debug("Outpost replaced",
					"unit", spawn.Unit,
					"old_pos", fmt.Sprintf("(%.0f,%.0f)", st.spawns[existing].Position.X, st.spawns[existing].Position.Y),
					"new_pos", fmt.Sprintf("(%.0f,%.0f)", spawn.Position.X, spawn.Position.Y))
				removeSet[existing] = true
				latestOutpost[key] = i
			} else {
				removeSet[i] = true
			}
		} else {
			latestOutpost[key] = i
		}
	}

	// Build filtered list
	active := make([]SpawnPoint, 0, len(st.spawns))
	for i, spawn := range st.spawns {
		if !removeSet[i] {
			active = append(active, spawn)
		}
	}
	st.spawns = active
}

// cleanExpiredSpawns removes spawns that have exceeded their TTL
func (st *SpawnTracker) cleanExpiredSpawns() {
	st.spawnsMu.Lock()
	defer st.spawnsMu.Unlock()

	active := []SpawnPoint{}
	for _, spawn := range st.spawns {
		ttl, ok := spawnTTL[spawn.SpawnType]
		if !ok {
			ttl = 2 * time.Minute
		}
		if time.Since(spawn.LastSeen) < ttl {
			active = append(active, spawn)
		} else {
			st.log.Debug("Spawn expired",
				"type", spawn.SpawnType,
				"team", spawn.Team,
				"unit", spawn.Unit,
				"age", time.Since(spawn.LastSeen).Round(time.Second))
		}
	}
	st.spawns = active
	st.lastCleanup = time.Now()
}

// isAtMapEdge checks if position is at map edges (likely HQ)
// HLL maps have bounds of -100000 to +100000
func (st *SpawnTracker) isAtMapEdge(x, y float64) bool {
	const mapMin = -100000.0
	const mapMax = 100000.0

	return x < (mapMin+HQ_EDGE_THRESHOLD) || x > (mapMax-HQ_EDGE_THRESHOLD) ||
		y < (mapMin+HQ_EDGE_THRESHOLD) || y > (mapMax-HQ_EDGE_THRESHOLD)
}

// logSpawnEvent logs a spawn event to the database and broadcasts via WebSocket
func (st *SpawnTracker) logSpawnEvent(ctx context.Context, player hll.DetailedPlayerInfo, matchID int64) error {
	// Find the nearest same-team spawn for this match to get classification
	st.spawnsMu.RLock()
	var associatedSpawn *SpawnPoint
	var minDistance float64 = SPAWN_CLUSTERING_DISTANCE*2 + 1
	for i := range st.spawns {
		spawn := &st.spawns[i]
		if spawn.MatchID != matchID || spawn.Team != player.Team {
			continue
		}
		distance := float64(player.PlanarDistanceTo(spawn.Position))
		if distance < minDistance {
			minDistance = distance
			associatedSpawn = spawn
		}
	}
	st.spawnsMu.RUnlock()

	spawnType := string(SpawnTypeNone)
	teamName := GetTeamName(player.Team)
	confidence := 0.5

	if associatedSpawn != nil {
		spawnType = string(associatedSpawn.SpawnType)
		confidence = associatedSpawn.Confidence
	}

	event := database.MatchEvent{
		MatchID:     matchID,
		EventType:   "spawn",
		Message:     fmt.Sprintf("%s spawned at %s", player.Name, spawnType),
		PlayerIDs:   fmt.Sprintf(`["%s"]`, player.ID),
		PlayerNames: fmt.Sprintf(`["%s"]`, player.Name),
		PositionX:   &player.Position.X,
		PositionY:   &player.Position.Y,
		PositionZ:   &player.Position.Z,
		Timestamp:   time.Now(),
	}

	event.SpawnType = &spawnType
	event.SpawnTeam = &teamName
	event.SpawnUnit = &player.Unit.Name
	event.Details = fmt.Sprintf(`{"confidence":%.2f}`, confidence)

	if err := st.db.InsertMatchEvent(ctx, event); err != nil {
		return err
	}

	if st.webServer != nil {
		st.webServer.BroadcastMatchEvent(event, st.serverID)
	}

	return nil
}

// GetSpawnPositions returns all spawn positions for a match (backward compatibility)
func (st *SpawnTracker) GetSpawnPositions(matchID int64) []*SpawnPosition {
	st.spawnsMu.RLock()
	defer st.spawnsMu.RUnlock()

	var spawns []*SpawnPosition
	for _, spawn := range st.spawns {
		if spawn.MatchID == matchID {
			spawnPos := &SpawnPosition{
				Team:       GetTeamName(spawn.Team),
				Unit:       spawn.Unit,
				X:          spawn.Position.X,
				Y:          spawn.Position.Y,
				Z:          spawn.Position.Z,
				SpawnType:  string(spawn.SpawnType),
				Timestamp:  spawn.LastSeen,
				MatchID:    spawn.MatchID,
				Confidence: spawn.Confidence,
			}
			spawns = append(spawns, spawnPos)
		}
	}

	return spawns
}

// GetSpawns returns all spawn points
func (st *SpawnTracker) GetSpawns() []SpawnPoint {
	st.spawnsMu.RLock()
	defer st.spawnsMu.RUnlock()
	return st.spawns
}

// MapSpawnDirection indicates which side allies spawn on
type MapSpawnDirection string

const (
	SpawnLeft   MapSpawnDirection = "left"
	SpawnRight  MapSpawnDirection = "right"
	SpawnTop    MapSpawnDirection = "top"
	SpawnBottom MapSpawnDirection = "bottom"
)

// mapSpawnDirections maps HLL map names to allies spawn side.
// The play axis runs from allies spawn to axis spawn.
// Sectors are sliced perpendicular to this axis.
var mapSpawnDirections = map[string]MapSpawnDirection{
	"carentan":       SpawnLeft,
	"driel":          SpawnBottom,
	"elalamein":      SpawnRight,
	"elsenbornridge": SpawnTop,
	"foy":            SpawnBottom,
	"hill400":        SpawnLeft,
	"hurtgenforest":  SpawnLeft,
	"kharkov":        SpawnTop,
	"kursk":          SpawnTop,
	"mortain":        SpawnLeft,
	"omahabeach":     SpawnRight,
	"purpleheartlane": SpawnTop,
	"remagen":        SpawnBottom,
	"stalingrad":     SpawnLeft,
	"smolensk":       SpawnRight,
	"stmariedumont":  SpawnTop,
	"stmereeglise":   SpawnRight,
	"tobruk":         SpawnRight,
	"utahbeach":      SpawnRight,
}

// getMapSpawnDir returns the allies spawn direction for a map, stripping time-of-day suffixes
func getMapSpawnDir(mapName string) (MapSpawnDirection, bool) {
	lower := strings.ToLower(mapName)
	// Strip time-of-day suffixes (night, dawn, dusk, day)
	for _, suffix := range []string{"night", "dawn", "dusk", "day"} {
		lower = strings.TrimSuffix(lower, suffix)
	}
	lower = strings.TrimSpace(lower)
	dir, ok := mapSpawnDirections[lower]
	return dir, ok
}

// OnSectorCaptured removes enemy garrisons and outposts from the captured sector.
// HLL maps: 5 sectors along the play axis, each 40000 units (2 grid squares) wide.
// Score represents how many sectors each team holds (starting 2-2 with neutral middle).
// When a team captures a sector, all enemy spawns inside that sector are destroyed.
func (st *SpawnTracker) OnSectorCaptured(matchID int64, mapName string, oldAllies, oldAxis, newAllies, newAxis int) {
	dir, ok := getMapSpawnDir(mapName)
	if !ok {
		st.log.Warn("Unknown map for sector capture, skipping spawn removal", "map", mapName)
		return
	}

	// Determine which team captured and which sector index (0-4 from allies side)
	// Allies captured: newAllies > oldAllies → captured sector index = oldAllies (0-based from allies side)
	// Axis captured: newAxis > oldAxis → captured sector index = (4 - oldAxis) from allies side
	var capturedSector int
	var losingTeam hll.Team

	if newAllies > oldAllies {
		// Allies captured a sector from axis
		capturedSector = oldAllies // sector index from allies side
		losingTeam = hll.TmAxis
	} else if newAxis > oldAxis {
		// Axis captured a sector from allies
		capturedSector = 4 - oldAxis // sector index from allies side
		losingTeam = hll.TmAllies
	} else {
		return // no capture occurred
	}

	// Calculate sector bounds in game coordinates
	// Map range: -100000 to 100000, 5 sectors of 40000 each
	const mapMin = -100000.0
	const sectorWidth = 40000.0

	var sectorMinPrimary, sectorMaxPrimary float64

	// The play axis goes from allies spawn side to axis spawn side.
	// "Primary" coordinate is along the play axis.
	// For left/right: primary = X. For top/bottom: primary = Y.
	// Allies spawn at the low or high end depending on direction.
	switch dir {
	case SpawnLeft:
		// Allies at left (low X), axis at right (high X). Sectors go left→right.
		sectorMinPrimary = mapMin + float64(capturedSector)*sectorWidth
		sectorMaxPrimary = sectorMinPrimary + sectorWidth
	case SpawnRight:
		// Allies at right (high X), axis at left (low X). Sectors go right→left.
		// Sector 0 (allies HQ) is at max X, sector 4 (axis HQ) is at min X.
		sectorMaxPrimary = -mapMin - float64(capturedSector)*sectorWidth
		sectorMinPrimary = sectorMaxPrimary - sectorWidth
	case SpawnTop:
		// Allies at top (low Y in game = top of map), axis at bottom (high Y).
		// Sector 0 (allies) at low Y, sector 4 (axis) at high Y.
		sectorMinPrimary = mapMin + float64(capturedSector)*sectorWidth
		sectorMaxPrimary = sectorMinPrimary + sectorWidth
	case SpawnBottom:
		// Allies at bottom (high Y), axis at top (low Y).
		// Sector 0 (allies) at high Y, sector 4 (axis) at low Y.
		sectorMaxPrimary = -mapMin - float64(capturedSector)*sectorWidth
		sectorMinPrimary = sectorMaxPrimary - sectorWidth
	}

	isHorizontal := dir == SpawnLeft || dir == SpawnRight

	st.spawnsMu.Lock()
	defer st.spawnsMu.Unlock()

	active := make([]SpawnPoint, 0, len(st.spawns))
	for _, spawn := range st.spawns {
		if spawn.MatchID != matchID || spawn.Team != losingTeam || spawn.SpawnType == SpawnTypeHQ {
			active = append(active, spawn)
			continue
		}

		// Check if spawn is within the captured sector
		var primaryCoord float64
		if isHorizontal {
			primaryCoord = spawn.Position.X
		} else {
			primaryCoord = spawn.Position.Y
		}

		if primaryCoord >= sectorMinPrimary && primaryCoord < sectorMaxPrimary {
			st.log.Info("Spawn destroyed by sector capture",
				"type", spawn.SpawnType,
				"team", spawn.Team,
				"unit", spawn.Unit,
				"sector", capturedSector,
				"pos", fmt.Sprintf("(%.0f,%.0f)", spawn.Position.X, spawn.Position.Y))
			continue // remove this spawn
		}

		active = append(active, spawn)
	}
	st.spawns = active
}

// ResetSpawns clears all spawn points (for match reset)
func (st *SpawnTracker) ResetSpawns() {
	st.spawnsMu.Lock()
	defer st.spawnsMu.Unlock()
	st.spawns = []SpawnPoint{}
	st.unitOutpost = make(map[string]map[string]int)
}

// CleanupPlayerStates removes disconnected players from tracking
func (st *SpawnTracker) CleanupPlayerStates(activePlayerIDs []string) {
	st.playersMu.Lock()
	defer st.playersMu.Unlock()

	activeSet := make(map[string]bool)
	for _, id := range activePlayerIDs {
		activeSet[id] = true
	}

	for playerID := range st.players {
		if !activeSet[playerID] {
			delete(st.players, playerID)
		}
	}
}
