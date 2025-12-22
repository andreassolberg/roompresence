// State
let allPeople = {}; // Store all people data

// History buffers for sparklines - now keyed by personId
const sensorHistory = {}; // { personId: { room: [values...] } }
const inferenceHistory = {}; // { personId: { room: [values...] } }
const historyLength = 30; // Keep last 30 data points

// Chart dimensions
const sparklineWidth = 60;
const chartMargin = { top: 10, right: 60, bottom: 10, left: 100 + sparklineWidth + 8 };
const chartWidth = 500;
const barHeight = 24;
const barGap = 4;

// Fetch helpers
async function fetchStatus() {
  try {
    const response = await fetch("/api/status");
    return await response.json();
  } catch (error) {
    console.error("Error fetching status:", error);
    return null;
  }
}

async function fetchPeople() {
  try {
    const response = await fetch("/api/people");
    return await response.json();
  } catch (error) {
    console.error("Error fetching people:", error);
    return [];
  }
}

async function fetchRooms() {
  try {
    const response = await fetch("/api/rooms");
    return await response.json();
  } catch (error) {
    console.error("Error fetching rooms:", error);
    return [];
  }
}

async function fetchSensordata() {
  try {
    const url = selectedPersonId
      ? `/api/sensors?person=${encodeURIComponent(selectedPersonId)}`
      : "/api/sensors";
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error("Error fetching sensor data:", error);
    return [];
  }
}

async function fetchPredictions() {
  try {
    const url = selectedPersonId
      ? `/api/predictions?person=${encodeURIComponent(selectedPersonId)}`
      : "/api/predictions";
    const response = await fetch(url);
    return await response.json();
  } catch (error) {
    console.error("Error fetching predictions:", error);
    return [];
  }
}

async function fetchRoomStates() {
  try {
    const response = await fetch("/api/room-states");
    return await response.json();
  } catch (error) {
    console.error("Error fetching room states:", error);
    return {};
  }
}

// Person selector - REMOVED (now showing all people in cards)

// Update history buffer for person-specific tracking
function updatePersonHistory(history, personId, room, value) {
  if (!history[personId]) {
    history[personId] = {};
  }
  if (!history[personId][room]) {
    history[personId][room] = [];
  }
  history[personId][room].push(value);
  if (history[personId][room].length > historyLength) {
    history[personId][room].shift();
  }
}

// Render sparkline for person-specific history
function renderPersonSparkline(history, personId, room, x, y, width, height, maxValue) {
  if (!history[personId] || !history[personId][room] || history[personId][room].length < 2) {
    return null;
  }

  const data = history[personId][room];

  const xScale = d3.scaleLinear()
    .domain([0, historyLength - 1])
    .range([0, width]);

  const yScale = d3.scaleLinear()
    .domain([0, maxValue])
    .range([height, 0]);

  const line = d3.line()
    .x((d, i) => x + xScale(i + (historyLength - data.length)))
    .y((d) => y + yScale(d))
    .curve(d3.curveMonotoneX);

  return line(data);
}

