/**
 * server.js
 * Main Gateway Hub and HTTP Proxy.
 * 1. Hosts SRE Dashboard and Control APIs on Port 8000.
 * 2. Hosts HTTP Reverse Proxy Gateway on Port 8080.
 * 3. Integrates Socket.io to stream real-time SRE metrics, circuit states, and packet traces.
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");

// Core Engines
const ServerManager = require("./lib/ServerManager");
const ProxyEngine = require("./lib/ProxyEngine");
const CircuitBreaker = require("./lib/CircuitBreaker");

dotenv.config();

// --- 1. Dashboard UI Server (Port 8000) ---
const app = express();
const dashboardServer = http.createServer(app);
const io = new Server(dashboardServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const DASHBOARD_PORT = process.env.PORT || 8000;
const PROXY_PORT = process.env.PROXY_PORT || 8090;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// State Variables
let currentAlgorithm = "round-robin";
const historyLogs = [];

// Initialize Systems
const serverPool = new ServerManager(io);
const proxyEngine = new ProxyEngine(serverPool);
const circuit = new CircuitBreaker(io, {
  failureThreshold: 50,
  cooldownPeriod: 8000,
  requestVolumeThreshold: 4
});

// Boot backend servers
serverPool.startAll();

// Summarize history metrics for Chart.js
function getTelemetrySummary() {
  const windowLogs = historyLogs.slice(-15); // last 15 queries
  const totals = {
    totalRequests: historyLogs.length,
    successRequests: historyLogs.filter(h => h.success).length,
    failedRequests: historyLogs.filter(h => !h.success).length,
    avgLatency: historyLogs.length ? Math.round(historyLogs.reduce((acc, h) => acc + h.latency, 0) / historyLogs.length) : 0
  };

  return {
    totals,
    recent: windowLogs
  };
}

// Get system state API
app.get("/api/control/state", (req, res) => {
  res.json({
    algorithm: currentAlgorithm,
    servers: serverPool.getServerStatuses(),
    circuit: {
      state: circuit.state,
      failureRate: circuit.windowRequests ? Math.round((circuit.windowFailures / circuit.windowRequests) * 100) : 0
    },
    latency: serverPool.globalLatency,
    failureRate: serverPool.failureRate,
    summary: getTelemetrySummary()
  });
});

// Update load balancing algorithm API
app.post("/api/control/algorithm", (req, res) => {
  const { algorithm } = req.body;
  if (["round-robin", "weighted-round-robin", "least-connections", "ip-hash"].includes(algorithm)) {
    currentAlgorithm = algorithm;
    io.emit("algorithm-change", currentAlgorithm);
    return res.json({ success: true, algorithm: currentAlgorithm });
  }
  res.status(400).json({ error: "Invalid algorithm" });
});

// Chaos Injectors: Server Crashes / Recovers
app.post("/api/control/node", (req, res) => {
  const { serverId, action, weight } = req.body;
  
  if (action === "crash") {
    serverPool.crash(serverId);
    return res.json({ success: true, status: "offline" });
  } else if (action === "recover") {
    serverPool.recover(serverId);
    return res.json({ success: true, status: "online" });
  } else if (action === "weight" && weight !== undefined) {
    serverPool.setWeight(serverId, weight);
    return res.json({ success: true, weight: weight });
  }

  res.status(400).json({ error: "Invalid action" });
});

// Chaos Injectors: Latency / Error Rates
app.post("/api/control/chaos", (req, res) => {
  const { latency, failureRate } = req.body;

  if (latency !== undefined) {
    serverPool.globalLatency = Math.max(0, parseInt(latency) || 0);
  }
  if (failureRate !== undefined) {
    serverPool.failureRate = Math.max(0, Math.min(100, parseInt(failureRate) || 0));
  }

  io.emit("chaos-update", {
    latency: serverPool.globalLatency,
    failureRate: serverPool.failureRate
  });

  res.json({ success: true, latency: serverPool.globalLatency, failureRate: serverPool.failureRate });
});

// Clean logs API
app.post("/api/control/clear", (req, res) => {
  historyLogs.length = 0;
  circuit.resetWindow();
  io.emit("logs-cleared");
  res.json({ success: true });
});

// Trigger dynamic request internally to Port 8080 (Proxy Gateway)
app.get("/api/control/trigger-request", (req, res) => {
  const options = {
    hostname: "127.0.0.1",
    port: PROXY_PORT,
    path: `/api/data/mock?t=${Date.now()}`,
    method: "GET",
    headers: {
      "x-forwarded-for": req.socket.remoteAddress
    }
  };

  const internalReq = http.request(options, (internalRes) => {
    let body = "";
    internalRes.on("data", (chunk) => body += chunk);
    internalRes.on("end", () => {
      res.json({ success: true, statusCode: internalRes.statusCode });
    });
  });

  internalReq.on("error", (err) => {
    res.json({ success: false, error: err.message });
  });

  internalReq.end();
});

// --- 2. HTTP Reverse Proxy Gateway Server (Port 8080) ---
const proxyGateway = http.createServer((req, res) => {
  const startTime = Date.now();
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // Track request metrics helper
  const finalizeLog = (targetServer, success, statusCode, errorMsg = "") => {
    const latency = Date.now() - startTime;
    
    // Record in circuit breaker
    if (success && statusCode < 500) {
      circuit.recordSuccess();
    } else {
      circuit.recordFailure();
    }

    const logRecord = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method,
      clientIp,
      algorithm: currentAlgorithm,
      serverId: targetServer ? targetServer.id : "none",
      port: targetServer ? targetServer.port : 0,
      statusCode,
      latency,
      success,
      circuitState: circuit.state,
      error: errorMsg
    };

    historyLogs.push(logRecord);

    // Emit live routed request data to SRE Dashboard
    io.emit("request-routed", {
      record: logRecord,
      summary: getTelemetrySummary(),
      servers: serverPool.getServerStatuses()
    });
  };

  // 1. Check Circuit Breaker status
  if (!circuit.allowRequest()) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "error",
      error: "Service Unavailable",
      message: "Circuit breaker is open. Traffic deflected locally to protect backend nodes."
    }));
    finalizeLog(null, false, 503, "Circuit Breaker open deflection");
    return;
  }

  // 2. Select backend server based on current algorithm
  const targetServer = proxyEngine.selectServer(currentAlgorithm, clientIp);

  if (!targetServer) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "error",
      error: "Bad Gateway",
      message: "No healthy upstream backend nodes available in server pool."
    }));
    finalizeLog(null, false, 502, "No upstream servers available");
    return;
  }

  // 3. Forward the request to the targeted server with failover logic
  const attemptForward = (serverNode, attemptsLeft) => {
    proxyEngine.forward(req, res, serverNode, (err) => {
      // If server failed (e.g. socket ECONNREFUSED)
      if (attemptsLeft > 0) {
        // Remove failed server dynamically from online count for this search
        const remainingServers = serverPool.getOnlineServers().filter(s => s.id !== serverNode.id);
        
        if (remainingServers.length > 0) {
          const fallbackServer = proxyEngine.selectServer(currentAlgorithm, clientIp);
          if (fallbackServer && fallbackServer.id !== serverNode.id) {
            console.log(`♻️ Retrying failover proxy to ${fallbackServer.id}...`);
            attemptForward(fallbackServer, attemptsLeft - 1);
            return;
          }
        }
      }

      // No failovers left: return 504 Gateway Timeout
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "error",
        error: "Gateway Timeout",
        message: `Failed to connect upstream server ${serverNode.id} on port ${serverNode.port}.`
      }));
      finalizeLog(serverNode, false, 504, err.code || "Gateway Timeout");
    });
  };

  // Allow up to 2 proxy redirection attempts
  attemptForward(targetServer, 2);

  // Monitor response finish to record successes (if proxy completes successfully)
  res.on("finish", () => {
    // Only record if we haven't already finalized it due to connection error
    if (res.statusCode < 500) {
      finalizeLog(targetServer, true, res.statusCode);
    } else {
      finalizeLog(targetServer, false, res.statusCode, `Status Code: ${res.statusCode}`);
    }
  });
});

// --- Socket.io Management Hub ---
io.on("connection", (socket) => {
  console.log(`Dashboard client connected: ${socket.id}`);

  // Send initial system state
  socket.emit("init-state", {
    algorithm: currentAlgorithm,
    servers: serverPool.getServerStatuses(),
    circuit: {
      state: circuit.state,
      failureRate: circuit.windowRequests ? Math.round((circuit.windowFailures / circuit.windowRequests) * 100) : 0
    },
    latency: serverPool.globalLatency,
    failureRate: serverPool.failureRate,
    history: historyLogs,
    historySummary: getTelemetrySummary()
  });

  socket.on("disconnect", () => {
    console.log(`Dashboard client disconnected: ${socket.id}`);
  });
});

// Boot Dashboard Server
dashboardServer.listen(DASHBOARD_PORT, () => {
  console.log(`\n🖥️  SRE Management Panel running at http://localhost:${DASHBOARD_PORT}`);
});

// Boot Reverse Proxy Gateway
proxyGateway.listen(PROXY_PORT, () => {
  console.log(`⚡ HTTP Reverse Proxy Gateway active on port ${PROXY_PORT}`);
  console.log(`👉 Route real queries to: http://localhost:${PROXY_PORT}/\n`);
});

// Graceful Shutdown
process.on("SIGTERM", () => {
  serverPool.stopAll();
  process.exit(0);
});
process.on("SIGINT", () => {
  serverPool.stopAll();
  process.exit(0);
});
