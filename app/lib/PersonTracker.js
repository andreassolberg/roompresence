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
  constructor(devices, personId) {
    this.personId = personId;
    this.devices = Array.isArray(devices) ? devices : [devices]; // Support single device for backward compat
    this.room = null;
    this.room5 = null;
    this.room15 = null;
    this.room120 = null;
    this.roomSince = now();
    this.rooms = null; // Will be loaded from model metadata

    this.emitter = new EventEmitter();

    this.inferenceRun = now();

    this.inference = new RoomPresenceInference();
    this.ready = false;

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

  initializeDevices() {
    const sensorOrder = this.inference.getSensorOrder();

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

  publishState() {
    if (config.publish && this.room) {
      const activeState = this.deviceStates[this.activeDevice];
      activeState.stream.sendMessage(this.personId, {
        room: this.room,
        room5: this.room5,
        room15: this.room15,
        room120: this.room120,
        activeDevice: this.activeDevice,
      });
    }
  }

  setRoom(room) {
    let since = now() - this.roomSince;
    let updated = false;
    if (room !== this.room) {
      this.roomSince = now();
      updated = true;
      this.room = room;
    } else {
      if (since > 5 && this.room5 !== room) {
        this.room5 = room;
        updated = true;
      }
      if (since > 15 && this.room15 !== room) {
        this.room15 = room;
        updated = true;
      }
      if (since > 120 && this.room120 !== room) {
        this.room120 = room;
        updated = true;
      }
    }
    if (updated) {
      this.publishState();
    }
  }

  async init() {
    await this.inference.loadModel();

    // Get room list from model metadata
    this.rooms = this.inference.getRooms();
    console.log(`Model supports ${this.rooms.length} rooms:`, this.rooms);

    // Initialize devices (creates StreamListeners and sensor arrays)
    const sensorOrder = this.inference.getSensorOrder();
    console.log(`Using ${sensorOrder.length} sensors:`, sensorOrder);
    console.log(`Initializing ${this.devices.length} device(s) for ${this.personId}:`);
    this.initializeDevices();

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

  runInference() {
    if (!this.ready) {
      console.log("Cannot run inference – waiting for model to load");
      return;
    }
    this.inferenceRun = now();

    // Use only active device's sensor data
    const activeState = this.deviceStates[this.activeDevice];
    let sensorData = activeState.sensors.map(processStatus);

    this.emitter.emit("sensor", sensorData);

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
      this.setRoom(sensorOutput[0].room);

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
      console.log(
        `Room [${this.room}]  since ${now() - this.roomSince}s    5s[${
          this.room5
        }]   15s[${this.room15}]   120s[${this.room120}]`
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
