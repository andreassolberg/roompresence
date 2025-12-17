# Room Presence

A room presence detection system using Bluetooth distance measurements from [ESPresense](https://espresense.com) sensors. The system consists of three parts: a web app for collecting training data by labeling which room you're in, tools for training machine learning models on the data, and an inference engine that runs the model in real-time and publishes person-to-room mappings to MQTT for home automation.

## Quick Start

### 1. Configure

Copy the example config and edit with your MQTT broker and device IDs:

```bash
cp app/etc/config.example.json app/etc/config.json
# Edit app/etc/config.json with your settings
```

### 2. Collect Training Data

Start the app in training mode and use the web UI to label rooms:

```bash
./app.sh --train
# Open http://localhost:8080 and click room buttons while moving around
```

This builds the Docker image and runs the container with the web UI on port 8080.

Use `--ngrok` to expose the UI externally (useful for labeling from your phone while walking around):

```bash
./app.sh --train --ngrok
```

Data saves to `app/data/` every 2 minutes.

### 3. Create Dataset

```bash
mkdir -p build_model/data/mydata
cp app/data/*.json build_model/data/mydata/
```

### 4. Train Model

```bash
./train.sh mydata --model xgb
```

Output: `build_model/output/mydata/`

### 5. Deploy Model

```bash
./deploy.sh mydata
```

### 6. Run Inference

```bash
./app.sh
```

## Model Options

- `--model xgb` - XGBoost (recommended, ~99% accuracy)
- `--model rf` - Random Forest
- `--model mlp` - Neural Network
- `--model all` - Train all three
