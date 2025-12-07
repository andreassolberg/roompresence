#!/bin/bash
# Deploy trained model to production
#
# Usage: ./deploy.sh <dataset_name>
# Example: ./deploy.sh des25

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$PROJECT_ROOT/build_model"

if [ -z "$1" ]; then
    echo "Usage: ./deploy.sh <dataset_name>"
    echo ""
    echo "Available datasets:"
    ls -1 "$BUILD_DIR/output/" 2>/dev/null || echo "  (none)"
    exit 1
fi

DATASET="$1"
OUTPUT_DIR="$BUILD_DIR/output/$DATASET"
MODELS_DIR="$PROJECT_ROOT/app/models"

if [ ! -f "$OUTPUT_DIR/model_xgb.onnx" ]; then
    echo "Error: Model not found at $OUTPUT_DIR/model_xgb.onnx"
    echo "Run ./train.sh $DATASET first"
    exit 1
fi

# Create models directory if it doesn't exist
mkdir -p "$MODELS_DIR"

cp "$OUTPUT_DIR/model_xgb.onnx" "$MODELS_DIR/model.onnx"
cp "$OUTPUT_DIR/metadata.json" "$MODELS_DIR/metadata.json"

echo "Deployed $DATASET model to $MODELS_DIR/"
