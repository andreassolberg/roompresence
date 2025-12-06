#!/usr/bin/env python3
"""
Room Presence Model Training Script

Usage:
    python train.py <dataset_name> [--model <model_type>]

Example:
    python train.py des25
    python train.py des25 --model rf
    python train.py des25 --model xgb
    python train.py des25 --model mlp
"""

import argparse
import json
import glob
import os
import sys
import pickle
from pathlib import Path
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import matplotlib.pyplot as plt
import seaborn as sns


def load_config(config_path: str = '/app/config.json') -> dict:
    """Load configuration from config.json (authoritative source for rooms/sensors)."""
    with open(config_path, 'r') as f:
        return json.load(f)


# Load config - authoritative source for rooms and sensors
CONFIG = load_config()
ROOMS = CONFIG['rooms']
SENSOR_ORDER = CONFIG['sensorOrder']

ROOM_TO_IDX = {room: idx for idx, room in enumerate(ROOMS)}
IDX_TO_ROOM = {idx: room for idx, room in enumerate(ROOMS)}


def load_training_data(data_dir: str) -> tuple[np.ndarray, np.ndarray, list[str], dict, dict]:
    """Load all JSON training data from a directory.

    Returns:
        X: Feature matrix
        y: Labels (remapped to contiguous indices 0..n_classes-1)
        targets: Original room names
        idx_to_room: Mapping from contiguous index to room name
        room_to_idx: Mapping from room name to contiguous index
    """
    X, targets = [], []

    json_files = glob.glob(os.path.join(data_dir, '*.json'))
    if not json_files:
        raise FileNotFoundError(f"No JSON files found in {data_dir}")

    print(f"Loading data from {len(json_files)} file(s)...")

    for filepath in json_files:
        with open(filepath, 'r') as f:
            try:
                samples = json.load(f)
            except json.JSONDecodeError as e:
                print(f"Warning: Could not parse {filepath}: {e}")
                continue

            for sample in samples:
                if 'vector' not in sample or 'target' not in sample:
                    continue
                if sample['target'] not in ROOM_TO_IDX:
                    print(f"Warning: Unknown room '{sample['target']}', skipping")
                    continue

                X.append(sample['vector'])
                targets.append(sample['target'])

    # Create contiguous label mapping based on rooms that actually have data
    unique_rooms = sorted(set(targets))
    room_to_idx = {room: idx for idx, room in enumerate(unique_rooms)}
    idx_to_room = {idx: room for idx, room in enumerate(unique_rooms)}

    y = np.array([room_to_idx[t] for t in targets])

    return np.array(X, dtype=np.float32), y, targets, idx_to_room, room_to_idx


def print_data_summary(X: np.ndarray, y: np.ndarray, targets: list[str]):
    """Print summary statistics about the training data."""
    print("\n" + "="*60)
    print("DATA SUMMARY")
    print("="*60)
    print(f"Total samples: {len(X)}")
    print(f"Input shape: {X.shape}")
    print(f"Number of classes: {len(np.unique(y))}")

    print("\nClass distribution:")
    label_counts = Counter(targets)
    for room in ROOMS:
        count = label_counts.get(room, 0)
        bar = '#' * min(count // 10, 50)
        print(f"  {room:12s}: {count:5d} {bar}")

    print("\nFeature statistics (distances only):")
    distances = X[:, ::2]  # Every other column is distance
    print(f"  Min distance: {distances.min():.2f}")
    print(f"  Max distance: {distances.max():.2f}")
    print(f"  Mean distance: {distances.mean():.2f}")

    fresh_flags = X[:, 1::2]  # Every other column starting at 1 is fresh
    print(f"\nFresh flag statistics:")
    print(f"  Mean fresh sensors per sample: {fresh_flags.sum(axis=1).mean():.2f}")


def train_random_forest(X_train, X_test, y_train, y_test):
    """Train and evaluate a Random Forest classifier."""
    print("\n" + "="*60)
    print("TRAINING: Random Forest")
    print("="*60)

    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        min_samples_split=5,
        min_samples_leaf=2,
        class_weight='balanced',
        random_state=42,
        n_jobs=-1
    )

    model.fit(X_train, y_train)

    # Cross-validation
    cv_scores = cross_val_score(model, X_train, y_train, cv=min(5, len(np.unique(y_train))))
    print(f"Cross-validation accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std()*2:.4f})")

    # Test set evaluation
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Test accuracy: {accuracy:.4f}")

    # Feature importance
    print("\nFeature importance (top 10):")
    feature_names = []
    for sensor in SENSOR_ORDER:
        feature_names.extend([f"{sensor}_dist", f"{sensor}_fresh"])

    importances = list(zip(feature_names, model.feature_importances_))
    importances.sort(key=lambda x: x[1], reverse=True)
    for name, imp in importances[:10]:
        print(f"  {name:15s}: {imp:.4f}")

    return model, y_pred


