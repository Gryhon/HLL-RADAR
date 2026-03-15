import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../services/api";
import type { SpawnEvent, MatchEvent } from "../types";

export function useSpawnEvents(
  matchId: number | undefined,
  serverId?: number,
  isLive?: boolean
) {
  const [spawnPositions, setSpawnPositions] = useState<SpawnEvent[]>([]);

  // Poll live spawns from backend tracker (already aggregated and classified)
  useEffect(() => {
    if (!isLive || !serverId) return;

    let cancelled = false;

    const fetchLiveSpawns = async () => {
      try {
        const spawns = await apiClient.getLiveSpawns(serverId);
        if (!cancelled) setSpawnPositions(spawns || []);
      } catch (error) {
        console.error("Failed to fetch live spawns:", error);
      }
    };

    fetchLiveSpawns();
    const interval = setInterval(fetchLiveSpawns, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLive, serverId]);

  // For historical matches, fetch aggregated spawn points from backend
  useEffect(() => {
    if (isLive || !matchId) {
      if (!isLive) setSpawnPositions([]);
      return;
    }

    const fetchSpawnPoints = async () => {
      try {
        const spawns = await apiClient.getMatchSpawnPoints(matchId);
        setSpawnPositions(spawns || []);
      } catch (error) {
        console.error("Failed to fetch spawn points:", error);
        setSpawnPositions([]);
      }
    };

    fetchSpawnPoints();
  }, [isLive, matchId]);

  // No-op — live spawns are fetched via polling
  const handleLiveSpawnEvent = useCallback((_event: MatchEvent) => {}, []);

  return { spawnPositions, handleLiveSpawnEvent };
}
