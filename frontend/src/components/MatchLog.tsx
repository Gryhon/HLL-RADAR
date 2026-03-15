import { useEffect, useState, useRef } from "react";
import type { MatchEvent } from "../types";
import { apiClient } from "../services/api";
import "./MatchLog.css";

interface MatchLogProps {
  matchId?: number;
  isLive: boolean;
  newEvent?: MatchEvent | null;
  onEventClick?: (timestamp: string) => void;
  timelineValue?: number;
  matchStartTime?: string;
}

const EVENT_TYPES = [
  { value: "match_start", label: "Match Start", icon: "▶", color: "#22c55e" },
  { value: "match_end", label: "Match End", icon: "■", color: "#ef4444" },
  { value: "kill", label: "Kills", icon: "💀", color: "#f59e0b" },
  { value: "death", label: "Deaths", icon: "💀", color: "#f59e0b" },
  { value: "teamkill", label: "Team Kills", icon: "🔴", color: "#ef4444" },
  { value: "teamdeath", label: "Team Deaths", icon: "🔴", color: "#ef4444" },
  { value: "chat", label: "Chat", icon: "💬", color: "#3b82f6" },
  { value: "player_connect", label: "Connects", icon: "🟢", color: "#22c55e" },
  {
    value: "player_disconnect",
    label: "Disconnects",
    icon: "🔴",
    color: "#6b7280",
  },
  {
    value: "objective_captured",
    label: "Objectives",
    icon: "🏴",
    color: "#3b82f6",
  },
  { value: "ban", label: "Bans", icon: "🚫", color: "#ef4444" },
  { value: "kick", label: "Kicks", icon: "👢", color: "#ef4444" },
  { value: "vote_started", label: "Vote Start", icon: "🗳️", color: "#3b82f6" },
  {
    value: "vote_completed",
    label: "Vote Result",
    icon: "🗳️",
    color: "#3b82f6",
  },
  { value: "team_switch", label: "Team Switch", icon: "🔄", color: "#8b5cf6" },
  {
    value: "squad_switch",
    label: "Squad Switch",
    icon: "👥",
    color: "#8b5cf6",
  },
  { value: "role_change", label: "Role Change", icon: "🎭", color: "#8b5cf6" },
  {
    value: "admin_cam_enter",
    label: "Admin Cam",
    icon: "👁️",
    color: "#6b7280",
  },
];

