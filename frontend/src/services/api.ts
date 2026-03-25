import type {
  Match,
  MatchData,
  Server,
  PlayerPosition,
  MatchEvent,
  KillEvent,
  SpawnEvent,
} from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_URL !== undefined
    ? import.meta.env.VITE_API_URL
    : "http://localhost:8080";

// Backend spawn point format
interface SpawnPoint {
  team: string;
  unit: string;
  x: number;
  y: number;
  z?: number;
  spawn_type: string;
  timestamp: string;
  confidence: number;
}

// Convert backend SpawnPoint[] to frontend SpawnEvent[]
function spawnPointsToEvents(spawns: SpawnPoint[]): SpawnEvent[] {
  return (spawns || []).map((s, i) => ({
    id: i,
    match_id: 0,
    event_type: "spawn" as const,
    message: "",
    player_ids: "",
    player_names: "",
    timestamp: s.timestamp,
    position_x: s.x,
    position_y: s.y,
    spawn_type: s.spawn_type,
    spawn_team: s.team,
    spawn_unit: s.unit,
    confidence: s.confidence,
  }));
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("hll-radar-auth-expired"));
      throw new AuthenticationError("Authentication required");
    }

    if (!response.ok) {
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  // Get list of servers
  async getServers(): Promise<Server[]> {
    return this.request<Server[]>("/api/v1/servers");
  }

  // Get current match data and players for a specific server
  async getCurrentMatchData(serverId?: number): Promise<MatchData> {
    const params = serverId ? `?server_id=${serverId}` : "";
    return this.request<MatchData>(`/api/v1/match-data${params}`);
  }

  // Get specific match data by ID
  async getMatchData(matchId: number): Promise<MatchData> {
    return this.request<MatchData>(`/api/v1/match-data?match_id=${matchId}`);
  }

  // Get list of matches for a specific server
  async getMatches(serverId?: number): Promise<Match[]> {
    const params = serverId ? `?server_id=${serverId}` : "";
    return this.request<Match[]>(`/api/v1/matches${params}`);
  }

  // Get player positions at specific timeline point
  async getMatchTimeline(
    matchId: number,
    timestamp: number
  ): Promise<PlayerPosition[]> {
    return this.request<PlayerPosition[]>(
      `/api/v1/match/${matchId}/timeline?timestamp=${timestamp}`
    );
  }

  // Get events for a match (optionally filtered by event types)
  async getMatchEvents(
    matchId: number,
    limit?: number,
    types?: string[]
  ): Promise<MatchEvent[]> {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (types && types.length > 0) params.set("types", types.join(","));
    const qs = params.toString();
    return this.request<MatchEvent[]>(
      `/api/v1/match/${matchId}/events${qs ? `?${qs}` : ""}`
    );
  }

  // Get events filtered by time range
  async getMatchEventsTimeline(
    matchId: number,
    start: number,
    end: number
  ): Promise<MatchEvent[]> {
    return this.request<MatchEvent[]>(
      `/api/v1/match/${matchId}/events/timeline?start=${start}&end=${end}`
    );
  }

  // Get all kill events for a match (pre-parsed with killer/victim/weapon)
  async getKillEvents(matchId: number, limit?: number): Promise<KillEvent[]> {
    const params = limit ? `?limit=${limit}` : "";
    return this.request<KillEvent[]>(
      `/api/v1/match/${matchId}/kills${params}`
    );
  }

  // Get kill events visible at timeline point with window (pre-parsed)
  async getKillEventsTimeline(
    matchId: number,
    timestamp: number,
    window?: number
  ): Promise<KillEvent[]> {
    const windowParam = window ? `&window=${window}` : "";
    return this.request<KillEvent[]>(
      `/api/v1/match/${matchId}/kills/timeline?timestamp=${timestamp}${windowParam}`
    );
  }

  // Get score at a specific timeline position (seconds from match start)
  async getMatchScore(
    matchId: number,
    timestamp: number
  ): Promise<{ allies: number; axis: number }> {
    return this.request<{ allies: number; axis: number }>(
      `/api/v1/match/${matchId}/score?timestamp=${timestamp}`
    );
  }

  // Get aggregated spawn points for a match (backend does clustering)
  async getMatchSpawnPoints(matchId: number): Promise<SpawnEvent[]> {
    return this.request<SpawnPoint[]>(
      `/api/v1/match/${matchId}/spawn-points`
    ).then(spawnPointsToEvents);
  }

  // Get live aggregated spawn points from the tracker
  async getLiveSpawns(serverId: number): Promise<SpawnEvent[]> {
    return this.request<SpawnPoint[]>(
      `/api/v1/live-spawns?server_id=${serverId}`
    ).then(spawnPointsToEvents);
  }

  // Send an in-game message to a player
  async messagePlayer(
    serverId: number,
    playerName: string,
    message: string
  ): Promise<void> {
    await this.request("/api/v1/message-player", {
      method: "POST",
      body: JSON.stringify({
        server_id: serverId,
        player_name: playerName,
        message,
      }),
    });
  }

  // Punish a player via RCON
  async punishPlayer(
    serverId: number,
    playerName: string,
    reason?: string
  ): Promise<void> {
    await this.request("/api/v1/punish-player", {
      method: "POST",
      body: JSON.stringify({
        server_id: serverId,
        player_name: playerName,
        reason: reason || "",
      }),
    });
  }

  // Kick a player via RCON
  async kickPlayer(
    serverId: number,
    playerName: string,
    reason?: string
  ): Promise<void> {
    await this.request("/api/v1/kick-player", {
      method: "POST",
      body: JSON.stringify({
        server_id: serverId,
        player_name: playerName,
        reason: reason || "",
      }),
    });
  }

  // Get app config from backend
  async getConfig(): Promise<{ sp_editor: boolean }> {
    return this.request<{ sp_editor: boolean }>("/api/v1/config");
  }

  // Save strong points for a match
  async saveMatchStrongPoints(
    matchId: number,
    strongPoints: { name: string; x: number; y: number; r?: number }[]
  ): Promise<void> {
    await this.request(`/api/v1/match/${matchId}/strong-points`, {
      method: "POST",
      body: JSON.stringify(strongPoints),
    });
  }

  // Get saved strong points for a match
  async getMatchStrongPoints(
    matchId: number
  ): Promise<{ name: string; x: number; y: number; r?: number }[]> {
    return this.request<{ name: string; x: number; y: number; r?: number }[]>(
      `/api/v1/match/${matchId}/strong-points`
    );
  }

  // Get position history for a player — use matchId for replay, serverId for live
  async getPlayerHistory(playerName: string, matchId?: number, serverId?: number): Promise<PlayerPosition[]> {
    const params = matchId
      ? `?match_id=${matchId}`
      : serverId ? `?server_id=${serverId}` : "";
    return this.request<PlayerPosition[]>(
      `/api/v1/player/${encodeURIComponent(playerName)}/history${params}`
    );
  }

  // Check auth status (whitelisted endpoint — never returns 401)
  async getAuthStatus(): Promise<{
    auth_required: boolean;
    authenticated: boolean;
  }> {
    const url = `${this.baseUrl}/api/v1/auth/status`;
    const response = await fetch(url, { credentials: "include" });
    return response.json();
  }

  // Get WebSocket URL
  getWebSocketUrl(): string {
    // When baseUrl is empty (same-origin), derive from window.location
    if (!this.baseUrl) {
      const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
      return `${wsProtocol}://${window.location.host}/ws`;
    }
    const wsProtocol = this.baseUrl.startsWith("https") ? "wss" : "ws";
    const wsBaseUrl = this.baseUrl.replace(/^https?/, wsProtocol);
    return `${wsBaseUrl}/ws`;
  }
}

export const apiClient = new ApiClient();
export default ApiClient;
