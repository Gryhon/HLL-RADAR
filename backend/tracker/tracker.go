package tracker

import (
	"context"
	"fmt"
	"hll-radar/database"
	"hll-radar/webserver"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/spf13/viper"
	"github.com/zMoooooritz/go-let-loose/pkg/hll"
	"github.com/zMoooooritz/go-let-loose/pkg/rcon"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var (
	caser = cases.Title(language.AmericanEnglish)
)

type PlayerTracker struct {
	enabled          bool
	serverID         int64
	log              *slog.Logger
	rcon             *rcon.Rcon
	db               *database.Database
	webServer        *webserver.WebServer
	matchManager     *MatchManager
	positionRecorder *PositionRecorder
	spawnTracker     *SpawnTracker
	lastPlayerCount  int
	lastPlayerCheck  time.Time
	lastPlayerData   map[string]*hll.DetailedPlayerInfo
	playerDataMu     sync.RWMutex
	activePlayers    map[string]bool // Track which players are currently connected (keyed by player ID)
	activePlayersMu  sync.RWMutex
}

func NewPlayerTracker(enabled bool, logger *slog.Logger, rconClient *rcon.Rcon, db *database.Database, webServer *webserver.WebServer, serverID int64) *PlayerTracker {
	if logger == nil {
		return nil
	}

	pt := &PlayerTracker{
		enabled:          enabled,
		serverID:         serverID,
		log:              logger,
		rcon:             rconClient,
		db:               db,
		webServer:        webServer,
		matchManager:     NewMatchManager(db, logger, webServer, serverID),
		positionRecorder: NewPositionRecorder(db, logger),
		spawnTracker:     NewSpawnTracker(db, logger, webServer, serverID),
		lastPlayerData:   make(map[string]*hll.DetailedPlayerInfo),
		activePlayers:    make(map[string]bool),
	}

	// Register event handlers directly with RCON client
	if rconClient != nil {
		pt.registerEventHandlers()
	}

	return pt
}

// handleEvent inserts a match event into the database and broadcasts it via WebSocket.
func (pt *PlayerTracker) handleEvent(ctx context.Context, event database.MatchEvent) {
	if err := pt.db.InsertMatchEvent(ctx, event); err != nil {
		pt.log.Error("Failed to log event", "type", event.EventType, "error", err)
	} else if pt.webServer != nil {
		pt.webServer.BroadcastMatchEvent(event, pt.serverID)
	}
}

// registerEventHandlers registers event handlers directly with the RCON events system
func (pt *PlayerTracker) registerEventHandlers() {
	ctx := context.Background()

	// Match start events
	pt.rcon.OnMatchStart(func(event hll.MatchStartEvent) {
		pt.log.Info("Match start event received",
			"map", event.Map.Name,
			"map_id", event.Map.ID,
			"timestamp", event.Time().Format(time.RFC3339))
		// Reset spawn tracker for new match
		pt.spawnTracker.ResetSpawns()
		if err := pt.matchManager.StartMatch(context.Background(), string(event.Map.ID), event.Time()); err != nil {
			pt.log.Error("Failed to start match from server event",
				"error", err,
				"map", event.Map.Name,
				"map_id", event.Map.ID)
		}
	})

	// Match end events
	pt.rcon.OnMatchEnd(func(event hll.MatchEndEvent) {
		pt.log.Info("Match end event received",
			"map", event.Map.Name,
			"timestamp", event.Time().Format(time.RFC3339))
		if err := pt.matchManager.EndMatch(context.Background(), event.Time()); err != nil {
			pt.log.Error("Failed to end match from server event", "error", err)
		}
	})

	// Kill events
	pt.rcon.OnKill(func(event hll.KillEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		matchEvent := database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "kill",
			Message:     fmt.Sprintf("%s killed %s with %s", event.Killer.Name, event.Victim.Name, event.Weapon.Name),
			PlayerIDs:   fmt.Sprintf(`["%s","%s"]`, event.Killer.ID, event.Victim.ID),
			PlayerNames: fmt.Sprintf(`["%s","%s"]`, event.Killer.Name, event.Victim.Name),
			Details:     string(event.Weapon.ID),
			Timestamp:   event.Time(),
		}
		if killerInfo := pt.getPlayerInfo(event.Killer.ID); killerInfo != nil {
			matchEvent.PositionX = &killerInfo.Position.X
			matchEvent.PositionY = &killerInfo.Position.Y
			matchEvent.PositionZ = &killerInfo.Position.Z
		}
		if victimInfo := pt.getPlayerInfo(event.Victim.ID); victimInfo != nil {
			matchEvent.VictimX = &victimInfo.Position.X
			matchEvent.VictimY = &victimInfo.Position.Y
			matchEvent.VictimZ = &victimInfo.Position.Z
		}
		pt.handleEvent(ctx, matchEvent)
	})

	// Death events
	pt.rcon.OnDeath(func(event hll.DeathEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "death",
			Message:     fmt.Sprintf("%s was killed by %s with %s", event.Victim.Name, event.Killer.Name, event.Weapon.Name),
			PlayerIDs:   fmt.Sprintf(`["%s","%s"]`, event.Victim.ID, event.Killer.ID),
			PlayerNames: fmt.Sprintf(`["%s","%s"]`, event.Victim.Name, event.Killer.Name),
			Details:     string(event.Weapon.ID),
			Timestamp:   event.Time(),
		})
	})

	// Team kill events
	pt.rcon.OnTeamKill(func(event hll.TeamKillEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		matchEvent := database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "teamkill",
			Message:     fmt.Sprintf("%s team killed %s with %s", event.Killer.Name, event.Victim.Name, event.Weapon.Name),
			PlayerIDs:   fmt.Sprintf(`["%s","%s"]`, event.Killer.ID, event.Victim.ID),
			PlayerNames: fmt.Sprintf(`["%s","%s"]`, event.Killer.Name, event.Victim.Name),
			Details:     string(event.Weapon.ID),
			Timestamp:   event.Time(),
		}
		if killerInfo := pt.getPlayerInfo(event.Killer.ID); killerInfo != nil {
			matchEvent.PositionX = &killerInfo.Position.X
			matchEvent.PositionY = &killerInfo.Position.Y
			matchEvent.PositionZ = &killerInfo.Position.Z
		}
		if victimInfo := pt.getPlayerInfo(event.Victim.ID); victimInfo != nil {
			matchEvent.VictimX = &victimInfo.Position.X
			matchEvent.VictimY = &victimInfo.Position.Y
			matchEvent.VictimZ = &victimInfo.Position.Z
		}
		pt.handleEvent(ctx, matchEvent)
	})

	// Team death events
	pt.rcon.OnTeamDeath(func(event hll.TeamDeathEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "teamdeath",
			Message:     fmt.Sprintf("%s was team killed by %s with %s", event.Victim.Name, event.Killer.Name, event.Weapon.Name),
			PlayerIDs:   fmt.Sprintf(`["%s","%s"]`, event.Victim.ID, event.Killer.ID),
			PlayerNames: fmt.Sprintf(`["%s","%s"]`, event.Victim.Name, event.Killer.Name),
			Details:     string(event.Weapon.ID),
			Timestamp:   event.Time(),
		})
	})

	// Chat events
	pt.rcon.OnChat(func(event hll.ChatEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "chat",
			Message:     fmt.Sprintf("[%s] %s: %s", event.Scope, event.Player.Name, event.Message),
			PlayerIDs:   fmt.Sprintf(`["%s"]`, event.Player.ID),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"team":"%s","scope":"%s"}`, event.Team, event.Scope),
			Timestamp:   event.Time(),
		})
	})

	// Ban events
	pt.rcon.OnBan(func(event hll.BanEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "ban",
			Message:     fmt.Sprintf("%s was banned - Reason: %s", event.Player.Name, event.Reason),
			PlayerIDs:   fmt.Sprintf(`["%s"]`, event.Player.ID),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"reason":"%s"}`, event.Reason),
			Timestamp:   event.Time(),
		})
	})

	// Kick events
	pt.rcon.OnKick(func(event hll.KickEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "kick",
			Message:     fmt.Sprintf("%s was kicked - Reason: %s", event.Player.Name, event.Reason),
			PlayerIDs:   fmt.Sprintf(`["%s"]`, event.Player.ID),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"reason":"%s"}`, event.Reason),
			Timestamp:   event.Time(),
		})
	})

	// Message events
	pt.rcon.OnMessage(func(event hll.MessageEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "message",
			Message:     fmt.Sprintf("%s: %s", event.Player.Name, event.Message),
			PlayerIDs:   fmt.Sprintf(`["%s"]`, event.Player.ID),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Timestamp:   event.Time(),
		})
	})

	// Vote submitted
	pt.rcon.OnVoteSubmitted(func(event hll.VoteSubmittedEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "vote_submitted",
			Message:     fmt.Sprintf("%s voted %s", event.Submitter.Name, event.Vote),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Submitter.Name),
			Details:     fmt.Sprintf(`{"vote":"%s","vote_id":%d}`, event.Vote, event.ID),
			Timestamp:   event.Time(),
		})
	})

	// Clan tag changed events
	pt.rcon.OnClanTagChanged(func(event hll.PlayerClanTagChangedEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "clan_tag_changed",
			Message:     fmt.Sprintf("%s changed clan tag from [%s] to [%s]", event.Player.Name, event.OldClanTag, event.NewClanTag),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"old_tag":"%s","new_tag":"%s"}`, event.OldClanTag, event.NewClanTag),
			Timestamp:   event.Time(),
		})
	})

	// Connect events
	pt.rcon.OnConnected(func(event hll.ConnectEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "player_connect",
			Message:     fmt.Sprintf("%s connected", event.Player.Name),
			PlayerIDs:   fmt.Sprintf(`["%s"]`, event.Player.ID),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Timestamp:   event.Time(),
		})
	})

	// Disconnect events
	pt.rcon.OnDisconnected(func(event hll.DisconnectEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "player_disconnect",
			Message:     fmt.Sprintf("%s disconnected", event.Player.Name),
			PlayerIDs:   fmt.Sprintf(`["%s"]`, event.Player.ID),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Timestamp:   event.Time(),
		})
	})

	// Admin cam enter
	pt.rcon.OnEnterAdminCam(func(event hll.AdminCamEnteredEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "admin_cam_enter",
			Message:     fmt.Sprintf("%s entered admin camera", event.Player.Name),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Timestamp:   event.Time(),
		})
	})

	// Admin cam leave
	pt.rcon.OnLeaveAdminCam(func(event hll.AdminCamLeftEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "admin_cam_leave",
			Message:     fmt.Sprintf("%s left admin camera", event.Player.Name),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Timestamp:   event.Time(),
		})
	})

	// Vote kick started
	pt.rcon.OnVoteKickStarted(func(event hll.VoteStartedEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "vote_started",
			Message:     fmt.Sprintf("%s started a vote to kick %s - Reason: %s", event.Initiator.Name, event.Target.Name, event.Reason),
			PlayerNames: fmt.Sprintf(`["%s","%s"]`, event.Initiator.Name, event.Target.Name),
			Details:     fmt.Sprintf(`{"reason":"%s","vote_id":%d}`, event.Reason, event.ID),
			Timestamp:   event.Time(),
		})
	})

	// Vote kick completed
	pt.rcon.OnVoteKickCompleted(func(event hll.VoteCompletedEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "vote_completed",
			Message:     fmt.Sprintf("Vote to kick %s %s", event.Target.Name, event.Result),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Target.Name),
			Details:     fmt.Sprintf(`{"result":"%s","reason":"%s","vote_id":%d}`, event.Result, event.Reason, event.ID),
			Timestamp:   event.Time(),
		})
	})

	// Team switched
	pt.rcon.OnTeamSwitched(func(event hll.PlayerSwitchTeamEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "team_switch",
			Message:     fmt.Sprintf("%s switched from %s to %s", event.Player.Name, event.OldTeam, event.NewTeam),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"old_team":"%s","new_team":"%s"}`, event.OldTeam, event.NewTeam),
			Timestamp:   event.Time(),
		})
	})

	// Squad switched
	pt.rcon.OnSquadSwitched(func(event hll.PlayerSwitchSquadEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "squad_switch",
			Message:     fmt.Sprintf("%s switched from %s to %s", event.Player.Name, event.OldSquad.Name, event.NewSquad.Name),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"old_squad":"%s","new_squad":"%s"}`, event.OldSquad.Name, event.NewSquad.Name),
			Timestamp:   event.Time(),
		})
	})

	// Role changed
	pt.rcon.OnRoleChanged(func(event hll.PlayerChangeRoleEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "role_change",
			Message:     fmt.Sprintf("%s changed role from %s to %s", event.Player.Name, event.OldRole, event.NewRole),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"old_role":"%s","new_role":"%s"}`, event.OldRole, event.NewRole),
			Timestamp:   event.Time(),
		})
	})

	// Loadout changed
	pt.rcon.OnLoadoutChanged(func(event hll.PlayerChangeLoadoutEvent) {
		if pt.matchManager.GetCurrentMatch() == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:     pt.matchManager.GetCurrentMatch().ID,
			EventType:   "loadout_change",
			Message:     fmt.Sprintf("%s changed loadout from %s to %s", event.Player.Name, event.OldLoadout, event.NewLoadout),
			PlayerNames: fmt.Sprintf(`["%s"]`, event.Player.Name),
			Details:     fmt.Sprintf(`{"old_loadout":"%s","new_loadout":"%s"}`, event.OldLoadout, event.NewLoadout),
			Timestamp:   event.Time(),
		})
	})

	// Objective captured
	pt.rcon.OnObjectiveCapped(func(event hll.ObjectiveCaptureEvent) {
		match := pt.matchManager.GetCurrentMatch()
		if match == nil {
			return
		}
		pt.handleEvent(ctx, database.MatchEvent{
			MatchID:   match.ID,
			EventType: "objective_captured",
			Message:   fmt.Sprintf("Objective captured - Score changed from Allies:%d Axis:%d to Allies:%d Axis:%d", event.OldScore.Allies, event.OldScore.Axis, event.NewScore.Allies, event.NewScore.Axis),
			Details:   fmt.Sprintf(`{"old_score_allies":%d,"old_score_axis":%d,"new_score_allies":%d,"new_score_axis":%d}`, event.OldScore.Allies, event.OldScore.Axis, event.NewScore.Allies, event.NewScore.Axis),
			Timestamp: event.Time(),
		})

		// Remove enemy spawns in the captured sector
		pt.spawnTracker.OnSectorCaptured(
			match.ID, match.MapName,
			event.OldScore.Allies, event.OldScore.Axis,
			event.NewScore.Allies, event.NewScore.Axis,
		)
	})

	pt.log.Info("Event handlers registered with RCON",
		"version", "v0.6.2",
		"event_types", "22",
		"events", "match, kill, death, teamkill, teamdeath, chat, ban, kick, message, vote_start, vote_submit, vote_complete, clantag, connect, disconnect, admin_cam, team_switch, squad_switch, role_change, loadout_change, objective_captured")
}

func (pt *PlayerTracker) Start(ctx context.Context) error {
	if !pt.enabled {
		pt.log.Info("Player tracker is disabled, skipping")
		return nil
	}

	pt.log.Info("🚀 Starting player tracker module", "server_id", pt.serverID)

	// Try to detect and resume/create match on startup
	if err := pt.matchManager.DetectAndResumeOrCreateMatch(ctx, pt.rcon); err != nil {
		pt.log.Warn("Failed to detect/resume match on startup, will wait for MATCH START event", "error", err)
		// Don't return error - continue and wait for MATCH START event
	}

	// Get tracking interval from config, default to 5 seconds
	trackingInterval := time.Duration(viper.GetInt("tracker.check_interval_seconds")) * time.Second
	if trackingInterval == 0 {
		trackingInterval = 5 * time.Second
	}

	pt.log.Info("⏱️  Player tracker interval configured",
		"interval", trackingInterval,
		"interval_seconds", trackingInterval.Seconds())

	ticker := time.NewTicker(trackingInterval)
	defer ticker.Stop()

	// Start cleanup routine for old positions
	cleanupTicker := time.NewTicker(10 * time.Minute)
	defer cleanupTicker.Stop()

	// Initial check
	pt.log.Debug("Performing initial player tracking check")
	if err := pt.trackPlayers(ctx); err != nil {
		pt.log.Error("Initial player tracking failed", "error", err)
	}

	for {
		select {
		case <-ctx.Done():
			pt.log.Info("🛑 Player tracker module stopping due to context cancellation",
				"server_id", pt.serverID)
			return ctx.Err()
		case <-ticker.C:
			if err := pt.trackPlayers(ctx); err != nil {
				pt.log.Error("Player tracking failed", "error", err)
			}
		case <-cleanupTicker.C:
			pt.log.Debug("Running periodic cleanup of old matches")
			if err := pt.cleanupOldMatches(); err != nil {
				pt.log.Error("Failed to cleanup old matches", "error", err)
			}
		}
	}
}

func (pt *PlayerTracker) trackPlayers(ctx context.Context) error {
	// Only verify/resume if we don't already have a current match
	// This prevents resuming old matches when DetectAndResumeOrCreateMatch
	// has already determined we should wait for a new match start
	if pt.matchManager.GetCurrentMatch() == nil {
		if err := pt.matchManager.VerifyAndResumeMatch(ctx); err != nil {
			// Not an error - just waiting for MATCH START event to begin tracking
			// Log at debug level to avoid spam
			pt.log.Debug("Skipping player tracking - waiting for match to start", "reason", err.Error())
			return nil // Return nil so ticker continues
		}
	}

	// Get current match (guaranteed to exist after VerifyAndResumeMatch succeeds)
	currentMatch := pt.matchManager.GetCurrentMatch()
	if currentMatch == nil {
		// Should not happen after VerifyAndResumeMatch succeeds, but be defensive
		pt.log.Debug("No active match after verify, skipping tracking")
		return nil
	}

	// Use the RCON client to get detailed player info
	players, err := func() ([]hll.DetailedPlayerInfo, error) {
		defer func() {
			if r := recover(); r != nil {
				pt.log.Error("Panic recovered in GetPlayersInfo",
					"panic", r,
					"match_id", currentMatch.ID,
					"server_id", pt.serverID)
				// Return empty slice and error to continue operation
			}
		}()
		return pt.rcon.GetPlayersInfo()
	}()

	if err != nil {
		pt.log.Error("Failed to get players info", "error", err, "match_id", currentMatch.ID)
		return nil // Return nil to continue operation instead of failing
	}

	// If players is nil due to panic recovery, return early
	if players == nil {
		pt.log.Debug("Players info is nil, skipping this tracking cycle")
		return nil
	}

	// Get server information including match scores
	sessionInfo, sessionErr := func() (hll.SessionInfo, error) {
		defer func() {
			if r := recover(); r != nil {
				pt.log.Error("Panic recovered in GetSessionInfo",
					"panic", r,
					"match_id", currentMatch.ID,
					"server_id", pt.serverID)
			}
		}()
		return pt.rcon.GetSessionInfo()
	}()

	if sessionErr != nil {
		pt.log.Error("Failed to get session information", "error", sessionErr, "match_id", currentMatch.ID)
	} else {
		// Update remaining match time from RCON for UI clock synchronization
		if err := pt.db.UpdateMatchRemainingTime(ctx, currentMatch.ID, int(sessionInfo.RemainingMatchTime.Seconds())); err != nil {
			pt.log.Error("Failed to update remaining match time", "error", err, "match_id", currentMatch.ID)
		}
	}

	// Update active players map (for internal tracking, not for events - RCON handles connect/disconnect events)
	currentPlayerIDs := make(map[string]bool)
	for _, player := range players {
		currentPlayerIDs[player.ID] = true
	}
	pt.activePlayersMu.Lock()
	pt.activePlayers = currentPlayerIDs
	pt.activePlayersMu.Unlock()

	// Update player position cache
	pt.playerDataMu.Lock()
	for i := range players {
		pt.lastPlayerData[players[i].ID] = &players[i]
	}
	pt.playerDataMu.Unlock()

	currentPlayerCount := len(players)
	pt.log.Debug("Tracking players", "player_count", currentPlayerCount, "match_id", currentMatch.ID)

	// Log detailed tracking information to file
	var playerNames []string
	for _, player := range players {
		playerNames = append(playerNames, player.Name)
	}
	pt.writeTrackingLog(currentPlayerCount, playerNames)

	// Update tracking state
	pt.lastPlayerCount = currentPlayerCount
	pt.lastPlayerCheck = time.Now()

	// Update match player count peak
	if err := pt.db.UpdateMatchPlayerCount(ctx, currentMatch.ID, currentPlayerCount); err != nil {
		pt.log.Error("Failed to update match player count", "error", err)
	}

	// Record player positions using the PositionRecorder
	playerPositions, err := pt.positionRecorder.RecordPositions(ctx, players, currentMatch)
	if err != nil {
		pt.log.Error("Failed to record player positions", "error", err)
		return nil // Continue tracking even if recording fails
	}

	// Process spawn tracking for each player
	for _, player := range players {
		if err := pt.spawnTracker.ProcessPlayerPosition(ctx, player, currentMatch.ID); err != nil {
			pt.log.Error("Failed to process spawn position", "error", err)
		}
	}

	// Broadcast update to WebSocket clients with scores
	alliedScore := 2 // Default to 2-2
	axisScore := 2
	if sessionErr == nil {
		alliedScore = sessionInfo.AlliedScore
		axisScore = sessionInfo.AxisScore
	}

	if pt.webServer != nil && len(playerPositions) > 0 {
		pt.log.Debug("Broadcasting player positions to WebSocket",
			"position_count", len(playerPositions),
			"match_id", currentMatch.ID,
			"score", fmt.Sprintf("%d-%d", alliedScore, axisScore))
		pt.webServer.BroadcastPlayerDeltaUpdate(playerPositions, alliedScore, axisScore, pt.serverID)
	} else if pt.webServer == nil {
		pt.log.Warn("WebServer is nil, cannot broadcast player update")
	} else if len(playerPositions) == 0 {
		pt.log.Debug("No player positions to broadcast - no players online")
	}

	return nil
}

// writeTrackingLog logs detailed tracking information via the structured logger
func (pt *PlayerTracker) writeTrackingLog(currentPlayerCount int, players []string) {
	matchID := int64(0)
	matchDuration := "0s"

	currentMatch := pt.matchManager.GetCurrentMatch()
	if currentMatch != nil {
		matchID = currentMatch.ID
		matchStartTime := pt.matchManager.GetMatchStartTime()
		if !matchStartTime.IsZero() {
			matchDuration = time.Since(matchStartTime).Round(time.Second).String()
		} else {
			matchDuration = time.Since(currentMatch.StartTime).Round(time.Second).String()
		}
	}

	pt.log.Debug("Player tracking",
		"match_id", matchID,
		"players", currentPlayerCount,
		"last_count", pt.lastPlayerCount,
		"duration", matchDuration,
		"names", strings.Join(players, ", "))
}

func (pt *PlayerTracker) cleanupOldMatches() error {
	// Remove matches older than 7 days (keep a week of history)
	// Player positions are automatically deleted via CASCADE foreign key
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	ctx := context.Background()

	if err := pt.db.CleanOldMatches(ctx, cutoff); err != nil {
		return fmt.Errorf("failed to cleanup old matches: %w", err)
	}

	pt.log.Info("🧹 Cleaned up old matches and associated player positions",
		"cutoff", cutoff.Format(time.RFC3339),
		"retention_days", 7)
	return nil
}

// getPlayerInfo retrieves cached player info
// GetLiveSpawns returns the current aggregated spawn points for the active match
func (pt *PlayerTracker) GetLiveSpawns() []*SpawnPosition {
	match := pt.matchManager.GetCurrentMatch()
	if match == nil {
		return nil
	}
	return pt.spawnTracker.GetSpawnPositions(match.ID)
}

func (pt *PlayerTracker) getPlayerInfo(playerID string) *hll.DetailedPlayerInfo {
	pt.playerDataMu.RLock()
	defer pt.playerDataMu.RUnlock()

	return pt.lastPlayerData[playerID]
}

// constructUnit constructs a unit from player platoon and role information
func constructUnit(playerPlatoon string, playerRole int) hll.Unit {
	role := hll.RoleFromInt(playerRole)

	unit := hll.Unit{}
	if playerPlatoon == "" {
		if role == hll.ArmyCommander {
			unit = hll.CommandUnit
		} else {
			unit = hll.NoUnit
		}
	} else {
		unit.Name = caser.String(playerPlatoon)
		unit.ID = hll.UnitNameToID(playerPlatoon)
	}

	return unit
}
