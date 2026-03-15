import { useState, useEffect, useCallback } from "react";
import type { Match, WebSocketMessage } from "../types";

interface MatchScore {
  allies: number;
  axis: number;
}

export function useMatchState(selectedServerId: number | undefined) {
  const [selectedMatchId, setSelectedMatchId] = useState<number | undefined>();
  const [isLive, setIsLive] = useState(true);
  const [timelineValue, setTimelineValue] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [matchScore, setMatchScore] = useState<MatchScore>({ allies: 2, axis: 2 });
  const [autoPlay, setAutoPlay] = useState(false);

  const handleMatchSelect = useCallback((matchId: number) => {
    setSelectedMatchId(matchId);
    setIsLive(false);
    setTimelineValue(0);
    setAutoPlay((prev) => !prev); // Toggle to trigger autoPlay in Timeline
  }, []);

  const handleBackToLive = useCallback(() => {
    setSelectedMatchId(undefined);
    setIsLive(true);
    setTimelineValue(0);
    setElapsedTime(0);
    setAutoPlay((prev) => !prev); // Toggle to trigger autoPlay in Timeline
  }, []);

  const handleTimelineChange = useCallback((value: number) => {
    setTimelineValue(value);
  }, []);

  const handleGoLive = useCallback(() => {
    setTimelineValue(0);
  }, []);

  const handleScoreUpdate = useCallback(
    (alliedScore: number, axisScore: number) => {
      setMatchScore({ allies: alliedScore, axis: axisScore });
    },
    []
  );

  const handleMatchStart = useCallback(
    (message: WebSocketMessage, refetchMatchData: () => void) => {
      if (message.type !== "match_start") return;
      if (message.payload?.server_id !== selectedServerId) return;

      setSelectedMatchId(undefined);
      setIsLive(true);
      setTimelineValue(0);
      setElapsedTime(0);
      setMatchScore({ allies: 2, axis: 2 });
      refetchMatchData();
    },
    [selectedServerId]
  );

  const handleMatchEnd = useCallback(
    (message: WebSocketMessage, refetchMatchData: () => void) => {
      if (message.type !== "match_end") return;
      if (
        selectedServerId !== undefined &&
        message.payload?.server_id !== selectedServerId
      ) {
        return;
      }
      refetchMatchData();
    },
    [selectedServerId]
  );

  return {
    selectedMatchId,
    isLive,
    timelineValue,
    elapsedTime,
    matchScore,
    autoPlay,
    setElapsedTime,
    handleMatchSelect,
    handleBackToLive,
    handleTimelineChange,
    handleGoLive,
    handleScoreUpdate,
    handleMatchStart,
    handleMatchEnd,
  };
}

/**
 * Hook to track elapsed time for the current live match.
 */
export function useElapsedTime(
  isLive: boolean,
  currentMatch: Match | null,
  setElapsedTime: (time: number) => void
) {
  useEffect(() => {
    if (!isLive || !currentMatch?.start_time) return;

    const updateElapsedTime = () => {
      const startTime = new Date(currentMatch.start_time).getTime();
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      const maxDuration = 90 * 60;
      setElapsedTime(Math.min(elapsed, maxDuration));
    };

    updateElapsedTime();
    const interval = setInterval(updateElapsedTime, 1000);
    return () => clearInterval(interval);
  }, [isLive, currentMatch, setElapsedTime]);
}
