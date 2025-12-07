# Room Presence

A room presence detection system using Bluetooth distance measurements from [ESPresense](https://espresense.com) sensors. The system consists of three parts: a web app for collecting training data by labeling which room you're in, tools for training machine learning models on the data, and an inference engine that runs the model in real-time and publishes person-to-room mappings to MQTT for home automation.

## Quick Start

### 1. Collect Training Data

Start the app and use the web UI to label rooms:

```bash
./app.sh
# Open http://localhost:8080 and click room buttons while moving around
```

Data saves to `app/data/` every 2 minutes.

### 2. Create Dataset

```bash
mkdir -p build_model/data/mydata
cp app/data/*.json build_model/data/mydata/
```

### 3. Train Model

```bash
./train.sh mydata --model xgb
```

Output: `build_model/output/mydata/`

### 4. Deploy Model

```bash
./deploy.sh mydata
```

### 5. Run Inference

```bash
./app.sh
```

## Model Options

- `--model xgb` - XGBoost (recommended, ~99% accuracy)
- `--model rf` - Random Forest
- `--model mlp` - Neural Network
- `--model all` - Train all three
