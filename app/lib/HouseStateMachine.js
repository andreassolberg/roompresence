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

    // Staleness threshold in seconds (12 hours for door sensors - only send on state change)
    this.stalenessThreshold = 43200; // 12 hours = 12 * 60 * 60

    // Motion sensor states: { sensorId: { state, lastUpdate, lastMotionTime, stale, name } }
    this.motionStates = {};
    this.motionHistory = {};

    // Initialize motion sensors from config
    if (config.house && config.house.motionSensors) {
      for (const sensor of config.house.motionSensors) {
        this.motionStates[sensor.id] = {
          state: null,
          lastUpdate: 0,
          lastMotionTime: 0, // Track when motion was last TRUE
          stale: true,
          name: sensor.name || sensor.id
        };
        this.motionHistory[sensor.id] = [];
      }
    }

    // Future extensibility
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

    // Subscribe to all configured motion sensors
    if (config.house.motionSensors) {
      for (const sensor of config.house.motionSensors) {
        this.subscribeToMotionSensor(sensor.id);
        console.log(`  - Motion sensor: ${sensor.id} (${sensor.name || sensor.id})`);
      }
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

  subscribeToMotionSensor(sensorId) {
    this.homieListener.subscribeToMotionSensor(sensorId);
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

    // Handle motion sensors
    if (property === "alarm-motion" && this.motionStates[nodeId]) {
      const previousState = this.motionStates[nodeId].state;

      this.motionStates[nodeId].state = value;
      this.motionStates[nodeId].lastUpdate = now();
      this.motionStates[nodeId].stale = false;

      // CRITICAL: Update lastMotionTime only when motion is detected
      if (value === true) {
        this.motionStates[nodeId].lastMotionTime = now();
      }

      // Only add to history if state actually changed
      if (previousState !== value && value !== null) {
        console.log(`[House] Motion sensor ${nodeId}: ${value ? 'ACTIVE' : 'INACTIVE'}`);
        this.addMotionHistory(nodeId, value);

        // Emit state change event
        this.emitter.emit("motionSensorStateChange", {
          sensorId: nodeId,
          state: value,
          previousState,
          timestamp: Date.now()
        });
      }
    }
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

    // Check door sensor staleness (12 hours)
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

    // Check motion sensor staleness (12 hours, same as doors)
    for (const [sensorId, sensorState] of Object.entries(this.motionStates)) {
      if (sensorState.lastUpdate === 0) {
        // Never received data
        continue;
      }

      const age = currentTime - sensorState.lastUpdate;
      const wasStale = sensorState.stale;
      const isStale = age > this.stalenessThreshold;

      if (isStale !== wasStale) {
        this.motionStates[sensorId].stale = isStale;

        if (isStale) {
          console.warn(`[House] Motion sensor ${sensorId} is now stale (${age}s since last update)`);
          this.emitter.emit("motionSensorStale", { sensorId, age });
        } else {
          console.log(`[House] Motion sensor ${sensorId} is now fresh`);
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

  // Motion sensor public API methods

  getMotionSensorState(sensorId) {
    return this.motionStates[sensorId] || null;
  }

  getMotionSensorStates() {
    return { ...this.motionStates };
  }

  getMotionSensorHistory(sensorId) {
    return this.motionHistory[sensorId] || [];
  }

  addMotionHistory(sensorId, state) {
    const timestamp = Date.now();
    const cutoff = timestamp - 24 * 60 * 60 * 1000; // 24 hours

    if (!this.motionHistory[sensorId]) {
      this.motionHistory[sensorId] = [];
    }

    this.motionHistory[sensorId].push({ state, timestamp });

    // Remove entries older than 24 hours
    this.motionHistory[sensorId] = this.motionHistory[sensorId]
      .filter(h => h.timestamp > cutoff);
  }

  // Event listener registration
  onDoorStateChange(callback) {
    this.emitter.on("doorStateChange", callback);
  }

  onDoorStale(callback) {
    this.emitter.on("doorStale", callback);
  }

  onMotionSensorStateChange(callback) {
    this.emitter.on("motionSensorStateChange", callback);
  }

  onMotionSensorStale(callback) {
    this.emitter.on("motionSensorStale", callback);
  }

  // Cleanup
  close() {
    if (this.homieListener) {
      this.homieListener.close();
    }
  }
}

module.exports = HouseStateMachine;
