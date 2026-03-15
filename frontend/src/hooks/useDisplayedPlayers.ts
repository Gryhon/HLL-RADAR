import { useState, useEffect, useRef } from "react";
import { apiClient } from "../services/api";
import type { Match, PlayerPosition } from "../types";

export function useDisplayedPlayers(
  isLive: boolean,
  currentMatch: Match | null,
  timelineValue: number,
  livePlayerPositions: PlayerPosition[]
) {
  const [displayedPlayers, setDisplayedPlayers] = useState<PlayerPosition[]>([]);
  const [useBackendTimeline, setUseBackendTimeline] = useState(true);
  const timelineFetchTimeoutRef = useRef<number | null>(null);

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

          setDisplayedPlayers(positions);
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
