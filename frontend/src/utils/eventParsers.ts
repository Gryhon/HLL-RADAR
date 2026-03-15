import type { MatchEvent, KillEvent, DeathOverlay, PlayerPosition } from "../types";

/**
 * Parse a kill event from a match event.
 * Returns null if the event can't be parsed as a kill.
 */
export function parseKillEvent(event: MatchEvent): KillEvent | null {
  if (
    event.event_type !== "kill" ||
    event.position_x == null ||
    event.position_y == null ||
    event.victim_x == null ||
    event.victim_y == null
  ) {
    return null;
  }

  const details = event.details || "";
  const message = event.message || "";

  const killMatch = message.match(/(.+?)\s+killed\s+(.+?)(?:\s+with|$)/i);
  if (!killMatch) return null;

  return {
    id: event.id,
    match_id: event.match_id,
    event_type: event.event_type,
    message: event.message,
    details,
    timestamp: event.timestamp,
    killer_name: killMatch[1].trim(),
    victim_name: killMatch[2].trim(),
    position_x: event.position_x,
    position_y: event.position_y,
    position_z: event.position_z || 0,
    victim_x: event.victim_x,
    victim_y: event.victim_y,
    victim_z: event.victim_z || 0,
    weapon: details.includes("with") ? details.split("with")[1]?.trim() : undefined,
  };
}

/**
 * Parse a victim name from a kill or death event message.
 */
export function parseVictimName(event: MatchEvent): string | null {
  const message = event.message || "";
  const deathMatch = message.match(
    /(.+?)\s+(?:was killed by|killed)\s+(.+?)(?:\s+with|$)/i
  );
  if (!deathMatch) return null;

  return event.event_type === "death"
    ? deathMatch[1].trim()
    : deathMatch[2].trim();
}

/**
 * Create a death overlay from a match event and player positions.
 */
export function createDeathOverlay(
  event: MatchEvent,
  players: PlayerPosition[]
): DeathOverlay | null {
  if (event.event_type !== "death" && event.event_type !== "kill") return null;

  const victimName = parseVictimName(event);
  if (!victimName) return null;

  const victim = players.find((p) => p.player_name === victimName);
  if (!victim) return null;

  return {
    player_name: victimName,
    timestamp: event.timestamp,
    x: victim.x,
    y: victim.y,
    z: victim.z,
  };
}
