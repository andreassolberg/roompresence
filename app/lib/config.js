// Import required modules
const fs = require("fs");
const path = require("path");

let config;

try {
  const configPath = path.join(process.cwd(), "./etc/config.json");
  console.log(`Loading config from: ${configPath}`);
  const configFile = fs.readFileSync(configPath, "utf8");
  config = JSON.parse(configFile);

  // Set default uiPersonId to first person if not specified
  if (!config.uiPersonId && config.people && config.people.length > 0) {
    config.uiPersonId = config.people[0].id;
    console.log(`No uiPersonId specified, defaulting to: ${config.uiPersonId}`);
  }

  // Set default tracking variable if not specified
  if (!config.tracking) {
    config.tracking = "distance";
  }

  // Validate required config fields
  if (!config.sensorOrder) {
    throw new Error("sensorOrder must be defined in config.json");
  }
  if (!config.rooms) {
    throw new Error("rooms must be defined in config.json");
  }

  // Normalize device config: support both 'device' (string) and 'devices' (array)
  if (config.people) {
    for (const person of config.people) {
      if (person.device && !person.devices) {
        // Migrate legacy single-device config to array format
        person.devices = [person.device];
        console.log(`Migrated ${person.id} from single device to devices array`);
      }
      if (!person.devices || person.devices.length === 0) {
        throw new Error(`Person ${person.id} must have at least one device`);
      }
    }
  }

  console.log(`Config loaded successfully`);
} catch (err) {
  console.error("Failed to load configuration file:", err.message);
  console.error("Please ensure etc/config.json exists and is valid JSON");
  throw err;
}

module.exports = config;
