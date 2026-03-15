import { useEffect, useRef, useState, memo, useMemo, useCallback } from "react";
import type {
  PlayerPosition,
  KillEvent,
  DeathOverlay,
  SpawnEvent,
  MapConfig,
} from "../types";
import { getMapConfig, getDefaultStrongPoints } from "../config/maps";
import { apiClient } from "../services/api";
import { getTeamClass, getSquadColor } from "../utils";
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
  }) => {
    const dotRef = useRef<HTMLDivElement>(null);
    const prevPosRef = useRef<{ x: number; y: number } | null>(null);

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

    // Detect large position jumps (respawn/teleport) and disable transition
    // so the player dot appears at the new position instantly
    useEffect(() => {
      if (isDeadOrRedeploying) return;
      const prev = prevPosRef.current;
      if (prev && dotRef.current) {
        const dx = x - prev.x;
        const dy = y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // If pixel distance > 15% of map size, it's a respawn — skip transition
        const threshold = Math.max(mapWidth, mapHeight) * 0.15;
        if (dist > threshold) {
          const el = dotRef.current;
          el.style.transition = "none";
          // Force reflow so the browser applies the position without transition
          el.offsetHeight; // eslint-disable-line @typescript-eslint/no-unused-expressions
          // Re-enable transition on next frame
          requestAnimationFrame(() => {
            el.style.transition = "";
          });
        }
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
            </div>
          </div>
        </div>
      </div>
    );
  }
);

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

  // Filter players based on team visibility (memoized for performance)
  const visiblePlayers = useMemo(() => {
    if (!players || !Array.isArray(players)) {
      return [];
    }
    return players.filter((player) => {
      if (player.team.toLowerCase() === "allies" && !showAllies) return false;
      if (player.team.toLowerCase() === "axis" && !showAxis) return false;
      return true;
    });
  }, [players, showAllies, showAxis]);

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
      const excludedRoles = ["armor", "armycommander", "tankcommander"];

      // Find the killer's current role from player positions
      const killerPlayer = players?.find(
        (player) => player.player_name === killEvent.killer_name
      );

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
    players,
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
    const CLUSTER_DISTANCE = 2000;
    const clustered: SpawnEvent[] = [];

    for (const spawn of filtered) {
      if (spawn.position_x == null || spawn.position_y == null) continue;

      const existingCluster = clustered.find((c) => {
        if (c.spawn_team !== spawn.spawn_team) return false;
        if (c.position_x == null || c.position_y == null) return false;
        const dx = c.position_x - spawn.position_x!;
        const dy = c.position_y - spawn.position_y!;
        return Math.sqrt(dx * dx + dy * dy) <= CLUSTER_DISTANCE;
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
              {/* Grid labels */}
              {Array.from({ length: 10 }, (_, col) =>
                Array.from({ length: 10 }, (_, row) => {
                  const cellW = mapRenderDetails.width / 10;
                  const cellH = mapRenderDetails.height / 10;
                  const label = `${String.fromCharCode(65 + col)}${row}`;
                  const fontSize = Math.max(10, cellW * 0.15) / zoom;
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
              )}
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
            {visiblePlayers.map((player, index) => (
              <PlayerDot
                key={`${player.match_id}-${player.player_name}-${player.team}-${index}`}
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

              {/* Strong Points toggle */}
              {(forceShowStrongPoints || (useCleanMap && mapConfig.imageUrlClean)) &&
                strongPoints.length > 0 && (
                  <div className="control-section">
                    <h4>Strong Points</h4>
                    <div className="sp-toggle-all">
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
                    </div>
                    {forceShowStrongPoints && spUnlocked && (
                      <div className="sp-unlock-hint">
                        Drag strong points to reposition.
                      </div>
                    )}
                    <div className="checkboxes-container sp-list">
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
                    </div>
                  </div>
                )}

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
