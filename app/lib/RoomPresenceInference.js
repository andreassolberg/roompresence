const ort = require("onnxruntime-node");
const fs = require("fs");

class RoomPresenceInference {
  constructor(modelPath, metadataPath) {
    this.modelPath = modelPath || "./models/model.onnx";
    this.metadataPath = metadataPath || "./models/metadata.json";
    this.session = null;
    this.metadata = null;
  }

  // Load the ONNX model and metadata
  async loadModel() {
    try {
      // Load metadata first
      console.log("Loading metadata from", this.metadataPath);
      const metadataContent = fs.readFileSync(this.metadataPath, "utf8");
      this.metadata = JSON.parse(metadataContent);
      console.log(
        `Metadata loaded: ${this.metadata.num_classes} classes, ${this.metadata.num_features} features`
      );

      // Load ONNX model
      console.log("Loading ONNX model from", this.modelPath);
      this.session = await ort.InferenceSession.create(this.modelPath);
      console.log("Model loaded successfully.");
    } catch (error) {
      console.error("Error loading model:", error);
      throw error;
    }
  }

  // Get room name from model output index
  getRoom(idx) {
    if (!this.metadata) {
      throw new Error("Metadata not loaded. Call loadModel() first.");
    }
    return this.metadata.idx_to_room[String(idx)];
  }

  // Get list of all rooms the model can predict
  getRooms() {
    if (!this.metadata) {
      throw new Error("Metadata not loaded. Call loadModel() first.");
    }
    // Return rooms in order of their indices
    const rooms = [];
    for (let i = 0; i < this.metadata.num_classes; i++) {
      rooms.push(this.metadata.idx_to_room[String(i)]);
    }
    return rooms;
  }

  // Get sensor order used during training
  getSensorOrder() {
    if (!this.metadata) {
      throw new Error("Metadata not loaded. Call loadModel() first.");
    }
    return this.metadata.sensor_order;
  }

  // Run inference on the input data
  async predict(inputData) {
    if (!this.session) {
      throw new Error("Model is not loaded. Call loadModel() first.");
    }

    try {
      // Convert the input data to a Tensor
      const inputTensor = new ort.Tensor("float32", inputData.flat(), [
        1,
        inputData[0].length,
      ]);

      // Define the input feed
      const feeds = { [this.session.inputNames[0]]: inputTensor };

      // Run inference
      const results = await this.session.run(feeds);

      // XGBoost ONNX models output probabilities in 'probabilities' or first output
      const outputName =
        this.session.outputNames.find((n) => n === "probabilities") ||
        this.session.outputNames[0];
      const output = results[outputName].data;

      return output;
    } catch (error) {
      console.error("Error during prediction:", error);
      throw error;
    }
  }
}

module.exports = RoomPresenceInference;