// D3.js Bar Chart for Sensors (person-specific)
function renderPersonSensorChart(personId, sensorData) {
  if (!sensorData || sensorData.length === 0) return;

  const svgId = `sensors-chart-${personId}`;
  const svg = d3.select(`#${svgId}`);
  const miniChartWidth = 400;
  const miniBarHeight = 18;
  const miniBarGap = 3;
  const miniSparklineWidth = 50;
  const miniChartMargin = { top: 5, right: 40, bottom: 5, left: 80 + miniSparklineWidth };
  const chartHeight = sensorData.length * (miniBarHeight + miniBarGap);

  svg
    .attr("width", miniChartWidth + miniChartMargin.left + miniChartMargin.right)
    .attr("height", chartHeight + miniChartMargin.top + miniChartMargin.bottom);

  // Update history
  sensorData.forEach((d) => updatePersonHistory(sensorHistory, personId, d.room, d.value));

  // Create scales
  const xScale = d3.scaleLinear().domain([0, 10]).range([0, miniChartWidth]);
  const yScale = d3.scaleBand()
    .domain(sensorData.map((d) => d.room))
    .range([0, chartHeight])
    .padding(0.15);

  // Get or create main group
  let g = svg.select("g.chart-group");
  if (g.empty()) {
    g = svg.append("g")
      .attr("class", "chart-group")
      .attr("transform", `translate(${miniChartMargin.left},${miniChartMargin.top})`);
  }

  // Sparklines
  const sparklines = g.selectAll("path.sparkline").data(sensorData, (d) => d.room);
  sparklines.enter()
    .append("path")
    .attr("class", "sparkline")
    .attr("fill", "none")
    .attr("stroke-width", 1.2)
    .merge(sparklines)
    .attr("stroke", (d) => (d.fresh ? "#4caf50" : "#9e9e9e"))
    .attr("d", (d) => renderPersonSparkline(
      sensorHistory, personId, d.room,
      -miniSparklineWidth - 6, yScale(d.room),
      miniSparklineWidth, yScale.bandwidth(), 10
    ));
  sparklines.exit().remove();

  // Bars
  const bars = g.selectAll("rect.bar").data(sensorData, (d) => d.room);
  bars.enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", (d) => yScale(d.room))
    .attr("height", yScale.bandwidth())
    .attr("width", 0)
    .attr("fill", (d) => (d.fresh ? "#4caf50" : "#9e9e9e"))
    .merge(bars)
    .transition()
    .duration(300)
    .attr("y", (d) => yScale(d.room))
    .attr("width", (d) => xScale(d.value))
    .attr("fill", (d) => (d.fresh ? "#4caf50" : "#9e9e9e"));
  bars.exit().remove();

  // Labels
  const labels = g.selectAll("text.bar-label").data(sensorData, (d) => d.room);
  labels.enter()
    .append("text")
    .attr("class", "bar-label")
    .attr("x", -miniSparklineWidth - 10)
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "11px")
    .merge(labels)
    .transition()
    .duration(300)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => d.room);
  labels.exit().remove();

  // Values
  const values = g.selectAll("text.bar-value").data(sensorData, (d) => d.room);
  values.enter()
    .append("text")
    .attr("class", "bar-value")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "10px")
    .merge(values)
    .transition()
    .duration(300)
    .attr("x", (d) => xScale(d.value) + 6)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => d.value.toFixed(1));
  values.exit().remove();
}

// D3.js Bar Chart for Inference (person-specific)
function renderPersonInferenceChart(personId, predictions) {
  if (!predictions || predictions.length === 0) return;

  const svgId = `inference-chart-${personId}`;
  const svg = d3.select(`#${svgId}`);
  const miniChartWidth = 400;
  const miniBarHeight = 18;
  const miniBarGap = 3;
  const miniSparklineWidth = 50;
  const miniChartMargin = { top: 5, right: 40, bottom: 5, left: 80 + miniSparklineWidth };

  // Limit to top 5 predictions
  const topPredictions = predictions.slice(0, 5);
  const chartHeight = topPredictions.length * (miniBarHeight + miniBarGap);

  svg
    .attr("width", miniChartWidth + miniChartMargin.left + miniChartMargin.right)
    .attr("height", chartHeight + miniChartMargin.top + miniChartMargin.bottom);

  // Update history (store percentage values)
  topPredictions.forEach((d) => updatePersonHistory(inferenceHistory, personId, d.room, d.value * 100));

  // Create scales (0-100%)
  const xScale = d3.scaleLinear().domain([0, 100]).range([0, miniChartWidth]);
  const yScale = d3.scaleBand()
    .domain(topPredictions.map((d) => d.room))
    .range([0, chartHeight])
    .padding(0.15);

  // Get or create main group
  let g = svg.select("g.chart-group");
  if (g.empty()) {
    g = svg.append("g")
      .attr("class", "chart-group")
      .attr("transform", `translate(${miniChartMargin.left},${miniChartMargin.top})`);
  }

  const processedData = topPredictions.map((d, i) => ({
    ...d,
    percent: d.value * 100,
    isBest: i === 0,
  }));

  // Sparklines
  const sparklines = g.selectAll("path.sparkline").data(processedData, (d) => d.room);
  sparklines.enter()
    .append("path")
    .attr("class", "sparkline")
    .attr("fill", "none")
    .attr("stroke-width", 1.2)
    .merge(sparklines)
    .attr("stroke", (d) => (d.isBest ? "#4caf50" : "#2196f3"))
    .attr("d", (d) => renderPersonSparkline(
      inferenceHistory, personId, d.room,
      -miniSparklineWidth - 6, yScale(d.room),
      miniSparklineWidth, yScale.bandwidth(), 100
    ));
  sparklines.exit().remove();

  // Bars
  const bars = g.selectAll("rect.bar").data(processedData, (d) => d.room);
  bars.enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", (d) => yScale(d.room))
    .attr("height", yScale.bandwidth())
    .attr("width", 0)
    .attr("fill", (d) => (d.isBest ? "#4caf50" : "#2196f3"))
    .merge(bars)
    .transition()
    .duration(300)
    .attr("y", (d) => yScale(d.room))
    .attr("width", (d) => xScale(d.percent))
    .attr("fill", (d) => (d.isBest ? "#4caf50" : "#2196f3"));
  bars.exit().remove();

  // Labels
  const labels = g.selectAll("text.bar-label").data(processedData, (d) => d.room);
  labels.enter()
    .append("text")
    .attr("class", "bar-label")
    .attr("x", -miniSparklineWidth - 10)
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "11px")
    .merge(labels)
    .transition()
    .duration(300)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => d.room);
  labels.exit().remove();

  // Values
  const values = g.selectAll("text.bar-value").data(processedData, (d) => d.room);
  values.enter()
    .append("text")
    .attr("class", "bar-value")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "10px")
    .merge(values)
    .transition()
    .duration(300)
    .attr("x", (d) => xScale(d.percent) + 6)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => `${d.percent.toFixed(0)}%`);
  values.exit().remove();
}