export const MatchLog = ({
  matchId,
  isLive,
  newEvent,
  onEventClick,
  timelineValue,
  matchStartTime,
}: MatchLogProps) => {
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logTopRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Initialize with all event types selected except deaths and team deaths
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<string>>(
    new Set(
      EVENT_TYPES.map((et) => et.value).filter(
        (type) => type !== "death" && type !== "teamdeath"
      )
    )
  );

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        filterRef.current &&
        !filterRef.current.contains(event.target as Node)
      ) {
        setShowFilter(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch events when matchId, timeline, or filter changes
  useEffect(() => {
    if (!matchId) {
      setEvents([]);
      return;
    }

    let cancelled = false;

    const fetchEvents = async () => {
      setLoading(true);
      setError(null);

      try {
        const typesArray = Array.from(selectedEventTypes);
        let data: MatchEvent[];

        // Use timeline API only if we're in historical mode (not live) and timeline is provided
        if (!isLive && timelineValue !== undefined && matchStartTime) {
          const matchStartTimeMs = new Date(matchStartTime).getTime();
          const endTime = matchStartTimeMs + timelineValue * 1000;

          data = await apiClient.getMatchEventsTimeline(
            matchId,
            matchStartTimeMs,
            endTime
          );
        } else {
          // Use regular events API with server-side type filtering
          data = await apiClient.getMatchEvents(matchId, 5000, typesArray);
        }

        if (cancelled) return;

        // Sort events by timestamp in descending order (newest first)
        const sortedEvents = (data || []).sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        setEvents(sortedEvents);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          console.error("Error fetching match events:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchEvents();
    return () => { cancelled = true; };
  }, [matchId, timelineValue, matchStartTime, isLive, selectedEventTypes]);

  // Handle new events from WebSocket (add to top)
  useEffect(() => {
    if (newEvent && newEvent.match_id === matchId) {
      setEvents((prevEvents) => [newEvent, ...prevEvents]);
    }
  }, [newEvent, matchId]);

  // Auto-scroll to top when new events arrive (if auto-scroll is enabled)
  useEffect(() => {
    if (autoScroll && logTopRef.current) {
      logTopRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, autoScroll]);

  // Handle scroll to detect if user is at top
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    const isAtTop = element.scrollTop === 0;
    setAutoScroll(isAtTop);
  };

  const toggleEventType = (eventType: string) => {
    setSelectedEventTypes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventType)) {
        newSet.delete(eventType);
      } else {
        newSet.add(eventType);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedEventTypes(new Set(EVENT_TYPES.map((et) => et.value)));
  };

  const deselectAll = () => {
    setSelectedEventTypes(new Set());
  };

  const formatEventTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getEventIcon = (eventType: string) => {
    const eventConfig = EVENT_TYPES.find((et) => et.value === eventType);
    return eventConfig?.icon || "•";
  };

  // Filter events client-side (needed for timeline API which doesn't support type filtering)
  const filteredEvents = events.filter((event) =>
    selectedEventTypes.has(event.event_type)
  );

  if (!matchId) {
    return (
      <div className="match-log">
        <div className="match-log-header">
          <h4>Match Log</h4>
        </div>
        <div className="match-log-empty">
          <p>No active match</p>
        </div>
      </div>
    );
  }

  return (
    <div className="match-log">
      <div className="match-log-header">
        <div className="match-log-title-row">
          <div className="match-log-title-group">
            <h4>Match Log</h4>
            {isLive && <span className="live-badge">LIVE</span>}
          </div>
          <div className="event-filter" ref={filterRef}>
            <button
              className="filter-button"
              onClick={() => setShowFilter(!showFilter)}
              title="Filter event types"
            >
              <span className="filter-icon">⚙️</span>
              <span className="filter-count">
                {selectedEventTypes.size}/{EVENT_TYPES.length}
              </span>
            </button>
            {showFilter && (
              <div className="filter-dropdown">
                <div className="filter-dropdown-header">
                  <span className="filter-dropdown-title">Filter Events</span>
                  <div className="filter-actions">
                    <button
                      className="filter-action-btn"
                      onClick={selectAll}
                      title="Select all"
                    >
                      All
                    </button>
                    <button
                      className="filter-action-btn"
                      onClick={deselectAll}
                      title="Deselect all"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="filter-options">
                  {EVENT_TYPES.map((eventType) => (
                    <label key={eventType.value} className="filter-option">
                      <input
                        type="checkbox"
                        checked={selectedEventTypes.has(eventType.value)}
                        onChange={() => toggleEventType(eventType.value)}
                      />
                      <span className="filter-option-icon">
                        {eventType.icon}
                      </span>
                      <span className="filter-option-label">
                        {eventType.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && events.length === 0 && (
        <div className="match-log-loading">Loading events...</div>
      )}

      {error && <div className="match-log-error">{error}</div>}

      <div className="match-log-content" onScroll={handleScroll}>
        <div ref={logTopRef} />
        {filteredEvents.length === 0 && !loading ? (
          <div className="match-log-empty">
            <p>
              {events.length === 0
                ? "No events yet"
                : "No events match the selected filters"}
            </p>
          </div>
        ) : (
          filteredEvents.map((event, index) => (
            <div
              key={`${event.id}-${index}`}
              className={`log-entry ${event.event_type} ${
                onEventClick ? "clickable" : ""
              }`}
              onClick={() => onEventClick?.(event.timestamp)}
            >
              <div className="log-time">{formatEventTime(event.timestamp)}</div>
              <div className="log-content">
                <span className="log-icon">
                  {getEventIcon(event.event_type)}
                </span>
                <span className="log-message">{event.message}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
