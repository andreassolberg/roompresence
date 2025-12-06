#!/bin/bash
# Run training in Docker container
#
# Usage:
#   ./train.sh <dataset_name> [--model rf|xgb|mlp|all]
#
# Examples:
#   ./train.sh des25
#   ./train.sh des25 --model rf

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$PROJECT_ROOT/build_model"

# Check for dataset argument
if [ -z "$1" ]; then
    echo "Usage: ./train.sh <dataset_name> [--model rf|xgb|mlp|all]"
    echo ""
    echo "Available datasets:"
    ls -1 "$BUILD_DIR/data/" 2>/dev/null || echo "  (none)"
    exit 1
fi

DATASET="$1"
shift

# Build the Docker image
echo "Building Docker image..."
docker build -t roompresence-trainer "$BUILD_DIR"

# Run training
echo ""
echo "Running training for dataset: $DATASET"
echo "================================"

docker run --rm \
    -v "$BUILD_DIR/data:/app/data:ro" \
    -v "$BUILD_DIR/output:/app/output" \
    -v "$PROJECT_ROOT/etc/config.json:/app/config.json:ro" \
    roompresence-trainer \
    python train.py "$DATASET" "$@"

echo ""
echo "Done! Check build_model/output/$DATASET/ for results."