// Render person card HTML
function renderPersonCard(personId, personData) {
  // Create status badges HTML
  let badges = '';
  if (personData.room0Confident) {
    badges += '<span class="badge confident">Confident</span>';
  }
  if (personData.room0Stable) {
    badges += '<span class="badge stable">Stable</span>';
  }
  if (personData.room0SuperStable) {
    badges += '<span class="badge super-stable">Super Stable</span>';
  }
  if (personData.room === "na" && personData.room0 === "na") {
    badges += '<span class="badge stale">No Data</span>';
  }
  if (personData.hasPendingTransition) {
    badges += '<span class="badge pending">Pending</span>';
  }
  if (personData.doorLocked) {
    badges += '<span class="badge locked">Locked</span>';
  }

  // Transition info
  let transitionInfo = '';
  if (personData.hasPendingTransition && personData.room !== "na" && personData.room0 !== "na") {
    transitionInfo = `
      <div class="transition-info">
        Transition: ${personData.room} <span class="transition-arrow">→</span> ${personData.room0}
        (${personData.secondsSinceChange}s)
      </div>
    `;
  }

  // Locked door info
  let lockedDoorInfo = '';
  if (personData.doorLocked && personData.lockedDoors && personData.lockedDoors.length > 0) {
    lockedDoorInfo = `
      <div class="transition-info" style="color: #f44336;">
        Locked behind: ${personData.lockedDoors.join(', ')}
      </div>
    `;
  }

  // Device info
  const deviceInfo = personData.activeDevice
    ? `<div class="device-info">Active: ${personData.activeDevice}</div>`
    : '';

  return `
    <div class="person-card" id="card-${personId}">
      <div class="person-card-header">
        <div class="person-name">${personData.name}</div>
      </div>

      <div class="room-status">
        <div class="room-indicator room0-indicator ${personData.hasPendingTransition ? 'pending' : ''}">
          <span class="room-indicator-label">ML Prediction</span>
          <span class="room-indicator-value">${personData.room0}</span>
        </div>

        <div class="room-indicator final">
          <span class="room-indicator-label">Current Room</span>
          <span class="room-indicator-value">${personData.room}</span>
        </div>
      </div>

      <div class="status-badges">
        ${badges}
      </div>

      ${transitionInfo}
      ${lockedDoorInfo}
      ${deviceInfo}

      <div class="card-charts">
        <div class="chart-section">
          <div class="chart-title">Sensor Distances</div>
          <svg id="sensors-chart-${personId}" class="mini-chart"></svg>
        </div>
        <div class="chart-section">
          <div class="chart-title">Top Predictions</div>
          <svg id="inference-chart-${personId}" class="mini-chart"></svg>
        </div>
      </div>
    </div>
  `;
}

