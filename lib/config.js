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

  console.log(`Config loaded successfully`);
} catch (err) {
  console.error("Failed to load configuration file:", err.message);
  console.error("Please ensure etc/config.json exists and is valid JSON");
  throw err;
}

module.exports = config;
