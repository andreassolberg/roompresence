const PersonTracker = require("./lib/PersonTracker");
const config = require("./lib/config");
const express = require("express");
const path = require("path");

const TrainingData = require("./lib/TrainingData");
const train = new TrainingData();

let trackers = {};
(async () => {
  for (const person of config.people) {
    console.log("Creating tracker for ", person.name);
    trackers[person.id] = new PersonTracker(person.device, person.id);
    await trackers[person.id].init();

    if (person.id === "andreas") {
      if (config.track) {
        console.log("Enable tracking of data");
        trackers.andreas.onSensorData((data) => {
          train.addData(data);
        });
      }
    }
  }
})();

const app = express();
const port = 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const apiRouter = express.Router();
apiRouter.get("/sensors", (req, res) => {
  res.json(trackers.andreas.getSensordataProcessed());
});
apiRouter.get("/rooms", (req, res) => {
  res.json(trackers.andreas.rooms);
});

apiRouter.post("/room", (req, res) => {
  const room = req.body;
  if (typeof room.room === "string") {
    train.setRoom(room.room);
    res.status(200).send("Room updated successfully");
  } else {
    res.status(400).send("Invalid room data: " + typeof room);
  }
});

app.use("/api", apiRouter);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
