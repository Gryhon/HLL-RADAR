#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Stopping HLL-RADAR..."
docker compose down

echo ""
echo "HLL-RADAR stopped."
echo "Database data is preserved. To remove everything: docker compose down -v"
