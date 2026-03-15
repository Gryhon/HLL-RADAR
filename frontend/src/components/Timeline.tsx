import { Play, Pause, SkipBack, SkipForward, Radio, Zap } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { Match } from "../types";
import { formatDuration, formatTimestamp } from "../utils";
import "./Timeline.css";

interface TimelineProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  isLive: boolean;
  match?: Match | null;
  onGoLive?: () => void;
  autoPlay?: boolean;
}

export const Timeline = ({
  value,
  max,
  onChange,
  isLive,
  match,
  onGoLive,
  autoPlay,
}: TimelineProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLiveFollowing, setIsLiveFollowing] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 1x, 2x, 4x, 8x, 16x
  const intervalRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  const maxRef = useRef(max);
  const prevValueRef = useRef(value);
  const prevAutoPlayRef = useRef(autoPlay);
  const prevIsLiveRef = useRef(isLive);

  // When isLive changes, reset timeline state immediately
  if (isLive !== prevIsLiveRef.current) {
    prevIsLiveRef.current = isLive;
    if (isLive) {
      setIsLiveFollowing(true);
      setIsPlaying(false);
    }
  }

  // Auto-play historic matches when triggered (match selection toggles autoPlay)
  useEffect(() => {
    if (autoPlay !== prevAutoPlayRef.current) {
      if (!isLive) {
        setIsPlaying(true);
        setIsLiveFollowing(false);
      }
    }
    prevAutoPlayRef.current = autoPlay;
  }, [autoPlay, isLive]);

  // Detect user scrubbing away from live position (e.g., clicking a log event)
  useEffect(() => {
    if (isLive && isLiveFollowing && value > 0 && value < max) {
      const valueDiff = Math.abs(value - prevValueRef.current);
      if (valueDiff > 2) {
        setIsLiveFollowing(false);
      }
    }
    prevValueRef.current = value;
  }, [value, max, isLive, isLiveFollowing]);

  // Keep refs up to date
  useEffect(() => {
    valueRef.current = value;
    maxRef.current = max;
  }, [value, max]);

  // Effect to handle playback
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!isPlaying) {
      return; // Do nothing if not playing
    }

    // Don't advance if we're live and following live
    if (isLive && isLiveFollowing) {
      return;
    }

    intervalRef.current = window.setInterval(() => {
      const currentValue = valueRef.current;
      const currentMax = maxRef.current;

      // Stop if we've reached the end
      if (currentValue >= currentMax) {
        setIsPlaying(false);
        if (isLive) {
          setIsLiveFollowing(true);
        }
        return;
      }

      const newValue = Math.min(currentMax, currentValue + playbackSpeed);
      onChange(newValue);

      // If in live mode and we catch up to live, resume following
      if (isLive && newValue >= currentMax) {
        setIsLiveFollowing(true);
        setIsPlaying(false);
      }
    }, 1000); // Advance by playbackSpeed seconds every second

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, isLive, isLiveFollowing, onChange, playbackSpeed]);

  const wasPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isDraggingRef.current) {
      // First drag event — remember if we were playing, then pause
      isDraggingRef.current = true;
      wasPlayingRef.current = isPlaying;
      setIsPlaying(false);
    }
    const newValue = parseInt(e.target.value, 10);
    onChange(newValue);

    // If in live view and scrubbing back, stop following live
    if (isLive) {
      setIsLiveFollowing(false);
    }
  };

  const handleSliderRelease = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      // Resume playback if it was playing before the drag, or always auto-play for historic
      if (wasPlayingRef.current || !isLive) {
        setIsPlaying(true);
      }
    }
  };

  const handleSkipBack = () => {
    const newValue = Math.max(0, value - 30); // Skip back 30 seconds
    onChange(newValue);
    if (isLive) {
      setIsLiveFollowing(false);
    }
  };

  const handleSkipForward = () => {
    const newValue = Math.min(max, value + 30); // Skip forward 30 seconds
    onChange(newValue);

    // If we're at the end in live mode, resume following
    if (isLive && newValue >= max) {
      setIsLiveFollowing(true);
    }
  };

  const handlePlayPause = () => {
    if (isLive && !isLiveFollowing) {
      // In live mode but scrubbed back - allow playback from current position
      setIsPlaying(!isPlaying);
    } else if (isLive) {
      // If live and following, pause by going back a bit
      onChange(Math.max(0, max - 30));
      setIsLiveFollowing(false);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleGoLive = () => {
    if (onGoLive) {
      onGoLive();
      setIsLiveFollowing(true);
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  // In live mode, calculate elapsed time from match start
  const displayValue = isLive && isLiveFollowing ? max : value;
  const progress = max > 0 ? (displayValue / max) * 100 : 0;

  return (
    <div className="timeline">
      <div className="timeline-info">
        {match ? (
          <div className="match-info">
            <span className="match-name">{match.map_name}</span>
            <span className="match-time">
              Started: {formatTimestamp(match.start_time)}
            </span>
            {match.end_time && (
              <span className="match-time">
                Ended: {formatTimestamp(match.end_time)}
              </span>
            )}
          </div>
        ) : (
          <div className="match-info">
            <span className="match-name">Live Match</span>
          </div>
        )}
      </div>

      <div className="timeline-controls">
        <button
          onClick={handleSkipBack}
          className="control-button"
          disabled={displayValue === 0}
          title="Skip back 30s"
        >
          <SkipBack size={16} />
        </button>

        <button
          onClick={handlePlayPause}
          className="control-button play-button"
          title={
            isLive
              ? isLiveFollowing
                ? "Pause"
                : isPlaying
                ? "Pause"
                : "Play"
              : isPlaying
              ? "Pause"
              : "Play"
          }
        >
          {isLive ? (
            isLiveFollowing ? (
              <Pause size={16} />
            ) : isPlaying ? (
              <Pause size={16} />
            ) : (
              <Play size={16} />
            )
          ) : isPlaying ? (
            <Pause size={16} />
          ) : (
            <Play size={16} />
          )}
        </button>

        <button
          onClick={handleSkipForward}
          className="control-button"
          disabled={displayValue === max}
          title="Skip forward 30s"
        >
          <SkipForward size={16} />
        </button>

        {/* Speed control buttons - only show when not in live following mode */}
        {(!isLive || !isLiveFollowing) && (
          <>
            <div className="speed-controls">
              <button
                onClick={() => handleSpeedChange(1)}
                className={`control-button speed-button ${
                  playbackSpeed === 1 ? "active" : ""
                }`}
                title="1x Speed"
              >
                1x
              </button>
              <button
                onClick={() => handleSpeedChange(2)}
                className={`control-button speed-button ${
                  playbackSpeed === 2 ? "active" : ""
                }`}
                title="2x Speed"
              >
                <Zap size={14} />
                2x
              </button>
              <button
                onClick={() => handleSpeedChange(4)}
                className={`control-button speed-button ${
                  playbackSpeed === 4 ? "active" : ""
                }`}
                title="4x Speed"
              >
                <Zap size={14} />
                4x
              </button>
              <button
                onClick={() => handleSpeedChange(8)}
                className={`control-button speed-button ${
                  playbackSpeed === 8 ? "active" : ""
                }`}
                title="8x Speed"
              >
                <Zap size={14} />
                8x
              </button>
              <button
                onClick={() => handleSpeedChange(16)}
                className={`control-button speed-button ${
                  playbackSpeed === 16 ? "active" : ""
                }`}
                title="16x Speed"
              >
                <Zap size={14} />
                16x
              </button>
            </div>
          </>
        )}

        {/* Go Live button - only show when in live mode but not following */}
        {isLive && !isLiveFollowing && (
          <button
            onClick={handleGoLive}
            className="control-button go-live-button"
            title="Return to live view"
          >
            <Radio size={16} className="pulse-icon" />
            <span>GO LIVE</span>
          </button>
        )}
      </div>

      <div className="timeline-slider">
        <div className="time-display">
          <span className="current-time">{formatDuration(displayValue)}</span>
          <span className="separator">/</span>
          <span className="total-time">{formatDuration(max)}</span>
        </div>

        <div className="slider-container">
          <input
            type="range"
            min="0"
            max={max}
            value={displayValue}
            onChange={handleSliderChange}
            onMouseUp={handleSliderRelease}
            onTouchEnd={handleSliderRelease}
            className="slider"
            disabled={max === 0}
          />
          <div className="slider-track">
            <div
              className="slider-progress"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="timeline-status">
          <span
            className={`status ${
              isLive && isLiveFollowing
                ? "live"
                : isPlaying
                ? "playing"
                : "historical"
            }`}
          >
            {isLive
              ? isLiveFollowing
                ? "LIVE"
                : isPlaying
                ? "PLAYING"
                : "PAUSED"
              : isPlaying
              ? "PLAYING"
              : "PAUSED"}
          </span>
        </div>
      </div>
    </div>
  );
};
