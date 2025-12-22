// Sensor state colors
const COLORS = {
  open: "#4caf50",    // Green (doors)
  closed: "#f44336",  // Red (doors)
  active: "#2196f3",  // Blue (motion sensors)
  inactive: "#9e9e9e",// Gray (motion sensors)
  unknown: "#9e9e9e"  // Gray
};

// Global state
let selectedHours = 6;
let doorData = null;
let motionData = null;
let historyData = null;
let updateInterval = null;
let historyInterval = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  setupTimeControls();
  fetchCurrentStatus();
  fetchMotionStatus();
  fetchHistory();

  // Auto-refresh intervals
  updateInterval = setInterval(() => {
    fetchCurrentStatus();
    fetchMotionStatus();
  }, 5000);  // 5 seconds
  historyInterval = setInterval(fetchHistory, 30000);      // 30 seconds
});

function setupTimeControls() {
  const buttons = document.querySelectorAll(".controls button");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedHours = parseInt(btn.dataset.hours);
      if (historyData) {
        renderTimeline(historyData);
      }
    });
  });
}

async function fetchCurrentStatus() {
  try {
    const response = await fetch("/api/house/doors");

    if (response.status === 503) {
      showServiceUnavailable();
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    doorData = await response.json();
    renderCurrentStatus(doorData);
    hideServiceUnavailable();
  } catch (error) {
    console.error("Error fetching door status:", error);
    showError("current");
  }
}

function renderCurrentStatus(doors) {
  const container = document.getElementById("door-cards");

  if (Object.keys(doors).length === 0) {
    container.innerHTML = '<div class="no-data">No doors configured.</div>';
    return;
  }

  container.innerHTML = "";

  // Sort doors by name
  const sortedDoors = Object.entries(doors).sort((a, b) =>
    a[1].name.localeCompare(b[1].name)
  );

  sortedDoors.forEach(([doorId, door]) => {
    const card = document.createElement("div");

    // Determine state class
    let stateClass = "unknown";
    let stateText = "UNKNOWN";
    if (door.state === true) {
      stateClass = "open";
      stateText = "OPEN";
    } else if (door.state === false) {
      stateClass = "closed";
      stateText = "CLOSED";
    }

    // Add stale class if applicable
    const staleClass = door.stale ? " stale" : "";

    card.className = `door-card ${stateClass}${staleClass}`;

    // Format timestamp (door.lastUpdate is in seconds, Date expects milliseconds)
    const timeStr = door.lastUpdate > 0
      ? new Date(door.lastUpdate * 1000).toLocaleString()
      : "Never";

    card.innerHTML = `
      <div class="door-name">${door.name}</div>
      <div class="door-state ${stateClass}">
        <span class="state-indicator"></span>
        ${stateText}
      </div>
      <div class="door-timestamp">Last update: ${timeStr}</div>
      ${door.stale ? '<div class="stale-indicator">⚠ STALE DATA</div>' : ''}
    `;

    container.appendChild(card);
  });
}

async function fetchMotionStatus() {
  try {
    const response = await fetch("/api/house/motion-sensors");

    if (response.status === 503) {
      // Motion sensors not configured - hide section
      document.getElementById("motion-cards").innerHTML =
        '<div class="no-data">No motion sensors configured.</div>';
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    motionData = await response.json();
    renderMotionStatus(motionData);
  } catch (error) {
    console.error("Error fetching motion sensor status:", error);
    document.getElementById("motion-cards").innerHTML =
      '<div class="no-data">Error loading motion sensor status.</div>';
  }
}

function renderMotionStatus(sensors) {
  const container = document.getElementById("motion-cards");

  if (Object.keys(sensors).length === 0) {
    container.innerHTML = '<div class="no-data">No motion sensors configured.</div>';
    return;
  }

  container.innerHTML = "";

  // Sort sensors by name
  const sortedSensors = Object.entries(sensors).sort((a, b) =>
    a[1].name.localeCompare(b[1].name)
  );

  sortedSensors.forEach(([sensorId, sensor]) => {
    const card = document.createElement("div");

    // Determine state class
    let stateClass = "unknown";
    let stateText = "UNKNOWN";
    if (sensor.state === true) {
      stateClass = "active";
      stateText = "ACTIVE";
    } else if (sensor.state === false) {
      stateClass = "inactive";
      stateText = "INACTIVE";
    }

    // Add stale class if applicable
    const staleClass = sensor.stale ? " stale" : "";

    card.className = `door-card ${stateClass}${staleClass}`;

    // Format timestamps (sensor timestamps are in seconds)
    const lastUpdateStr = sensor.lastUpdate > 0
      ? new Date(sensor.lastUpdate * 1000).toLocaleString()
      : "Never";

    const lastMotionStr = sensor.lastMotionTime > 0
      ? new Date(sensor.lastMotionTime * 1000).toLocaleString()
      : "Never";

    // Calculate time since last motion
    let timeSinceMotion = "";
    if (sensor.lastMotionTime > 0 && sensor.state === false) {
      const secondsSince = Math.floor(Date.now() / 1000) - sensor.lastMotionTime;
      const minutesSince = Math.floor(secondsSince / 60);
      if (minutesSince < 1) {
        timeSinceMotion = `<div class="door-timestamp">Inactive for ${secondsSince}s</div>`;
      } else if (minutesSince < 60) {
        timeSinceMotion = `<div class="door-timestamp">Inactive for ${minutesSince}m</div>`;
      } else {
        const hoursSince = Math.floor(minutesSince / 60);
        timeSinceMotion = `<div class="door-timestamp">Inactive for ${hoursSince}h</div>`;
      }
    }

    card.innerHTML = `
      <div class="door-name">${sensor.name}</div>
      <div class="door-state ${stateClass}">
        <span class="state-indicator"></span>
        ${stateText}
      </div>
      <div class="door-timestamp">Last motion: ${lastMotionStr}</div>
      ${timeSinceMotion}
      ${sensor.stale ? '<div class="stale-indicator">⚠ STALE DATA</div>' : ''}
    `;

    container.appendChild(card);
  });
}

async function fetchHistory() {
  try {
    // Fetch both door and motion sensor history
    const [doorResponse, motionResponse] = await Promise.all([
      fetch("/api/house/history"),
      fetch("/api/house/motion-sensors").then(r => r.ok ? r : null)
    ]);

    if (doorResponse.status === 503) {
      return; // Already showing service unavailable from current status
    }

    if (!doorResponse.ok) {
      throw new Error(`HTTP error! status: ${doorResponse.status}`);
    }

    const doorHistory = await doorResponse.json();

    // Fetch motion sensor history for each sensor
    let motionHistory = {};
    if (motionResponse && motionData) {
      const motionHistoryPromises = Object.keys(motionData).map(async (sensorId) => {
        try {
          const response = await fetch(`/api/house/motion-sensors/${sensorId}/history`);
          if (response.ok) {
            const data = await response.json();
            return { sensorId, history: data.history };
          }
        } catch (err) {
          console.error(`Error fetching history for ${sensorId}:`, err);
        }
        return { sensorId, history: [] };
      });

      const results = await Promise.all(motionHistoryPromises);
      results.forEach(({ sensorId, history }) => {
        motionHistory[sensorId] = history;
      });
    }

    historyData = {
      doors: doorHistory,
      motionSensors: motionHistory
    };

    renderTimeline(historyData);
  } catch (error) {
    console.error("Error fetching history:", error);
    showError("timeline");
  }
}

function renderLegend() {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";

  const states = [
    { label: "Door: Open", color: COLORS.open },
    { label: "Door: Closed", color: COLORS.closed },
    { label: "Motion: Active", color: COLORS.active },
    { label: "Motion: Inactive", color: COLORS.inactive },
    { label: "Unknown", color: COLORS.unknown }
  ];

  states.forEach(state => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <div class="legend-color" style="background-color: ${state.color}"></div>
      <span>${state.label}</span>
    `;
    legend.appendChild(item);
  });
}

function renderTimeline(data) {
  const container = document.getElementById("timeline-container");
  const noData = document.getElementById("no-data");
  const tooltip = document.getElementById("tooltip");

  renderLegend();

  // Check if we have any data
  const doorHistories = data.doors || {};
  const motionHistories = data.motionSensors || {};
  const hasDoorData = Object.values(doorHistories).some(history => history.length > 0);
  const hasMotionData = Object.values(motionHistories).some(history => history.length > 0);

  if (!hasDoorData && !hasMotionData) {
    noData.style.display = "block";
    noData.textContent = "No sensor history data yet. History will appear as sensor states change.";
    container.querySelectorAll(".door-row").forEach(el => el.remove());
    return;
  }

  noData.style.display = "none";

  // Time range
  const now = Date.now();
  const startTime = now - selectedHours * 60 * 60 * 1000;

  // Dimensions
  const margin = { top: 20, right: 20, bottom: 30, left: 150 };
  const width = container.clientWidth - margin.left - margin.right - 40;
  const barHeight = 30;

  // Time scale
  const xScale = d3.scaleTime()
    .domain([new Date(startTime), new Date(now)])
    .range([0, width]);

  // Remove old rows
  container.querySelectorAll(".door-row").forEach(el => el.remove());

  // Render doors
  if (hasDoorData) {
    Object.entries(doorHistories).forEach(([doorId, history]) => {
      renderSensorTimeline(container, doorId, history, "door", doorData, xScale, barHeight, tooltip, now, startTime);
    });
  }

  // Render motion sensors
  if (hasMotionData) {
    Object.entries(motionHistories).forEach(([sensorId, history]) => {
      renderSensorTimeline(container, sensorId, history, "motion", motionData, xScale, barHeight, tooltip, now, startTime);
    });
  }
}

function renderSensorTimeline(container, sensorId, history, type, sensorData, xScale, barHeight, tooltip, now, startTime) {
  const margin = { top: 20, right: 20, bottom: 30, left: 150 };
  const width = container.clientWidth - margin.left - margin.right - 40;

  const row = document.createElement("div");
  row.className = "door-row";

  // Get current state and name
  const sensor = (sensorData && sensorData[sensorId]) || {};
  const currentState = sensor.state;
  const sensorName = sensor.name || sensorId;

  let currentStateText, getStateColor, getStateLabel;

  if (type === "door") {
    currentStateText = currentState === true ? "OPEN"
                     : currentState === false ? "CLOSED"
                     : "UNKNOWN";
    getStateColor = (state) => {
      if (state === true) return COLORS.open;
      if (state === false) return COLORS.closed;
      return COLORS.unknown;
    };
    getStateLabel = (state) => {
      if (state === true) return "OPEN";
      if (state === false) return "CLOSED";
      return "UNKNOWN";
    };
  } else { // motion
    currentStateText = currentState === true ? "ACTIVE"
                     : currentState === false ? "INACTIVE"
                     : "UNKNOWN";
    getStateColor = (state) => {
      if (state === true) return COLORS.active;
      if (state === false) return COLORS.inactive;
      return COLORS.unknown;
    };
    getStateLabel = (state) => {
      if (state === true) return "ACTIVE";
      if (state === false) return "INACTIVE";
      return "UNKNOWN";
    };
  }

  // Sensor name header
  const header = document.createElement("div");
  header.className = "door-row-name";
  const typeLabel = type === "door" ? "Door" : "Motion";
  header.innerHTML = `${typeLabel}: ${sensorName}<span class="current-state">Current: ${currentStateText}</span>`;
  row.appendChild(header);

  // Create SVG for timeline
  const svgHeight = barHeight + margin.top + margin.bottom;
  const svg = d3.create("svg")
    .attr("class", "timeline-svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", svgHeight);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Process history into segments
  const segments = [];
  const filteredHistory = history
    .filter(h => h.timestamp >= startTime)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Add a start segment if history starts after our window
  if (filteredHistory.length > 0) {
    const beforeWindow = history
      .filter(h => h.timestamp < startTime)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (beforeWindow) {
      segments.push({
        state: beforeWindow.state,
        start: startTime,
        end: filteredHistory[0].timestamp
      });
    }
  }

  // Create segments from history
  for (let i = 0; i < filteredHistory.length; i++) {
    const current = filteredHistory[i];
    const next = filteredHistory[i + 1];

    segments.push({
      state: current.state,
      start: Math.max(current.timestamp, startTime),
      end: next ? next.timestamp : now
    });
  }

  // If no segments but we have current state, show it for the whole range
  if (segments.length === 0 && currentState !== null && currentState !== undefined) {
    segments.push({
      state: currentState,
      start: startTime,
      end: now
    });
  }

  // Draw segments
  g.selectAll(".segment")
    .data(segments)
    .enter()
    .append("rect")
    .attr("class", "segment")
    .attr("x", d => xScale(new Date(d.start)))
    .attr("y", 0)
    .attr("width", d => Math.max(0, xScale(new Date(d.end)) - xScale(new Date(d.start))))
    .attr("height", barHeight)
    .attr("fill", d => getStateColor(d.state))
    .attr("rx", 3)
    .on("mouseover", function(event, d) {
      const startStr = new Date(d.start).toLocaleTimeString();
      const endStr = new Date(d.end).toLocaleTimeString();
      const duration = Math.round((d.end - d.start) / 60000);
      tooltip.innerHTML = `<strong>${getStateLabel(d.state)}</strong><br>${startStr} - ${endStr}<br>${duration} min`;
      tooltip.style.opacity = 1;
      tooltip.style.left = (event.pageX + 10) + "px";
      tooltip.style.top = (event.pageY - 10) + "px";
    })
    .on("mouseout", function() {
      tooltip.style.opacity = 0;
    });

  // Add state labels on segments (if wide enough)
  g.selectAll(".segment-label")
    .data(segments)
    .enter()
    .append("text")
    .attr("class", "segment-label")
    .attr("x", d => xScale(new Date(d.start)) + (xScale(new Date(d.end)) - xScale(new Date(d.start))) / 2)
    .attr("y", barHeight / 2 + 4)
    .attr("text-anchor", "middle")
    .text(d => {
      const segWidth = xScale(new Date(d.end)) - xScale(new Date(d.start));
      return segWidth > 60 ? getStateLabel(d.state) : "";
    });

  // X axis
  const xAxis = d3.axisBottom(xScale)
    .ticks(selectedHours <= 6 ? 6 : 12)
    .tickFormat(d3.timeFormat("%H:%M"));

  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${barHeight})`)
    .call(xAxis);

  row.appendChild(svg.node());
  container.appendChild(row);
}

function showServiceUnavailable() {
  const container = document.getElementById("door-cards");
  if (!document.getElementById("service-unavailable")) {
    const msg = document.createElement("div");
    msg.id = "service-unavailable";
    msg.className = "service-unavailable";
    msg.innerHTML = `
      <strong>Door monitoring unavailable</strong>
      <p>The house state service is not configured or not running. Check that <code>config.house.doors</code> is configured in <code>etc/config.json</code>.</p>
    `;
    container.parentNode.insertBefore(msg, container);
  }
  container.innerHTML = "";

  // Hide timeline section
  document.querySelector(".controls").style.display = "none";
  document.getElementById("legend").style.display = "none";
  document.getElementById("timeline-container").style.display = "none";
}

function hideServiceUnavailable() {
  const msg = document.getElementById("service-unavailable");
  if (msg) msg.remove();

  // Show timeline section
  document.querySelector(".controls").style.display = "flex";
  document.getElementById("legend").style.display = "flex";
  document.getElementById("timeline-container").style.display = "block";
}

function showError(section) {
  if (section === "current") {
    document.getElementById("door-cards").innerHTML =
      '<div class="no-data">Error loading door status. Check console for details.</div>';
  } else if (section === "timeline") {
    document.getElementById("no-data").textContent =
      "Error loading history data. Check console for details.";
    document.getElementById("no-data").style.display = "block";
  }
}

// Handle window resize
window.addEventListener("resize", () => {
  if (historyData) {
    renderTimeline(historyData);
  }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (updateInterval) clearInterval(updateInterval);
  if (historyInterval) clearInterval(historyInterval);
});
