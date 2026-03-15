import { useState, useCallback } from "react";
import type { PlayerPosition, WebSocketMessage } from "../types";

export function usePlayerPositions(selectedServerId: number | undefined) {
  const [livePlayerPositions, setLivePlayerPositions] = useState<PlayerPosition[]>([]);
  const [historicalPositions, setHistoricalPositions] = useState<PlayerPosition[]>([]);
  const [loadingHistorical, setLoadingHistorical] = useState(false);

  const handlePlayerDelta = useCallback(
    (message: WebSocketMessage) => {
      if (message.type !== "player_delta") return;
      if (message.payload?.server_id !== selectedServerId) return;

      setLivePlayerPositions((prev) => {
        const updated = new Map(prev.map((p) => [p.player_name, p]));

        if (message.payload?.added) {
          message.payload.added.forEach((player: PlayerPosition) => {
            updated.set(player.player_name, player);
          });
        }

        if (message.payload?.updated) {
          message.payload.updated.forEach((player: PlayerPosition) => {
            updated.set(player.player_name, player);
          });
        }

        if (message.payload?.removed) {
          message.payload.removed.forEach((playerName: string) => {
            updated.delete(playerName);
          });
        }

        return Array.from(updated.values());
      });
    },
    [selectedServerId]
  );

  const initializeFromApi = useCallback((players: PlayerPosition[]) => {
    setLivePlayerPositions((prev) => {
      if (prev.length === 0 && players.length > 0) {
        return players;
      }
      return prev;
    });
  }, []);

  const clearHistorical = useCallback(() => {
    setHistoricalPositions([]);
  }, []);

  return {
    livePlayerPositions,
    historicalPositions,
    loadingHistorical,
    setHistoricalPositions,
    setLoadingHistorical,
    handlePlayerDelta,
    initializeFromApi,
    clearHistorical,
  };
}
