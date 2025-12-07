async function fetchStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    return status;
  } catch (error) {
    console.error("Error fetching status:", error);
    return null;
  }
}

async function initializeUI() {
  const status = await fetchStatus();

  if (!status) {
    console.error("Failed to load application status");
    return;
  }

  // Display person ID
  const personIdElement = document.querySelector("#person-id");
  personIdElement.textContent = status.personId;

  // Show/hide training UI based on status
  if (status.trainingEnabled) {
    document.querySelector("#training-section").style.display = "block";
    document.querySelector("#training-disabled").style.display = "none";
    await fetchRooms();
  } else {
    document.querySelector("#training-section").style.display = "none";
    document.querySelector("#training-disabled").style.display = "block";
  }
}

async function fetchRooms() {
  try {
    const response = await fetch("/api/rooms");
    const rooms = await response.json();
    populateButtons(rooms);
  } catch (error) {
    console.error("Error fetching rooms:", error);
  }
}

function populateButtons(rooms) {
  const body = document.querySelector("#btns");
  rooms.forEach((room) => {
    const button = document.createElement("button");
    button.textContent = room;
    button.addEventListener("click", () => setRoom(room));
    body.appendChild(button);
  });
  const button = document.createElement("button");
  button.textContent = "[Stop]";
  button.addEventListener("click", () => setRoom(""));
  body.appendChild(button);
}

function setRoom(room) {
  console.log("Room selected:", room);
  const target = document.querySelector("#target");
  target.textContent = room;

  fetch("/api/room", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room }),
  })
    .then((response) => {
      if (response.status === 403) {
        alert("Training mode is disabled");
        return null;
      }
      return response.json();
    })
    .then((data) => {
      if (data) {
        console.log("Room set successfully:", data);
      }
    })
    .catch((error) => {
      console.error("Error setting room:", error);
    });
}

async function fetchSensordata() {
  try {
    const response = await fetch("/api/sensors");
    const data = await response.json();
    const sensorDataElement = document.querySelector("#sensordata");
    sensorDataElement.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    console.error("Error fetching sensor data:", error);
  }
}

initializeUI();
setInterval(fetchSensordata, 1000);

document.addEventListener("DOMContentLoaded", function () {
  console.log("Page loaded");
});
