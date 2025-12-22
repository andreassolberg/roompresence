# Tilstandsmaskin for romnærvær

PersonTracker implementerer en sofistikert tilstandsmaskin med hysterese for å unngå flimring når en person beveger seg mellom rom. Dette dokumentet beskriver alle interne tilstander og egenskaper som sendes til MQTT.

## Interne tilstander

Disse tilstandene spores internt i PersonTracker og brukes til å styre logikken:

### `room0` (PersonTracker.js:34)
- Den umiddelbare prediksjonen fra ML-modellen
- Oppdateres **øyeblikkelig** når modellen predikerer et nytt rom
- Resettes når personen skifter rom

### `room0Since` (PersonTracker.js:35)
- Timestamp for når `room0` sist endret seg
- Brukes til å beregne hvor lenge personen har vært i samme predikerte rom
- Basis for alle tidsbaserte terskler (5s, 15s, 120s)

### `room0Confident` (PersonTracker.js:36)
- Boolsk flagg som settes til `true` når modellens konfidensnivå > 90%
- En av to betingelser som må oppfylles før `room` oppdateres
- Resettes ved rombytte

### `room0Stable` (PersonTracker.js:37)
- Boolsk flagg som settes til `true` når `room0` har vært stabil i > 5 sekunder
- Den andre betingelsen som må oppfylles før `room` oppdateres
- Resettes ved rombytte

### `roomHistory` (PersonTracker.js:42)
- Array av `{ room, timestamp }` objekter
- Lagrer siste 24 timers romendringer
- Oppdateres kun når `room` (ikke `room0`) endres
- Automatisk rensing av entries eldre enn 24 timer

### `room0SuperStable` (PersonTracker.js:41)
- Boolean flagg som settes til `true` når `room0` har vært stabil i > 120 sekunder
- Forutsetning for at dør-begrensninger skal aktiveres
- Resettes ved rombytte eller når room0 endrer seg

### `coordinator` (PersonTracker.js:44)
- Referanse til RoomTransitionCoordinator instans
- Validerer romoverganger mot dør-tilstander
- Kun aktiv når `config.house.transitionConstraintsEnabled = true`

## Egenskaper sendt til MQTT

Disse egenskapene publiseres til MQTT-topic `espresense/person/{personId}` (PersonTracker.js:159-170):

```javascript
{
  room: this.room,          // Bekreftet rom (krever konfidens OG stabilitet)
  room0: this.room0,        // Umiddelbar prediksjon
  room5: this.room5,        // Stabilt i 5+ sekunder
  room15: this.room15,      // Stabilt i 15+ sekunder
  room120: this.room120,    // Stabilt i 120+ sekunder
  activeDevice: this.activeDevice,  // Hvilken Bluetooth-enhet som er aktiv
  superStable: this.room0SuperStable,  // NY: True når room0 stabil i 120+ sekunder
  doorLocked: boolean,      // NY: True hvis person er låst bak lukket dør
  lockedDoors: string[],    // NY: Array av dør-ID-er som låser personen
  pendingTransition: boolean // NY: True hvis room !== room0 (blokkert overgang)
}
```

### Bruksområder for ulike rom-egenskaper

- **`room0`**: Sanntids-prediksjon for debugging eller rask respons
- **`room`**: Standard tilstedeværelse for hjemmeautomatisering (krever både konfidens og stabilitet)
- **`room5`**: Rask respons for lys og klimakontroll
- **`room15`**: Mer stabil tilstedeværelse, egnet for varslinger
- **`room120`**: Langtids-tilstedeværelse, egnet for energisparing

## Tilstandsoverganger

Overgangene skjer i `setRoom()`-metoden (PersonTracker.js:173-221):

```
ML-prediksjon (hver 5. sekund)
     ↓
   room0 (umiddelbar oppdatering)
     ↓
     ├─→ [Konfidens > 90%] → room0Confident = true
     │
     ├─→ [Stabil > 5 sek] → room0Stable = true
     │                    → room5 oppdateres
     │
     └─→ [BEGGE betingelser oppfylt] → room oppdateres
                                      → roomHistory oppdateres
                                      → Publiser til MQTT
     ↓
[Stabil > 15 sek] → room15 oppdateres → Publiser til MQTT
     ↓
[Stabil > 120 sek] → room120 oppdateres → Publiser til MQTT
```

### Viktige regler

1. **`room0`**: Oppdateres alltid umiddelbart ved ny prediksjon
2. **`room5`**: Oppdateres når `room0` har vært stabil i > 5 sek
3. **`room`**: Oppdateres kun når BÅDE konfidens > 90% OG stabilitet > 5 sek
4. **`room15`/`room120`**: Tidsbaserte milestones fra `room0Since`
5. **Publisering**: Skjer ved enhver oppdatering av noen av tilstandene

## Spesialtilstand: "na" (not available)

Når alle Bluetooth-enheter har vært stale i > 120 sekunder, resettes alt til `"na"` (PersonTracker.js:351-363):

```javascript
room = "na"
room0 = "na"
room5 = "na"
room15 = "na"
room120 = "na"
room0Confident = false
room0Stable = false
```

