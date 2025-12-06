// Import required modules
const fs = require("fs");
const path = require("path");

let config;

try {
  const configPath = path.join(process.cwd(), "./etc/config.json");
  const configFile = fs.readFileSync(configPath, "utf8");
  config = JSON.parse(configFile);
} catch (err) {
  console.error("Failed to load configuration file:", err);
  throw err;
}

module.exports = config;
