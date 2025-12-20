// Fetch datasets
async function fetchDatasets() {
  try {
    const response = await fetch("/api/datasets");
    return await response.json();
  } catch (error) {
    console.error("Error fetching datasets:", error);
    return [];
  }
}

// Fetch training data for a dataset
async function fetchTrainingData(dataset) {
  try {
    const response = await fetch(`/api/training-data?dataset=${encodeURIComponent(dataset)}`);
    return await response.json();
  } catch (error) {
    console.error("Error fetching training data:", error);
    return null;
  }
}

// Initialize dataset selector
async function initDatasetSelector() {
  const select = document.querySelector("#dataset-select");
  const datasets = await fetchDatasets();

  datasets.forEach((dataset) => {
    const option = document.createElement("option");
    option.value = dataset;
    option.textContent = dataset;
    select.appendChild(option);
  });

  select.addEventListener("change", (e) => {
    const dataset = e.target.value;
    if (dataset) {
      loadDataset(dataset);
    } else {
      hideVisualization();
    }
  });
}

// Hide visualization
function hideVisualization() {
  document.querySelector("#stats").style.display = "none";
  document.querySelector("#heatmap-container").style.display = "none";
  document.querySelector("#no-data").style.display = "block";
}

// Load and visualize dataset
async function loadDataset(dataset) {
  const data = await fetchTrainingData(dataset);
  if (!data || !data.data || data.data.length === 0) {
    hideVisualization();
    return;
  }

  // Show containers
  document.querySelector("#stats").style.display = "block";
  document.querySelector("#heatmap-container").style.display = "block";
  document.querySelector("#no-data").style.display = "none";

  // Update stats
  const totalSamples = data.data.length > 0 ? data.data[0].count : 0;
  document.querySelector("#stat-samples").textContent =
    data.data.reduce((max, d) => Math.max(max, d.count), 0);
  document.querySelector("#stat-rooms").textContent = data.rooms.length;
  document.querySelector("#stat-sensors").textContent = data.sensors.length;

  // Render heatmap
  renderHeatmap(data);
}

// Render heatmap
function renderHeatmap(data) {
  const svg = d3.select("#heatmap");
  svg.selectAll("*").remove();

  const margin = { top: 30, right: 120, bottom: 60, left: 100 };
  const cellSize = 40;
  const width = data.sensors.length * cellSize;
  const height = data.rooms.length * cellSize;

  svg
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Scales
  const xScale = d3.scaleBand()
    .domain(data.sensors)
    .range([0, width])
    .padding(0.05);

  const yScale = d3.scaleBand()
    .domain(data.rooms)
    .range([0, height])
    .padding(0.05);

  // Color scale - inverted so lower values (closer) are darker
  const colorScale = d3.scaleSequential()
    .domain([10, 0]) // Inverted: 0 is darkest, 10 is lightest
    .interpolator(d3.interpolateBlues);

  // Create lookup map for data
  const dataMap = new Map();
  data.data.forEach(d => {
    dataMap.set(`${d.room}-${d.sensor}`, d.value);
  });

  // Tooltip
  const tooltip = d3.select("#tooltip");

  // Draw cells
  for (const room of data.rooms) {
    for (const sensor of data.sensors) {
      const value = dataMap.get(`${room}-${sensor}`) || 10;

      g.append("rect")
        .attr("class", "heatmap-cell")
        .attr("x", xScale(sensor))
        .attr("y", yScale(room))
        .attr("width", xScale.bandwidth())
        .attr("height", yScale.bandwidth())
        .attr("fill", colorScale(value))
        .on("mouseover", function(event) {
          tooltip
            .style("opacity", 1)
            .html(`<strong>${room}</strong><br>Sensor: ${sensor}<br>Avg: ${value.toFixed(2)}`);
        })
        .on("mousemove", function(event) {
          tooltip
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
          tooltip.style("opacity", 0);
        });
    }
  }

  // X axis (sensors)
  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(xScale))
    .selectAll("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-45)")
    .attr("text-anchor", "end")
    .attr("dx", "-0.5em")
    .attr("dy", "0.5em");

  // Y axis (rooms)
  g.append("g")
    .call(d3.axisLeft(yScale))
    .selectAll("text")
    .attr("class", "axis-label");

  // Legend
  const legendWidth = 20;
  const legendHeight = height;

  const legendScale = d3.scaleLinear()
    .domain([0, 10])
    .range([legendHeight, 0]);

  const legendAxis = d3.axisRight(legendScale)
    .ticks(5);

  const legend = g.append("g")
    .attr("transform", `translate(${width + 30}, 0)`);

  // Legend gradient
  const defs = svg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "heatmap-gradient")
    .attr("x1", "0%")
    .attr("y1", "100%")
    .attr("x2", "0%")
    .attr("y2", "0%");

  gradient.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", colorScale(0));

  gradient.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", colorScale(10));

  legend.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "url(#heatmap-gradient)");

  legend.append("g")
    .attr("transform", `translate(${legendWidth}, 0)`)
    .call(legendAxis)
    .selectAll("text")
    .attr("class", "legend-label");

  legend.append("text")
    .attr("class", "legend-label")
    .attr("transform", `translate(${legendWidth + 40}, ${legendHeight / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .text("Distance (lower = closer)");
}

// Initialize
document.addEventListener("DOMContentLoaded", function() {
  initDatasetSelector();
});
