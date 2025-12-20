// State
let selectedPersonId = null;
let activeTab = "raw";

// History buffers for sparklines
const sensorHistory = {}; // { room: [values...] }
const inferenceHistory = {}; // { room: [values...] }
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

// Tab logic
function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      setActiveTab(tabName);
    });
  });
}

function setActiveTab(tabName) {
  activeTab = tabName;

  // Update tab buttons
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.id === `tab-${tabName}`);
  });

  // Trigger immediate data fetch for the new tab
  updateData();
}

// Person selector
async function initPersonSelector(defaultPersonId) {
  const select = document.querySelector("#person-select");
  const people = await fetchPeople();

  people.forEach((person) => {
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = person.name || person.id;
    if (person.id === defaultPersonId) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  selectedPersonId = defaultPersonId;

  select.addEventListener("change", (e) => {
    selectedPersonId = e.target.value;
    updateData();
  });
}

// Update history buffer
function updateHistory(history, key, value) {
  if (!history[key]) {
    history[key] = [];
  }
  history[key].push(value);
  if (history[key].length > historyLength) {
    history[key].shift();
  }
}

// Render sparkline
function renderSparkline(g, history, x, y, width, height, maxValue, color) {
  if (!history || history.length < 2) return;

  const xScale = d3.scaleLinear()
    .domain([0, historyLength - 1])
    .range([0, width]);

  const yScale = d3.scaleLinear()
    .domain([0, maxValue])
    .range([height, 0]);

  const line = d3.line()
    .x((d, i) => x + xScale(i + (historyLength - history.length)))
    .y((d) => y + yScale(d))
    .curve(d3.curveMonotoneX);

  return line(history);
}

// D3.js Bar Chart for Sensors
function renderSensorsChart(data) {
  const svg = d3.select("#sensors-chart");
  const chartHeight = data.length * (barHeight + barGap);

  svg
    .attr("width", chartWidth + chartMargin.left + chartMargin.right)
    .attr("height", chartHeight + chartMargin.top + chartMargin.bottom);

  // Update history
  data.forEach((d) => updateHistory(sensorHistory, d.room, d.value));

  // Create scales
  const xScale = d3.scaleLinear().domain([0, 10]).range([0, chartWidth]);

  const yScale = d3
    .scaleBand()
    .domain(data.map((d) => d.room))
    .range([0, chartHeight])
    .padding(0.15);

  // Get or create main group
  let g = svg.select("g.chart-group");
  if (g.empty()) {
    g = svg
      .append("g")
      .attr("class", "chart-group")
      .attr("transform", `translate(${chartMargin.left},${chartMargin.top})`);
  }

  // Sparklines
  const sparklines = g.selectAll("path.sparkline").data(data, (d) => d.room);

  sparklines
    .enter()
    .append("path")
    .attr("class", "sparkline")
    .attr("fill", "none")
    .attr("stroke-width", 1.5)
    .merge(sparklines)
    .attr("stroke", (d) => (d.fresh ? "#4caf50" : "#9e9e9e"))
    .attr("d", (d) => renderSparkline(
      g, sensorHistory[d.room],
      -sparklineWidth - 8, yScale(d.room),
      sparklineWidth, yScale.bandwidth(),
      10, d.fresh ? "#4caf50" : "#9e9e9e"
    ));

  sparklines.exit().remove();

  // Bars
  const bars = g.selectAll("rect.bar").data(data, (d) => d.room);

  bars
    .enter()
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

  // Labels (room names)
  const labels = g.selectAll("text.bar-label").data(data, (d) => d.room);

  labels
    .enter()
    .append("text")
    .attr("class", "bar-label")
    .attr("x", -sparklineWidth - 16)
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .merge(labels)
    .transition()
    .duration(300)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => d.room);

  labels.exit().remove();

  // Values
  const values = g.selectAll("text.bar-value").data(data, (d) => d.room);

  values
    .enter()
    .append("text")
    .attr("class", "bar-value")
    .attr("dominant-baseline", "middle")
    .merge(values)
    .transition()
    .duration(300)
    .attr("x", (d) => xScale(d.value) + 8)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => d.value.toFixed(1));

  values.exit().remove();
}

