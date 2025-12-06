const ort = require("onnxruntime-node");

class RoomPresenceInference {
  constructor(modelPath) {
    this.modelPath = modelPath || "./models/roompresense-bob.onnx";
    this.session = null;
  }

  // Load the ONNX model
  async loadModel() {
    try {
      console.log("Loading ONNX model from ", this.modelPath);
      this.session = await ort.InferenceSession.create(this.modelPath);
      console.log("Model loaded successfully.");
    } catch (error) {
      console.error("Error loading model:", error);
      throw error;
    }
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

      // Extract the first output (assuming single output)
      const outputName = this.session.outputNames[0];
      const output = results[outputName].data;

      return output;
    } catch (error) {
      console.error("Error during prediction:", error);
      throw error;
    }
  }
}

module.exports = RoomPresenceInference;

// Example usage:
// const RoomPresenceInference = require('./RoomPresenceInference');
// const inference = new RoomPresenceInference('./models/roompresense-bob.onnx');
// (async () => {
//     await inference.loadModel();
//     const result = await inference.predict([[1, 2, 3, 4]]); // Replace with appropriate input data
//     console.log('Inference result:', result);
// })();
