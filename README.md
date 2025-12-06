# Room Presence Model Training

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
