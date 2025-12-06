# Training Data Documentation

Dette dokumentet beskriver strukturen på treningsdataene som samles inn for romgjenkjenningsmodellen.

## Filformat og lagring

- **Plassering:** `data/` katalogen
- **Filnavn:** `YYYY-MM-DD-HH_MM_SS.json` (ISO-tidsstempel)
- **Format:** JSON-array med datapunkter
- **Lagringsintervall:** Hvert 2. minutt (120 sekunder)

## Datastruktur

Hver fil inneholder en JSON-array med objekter. Hvert objekt representerer ett øyeblikksbilde av sensordata:

```json
{
  "time": 1765053098,
  "target": "kjokken",
  "data": [...],
  "vector": [3.75, 1, 6.97, 1, 7.43, 1, 10, 0, 0.29, 1, 10, 0, 5.28, 1]
}
```

### Feltbeskrivelser

| Felt | Type | Beskrivelse |
|------|------|-------------|
| `time` | number | Unix-tidsstempel (sekunder) |
| `target` | string | Label - rommet personen faktisk befinner seg i |
| `data` | array | Detaljert sensordata (for debugging/analyse) |
| `vector` | array | **Ferdig preprosessert input-vektor for ML-modellen** |

## Vector-formatet (kritisk for ML)

`vector` er den viktigste egenskapen for trening. Den inneholder ferdig preprosesserte verdier klar for direkte bruk som input til modellen.

### Struktur

Vektoren har **14 elementer** - 2 per sensor (7 sensorer totalt):

```
[value1, fresh1, value2, fresh2, value3, fresh3, ...]
```

For hver sensor i rekkefølge:
1. `value` (float): Avstandsverdi 0-10
2. `fresh` (int): Ferskhetsindikator (0 eller 1)

### Sensororder (default)

Rekkefølgen på sensorene i vektoren er definert i config (`sensorOrder`):

| Index | Sensor | Value-posisjon | Fresh-posisjon |
|-------|--------|----------------|----------------|
| 0 | bad | 0 | 1 |
| 1 | vaskerom | 2 | 3 |
| 2 | mb | 4 | 5 |
| 3 | kjellerstua | 6 | 7 |
| 4 | kjokken | 8 | 9 |
| 5 | kontor | 10 | 11 |
| 6 | stua | 12 | 13 |

### Value-beregning

`value` beregnes slik fra rå sensordata:
- Basert på `distance` (eller `raw` hvis config.tracking="raw")
- **Capped til maksimum 10** (verdier over 10 settes til 10)
- **Settes til 10 hvis `ago > 10` sekunder** (stale data behandles som "langt unna")

### Fresh-beregning

`fresh` indikerer om sensordataen er oppdatert:
- `1` hvis `ago < 10` sekunder (fersk data)
- `0` hvis `ago >= 10` sekunder (gammel data)

## Target-labels (output-klasser)

Systemet gjenkjenner 13 rom:

| Index | Rom |
|-------|-----|
| 0 | bad |
| 1 | gang |
| 2 | gjesterom |
| 3 | kjellergang |
| 4 | kjellerstua |
| 5 | kjokken |
| 6 | kontor |
| 7 | linnea |
| 8 | linus |
| 9 | mb |
| 10 | stua |
| 11 | ute |
| 12 | vaskerom |

## Hints for ML-trening

### 1. Input-dimensjoner

```python
X = vectors  # Shape: (n_samples, 14)
y = targets  # Shape: (n_samples,) - kategorisk (13 klasser)
```

### 2. Håndtering av fresh-flagget

Fresh-flagget er kritisk informasjon. Det forteller modellen hvilke sensorer som har pålitelig data:

```python
# Alternativ 1: Bruk hele vektoren direkte (anbefalt)
# Modellen lærer selv å vekte fresh-flagget

# Alternativ 2: Masker ustale verdier
# Sett value=10 OG fresh=0 som et konsistent signal for "ingen data"
```

