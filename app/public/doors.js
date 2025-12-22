// Door state colors
const COLORS = {
  open: "#4caf50",    // Green
  closed: "#f44336",  // Red
  unknown: "#9e9e9e"  // Gray
};

// Global state
let selectedHours = 6;
let doorData = null;
let historyData = null;
let updateInterval = null;
let historyInterval = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  setupTimeControls();
  fetchCurrentStatus();
  fetchHistory();

  // Auto-refresh intervals
  updateInterval = setInterval(fetchCurrentStatus, 5000);  // 5 seconds
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

    // Format timestamp
    const timeStr = door.lastUpdate > 0
      ? new Date(door.lastUpdate).toLocaleString()
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

async function fetchHistory() {
  try {
    const response = await fetch("/api/house/history");

    if (response.status === 503) {
      return; // Already showing service unavailable from current status
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    historyData = await response.json();
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
    { label: "Open", color: COLORS.open },
    { label: "Closed", color: COLORS.closed },
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
  const hasData = Object.values(data).some(history => history.length > 0);
  if (!hasData) {
    noData.style.display = "block";
    noData.textContent = "No door history data yet. History will appear as door states change.";
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

  // Get door names from doorData for labeling
  const doorNames = doorData || {};

  // Create row for each door
  Object.entries(data).forEach(([doorId, history]) => {
    const row = document.createElement("div");
    row.className = "door-row";

    // Get current state from doorData
    const currentState = doorNames[doorId]?.state;
    const currentStateText = currentState === true ? "OPEN"
                           : currentState === false ? "CLOSED"
                           : "UNKNOWN";
    const doorName = doorNames[doorId]?.name || doorId;

    // Door name header
    const header = document.createElement("div");
    header.className = "door-row-name";
    header.innerHTML = `${doorName}<span class="current-state">Current: ${currentStateText}</span>`;
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

    // Function to get color based on state
    function getStateColor(state) {
      if (state === true) return COLORS.open;
      if (state === false) return COLORS.closed;
      return COLORS.unknown;
    }

    // Function to get state label
    function getStateLabel(state) {
      if (state === true) return "OPEN";
      if (state === false) return "CLOSED";
      return "UNKNOWN";
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
  });
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
