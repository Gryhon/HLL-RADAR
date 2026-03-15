package tracker

import (
	"context"
	"fmt"
	"hll-radar/database"
	"log/slog"
	"time"

	"github.com/zMoooooritz/go-let-loose/pkg/hll"
)

// PositionRecorder handles recording player positions to the database
type PositionRecorder struct {
	db  *database.Database
	log *slog.Logger
}

// NewPositionRecorder creates a new PositionRecorder instance
func NewPositionRecorder(db *database.Database, log *slog.Logger) *PositionRecorder {
	return &PositionRecorder{
		db:  db,
		log: log,
	}
}

// RecordPositions records player positions for the given match
func (pr *PositionRecorder) RecordPositions(ctx context.Context, players []hll.DetailedPlayerInfo, match *database.Match) ([]database.PlayerPosition, error) {
	if match == nil {
		return nil, fmt.Errorf("cannot record positions without an active match")
	}

	pr.log.Debug("Recording player positions",
		"player_count", len(players),
		"match_id", match.ID,
		"map", match.MapName)

	var positions []database.PlayerPosition
	var errorCount int

	for _, player := range players {
		position := pr.buildPlayerPosition(player, match)

		if err := pr.db.InsertPlayerPosition(ctx, position); err != nil {
			errorCount++
			pr.log.Error("Failed to insert player position",
				"player", player.Name,
				"team", position.Team,
				"match_id", match.ID,
				"error", err,
			)
			continue
		}

		positions = append(positions, position)

		pr.log.Debug("Recorded player position",
			"player", player.Name,
			"team", position.Team,
			"role", position.Role,
			"unit", position.Unit,
			"x", fmt.Sprintf("%.1f", player.Position.X),
			"y", fmt.Sprintf("%.1f", player.Position.Y),
			"z", fmt.Sprintf("%.1f", player.Position.Z),
			"kills", player.Kills,
			"deaths", player.Deaths,
		)
	}

	pr.log.Debug("Position recording complete",
		"recorded_count", len(positions),
		"failed_count", errorCount,
		"match_id", match.ID)

	return positions, nil
}

// buildPlayerPosition creates a PlayerPosition from a DetailedPlayerInfo and Match
func (pr *PositionRecorder) buildPlayerPosition(player hll.DetailedPlayerInfo, match *database.Match) database.PlayerPosition {
	return database.PlayerPosition{
		MatchID:    match.ID,
		PlayerName: player.Name,
		Team:       GetTeamName(player.Team),
		X:          player.Position.X,
		Y:          player.Position.Y,
		Z:          player.Position.Z,
		Rotation:   0, // Rotation is not available from RCON
		MapName:    match.MapName,
		Timestamp:  time.Now(),
		Platform:   string(player.Platform),
		ClanTag:    player.ClanTag,
		Level:      player.Level,
		Role:       string(player.Role),
		Unit:       player.Unit.Name,
		Loadout:    player.Loadout,
		Kills:      player.Kills,
		Deaths:     player.Deaths,
		Combat:     player.Score.Combat,
		Offensive:  player.Score.Offense,
		Defensive:  player.Score.Defense,
		Support:    player.Score.Support,
	}
}

// GetTeamName converts team enum to string
func GetTeamName(team hll.Team) string {
	switch team {
	case hll.TmAllies:
		return "Allies"
	case hll.TmAxis:
		return "Axis"
	default:
		return "Unknown"
	}
}
