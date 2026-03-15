import "./LoginRequired.css";

export function LoginRequired() {
  return (
    <div className="login-required">
      <div className="login-required-card">
        <h1>Authentication Required</h1>
        <p>
          Please log in to your CRCON admin panel first, then refresh this page.
        </p>
        <button
          className="login-required-retry"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
