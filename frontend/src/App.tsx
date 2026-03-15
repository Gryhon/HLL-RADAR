import { useState, useEffect, useCallback, useMemo } from "react";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { MatchList } from "./components/MatchList";
import { apiClient } from "./services/api";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMatchData, useServers } from "./hooks/useApi";
import { MapViewer } from "./components/MapViewer";
import { Timeline } from "./components/Timeline";
import { useMatchState, useElapsedTime } from "./hooks/useMatchState";
import { usePlayerPositions } from "./hooks/usePlayerPositions";
import { useKillEvents } from "./hooks/useKillEvents";
import { useSpawnEvents } from "./hooks/useSpawnEvents";
import { useDisplayedPlayers } from "./hooks/useDisplayedPlayers";
import type { MatchEvent, WebSocketMessage } from "./types";
import { SPEditor } from "./components/SPEditor";
import { LoginRequired } from "./components/LoginRequired";
import "./App.css";

function App() {
  const [authState, setAuthState] = useState<"checking" | "ok" | "required">("checking");
  const [spEditorMode, setSpEditorMode] = useState(false);
  const [spEditorEnabled, setSpEditorEnabled] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    apiClient
      .getAuthStatus()
      .then((status) => {
        if (!status.auth_required || status.authenticated) {
          setAuthState("ok");
        } else {
          setAuthState("required");
        }
      })
      .catch(() => {
        // If we can't reach the backend at all, allow through — the app will
        // show connection errors elsewhere.
        setAuthState("ok");
      });
  }, []);

  // Listen for session expiry mid-use (401 from any API call)
  useEffect(() => {
    const handler = () => setAuthState("required");
    window.addEventListener("hll-radar-auth-expired", handler);
    return () => window.removeEventListener("hll-radar-auth-expired", handler);
  }, []);

  useEffect(() => {
    if (authState === "ok") {
      apiClient.getConfig().then((cfg) => setSpEditorEnabled(cfg.sp_editor)).catch(() => {});
    }
  }, [authState]);

  const [selectedServerId, setSelectedServerId] = useState<number | undefined>(
    () => {
      const saved = localStorage.getItem("selectedServerId");
      return saved ? Number(saved) : undefined;
    }
  );

  // Fetch available servers
  const { servers, loading: serversLoading } = useServers();

  // Set default server when servers are loaded, or validate saved selection still exists
  useEffect(() => {
    if (servers.length === 0) return;
    const savedExists =
      selectedServerId !== undefined &&
      servers.some((s) => s.id === selectedServerId);
    if (!savedExists) {
      setSelectedServerId(servers[0].id);
    }
  }, [servers, selectedServerId]);

  // Persist server selection to localStorage
  useEffect(() => {
    if (selectedServerId !== undefined) {
      localStorage.setItem("selectedServerId", String(selectedServerId));
    }
  }, [selectedServerId]);

  // Match state management
  const {
    selectedMatchId,
    isLive,
    timelineValue,
    elapsedTime,
    matchScore,
    autoPlay,
    setElapsedTime,
    handleMatchSelect,
    handleBackToLive: rawHandleBackToLive,
    handleTimelineChange,
    handleGoLive,
    handleScoreUpdate,
    handleMatchStart,
    handleMatchEnd,
  } = useMatchState(selectedServerId);

  // Player position management
  const {
    livePlayerPositions,
    historicalPositions,
    handlePlayerDelta,
    initializeFromApi,
    clearHistorical,
  } = usePlayerPositions(selectedServerId);

  // Wrap handleBackToLive to also clear historical positions
  const handleBackToLive = useCallback(() => {
    rawHandleBackToLive();
    clearHistorical();
  }, [rawHandleBackToLive, clearHistorical]);

  // Data fetching hook for the currently viewed match
  const {
    matchData,
    loading,
    error,
    refetch: refetchMatchData,
  } = useMatchData(isLive ? undefined : selectedMatchId, selectedServerId);

  const currentMatch = matchData?.match || null;

  // Always fetch live match info so the sidebar can show it
  const { matchData: liveMatchData, refetch: refetchLiveMatch } = useMatchData(
    undefined,
    selectedServerId
  );
  const liveMatch = liveMatchData?.match || null;

  // Match event tracking
  const [newMatchEvent, setNewMatchEvent] = useState<MatchEvent | null>(null);

  // Kill and death event management
  const { killEvents, deathOverlays, handleLiveKillEvent } = useKillEvents(
    currentMatch?.id,
    historicalPositions,
    matchData?.players,
    livePlayerPositions
  );

  // Spawn event management
  const { spawnPositions, handleLiveSpawnEvent } = useSpawnEvents(
    currentMatch?.id,
    selectedServerId,
    isLive
  );

  // Displayed players (live or timeline)
  const { displayedPlayers } = useDisplayedPlayers(
    isLive,
    currentMatch,
    timelineValue,
    livePlayerPositions
  );

  // Track elapsed time for live matches
  useElapsedTime(isLive, currentMatch, setElapsedTime);

  // Fetch objective_captured events once for historic matches, compute score locally
  const [scoreEvents, setScoreEvents] = useState<{ timestamp: number; allies: number; axis: number }[]>([]);
  useEffect(() => {
    if (isLive || !currentMatch?.id) {
      setScoreEvents([]);
      return;
    }
    let cancelled = false;
    apiClient.getMatchEvents(currentMatch.id, 1000, ["objective_captured"]).then((events) => {
      if (cancelled) return;
      const startTime = new Date(currentMatch.start_time).getTime();
      const parsed = events.map((e) => {
        const secs = (new Date(e.timestamp).getTime() - startTime) / 1000;
        try {
          const d = JSON.parse(e.details || "{}");
          return { timestamp: secs, allies: d.new_score_allies ?? 2, axis: d.new_score_axis ?? 2 };
        } catch {
          return { timestamp: secs, allies: 2, axis: 2 };
        }
      }).sort((a, b) => a.timestamp - b.timestamp);
      setScoreEvents(parsed);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isLive, currentMatch?.id, currentMatch?.start_time]);

  // Compute score at current timeline position from cached events (synchronous, no flicker)
  const historicScore = useMemo(() => {
    if (isLive || scoreEvents.length === 0) return null;
    let allies = 2, axis = 2;
    for (const e of scoreEvents) {
      if (e.timestamp > timelineValue) break;
      allies = e.allies;
      axis = e.axis;
    }
    return { allies, axis };
  }, [isLive, timelineValue, scoreEvents]);

  const displayScore = historicScore ?? matchScore;

  // Initialize live positions from API data
  useEffect(() => {
    if (matchData?.players) {
      initializeFromApi(matchData.players);
    }
  }, [matchData?.players, initializeFromApi]);

  // WebSocket connection for live updates
  const { isConnected, connectionError } = useWebSocket(
    apiClient.getWebSocketUrl(),
    {
      onMessage: (message: WebSocketMessage) => {
        // Player delta updates
        handlePlayerDelta(message);

        // Score updates from delta
        if (
          message.type === "player_delta" &&
          message.payload?.server_id === selectedServerId &&
          message.payload?.allied_score !== undefined &&
          message.payload?.axis_score !== undefined
        ) {
          handleScoreUpdate(
            message.payload.allied_score,
            message.payload.axis_score
          );
        }

        // Match lifecycle
        handleMatchStart(message, () => { refetchMatchData(); refetchLiveMatch(); });
        handleMatchEnd(message, () => { refetchMatchData(); refetchLiveMatch(); });

        // Match events
        if (message.type === "match_event") {
          if (
            selectedServerId !== undefined &&
            message.payload?.server_id !== selectedServerId
          ) {
            return;
          }

          const event = message.payload?.event;
          setNewMatchEvent(event);
          handleLiveSpawnEvent(event);
          handleLiveKillEvent(event);
        }
      },
    }
  );

  const handleEventClick = useCallback(
    (eventTimestamp: string) => {
      if (!currentMatch?.start_time) return;

      const matchStartTime = new Date(currentMatch.start_time).getTime();
      const clickedEventTime = new Date(eventTimestamp).getTime();
      const secondsFromStart = Math.floor(
        (clickedEventTime - matchStartTime) / 1000
      );

      handleTimelineChange(secondsFromStart);
    },
    [currentMatch, handleTimelineChange]
  );

  if (authState === "checking") {
    return <div className="app"><div className="loading">Checking authentication...</div></div>;
  }

  if (authState === "required") {
    return <LoginRequired />;
  }

  if (spEditorMode) {
    return <SPEditor onExit={() => setSpEditorMode(false)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>HLL RADAR 📡</h1>
        <div className="header-controls">
          {spEditorEnabled && (
            <button
              className="sp-editor-btn"
              onClick={() => setSpEditorMode(true)}
              title="SP Editor"
            >
              SP Editor
            </button>
          )}
          {!serversLoading && servers.length > 0 && (
            <div className="server-selector-container">
              <select
                className="server-selector"
                value={selectedServerId || ""}
                onChange={(e) => setSelectedServerId(Number(e.target.value))}
              >
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.display_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {serversLoading && (
            <div className="server-selector-loading">
              <span>Loading servers...</span>
            </div>
          )}
          <ConnectionStatus isConnected={isConnected} error={connectionError} />
          <a
            href="https://github.com/sledro/HLL-RADAR"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
            title="View on GitHub"
          >
            <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>
        </div>
      </header>

      <div className="app-content">
        <aside className="sidebar">
          <MatchList
            onMatchSelect={handleMatchSelect}
            selectedMatchId={selectedMatchId}
            onBackToLive={handleBackToLive}
            currentMatch={currentMatch}
            liveMatch={liveMatch}
            players={displayedPlayers}
            isLive={isLive}
            serverId={selectedServerId}
            newEvent={newMatchEvent}
            matchScore={displayScore}
            onEventClick={handleEventClick}
            timelineValue={timelineValue}
            liveElapsedTime={elapsedTime}
          />
        </aside>

        <main className="main-content">
          <div className="map-container">
            {loading && <div className="loading">Loading map data...</div>}
            {error && <div className="error">{error}</div>}
            {currentMatch && (
              <MapViewer
                mapName={currentMatch.map_name}
                players={displayedPlayers}
                isLive={isLive}
                killEvents={killEvents}
                deathOverlays={deathOverlays}
                spawnPositions={spawnPositions}
                showSpawns={true}
                timelineValue={timelineValue}
                matchStartTime={currentMatch.start_time}
                score={displayScore}
                serverId={selectedServerId}
                matchId={currentMatch.id}
              />
            )}
            {!loading && !currentMatch && <div className="placeholder" />}
          </div>

          <div className="timeline-container">
            <Timeline
              value={timelineValue}
              max={isLive ? elapsedTime : currentMatch?.duration_seconds || 0}
              onChange={handleTimelineChange}
              isLive={isLive}
              match={currentMatch}
              onGoLive={handleGoLive}
              autoPlay={autoPlay}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
