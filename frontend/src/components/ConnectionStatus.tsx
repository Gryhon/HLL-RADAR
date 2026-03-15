import "./ConnectionStatus.css";

interface ConnectionStatusProps {
  isConnected: boolean;
  error?: string | null;
}

export const ConnectionStatus = ({
  isConnected,
  error,
}: ConnectionStatusProps) => {
  return (
    <div className="connection-status">
      <div
        className={`status-indicator ${
          isConnected ? "connected" : "disconnected"
        }`}
      >
        <div className="status-dot"></div>
        <span>{isConnected ? "Connected" : "Disconnected"}</span>
      </div>

      {error && (
        <div className="error-indicator" title={error}>
          <div className="error-dot"></div>
          <span>Error</span>
        </div>
      )}
    </div>
  );
};
