const EventEmitter = require("events");
const config = require("./config");

class RoomTransitionCoordinator {
  constructor(houseStateMachine, appConfig) {
    this.houseState = houseStateMachine;
    this.config = appConfig.house || {};
    this.enabled = this.config.transitionConstraintsEnabled || false;
    this.doorToRooms = this.config.doorRoomMappings || {};
    this.emitter = new EventEmitter();

    // Per-person locked state: { personId: { lockedDoors: { doorId: timestamp } } }
    this.personStates = {};
  }

  init() {
    if (!this.enabled) {
      console.log("[Coordinator] Door transition constraints DISABLED");
      return;
    }

    console.log("[Coordinator] Door transition constraints ENABLED");

    // Lytt til dør-tilstandsendringer
    if (this.houseState) {
      this.houseState.onDoorStateChange((event) => {
        this.handleDoorStateChange(event);
      });
    }
  }

  /**
   * Sjekk om person kan bytte fra et rom til et annet
   * @param {string} personId - Person ID
   * @param {string} fromRoom - Nåværende rom
   * @param {string} toRoom - Ønsket rom
   * @param {boolean} isSuperStable - Om personen er superStable (120s+)
   * @returns {boolean} - true hvis overgang er tillatt
   */
  canTransition(personId, fromRoom, toRoom, isSuperStable) {
    if (!this.enabled) return true;
    if (fromRoom === toRoom) return true;
    if (fromRoom === "na" || toRoom === "na") return true;

    // VIKTIG: Dør-begrensninger gjelder KUN for superStable personer
    if (!isSuperStable) {
      // Ikke superStable enda → dører blokkerer ikke
      this.clearLockedDoors(personId);
      return true;
    }

    // Finn dør(er) som separerer disse rommene
    const separatingDoors = this.findSeparatingDoors(fromRoom, toRoom);

    if (separatingDoors.length === 0) {
      // Ingen dør mellom rommene (ukjent topologi) → tillat
      return true;
    }

    // Sjekk om noen av dørene er lukket
    const closedDoors = [];
    for (const doorId of separatingDoors) {
      const doorState = this.houseState.getDoorState(doorId);

      // Behandle stale/ukjent dør som "åpen" (safety-first)
      if (!doorState || doorState.stale || doorState.state === null) {
        continue;
      }

      if (doorState.state === false) { // false = lukket
        closedDoors.push(doorId);
      }
    }

    if (closedDoors.length > 0) {
      // Minst én dør er lukket → blokker overgang
      this.trackLockedDoors(personId, fromRoom, closedDoors);
      console.log(`[Coordinator] BLOCKED: ${personId} cannot move ${fromRoom} → ${toRoom} (closed doors: ${closedDoors.join(', ')})`);
      return false;
    }

    // Alle dører er åpne → tillat overgang
    this.clearLockedDoors(personId);
    return true;
  }

  /**
   * Evaluer om person er låst i sitt nåværende rom (proaktiv sjekk)
   * Kalles når person blir superStable
   */
  evaluateCurrentRoomLock(personId, currentRoom, isSuperStable) {
    if (!this.enabled) return;
    if (currentRoom === "na") return;

    // Kun evaluer når superStable
    if (!isSuperStable) {
      this.clearLockedDoors(personId);
      return;
    }

    // Finn alle dører som kobler til dette rommet
    const doorsForRoom = [];
    for (const [doorId, rooms] of Object.entries(this.doorToRooms)) {
      if (rooms.includes(currentRoom)) {
        doorsForRoom.push(doorId);
      }
    }

    if (doorsForRoom.length === 0) {
      // Ingen dører for dette rommet
      return;
    }

    // Sjekk hvilke dører som er lukket
    const closedDoors = [];
    for (const doorId of doorsForRoom) {
      const doorState = this.houseState.getDoorState(doorId);

      // Stale/ukjent dør behandles som åpen
      if (!doorState || doorState.stale || doorState.state === null) {
        continue;
      }

      if (doorState.state === false) { // false = lukket
        closedDoors.push(doorId);
      }
    }

    if (closedDoors.length > 0) {
      // Person er låst bak minst én lukket dør
      this.trackLockedDoors(personId, currentRoom, closedDoors);
    } else {
      // Alle dører er åpne
      this.clearLockedDoors(personId);
    }
  }

  /**
   * Finn dører som separerer to rom
   */
  findSeparatingDoors(room1, room2) {
    const doors = [];
    for (const [doorId, rooms] of Object.entries(this.doorToRooms)) {
      if (rooms.length !== 2) continue;
      const [r1, r2] = rooms;

      // Dør separerer rommene hvis de er på hver side av døren
      if ((r1 === room1 && r2 === room2) || (r1 === room2 && r2 === room1)) {
        doors.push(doorId);
      }
    }
    return doors;
  }

  /**
   * Spor at person er låst bak lukkede dører
   */
  trackLockedDoors(personId, room, doorIds) {
    if (!this.personStates[personId]) {
      this.personStates[personId] = { lockedDoors: {}, currentRoom: room };
    }

    const timestamp = Date.now();
    for (const doorId of doorIds) {
      if (!this.personStates[personId].lockedDoors[doorId]) {
        this.personStates[personId].lockedDoors[doorId] = timestamp;
        console.log(`[Coordinator] ${personId} locked by ${doorId} in ${room}`);
        this.emitter.emit("personLocked", { personId, doorId, room, timestamp });
      }
    }
  }

  /**
   * Fjern alle låste dører for en person
   */
  clearLockedDoors(personId) {
    if (this.personStates[personId] && Object.keys(this.personStates[personId].lockedDoors).length > 0) {
      console.log(`[Coordinator] ${personId} unlocked (doors opened or left room)`);
      this.personStates[personId].lockedDoors = {};
      this.emitter.emit("personUnlocked", { personId });
    }
  }

  /**
   * Hent låste dører for en person
   */
  getLockedDoors(personId) {
    return this.personStates[personId]?.lockedDoors || {};
  }

  /**
   * Håndter dør-tilstandsendringer
   */
  handleDoorStateChange(event) {
    const { doorId, state } = event;

    if (state === true) { // Dør åpnet
      // Sjekk om noen personer var låst av denne døren
      for (const [personId, personState] of Object.entries(this.personStates)) {
        if (personState.lockedDoors[doorId]) {
          delete personState.lockedDoors[doorId];
          console.log(`[Coordinator] ${personId} unlocked by ${doorId} opening`);

          if (Object.keys(personState.lockedDoors).length === 0) {
            this.emitter.emit("personUnlocked", { personId, doorId });
          }
        }
      }
    }
  }

  // Event listeners
  onPersonLocked(callback) {
    this.emitter.on("personLocked", callback);
  }

  onPersonUnlocked(callback) {
    this.emitter.on("personUnlocked", callback);
  }
}

module.exports = RoomTransitionCoordinator;
