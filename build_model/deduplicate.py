#!/usr/bin/env python3
"""
Remove duplicate training samples from a dataset.

Usage:
    python deduplicate.py <source_dataset> <target_dataset>

Example:
    python deduplicate.py des25v2 des25v2unduped
"""

import argparse
import json
import glob
import os
import sys
from pathlib import Path
import numpy as np


def are_vectors_equal(v1, v2):
    """Check if two vectors are exactly equal."""
    if len(v1) != len(v2):
        return False
    return all(abs(a - b) < 1e-6 for a, b in zip(v1, v2))


def remove_consecutive_duplicates(samples):
    """Remove consecutive duplicate samples.

    Two samples are considered duplicates if they have:
    - Same target room
    - Identical sensor vector

    Keeps the first occurrence of each unique consecutive group.
    """
    if not samples:
        return []

    deduplicated = [samples[0]]
    duplicates_removed = 0

    for i in range(1, len(samples)):
        current = samples[i]
        previous = samples[i - 1]

        # Check if current is duplicate of previous
        same_target = current.get('target') == previous.get('target')
        same_vector = are_vectors_equal(current.get('vector', []), previous.get('vector', []))

        if same_target and same_vector:
            duplicates_removed += 1
            continue

        deduplicated.append(current)

    return deduplicated, duplicates_removed


def deduplicate_dataset(source_dir, target_dir):
    """Deduplicate all JSON files in a dataset directory."""
    source_path = Path(source_dir)
    target_path = Path(target_dir)

    if not source_path.exists():
        print(f"Error: Source directory not found: {source_path}")
        sys.exit(1)

    # Create target directory
    target_path.mkdir(parents=True, exist_ok=True)

    json_files = sorted(source_path.glob('*.json'))
    if not json_files:
        print(f"Error: No JSON files found in {source_path}")
        sys.exit(1)

    print(f"Deduplicating dataset: {source_path.name} -> {target_path.name}")
    print(f"Found {len(json_files)} files to process")
    print("="*80)

    total_original = 0
    total_deduplicated = 0
    total_removed = 0

    for filepath in json_files:
        with open(filepath, 'r') as f:
            try:
                samples = json.load(f)
            except json.JSONDecodeError as e:
                print(f"Warning: Could not parse {filepath.name}: {e}")
                continue

        original_count = len(samples)
        deduplicated_samples, removed_count = remove_consecutive_duplicates(samples)
        deduplicated_count = len(deduplicated_samples)

        # Save deduplicated samples
        target_file = target_path / filepath.name
        with open(target_file, 'w') as f:
            json.dump(deduplicated_samples, f, indent=2)

        reduction_pct = (removed_count / original_count * 100) if original_count > 0 else 0
        print(f"{filepath.name:30s}: {original_count:5d} -> {deduplicated_count:5d} "
              f"(-{removed_count:4d}, {reduction_pct:5.1f}%)")

        total_original += original_count
        total_deduplicated += deduplicated_count
        total_removed += removed_count

    print("="*80)
    print(f"SUMMARY")
    print(f"  Original samples:     {total_original:6d}")
    print(f"  Deduplicated samples: {total_deduplicated:6d}")
    print(f"  Removed duplicates:   {total_removed:6d} ({total_removed/total_original*100:.1f}%)")
    print(f"\nDeduplicated dataset saved to: {target_path}")


def main():
    parser = argparse.ArgumentParser(
        description='Remove consecutive duplicate samples from training dataset'
    )
    parser.add_argument('source', help='Source dataset name (e.g., des25v2)')
    parser.add_argument('target', help='Target dataset name (e.g., des25v2unduped)')
    parser.add_argument('--data-dir', default='./data',
                        help='Base data directory (default: ./data)')

    args = parser.parse_args()

    script_dir = Path(__file__).parent
    data_dir = script_dir / args.data_dir

    source_dir = data_dir / args.source
    target_dir = data_dir / args.target

    deduplicate_dataset(source_dir, target_dir)


if __name__ == '__main__':
    main()
