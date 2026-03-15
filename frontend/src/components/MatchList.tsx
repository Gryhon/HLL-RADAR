import { useState, useEffect } from "react";
import { useMatches } from "../hooks/useApi";
import { apiClient } from "../services/api";
import { formatDuration, formatTimestamp, getMapDisplayName } from "../utils";
import type { PlayerPosition, MatchEvent } from "../types";
import { MatchLog } from "./MatchLog";
import "./MatchList.css";

interface MatchListProps {
  onMatchSelect: (matchId: number) => void;
  selectedMatchId?: number;
  onBackToLive: () => void;
  currentMatch?: {
    id: number;
    map_name: string;
    start_time: string;
    end_time?: string;
    duration_seconds: number;
    is_active: boolean;
  } | null;
  liveMatch?: {
    id: number;
    map_name: string;
    start_time: string;
    end_time?: string;
    duration_seconds: number;
    is_active: boolean;
  } | null;
  players?: PlayerPosition[];
  isLive: boolean;
  serverId?: number;
  newEvent?: MatchEvent | null;
  matchScore?: { allies: number; axis: number };
  onEventClick?: (timestamp: string) => void;
  timelineValue?: number;
  liveElapsedTime?: number;
}

export const MatchList = ({
  onMatchSelect,
  selectedMatchId,
  onBackToLive,
  currentMatch,
  liveMatch,
  players = [],
  isLive,
  serverId,
  newEvent,
  matchScore = { allies: 2, axis: 2 },
  onEventClick,
  timelineValue = 0,
  liveElapsedTime = 0,
}: MatchListProps) => {
  const { matches, loading, error, refetch } = useMatches(serverId);

  const [activeTab, setActiveTab] = useState<"analyzer" | "matches">(
    "analyzer"
  );
  const [displayScore, setDisplayScore] = useState(matchScore);

  // Use timeline value for elapsed time when scrubbing, otherwise use live elapsed time
  const elapsedTime = timelineValue > 0 ? timelineValue : liveElapsedTime;

  // Fetch score from backend at timeline position
  useEffect(() => {
    if (!currentMatch?.id) return;

    // If live with no scrubbing, use the live score directly
    if (isLive && timelineValue === 0) {
      setDisplayScore(matchScore);
      return;
    }

    let cancelled = false;
    const fetchScore = async () => {
      try {
        const score = await apiClient.getMatchScore(
          currentMatch.id,
          elapsedTime
        );
        if (!cancelled) setDisplayScore(score);
      } catch (err) {
        console.error("Failed to fetch score:", err);
      }
    };

    const timeoutId = setTimeout(fetchScore, 100);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [currentMatch?.id, elapsedTime, isLive, timelineValue, matchScore]);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  // Calculate time remaining (assuming 90 minute maximum match time)
  const totalMatchTime = 90 * 60; // 5400 seconds (90 minutes)
  const timeRemaining = Math.max(0, totalMatchTime - elapsedTime);

  // Switch to analyzer tab when going back to live
  const handleBackToLive = () => {
    setActiveTab("analyzer");
    onBackToLive();
  };

  // Switch to analyzer tab when selecting a match
  // If the selected match is the current live match, go to live view instead
  const handleMatchSelect = (matchId: number) => {
    setActiveTab("analyzer");
    if (liveMatch && liveMatch.is_active && matchId === liveMatch.id) {
      onBackToLive();
    } else {
      onMatchSelect(matchId);
    }
  };

  if (loading) {
    return (
      <div className="match-list">
        <div className="match-list-header">
          <h3>Matches</h3>
        </div>
        <div className="loading">Loading matches...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="match-list">
        <div className="match-list-header">
          <h3>Matches</h3>
          <button onClick={refetch} className="refresh-button">
            Retry
          </button>
        </div>
        <div className="error">
          <p>Failed to load matches</p>
          <p className="error-details">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="match-list">
      <div className="match-list-header">
        <div className="tab-menu">
          <button
            className={`tab-button ${activeTab === "analyzer" ? "active" : ""}`}
            onClick={() => setActiveTab("analyzer")}
          >
            ANALYZER
          </button>
          <button
            className={`tab-button ${activeTab === "matches" ? "active" : ""}`}
            onClick={() => setActiveTab("matches")}
          >
            MATCHES
          </button>
        </div>
      </div>

      {activeTab === "analyzer" ? (
        <div className="tab-content">
          <div className="live-match-section">
            {currentMatch && (
              <div className="live-match-info">
                <div className="match-info-header">
                  <div className="map-name-header">
                    {getMapDisplayName(currentMatch.map_name)}
                  </div>
                </div>
                <div className="team-score">
                  <div className="score-item allies">
                    <span className="team-name">Allies</span>
                    <span className="team-count">{displayScore.allies}</span>
                    <span className="player-count-label">
                      ({(players || []).filter((p) => p.team.toLowerCase() === "allies").length})
                    </span>
                  </div>
                  <div className="score-divider">VS</div>
                  <div className="score-item axis">
                    <span className="team-name">Axis</span>
                    <span className="team-count">{displayScore.axis}</span>
                    <span className="player-count-label">
                      ({(players || []).filter((p) => p.team.toLowerCase() === "axis").length})
                    </span>
                  </div>
                </div>
                <div className="time-info">
                  <div className="time-item">
                    <span className="time-label">Elapsed</span>
                    <span className="time-value">
                      {formatTime(elapsedTime)}
                    </span>
                  </div>
                  <div className="time-divider">•</div>
                  <div className="time-item">
                    <span className="time-label">Remaining</span>
                    <span className="time-value">
                      {formatTime(timeRemaining)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!currentMatch && (
              <div className="no-live-match">
                <p>No match selected</p>
                <p className="hint">Select a match from MATCHES tab</p>
              </div>
            )}
          </div>

          <MatchLog
            matchId={selectedMatchId || currentMatch?.id}
            isLive={isLive && !selectedMatchId}
            newEvent={newEvent}
            onEventClick={onEventClick}
            timelineValue={timelineValue}
            matchStartTime={currentMatch?.start_time}
          />
        </div>
      ) : (
        <div className="tab-content">
          {/* LIVE Section - always show if there's an active match on the server */}
          {liveMatch && liveMatch.is_active && (
            <div className="matches-live-section">
              <h4 className="section-title ">LIVE</h4>
              <button
                onClick={handleBackToLive}
                className={`match-item ${isLive && !selectedMatchId ? "active" : ""}`}
              >
                <div className="match-header">
                  <span className="map-name">
                    {getMapDisplayName(liveMatch.map_name)}
                  </span>
                  <div className="match-status">
                    <div className="status-badge live ">
                      <div className="live-dot"></div>
                      LIVE
                    </div>
                  </div>
                </div>

                <div className="match-details">
                  <div className="match-time">
                    <span className="label">Started:</span>
                    <span className="value">
                      {formatTimestamp(liveMatch.start_time)}
                    </span>
                  </div>

                  <div className="match-stats">
                    <div className="stat">
                      <span className="label">Duration:</span>
                      <span className="value">{formatTime(elapsedTime)}</span>
                    </div>

                    <div className="stat">
                      <span className="label">Players:</span>
                      <span className="value">{players?.length ?? 0}</span>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Match History */}
          <div className="match-list-content">
            <h4 className="section-title">MATCH HISTORY</h4>

            {matches.length === 0 ? (
              <div className="no-matches">
                <p>No matches found</p>
              </div>
            ) : (
              <div className="matches">
                {matches
                  .filter((match) => {
                    // Filter out the current live match if it's being shown in LIVE section
                    if (
                      liveMatch &&
                      liveMatch.is_active &&
                      match.id === liveMatch.id
                    ) {
                      return false;
                    }
                    return true;
                  })
                  .map((match) => (
                    <button
                      key={match.id}
                      onClick={() => handleMatchSelect(match.id)}
                      className={`match-item ${
                        selectedMatchId === match.id ? "active" : ""
                      }`}
                    >
                      <div className="match-header">
                        <span className="map-name">
                          {getMapDisplayName(match.map_name)}
                        </span>
                        <div className="match-status">
                          {match.is_active ? (
                            <div className="status-badge live ">
                              <div className="live-dot"></div>
                              LIVE
                            </div>
                          ) : (
                            <div className="status-badge finished">
                              <div className="clock-icon">🕒</div>
                              FINISHED
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="match-details">
                        <div className="match-time">
                          <span className="label">Started:</span>
                          <span className="value">
                            {formatTimestamp(match.start_time)}
                          </span>
                        </div>

                        <div className="match-stats">
                          <div className="stat">
                            <span className="label">Duration:</span>
                            <span className="value">
                              {formatDuration(match.duration_seconds)}
                            </span>
                          </div>

                          <div className="stat">
                            <span className="label">Final Score:</span>
                            <span className="value">
                              {match.final_score_allies}-
                              {match.final_score_axis}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
