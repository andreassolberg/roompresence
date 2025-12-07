#!/bin/bash
# Start roompresence web app in Docker
#
# Usage: ./app.sh [--ngrok]
#   --ngrok    Expose port 8080 via ngrok tunnel for external access

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$PROJECT_ROOT/app"

# Parse options
NGROK_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --ngrok)
            NGROK_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./app.sh [--ngrok]"
            exit 1
            ;;
    esac
done

echo "Building Docker image..."
docker build -t roompresence-app "$APP_DIR"

echo ""
echo "Starting roompresence app..."
echo "Web UI: http://localhost:8080"
echo ""


# Setup cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    if [ ! -z "$NGROK_PID" ]; then
        kill $NGROK_PID 2>/dev/null || true
        wait $NGROK_PID 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

# Start ngrok in background if requested
NGROK_PID=""
if [ "$NGROK_MODE" = true ]; then
    # Check if ngrok is installed
    if ! command -v ngrok &> /dev/null; then
        echo "Error: ngrok is not installed"
        echo "Install from: https://ngrok.com/download"
        exit 1
    fi

    echo "Starting ngrok tunnel for port 8080..."
    ngrok http 8080 --log=stdout > /tmp/ngrok.log 2>&1 &
    NGROK_PID=$!

    # Give ngrok time to start and fetch the URL
    sleep 3

    # Check for authentication errors
    if grep -q "authentication failed" /tmp/ngrok.log 2>/dev/null; then
        echo ""
        echo -e "\033[1;31mERROR: Ngrok requires authentication\033[0m"
        echo -e "\033[0;33m1. Sign up: https://dashboard.ngrok.com/signup\033[0m"
        echo -e "\033[0;33m2. Get authtoken: https://dashboard.ngrok.com/get-started/your-authtoken\033[0m"
        echo -e "\033[0;33m3. Install token: ngrok config add-authtoken YOUR_TOKEN\033[0m"
        echo ""
        kill $NGROK_PID 2>/dev/null || true
        NGROK_PID=""
    else
        # Extract and display the tunnel URL
        # Try multiple patterns to find the URL
        TUNNEL_URL=$(grep -Eo 'https://[a-z0-9-]+\.ngrok[^" ]*' /tmp/ngrok.log 2>/dev/null | head -1 || echo "")

        if [ ! -z "$TUNNEL_URL" ]; then
            echo -e "\033[1;32mNgrok tunnel: $TUNNEL_URL\033[0m"
            echo ""
        else
            echo -e "\033[0;36mNgrok starting... Check http://localhost:4040 for tunnel status\033[0m"
            echo ""
        fi
    fi
fi

docker run --rm -it \
    -p 8080:8080 \
    -v "$APP_DIR/etc:/app/etc:ro" \
    -v "$APP_DIR/data:/app/data" \
    -v "$APP_DIR/models:/app/models:ro" \
    roompresence-app
