const { now } = require("./utils");
const config = require("./config");

const fs = require("fs");
const path = require("path");

class TrainingData {
  constructor() {
    this.dataqueue = [];
    this.start = now();
    this.room = null;
    this.totalCollected = 0;
    this.historicalCounts = {};  // Counts per room from saved files
    this.lastVector = null;  // Track last sample to avoid duplicates
    this.lastTarget = null;  // Track last target room

    this.loadExistingData();

    setInterval(() => {
      this.processData();
    }, 120000);
  }

  loadExistingData() {
    const dataDir = path.join(process.cwd(), "data");

    if (!fs.existsSync(dataDir)) {
      return;
    }

    const files = fs.readdirSync(dataDir).filter(f => f.endsWith(".json"));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dataDir, file), "utf8");
        const samples = JSON.parse(content);

        for (const sample of samples) {
          this.totalCollected++;
          if (sample.target) {
            this.historicalCounts[sample.target] = (this.historicalCounts[sample.target] || 0) + 1;
          }
        }
      } catch (err) {
        console.error(`Error reading ${file}:`, err.message);
      }
    }

    console.log(`Loaded ${this.totalCollected} existing samples from ${files.length} files`);
  }

  setRoom(room) {
    this.room = room;
    if (room === "") {
      this.room = null;
    }
    // Reset last vector when changing rooms to ensure first sample in new room is collected
    if (this.room !== this.lastTarget) {
      this.lastVector = null;
      this.lastTarget = null;
    }
  }

  processData() {
    return new Promise((resolve) => {
      if (this.dataqueue.length === 0) {
        console.log("No data to send.");
        resolve();
        return;
      }

      console.log("Posting data points to the cloud.", this.dataqueue.length);

      let timestamp = new Date().toISOString();
      timestamp = timestamp
        .replace(/T/, "-")
        .replace(/\.[0-9]{3}Z/, "")
        .replace(/:/g, "_");
      const filename = path.join(process.cwd(), "data", `${timestamp}.json`);

      // Update historical counts before clearing queue
      for (const item of this.dataqueue) {
        if (item.target) {
          this.historicalCounts[item.target] = (this.historicalCounts[item.target] || 0) + 1;
        }
      }

      const queueToSave = this.dataqueue;
      this.dataqueue = [];
      this.start = now();

      fs.writeFile(filename, JSON.stringify(queueToSave, null, 2), (err) => {
        if (err) {
          console.error("Error writing data to file:", err);
        } else {
          console.log(`[${new Date().toLocaleString()}] Data successfully written to ${filename}`);
        }
        resolve();
      });
    });
  }

  getStats() {
    // Start with historical counts
    const stats = { ...this.historicalCounts };

    // Add current queue counts
    for (const item of this.dataqueue) {
      if (item.target) {
        stats[item.target] = (stats[item.target] || 0) + 1;
      }
    }

    return {
      currentRoom: this.room,
      counts: stats,
      total: this.dataqueue.length,
      totalCollected: this.totalCollected
    };
  }

  addData(sensordata) {
    if (!this.room) {
      return;
    }

    // Bygg vektor basert på sensorOrder: [value1, fresh1, value2, fresh2, ...]
    const vector = [];
    for (const sensorName of config.sensorOrder) {
      const sensor = sensordata.find((s) => s.room === sensorName);
      if (sensor) {
        vector.push(sensor.value);
        vector.push(sensor.fresh);
      } else {
        vector.push(10);  // default value for manglende sensor
        vector.push(0);   // ikke fresh
      }
    }

    // Skip if identical to last sample (same target and same vector)
    if (this.lastVector && this.lastTarget === this.room) {
      const isIdentical = vector.length === this.lastVector.length &&
        vector.every((val, idx) => Math.abs(val - this.lastVector[idx]) < 1e-6);

      if (isIdentical) {
        console.log("Skipping duplicate sample (identical to previous)");
        return;
      }
    }

    this.dataqueue.push({
      time: now(),
      target: this.room,
      data: sensordata,
      vector: vector,
    });
    this.totalCollected++;
    this.lastVector = vector;
    this.lastTarget = this.room;
    console.log("Data added to queue.", sensordata);
  }
}

module.exports = TrainingData;
