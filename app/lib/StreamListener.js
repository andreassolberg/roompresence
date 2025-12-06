// Import required modules
const mqtt = require("mqtt");
const EventEmitter = require("events");
const config = require("./config");

class StreamListener {
  constructor(deviceId) {
    const { brokerUrl, username, password } = config.mqtt;

    console.log(`Attempting to connect to MQTT broker at ${brokerUrl}...`);

    // Initialize the MQTT client with connection timeout
    this.client = mqtt.connect(brokerUrl, {
      username,
      password,
      connectTimeout: 10000, // 10 second timeout
      reconnectPeriod: 5000,
    });
    this.topic = `espresense/devices/${deviceId}/#`;
    this.emitter = new EventEmitter();

    // Set up the MQTT client to listen for messages
    this.client.on("connect", () => {
      console.log(`Connected to MQTT broker at ${brokerUrl}`);
      this.client.subscribe(this.topic, (err) => {
        if (err) {
          console.error(`Failed to subscribe to topic ${this.topic}`, err);
        } else {
          console.log(`Subscribed to topic ${this.topic}`);
        }
      });
    });

    this.client.on("message", (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        const splitted = topic.split("/");
        data.topic = topic;
        data.room = splitted[splitted.length - 1];
        this.emitter.emit("data", data);
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    });

    this.client.on("error", (err) => {
      console.error("MQTT client error:", err);
    });
  }

  // Method to register a listener for data events
  onData(callback) {
    this.emitter.on("data", callback);
  }

  // Method to send a message to a specific MQTT topic
  sendMessage(deviceId, content) {
    const topic = `espresense/person/${deviceId}`;
    const message = JSON.stringify(content);
    this.client.publish(topic, message, (err) => {
      if (err) {
        console.error(`Failed to publish message to ${topic}:`, err);
      } else {
        console.log(`Message published to ${topic}`);
      }
    });
  }

  // Close the connection when done
  close() {
    this.client.end(() => {
      console.log("MQTT client disconnected");
    });
  }
}

module.exports = StreamListener;