def train_xgboost(X_train, X_test, y_train, y_test, num_classes):
    """Train and evaluate an XGBoost classifier."""
    print("\n" + "="*60)
    print("TRAINING: XGBoost")
    print("="*60)

    try:
        import xgboost as xgb
    except ImportError:
        print("XGBoost not installed, skipping...")
        return None, None

    model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=6,
        learning_rate=0.1,
        objective='multi:softprob',
        num_class=num_classes,
        random_state=42,
        n_jobs=-1,
        verbosity=0
    )

    model.fit(X_train, y_train)

    # Cross-validation
    cv_scores = cross_val_score(model, X_train, y_train, cv=min(5, len(np.unique(y_train))))
    print(f"Cross-validation accuracy: {cv_scores.mean():.4f} (+/- {cv_scores.std()*2:.4f})")

    # Test set evaluation
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Test accuracy: {accuracy:.4f}")

    # Feature importance
    print("\nFeature importance (top 10):")
    feature_names = []
    for sensor in SENSOR_ORDER:
        feature_names.extend([f"{sensor}_dist", f"{sensor}_fresh"])

    importances = list(zip(feature_names, model.feature_importances_))
    importances.sort(key=lambda x: x[1], reverse=True)
    for name, imp in importances[:10]:
        print(f"  {name:15s}: {imp:.4f}")

    return model, y_pred


def train_mlp(X_train, X_test, y_train, y_test, num_classes):
    """Train and evaluate a Multi-Layer Perceptron using PyTorch."""
    print("\n" + "="*60)
    print("TRAINING: Neural Network (MLP)")
    print("="*60)

    try:
        import torch
        import torch.nn as nn
        import torch.optim as optim
        from torch.utils.data import DataLoader, TensorDataset
    except ImportError:
        print("PyTorch not installed, skipping...")
        return None, None

    # Convert to tensors
    X_train_t = torch.FloatTensor(X_train)
    y_train_t = torch.LongTensor(y_train)
    X_test_t = torch.FloatTensor(X_test)
    y_test_t = torch.LongTensor(y_test)

    # Create data loaders
    train_dataset = TensorDataset(X_train_t, y_train_t)
    train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)

    # Define model
    class RoomPresenceMLP(nn.Module):
        def __init__(self, input_size=14, num_classes=13):
            super().__init__()
            self.network = nn.Sequential(
                nn.Linear(input_size, 64),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(64, 32),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(32, num_classes)
            )

        def forward(self, x):
            return self.network(x)

    model = RoomPresenceMLP(input_size=X_train.shape[1], num_classes=num_classes)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    # Training loop
    epochs = 100
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        for batch_X, batch_y in train_loader:
            optimizer.zero_grad()
            outputs = model(batch_X)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        if (epoch + 1) % 20 == 0:
            print(f"Epoch {epoch+1}/{epochs}, Loss: {total_loss/len(train_loader):.4f}")

    # Evaluation
    model.eval()
    with torch.no_grad():
        outputs = model(X_test_t)
        _, y_pred = torch.max(outputs, 1)
        y_pred = y_pred.numpy()

    accuracy = accuracy_score(y_test, y_pred)
    print(f"Test accuracy: {accuracy:.4f}")

    return model, y_pred


def print_classification_report(y_test, y_pred, idx_to_room):
    """Print detailed classification metrics."""
    print("\n" + "="*60)
    print("CLASSIFICATION REPORT")
    print("="*60)

    # Get labels that actually appear in test set
    labels_in_test = sorted(set(y_test) | set(y_pred))
    target_names = [idx_to_room[i] for i in labels_in_test]

    print(classification_report(y_test, y_pred, labels=labels_in_test,
                                target_names=target_names, zero_division=0))


def plot_confusion_matrix(y_test, y_pred, idx_to_room, output_path: str):
    """Plot and save confusion matrix."""
    labels_in_test = sorted(set(y_test) | set(y_pred))
    target_names = [idx_to_room[i] for i in labels_in_test]

    cm = confusion_matrix(y_test, y_pred, labels=labels_in_test)

    plt.figure(figsize=(12, 10))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=target_names, yticklabels=target_names)
    plt.xlabel('Predicted')
    plt.ylabel('Actual')
    plt.title('Room Presence - Confusion Matrix')
    plt.tight_layout()
    plt.savefig(output_path)
    print(f"Confusion matrix saved to {output_path}")


def save_model(model, model_type: str, output_path: str):
    """Save trained model to disk."""
    if model_type == 'mlp':
        import torch
        torch.save(model.state_dict(), output_path)
    else:
        with open(output_path, 'wb') as f:
            pickle.dump(model, f)
    print(f"Model saved to {output_path}")


