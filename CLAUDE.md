# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Roomer is a room presence detection system that uses Bluetooth proximity sensors (ESPresense) to determine which room a person is in. The system:
- Subscribes to MQTT streams from ESPresense devices that track Bluetooth beacon distances
- Uses an ONNX machine learning model to infer room presence from multiple sensor readings
- Provides a web interface for collecting training data
- Publishes presence updates back to MQTT for home automation integration

## Development Commands

### Start the server
```bash
npm start
```
Runs the Express server on port 8080, which serves the web interface and REST API.

### Install dependencies
```bash
npm install
```

## Architecture

### Core Data Flow
1. **StreamListener** subscribes to MQTT topics (`espresense/devices/{deviceId}/#`) and receives distance measurements from multiple room sensors
2. **PersonTracker** aggregates sensor data and manages timing/staleness of readings
3. **RoomPresenceInference** runs the ONNX model to predict room probabilities from sensor array
4. System publishes presence updates to `espresense/person/{personId}` topic

### Key Components

**lib/PersonTracker.js** - Main orchestrator
- Creates StreamListener and RoomPresenceInference instances
- Manages array of 7 sensor readings (bad, vaskerom, mb, kjellerstua, kjokken, kontor, stua)
- Marks sensors as stale (15) if not updated within 20 seconds
- Runs inference every 5 seconds or when new data arrives
- Tracks room presence with hysteresis (room, room5, room15) to avoid flickering
- Emits sensor data for training collection

**lib/StreamListener.js** - MQTT client wrapper
- Connects to MQTT broker using credentials from config
- Subscribes to device-specific topics
- Parses messages and extracts room name from topic path
- Can publish presence updates back to MQTT

**lib/RoomPresenceInference.js** - ML inference engine
- Loads ONNX model from `models/roompresense-bob.onnx`
- Accepts flat array of 7 distance values
- Returns probability distribution across 13 rooms

**lib/TrainingData.js** - Training data collector
- Collects sensor snapshots with room labels
- Saves batches to `data/` directory as JSON every 2 minutes
- Used via web interface to build training datasets

### Rooms
The system recognizes 13 rooms: bad, gang, gjesterom, kjellergang, kjellerstua, kjokken, kontor, children1, children2, mb, stua, ute, vaskerom

### Configuration
Config is loaded from `etc/config.json` with:
- MQTT broker URL and credentials
- List of people with device IDs (Bluetooth device names)
- `uiPersonId` (optional) - Person ID to display in web UI and collect training data for (defaults to first person in list)
- Feature flags: `publish` (send to MQTT), `track` (collect training data), `debug` (verbose logging)

### REST API
- `GET /api/sensors` - Returns current processed sensor data for the person specified by `uiPersonId` in config
- `GET /api/rooms` - Returns list of valid room names
- `POST /api/room` - Sets current room label for training data collection

### Web Interface
Static HTML/JS served from `public/` directory. Used to label training data by clicking room buttons while sensor data is collected.

## Important Notes

- The system is hardcoded for specific rooms/sensors - changes require updating room/sensor arrays in PersonTracker.js
- Sensor staleness threshold is 20 seconds; readings are replaced with 15 (max distance) when stale
- ONNX model path defaults to `./models/roompresense-bob.onnx` but can be overridden
- Training data collection and web UI display are controlled by the `uiPersonId` config setting
- Config file contains MQTT credentials - ensure it's not committed to version control
