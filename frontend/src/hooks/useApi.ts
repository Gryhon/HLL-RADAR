import { useState, useEffect } from "react";
import { apiClient } from "../services/api";
import type { Match, MatchData, Server } from "../types";

export const useServers = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServers = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getServers();
      setServers(response || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch servers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  return { servers, loading, error, refetch: fetchServers };
};

export const useMatches = (serverId?: number) => {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatches = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getMatches(serverId);
      setMatches(response || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch matches");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatches();
  }, [serverId]);

  return { matches, loading, error, refetch: fetchMatches };
};

export const useMatchData = (matchId?: number, serverId?: number) => {
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatchData = async (id?: number, sId?: number) => {
    try {
      setLoading(true);
      const response = id
        ? await apiClient.getMatchData(id)
        : await apiClient.getCurrentMatchData(sId);
      setMatchData(response);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch match data"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatchData(matchId, serverId);
  }, [matchId, serverId]);

  return {
    matchData,
    loading,
    error,
    refetch: () => fetchMatchData(matchId, serverId),
  };
};
