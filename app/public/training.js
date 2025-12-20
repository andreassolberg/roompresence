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
  document.querySelector("#samples-container").style.display = "none";
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
  document.querySelector("#samples-container").style.display = "block";
  document.querySelector("#heatmap-container").style.display = "block";
  document.querySelector("#no-data").style.display = "none";

  // Update stats
  document.querySelector("#stat-samples").textContent = data.totalSamples || 0;
  document.querySelector("#stat-rooms").textContent = data.rooms.length;
  document.querySelector("#stat-sensors").textContent = data.sensors.length;

  // Render charts
  renderSamplesChart(data);
  renderHeatmap(data);
}

// Render samples per room chart
function renderSamplesChart(data) {
  const svg = d3.select("#samples-chart");
  svg.selectAll("*").remove();

  const margin = { top: 10, right: 60, bottom: 10, left: 100 };
  const barHeight = 24;
  const barGap = 4;

  // Sort rooms by count descending
  const roomData = Object.entries(data.roomCounts)
    .map(([room, count]) => ({ room, count }))
    .sort((a, b) => b.count - a.count);

  const width = 400;
  const height = roomData.length * (barHeight + barGap);

  svg
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const maxCount = d3.max(roomData, d => d.count);

  const xScale = d3.scaleLinear()
    .domain([0, maxCount])
    .range([0, width]);

  const yScale = d3.scaleBand()
    .domain(roomData.map(d => d.room))
    .range([0, height])
    .padding(0.15);

  // Bars
  g.selectAll("rect.bar")
    .data(roomData)
    .enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", d => yScale(d.room))
    .attr("width", d => xScale(d.count))
    .attr("height", yScale.bandwidth())
    .attr("fill", "#2196f3");

  // Labels (room names)
  g.selectAll("text.label")
    .data(roomData)
    .enter()
    .append("text")
    .attr("class", "axis-label")
    .attr("x", -8)
    .attr("y", d => yScale(d.room) + yScale.bandwidth() / 2)
    .attr("text-anchor", "end")
    .attr("dominant-baseline", "middle")
    .text(d => d.room);

  // Values
  g.selectAll("text.value")
    .data(roomData)
    .enter()
    .append("text")
    .attr("class", "legend-label")
    .attr("x", d => xScale(d.count) + 8)
    .attr("y", d => yScale(d.room) + yScale.bandwidth() / 2)
    .attr("dominant-baseline", "middle")
    .text(d => d.count);
}

// Kernel Density Estimation
function kernelDensityEstimator(kernel, X) {
  return function(V) {
    return X.map(x => [x, d3.mean(V, v => kernel(x - v))]);
  };
}

function kernelEpanechnikov(k) {
  return function(v) {
    return Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
  };
}

// Render heatmap with violin plots
function renderHeatmap(data) {
  if (!data.rooms || !data.sensors || data.rooms.length === 0 || data.sensors.length === 0) {
    return;
  }

  const svg = d3.select("#heatmap");
  svg.selectAll("*").remove();

  const margin = { top: 30, right: 120, bottom: 60, left: 100 };
  const cellSize = 50;
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

  // Create lookup map for data (including values array)
  const dataMap = new Map();
  data.data.forEach(d => {
    dataMap.set(`${d.room}-${d.sensor}`, d);
  });

  // Tooltip
  const tooltip = d3.select("#tooltip");

  // Value scale for violin (horizontal, 0-10)
  const valueScale = d3.scaleLinear()
    .domain([0, 10])
    .range([0, xScale.bandwidth()]);

  // Draw cells with violin plots
  for (const room of data.rooms) {
    for (const sensor of data.sensors) {
      const cellData = dataMap.get(`${room}-${sensor}`);
      const value = cellData?.value ?? 10;
      const values = cellData?.values ?? [];

      const cellX = xScale(sensor);
      const cellY = yScale(room);
      const cellWidth = xScale.bandwidth();
      const cellHeight = yScale.bandwidth();

      // Background cell
      g.append("rect")
        .attr("class", "heatmap-cell")
        .attr("x", cellX)
        .attr("y", cellY)
        .attr("width", cellWidth)
        .attr("height", cellHeight)
        .attr("fill", colorScale(value));

      // Draw violin plot if we have values
      if (values.length > 2) {
        // Compute KDE
        const kde = kernelDensityEstimator(
          kernelEpanechnikov(0.8),
          d3.range(0, 10.1, 0.5)
        );
        const density = kde(values);

        // Find max density for scaling
        const maxDensity = d3.max(density, d => d[1]) || 1;

        // Scale for density (vertical within cell)
        const densityScale = d3.scaleLinear()
          .domain([0, maxDensity])
          .range([0, cellHeight / 2 - 2]);

        // Create area generator for violin (horizontal)
        const area = d3.area()
          .x(d => cellX + valueScale(d[0]))
          .y0(d => cellY + cellHeight / 2 + densityScale(d[1]))
          .y1(d => cellY + cellHeight / 2 - densityScale(d[1]))
          .curve(d3.curveCatmullRom);

        g.append("path")
          .datum(density)
          .attr("class", "violin")
          .attr("d", area)
          .attr("fill", "rgba(255, 255, 255, 0.7)")
          .attr("stroke", "rgba(0, 0, 0, 0.3)")
          .attr("stroke-width", 0.5);

        // Draw median line
        const median = d3.median(values);
        g.append("line")
          .attr("x1", cellX + valueScale(median))
          .attr("x2", cellX + valueScale(median))
          .attr("y1", cellY + 4)
          .attr("y2", cellY + cellHeight - 4)
          .attr("stroke", "rgba(0, 0, 0, 0.5)")
          .attr("stroke-width", 1.5);
      }

      // Invisible rect for tooltip
      g.append("rect")
        .attr("x", cellX)
        .attr("y", cellY)
        .attr("width", cellWidth)
        .attr("height", cellHeight)
        .attr("fill", "transparent")
        .on("mouseover", function(event) {
          const min = values.length ? d3.min(values).toFixed(1) : "-";
          const max = values.length ? d3.max(values).toFixed(1) : "-";
          const med = values.length ? d3.median(values).toFixed(1) : "-";
          tooltip
            .style("opacity", 1)
            .html(`<strong>${room}</strong><br>Sensor: ${sensor}<br>Avg: ${value.toFixed(2)}<br>Median: ${med}<br>Range: ${min} - ${max}<br>n=${values.length}`);
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