// Update person card (for incremental updates)
function updatePersonCard(personId, personData) {
  const card = document.getElementById(`card-${personId}`);
  if (!card) return;

  // Update room0
  const room0El = card.querySelector('.room0-indicator .room-indicator-value');
  if (room0El) room0El.textContent = personData.room0;

  // Update room
  const roomEl = card.querySelector('.final .room-indicator-value');
  if (roomEl) roomEl.textContent = personData.room;

  // Update pending state
  const room0Indicator = card.querySelector('.room0-indicator');
  if (room0Indicator) {
    if (personData.hasPendingTransition) {
      room0Indicator.classList.add('pending');
    } else {
      room0Indicator.classList.remove('pending');
    }
  }

  // Update badges
  let badges = '';
  if (personData.room0Confident) {
    badges += '<span class="badge confident">Confident</span>';
  }
  if (personData.room0Stable) {
    badges += '<span class="badge stable">Stable</span>';
  }
  if (personData.room0SuperStable) {
    badges += '<span class="badge super-stable">Super Stable</span>';
  }
  if (personData.room === "na" && personData.room0 === "na") {
    badges += '<span class="badge stale">No Data</span>';
  }
  if (personData.hasPendingTransition) {
    badges += '<span class="badge pending">Pending</span>';
  }
  if (personData.doorLocked) {
    badges += '<span class="badge locked">Locked</span>';
  }

  const badgesEl = card.querySelector('.status-badges');
  if (badgesEl) badgesEl.innerHTML = badges;

  // Update transition info
  let transitionInfo = '';
  if (personData.hasPendingTransition && personData.room !== "na" && personData.room0 !== "na") {
    transitionInfo = `
      Transition: ${personData.room} <span class="transition-arrow">→</span> ${personData.room0}
      (${personData.secondsSinceChange}s)
    `;
  }

  // Update locked door info
  let lockedDoorInfo = '';
  if (personData.doorLocked && personData.lockedDoors && personData.lockedDoors.length > 0) {
    lockedDoorInfo = `
      Locked behind: ${personData.lockedDoors.join(', ')}
    `;
  }

  // Get all info elements (transition and locked)
  const existingInfoElements = card.querySelectorAll('.transition-info');

  // Remove all existing info elements
  existingInfoElements.forEach(el => el.remove());

  // Add new info elements in order
  const badgesContainer = card.querySelector('.status-badges');
  if (transitionInfo) {
    badgesContainer.insertAdjacentHTML('afterend', `<div class="transition-info">${transitionInfo}</div>`);
  }
  if (lockedDoorInfo) {
    const insertAfter = transitionInfo ? card.querySelector('.transition-info') : badgesContainer;
    insertAfter.insertAdjacentHTML('afterend', `<div class="transition-info" style="color: #f44336;">${lockedDoorInfo}</div>`);
  }
}

// Render all person cards
async function renderAllPersonCards() {
  const roomStates = await fetchRoomStates();
  const grid = document.getElementById("person-grid");

  if (!grid) {
    console.error("Person grid container not found");
    return;
  }

  const personIds = Object.keys(roomStates).sort();

  // Render or update cards
  for (const personId of personIds) {
    const personData = roomStates[personId];
    const existingCard = document.getElementById(`card-${personId}`);

    if (!existingCard) {
      // Create new card
      const cardHTML = renderPersonCard(personId, personData);
      grid.insertAdjacentHTML('beforeend', cardHTML);
    } else {
      // Update existing card
      updatePersonCard(personId, personData);
    }

    // Render charts using data from roomStates
    if (personData.sensors && personData.predictions) {
      renderPersonSensorChart(personId, personData.sensors);
      renderPersonInferenceChart(personId, personData.predictions);
    }
  }

  // Remove cards for people no longer in config
  const existingCards = grid.querySelectorAll('.person-card');
  existingCards.forEach(card => {
    const cardId = card.id.replace('card-', '');
    if (!personIds.includes(cardId)) {
      card.remove();
    }
  });
}

