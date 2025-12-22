const StreamListener = require("./StreamListener");
const RoomPresenceInference = require("./RoomPresenceInference");
const config = require("./config");
const EventEmitter = require("events");
const { now } = require("./utils");

const processStatus = (status) => {
  let s = Object.assign({}, status);
  s.ago = now() - s.updated;

  // fresh er 1 hvis ago < 10, ellers 0
  s.fresh = s.ago < 10 ? 1 : 0;

  // Beregn value fra konfigurerbar kilde
  const source = config.tracking === "raw" ? s.raw : s.distance;

  // value er aldri større enn 10, og settes til 10 hvis ago > 10
  if (s.ago > 10) {
    s.value = 10;
  } else {
    s.value = Math.min(10, source);
  }

  delete s.updated;
  return s;
};

class PersonTracker {
  constructor(devices, personId, options = {}) {
    this.personId = personId;
    this.devices = Array.isArray(devices) ? devices : [devices]; // Support single device for backward compat
    this.trainingMode = options.trainingMode || false;
    this.room = "na";
    this.room0 = "na";
    this.room0Since = now();
    this.room0Confident = false;
    this.room0Stable = false;
    this.room5 = "na";
    this.room15 = "na";
    this.room120 = "na";
    this.room0SuperStable = false; // true når room0 har vært stabil i 120+ sekunder
    this.roomHistory = [];  // Array av { room, timestamp } for siste 24 timer
    this.rooms = null; // Will be loaded from model metadata
    this.coordinator = options.coordinator || null; // RoomTransitionCoordinator

    this.emitter = new EventEmitter();

    this.inferenceRun = now();

    this.inference = new RoomPresenceInference();
    this.inferenceEnabled = false; // Will be set to true if model loads successfully
    this.ready = false;
    this.lastPredictions = null;

    // Multi-device state tracking
    this.deviceStates = {}; // { deviceId: { stream, sensors, lastUpdate } }
    this.activeDevice = null;

    setInterval(() => {
      if (now() - this.inferenceRun > 5) {
        this.runInference();
      }
    }, 1500);
  }

  onSensorData(callback) {
    this.emitter.on("sensor", callback);
  }

  initializeDevicesWithSensors(sensorOrder) {
    for (const deviceId of this.devices) {
      // Create sensor array for this device
      const sensors = sensorOrder.map((room) => ({
        raw: 15,
        distance: 15,
        room,
        updated: now(),
      }));

      // Create StreamListener for this device
      const stream = new StreamListener(deviceId);
      stream.onData((data) => {
        this.setData(deviceId, data);
      });

      this.deviceStates[deviceId] = {
        stream,
        sensors,
        lastUpdate: 0, // No data received yet
      };

      console.log(`  - Device: ${deviceId}`);
    }

    // Set first device as initially active
    this.activeDevice = this.devices[0];
    console.log(`  Active device: ${this.activeDevice}`);
  }

  updateActiveDevice() {
    const currentTime = now();
    const primaryDevice = this.devices[0];
    const primaryState = this.deviceStates[primaryDevice];
    const primaryAge = primaryState.lastUpdate === 0 ? Infinity : currentTime - primaryState.lastUpdate;
    const primaryIsFresh = primaryAge < 10;

    // If primary device has fresh data, always use it
    if (primaryIsFresh && this.activeDevice !== primaryDevice) {
      console.log(
        `Switching to primary device: ${this.activeDevice} -> ${primaryDevice} (primary has fresh data)`
      );
      this.activeDevice = primaryDevice;
      this.publishState();
      return;
    }

    // If primary is active and fresh, stay with it
    if (this.activeDevice === primaryDevice && primaryIsFresh) {
      return;
    }

    // Primary is stale - find freshest secondary device
    const currentState = this.deviceStates[this.activeDevice];
    const currentAge = currentState.lastUpdate === 0 ? Infinity : currentTime - currentState.lastUpdate;

    let freshestDevice = this.activeDevice;
    let freshestAge = currentAge;

    for (const [deviceId, state] of Object.entries(this.deviceStates)) {
      const age = state.lastUpdate === 0 ? Infinity : currentTime - state.lastUpdate;
      if (age < freshestAge) {
        freshestDevice = deviceId;
        freshestAge = age;
      }
    }

    // Switch to fresher device if current is 10+ seconds staler
    if (freshestDevice !== this.activeDevice && freshestAge !== Infinity) {
      const timeDiff = currentAge - freshestAge;
      if (timeDiff >= 10 || currentAge === Infinity) {
        console.log(
          `Switching active device: ${this.activeDevice} -> ${freshestDevice} (${currentAge === Infinity ? 'current never received data' : timeDiff + 's fresher'})`
        );
        this.activeDevice = freshestDevice;
        this.publishState();
      }
    }
  }