// D3.js Bar Chart for Inference
function renderInferenceChart(data) {
  if (!data || data.length === 0) return;

  const svg = d3.select("#inference-chart");
  const chartHeight = data.length * (barHeight + barGap);

  svg
    .attr("width", chartWidth + chartMargin.left + chartMargin.right)
    .attr("height", chartHeight + chartMargin.top + chartMargin.bottom);

  // Update history (store percentage values)
  data.forEach((d) => updateHistory(inferenceHistory, d.room, d.value * 100));

  // Create scales (0-100%)
  const xScale = d3.scaleLinear().domain([0, 100]).range([0, chartWidth]);

  const yScale = d3
    .scaleBand()
    .domain(data.map((d) => d.room))
    .range([0, chartHeight])
    .padding(0.15);

  // Get or create main group
  let g = svg.select("g.chart-group");
  if (g.empty()) {
    g = svg
      .append("g")
      .attr("class", "chart-group")
      .attr("transform", `translate(${chartMargin.left},${chartMargin.top})`);
  }

  // Convert values to percentage and find best
  const processedData = data.map((d, i) => ({
    ...d,
    percent: d.value * 100,
    isBest: i === 0,
  }));

  // Sparklines
  const sparklines = g.selectAll("path.sparkline").data(processedData, (d) => d.room);

  sparklines
    .enter()
    .append("path")
    .attr("class", "sparkline")
    .attr("fill", "none")
    .attr("stroke-width", 1.5)
    .merge(sparklines)
    .attr("stroke", (d) => (d.isBest ? "#4caf50" : "#2196f3"))
    .attr("d", (d) => renderSparkline(
      g, inferenceHistory[d.room],
      -sparklineWidth - 8, yScale(d.room),
      sparklineWidth, yScale.bandwidth(),
      100, d.isBest ? "#4caf50" : "#2196f3"
    ));

  sparklines.exit().remove();

  // Bars
  const bars = g.selectAll("rect.bar").data(processedData, (d) => d.room);

  bars
    .enter()
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

  // Labels (room names)
  const labels = g.selectAll("text.bar-label").data(processedData, (d) => d.room);

  labels
    .enter()
    .append("text")
    .attr("class", "bar-label")
    .attr("x", -sparklineWidth - 16)
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .merge(labels)
    .transition()
    .duration(300)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => d.room);

  labels.exit().remove();

  // Values (percentage)
  const values = g.selectAll("text.bar-value").data(processedData, (d) => d.room);

  values
    .enter()
    .append("text")
    .attr("class", "bar-value")
    .attr("dominant-baseline", "middle")
    .merge(values)
    .transition()
    .duration(300)
    .attr("x", (d) => xScale(d.percent) + 8)
    .attr("y", (d) => yScale(d.room) + yScale.bandwidth() / 2)
    .text((d) => `${d.percent.toFixed(0)}%`);

  values.exit().remove();
}

// Update data based on active tab
async function updateData() {
  if (activeTab === "raw") {
    const data = await fetchSensordata();
    const sensorDataElement = document.querySelector("#sensordata");
    sensorDataElement.textContent = JSON.stringify(data, null, 2);
  } else if (activeTab === "charts") {
    const [sensorData, predictions] = await Promise.all([
      fetchSensordata(),
      fetchPredictions()
    ]);
    renderSensorsChart(sensorData);
    renderInferenceChart(predictions);
  }
}

// Training mode functions
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

  // Initialize person selector with default from config
  await initPersonSelector(status.personId);

  // Initialize tabs
  initTabs();

  // Show/hide training UI based on status
  if (status.trainingEnabled) {
    document.querySelector("#training-section").style.display = "block";
    document.querySelector("#training-disabled").style.display = "none";
    const rooms = await fetchRooms();
    populateButtons(rooms);
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
