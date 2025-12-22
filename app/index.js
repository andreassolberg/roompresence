console.log("Starting Roomer...");
const PersonTracker = require("./lib/PersonTracker");
console.log("Loaded PersonTracker");
const config = require("./lib/config");
console.log("Loaded config");
const express = require("express");
const path = require("path");
const fs = require("fs");
console.log("Loaded express and path");

const TrainingData = require("./lib/TrainingData");
console.log("Loaded TrainingData");
const HouseStateMachine = require("./lib/HouseStateMachine");
console.log("Loaded HouseStateMachine");
const trainingMode = process.env.TRAIN_MODE === 'true';
console.log(`Training mode: ${trainingMode}`);
let train = null;
if (trainingMode) {
  train = new TrainingData();
  console.log("Created TrainingData instance");
}

let trackers = {};
let houseState = null;
let transitionCoordinator = null;

(async () => {
  try {
    // FØRST: Initialiser HouseStateMachine
    if (config.house && config.house.doors) {
      console.log("Initializing HouseStateMachine...");
      houseState = new HouseStateMachine();
      await houseState.init();

      // Initialiser transition coordinator
      if (config.house.transitionConstraintsEnabled) {
        console.log("Initializing RoomTransitionCoordinator...");
        const RoomTransitionCoordinator = require("./lib/RoomTransitionCoordinator");
        transitionCoordinator = new RoomTransitionCoordinator(houseState, config, config.people);
        transitionCoordinator.init();
      }

      if (config.debug) {
        houseState.onDoorStateChange((event) => {
          console.log(`[House] Door ${event.doorId}: ${event.state ? 'OPEN' : 'CLOSED'}`);
        });
      }
    } else {
      console.log("HouseStateMachine disabled (no house config)");
    }

    // SÅ: Initialiser PersonTrackers med coordinator
    for (const person of config.people) {
      console.log("Creating tracker for", person.name, "with", person.devices.length, "device(s)");
      trackers[person.id] = new PersonTracker(person.devices, person.id, {
        trainingMode,
        coordinator: transitionCoordinator // Pass coordinator til PersonTracker
      });
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

apiRouter.get("/history", (req, res) => {
  const history = {};
  for (const [personId, tracker] of Object.entries(trackers)) {
    const person = config.people.find(p => p.id === personId);
    history[personId] = {
      name: person?.name || personId,
      currentRoom: tracker.room,
      history: tracker.getRoomHistory()
    };
  }
  res.json(history);
});

apiRouter.get("/status", (req, res) => {
  res.json({
    trainingEnabled: trainingMode,
    personId: config.uiPersonId
  });
});

// House state endpoints
apiRouter.get("/house/doors", (req, res) => {
  if (!houseState || !houseState.ready) {
    return res.status(503).json({ error: "House state tracking not available" });
  }
  res.json(houseState.getDoorStates());
});

apiRouter.get("/house/doors/:doorId", (req, res) => {
  if (!houseState || !houseState.ready) {
    return res.status(503).json({ error: "House state tracking not available" });
  }
  const doorState = houseState.getDoorState(req.params.doorId);
  if (!doorState) {
    return res.status(404).json({ error: `Door not found: ${req.params.doorId}` });
  }
  res.json(doorState);
});

apiRouter.get("/house/doors/:doorId/history", (req, res) => {
  if (!houseState || !houseState.ready) {
    return res.status(503).json({ error: "House state tracking not available" });
  }
  const history = houseState.getDoorHistory(req.params.doorId);
  res.json({ doorId: req.params.doorId, history, count: history.length });
});

apiRouter.get("/house/history", (req, res) => {
  if (!houseState || !houseState.ready) {
    return res.status(503).json({ error: "House state tracking not available" });
  }
  res.json(houseState.getAllHistory());
});

// Training data analysis endpoints
const trainingDataPath = process.env.TRAINING_DATA_PATH || path.join(__dirname, "../build_model/data");

apiRouter.get("/datasets", (req, res) => {
  try {
    if (!fs.existsSync(trainingDataPath)) {
      return res.json([]);
    }
    const datasets = fs.readdirSync(trainingDataPath)
      .filter(f => fs.statSync(path.join(trainingDataPath, f)).isDirectory());
    res.json(datasets);
  } catch (error) {
    console.error("Error listing datasets:", error);
    res.status(500).json({ error: "Failed to list datasets" });
  }
});

apiRouter.get("/training-data", (req, res) => {
  const dataset = req.query.dataset;
  if (!dataset) {
    return res.status(400).json({ error: "Dataset parameter required" });
  }

  const datasetPath = path.join(trainingDataPath, dataset);
  if (!fs.existsSync(datasetPath)) {
    return res.status(404).json({ error: "Dataset not found" });
  }

  try {
    const files = fs.readdirSync(datasetPath).filter(f => f.endsWith(".json"));
    const allSamples = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(datasetPath, file), "utf8");
      const samples = JSON.parse(content);
      allSamples.push(...samples);
    }

    // Aggregate data: collect all sensor values per target room
    const aggregated = {};
    const sensorNames = new Set();

    for (const sample of allSamples) {
      if (!sample.target || !sample.data) continue;

      if (!aggregated[sample.target]) {
        aggregated[sample.target] = { count: 0, sensors: {} };
      }
      aggregated[sample.target].count++;

      for (const sensor of sample.data) {
        sensorNames.add(sensor.room);
        if (!aggregated[sample.target].sensors[sensor.room]) {
          aggregated[sample.target].sensors[sensor.room] = { values: [] };
        }
        aggregated[sample.target].sensors[sensor.room].values.push(sensor.value);
      }
    }

    // Convert to result format with averages and all values
    const result = {
      sensors: Array.from(sensorNames),
      rooms: Object.keys(aggregated),
      roomCounts: {},
      totalSamples: 0,
      data: []
    };

    for (const [room, data] of Object.entries(aggregated)) {
      result.roomCounts[room] = data.count;
      result.totalSamples += data.count;
      for (const [sensor, sensorData] of Object.entries(data.sensors)) {
        const values = sensorData.values;
        const sum = values.reduce((a, b) => a + b, 0);
        result.data.push({
          room,
          sensor,
          value: sum / values.length,
          values: values, // Include all values for violin plot
          count: data.count
        });
      }
    }

    res.json(result);
  } catch (error) {
    console.error("Error loading training data:", error);
    res.status(500).json({ error: "Failed to load training data" });
  }
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

  apiRouter.get("/training-stats", (req, res) => {
    res.json(train.getStats());
  });
} else {
  apiRouter.post("/room", (req, res) => {
    res.status(403).json({ error: "Training mode is disabled" });
  });

  apiRouter.get("/training-stats", (req, res) => {
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
    console.log('Training data saved.');
  }
  if (houseState) {
    houseState.close();
    console.log('House state tracking closed.');
  }
  console.log('Goodbye!');
  process.exit(0);
});
