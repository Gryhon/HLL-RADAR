#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Ensure config exists
if [ ! -f config.toml ]; then
    echo "Error: config.toml not found. Copy config.example.toml and edit it first:"
    echo "  cp config.example.toml config.toml"
    exit 1
fi

# Create logs directory
mkdir -p logs

echo "Building and starting HLL-RADAR..."
docker compose build --no-cache hll-radar
docker compose up -d

echo ""
echo "Waiting for services to be healthy..."
docker compose ps

echo ""
echo "HLL-RADAR is running:"
echo "  App:    http://localhost:8080"
echo "  Health: http://localhost:8080/health"
echo "  Logs:   ./logs/"
echo ""
echo "Follow logs:  docker compose logs -f"
echo "Stop:         ./scripts/stop.sh"
