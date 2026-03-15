import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../services/api";
import type {
  KillEvent,
  DeathOverlay,
  MatchEvent,
  PlayerPosition,
} from "../types";

export function useKillEvents(
  matchId: number | undefined,
  historicalPositions: PlayerPosition[],
  matchPlayers: PlayerPosition[] | undefined,
  livePlayerPositions: PlayerPosition[]
) {
  const [killEvents, setKillEvents] = useState<KillEvent[]>([]);
  const [deathOverlays, setDeathOverlays] = useState<DeathOverlay[]>([]);

  // Fetch pre-parsed kill events from backend
  useEffect(() => {
    const fetchKillEvents = async () => {
      if (!matchId) {
        setKillEvents([]);
        setDeathOverlays([]);
        return;
      }

      try {
        // Backend returns kill events with killer_name, victim_name, weapon already parsed
        const kills = await apiClient.getKillEvents(matchId, 2000);
        setKillEvents(kills);

        // Build death overlays from kill events + player positions
        const allPlayers =
          historicalPositions.length > 0
            ? historicalPositions
            : matchPlayers || [];

        const deaths: DeathOverlay[] = [];
        for (const kill of kills) {
          const victim = allPlayers.find(
            (p) => p.player_name === kill.victim_name
          );
          if (victim) {
            deaths.push({
              player_name: kill.victim_name,
              timestamp: kill.timestamp,
              x: victim.x,
              y: victim.y,
              z: victim.z,
            });
          }
        }
        setDeathOverlays(deaths);
      } catch (err) {
        console.error("Failed to fetch kill events:", err);
        setKillEvents([]);
        setDeathOverlays([]);
      }
    };

    fetchKillEvents();
  }, [matchId, historicalPositions, matchPlayers]);

  // Handle live kill events from WebSocket
  const handleLiveKillEvent = useCallback(
    (event: MatchEvent) => {
      if (event.event_type !== "kill") return;

      // Parse kill from message for live events
      const message = event.message || "";
      const match = message.match(/(.+?)\s+killed\s+(.+?)(?:\s+with\s+(.+))?$/i);
      if (!match) return;

      const killEvent: KillEvent = {
        id: event.id,
        match_id: event.match_id,
        event_type: event.event_type,
        message: event.message,
        timestamp: event.timestamp,
        killer_name: match[1].trim(),
        victim_name: match[2].trim(),
        position_x: event.position_x || 0,
        position_y: event.position_y || 0,
        position_z: event.position_z || 0,
        victim_x: event.victim_x || 0,
        victim_y: event.victim_y || 0,
        victim_z: event.victim_z || 0,
        weapon: match[3]?.trim(),
      };

      setKillEvents((prev) => [...prev, killEvent].slice(-100));

      const victim = livePlayerPositions.find(
        (p) => p.player_name === killEvent.victim_name
      );
      if (victim) {
        setDeathOverlays((prev) =>
          [
            ...prev,
            {
              player_name: killEvent.victim_name,
              timestamp: killEvent.timestamp,
              x: victim.x,
              y: victim.y,
              z: victim.z,
            },
          ].slice(-50)
        );
      }
    },
    [livePlayerPositions]
  );

  return { killEvents, deathOverlays, handleLiveKillEvent };
}
