import { useState } from "react";
import { MapViewer } from "./MapViewer";
import { MAP_CONFIGS } from "../config/maps";
import "./SPEditor.css";

const mapKeys = Object.keys(MAP_CONFIGS).filter((k) => k !== "invalid");

export const SPEditor = ({ onExit }: { onExit: () => void }) => {
  const [selectedMap, setSelectedMap] = useState(mapKeys[0]);
  const config = MAP_CONFIGS[selectedMap];

  return (
    <div className="sp-editor">
      <div className="sp-editor-toolbar">
        <select
          value={selectedMap}
          onChange={(e) => setSelectedMap(e.target.value)}
          className="sp-editor-select"
        >
          {mapKeys.map((key) => (
            <option key={key} value={key}>
              {MAP_CONFIGS[key].displayName}
              {MAP_CONFIGS[key].strongPoints
                ? ` (${MAP_CONFIGS[key].strongPoints!.length} SPs)`
                : " (default)"}
            </option>
          ))}
        </select>
        <button className="sp-editor-exit" onClick={onExit}>
          Exit Editor
        </button>
      </div>
      <div className="sp-editor-map">
        <MapViewer
          key={selectedMap}
          mapName={config.name}
          players={[]}
          isLive={false}
          killEvents={[]}
          deathOverlays={[]}
          spawnPositions={[]}
          showSpawns={false}
          timelineValue={0}
          matchStartTime={new Date().toISOString()}
          score={{ allies: 2, axis: 2 }}
          forceShowStrongPoints={true}
        />
      </div>
    </div>
  );
};
