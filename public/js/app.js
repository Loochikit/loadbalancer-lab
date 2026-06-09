/**
 * app.js
 * Main client dashboard orchestrator.
 * Handles socket pings, SRE API clicks, and client-side traffic generator loops.
 */

document.addEventListener("DOMContentLoaded", () => {
  const socket = io();

  // Initialize Modules
  const visualizer = new TrafficFlowVisualizer("vectorCanvas");
  const charts = new TelemetryCharts();

  // State
  let trafficInterval = null;
  let isGeneratingTraffic = false;

  // DOM Elements
  const selectAlgo = document.getElementById("selectAlgo");
  const serverListContainer = document.getElementById("serversList");
  
  // Chaos Controls
  const rangeLatency = document.getElementById("rangeLatency");
  const rangeFailures = document.getElementById("rangeFailures");
  const valLatency = document.getElementById("valLatency");
  const valFailures = document.getElementById("valFailures");
  const btnResetLogs = document.getElementById("btnResetLogs");

  // Traffic Generator
  const btnTraffic = document.getElementById("btnTraffic");
  const rpsSelect = document.getElementById("rpsSelect");

  // Circuit Breaker State Panel
  const circuitStateText = document.getElementById("circuitStateText");
  const valFailureRateWindow = document.getElementById("valFailureRateWindow");

  // Telemetry Stats Header
  const valTotalRequests = document.getElementById("valTotalRequests");
  const valAvgLatency = document.getElementById("valAvgLatency");
  const valTotalCost = document.getElementById("valTotalCost"); // we'll use this for error counts

  // Log List
  const auditList = document.getElementById("auditList");

  // --- Socket.io Listeners ---

  socket.on("init-state", (state) => {
    console.log("Initial load state:", state);
    selectAlgo.value = state.algorithm;
    rangeLatency.value = state.latency;
    valLatency.textContent = `${state.latency}ms`;
    rangeFailures.value = state.failureRate;
    valFailures.textContent = `${state.failureRate}%`;

    updateCircuitState(state.circuit);
    visualizer.syncServers(state.servers);
    renderServerItems(state.servers);
    updateMetricsSummary(state.historySummary);
    renderAuditLogs(state.history);
    charts.update(state.historySummary.recent);
  });

  socket.on("algorithm-change", (algo) => {
    selectAlgo.value = algo;
  });

  socket.on("server-status-change", () => {
    fetchState();
  });

  socket.on("server-weight-change", () => {
    fetchState();
  });

  socket.on("circuit-state-change", (data) => {
    circuitStateText.textContent = data.state;
    circuitStateText.className = `circuit-state ${data.state}`;
  });

  socket.on("circuit-stats", (data) => {
    circuitStateText.textContent = data.state;
    circuitStateText.className = `circuit-state ${data.state}`;
    valFailureRateWindow.textContent = `${data.failureRate}%`;
  });

  socket.on("chaos-update", (data) => {
    rangeLatency.value = data.latency;
    valLatency.textContent = `${data.latency}ms`;
    rangeFailures.value = data.failureRate;
    valFailures.textContent = `${data.failureRate}%`;
  });

  // Fired whenever a request is proxied through the Load Balancer gateway
  socket.on("request-routed", (data) => {
    visualizer.syncServers(data.servers);
    renderServerItems(data.servers);

    // Trigger canvas particle animation trace
    visualizer.spawnPacket(data.record);

    updateMetricsSummary(data.summary);
    renderAuditLogs(data.summary.recent);
    charts.update(data.summary.recent);
  });

  socket.on("logs-cleared", () => {
    auditList.innerHTML = `<div style="color: var(--text-dark); text-align: center; margin-top: 1rem;">No queries recorded</div>`;
    valTotalRequests.textContent = "0";
    valAvgLatency.textContent = "0 ms";
    valTotalCost.textContent = "0";
    charts.update([]);
  });

  // Helper to fetch latest state
  async function fetchState() {
    try {
      const res = await fetch("/api/control/state");
      const data = await res.json();
      visualizer.syncServers(data.servers);
      renderServerItems(data.servers);
      updateCircuitState(data.circuit);
    } catch (err) {
      console.error("Failed to fetch state:", err);
    }
  }

  // --- API Interaction Handlers ---

  // Algorithm change
  selectAlgo.addEventListener("change", async () => {
    await fetch("/api/control/algorithm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ algorithm: selectAlgo.value })
    });
  });

  // Latency slider change
  rangeLatency.addEventListener("input", () => {
    valLatency.textContent = `${rangeLatency.value}ms`;
  });
  rangeLatency.addEventListener("change", async () => {
    await fetch("/api/control/chaos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latency: parseInt(rangeLatency.value) })
    });
  });

  // Failure rate slider change
  rangeFailures.addEventListener("input", () => {
    valFailures.textContent = `${rangeFailures.value}%`;
  });
  rangeFailures.addEventListener("change", async () => {
    await fetch("/api/control/chaos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ failureRate: parseInt(rangeFailures.value) })
    });
  });

  // Clear log data
  btnResetLogs.addEventListener("click", async () => {
    await fetch("/api/control/clear", { method: "POST" });
  });

  // --- Client-Side Traffic Generator Loop ---
  // Pings the Load Balancer gateway at Port 8080 (which is open locally)
  btnTraffic.addEventListener("click", () => {
    if (isGeneratingTraffic) {
      // Stop loop
      clearInterval(trafficInterval);
      isGeneratingTraffic = false;
      btnTraffic.textContent = "⚡ Start Traffic Generator";
      btnTraffic.className = "";
    } else {
      // Start loop
      const rps = parseInt(rpsSelect.value) || 2;
      const msDelay = 1000 / rps;

      isGeneratingTraffic = true;
      btnTraffic.textContent = "🛑 Stop Traffic Generator";
      btnTraffic.className = "danger";

      trafficInterval = setInterval(async () => {
        try {
          // Trigger the request internally via the control API,
          // enabling the generator to run on deployed Render instances.
          await fetch(`/api/control/trigger-request?t=${Date.now()}`);
        } catch (err) {
          // Ignore connection errors
        }
      }, msDelay);
    }
  });

  // --- Rendering UI Helpers ---

  function updateCircuitState(circuitState) {
    circuitStateText.textContent = circuitState.state;
    circuitStateText.className = `circuit-state ${circuitState.state}`;
  }

  function updateMetricsSummary(summary) {
    valTotalRequests.textContent = summary.totals.totalRequests;
    valAvgLatency.textContent = `${summary.totals.avgLatency} ms`;
    valTotalCost.textContent = summary.totals.failedRequests; // cost label is used for Failures count
  }

  function renderServerItems(servers) {
    serverListContainer.innerHTML = "";
    
    servers.forEach(srv => {
      const item = document.createElement("div");
      item.className = `server-item ${srv.status === "offline" ? "offline" : ""}`;
      
      const isOnline = srv.status === "online";
      const btnClass = isOnline ? "danger" : "success";
      const btnLabel = isOnline ? "Crash" : "Recover";
      const actionParam = isOnline ? "crash" : "recover";

      item.innerHTML = `
        <div class="server-header">
          <div class="server-id">
            <span class="server-dot"></span>
            <span>${srv.id.replace("srv_", "").toUpperCase()}</span>
            <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: normal;">(Port ${srv.port})</span>
          </div>
          <button class="${btnClass}" style="padding: 0.2rem 0.5rem; font-size: 0.65rem; width: auto;" data-id="${srv.id}" data-action="${actionParam}">
            ${btnLabel}
          </button>
        </div>
        <div class="server-stats">
          <div>Conns: <strong style="color: var(--accent-cyan);">${srv.activeConnections}</strong></div>
          <div>Requests: <strong>${srv.requestCount}</strong></div>
        </div>
        <div class="server-controls">
          <label style="font-size: 0.65rem; color: var(--text-muted);">Capacity Weight:</label>
          <input type="text" value="${srv.weight}" data-id="${srv.id}" class="input-srv-weight">
          <button class="secondary" style="padding: 0.2rem 0.4rem; font-size: 0.65rem; width: auto;" data-id="${srv.id}" data-action="weight">Save</button>
        </div>
      `;

      // Event: Crash/Recover
      item.querySelector(`button[data-id="${srv.id}"]:not(.secondary)`).addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        const action = e.target.getAttribute("data-action");
        
        await fetch("/api/control/node", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: id, action })
        });
      });

      // Event: Weight Update
      item.querySelector(`button[data-action="weight"]`).addEventListener("click", async (e) => {
        const id = e.target.getAttribute("data-id");
        const input = item.querySelector(`.input-srv-weight`);
        const weight = parseInt(input.value) || 1;

        await fetch("/api/control/node", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: id, action: "weight", weight })
        });
      });

      serverListContainer.appendChild(item);
    });
  }

  function renderAuditLogs(history) {
    auditList.innerHTML = "";
    if (!history || history.length === 0) {
      auditList.innerHTML = `<div style="color: var(--text-dark); text-align: center; margin-top: 1rem;">No queries recorded</div>`;
      return;
    }

    // reverse chronological order
    history.slice().reverse().forEach(log => {
      const item = document.createElement("div");
      item.className = "audit-item";

      const time = new Date(log.timestamp).toLocaleTimeString();
      const isOk = log.success && log.statusCode < 500;
      const badgeClass = isOk ? "success" : (log.statusCode === 503 ? "warning" : "error");

      item.innerHTML = `
        <div class="audit-header">
          <span class="audit-path">${log.method} ${log.url.split('?')[0]}</span>
          <span class="status-badge-http ${badgeClass}">${log.statusCode}</span>
        </div>
        <div class="audit-header" style="color: var(--text-muted); font-size: 0.65rem;">
          <span>${log.serverId.toUpperCase()} | ${log.latency}ms</span>
          <span>${time}</span>
        </div>
      `;

      auditList.appendChild(item);
    });
  }
});