  isAllDevicesStale(threshold = 120) {
    const currentTime = now();
    for (const state of Object.values(this.deviceStates)) {
      const age = state.lastUpdate === 0 ? Infinity : currentTime - state.lastUpdate;
      if (age < threshold) {
        return false; // Minst én enhet har fersk data
      }
    }
    return true; // Alle enheter er stale
  }

  publishState() {
    if (config.publish && this.room !== null) {
      const activeState = this.deviceStates[this.activeDevice];
      const lockedDoors = this.coordinator ? this.coordinator.getLockedDoors(this.personId) : {};

      activeState.stream.sendMessage(this.personId, {
        room: this.room,
        room0: this.room0,
        room5: this.room5,
        room15: this.room15,
        room120: this.room120,
        activeDevice: this.activeDevice,
        superStable: this.room0SuperStable, // NY
        doorLocked: Object.keys(lockedDoors).length > 0, // NY
        lockedDoors: Object.keys(lockedDoors), // NY
        pendingTransition: this.room !== this.room0 // NY - viser blokkert overgang
      });
    }
  }

  setRoom(room, confidence = 0) {
    let since = now() - this.room0Since;
    let updated = false;

    // room0 oppdateres alltid umiddelbart
    if (room !== this.room0) {
      this.room0Since = now();
      this.room0 = room;
      this.room0Confident = false;
      this.room0Stable = false;
      this.room0SuperStable = false; // Reset også super-stability
      updated = true;
      since = 0;
    }

    // Sjekk konfidens-flagg (kan settes når som helst)
    if (confidence > 0.9 && !this.room0Confident) {
      this.room0Confident = true;
      updated = true;
    }

    // Sjekk stabilitet (5 sekunder med samme room0)
    if (since > 5 && !this.room0Stable) {
      this.room0Stable = true;
      this.room5 = room;
      updated = true;
    }

    // Sjekk super-stabilitet (120 sekunder)
    if (since > 120 && !this.room0SuperStable) {
      this.room0SuperStable = true;
      updated = true;
      if (config.debug) {
        console.log(`[${this.personId}] room0 is now SUPER-STABLE (120s+)`);
      }

      // Evaluer om person er låst bak lukkede dører
      if (this.coordinator) {
        this.coordinator.evaluateCurrentRoomLock(this.personId, this.room, true);
      }
    }

    // Oppdater room når BEGGE betingelser er oppfylt OG dør-begrensninger tillater det
    if (this.room0Confident && this.room0Stable && this.room !== room) {
      // Sjekk dør-begrensninger før overgang
      const canMove = !this.coordinator ||
                      this.coordinator.canTransition(this.personId, this.room, room, this.room0SuperStable);

      if (canMove) {
        this.room = room;
        this.addRoomHistory(room);

        // Reset super-stability ved faktisk rombytte
        this.room0SuperStable = false;

        updated = true;
      } else {
        // Overgang blokkert av lukket dør
        // room0 oppdateres fortsatt, men ikke 'room'
        if (config.debug) {
          console.log(`[${this.personId}] Room transition BLOCKED by closed door: ${this.room} → ${room}`);
        }
        updated = true; // Publiser state for å vise at room0 har endret seg
      }
    }

    // room15/120 baseres på room0Since
    if (since > 15 && this.room15 !== room) {
      this.room15 = room;
      updated = true;
    }

    if (since > 120 && this.room120 !== room) {
      this.room120 = room;
      updated = true;
    }

    // Evaluer låsetilstand kontinuerlig når superStable
    if (this.coordinator && this.room0SuperStable) {
      this.coordinator.evaluateCurrentRoomLock(this.personId, this.room, true);
    }

    if (updated) {
      this.publishState();
    }
  }