// Update data - render all person cards
async function updateData() {
  await renderAllPersonCards();
}

// Training mode functions
async function fetchTrainingStats() {
  try {
    const response = await fetch("/api/training-stats");
    if (response.status === 403) return null;
    return await response.json();
  } catch (error) {
    console.error("Error fetching training stats:", error);
    return null;
  }
}

function renderTrainingStats(stats) {
  if (!stats || !stats.counts) return;

  document.querySelector("#stats-total").textContent = `(${stats.totalCollected} this session, ${stats.total} pending save)`;

  const svg = d3.select("#stats-chart");
  const margin = { top: 5, right: 50, bottom: 5, left: 80 };
  const barHeight = 20;
  const barGap = 3;

  // Convert counts to array and sort by count descending
  const data = Object.entries(stats.counts)
    .map(([room, count]) => ({ room, count }))
    .sort((a, b) => b.count - a.count);

  if (data.length === 0) {
    svg.attr("width", 0).attr("height", 0);
    return;
  }

  const width = 250;
  const height = data.length * (barHeight + barGap);

  svg
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const maxCount = d3.max(data, d => d.count) || 1;
  const xScale = d3.scaleLinear().domain([0, maxCount]).range([0, width]);
  const yScale = d3.scaleBand()
    .domain(data.map(d => d.room))
    .range([0, height])
    .padding(0.1);

  let g = svg.select("g.stats-group");
  if (g.empty()) {
    g = svg.append("g")
      .attr("class", "stats-group")
      .attr("transform", `translate(${margin.left},${margin.top})`);
  }

  // Bars
  const bars = g.selectAll("rect.bar").data(data, d => d.room);
  bars.enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", d => yScale(d.room))
    .attr("height", yScale.bandwidth())
    .attr("fill", d => d.room === stats.currentRoom ? "#4caf50" : "#2196f3")
    .merge(bars)
    .transition()
    .duration(300)
    .attr("y", d => yScale(d.room))
    .attr("width", d => xScale(d.count))
    .attr("fill", d => d.room === stats.currentRoom ? "#4caf50" : "#2196f3");
  bars.exit().remove();

  // Labels
  const labels = g.selectAll("text.label").data(data, d => d.room);
  labels.enter()
    .append("text")
    .attr("class", "label")
    .attr("x", -8)
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "12px")
    .attr("fill", "#333")
    .merge(labels)
    .attr("y", d => yScale(d.room) + yScale.bandwidth() / 2)
    .text(d => d.room);
  labels.exit().remove();

  // Values
  const values = g.selectAll("text.value").data(data, d => d.room);
  values.enter()
    .append("text")
    .attr("class", "value")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "11px")
    .attr("fill", "#666")
    .merge(values)
    .transition()
    .duration(300)
    .attr("x", d => xScale(d.count) + 6)
    .attr("y", d => yScale(d.room) + yScale.bandwidth() / 2)
    .text(d => d.count);
  values.exit().remove();
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

// Initialize
async function initializeUI() {
  const status = await fetchStatus();

  if (!status) {
    console.error("Failed to load application status");
    return;
  }

  // Show/hide training UI based on status
  if (status.trainingEnabled) {
    document.querySelector("#training-section").style.display = "block";
    document.querySelector("#training-disabled").style.display = "none";
    const rooms = await fetchRooms();
    populateButtons(rooms);

    // Start polling training stats
    async function updateTrainingStats() {
      const stats = await fetchTrainingStats();
      if (stats) renderTrainingStats(stats);
    }
    updateTrainingStats();
    setInterval(updateTrainingStats, 1000);
  } else {
    document.querySelector("#training-section").style.display = "none";
    document.querySelector("#training-disabled").style.display = "block";
  }

  // Initial data load
  updateData();

  // Start polling
  setInterval(updateData, 1000);
}

document.addEventListener("DOMContentLoaded", function () {
  console.log("Page loaded");
  initializeUI();
});