def export_xgb_to_onnx(model, num_features: int, output_path: str):
    """Export XGBoost model to ONNX format."""
    try:
        from onnxmltools import convert_xgboost
        from onnxmltools.convert.common.data_types import FloatTensorType

        initial_type = [('input', FloatTensorType([None, num_features]))]
        onnx_model = convert_xgboost(model, initial_types=initial_type,
                                      target_opset=12)

        with open(output_path, 'wb') as f:
            f.write(onnx_model.SerializeToString())
        print(f"ONNX model saved to {output_path}")
    except Exception as e:
        print(f"Error exporting to ONNX: {e}")


def save_metadata(idx_to_room: dict, room_to_idx: dict, num_features: int, output_path: str):
    """Save model metadata for inference."""
    # Convert int keys to strings for JSON compatibility
    idx_to_room_str = {str(k): v for k, v in idx_to_room.items()}

    metadata = {
        "idx_to_room": idx_to_room_str,
        "room_to_idx": room_to_idx,
        "sensor_order": SENSOR_ORDER,
        "num_features": num_features,
        "num_classes": len(idx_to_room)
    }
    with open(output_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Metadata saved to {output_path}")


def main():
    parser = argparse.ArgumentParser(description='Train room presence model')
    parser.add_argument('dataset', help='Name of the dataset folder in data/')
    parser.add_argument('--model', choices=['rf', 'xgb', 'mlp', 'all'], default='all',
                        help='Model type to train (default: all)')
    parser.add_argument('--output', default='./output',
                        help='Output directory for models')
    args = parser.parse_args()

    # Paths
    script_dir = Path(__file__).parent
    data_dir = script_dir / 'data' / args.dataset
    output_dir = script_dir / args.output / args.dataset

    if not data_dir.exists():
        print(f"Error: Dataset directory not found: {data_dir}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    # Load data
    X, y, targets, idx_to_room, room_to_idx = load_training_data(str(data_dir))
    print_data_summary(X, y, targets)

    # Check minimum samples
    if len(X) < 50:
        print(f"\nWarning: Only {len(X)} samples. Recommend at least 100+ for reasonable results.")

    # Check class distribution
    num_classes = len(np.unique(y))
    if num_classes < 3:
        print(f"\nWarning: Only {num_classes} class(es) in data. Need more diverse training data.")

    if num_classes < 2:
        print("\nError: Need at least 2 classes to train a classifier. Collect more diverse data.")
        sys.exit(1)

    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y if num_classes > 1 else None
    )
    print(f"\nTrain set: {len(X_train)} samples")
    print(f"Test set: {len(X_test)} samples")

    # Track results
    results = {}

    # Train models
    if args.model in ['rf', 'all']:
        model, y_pred = train_random_forest(X_train, X_test, y_train, y_test)
        if model and y_pred is not None:
            acc = accuracy_score(y_test, y_pred)
            results['rf'] = {'model': model, 'accuracy': acc, 'predictions': y_pred}
            save_model(model, 'rf', str(output_dir / 'model_rf.pkl'))

    if args.model in ['xgb', 'all']:
        model, y_pred = train_xgboost(X_train, X_test, y_train, y_test, num_classes)
        if model and y_pred is not None:
            acc = accuracy_score(y_test, y_pred)
            results['xgb'] = {'model': model, 'accuracy': acc, 'predictions': y_pred}
            save_model(model, 'xgb', str(output_dir / 'model_xgb.pkl'))
            # Export to ONNX for JavaScript inference
            export_xgb_to_onnx(model, X.shape[1], str(output_dir / 'model_xgb.onnx'))

    if args.model in ['mlp', 'all']:
        model, y_pred = train_mlp(X_train, X_test, y_train, y_test, num_classes)
        if model and y_pred is not None:
            acc = accuracy_score(y_test, y_pred)
            results['mlp'] = {'model': model, 'accuracy': acc, 'predictions': y_pred}
            save_model(model, 'mlp', str(output_dir / 'model_mlp.pt'))

    # Summary
    if results:
        print("\n" + "="*60)
        print("RESULTS SUMMARY")
        print("="*60)

        best_model_type = max(results, key=lambda k: results[k]['accuracy'])
        for model_type, data in sorted(results.items(), key=lambda x: -x[1]['accuracy']):
            marker = " <-- BEST" if model_type == best_model_type else ""
            print(f"  {model_type.upper():5s}: {data['accuracy']:.4f}{marker}")

        # Detailed report for best model
        print_classification_report(y_test, results[best_model_type]['predictions'], idx_to_room)

        # Confusion matrix for best model
        cm_path = output_dir / 'confusion_matrix.png'
        plot_confusion_matrix(y_test, results[best_model_type]['predictions'], idx_to_room, str(cm_path))

        # Save metadata for inference
        save_metadata(idx_to_room, room_to_idx, X.shape[1], str(output_dir / 'metadata.json'))

        print(f"\nModels and results saved to: {output_dir}")
    else:
        print("\nNo models were trained successfully.")


if __name__ == '__main__':
    main()
