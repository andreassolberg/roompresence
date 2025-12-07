# Training Data Documentation

This document describes the structure of training data collected for the room recognition model.

## File Format and Storage

- **Location:** `data/` directory
- **Filename:** `YYYY-MM-DD-HH_MM_SS.json` (ISO timestamp)
- **Format:** JSON array of data points
- **Save interval:** Every 2 minutes (120 seconds)

## Data Structure

Each file contains a JSON array of objects. Each object represents a snapshot of sensor data:

```json
{
  "time": 1765053098,
  "target": "kjokken",
  "data": [...],
  "vector": [3.75, 1, 6.97, 1, 7.43, 1, 10, 0, 0.29, 1, 10, 0, 5.28, 1]
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `time` | number | Unix timestamp (seconds) |
| `target` | string | Label - the room the person is actually in |
| `data` | array | Detailed sensor data (for debugging/analysis) |
| `vector` | array | **Pre-processed input vector for the ML model** |

## Vector Format (Critical for ML)

`vector` is the most important property for training. It contains pre-processed values ready for direct use as model input.

### Structure

The vector has **14 elements** - 2 per sensor (7 sensors total):

```
[value1, fresh1, value2, fresh2, value3, fresh3, ...]
```

For each sensor in order:
1. `value` (float): Distance value 0-10
2. `fresh` (int): Freshness indicator (0 or 1)

### Sensor Order (default)

The order of sensors in the vector is defined in config (`sensorOrder`):

| Index | Sensor | Value position | Fresh position |
|-------|--------|----------------|----------------|
| 0 | bad | 0 | 1 |
| 1 | vaskerom | 2 | 3 |
| 2 | mb | 4 | 5 |
| 3 | kjellerstua | 6 | 7 |
| 4 | kjokken | 8 | 9 |
| 5 | kontor | 10 | 11 |
| 6 | stua | 12 | 13 |

### Value Calculation

`value` is calculated from raw sensor data as follows:
- Based on `distance` (or `raw` if config.tracking="raw")
- **Capped at maximum 10** (values over 10 are set to 10)
- **Set to 10 if `ago > 10` seconds** (stale data is treated as "far away")

### Fresh Calculation

`fresh` indicates whether the sensor data is up to date:
- `1` if `ago < 10` seconds (fresh data)
- `0` if `ago >= 10` seconds (stale data)

## Target Labels (Output Classes)

The system recognizes 13 rooms:

| Index | Room |
|-------|------|
| 0 | bad |
| 1 | gang |
| 2 | gjesterom |
| 3 | kjellergang |
| 4 | kjellerstua |
| 5 | kjokken |
| 6 | kontor |
| 7 | children1 |
| 8 | children2 |
| 9 | mb |
| 10 | stua |
| 11 | ute |
| 12 | vaskerom |

## ML Training Hints

### 1. Input Dimensions

```python
X = vectors  # Shape: (n_samples, 14)
y = targets  # Shape: (n_samples,) - categorical (13 classes)
```

### 2. Handling the Fresh Flag

The fresh flag is critical information. It tells the model which sensors have reliable data:

```python
# Option 1: Use the entire vector directly (recommended)
# The model learns to weight the fresh flag itself

# Option 2: Mask stale values
# Set value=10 AND fresh=0 as a consistent signal for "no data"
```

**Important:** When `fresh=0`, `value` is always set to 10. This is already handled in preprocessing.

### 3. Distance Interpretation

- **Low value (0-2):** Person is close to this sensor
- **Medium value (2-5):** Person is nearby
- **High value (5-10):** Person is far away or data is stale

### 4. Rooms Without Sensors

Some rooms (gang, gjesterom, kjellergang, children1, children2, ute) have no dedicated sensor. The model must learn to recognize these based on:
- Combination of distances to nearby sensors
- The pattern of "no nearby sensor" (all values medium/high)

### 5. Class Balance

Check the distribution of target labels. Rooms without sensors will typically have fewer training examples:

```python
from collections import Counter
label_counts = Counter(targets)
print(label_counts)
```

Consider:
- Oversampling underrepresented classes
- Class weights in the loss function
- Stratified train/test split

### 6. Temporal Patterns

Data is collected approximately every 2 seconds (on sensor updates). Sequences of data points can be used for:
- Sequence models (LSTM, Transformer)
- Feature engineering (moving average, rate of change)

### 7. Feature Engineering Ideas

```python
# Minimum distance (nearest sensor)
min_distance = min(vector[::2])  # Every other value is distance

# Number of fresh sensors
n_fresh = sum(vector[1::2])  # Every other value from index 1 is fresh

# Difference between nearest sensors
sorted_distances = sorted(vector[::2])
distance_gap = sorted_distances[1] - sorted_distances[0]
```

### 8. Recommended Model Architecture

For 14-dimensional input with 13 classes:

```python
# Simple baseline
model = Sequential([
    Dense(64, activation='relu', input_shape=(14,)),
    Dropout(0.3),
    Dense(32, activation='relu'),
    Dropout(0.3),
    Dense(13, activation='softmax')
])
```

### 9. Data Loading Example

```python
import json
import glob
import numpy as np

def load_training_data(data_dir='data/'):
    X, y = [], []
    room_to_idx = {
        'bad': 0, 'gang': 1, 'gjesterom': 2, 'kjellergang': 3,
        'kjellerstua': 4, 'kjokken': 5, 'kontor': 6, 'children1': 7,
        'children2': 8, 'mb': 9, 'stua': 10, 'ute': 11, 'vaskerom': 12
    }

    for filepath in glob.glob(f'{data_dir}/*.json'):
        with open(filepath) as f:
            samples = json.load(f)
            for sample in samples:
                X.append(sample['vector'])
                y.append(room_to_idx[sample['target']])

    return np.array(X), np.array(y)

X, y = load_training_data()
print(f"Loaded {len(X)} samples")
print(f"Input shape: {X.shape}")
print(f"Classes: {np.unique(y)}")
```

### 10. Evaluation

Recommended metrics:
- **Accuracy:** Overall performance
- **Confusion matrix:** Identify which rooms are confused
- **Per-class F1:** Important for imbalanced classes

```python
from sklearn.metrics import classification_report, confusion_matrix

print(classification_report(y_true, y_pred, target_names=rooms))
```

## Data Quality

### Common Problems

1. **Label delay:** User clicks on room after having moved
2. **Transition phases:** Data collected while person is walking between rooms
3. **Sensor dropout:** Some sensors don't always report

### Quality Filtering

```python
# Filter out samples with too many stale sensors
def quality_filter(sample):
    n_fresh = sum(sample['vector'][1::2])
    return n_fresh >= 3  # At least 3 fresh sensors

clean_samples = [s for s in samples if quality_filter(s)]
```

## Export to ONNX

The system uses ONNX format for inference. After training:

```python
import torch.onnx

torch.onnx.export(model, dummy_input,
                  "models/roompresense.onnx",
                  input_names=['input'],
                  output_names=['output'],
                  dynamic_axes={'input': {0: 'batch_size'}})
```

Input tensor shape: `[batch_size, 14]`
Output tensor shape: `[batch_size, 13]` (probabilities per room)
