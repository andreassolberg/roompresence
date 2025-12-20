console.log("Starting Roomer...");
const PersonTracker = require("./lib/PersonTracker");
console.log("Loaded PersonTracker");
const config = require("./lib/config");
console.log("Loaded config");
const express = require("express");
const path = require("path");
console.log("Loaded express and path");

const TrainingData = require("./lib/TrainingData");
console.log("Loaded TrainingData");
const trainingMode = process.env.TRAIN_MODE === 'true';
console.log(`Training mode: ${trainingMode}`);
let train = null;
if (trainingMode) {
  train = new TrainingData();
  console.log("Created TrainingData instance");
}

let trackers = {};
(async () => {
  try {
    for (const person of config.people) {
      console.log("Creating tracker for ", person.name, "with", person.devices.length, "device(s)");
      trackers[person.id] = new PersonTracker(person.devices, person.id);
      await trackers[person.id].init();

      if (person.id === config.uiPersonId) {
        if (trainingMode) {
          console.log(`Enable tracking of data for ${person.id}`);
          trackers[person.id].onSensorData((data) => {
            train.addData(data);
          });
        }
      }
    }
    console.log("All trackers initialized successfully");
  } catch (error) {
    console.error("Error initializing trackers:", error);
  }
})();

const app = express();
const port = 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const apiRouter = express.Router();
apiRouter.get("/sensors", (req, res) => {
  const personId = req.query.person || config.uiPersonId;
  if (!trackers[personId]) {
    return res.status(404).json({ error: `Tracker not found for person: ${personId}` });
  }
  res.json(trackers[personId].getSensordataProcessed());
});
apiRouter.get("/rooms", (req, res) => {
  const personId = config.uiPersonId;
  if (!trackers[personId]) {
    return res.status(404).json({ error: `Tracker not found for person: ${personId}` });
  }
  res.json(trackers[personId].rooms);
});

apiRouter.get("/devices", (req, res) => {
  const personId = req.query.person || config.uiPersonId;
  if (!trackers[personId]) {
    return res.status(404).json({ error: `Tracker not found for person: ${personId}` });
  }
  res.json(trackers[personId].getDeviceStatus());
});

apiRouter.get("/predictions", (req, res) => {
  const personId = req.query.person || config.uiPersonId;
  if (!trackers[personId]) {
    return res.status(404).json({ error: `Tracker not found for person: ${personId}` });
  }
  res.json(trackers[personId].getPredictions() || []);
});

apiRouter.get("/people", (req, res) => {
  res.json(config.people.map(p => ({ id: p.id, name: p.name })));
});

apiRouter.get("/status", (req, res) => {
  res.json({
    trainingEnabled: trainingMode,
    personId: config.uiPersonId
  });
});

if (trainingMode) {
  apiRouter.post("/room", (req, res) => {
    const room = req.body;
    if (typeof room.room === "string") {
      train.setRoom(room.room);
      res.status(200).send("Room updated successfully");
    } else {
      res.status(400).send("Invalid room data: " + typeof room);
    }
  });
} else {
  apiRouter.post("/room", (req, res) => {
    res.status(403).json({ error: "Training mode is disabled" });
  });
}

app.use("/api", apiRouter);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Graceful shutdown - save training data before exit
let isShuttingDown = false;
process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\nShutting down gracefully...');
  if (trainingMode && train) {
    await train.processData();
    console.log('Training data saved. Goodbye!');
  }
  process.exit(0);
});
