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
  constructor(deviceId, personId) {
    this.personId = personId;
    this.room = null;
    this.room5 = null;
    this.room15 = null;
    this.roomSince = now();
    this.rooms = null; // Will be loaded from model metadata

    this.emitter = new EventEmitter();

    this.inferenceRun = now();

    this.inference = new RoomPresenceInference();
    this.ready = false;
    this.sensors = null; // Will be initialized from model metadata

    this.stream = new StreamListener(deviceId);
    this.stream.onData((data) => {
      this.setData(data);
    });

    setInterval(() => {
      // console.log("Tick ", now() - this.inferenceRun);
      if (now() - this.inferenceRun > 5) {
        // console.log("Run inference because it is 5 sec since last time.");
        this.runInference();
      }
    }, 1500);
  }

  onSensorData(callback) {
    this.emitter.on("sensor", callback);
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
    }
    if (config.publish && updated) {
      this.stream.sendMessage(this.personId, {
        room: this.room,
        room5: this.room5,
        room15: this.room15,
      });
    }
  }

  async init() {
    await this.inference.loadModel();

    // Get room list from model metadata
    this.rooms = this.inference.getRooms();
    console.log(`Model supports ${this.rooms.length} rooms:`, this.rooms);

    // Initialize sensors from model metadata (ensures consistency with training)
    const sensorOrder = this.inference.getSensorOrder();
    this.sensors = sensorOrder.map((room) => ({
      raw: 15,
      distance: 15,
      room,
      updated: now(),
    }));
    console.log(`Using ${sensorOrder.length} sensors:`, sensorOrder);

    this.ready = true;
  }

  setData(data) {
    if (config.debug) console.log("Data received:", data);

    let idx = this.sensors.findIndex((s) => s.room === data.room);
    if (idx === -1) {
      if (config.debug) console.error("Unknown room:", data.room);
      return;
    }

    let hasUpdate = false;
    if (data.raw !== undefined) {
      this.sensors[idx].raw = data.raw;
      hasUpdate = true;
    }
    if (data.distance !== undefined) {
      this.sensors[idx].distance = data.distance;
      hasUpdate = true;
    }

    if (hasUpdate) {
      this.sensors[idx].updated = now();
    }

    this.runInference();
  }

  getSensordataProcessed() {
    return this.sensors.map(processStatus);
  }

  runInference() {
    if (!this.ready) {
      console.log("Cannot run inference – waiting for model to load");
      return;
    }
    this.inferenceRun = now();

    let sensorData = this.sensors.map(processStatus);

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
        `Room [${this.room}]  since ${now() - this.roomSince}s    2[${
          this.room5
        }]   3[${this.room15}]`
      );
    }
  }

  debugState() {
    if (config.debug) {
      let status = this.sensors.map(processStatus);

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
