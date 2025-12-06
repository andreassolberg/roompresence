#!/bin/bash
# Start roompresence web app in Docker
#
# Usage: ./app.sh [--dev]
#   --dev    Mount local models directory (for development/testing new models)

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$PROJECT_ROOT/app"

echo "Building Docker image..."
docker build -t roompresence-app "$APP_DIR"

echo ""
echo "Starting roompresence app..."
echo "Web UI: http://localhost:8080"
echo ""

# Models are built into image, but can be overridden with --dev flag
EXTRA_MOUNTS=""
if [ "$1" = "--dev" ]; then
    echo "Dev mode: mounting local models directory"
    EXTRA_MOUNTS="-v $APP_DIR/models:/app/models:ro"
fi

docker run --rm -it \
    -p 8080:8080 \
    -v "$APP_DIR/etc:/app/etc:ro" \
    -v "$APP_DIR/data:/app/data" \
    $EXTRA_MOUNTS \
    roompresence-app
