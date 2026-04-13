import { useEffect, useLayoutEffect, useRef, useState, memo, useMemo, useCallback } from "react";
import type {
  PlayerPosition,
  KillEvent,
  DeathOverlay,
  SpawnEvent,
  MapConfig,
} from "../types";
import { getMapConfig, getDefaultStrongPoints } from "../config/maps";
import { apiClient } from "../services/api";
import { getTeamClass, getSquadColor, SQUAD_NAMES } from "../utils";
import "./MapViewer.css";

interface PlayerDotProps {
  player: PlayerPosition;
  mapWidth: number;
  mapHeight: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  iconScale: number;
  showName: boolean;
  deathOverlays: DeathOverlay[];
  timelineValue: number;
  matchStartTime: string;
  isLive: boolean;
  zoom: number;
  onMessagePlayer?: (playerName: string) => void;
  onPunishPlayer?: (playerName: string) => void;
  onKickPlayer?: (playerName: string) => void;
  onTrailPlayer?: (playerName: string) => void;
  isTrailed?: boolean;
  trailWindowMinutes?: number;
  onTrailWindowChange?: (minutes: number) => void;
  snapSerial?: number;
}

const PlayerDot: React.FC<PlayerDotProps> = memo(
  ({
    player,
    mapWidth,
    mapHeight,
    minX,
    maxX,
    minY,
    maxY,
    iconScale,
    showName,
    deathOverlays,
    timelineValue,
    matchStartTime,
    isLive,
    zoom,
    onMessagePlayer,
    onPunishPlayer,
    onKickPlayer,
    onTrailPlayer,
    isTrailed,
    trailWindowMinutes,
    onTrailWindowChange,
    snapSerial,
  }) => {
    const dotRef = useRef<HTMLDivElement>(null);
    const prevPosRef = useRef<{ x: number; y: number } | null>(null);
    const prevSnapRef = useRef(snapSerial ?? 0);

    const isDeadOrRedeploying = player.x === 0 && player.y === 0;

    // Convert game coordinates to map pixel coordinates
    const x =
      !isDeadOrRedeploying && mapWidth > 0 && mapHeight > 0
        ? ((player.x - minX) / (maxX - minX)) * mapWidth
        : mapWidth / 2;
    const y =
      !isDeadOrRedeploying && mapHeight > 0
        ? ((player.y - minY) / (maxY - minY)) * mapHeight
        : mapHeight / 2;

    // In live-following: disable CSS position transition on snap or large jump (respawn).
    // useLayoutEffect fires before browser paint so the transition is suppressed before it starts.
    // In replay/live-scrub: JS interpolation in MapViewer drives positions — nothing to do here.
    useLayoutEffect(() => {
      const isSnap = (snapSerial ?? 0) !== prevSnapRef.current;
      prevSnapRef.current = snapSerial ?? 0;

      if (isDeadOrRedeploying) {
        prevPosRef.current = null;
        return;
      }

      // Only act in live-following mode; other modes use JS interpolation (no CSS left/top)
      if (!isLive || timelineValue > 0 || isTrailed) {
        prevPosRef.current = { x, y };
        return;
      }

      const el = dotRef.current;
      let shouldInstant = isSnap;
      if (!shouldInstant) {
        const prev = prevPosRef.current;
        if (prev) {
          const dx = x - prev.x;
          const dy = y - prev.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > Math.max(mapWidth, mapHeight) * 0.15) shouldInstant = true;
        }
      }

      if (shouldInstant && el) {
        el.style.transition = "none";
        el.offsetHeight; // eslint-disable-line @typescript-eslint/no-unused-expressions
        requestAnimationFrame(() => { el.style.transition = ""; });
      }

      prevPosRef.current = { x, y };
    });

    // Check if player has died based on timeline (show for 10 seconds after death)
    const isDead = useMemo(() => {
      if (
        !matchStartTime ||
        timelineValue === undefined ||
        !deathOverlays ||
        !Array.isArray(deathOverlays)
      )
        return false;

      const matchStartTimeMs = new Date(matchStartTime).getTime();
      // In live mode with timeline at 0, use current time; otherwise use timeline-based time
      const currentTimeMs =
        isLive && timelineValue === 0
          ? Date.now()
          : matchStartTimeMs + timelineValue * 1000;

      return deathOverlays.some((death) => {
        if (death.player_name !== player.player_name) return false;

        const deathTimeMs = new Date(death.timestamp).getTime();
        const timeSinceDeath = currentTimeMs - deathTimeMs;

        // Show death overlay for 10 seconds (10000ms) after death
        return timeSinceDeath >= 0 && timeSinceDeath <= 10000;
      });
    }, [
      deathOverlays,
      player.player_name,
      timelineValue,
      matchStartTime,
      isLive,
    ]);

    // Player at (0, 0) is dead/redeploying — don't show on map
    if (isDeadOrRedeploying) {
      return null;
    }

    // Get squad color for border and name
    const squadColor = getSquadColor(player.unit);

    const dotStyle: React.CSSProperties = {
      left: `${x}px`,
      top: `${y}px`,
      transform: `translate(-50%, -50%) scale(${
        (iconScale * Math.sqrt(zoom)) / zoom
      })`,
      borderColor: squadColor,
      "--icon-scale": (iconScale * Math.sqrt(zoom)) / zoom,
      // Trail + replay + live-scrub: JS drives position — no left/top CSS transition.
      // Live-following (isLive && timelineValue===0): CSS class handles 5.5s position transition.
      ...((isTrailed || !isLive || timelineValue > 0) && { transition: "transform 0.2s ease, opacity 0.3s ease" }),
    } as React.CSSProperties;

    // Get role icon path
    const roleIcon = player.role
      ? `/roles/${player.role.toLowerCase().replace(/\s+/g, "")}.png`
      : null;

    return (
      <div
        ref={dotRef}
        className={`player-dot ${getTeamClass(player.team)}`}
        style={dotStyle}
        title={`${player.player_name} (${player.team})`}
      >
        {roleIcon && (
          <img
            src={roleIcon}
            alt={player.role}
            className="player-role-icon"
            onError={(e) => {
              // Hide icon if it fails to load
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        {isDead && <div className="death-overlay">✕</div>}
        {showName && (
          <div className="player-name-tag" style={{ color: squadColor }}>
            {player.player_name}
          </div>
        )}
        <div className="player-label">
          <div className="player-label-header">
            {player.clan_tag && (
              <span className="player-clantag">[{player.clan_tag}]</span>
            )}
            <span className="player-name">{player.player_name}</span>
            <span className="player-level">(Lvl. {player.level || "?"})</span>
          </div>
          <div className="player-label-body">
            <div className="player-stat">
              <span className="stat-label">Role:</span>
              <span className="stat-value">{player.role || "N/A"}</span>
            </div>
            <div className="player-stat">
              <span className="stat-label">Unit:</span>
              <span className="stat-value">{player.unit || "N/A"}</span>
            </div>
            <div className="player-stat">
              <span className="stat-label">Loadout:</span>
              <span className="stat-value">{player.loadout || "N/A"}</span>
            </div>
            <div className="player-stat kda">
              <span className="stat-label">K/D:</span>
              <span className="stat-value">
                {player.kills ?? "?"} / {player.deaths ?? "?"}
              </span>
            </div>
            <div className="player-stat">
              <span className="stat-label">Score:</span>
              <span className="stat-value">{player.score ?? "?"}</span>
            </div>
            <div className="player-action-btns">
              {onMessagePlayer && (
                <button
                  className="player-action-btn player-action-msg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMessagePlayer(player.player_name);
                  }}
                  title="Send message"
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              )}
              {onPunishPlayer && (
                <button
                  className="player-action-btn player-action-punish"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPunishPlayer(player.player_name);
                  }}
                  title="Punish"
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </button>
              )}
              {onKickPlayer && (
                <button
                  className="player-action-btn player-action-kick"
                  onClick={(e) => {
                    e.stopPropagation();
                    onKickPlayer(player.player_name);
                  }}
                  title="Kick"
                >
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              )}
              {onTrailPlayer && (
                <button
                  className={`player-action-btn player-action-trail${isTrailed ? " active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTrailPlayer(player.player_name);
                  }}
                  title={isTrailed ? "Hide trail" : "Show trail"}
                >
                  <svg
                    width="10"
                    height="8"
                    viewBox="0 0 32 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="3 2"
                  >
                    <path d="M0 8 C4 0, 8 0, 12 8 C16 16, 20 16, 24 8 C28 0, 32 0, 36 8" />
                  </svg>
                </button>
              )}
              {isTrailed && onTrailWindowChange && (
                <select
                  className="trail-window-select"
                  value={trailWindowMinutes}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    onTrailWindowChange(Number(e.target.value));
                  }}
                >
                  <option value={3}>3 min</option>
                  <option value={6}>6 min</option>
                  <option value={9}>9 min</option>
                  <option value={12}>12 min</option>
                  <option value={30}>30 min</option>
                  <option value={0}>All</option>
                </select>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

// Smooth SVG path through points using Catmull-Rom splines
function catmullRomPath(pts: { px: number; py: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].px.toFixed(1)},${pts[0].py.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.px + (p2.px - p0.px) / 6;
    const cp1y = p1.py + (p2.py - p0.py) / 6;
    const cp2x = p2.px - (p3.px - p1.px) / 6;
    const cp2y = p2.py - (p3.py - p1.py) / 6;
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.px.toFixed(1)},${p2.py.toFixed(1)}`;
  }
  return d;
}

// SpawnMarker component for rendering spawn positions
const SpawnMarker: React.FC<{
  spawn: SpawnEvent;
  mapConfig: MapConfig;
  zoom: number;
  iconScale: number;
  gameToMapCoords: (x: number, y: number) => { x: number; y: number };
}> = ({ spawn, zoom, iconScale, gameToMapCoords }) => {
  const coords = gameToMapCoords(spawn.position_x!, spawn.position_y!);

  const getSpawnIconPath = (spawnType: string) => {
    switch (spawnType) {
      case "garrison":
      case "hq": // Use garrison icon for HQ too
        return "/spawns/garrison.png";
      case "outpost":
        return "/spawns/outpost.png";
      default:
        return "/spawns/garrison.png"; // Default fallback
    }
  };

  const getSpawnSize = (spawnType: string) => {
    switch (spawnType) {
      case "hq":
        return 12; // Larger for HQ
      case "garrison":
        return 10; // Medium for garrison
      case "outpost":
        return 8; // Smaller for outpost
      default:
        return 12;
    }
  };

  // Format spawn type for display
  const formatSpawnType = (spawnType: string) => {
    switch (spawnType) {
      case "hq":
        return "HQ";
      case "garrison":
        return "Garrison";
      case "outpost":
        return "Outpost";
      default:
        return "Unknown";
    }
  };

  return (
    <div
      className="spawn-marker"
      data-spawn-type={spawn.spawn_type}
      data-team={spawn.spawn_team}
      style={{
        position: "absolute",
        left: `${coords.x}px`,
        top: `${coords.y}px`,
        transform: `translate(-50%, -50%) scale(${
          (iconScale * Math.sqrt(zoom)) / zoom
        })`,
        zIndex: 15,
        pointerEvents: "auto", // Enable hover
        cursor: "pointer",
        opacity: 0.8,
      }}
    >
      <div
        className="spawn-marker-icon"
        data-team={spawn.spawn_team}
        data-spawn-type={spawn.spawn_type}
        style={{
          borderRadius: "4px",
          padding: "2px",
          display: "inline-block",
          ...(spawn.spawn_type === "outpost" &&
            spawn.spawn_unit && {
              border: `1px solid ${getSquadColor(spawn.spawn_unit)}`,
            }),
        }}
      >
        <img
          src={getSpawnIconPath(spawn.spawn_type || "")}
          alt={`${spawn.spawn_type} spawn`}
          style={{
            width: `${getSpawnSize(spawn.spawn_type || "")}px`,
            height: `${getSpawnSize(spawn.spawn_type || "")}px`,
            display: "block",
          }}
        />
      </div>

      {/* Show squad name for outposts */}
      {spawn.spawn_type === "outpost" && spawn.spawn_unit && (
        <div
          className="spawn-unit-label"
          style={{
            color: getSquadColor(spawn.spawn_unit),
          }}
        >
          {spawn.spawn_unit}
        </div>
      )}

      {/* Hover Tooltip */}
      <div
        className="spawn-tooltip"
        style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(0, 0, 0, 0.9)",
          color: "white",
          padding: "4px 8px",
          borderRadius: "4px",
          fontSize: "12px",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          transition: "opacity 0.2s ease",
          zIndex: 1000,
          marginBottom: "4px",
        }}
      >
        <div style={{ fontWeight: "bold" }}>
          {formatSpawnType(spawn.spawn_type || "")}
        </div>
        {/* Show squad/unit name for HQ and outpost spawns */}
        {(spawn.spawn_type === "hq" || spawn.spawn_type === "outpost") &&
          spawn.spawn_unit && (
            <div style={{ fontSize: "10px", opacity: 0.8 }}>
              {spawn.spawn_unit}
            </div>
          )}
        {spawn.spawn_team && (
          <div style={{ fontSize: "10px", opacity: 0.8 }}>
            {spawn.spawn_team}
          </div>
        )}
      </div>
    </div>
  );
};

interface MapViewerProps {
  mapName: string;
  players: PlayerPosition[];
  isLive: boolean;
  killEvents: KillEvent[];
  deathOverlays: DeathOverlay[];
  spawnPositions: SpawnEvent[];
  showSpawns: boolean;
  timelineValue: number;
  matchStartTime: string;
  score?: { allies: number; axis: number };
  serverId?: number;
  matchId?: number;
  forceShowStrongPoints?: boolean;
  playbackSpeed?: number;
  snapSerial?: number;  // increments on manual scrub / skip / go-live
}

export const MapViewer = ({
  mapName,
  players,
  isLive,
  killEvents,
  deathOverlays,
  spawnPositions,
  timelineValue,
  matchStartTime,
  score = { allies: 2, axis: 2 },
  serverId,
  matchId,
  forceShowStrongPoints = false,
  playbackSpeed = 1,
  snapSerial = 0,
}: MapViewerProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [iconScale, setIconScale] = useState(1);
  const [pan, _setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const setPan = useCallback((p: { x: number; y: number }) => {
    panRef.current = p;
    _setPan(p);
  }, []);

  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panRafRef = useRef<number | null>(null);
  const [mapRenderDetails, setMapRenderDetails] = useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [showAllies, setShowAllies] = useState(true);
  const [showAxis, setShowAxis] = useState(true);
  const [trailedPlayerNames, setTrailedPlayerNames] = useState<Set<string>>(new Set());
  const [trailDataMap, setTrailDataMap] = useState<Map<string, PlayerPosition[]>>(new Map());
  const [trailWindowMap, setTrailWindowMap] = useState<Map<string, number>>(new Map());
  const [squadsAlliesOpen, setSquadsAlliesOpen] = useState(false);
  const [squadsAxisOpen, setSquadsAxisOpen] = useState(false);
  const [strongPointsOpen, setStrongPointsOpen] = useState(false);
  const [hiddenUnits, setHiddenUnits] = useState<Set<string>>(new Set());
  const [showPlayerNames, setShowPlayerNames] = useState(true);
  const [showSpawnsState, setShowSpawnsState] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [useCleanMap, setUseCleanMap] = useState(!forceShowStrongPoints);
  const [hiddenSPs, setHiddenSPs] = useState<Set<number>>(new Set());
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [messageSent, setMessageSent] = useState(false);
  const messageInputRef = useRef<HTMLInputElement>(null);

  const [spUnlocked, setSpUnlocked] = useState(false);
  const [spOverrides, setSpOverrides] = useState<
    Record<number, { x?: number; y?: number; r?: number }>
  >({});
  const [draggingSPIndex, setDraggingSPIndex] = useState<number | null>(null);
  const [resizingSPIndex, setResizingSPIndex] = useState<number | null>(null);
  const spDragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    cpX: number;
    cpY: number;
    startR?: number;
    centerX?: number;
    centerY?: number;
  } | null>(null);

  // Control panel dragging state
  const [controlPosition, setControlPosition] = useState({ x: 0, y: 0 });
  const [isDraggingControl, setIsDraggingControl] = useState(false);
  const [controlDocked, setControlDocked] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const controlPanelRef = useRef<HTMLDivElement>(null);

  const mapConfig = getMapConfig(mapName);
  const baseStrongPoints = useMemo(
    () => (mapConfig ? getDefaultStrongPoints(mapConfig) : []),
    [mapConfig]
  );

  // Saved SPs for this match (loaded from backend)
  const [savedSPs, setSavedSPs] = useState<
    { name: string; x: number; y: number; r?: number }[] | null
  >(null);
  const [spSaving, setSpSaving] = useState(false);

  // Load saved SPs when match changes
  useEffect(() => {
    if (!matchId) {
      setSavedSPs(null);
      return;
    }
    let cancelled = false;
    apiClient
      .getMatchStrongPoints(matchId)
      .then((cps) => {
        if (!cancelled && cps && cps.length > 0) {
          setSavedSPs(cps);
          // Hide SPs not in saved set
          const savedNames = new Set(cps.map((cp) => cp.name));
          const defaultSPs = mapConfig ? getDefaultStrongPoints(mapConfig) : [];
          const hidden = new Set<number>();
          defaultSPs.forEach((cp, i) => {
            if (!savedNames.has(cp.name)) hidden.add(i);
          });
          setHiddenSPs(hidden);
        }
      })
      .catch(() => {
        /* no saved SPs */
      });
    return () => {
      cancelled = true;
    };
  }, [matchId, mapConfig]);

  // Reset overrides when map changes
  useEffect(() => {
    setSpOverrides({});
    setSpUnlocked(false);
    setSavedSPs(null);
  }, [mapConfig?.name]);

  // Merge base SPs with overrides (only while editing, before saving to file)
  const strongPoints = useMemo(
    () =>
      baseStrongPoints.map((cp, i) => {
        const override = spOverrides[i];
        if (!override) return cp;
        return {
          name: cp.name,
          x: override.x ?? cp.x,
          y: override.y ?? cp.y,
          r: override.r ?? cp.r,
        };
      }),
    [baseStrongPoints, spOverrides]
  );

  // Send in-game message to a player
  const handleSendMessage = useCallback(async () => {
    if (!messageTarget || !messageText.trim() || !serverId) return;
    setMessageSending(true);
    try {
      await apiClient.messagePlayer(
        serverId,
        messageTarget,
        messageText.trim()
      );
      setMessageText("");
      setMessageSent(true);
      setTimeout(() => {
        setMessageSent(false);
        setMessageTarget(null);
      }, 1200);
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setMessageSending(false);
    }
  }, [messageTarget, messageText, serverId]);

  // Open message dialog for a player
  const handleMessagePlayer = useCallback((playerName: string) => {
    setMessageTarget(playerName);
    setMessageText("");
    // Focus input after render
    setTimeout(() => messageInputRef.current?.focus(), 50);
  }, []);

  // Confirm dialog state for punish/kick
  const [confirmAction, setConfirmAction] = useState<{
    type: "punish" | "kick";
    playerName: string;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Open confirm dialog for punish
  const handlePunishPlayer = useCallback((playerName: string) => {
    setConfirmAction({ type: "punish", playerName });
  }, []);

  // Open confirm dialog for kick
  const handleKickPlayer = useCallback((playerName: string) => {
    setConfirmAction({ type: "kick", playerName });
  }, []);

  // Toggle player trail
  const handleTrailPlayer = useCallback(async (playerName: string) => {
    if (trailedPlayerNames.has(playerName)) {
      setTrailedPlayerNames(prev => { const next = new Set(prev); next.delete(playerName); return next; });
      setTrailDataMap(prev => { const next = new Map(prev); next.delete(playerName); return next; });
      liveAnimRefs.current.delete(playerName);
      return;
    }
    setTrailedPlayerNames(prev => new Set([...prev, playerName]));
    try {
      const data = await apiClient.getPlayerHistory(playerName, matchId, serverId);
      setTrailDataMap(prev => new Map([...prev, [playerName, data]]));
    } catch (e) {
      console.error("Failed to fetch player trail:", e);
    }
  }, [trailedPlayerNames, matchId, serverId]);

  // When matchId changes (new match started), reset all trail state
  useEffect(() => {
    setTrailedPlayerNames(new Set());
    setTrailDataMap(new Map());
    setTrailWindowMap(new Map());
    liveAnimRefs.current.clear();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Execute confirmed action
  const handleConfirmAction = useCallback(async () => {
    if (!confirmAction || !serverId) return;
    setConfirmLoading(true);
    try {
      if (confirmAction.type === "punish") {
        await apiClient.punishPlayer(serverId, confirmAction.playerName);
      } else {
        await apiClient.kickPlayer(serverId, confirmAction.playerName);
      }
      setConfirmAction(null);
    } catch (err) {
      console.error(`Failed to ${confirmAction.type} player:`, err);
    } finally {
      setConfirmLoading(false);
    }
  }, [confirmAction, serverId]);

  // Convert map pixel coords back to game coords
  const mapToGameCoords = (px: number, py: number) => {
    if (!mapConfig) return { x: 0, y: 0 };
    const { minX, maxX, minY, maxY } = mapConfig.bounds;
    const gx = minX + (px / mapRenderDetails.width) * (maxX - minX);
    const gy = minY + (py / mapRenderDetails.height) * (maxY - minY);
    return { x: Math.round(gx), y: Math.round(gy) };
  };

  // Compute available squads per team (sorted) and whether any commander exists per team
  const availableSquads = useMemo(() => {
    if (!players || !Array.isArray(players)) return {
      allies: { units: [] as string[], hasCommander: false },
      axis: { units: [] as string[], hasCommander: false },
    };
    const alliesSet = new Set<string>();
    const axisSet = new Set<string>();
    let alliesCommander = false;
    let axisCommander = false;
    for (const p of players) {
      const team = p.team?.toLowerCase();
      const isCommander = p.role?.toLowerCase() === "armycommander";
      if (team === "allies") {
        if (isCommander) alliesCommander = true;
        else if (p.unit) alliesSet.add(p.unit.toLowerCase().trim());
      } else if (team === "axis") {
        if (isCommander) axisCommander = true;
        else if (p.unit) axisSet.add(p.unit.toLowerCase().trim());
      }
    }
    const sortUnits = (set: Set<string>) => {
      const known = SQUAD_NAMES.filter((n) => set.has(n));
      const unknown = [...set].filter((n) => !SQUAD_NAMES.includes(n)).sort();
      return [...known, ...unknown];
    };
    return {
      allies: { units: sortUnits(alliesSet), hasCommander: alliesCommander },
      axis: { units: sortUnits(axisSet), hasCommander: axisCommander },
    };
  }, [players]);

  // Trail data sorted once by timestamp, per player
  const sortedTrailDataMap = useMemo(() => {
    const m = new Map<string, PlayerPosition[]>();
    for (const [name, data] of trailDataMap) {
      m.set(name, [...data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
    }
    return m;
  }, [trailDataMap]);

  // Track when timelineValue last updated for interpolation.
  // snapSerial invalidates the ref so the next render uses exact baseMs (no lerp).
  const lastTimelineRef = useRef<{ gameTimeMs: number; realTime: number } | null>(null);
  useEffect(() => {
    if (!matchStartTime) return;
    lastTimelineRef.current = {
      gameTimeMs: new Date(matchStartTime).getTime() + timelineValue * 1000,
      realTime: performance.now(),
    };
  }, [timelineValue, matchStartTime]);

  // On manual scrub / skip / go-live: clear all interpolation refs for instant snap.
  const skipNextLiveAnimUpdateRef = useRef(false);
  useEffect(() => {
    if (snapSerial === 0) return;
    lastTimelineRef.current = null;
    liveAnimRefs.current.clear();
    playerInterpRef.current = null;
    skipNextLiveAnimUpdateRef.current = true;
  }, [snapSerial]); // eslint-disable-line react-hooks/exhaustive-deps

  // For live mode: per-player animation refs (Map), same 5.5s lerp as CSS transition.
  type LiveAnimState = { fromX: number; fromY: number; fromTs: number; toX: number; toY: number; toTs: number; startTime: number };
  const liveAnimRefs = useRef<Map<string, LiveAnimState>>(new Map());

  // Live positions for all trailed players
  const liveTrailedPlayers = useMemo(() => {
    if (!isLive || timelineValue !== 0 || trailedPlayerNames.size === 0) return new Map<string, PlayerPosition>();
    const m = new Map<string, PlayerPosition>();
    for (const name of trailedPlayerNames) {
      const p = players?.find(p => p.player_name === name);
      if (p) m.set(name, p);
    }
    return m;
  }, [isLive, timelineValue, players, trailedPlayerNames]);

  // Append new live positions to trailDataMap as they arrive
  useEffect(() => {
    if (liveTrailedPlayers.size === 0) return;
    setTrailDataMap(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const [name, pos] of liveTrailedPlayers) {
        if (pos.x === 0 && pos.y === 0) continue;
        const existing = next.get(name) ?? [];
        if (existing.length > 0 && existing[existing.length - 1].timestamp === pos.timestamp) continue;
        next.set(name, [...existing, pos]);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [liveTrailedPlayers]);

  // Update liveAnimRefs for each live trailed player
  useEffect(() => {
    if (!isLive || timelineValue !== 0) return;
    if (skipNextLiveAnimUpdateRef.current) {
      skipNextLiveAnimUpdateRef.current = false;
      liveAnimRefs.current.clear();
      return;
    }
    const now = performance.now();
    for (const [name, pos] of liveTrailedPlayers) {
      if (pos.x === 0 || pos.y === 0) continue;
      const toTs = new Date(pos.timestamp).getTime();
      const cur = liveAnimRefs.current.get(name) ?? null;
      if (!cur) {
        liveAnimRefs.current.set(name, { fromX: pos.x, fromY: pos.y, fromTs: toTs, toX: pos.x, toY: pos.y, toTs, startTime: now });
        continue;
      }
      const progress = Math.min(1, (now - cur.startTime) / 5500);
      liveAnimRefs.current.set(name, {
        fromX: cur.fromX + (cur.toX - cur.fromX) * progress,
        fromY: cur.fromY + (cur.toY - cur.fromY) * progress,
        fromTs: cur.fromTs + (cur.toTs - cur.fromTs) * progress,
        toX: pos.x, toY: pos.y, toTs,
        startTime: now,
      });
    }
  }, [isLive, liveTrailedPlayers]);

  // JS interpolation refs for all players (replay + live-scrub)
  const playerInterpRef = useRef<{
    from: Map<string, { x: number; y: number }>;
    startTime: number;
  } | null>(null);
  const prevPlayersRef = useRef<PlayerPosition[]>([]);
  const lastHandledSnapRef = useRef(0);

  // When players change: set up interpolation (skip in live-following and on snap)
  useEffect(() => {
    const newPlayers = players || [];
    const prev = prevPlayersRef.current;
    prevPlayersRef.current = newPlayers;

    // Live-following: CSS class handles it, JS not needed
    if (isLive && timelineValue === 0) {
      playerInterpRef.current = null;
      lastHandledSnapRef.current = snapSerial;
      return;
    }

    // Snap: instant jump, no interpolation
    if (snapSerial !== lastHandledSnapRef.current) {
      lastHandledSnapRef.current = snapSerial;
      playerInterpRef.current = null;
      return;
    }

    if (prev.length === 0 || newPlayers.length === 0) {
      playerInterpRef.current = null;
      return;
    }

    const now = performance.now();
    const fromMap = new Map<string, { x: number; y: number }>();

    if (playerInterpRef.current) {
      // Mid-animation: capture current interpolated position as new "from"
      const t = Math.min(1, (now - playerInterpRef.current.startTime) / 1000);
      for (const p of prev) {
        const fromPos = playerInterpRef.current.from.get(p.player_name);
        fromMap.set(p.player_name, fromPos
          ? { x: fromPos.x + (p.x - fromPos.x) * t, y: fromPos.y + (p.y - fromPos.y) * t }
          : { x: p.x, y: p.y }
        );
      }
    } else {
      for (const p of prev) {
        fromMap.set(p.player_name, { x: p.x, y: p.y });
      }
    }

    playerInterpRef.current = { from: fromMap, startTime: now };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, isLive, timelineValue, snapSerial]);

  // RAF loop — runs at ~30fps (every other frame) to drive smooth JS interpolation for all players and trail.
  // 30fps is sufficient for game position updates (which arrive every 5s) and halves React reconciliation cost.
  const [rafTick, setRafTick] = useState(0);
  const trailRafRef = useRef<number | null>(null);
  const rafFrameRef = useRef(0);
  useEffect(() => {
    const tick = () => {
      trailRafRef.current = requestAnimationFrame(tick);
      rafFrameRef.current++;
      if (rafFrameRef.current % 2 === 0) {
        setRafTick(n => n + 1);
      }
    };
    trailRafRef.current = requestAnimationFrame(tick);
    return () => { if (trailRafRef.current) { cancelAnimationFrame(trailRafRef.current); trailRafRef.current = null; } };
  }, []);

  // Smooth interpolated positions for all trailed players (drives icons and trail endpoints).
  // Live: 5.5s lerp matching the CSS transition timing.
  // Replay: playbackSpeed-based time interpolation between recorded positions.
  const trailedPlayersInterpolated = useMemo(() => {
    const result = new Map<string, PlayerPosition | null>();
    if (trailedPlayerNames.size === 0) return result;

    const baseMs = matchStartTime ? new Date(matchStartTime).getTime() + timelineValue * 1000 : 0;
    let interpMs = baseMs;
    if (lastTimelineRef.current) {
      const elapsed = performance.now() - lastTimelineRef.current.realTime;
      if (elapsed <= 1500) interpMs = lastTimelineRef.current.gameTimeMs + elapsed * playbackSpeed;
    }

    for (const name of trailedPlayerNames) {
      const fallback = players?.find((p) => p.player_name === name) ?? null;
      const sortedData = sortedTrailDataMap.get(name) ?? [];

      if (sortedData.length === 0) { result.set(name, fallback); continue; }

      // --- Live following ---
      if (isLive && timelineValue === 0) {
        const anim = liveAnimRefs.current.get(name) ?? null;
        if (!anim || !fallback) { result.set(name, fallback); continue; }
        const progress = Math.min(1, (performance.now() - anim.startTime) / 5500);
        if (progress >= 1) { result.set(name, fallback); continue; }
        result.set(name, {
          ...fallback,
          x: anim.fromX + (anim.toX - anim.fromX) * progress,
          y: anim.fromY + (anim.toY - anim.fromY) * progress,
          timestamp: new Date(anim.fromTs + (anim.toTs - anim.fromTs) * progress).toISOString(),
        });
        continue;
      }

      // --- Replay / scrubbing ---
      if (!matchStartTime) { result.set(name, fallback); continue; }

      let prevPos: PlayerPosition | null = null;
      let nextPos: PlayerPosition | null = null;
      for (const p of sortedData) {
        const ts = new Date(p.timestamp).getTime();
        if (ts <= interpMs) prevPos = p;
        else { nextPos = p; break; }
      }

      if (!prevPos || prevPos.x === 0 || prevPos.y === 0) { result.set(name, fallback); continue; }
      if (!nextPos || nextPos.x === 0 || nextPos.y === 0) { result.set(name, prevPos); continue; }

      const prevTs = new Date(prevPos.timestamp).getTime();
      const nextTs = new Date(nextPos.timestamp).getTime();
      const t = Math.max(0, Math.min(1, (interpMs - prevTs) / (nextTs - prevTs)));

      if (mapConfig && mapRenderDetails.width > 0) {
        const { minX, maxX, minY, maxY } = mapConfig.bounds;
        const w = mapRenderDetails.width, h = mapRenderDetails.height;
        const dx = ((nextPos.x - prevPos.x) / (maxX - minX)) * w;
        const dy = ((nextPos.y - prevPos.y) / (maxY - minY)) * h;
        if (Math.sqrt(dx * dx + dy * dy) > Math.max(w, h) * 0.15) { result.set(name, prevPos); continue; }
      }

      result.set(name, {
        ...prevPos,
        x: prevPos.x + (nextPos.x - prevPos.x) * t,
        y: prevPos.y + (nextPos.y - prevPos.y) * t,
        timestamp: new Date(interpMs).toISOString(),
      });
    }
    return result;
  // rafTick drives 60fps re-evaluation; eslint can't see the ref reads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rafTick, trailedPlayerNames, sortedTrailDataMap, isLive, matchStartTime, timelineValue, playbackSpeed, players, mapConfig, mapRenderDetails]);

  // Filter players and apply smooth JS interpolation for all players in replay/live-scrub.
  // Live-following uses CSS class transitions (unchanged). Trailed player uses its own interp.
  const visiblePlayers = useMemo(() => {
    if (!players || !Array.isArray(players)) return [];

    const interp = playerInterpRef.current; // read ref (rafTick keeps this fresh)
    const now = performance.now();
    const isLiveFollowing = isLive && timelineValue === 0;

    return players
      .filter((player) => {
        const team = player.team.toLowerCase();
        if (team === "allies" && !showAllies) return false;
        if (team === "axis" && !showAxis) return false;
        if (hiddenUnits.size > 0) {
          const isCommander = player.role?.toLowerCase() === "armycommander";
          if (isCommander && hiddenUnits.has(`__commander_${team}__`)) return false;
          if (!isCommander && player.unit && hiddenUnits.has(`${team}__${player.unit.toLowerCase().trim()}`)) return false;
        }
        return true;
      })
      .map((player) => {
        // JS interpolation for non-live-following, non-trailed players
        if (!isLiveFollowing && interp && !trailedPlayerNames.has(player.player_name)
            && player.x !== 0 && player.y !== 0) {
          const t = Math.min(1, (now - interp.startTime) / 1000);
          if (t < 1) {
            const fromPos = interp.from.get(player.player_name);
            if (fromPos && fromPos.x !== 0 && fromPos.y !== 0) {
              // Skip large jumps (respawn across map)
              const noMapConfig = !mapConfig || mapRenderDetails.width === 0;
              const tooFar = !noMapConfig && (() => {
                const { minX, maxX, minY, maxY } = mapConfig!.bounds;
                const w = mapRenderDetails.width, h = mapRenderDetails.height;
                const dx = ((player.x - fromPos.x) / (maxX - minX)) * w;
                const dy = ((player.y - fromPos.y) / (maxY - minY)) * h;
                return Math.sqrt(dx * dx + dy * dy) > Math.max(w, h) * 0.15;
              })();
              if (!tooFar) {
                return { ...player, x: fromPos.x + (player.x - fromPos.x) * t, y: fromPos.y + (player.y - fromPos.y) * t };
              }
            }
          }
        }

        // Override trailed players with their own RAF-interpolated positions
        if (trailedPlayerNames.has(player.player_name)) {
          const interped = trailedPlayersInterpolated.get(player.player_name);
          if (interped) return { ...player, x: interped.x, y: interped.y };
        }

        return player;
      });
  // rafTick drives 60fps re-evaluation of interp ref reads and performance.now()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rafTick, players, showAllies, showAxis, hiddenUnits, trailedPlayerNames, trailedPlayersInterpolated, isLive, timelineValue, mapConfig, mapRenderDetails]);

  // Compute trail segments per player using the smooth interpolated game time and position
  const allTrailSegments = useMemo(() => {
    if (mapRenderDetails.width === 0 || !mapConfig || trailedPlayerNames.size === 0) return [];

    const result: { name: string; segments: { px: number; py: number }[][] }[] = [];
    const { minX, maxX, minY, maxY } = mapConfig.bounds;
    const toPixel = (p: { x: number; y: number }) => ({
      px: ((p.x - minX) / (maxX - minX)) * mapRenderDetails.width,
      py: ((p.y - minY) / (maxY - minY)) * mapRenderDetails.height,
    });
    const threshold = Math.max(mapRenderDetails.width, mapRenderDetails.height) * 0.15;

    for (const name of trailedPlayerNames) {
      const sortedData = sortedTrailDataMap.get(name) ?? [];
      const interp = trailedPlayersInterpolated.get(name) ?? null;
      if (sortedData.length === 0 || !interp || (interp.x === 0 && interp.y === 0)) continue;

      const windowMinutes = trailWindowMap.get(name) ?? 3;
      const upperMs = new Date(interp.timestamp).getTime();
      const lowerBoundMs = windowMinutes > 0 ? upperMs - windowMinutes * 60 * 1000 : 0;

      const filtered = sortedData.filter((p) => {
        const tMs = new Date(p.timestamp).getTime();
        return tMs <= upperMs && (lowerBoundMs === 0 || tMs >= lowerBoundMs);
      });

      const segments: { px: number; py: number }[][] = [];
      let current: { px: number; py: number }[] = [];
      let prev: { px: number; py: number } | null = null;
      for (const p of filtered) {
        if (p.x === 0 && p.y === 0) {
          if (current.length > 1) segments.push(current);
          current = []; prev = null; continue;
        }
        const pt = toPixel(p);
        if (prev) {
          const dx = pt.px - prev.px, dy = pt.py - prev.py;
          if (Math.sqrt(dx * dx + dy * dy) > threshold) {
            if (current.length > 1) segments.push(current);
            current = [];
          }
        }
        current.push(pt);
        prev = pt;
      }
      current.push(toPixel(interp));
      if (current.length > 1) segments.push(current);
      if (segments.length > 0) result.push({ name, segments });
    }
    return result;
  }, [sortedTrailDataMap, mapRenderDetails, mapConfig, trailWindowMap, trailedPlayersInterpolated, trailedPlayerNames]);

  // Set initial map size and handle window resizing
  useEffect(() => {
    const updateMapSize = () => {
      if (imageRef.current && mapRef.current) {
        const containerWidth = mapRef.current.offsetWidth;
        const containerHeight = mapRef.current.offsetHeight;

        // Ensure we have valid dimensions
        if (containerWidth === 0 || containerHeight === 0) {
          return;
        }

        const imageAspectRatio =
          imageRef.current.naturalWidth / imageRef.current.naturalHeight;
        const containerAspectRatio = containerWidth / containerHeight;

        let renderedWidth = 0;
        let renderedHeight = 0;
        let offsetX = 0;
        let offsetY = 0;

        if (imageAspectRatio > containerAspectRatio) {
          renderedWidth = containerWidth;
          renderedHeight = containerWidth / imageAspectRatio;
          offsetY = (containerHeight - renderedHeight) / 2;
        } else {
          renderedHeight = containerHeight;
          renderedWidth = containerHeight * imageAspectRatio;
          offsetX = (containerWidth - renderedWidth) / 2;
        }

        setMapRenderDetails({
          width: renderedWidth,
          height: renderedHeight,
          offsetX,
          offsetY,
        });
      }
    };

    if (imageLoaded) {
      // Add a small delay to ensure the image is fully rendered
      const timeoutId = setTimeout(updateMapSize, 100);
      return () => clearTimeout(timeoutId);
    }

    window.addEventListener("resize", updateMapSize);
    return () => window.removeEventListener("resize", updateMapSize);
  }, [mapConfig, imageLoaded]);

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = parseFloat(e.target.value);
    setZoom(newZoom);
    if (newZoom === 1) {
      setPan({ x: 0, y: 0 }); // Reset pan on zoom reset to 1x
    }
  };

  const handleReset = () => {
    setZoom(1);
    setIconScale(1);
    setPan({ x: 0, y: 0 });
  };

  // Apply transform directly to DOM for all zoom-pan elements
  const applyTransformDirect = useCallback(
    (x: number, y: number, z: number) => {
      const el = mapRef.current;
      if (!el) return;
      const transform = `scale(${z}) translate(${x}px, ${y}px)`;
      const elements = el.querySelectorAll<HTMLElement>(".zoom-pan-layer");
      for (let i = 0; i < elements.length; i++) {
        elements[i].style.transform = transform;
      }
    },
    []
  );

  // Wheel zoom — use a ref + rAF to avoid laggy state updates per scroll tick
  const zoomRef = useRef(zoom);
  const wheelRafRef = useRef<number | null>(null);
  zoomRef.current = zoom;

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    let pendingDelta = 0;
    let lastClientX = 0;
    let lastClientY = 0;
    let lastRect: DOMRect | null = null;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      // Pinch-to-zoom on trackpad sets ctrlKey and uses smaller deltas
      const scale = e.ctrlKey ? 0.01 : 0.001;
      pendingDelta += -e.deltaY * scale;
      lastClientX = e.clientX;
      lastClientY = e.clientY;

      if (!wheelRafRef.current) {
        lastRect = el.getBoundingClientRect();
        wheelRafRef.current = requestAnimationFrame(() => {
          wheelRafRef.current = null;
          const delta = pendingDelta;
          pendingDelta = 0;

          const prev = zoomRef.current;
          const prevPan = panRef.current;
          let newZoom = Math.min(10, Math.max(1, prev * (1 + delta)));

          if (newZoom <= 1.05) {
            newZoom = 1;
            setPan({ x: 0, y: 0 });
          } else {
            const rect = lastRect!;
            const cx = lastClientX - rect.left - rect.width / 2;
            const cy = lastClientY - rect.top - rect.height / 2;
            const newPanX = cx / newZoom - (cx / prev - prevPan.x);
            const newPanY = cy / newZoom - (cy / prev - prevPan.y);
            setPan({ x: newPanX, y: newPanY });
          }
          newZoom = Math.round(newZoom * 100) / 100;
          zoomRef.current = newZoom;
          applyTransformDirect(panRef.current.x, panRef.current.y, newZoom);
          setZoom(newZoom);
        });
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
    };
  }, [applyTransformDirect, setPan]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isPanningRef.current = true;

    panStartRef.current = {
      x: e.clientX - panRef.current.x,
      y: e.clientY - panRef.current.y,
    };
    if (mapRef.current) {
      mapRef.current.style.cursor = "grabbing";
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanningRef.current) return;
      const x = e.clientX - panStartRef.current.x;
      const y = e.clientY - panStartRef.current.y;
      panRef.current = { x, y };
      if (panRafRef.current) return;
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = null;
        applyTransformDirect(
          panRef.current.x,
          panRef.current.y,
          zoomRef.current
        );
      });
    },
    [applyTransformDirect]
  );

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      setPan({ ...panRef.current });
    }
    isPanningRef.current = false;
    if (mapRef.current) {
      mapRef.current.style.cursor = "grab";
    }
    if (panRafRef.current) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
  }, [setPan]);

  // Control panel drag handlers
  const handleControlMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".control-panel-header")) {
      setIsDraggingControl(true);
      dragStartRef.current = {
        x: e.clientX - controlPosition.x,
        y: e.clientY - controlPosition.y,
      };
      e.stopPropagation();
    }
  };

  const handleControlMouseMove = (e: React.MouseEvent) => {
    if (isDraggingControl) {
      const x = e.clientX - dragStartRef.current.x;
      const y = e.clientY - dragStartRef.current.y;
      setControlPosition({ x, y });
    }
  };

  const handleControlMouseUp = () => {
    setIsDraggingControl(false);
  };

  useEffect(() => {
    if (isDraggingControl) {
      const handleGlobalMouseUp = () => setIsDraggingControl(false);
      window.addEventListener("mouseup", handleGlobalMouseUp);
      return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
    }
  }, [isDraggingControl]);

  // Memoized grid labels — 100 SVG text elements that only change on resize or zoom, not every frame
  const gridLabelElements = useMemo(() => {
    const cellW = mapRenderDetails.width / 10;
    const cellH = mapRenderDetails.height / 10;
    const fontSize = Math.max(10, cellW * 0.15) / zoom;
    return Array.from({ length: 10 }, (_, col) =>
      Array.from({ length: 10 }, (_, row) => {
        const label = `${String.fromCharCode(65 + col)}${row}`;
        return (
          <text
            key={`gl-${col}-${row}`}
            x={col * cellW + 4 / zoom}
            y={row * cellH + fontSize + 2 / zoom}
            fill="rgba(255,255,255,0.35)"
            fontSize={fontSize}
            fontFamily="monospace"
            fontWeight="bold"
          >
            {label}
          </text>
        );
      })
    );
  }, [mapRenderDetails.width, mapRenderDetails.height, zoom]);

  // O(1) player lookup map — avoids O(n) Array.find() inside kill event filter
  const playersByName = useMemo(() => {
    const m = new Map<string, PlayerPosition>();
    if (players) for (const p of players) m.set(p.player_name, p);
    return m;
  }, [players]);

  // Filter kill events based on timeline and killer role
  const visibleKillEvents = useMemo(() => {
    if (!killEvents || !Array.isArray(killEvents)) {
      return [];
    }

    if (!matchStartTime) return [];

    // In history mode, timeline 0 means no events should be shown yet
    if (timelineValue === 0 && !isLive) {
      return [];
    }

    if (timelineValue === undefined) return [];

    const matchStartTimeMs = new Date(matchStartTime).getTime();
    // In live mode with timeline at 0, use current time; otherwise use timeline-based time
    const currentTimeMs =
      isLive && timelineValue === 0
        ? Date.now()
        : matchStartTimeMs + timelineValue * 1000;

    const filtered = killEvents.filter((killEvent) => {
      const eventTimeMs = new Date(killEvent.timestamp).getTime();
      const timeSinceKill = currentTimeMs - eventTimeMs;

      // Show kill lines for 2 seconds (2000ms) after the kill
      const isWithinTimeWindow =
        eventTimeMs <= currentTimeMs && timeSinceKill <= 2000;

      if (!isWithinTimeWindow) {
        return false;
      }

      // Filter out kill events from players with excluded roles
      const excludedRoles = ["crewman", "gunner", "armycommander", "tankcommander"];

      // Find the killer's current role from player positions
      const killerPlayer = playersByName.get(killEvent.killer_name);

      // If we can't find the killer's role, show the kill line (default to showing)
      if (!killerPlayer || !killerPlayer.role) {
        return true;
      }

      // Don't show kill lines for excluded roles
      return !excludedRoles.includes(killerPlayer.role.toLowerCase());
    });

    return filtered;
  }, [
    killEvents,
    timelineValue,
    matchStartTime,
    deathOverlays?.length,
    playersByName,
    isLive,
  ]);

  // Filter and cluster spawn events based on timeline
  const visibleSpawns = useMemo(() => {
    if (!spawnPositions || !Array.isArray(spawnPositions)) {
      return [];
    }

    // In history mode, timeline 0 means no events should be shown yet
    if (timelineValue === 0 && !isLive) {
      return [];
    }

    let filtered: SpawnEvent[];

    // In live mode, show all spawns
    if (timelineValue === 0 && isLive) {
      filtered = spawnPositions;
    } else if (!matchStartTime) {
      return [];
    } else {
      const matchStartTimeMs = new Date(matchStartTime).getTime();
      const currentTimeMs = matchStartTimeMs + timelineValue * 1000;

      filtered = spawnPositions.filter((spawn) => {
        const spawnTimeMs = new Date(spawn.timestamp).getTime();
        const timeSinceSpawn = currentTimeMs - spawnTimeMs;

        // Show spawn markers for 60 seconds after spawn
        return spawnTimeMs <= currentTimeMs && timeSinceSpawn <= 60000;
      });
    }

    // Cluster nearby spawns of the same team to avoid overlapping markers
    // Uses same distance threshold as backend (2000 game units = 20m)
    // Use squared distance to avoid Math.sqrt() on every comparison
    const CLUSTER_DISTANCE = 2000;
    const CLUSTER_DISTANCE_SQ = CLUSTER_DISTANCE * CLUSTER_DISTANCE;
    const clustered: SpawnEvent[] = [];

    for (const spawn of filtered) {
      if (spawn.position_x == null || spawn.position_y == null) continue;

      const existingCluster = clustered.find((c) => {
        if (c.spawn_team !== spawn.spawn_team) return false;
        if (c.position_x == null || c.position_y == null) return false;
        const dx = c.position_x - spawn.position_x!;
        const dy = c.position_y - spawn.position_y!;
        return dx * dx + dy * dy <= CLUSTER_DISTANCE_SQ;
      });

      if (!existingCluster) {
        clustered.push(spawn);
      }
      // If a cluster already exists, skip this spawn (keep the first seen)
    }

    return clustered;
  }, [spawnPositions, timelineValue, matchStartTime, isLive]);

  // Helper function to convert game coordinates to map pixel coordinates
  const gameToMapCoords = (x: number, y: number) => {
    if (!mapConfig) return { x: 0, y: 0 };

    const mapWidth = mapRenderDetails.width;
    const mapHeight = mapRenderDetails.height;

    // Return 0,0 if map dimensions are not yet calculated
    if (mapWidth === 0 || mapHeight === 0) {
      return { x: 0, y: 0 };
    }

    const { minX, maxX, minY, maxY } = mapConfig.bounds;

    const mapX = ((x - minX) / (maxX - minX)) * mapWidth;
    const mapY = ((y - minY) / (maxY - minY)) * mapHeight;

    return { x: mapX, y: mapY };
  };

  if (!mapConfig) {
    return (
      <div className="map-viewer-error">
        <p>Map configuration not found for: {mapName}</p>
      </div>
    );
  }

  return (
    <div className="map-viewer">
      <div
        className="map-container"
        ref={mapRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: "grab" }}
      >
        <img
          ref={imageRef}
          src={
            useCleanMap && mapConfig.imageUrlClean
              ? mapConfig.imageUrlClean
              : mapConfig.imageUrl
          }
          className="map-image zoom-pan-layer"
          alt={mapConfig.displayName}
          onLoad={() => setImageLoaded(true)}
          style={{
            opacity: imageLoaded ? 1 : 0,
            transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
          }}
        />

        {/* Grid Overlay */}
        {imageLoaded && showGrid && mapRenderDetails.width > 0 && (
          <div
            className="grid-overlay zoom-pan-layer"
            style={{
              width: `${mapRenderDetails.width}px`,
              height: `${mapRenderDetails.height}px`,
              top: `${mapRenderDetails.offsetY}px`,
              left: `${mapRenderDetails.offsetX}px`,
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
              position: "absolute",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <svg
              width={mapRenderDetails.width}
              height={mapRenderDetails.height}
              style={{ position: "absolute", top: 0, left: 0 }}
            >
              {/* Territory coloring based on score */}
              {(() => {
                if (!mapConfig.spawns) return null;
                const w = mapRenderDetails.width;
                const h = mapRenderDetails.height;
                const isHorizontal =
                  mapConfig.spawns.allies === "left" ||
                  mapConfig.spawns.allies === "right";
                const alliesFirst =
                  mapConfig.spawns.allies === "left" ||
                  mapConfig.spawns.allies === "top";
                // Each score point = 2 grid cells (5 sectors across 10 cells)
                const alliesCells = score.allies * 2;
                const axisCells = score.axis * 2;
                const rects = [];

                if (isHorizontal) {
                  const cellW = w / 10;
                  // Allies territory
                  if (alliesCells > 0) {
                    const ax = alliesFirst ? 0 : w - alliesCells * cellW;
                    rects.push(
                      <rect
                        key="territory-allies"
                        x={ax}
                        y={0}
                        width={alliesCells * cellW}
                        height={h}
                        fill="rgba(65, 105, 225, 0.25)"
                      />
                    );
                  }
                  // Axis territory
                  if (axisCells > 0) {
                    const xx = alliesFirst ? w - axisCells * cellW : 0;
                    rects.push(
                      <rect
                        key="territory-axis"
                        x={xx}
                        y={0}
                        width={axisCells * cellW}
                        height={h}
                        fill="rgba(220, 38, 38, 0.25)"
                      />
                    );
                  }
                } else {
                  const cellH = h / 10;
                  // Allies territory
                  if (alliesCells > 0) {
                    const ay = alliesFirst ? 0 : h - alliesCells * cellH;
                    rects.push(
                      <rect
                        key="territory-allies"
                        x={0}
                        y={ay}
                        width={w}
                        height={alliesCells * cellH}
                        fill="rgba(65, 105, 225, 0.25)"
                      />
                    );
                  }
                  // Axis territory
                  if (axisCells > 0) {
                    const xy = alliesFirst ? h - axisCells * cellH : 0;
                    rects.push(
                      <rect
                        key="territory-axis"
                        x={0}
                        y={xy}
                        width={w}
                        height={axisCells * cellH}
                        fill="rgba(220, 38, 38, 0.25)"
                      />
                    );
                  }
                }
                return rects;
              })()}

              {/* Grid lines */}
              {Array.from({ length: 9 }, (_, i) => {
                const x = ((i + 1) / 10) * mapRenderDetails.width;
                return (
                  <line
                    key={`gv-${i}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={mapRenderDetails.height}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={2.5 / zoom}
                  />
                );
              })}
              {Array.from({ length: 9 }, (_, i) => {
                const y = ((i + 1) / 10) * mapRenderDetails.height;
                return (
                  <line
                    key={`gh-${i}`}
                    x1={0}
                    y1={y}
                    x2={mapRenderDetails.width}
                    y2={y}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={2.5 / zoom}
                  />
                );
              })}
              {/* Grid labels — memoized, only recalculated on resize or zoom */}
              {gridLabelElements}
            </svg>
          </div>
        )}

        {/* Capture point circle overlays (rendered on clean map base) */}
        {imageLoaded &&
          (forceShowStrongPoints || (useCleanMap && mapConfig.imageUrlClean)) &&
          strongPoints.length > 0 &&
          mapRenderDetails.width > 0 && (
            <div
              className="sp-overlay-container zoom-pan-layer"
              style={{
                width: `${mapRenderDetails.width}px`,
                height: `${mapRenderDetails.height}px`,
                top: `${mapRenderDetails.offsetY}px`,
                left: `${mapRenderDetails.offsetX}px`,
                transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                position: "absolute",
                pointerEvents: spUnlocked ? "auto" : "none",
                zIndex: spUnlocked ? 50 : 2,
              }}
              onMouseMove={(e) => {
                if (!spUnlocked || !spDragStartRef.current) return;
                const activeIdx = draggingSPIndex ?? resizingSPIndex;
                if (activeIdx === null) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const scaleX = mapRenderDetails.width / rect.width;
                const scaleY = mapRenderDetails.height / rect.height;
                const mouseX = (e.clientX - rect.left) * scaleX;
                const mouseY = (e.clientY - rect.top) * scaleY;

                if (resizingSPIndex !== null) {
                  // Resize: distance from center determines new radius
                  const ref = spDragStartRef.current;
                  const dx = mouseX - ref.centerX!;
                  const dy = mouseY - ref.centerY!;
                  const distPx = Math.sqrt(dx * dx + dy * dy);
                  const mapSize = Math.max(
                    mapRenderDetails.width,
                    mapRenderDetails.height
                  );
                  const newR = Math.max(0.01, Math.min(0.12, distPx / mapSize));
                  setSpOverrides((prev) => ({
                    ...prev,
                    [resizingSPIndex]: {
                      ...prev[resizingSPIndex],
                      r: newR,
                    },
                  }));
                } else if (draggingSPIndex !== null) {
                  // Move
                  const dx = mouseX - spDragStartRef.current.mouseX;
                  const dy = mouseY - spDragStartRef.current.mouseY;
                  const newPx = spDragStartRef.current.cpX + dx;
                  const newPy = spDragStartRef.current.cpY + dy;
                  const gameCoords = mapToGameCoords(newPx, newPy);
                  setSpOverrides((prev) => ({
                    ...prev,
                    [draggingSPIndex]: {
                      ...prev[draggingSPIndex],
                      x: gameCoords.x,
                      y: gameCoords.y,
                    },
                  }));
                }
              }}
              onMouseUp={() => {
                setDraggingSPIndex(null);
                setResizingSPIndex(null);
                spDragStartRef.current = null;
              }}
              onMouseLeave={() => {
                setDraggingSPIndex(null);
                setResizingSPIndex(null);
                spDragStartRef.current = null;
              }}
            >
              <svg
                width={mapRenderDetails.width}
                height={mapRenderDetails.height}
                style={{ position: "absolute", top: 0, left: 0 }}
              >
                {/* Hatching pattern for strongpoint circles */}
                <defs>
                  <pattern
                    id="sp-hatch"
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(0)"
                  >
                    <line
                      x1="0"
                      y1="4"
                      x2="8"
                      y2="4"
                      stroke="rgba(60, 50, 40, 0.7)"
                      strokeWidth="1.5"
                    />
                  </pattern>
                  <pattern
                    id="sp-hatch-edit"
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(0)"
                  >
                    <line
                      x1="0"
                      y1="4"
                      x2="8"
                      y2="4"
                      stroke="rgba(0, 140, 255, 0.4)"
                      strokeWidth="1.5"
                    />
                  </pattern>
                </defs>
                {strongPoints.map((cp, i) => {
                  if (hiddenSPs.has(i)) return null;
                  const pos = gameToMapCoords(cp.x, cp.y);
                  const mapSize = Math.max(
                    mapRenderDetails.width,
                    mapRenderDetails.height
                  );
                  const rFrac = cp.r ?? 0.035;
                  const r = mapSize * rFrac;
                  const defaultR = mapSize * 0.035;
                  const fontSize = Math.max(6, defaultR * 0.32);
                  const strokeW = Math.max(1.5, defaultR * 0.05);
                  const isBeingDragged = draggingSPIndex === i;
                  const isBeingResized = resizingSPIndex === i;
                  const edgeWidth = Math.max(4, defaultR * 0.15);
                  return (
                    <g key={`sp-${i}`}>
                      {/* Circle fill with hatching */}
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={r}
                        fill={
                          spUnlocked ? "url(#sp-hatch-edit)" : "url(#sp-hatch)"
                        }
                        stroke={
                          spUnlocked
                            ? isBeingDragged
                              ? "#ffcc00"
                              : "#00aaff"
                            : "rgba(0, 0, 0, 0.9)"
                        }
                        strokeWidth={spUnlocked ? 2 : strokeW}
                        style={{
                          cursor: spUnlocked
                            ? isBeingDragged
                              ? "grabbing"
                              : "grab"
                            : "default",
                        }}
                        onMouseDown={(e) => {
                          if (!spUnlocked) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const svgRect = e.currentTarget
                            .closest("svg")!
                            .getBoundingClientRect();
                          const scaleX = mapRenderDetails.width / svgRect.width;
                          const scaleY =
                            mapRenderDetails.height / svgRect.height;
                          const mouseX = (e.clientX - svgRect.left) * scaleX;
                          const mouseY = (e.clientY - svgRect.top) * scaleY;
                          // If click is near the edge, resize instead of move
                          const dx = mouseX - pos.x;
                          const dy = mouseY - pos.y;
                          const dist = Math.sqrt(dx * dx + dy * dy);
                          if (dist > r * 0.75) {
                            setResizingSPIndex(i);
                            spDragStartRef.current = {
                              mouseX: 0,
                              mouseY: 0,
                              cpX: pos.x,
                              cpY: pos.y,
                              startR: rFrac,
                              centerX: pos.x,
                              centerY: pos.y,
                            };
                          } else {
                            setDraggingSPIndex(i);
                            spDragStartRef.current = {
                              mouseX,
                              mouseY,
                              cpX: pos.x,
                              cpY: pos.y,
                            };
                          }
                        }}
                      />
                      {/* Resize ring indicator (only when unlocked) */}
                      {spUnlocked && (
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={r}
                          fill="none"
                          stroke={
                            isBeingResized
                              ? "#ffcc00"
                              : "rgba(0, 170, 255, 0.3)"
                          }
                          strokeWidth={edgeWidth * 0.5}
                          strokeDasharray="4 3"
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                      {/* Text label above circle — white with black outline */}
                      <text
                        x={pos.x}
                        y={pos.y - r - fontSize * 0.9}
                        textAnchor="middle"
                        fill="rgba(255, 255, 255, 0.85)"
                        fontSize={fontSize}
                        fontFamily="sans-serif"
                        fontWeight="bold"
                        stroke="rgba(0, 0, 0, 0.9)"
                        strokeWidth={fontSize * 0.15}
                        paintOrder="stroke"
                        style={{ pointerEvents: "none" }}
                      >
                        {cp.name.toUpperCase()}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

        {imageLoaded && mapRenderDetails.width > 0 && (
          <div
            className="interactive-elements-container zoom-pan-layer"
            style={{
              width: `${mapRenderDetails.width}px`,
              height: `${mapRenderDetails.height}px`,
              top: `${mapRenderDetails.offsetY}px`,
              left: `${mapRenderDetails.offsetX}px`,
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
            }}
          >
            {/* Player Dots */}
            {visiblePlayers.map((player) => (
              <PlayerDot
                key={`${player.player_name}-${player.team}`}
                player={player}
                mapWidth={mapRenderDetails.width}
                mapHeight={mapRenderDetails.height}
                minX={mapConfig.bounds.minX}
                maxX={mapConfig.bounds.maxX}
                minY={mapConfig.bounds.minY}
                maxY={mapConfig.bounds.maxY}
                iconScale={iconScale}
                showName={showPlayerNames}
                deathOverlays={deathOverlays}
                timelineValue={timelineValue}
                matchStartTime={matchStartTime}
                isLive={isLive}
                zoom={zoom}
                onMessagePlayer={
                  isLive && serverId ? handleMessagePlayer : undefined
                }
                onPunishPlayer={
                  isLive && serverId ? handlePunishPlayer : undefined
                }
                onKickPlayer={isLive && serverId ? handleKickPlayer : undefined}
                onTrailPlayer={handleTrailPlayer}
                isTrailed={trailedPlayerNames.has(player.player_name)}
                trailWindowMinutes={trailWindowMap.get(player.player_name) ?? 3}
                onTrailWindowChange={(minutes) =>
                  setTrailWindowMap(prev => new Map([...prev, [player.player_name, minutes]]))
                }
                snapSerial={snapSerial}
              />
            ))}

            {/* Spawn Markers */}
            {showSpawnsState &&
              visibleSpawns.map((spawn) => (
                <SpawnMarker
                  key={`spawn-${spawn.id || ""}-${spawn.position_x}-${
                    spawn.position_y
                  }-${spawn.spawn_team}`}
                  spawn={spawn}
                  mapConfig={mapConfig}
                  zoom={zoom}
                  iconScale={iconScale}
                  gameToMapCoords={gameToMapCoords}
                />
              ))}
          </div>
        )}

        {/* Player Trail SVG */}
        {imageLoaded && allTrailSegments.length > 0 && (
          <div
            className="zoom-pan-layer"
            style={{
              position: "absolute",
              width: `${mapRenderDetails.width}px`,
              height: `${mapRenderDetails.height}px`,
              top: `${mapRenderDetails.offsetY}px`,
              left: `${mapRenderDetails.offsetX}px`,
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
              pointerEvents: "none",
              zIndex: 3,
            }}
          >
            <svg
              width={mapRenderDetails.width}
              height={mapRenderDetails.height}
              style={{ position: "absolute", top: 0, left: 0 }}
            >
              {allTrailSegments.flatMap(({ name, segments }) =>
                segments.map((seg, si) => (
                  <path
                    key={`${name}-${si}`}
                    d={catmullRomPath(seg)}
                    fill="none"
                    stroke="#00e5ff"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                ))
              )}
            </svg>
          </div>
        )}

        {/* Kill Lines SVG */}
        {imageLoaded && visibleKillEvents.length > 0 && (
          <div
            className="kill-lines-container zoom-pan-layer"
            style={{
              width: `${mapRenderDetails.width}px`,
              height: `${mapRenderDetails.height}px`,
              top: `${mapRenderDetails.offsetY}px`,
              left: `${mapRenderDetails.offsetX}px`,
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
              position: "absolute",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <svg
              width={mapRenderDetails.width}
              height={mapRenderDetails.height}
              style={{ position: "absolute", top: 0, left: 0 }}
            >
              {visibleKillEvents.map((killEvent, index) => {
                const killerPos = gameToMapCoords(
                  killEvent.position_x || 0,
                  killEvent.position_y || 0
                );
                const victimPos = gameToMapCoords(
                  killEvent.victim_x || 0,
                  killEvent.victim_y || 0
                );

                return (
                  <line
                    key={`kill-${killEvent.id}-${index}`}
                    x1={killerPos.x}
                    y1={killerPos.y}
                    x2={victimPos.x}
                    y2={victimPos.y}
                    stroke="#ff0000"
                    strokeWidth="2"
                    opacity="0.6"
                    className="kill-line"
                  />
                );
              })}
            </svg>
          </div>
        )}

        <div
          className={`map-control-panel ${isMinimized ? "minimized" : ""} ${
            isDraggingControl ? "dragging" : ""
          } ${controlDocked ? "docked" : ""}`}
          ref={controlPanelRef}
          onMouseDown={controlDocked ? undefined : handleControlMouseDown}
          onMouseMove={controlDocked ? undefined : handleControlMouseMove}
          onMouseUp={controlDocked ? undefined : handleControlMouseUp}
          style={controlDocked ? undefined : {
            transform: `translate(${controlPosition.x}px, ${controlPosition.y}px)`,
            cursor: isDraggingControl ? "grabbing" : "default",
          }}
        >
          <div className="control-panel-header" style={{ cursor: controlDocked ? "default" : "grab" }}>
            <h3>Map Controls</h3>
            <div className="control-panel-header-buttons">
              <button
                className="minimize-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setControlDocked(!controlDocked);
                  if (!controlDocked) setControlPosition({ x: 0, y: 0 });
                }}
                title={controlDocked ? "Undock panel" : "Dock to right"}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {controlDocked ? (
                    <>
                      <rect x="1" y="1" width="10" height="10" rx="1" />
                      <line x1="4" y1="4" x2="8" y2="8" />
                      <line x1="8" y1="4" x2="4" y2="8" />
                    </>
                  ) : (
                    <>
                      <rect x="1" y="1" width="10" height="10" rx="1" />
                      <line x1="7" y1="1" x2="7" y2="11" />
                    </>
                  )}
                </svg>
              </button>
              <button
                className="minimize-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMinimized(!isMinimized);
                }}
                title={isMinimized ? "Expand" : "Minimize"}
              >
                {isMinimized ? "▲" : "▼"}
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              <div className="control-section">
                <h4>Team Visibility</h4>

                {/* Allies row + collapsible squad list */}
                <div className="team-filter-row">
                  <label className="control-checkbox">
                    <input
                      type="checkbox"
                      checked={showAllies}
                      onChange={(e) => setShowAllies(e.target.checked)}
                    />
                    <span className="checkbox-label">
                      <span className="team-indicator allies"></span>
                      Show Allies
                    </span>
                  </label>
                  {(availableSquads.allies.units.length > 0 || availableSquads.allies.hasCommander) && (
                    <button
                      className="minimize-button"
                      onClick={() => setSquadsAlliesOpen((v) => !v)}
                      title={!showAllies ? "Enable Allies first" : squadsAlliesOpen ? "Collapse" : "Expand"}
                      disabled={!showAllies}
                    >
                      {squadsAlliesOpen ? "▼" : "▲"}
                    </button>
                  )}
                </div>
                {squadsAlliesOpen && (
                  <div className={`squad-sub-list${!showAllies ? " squad-sub-list--disabled" : ""}`}>
                    <div className="sp-toggle-all">
                      <button
                        className="sp-toggle-btn"
                        disabled={!showAllies}
                        onClick={() => setHiddenUnits((prev) => {
                          const next = new Set(prev);
                          availableSquads.allies.units.forEach((u) => next.delete(`allies__${u}`));
                          next.delete("__commander_allies__");
                          return next;
                        })}
                      >All</button>
                      <button
                        className="sp-toggle-btn"
                        disabled={!showAllies}
                        onClick={() => setHiddenUnits((prev) => {
                          const next = new Set(prev);
                          availableSquads.allies.units.forEach((u) => next.add(`allies__${u}`));
                          if (availableSquads.allies.hasCommander) next.add("__commander_allies__");
                          return next;
                        })}
                      >None</button>
                    </div>
                    {availableSquads.allies.hasCommander && (
                      <label className="control-checkbox">
                        <input
                          type="checkbox"
                          disabled={!showAllies}
                          checked={!hiddenUnits.has("__commander_allies__")}
                          onChange={(e) => {
                            setHiddenUnits((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete("__commander_allies__");
                              else next.add("__commander_allies__");
                              return next;
                            });
                          }}
                        />
                        <span className="checkbox-label">
                          <span className="squad-color-dot" style={{ backgroundColor: "#FFD700" }} />
                          Commander
                        </span>
                      </label>
                    )}
                    {availableSquads.allies.units.map((unit) => (
                      <label key={unit} className="control-checkbox">
                        <input
                          type="checkbox"
                          disabled={!showAllies}
                          checked={!hiddenUnits.has(`allies__${unit}`)}
                          onChange={(e) => {
                            setHiddenUnits((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(`allies__${unit}`);
                              else next.add(`allies__${unit}`);
                              return next;
                            });
                          }}
                        />
                        <span className="checkbox-label">
                          <span className="squad-color-dot" style={{ backgroundColor: getSquadColor(unit) }} />
                          {unit.charAt(0).toUpperCase() + unit.slice(1)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {/* Axis row + collapsible squad list */}
                <div className="team-filter-row">
                  <label className="control-checkbox">
                    <input
                      type="checkbox"
                      checked={showAxis}
                      onChange={(e) => setShowAxis(e.target.checked)}
                    />
                    <span className="checkbox-label">
                      <span className="team-indicator axis"></span>
                      Show Axis
                    </span>
                  </label>
                  {(availableSquads.axis.units.length > 0 || availableSquads.axis.hasCommander) && (
                    <button
                      className="minimize-button"
                      onClick={() => setSquadsAxisOpen((v) => !v)}
                      title={!showAxis ? "Enable Axis first" : squadsAxisOpen ? "Collapse" : "Expand"}
                      disabled={!showAxis}
                    >
                      {squadsAxisOpen ? "▼" : "▲"}
                    </button>
                  )}
                </div>
                {squadsAxisOpen && (
                  <div className={`squad-sub-list${!showAxis ? " squad-sub-list--disabled" : ""}`}>
                    <div className="sp-toggle-all">
                      <button
                        className="sp-toggle-btn"
                        disabled={!showAxis}
                        onClick={() => setHiddenUnits((prev) => {
                          const next = new Set(prev);
                          availableSquads.axis.units.forEach((u) => next.delete(`axis__${u}`));
                          next.delete("__commander_axis__");
                          return next;
                        })}
                      >All</button>
                      <button
                        className="sp-toggle-btn"
                        disabled={!showAxis}
                        onClick={() => setHiddenUnits((prev) => {
                          const next = new Set(prev);
                          availableSquads.axis.units.forEach((u) => next.add(`axis__${u}`));
                          if (availableSquads.axis.hasCommander) next.add("__commander_axis__");
                          return next;
                        })}
                      >None</button>
                    </div>
                    {availableSquads.axis.hasCommander && (
                      <label className="control-checkbox">
                        <input
                          type="checkbox"
                          disabled={!showAxis}
                          checked={!hiddenUnits.has("__commander_axis__")}
                          onChange={(e) => {
                            setHiddenUnits((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete("__commander_axis__");
                              else next.add("__commander_axis__");
                              return next;
                            });
                          }}
                        />
                        <span className="checkbox-label">
                          <span className="squad-color-dot" style={{ backgroundColor: "#FFD700" }} />
                          Commander
                        </span>
                      </label>
                    )}
                    {availableSquads.axis.units.map((unit) => (
                      <label key={unit} className="control-checkbox">
                        <input
                          type="checkbox"
                          disabled={!showAxis}
                          checked={!hiddenUnits.has(`axis__${unit}`)}
                          onChange={(e) => {
                            setHiddenUnits((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.delete(`axis__${unit}`);
                              else next.add(`axis__${unit}`);
                              return next;
                            });
                          }}
                        />
                        <span className="checkbox-label">
                          <span className="squad-color-dot" style={{ backgroundColor: getSquadColor(unit) }} />
                          {unit.charAt(0).toUpperCase() + unit.slice(1)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <label className="control-checkbox">
                  <input
                    type="checkbox"
                    checked={showPlayerNames}
                    onChange={(e) => setShowPlayerNames(e.target.checked)}
                  />
                  <span className="checkbox-label">Show Player Names</span>
                </label>
                <label className="control-checkbox">
                  <input
                    type="checkbox"
                    checked={showSpawnsState}
                    onChange={(e) => setShowSpawnsState(e.target.checked)}
                  />
                  <span className="checkbox-label">Show Spawns</span>
                </label>
                <label className="control-checkbox">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  <span className="checkbox-label">Show Grid</span>
                </label>
                {forceShowStrongPoints && mapConfig.imageUrlClean && (
                  <label className="control-checkbox">
                    <input
                      type="checkbox"
                      checked={useCleanMap}
                      onChange={(e) => setUseCleanMap(e.target.checked)}
                    />
                    <span className="checkbox-label">Clean Map</span>
                  </label>
                )}
              </div>

              <hr className="controls-divider" />

              {/* Strong Points toggle */}
              {(forceShowStrongPoints || (useCleanMap && mapConfig.imageUrlClean)) &&
                strongPoints.length > 0 && (
                  <div className="control-section">
                    <div className="control-section-header">
                      <h4>Strong Points</h4>
                      <button
                        className="minimize-button"
                        onClick={() => setStrongPointsOpen((v) => !v)}
                        title={strongPointsOpen ? "Collapse" : "Expand"}
                      >
                        {strongPointsOpen ? "▼" : "▲"}
                      </button>
                    </div>
                    {strongPointsOpen && <div className="sp-toggle-all">
                      <button
                        className="sp-toggle-btn"
                        onClick={() => setHiddenSPs(new Set())}
                      >
                        All
                      </button>
                      <button
                        className="sp-toggle-btn"
                        onClick={() =>
                          setHiddenSPs(new Set(strongPoints.map((_, i) => i)))
                        }
                      >
                        None
                      </button>
                      {!forceShowStrongPoints && matchId && (
                        <button
                          className={`sp-toggle-btn ${
                            savedSPs ? "sp-saved" : ""
                          }`}
                          disabled={spSaving}
                          onClick={async () => {
                            if (!matchId) return;
                            setSpSaving(true);
                            const activeSPs = strongPoints
                              .filter((_, i) => !hiddenSPs.has(i))
                              .map((cp) => ({
                                name: cp.name,
                                x: cp.x,
                                y: cp.y,
                                ...(cp.r != null ? { r: cp.r } : {}),
                              }));
                            try {
                              await apiClient.saveMatchStrongPoints(
                                matchId,
                                activeSPs
                              );
                              setSavedSPs(activeSPs);
                            } catch (err) {
                              console.error("Failed to save match SPs:", err);
                            } finally {
                              setSpSaving(false);
                            }
                          }}
                        >
                          {spSaving ? "..." : savedSPs ? "Set ✓" : "Set"}
                        </button>
                      )}
                      {forceShowStrongPoints && (
                        <button
                          className={`sp-toggle-btn ${
                            spUnlocked ? "sp-unlocked" : ""
                          }`}
                          onClick={async () => {
                            if (spUnlocked) {
                              // Saving — write to maps.ts via dev server
                              if (mapConfig) {
                                const finalSPs = strongPoints.map((cp) => ({
                                  name: cp.name,
                                  x: cp.x,
                                  y: cp.y,
                                  ...(cp.r != null
                                    ? { r: Math.round(cp.r * 1000) / 1000 }
                                    : {}),
                                }));
                                try {
                                  const res = await fetch(
                                    "/__dev/save-strong-points",
                                    {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        mapKey: mapConfig.name,
                                        strongPoints: finalSPs,
                                      }),
                                    }
                                  );
                                  if (res.ok) {
                                    console.log(
                                      `Saved ${finalSPs.length} SPs for ${mapConfig.displayName} to maps.ts`
                                    );
                                  } else {
                                    console.error(
                                      "Failed to save SPs:",
                                      await res.text()
                                    );
                                  }
                                } catch (err) {
                                  console.error("Failed to save SPs:", err);
                                }
                              }
                              setSpOverrides({});
                              setSpUnlocked(false);
                            } else {
                              setSpUnlocked(true);
                            }
                          }}
                        >
                          {spUnlocked ? "Save" : "Edit"}
                        </button>
                      )}
                      {forceShowStrongPoints && spUnlocked && Object.keys(spOverrides).length > 0 && (
                        <button
                          className="sp-toggle-btn sp-reset-btn"
                          onClick={() => setSpOverrides({})}
                        >
                          Discard
                        </button>
                      )}
                    </div>}
                    {strongPointsOpen && forceShowStrongPoints && spUnlocked && (
                      <div className="sp-unlock-hint">
                        Drag strong points to reposition.
                      </div>
                    )}
                    {strongPointsOpen && <div className="checkboxes-container sp-list">
                      {strongPoints.map((cp, i) => (
                        <label
                          key={`sp-toggle-${i}`}
                          className="control-checkbox sp-checkbox"
                        >
                          <input
                            type="checkbox"
                            checked={!hiddenSPs.has(i)}
                            onChange={(e) => {
                              setHiddenSPs((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) {
                                  next.delete(i);
                                } else {
                                  next.add(i);
                                }
                                return next;
                              });
                            }}
                          />
                          <span className="checkbox-label">{cp.name}</span>
                        </label>
                      ))}
                    </div>}
                  </div>
                )}

              <hr className="controls-divider" />

              <div className="sliders-container">
                <div className="control-section">
                  <h4>Zoom Level</h4>
                  <div className="zoom-control">
                    <div className="zoom-slider-labels">
                      <span className="zoom-label">10x</span>
                      <span className="zoom-label">1x</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="0.1"
                      value={zoom}
                      onChange={handleZoomChange}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="zoom-slider"
                    />
                    <div className="zoom-value">{zoom.toFixed(1)}x</div>
                  </div>
                </div>

                <div className="control-section">
                  <h4>Icon Scale</h4>
                  <div className="zoom-control">
                    <div className="zoom-slider-labels">
                      <span className="zoom-label">2x</span>
                      <span className="zoom-label">0.2x</span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="2"
                      step="0.1"
                      value={iconScale}
                      onChange={(e) => setIconScale(parseFloat(e.target.value))}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="zoom-slider"
                    />
                    <div className="zoom-value">{iconScale.toFixed(1)}x</div>
                  </div>
                </div>
              </div>

              <button className="reset-button" onClick={handleReset}>
                Reset View
              </button>

              <div className="map-legend-inline">
                <h4 className="legend-title">Map Legend</h4>
                <div className="legend-items">
                  <div className="legend-item">
                    <div className="legend-dot allies"></div>
                    <span>Allies</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-dot axis"></div>
                    <span>Axis</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Message player dialog */}
      {messageTarget && (
        <div
          className="message-dialog-overlay"
          onClick={() => setMessageTarget(null)}
        >
          <div className="message-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="message-dialog-header">
              <span>Message: {messageTarget}</span>
              <button
                className="message-dialog-close"
                onClick={() => setMessageTarget(null)}
              >
                ×
              </button>
            </div>
            {messageSent ? (
              <div className="message-dialog-body message-dialog-sent">
                Sent!
              </div>
            ) : (
              <div className="message-dialog-body">
                <input
                  ref={messageInputRef}
                  type="text"
                  className="message-dialog-input"
                  placeholder="Type a message..."
                  maxLength={200}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !messageSending)
                      handleSendMessage();
                    if (e.key === "Escape") setMessageTarget(null);
                  }}
                  disabled={messageSending}
                />
                <button
                  className="message-dialog-send"
                  onClick={handleSendMessage}
                  disabled={messageSending || !messageText.trim()}
                >
                  {messageSending ? "..." : "Send"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirm punish/kick dialog */}
      {confirmAction && (
        <div
          className="message-dialog-overlay"
          onClick={() => setConfirmAction(null)}
        >
          <div className="message-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="message-dialog-header">
              <span>
                {confirmAction.type === "punish" ? "Punish" : "Kick"}:{" "}
                {confirmAction.playerName}
              </span>
              <button
                className="message-dialog-close"
                onClick={() => setConfirmAction(null)}
              >
                ×
              </button>
            </div>
            <div className="message-dialog-body confirm-action-body">
              <span className="confirm-action-text">
                Are you sure you want to {confirmAction.type}{" "}
                <strong>{confirmAction.playerName}</strong>?
              </span>
              <div className="confirm-action-btns">
                <button
                  className="confirm-action-cancel"
                  onClick={() => setConfirmAction(null)}
                  disabled={confirmLoading}
                >
                  Cancel
                </button>
                <button
                  className={`confirm-action-confirm confirm-action-${confirmAction.type}`}
                  onClick={handleConfirmAction}
                  disabled={confirmLoading}
                >
                  {confirmLoading
                    ? "..."
                    : confirmAction.type === "punish"
                    ? "Punish"
                    : "Kick"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