  addRoomHistory(room) {
    const timestamp = Date.now();
    const cutoff = timestamp - 24 * 60 * 60 * 1000; // 24 timer

    this.roomHistory.push({ room, timestamp });

    // Fjern entries eldre enn 24 timer
    this.roomHistory = this.roomHistory.filter(h => h.timestamp > cutoff);
  }

  getRoomHistory() {
    return this.roomHistory;
  }

  async init() {
    let sensorOrder;

    try {
      await this.inference.loadModel();
      this.inferenceEnabled = true;

      // Get room list and sensor order from model metadata
      this.rooms = this.inference.getRooms();
      sensorOrder = this.inference.getSensorOrder();
      console.log(`Model loaded - supports ${this.rooms.length} rooms:`, this.rooms);
    } catch (error) {
      if (this.trainingMode) {
        // In training mode, we can run without a model
        console.log(`Model not available (${error.message}) - running in training-only mode`);
        this.inferenceEnabled = false;

        // Use rooms and sensorOrder from config instead
        this.rooms = config.rooms;
        sensorOrder = config.sensorOrder;
        console.log(`Using config - ${this.rooms.length} rooms, ${sensorOrder.length} sensors`);
      } else {
        // Not in training mode - model is required
        throw error;
      }
    }

    // Initialize devices (creates StreamListeners and sensor arrays)
    console.log(`Using ${sensorOrder.length} sensors:`, sensorOrder);
    console.log(`Initializing ${this.devices.length} device(s) for ${this.personId}:`);
    this.initializeDevicesWithSensors(sensorOrder);

    this.ready = true;
  }

  setData(deviceId, data) {
    if (config.debug) console.log(`Data from ${deviceId}:`, data);

    const deviceState = this.deviceStates[deviceId];
    if (!deviceState) {
      console.error("Unknown device:", deviceId);
      return;
    }

    let idx = deviceState.sensors.findIndex((s) => s.room === data.room);
    if (idx === -1) {
      if (config.debug) console.error("Unknown room:", data.room);
      return;
    }

    let hasUpdate = false;
    if (data.raw !== undefined) {
      deviceState.sensors[idx].raw = data.raw;
      hasUpdate = true;
    }
    if (data.distance !== undefined) {
      deviceState.sensors[idx].distance = data.distance;
      hasUpdate = true;
    }

    if (hasUpdate) {
      deviceState.sensors[idx].updated = now();
      deviceState.lastUpdate = now();
    }

    // Check if we should switch active device
    this.updateActiveDevice();

    this.runInference();
  }

  getSensordataProcessed() {
    // Return sensor data from active device only
    const activeState = this.deviceStates[this.activeDevice];
    return activeState.sensors.map(processStatus);
  }

  getDeviceStatus() {
    const status = {};
    for (const [deviceId, state] of Object.entries(this.deviceStates)) {
      status[deviceId] = {
        lastUpdate: state.lastUpdate,
        age: now() - state.lastUpdate,
        isActive: deviceId === this.activeDevice,
      };
    }
    return {
      activeDevice: this.activeDevice,
      devices: status,
    };
  }

  getPredictions() {
    return this.lastPredictions;
  }