**Viktig:** Når `fresh=0`, er `value` alltid satt til 10. Dette er allerede håndtert i preprosesseringen.

### 3. Avstandsinterpretasjon

- **Lav verdi (0-2):** Personen er nær denne sensoren
- **Middels verdi (2-5):** Personen er i nærheten
- **Høy verdi (5-10):** Personen er langt unna eller data er stale

### 4. Rom uten sensorer

Noen rom (gang, gjesterom, kjellergang, linnea, linus, ute) har ingen dedikert sensor. Modellen må lære å gjenkjenne disse basert på:
- Kombinasjon av avstander til nærliggende sensorer
- Mønsteret av "ingen nær sensor" (alle verdier middels/høye)

### 5. Klassebalanse

Sjekk fordelingen av target-labels. Rom uten sensor vil typisk ha færre treningseksempler:

```python
from collections import Counter
label_counts = Counter(targets)
print(label_counts)
```

Vurder:
- Oversampling av underrepresenterte klasser
- Class weights i loss-funksjonen
- Stratified train/test split

### 6. Temporale mønstre

Data samles ca. hvert 2. sekund (ved sensoroppdateringer). Sekvenser av datapunkter kan brukes for:
- Sequence models (LSTM, Transformer)
- Feature engineering (glidende gjennomsnitt, endringsrate)

### 7. Feature engineering-ideer

```python
# Minimum avstand (nærmeste sensor)
min_distance = min(vector[::2])  # Annenhver verdi er distance

# Antall ferske sensorer
n_fresh = sum(vector[1::2])  # Annenhver verdi fra indeks 1 er fresh

# Forskjell mellom nærmeste sensorer
sorted_distances = sorted(vector[::2])
distance_gap = sorted_distances[1] - sorted_distances[0]
```

### 8. Anbefalt modellarkitektur

For et 14-dimensjonalt input med 13 klasser:

```python
# Enkel baseline
model = Sequential([
    Dense(64, activation='relu', input_shape=(14,)),
    Dropout(0.3),
    Dense(32, activation='relu'),
    Dropout(0.3),
    Dense(13, activation='softmax')
])
```

### 9. Data loading eksempel

```python
import json
import glob
import numpy as np

def load_training_data(data_dir='data/'):
    X, y = [], []
    room_to_idx = {
        'bad': 0, 'gang': 1, 'gjesterom': 2, 'kjellergang': 3,
        'kjellerstua': 4, 'kjokken': 5, 'kontor': 6, 'linnea': 7,
        'linus': 8, 'mb': 9, 'stua': 10, 'ute': 11, 'vaskerom': 12
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

### 10. Evaluering

Anbefalt metrikker:
- **Accuracy:** Generell ytelse
- **Confusion matrix:** Identifiser hvilke rom som forveksles
- **Per-class F1:** Viktig for ubalanserte klasser

```python
from sklearn.metrics import classification_report, confusion_matrix

print(classification_report(y_true, y_pred, target_names=rooms))
```

## Datakvalitet

### Vanlige problemer

1. **Label-forsinkelse:** Bruker klikker på rom etter å ha flyttet seg
2. **Overgangsfaser:** Data samlet mens personen går mellom rom
3. **Sensor-dropout:** Noen sensorer rapporterer ikke alltid

### Kvalitetsfiltrering

```python
# Filtrer ut samples med for mange stale sensorer
def quality_filter(sample):
    n_fresh = sum(sample['vector'][1::2])
    return n_fresh >= 3  # Minst 3 ferske sensorer

clean_samples = [s for s in samples if quality_filter(s)]
```

## Eksport til ONNX

Systemet bruker ONNX-format for inference. Etter trening:

```python
import torch.onnx

torch.onnx.export(model, dummy_input,
                  "models/roompresense.onnx",
                  input_names=['input'],
                  output_names=['output'],
                  dynamic_axes={'input': {0: 'batch_size'}})
```

Input tensor shape: `[batch_size, 14]`
Output tensor shape: `[batch_size, 13]` (sannsynligheter per rom)
