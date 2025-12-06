const StreamListener = require("./StreamListener");
const RoomPresenceInference = require("./RoomPresenceInference");
const config = require("./config");
const EventEmitter = require("events");
const { now } = require("./utils");

const rooms = [
  "bad",
  "gang",
  "gjesterom",
  "kjellergang",
  "kjellerstua",
  "kjokken",
  "kontor",
  "linnea",
  "linus",
  "mb",
  "stua",
  "ute",
  "vaskerom",
];

const sensors = [
  "bad",
  "vaskerom",
  "mb",
  "kjellerstua",
  "kjokken",
  "kontor",
  "stua",
];

const processStatus = (status) => {
  let s = Object.assign({}, status);
  s.ago = now() - s.updated;
  if (s.ago > 20) s.raw = 15;
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
    this.rooms = rooms;

    this.emitter = new EventEmitter();

    this.inferenceRun = now();

    this.inference = new RoomPresenceInference();
    this.ready = false;

    this.sensors = sensors.map((room) => ({
      raw: 15,
      room,
      updated: now(),
    }));
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
    this.ready = true;
  }

  setData(data) {
    if (config.debug) console.log("Data received:", data);

    let idx = this.sensors.findIndex((s) => s.room === data.room);
    if (idx === -1) {
      if (config.debug) console.error("Unknown room:", data.room);
      return;
    }
    this.sensors[idx].raw = data.distance;
    this.sensors[idx].updated = now();

    let sensorData = this.sensors.map(processStatus);

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

    let inputData = sensorData.map((s) => s.raw);
    this.inference.predict([inputData]).then((output) => {
      if (config.debug) console.log("Inference result:", output);

      let sum = output.reduce((acc, val) => acc + val, 0);
      let sensorOutput = Array.from(output).map((val, idx) => ({
        room: rooms[idx],
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
          s.raw.toString(),
          5
        )} | ${formatColumn(s.ago.toString(), 5)}`;
      });

      console.log("Room         | Dist  | Ago  ");
      console.log("-------------|-------|------");
      formattedStatus.forEach((line) => console.log(line));
    }
  }
}

module.exports = PersonTracker;
