// Room colors using D3 category colors
const roomColors = {};
const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

let selectedHours = 6;
let historyData = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  setupTimeControls();
  fetchHistory();

  // Auto-refresh every 30 seconds
  setInterval(fetchHistory, 30000);
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

async function fetchHistory() {
  try {
    const response = await fetch("/api/history");
    historyData = await response.json();
    renderTimeline(historyData);
  } catch (error) {
    console.error("Error fetching history:", error);
    document.getElementById("no-data").textContent = "Error loading history data.";
  }
}

function getRoomColor(room) {
  if (!roomColors[room]) {
    roomColors[room] = colorScale(room);
  }
  return roomColors[room];
}

function renderLegend(rooms) {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";

  const sortedRooms = [...rooms].sort();
  sortedRooms.forEach(room => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <div class="legend-color" style="background-color: ${getRoomColor(room)}"></div>
      <span>${room}</span>
    `;
    legend.appendChild(item);
  });
}

function renderTimeline(data) {
  const container = document.getElementById("timeline-container");
  const noData = document.getElementById("no-data");
  const tooltip = document.getElementById("tooltip");

  // Collect all unique rooms for legend
  const allRooms = new Set();
  Object.values(data).forEach(person => {
    if (person.currentRoom && person.currentRoom !== "na") {
      allRooms.add(person.currentRoom);
    }
    person.history.forEach(h => allRooms.add(h.room));
  });

  renderLegend(allRooms);

  // Check if we have any data
  const hasData = Object.values(data).some(p => p.history.length > 0);
  if (!hasData) {
    noData.style.display = "block";
    noData.textContent = "No room history data yet. History will appear as rooms are detected.";
    container.querySelectorAll(".person-row").forEach(el => el.remove());
    return;
  }

  noData.style.display = "none";

  // Time range
  const now = Date.now();
  const startTime = now - selectedHours * 60 * 60 * 1000;

  // Dimensions
  const margin = { top: 20, right: 20, bottom: 30, left: 100 };
  const width = container.clientWidth - margin.left - margin.right - 40;
  const barHeight = 30;

  // Time scale
  const xScale = d3.scaleTime()
    .domain([new Date(startTime), new Date(now)])
    .range([0, width]);

  // Remove old rows
  container.querySelectorAll(".person-row").forEach(el => el.remove());

  // Create row for each person
  Object.entries(data).forEach(([personId, personData]) => {
    const row = document.createElement("div");
    row.className = "person-row";

    // Person name header
    const header = document.createElement("div");
    header.className = "person-name";
    header.innerHTML = `${personData.name}<span class="current-room">Current: ${personData.currentRoom}</span>`;
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
    const filteredHistory = personData.history
      .filter(h => h.timestamp >= startTime)
      .sort((a, b) => a.timestamp - b.timestamp);

    // Add a start segment if history starts after our window
    if (filteredHistory.length > 0) {
      // Find the room before our time window
      const beforeWindow = personData.history
        .filter(h => h.timestamp < startTime)
        .sort((a, b) => b.timestamp - a.timestamp)[0];

      if (beforeWindow) {
        segments.push({
          room: beforeWindow.room,
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
        room: current.room,
        start: Math.max(current.timestamp, startTime),
        end: next ? next.timestamp : now
      });
    }

    // If no segments but we have current room, show it for the whole range
    if (segments.length === 0 && personData.currentRoom && personData.currentRoom !== "na") {
      segments.push({
        room: personData.currentRoom,
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
      .attr("fill", d => getRoomColor(d.room))
      .attr("rx", 3)
      .on("mouseover", function(event, d) {
        const startStr = new Date(d.start).toLocaleTimeString();
        const endStr = new Date(d.end).toLocaleTimeString();
        const duration = Math.round((d.end - d.start) / 60000);
        tooltip.innerHTML = `<strong>${d.room}</strong><br>${startStr} - ${endStr}<br>${duration} min`;
        tooltip.style.opacity = 1;
        tooltip.style.left = (event.pageX + 10) + "px";
        tooltip.style.top = (event.pageY - 10) + "px";
      })
      .on("mouseout", function() {
        tooltip.style.opacity = 0;
      });

    // Add room labels on segments (if wide enough)
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
        return segWidth > 50 ? d.room : "";
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

// Handle window resize
window.addEventListener("resize", () => {
  if (historyData) {
    renderTimeline(historyData);
  }
});
