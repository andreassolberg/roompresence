const HomieListener = require("./HomieListener");
const EventEmitter = require("events");
const config = require("./config");
const { now } = require("./utils");

class HouseStateMachine {
  constructor() {
    this.emitter = new EventEmitter();
    this.ready = false;

    // Door states: { doorId: { state: boolean|null, lastUpdate: timestamp, stale: boolean, name: string } }
    this.doorStates = {};

    // History tracking (similar to roomHistory in PersonTracker)
    this.doorHistory = {}; // { doorId: [{ state, timestamp }] }

    // Staleness threshold in seconds (5 minutes for door sensors)
    this.stalenessThreshold = 300;

    // Extensibility: future sensor types
    this.motionStates = {};
    this.temperatureStates = {};

    // HomieListener instance
    this.homieListener = null;
  }

  async init() {
    if (!config.house || !config.house.doors || config.house.doors.length === 0) {
      console.log("No doors configured in config.house.doors - HouseStateMachine disabled");
      return;
    }

    console.log(`Initializing HouseStateMachine with ${config.house.doors.length} doors`);

    // Initialize door states to null (unknown until first message)
    for (const door of config.house.doors) {
      this.doorStates[door.id] = {
        state: null,
        lastUpdate: 0,
        stale: true,
        name: door.name || door.id
      };
      this.doorHistory[door.id] = [];
      console.log(`  - Door: ${door.id} (${door.name || door.id})`);
    }

    // Create and configure HomieListener
    this.homieListener = new HomieListener();

    // Subscribe to all configured doors
    for (const door of config.house.doors) {
      this.homieListener.subscribeToDoor(door.id);
    }

    // Register data handler
    this.homieListener.onData((data) => {
      this.handleSensorData(data);
    });

    // Periodic staleness check (every 30 seconds)
    setInterval(() => {
      this.checkStaleness();
    }, 30000);

    this.ready = true;
    console.log("HouseStateMachine initialized successfully");
  }

  handleSensorData(data) {
    const { nodeId, property, value, timestamp } = data;

    // Handle door sensors
    if (property === "alarm-contact" && this.doorStates[nodeId]) {
      const previousState = this.doorStates[nodeId].state;

      this.doorStates[nodeId] = {
        ...this.doorStates[nodeId],
        state: value,
        lastUpdate: now(),
        stale: false
      };

      // Only add to history if state actually changed
      if (previousState !== value && value !== null) {
        this.addDoorHistory(nodeId, value);
      }

      // Emit state change event
      this.emitter.emit("doorStateChange", {
        doorId: nodeId,
        state: value,
        previousState,
        timestamp: Date.now()
      });

      if (config.debug) {
        console.log(`Door ${nodeId}: ${value ? 'OPEN' : 'CLOSED'} (was ${previousState})`);
      }
    }

    // Future: Handle motion sensors
    // if (property === "motion" && this.motionStates[nodeId]) { ... }
  }

  addDoorHistory(doorId, state) {
    const timestamp = Date.now();
    const cutoff = timestamp - 24 * 60 * 60 * 1000; // 24 hours

    this.doorHistory[doorId].push({ state, timestamp });

    // Remove entries older than 24 hours
    this.doorHistory[doorId] = this.doorHistory[doorId].filter(h => h.timestamp > cutoff);
  }

  checkStaleness() {
    const currentTime = now();

    for (const [doorId, doorState] of Object.entries(this.doorStates)) {
      if (doorState.lastUpdate === 0) {
        // Never received data
        continue;
      }

      const age = currentTime - doorState.lastUpdate;
      const wasStale = doorState.stale;
      const isStale = age > this.stalenessThreshold;

      if (isStale !== wasStale) {
        this.doorStates[doorId].stale = isStale;

        if (isStale) {
          console.warn(`Door ${doorId} is now stale (no updates for ${age}s)`);
          this.emitter.emit("doorStale", { doorId, age });
        }
      }
    }
  }

  // Public API methods

  getDoorStates() {
    return { ...this.doorStates };
  }

  getDoorState(doorId) {
    return this.doorStates[doorId] || null;
  }

  getDoorHistory(doorId) {
    return this.doorHistory[doorId] || [];
  }

  getAllHistory() {
    return { ...this.doorHistory };
  }

  // Event listener registration
  onDoorStateChange(callback) {
    this.emitter.on("doorStateChange", callback);
  }

  onDoorStale(callback) {
    this.emitter.on("doorStale", callback);
  }

  // Cleanup
  close() {
    if (this.homieListener) {
      this.homieListener.close();
    }
  }
}

module.exports = HouseStateMachine;
