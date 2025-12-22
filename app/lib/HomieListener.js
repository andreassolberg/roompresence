const mqtt = require("mqtt");
const EventEmitter = require("events");
const config = require("./config");

class HomieListener {
  constructor() {
    const { brokerUrl, username, password } = config.mqtt;

    console.log(`HomieListener attempting to connect to MQTT broker at ${brokerUrl}...`);

    // Initialize the MQTT client with connection timeout
    this.client = mqtt.connect(brokerUrl, {
      username,
      password,
      connectTimeout: 10000, // 10 second timeout
      reconnectPeriod: 5000,
    });

    this.emitter = new EventEmitter();
    this.subscriptions = []; // Track active subscriptions

    // Set up the MQTT client to listen for messages
    this.client.on("connect", () => {
      console.log(`HomieListener connected to MQTT broker at ${brokerUrl}`);
      // Subscriptions are added dynamically via subscribeToDoor()
    });

    this.client.on("message", (topic, message) => {
      try {
        // Parse Homie topic: homie/{deviceId}/{nodeId}/{property}
        const parts = topic.split("/");
        if (parts.length < 4 || parts[0] !== "homie") {
          return; // Not a valid Homie topic
        }

        // Skip Homie metadata topics (contain $)
        if (topic.includes("$")) {
          return;
        }

        const [, deviceId, nodeId, property] = parts;
        const rawMessage = message.toString();

        // Debug logging
        console.log(`[HomieListener] Received: ${topic} = "${rawMessage}"`);

        // Parse message value - Homie uses string "true"/"false"
        const value = this.parseHomieValue(rawMessage, property);

        console.log(`[HomieListener] Parsed value:`, value, `(type: ${typeof value})`);

        this.emitter.emit("data", {
          deviceId,
          nodeId,
          property,
          value,
          topic,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error("Error parsing Homie message:", err, "topic:", topic);
      }
    });

    this.client.on("error", (err) => {
      console.error("HomieListener MQTT error:", err);
    });
  }

  // Subscribe to a specific door sensor
  subscribeToDoor(doorId) {
    if (!config.house || !config.house.homieDeviceId) {
      console.error("Cannot subscribe to door: config.house.homieDeviceId not configured");
      return;
    }

    const topic = `homie/${config.house.homieDeviceId}/${doorId}/#`;

    this.client.subscribe(topic, (err) => {
      if (err) {
        console.error(`Failed to subscribe to ${topic}`, err);
      } else {
        console.log(`Subscribed to door sensor: ${topic}`);
        this.subscriptions.push(topic);
      }
    });
  }

  // Parse Homie protocol values
  parseHomieValue(messageStr, property) {
    // Handle boolean contact sensors
    if (property === "alarm-contact") {
      // Homie convention: "true" string = open, "false" = closed
      if (messageStr === "true") return true;
      if (messageStr === "false") return false;
      // Also handle actual boolean values
      if (messageStr === true || messageStr === false) return messageStr;
    }

    // For extensibility: handle other property types
    // Temperature, humidity, etc. would be parsed here
    return messageStr;
  }

  // Register data listener
  onData(callback) {
    this.emitter.on("data", callback);
  }

  // Cleanup
  close() {
    this.client.end(() => {
      console.log("HomieListener disconnected");
    });
  }
}

module.exports = HomieListener;
