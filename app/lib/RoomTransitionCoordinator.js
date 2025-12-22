const EventEmitter = require("events");
const config = require("./config");
const { now } = require("./utils");

class RoomTransitionCoordinator {
  constructor(houseStateMachine, appConfig, peopleConfig = []) {
    this.houseState = houseStateMachine;
    this.config = appConfig.house || {};
    this.enabled = this.config.transitionConstraintsEnabled || false;
    this.doorToRooms = this.config.doorRoomMappings || {};
    this.motionSensorToRooms = this.config.motionSensorRoomMappings || {};
    this.emitter = new EventEmitter();

    // Build person-specific ignored rooms map
    this.personIgnoredRooms = {};
    for (const person of peopleConfig) {
      this.personIgnoredRooms[person.id] = new Set(person.ignoredRooms || []);
    }

    // Per-person locked state: { personId: { lockedDoors: {...}, lockedMotionSensors: {...} } }
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

      // Lytt til motion sensor-tilstandsendringer
      this.houseState.onMotionSensorStateChange((event) => {
        this.handleMotionSensorStateChange(event);
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

    // Check if destination room is ignored for this person (MUST be checked before "na" logic)
    const ignoredRooms = this.personIgnoredRooms[personId];
    if (ignoredRooms && ignoredRooms.has(toRoom)) {
      if (config.debug) {
        console.log(`[Coordinator] BLOCKED: ${personId} cannot move to ignored room: ${fromRoom} → ${toRoom}`);
      }
      return false;
    }

    // Allow transitions from/to "na" (after ignoredRooms check)
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

    // Gate 7: Motion sensor constraints
    const crossingMotionSensors = this.findCrossingMotionSensors(fromRoom, toRoom);

    if (crossingMotionSensors.length > 0) {
      const blockingMotionSensors = [];

      for (const sensorId of crossingMotionSensors) {
        const sensorState = this.houseState.getMotionSensorState(sensorId);

        // Safety-first: stale/unknown sensorer blokkerer IKKE
        if (!sensorState || sensorState.stale || sensorState.state === null) {
          continue;
        }

        // Blokkerer hvis motion har vært inaktiv i 120+ sekunder
        const inactiveTime = now() - sensorState.lastMotionTime;
        if (sensorState.state === false && inactiveTime > 120) {
          blockingMotionSensors.push(sensorId);
        }
      }

      if (blockingMotionSensors.length > 0) {
        this.trackLockedMotionSensors(personId, fromRoom, blockingMotionSensors);
        console.log(`[Coordinator] BLOCKED: ${personId} cannot move ${fromRoom} → ${toRoom} (inactive motion sensors: ${blockingMotionSensors.join(', ')})`);
        return false;
      }
    }

    // Alle constraints passert → tillat overgang
    this.clearLockedDoors(personId);
    this.clearLockedMotionSensors(personId);
    return true;
  }

  /**
   * Evaluer om person er låst i sitt nåværende rom (proaktiv sjekk)
   * Kalles når person blir superStable
   */
  evaluateCurrentRoomLock(personId, currentRoom, isSuperStable) {
    if (!this.enabled) return;
    if (currentRoom === "na") return;

    // Kun evaluer når superStable for Å SETTE locks
    // Men IKKE clear hvis ikke superStable - la låsen persistere
    if (!isSuperStable) {
      return; // Behold eksisterende låsetilstand
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
   * Sjekk om person har forlatt en dør-gruppe
   * Returnerer true hvis overgang går fra et rom bak en dør til et rom UTENFOR den døren
   */
  hasLeftDoorGroup(personId, fromRoom, toRoom) {
    if (!this.enabled) return false;
    if (fromRoom === toRoom) return false;

    // Finn hvilke dører som var involvert i fromRoom
    const fromDoors = [];
    for (const [doorId, rooms] of Object.entries(this.doorToRooms)) {
      if (rooms.includes(fromRoom)) {
        fromDoors.push(doorId);
      }
    }

    if (fromDoors.length === 0) {
      // fromRoom har ingen dører → ingen gruppe å forlate
      return false;
    }

    // Sjekk om toRoom er bak noen av de samme dørene
    for (const doorId of fromDoors) {
      const rooms = this.doorToRooms[doorId];
      if (rooms.includes(toRoom)) {
        // Fortsatt bak samme dør → ikke forlatt gruppe
        return false;
      }
    }

    // Ingen felles dører → forlatt gruppe
    return true;
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
   * Finn motion sensorer som beskytter overgang mellom to rom
   */
  findCrossingMotionSensors(room1, room2) {
    const sensors = [];
    for (const [sensorId, protectedZone] of Object.entries(this.motionSensorToRooms)) {
      const room1InZone = protectedZone.includes(room1);
      const room2InZone = protectedZone.includes(room2);

      // Sensor er relevant hvis vi krysser zone-grensen
      if (room1InZone !== room2InZone) {
        sensors.push(sensorId);
      }
    }
    return sensors;
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
   * Spor at person er låst bak inaktive motion sensorer
   */
  trackLockedMotionSensors(personId, room, sensorIds) {
    if (!this.personStates[personId]) {
      this.personStates[personId] = {
        lockedDoors: {},
        lockedMotionSensors: {},
        currentRoom: room
      };
    }

    if (!this.personStates[personId].lockedMotionSensors) {
      this.personStates[personId].lockedMotionSensors = {};
    }

    const timestamp = Date.now();
    for (const sensorId of sensorIds) {
      if (!this.personStates[personId].lockedMotionSensors[sensorId]) {
        this.personStates[personId].lockedMotionSensors[sensorId] = timestamp;
        console.log(`[Coordinator] ${personId} locked by motion sensor ${sensorId} in ${room}`);
        this.emitter.emit("personLockedByMotion", { personId, sensorId, room, timestamp });
      }
    }
  }

  /**
   * Fjern alle låste motion sensorer for en person
   */
  clearLockedMotionSensors(personId) {
    if (this.personStates[personId] &&
        this.personStates[personId].lockedMotionSensors &&
        Object.keys(this.personStates[personId].lockedMotionSensors).length > 0) {
      console.log(`[Coordinator] ${personId} unlocked from motion sensors`);
      this.personStates[personId].lockedMotionSensors = {};
      this.emitter.emit("personUnlockedFromMotion", { personId });
    }
  }

  /**
   * Hent låste motion sensorer for en person
   */
  getLockedMotionSensors(personId) {
    return this.personStates[personId]?.lockedMotionSensors || {};
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

          // Signal til PersonTracker at stabilitet skal resettes
          this.emitter.emit("resetStability", { personId, doorId });
          console.log(`[Coordinator] ${personId} stability reset due to door ${doorId} opening`);
        }
      }
    }
  }

  /**
   * Håndter motion sensor-tilstandsendringer
   */
  handleMotionSensorStateChange(event) {
    const { sensorId, state } = event;

    if (state === true) { // Motion detektert
      // Sjekk om noen personer var låst av denne sensoren
      for (const [personId, personState] of Object.entries(this.personStates)) {
        if (personState.lockedMotionSensors && personState.lockedMotionSensors[sensorId]) {
          delete personState.lockedMotionSensors[sensorId];
          console.log(`[Coordinator] ${personId} unlocked by motion sensor ${sensorId} activating`);

          if (Object.keys(personState.lockedMotionSensors).length === 0) {
            this.emitter.emit("personUnlockedFromMotion", { personId, sensorId });
          }

          // Signal til PersonTracker at stabilitet skal resettes
          this.emitter.emit("resetStability", { personId, sensorId });
          console.log(`[Coordinator] ${personId} stability reset due to motion sensor ${sensorId} activating`);
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

  onResetStability(callback) {
    this.emitter.on("resetStability", callback);
  }
}

module.exports = RoomTransitionCoordinator;