Dette sikrer at systemet ikke publiserer utdatert posisjon når personen er utilgjengelig (f.eks. har forlatt hjemmet eller telefonen er av).

## Hysterese-effekten

Denne to-stegs gaten (konfidens + stabilitet) skaper en kraftig hysterese som:

- ✅ Unngår flimring når personen står på grensen mellom rom
- ✅ Reagerer raskt (5 sek) når personen faktisk bytter rom med høy konfidens
- ✅ Gir hjemmeautomatisering flere tidsbaserte valg (room, room5, room15, room120)
- ✅ Holder personen i gjeldende rom selv om prediksjonen svinger litt

## Eksempel: Scenariobasert flyt

### Scenario 1: Klar romendring
```
t=0s:   Person flytter fra stua til kjøkkenet
        → room0 = "kjokken" (umiddelbart)
        → Modell har 95% konfidens
        → room0Confident = true (umiddelbart)

t=5s:   room0 fortsatt "kjokken"
        → room0Stable = true
        → room5 = "kjokken"
        → room = "kjokken" (BEGGE betingelser oppfylt)
        → roomHistory.push({ room: "kjokken", timestamp })
        → Publiser til MQTT

t=15s:  → room15 = "kjokken"
        → Publiser til MQTT

t=120s: → room120 = "kjokken"
        → Publiser til MQTT
```

### Scenario 2: Ustabil prediksjon (hysterese i aksjon)
```
t=0s:   Personen står ved døren mellom stua og gangen
        room = "stua" (fra før)

t=1s:   → room0 = "gang" (75% konfidens - under 90%)
        → room0Confident = false
        → room = "stua" (uendret - ikke nok konfidens)

t=3s:   → room0 = "stua" (85% konfidens)
        → room0Since resettes (nytt rom)
        → room = "stua" (uendret - fremdeles i samme rom)

t=5s:   → room0 = "gang" (92% konfidens)
        → room0Confident = true
        → room0Since resettes
        → room = "stua" (uendret - ikke stabil nok enda)

t=10s:  → room0 fortsatt "gang"
        → room0Stable = true (stabil > 5 sek)
        → room5 = "gang"
        → room = "gang" (BEGGE betingelser oppfylt)
        → Publiser til MQTT
```

Dette eksempelet viser hvordan hysteresen forhindrer flimring når personen beveger seg sakte eller står nær en grense.

## Dør-baserte begrensninger

Når en person har vært superStable (120+ sekunder) i et rom, aktiveres dør-begrensninger:

1. **RoomTransitionCoordinator** sjekker om det er lukkede dører mellom nåværende og ønsket rom
2. Hvis dør er lukket → `room` forblir uendret (selv om `room0` oppdateres)
3. Hvis dør åpnes → `room` kan oppdateres til å matche `room0`
4. **roomLockedSince**: Objekt i Coordinator som sporer hvilke dører som låser personen

### Aktivering av funksjon

Dør-begrensninger aktiveres ved å sette `transitionConstraintsEnabled: true` i config:

```json
{
  "house": {
    "homieDeviceId": "deviceid",
    "doors": [...],
    "doorRoomMappings": {
      "door-linus": ["linus", "gang"],
      "door-kjellerstua": ["kjellerstua", "kjellergang"]
    },
    "transitionConstraintsEnabled": true
  }
}
```

### Eksempel: Låst bak lukket dør

```
t=0s:   Person går inn på kontoret
        → room0 = "kontor", room = "kontor"
        → Dør "door-kontor" er åpen

t=30s:  Dør "door-kontor" lukkes
        → room0SuperStable = false (kun 30s)
        → Ingen låsing enda

t=120s: room0SuperStable = true
        → Coordinator registrerer: kontor er bak lukket dør
        → roomLockedSince = { "door-kontor": 120000 }

t=140s: ML predikerer "gang" (95% konfidens)
        → room0 = "gang" (oppdateres umiddelbart)
        → room0Confident = true
        → room0Stable = false (ikke stabil enda)

t=145s: room0Stable = true
        → Forsøk på å oppdatere room: "kontor" → "gang"
        → coordinator.canTransition() returnerer FALSE (dør lukket)
        → room forblir "kontor"
        → pendingTransition = true (room ≠ room0)
        → Publiser til MQTT med doorLocked=true

t=150s: Dør "door-kontor" åpnes
        → coordinator fjerner roomLockedSince
        → Neste inference-syklus: room oppdateres til "gang"
        → doorLocked = false
```

### Viktige designprinsipper

1. **SuperStable-krav**: Dør-blokkering aktiveres KUN for personer som har vært i rom i 120+ sekunder
2. **Safety-first**: Stale eller ukjente dør-tilstander behandles som "åpen" (blokkerer ikke)
3. **room0 påvirkes ikke**: Sensordata vises alltid i `room0`, kun `room` blokkeres
4. **Uavhengige personer**: Hver person har egen låsetilstand
5. **Event-drevet**: Dør åpnes → låste personer evalueres umiddelbart
