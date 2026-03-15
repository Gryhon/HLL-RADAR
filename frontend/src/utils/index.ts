// Utility functions
import { MAP_CONFIGS } from "../config/maps";

// Format a timestamp into a readable format
export const formatTimestamp = (timestamp: string) => {
  return new Date(timestamp).toLocaleString();
};

export const isValidMapName = (mapName: string): boolean => {
  const validMaps = [
    "stmereeglise",
    "stmariedumont",
    "utahbeach",
    "omahabeach",
    "purpleheartlane",
    "carentan",
    "hurtgenforest",
    "hill400",
    "foy",
    "kursk",
    "stalingrad",
    "remagen",
    "kharkov",
    "driel",
    "elalamein",
    "mortain",
    "elsenbornridge",
    "tobruk",
    "invalid",
  ];
  return validMaps.includes(mapName.toLowerCase());
};

// Get the display name for a map from its key
export const getMapDisplayName = (mapKey: string) => {
  if (!mapKey) return "Unknown Map";
  const normalizedKey = mapKey.toLowerCase().replace(/ /g, "");
  const config = MAP_CONFIGS[normalizedKey];
  return config ? config.displayName : mapKey;
};

// Get the CSS class for a team name
export const getTeamClass = (team: string) => {
  const lowerTeam = team.toLowerCase();
  if (["allies", "us", "gb"].includes(lowerTeam)) {
    return "allies";
  }
  if (["axis", "german"].includes(lowerTeam)) {
    return "axis";
  }
  return "unknown";
};

// Format seconds into a MM:SS duration string
export const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

// Squad color palette - 20 maximally distinct colors (top colors are most different)
const SQUAD_COLORS = [
  "#FF0000", // 1. Bright Red
  "#00FF00", // 2. Bright Green
  "#0000FF", // 3. Bright Blue
  "#FFFF00", // 4. Bright Yellow
  "#FF00FF", // 5. Magenta
  "#00FFFF", // 6. Cyan
  "#FF8800", // 7. Orange
  "#8800FF", // 8. Purple
  "#00FF88", // 9. Spring Green
  "#FF0088", // 10. Hot Pink
  "#88FF00", // 11. Lime
  "#0088FF", // 12. Sky Blue
  "#FF6666", // 13. Light Red
  "#66FF66", // 14. Light Green
  "#6666FF", // 15. Light Blue
  "#FFFF66", // 16. Light Yellow
  "#FF66FF", // 17. Light Magenta
  "#66FFFF", // 18. Light Cyan
  "#FFB366", // 19. Light Orange
  "#B366FF", // 20. Light Purple
];

// Squad names in order - matches SQUAD_COLORS array (from game screenshot)
const SQUAD_NAMES = [
  "able",
  "baker",
  "charlie",
  "dog",
  "easy",
  "fox",
  "george",
  "how",
  "item",
  "jig",
  "king",
  "love",
  "mike",
  "negat",
  "option",
  "prep",
  "queen",
  "roger",
  "sugar",
];

// Get squad color based on unit name
export const getSquadColor = (unit?: string): string => {
  if (!unit) return "#FFFFFF"; // Default white for no squad

  const unitLower = unit.toLowerCase().trim();

  // Try direct squad name match
  const index = SQUAD_NAMES.indexOf(unitLower);
  if (index !== -1) {
    return SQUAD_COLORS[index];
  }

  // For numeric squads (1, 2, 3, etc.)
  const numMatch = unitLower.match(/\d+/);
  if (numMatch) {
    const num = parseInt(numMatch[0], 10) - 1;
    if (num >= 0 && num < SQUAD_COLORS.length) {
      return SQUAD_COLORS[num];
    }
  }

  // Fallback: hash the name for consistent color
  const hash = unitLower
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return SQUAD_COLORS[hash % SQUAD_COLORS.length];
};
