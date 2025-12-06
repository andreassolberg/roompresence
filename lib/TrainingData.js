const { now } = require("./utils");

const fs = require("fs");
const path = require("path");

class TrainingData {
  constructor() {
    this.dataqueue = [];
    this.start = now();
    this.room = null;

    setInterval(() => {
      this.processData();
    }, 120000);
  }

  setRoom(room) {
    this.room = room;
    if (room === "") {
      this.room = null;
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
      const jsonData = JSON.stringify(this.dataqueue, null, 2);

      fs.writeFile(filename, jsonData, (err) => {
        if (err) {
          console.error("Error writing data to file:", err);
        } else {
          console.log(`[${new Date().toLocaleString()}] Data successfully written to ${filename}`);
        }
        resolve();
      });

      this.dataqueue = [];
      this.start = now();
    });
  }

  addData(sensordata) {
    if (!this.room) {
      console.log("No target set. Skip data");
      return;
    }
    this.dataqueue.push({
      time: now(),
      target: this.room,
      data: sensordata,
    });
    console.log("Data added to queue.", sensordata);
  }
}

module.exports = TrainingData;