  runInference() {
    if (!this.ready) {
      console.log("Cannot run inference – waiting for initialization");
      return;
    }

    // Still emit sensor data even if inference is disabled (for training)
    const activeState = this.deviceStates[this.activeDevice];
    let sensorData = activeState.sensors.map(processStatus);
    this.emitter.emit("sensor", sensorData);

    if (!this.inferenceEnabled) {
      return; // No model available, skip inference
    }

    this.inferenceRun = now();

    // Sjekk om alle enheter har vært stale i over 120 sekunder
    if (this.isAllDevicesStale(120)) {
      if (this.room !== "na") {
        console.log(`All devices stale for 120s+ – setting room to 'na'`);
        this.room = "na";
        this.room0 = "na";
        this.room0Confident = false;
        this.room0Stable = false;
        this.room0SuperStable = false; // NY
        this.room0Since = now();
        this.room5 = "na";
        this.room15 = "na";
        this.room120 = "na";

        // Fjern låste dører når person forsvinner
        if (this.coordinator) {
          this.coordinator.clearLockedDoors(this.personId);
        }

        this.publishState();
      }
      return; // Ikke kjør inference når alle enheter er utilgjengelige
    }

    // Build 14-dimensional input: [value, fresh, value, fresh, ...]
    let inputData = [];
    for (const s of sensorData) {
      inputData.push(s.value);
      inputData.push(s.fresh);
    }

    this.inference.predict([inputData]).then((output) => {
      if (config.debug) console.log("Inference result:", output);

      let sensorOutput = Array.from(output).map((val, idx) => ({
        room: this.inference.getRoom(idx),
        idx: idx,
        value: val,
      }));

      sensorOutput.sort((a, b) => b.value - a.value);
      this.lastPredictions = sensorOutput;
      this.setRoom(sensorOutput[0].room, sensorOutput[0].value);

      this.debugRoom();
      if (config.debug) {
        console.log(
          " 1. " +
            sensorOutput[0].room +
            " \t" +
            Math.round(sensorOutput[0].value * 100) +
            "%"
        );
        console.log(
          " 2. " +
            sensorOutput[1].room +
            " \t" +
            Math.round(sensorOutput[1].value * 100) +
            "%"
        );
        console.log(
          " 3. " +
            sensorOutput[2].room +
            " \t" +
            Math.round(sensorOutput[2].value * 100) +
            "%"
        );

        console.log(sensorOutput);
      }
    });

    this.debugState();
  }

  debugRoom() {
    if (config.debug) {
      const since = now() - this.room0Since;
      console.log(
        `Room [${this.room}] room0[${this.room0}] ` +
        `conf:${this.room0Confident} stable:${this.room0Stable} ` +
        `since ${since}s  5s[${this.room5}]  15s[${this.room15}]  120s[${this.room120}]`
      );
    }
  }

  debugState() {
    if (config.debug) {
      // Show active device info
      console.log(`Active device: ${this.activeDevice}`);
      for (const [deviceId, state] of Object.entries(this.deviceStates)) {
        const age = now() - state.lastUpdate;
        const marker = deviceId === this.activeDevice ? " [ACTIVE]" : "";
        console.log(`  ${deviceId}: ${age}s ago${marker}`);
      }

      // Show sensor table for active device
      const activeState = this.deviceStates[this.activeDevice];
      let status = activeState.sensors.map(processStatus);

      const formatColumn = (str, width) => {
        return str.length > width
          ? str.slice(0, width)
          : str.padEnd(width, " ");
      };

      const formattedStatus = status.map((s) => {
        return `${formatColumn(s.room, 12)} | ${formatColumn(
          s.raw.toFixed(2),
          6
        )} | ${formatColumn(s.distance.toFixed(2), 6)} | ${formatColumn(
          s.value.toFixed(2),
          6
        )} | ${formatColumn(s.ago.toString(), 5)}`;
      });

      console.log("Room         | Raw    | Dist   | Value  | Ago  ");
      console.log("-------------|--------|--------|--------|------");
      formattedStatus.forEach((line) => console.log(line));
    }
  }
}

module.exports = PersonTracker;
