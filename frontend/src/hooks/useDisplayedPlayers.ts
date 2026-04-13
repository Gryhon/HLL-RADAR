import { useState, useEffect, useRef } from "react";
import { apiClient } from "../services/api";
import type { Match, MatchEvent, PlayerPosition } from "../types";

// Fallback: if no disconnect event exists for a player, hide them if their last
// recorded position is more than 30 s before the requested timeline point.
// (Positions are polled every 5 s, so 30 s = 6 missed polls.)
const PLAYER_STALE_THRESHOLD_MS = 30_000;

// Per-player connect/disconnect timeline, sorted ascending by timestamp.
type PlayerEventLog = Map<string, { type: "connect" | "disconnect"; ts: number }[]>;

function parsePlayerNames(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // plain string fallback
    return [raw];
  }
  return [];
}

function buildEventLog(events: MatchEvent[]): PlayerEventLog {
  const log: PlayerEventLog = new Map();
  for (const ev of events) {
    if (ev.event_type !== "player_connect" && ev.event_type !== "player_disconnect") continue;
    const names = parsePlayerNames(ev.player_names);
    const ts = new Date(ev.timestamp).getTime();
    for (const name of names) {
      if (!log.has(name)) log.set(name, []);
      log.get(name)!.push({ type: ev.event_type === "player_connect" ? "connect" : "disconnect", ts });
    }
  }
  // Sort each player's events ascending by time
  for (const entries of log.values()) {
    entries.sort((a, b) => a.ts - b.ts);
  }
  return log;
}

/** Returns true if the player was on the server at `requestedTs`. */
function isPlayerActiveAt(
  playerName: string,
  positionTs: number,
  requestedTs: number,
  eventLog: PlayerEventLog
): boolean {
  const events = eventLog.get(playerName);

  if (events && events.length > 0) {
    // Find the last event before or at requestedTs
    let lastEvent: { type: "connect" | "disconnect"; ts: number } | null = null;
    for (const ev of events) {
      if (ev.ts <= requestedTs) lastEvent = ev;
      else break;
    }
    if (lastEvent?.type === "disconnect") return false;
    // last event is connect (or player was there from match start) → active
  }

  // Fallback: stale position means the player is gone
  return requestedTs - positionTs <= PLAYER_STALE_THRESHOLD_MS;
}

export function useDisplayedPlayers(
  isLive: boolean,
  currentMatch: Match | null,
  timelineValue: number,
  livePlayerPositions: PlayerPosition[]
) {
  const [displayedPlayers, setDisplayedPlayers] = useState<PlayerPosition[]>([]);
  const [useBackendTimeline, setUseBackendTimeline] = useState(true);
  const timelineFetchTimeoutRef = useRef<number | null>(null);

  // Connect/disconnect event log, keyed by match id to avoid stale data
  const eventLogRef = useRef<{ matchId: number; log: PlayerEventLog } | null>(null);

  // Fetch connect/disconnect events once per historical match
  useEffect(() => {
    if (isLive || !currentMatch?.id) {
      eventLogRef.current = null;
      return;
    }
    if (eventLogRef.current?.matchId === currentMatch.id) return;
    eventLogRef.current = null;

    let cancelled = false;
    apiClient
      .getMatchEvents(currentMatch.id, 10000, ["player_connect", "player_disconnect"])
      .then((events) => {
        if (cancelled) return;
        eventLogRef.current = { matchId: currentMatch.id, log: buildEventLog(events) };
      })
      .catch(() => {
        // If the fetch fails, we fall back to the staleness threshold only
      });
    return () => { cancelled = true; };
  }, [isLive, currentMatch?.id]);

  // Live mode: pass positions through immediately, no debounce
  useEffect(() => {
    if (!isLive || timelineValue !== 0) return;
    setDisplayedPlayers(livePlayerPositions);
  }, [isLive, timelineValue, livePlayerPositions]);

  // Timeline scrubbing: debounced backend fetch
  useEffect(() => {
    if (isLive && timelineValue === 0) return;

    if (timelineFetchTimeoutRef.current) {
      clearTimeout(timelineFetchTimeoutRef.current);
    }

    if (!currentMatch) {
      setDisplayedPlayers([]);
      return;
    }

    if (!isLive && timelineValue === 0) {
      setDisplayedPlayers([]);
      return;
    }

    if (timelineValue > 0 && useBackendTimeline) {
      timelineFetchTimeoutRef.current = window.setTimeout(async () => {
        try {
          const matchStartTime = new Date(currentMatch.start_time).getTime();
          const selectedTime = matchStartTime + timelineValue * 1000;

          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Request timeout")), 5000)
          );

          const positions = (await Promise.race([
            apiClient.getMatchTimeline(currentMatch.id, selectedTime),
            timeoutPromise,
          ])) as PlayerPosition[];

          const log = eventLogRef.current?.matchId === currentMatch.id
            ? eventLogRef.current.log
            : new Map();

          const active = positions.filter((p) =>
            isPlayerActiveAt(
              p.player_name,
              new Date(p.timestamp).getTime(),
              selectedTime,
              log
            )
          );

          setDisplayedPlayers(active);
        } catch (error) {
          console.error("Failed to fetch timeline data:", error);
          setUseBackendTimeline(false);
          setDisplayedPlayers(livePlayerPositions);
        }
      }, 100);
    } else {
      setDisplayedPlayers(livePlayerPositions);
    }

    return () => {
      if (timelineFetchTimeoutRef.current) {
        clearTimeout(timelineFetchTimeoutRef.current);
      }
    };
  }, [isLive, currentMatch, timelineValue, useBackendTimeline]);

  return { displayedPlayers };
}
