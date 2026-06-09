/**
 * ServerManager.js
 * Spawns and manages a pool of real HTTP servers listening on ports 8001-8003.
 * Supports weight settings, request latency injection, connection tracking,
 * and socket closures to simulate physical server crashes.
 */

const http = require("http");

class ServerManager {
  constructor(io) {
    this.io = io;
    this.servers = [
      { id: "srv_node_1", port: 8001, status: "online", activeConnections: 0, weight: 1, requestCount: 0, instance: null, connectionsMap: new Set() },
      { id: "srv_node_2", port: 8002, status: "online", activeConnections: 0, weight: 2, requestCount: 0, instance: null, connectionsMap: new Set() },
      { id: "srv_node_3", port: 8003, status: "online", activeConnections: 0, weight: 4, requestCount: 0, instance: null, connectionsMap: new Set() }
    ];
    this.globalLatency = 0; // ms to inject
    this.failureRate = 0;    // % probability of returning 500 errors
  }

  /**
   * Initializes all servers and starts listening on ports
   */
  startAll() {
    this.servers.forEach(srv => {
      this.bootServer(srv);
    });
  }

  /**
   * Shuts down all servers on exit
   */
  stopAll() {
    this.servers.forEach(srv => {
      this.crash(srv.id);
    });
  }

  /**
   * Boots up a single HTTP server instance on its configured port
   */
  bootServer(srv) {
    if (srv.instance) return;

    const server = http.createServer((req, res) => {
      srv.activeConnections++;
      srv.requestCount++;
      
      // Track connection socket to close dynamically if crashed
      srv.connectionsMap.add(req.socket);
      req.socket.on("close", () => {
        srv.connectionsMap.delete(req.socket);
      });

      // Notify frontend client dashboard of active request
      this.io.emit("server-request", { serverId: srv.id, url: req.url });

      const handleResponse = () => {
        srv.activeConnections = Math.max(0, srv.activeConnections - 1);
        
        // Dynamic error injection (Chaos Engineering)
        if (Math.random() * 100 < this.failureRate) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            serverId: srv.id,
            port: srv.port,
            status: "error",
            error: "Internal Server Error (Chaos Injector)"
          }));
          return;
        }

        res.writeHead(200, { 
          "Content-Type": "application/json",
          "X-Backend-Server": srv.id
        });
        res.end(JSON.stringify({
          serverId: srv.id,
          port: srv.port,
          status: "success",
          message: `Response served successfully by ${srv.id}`,
          requestIndex: srv.requestCount,
          weight: srv.weight,
          timestamp: new Date().toISOString()
        }));
      };

      // Latency Injection (Chaos Engineering)
      if (this.globalLatency > 0) {
        setTimeout(handleResponse, this.globalLatency);
      } else {
        handleResponse();
      }
    });

    server.listen(srv.port, () => {
      srv.status = "online";
      srv.instance = server;
      console.log(`📡 Backend Server ${srv.id} listening on port ${srv.port}`);
      this.io.emit("server-status-change", { serverId: srv.id, status: "online" });
    });

    server.on("error", (err) => {
      console.error(`Error on server ${srv.id}:`, err.message);
      srv.status = "offline";
      srv.instance = null;
      this.io.emit("server-status-change", { serverId: srv.id, status: "offline" });
    });
  }

  /**
   * Crashes a server by closing its listener port and destroying active socket connections
   * @param {string} id 
   */
  crash(id) {
    const srv = this.servers.find(s => s.id === id);
    if (!srv || !srv.instance) return;

    srv.status = "offline";
    
    // Destroy all active socket connections immediately to simulate hard crash
    srv.connectionsMap.forEach(socket => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
    srv.connectionsMap.clear();

    srv.instance.close(() => {
      console.log(`💥 Backend Server ${srv.id} crashed (port ${srv.port} closed)`);
    });
    
    srv.instance = null;
    srv.activeConnections = 0;
    this.io.emit("server-status-change", { serverId: srv.id, status: "offline" });
  }

  /**
   * Recovers/restarts a crashed server node
   * @param {string} id 
   */
  recover(id) {
    const srv = this.servers.find(s => s.id === id);
    if (!srv || srv.instance) return;

    console.log(`♻️ Restarting Backend Server ${srv.id}...`);
    this.bootServer(srv);
  }

  /**
   * Sets server capacity weight dynamically
   */
  setWeight(id, weight) {
    const srv = this.servers.find(s => s.id === id);
    if (srv) {
      srv.weight = Math.max(1, parseInt(weight) || 1);
      this.io.emit("server-weight-change", { serverId: srv.id, weight: srv.weight });
    }
  }

  /**
   * Returns list of currently online servers
   */
  getOnlineServers() {
    return this.servers.filter(s => s.status === "online");
  }

  /**
   * Returns state details of all servers
   */
  getServerStatuses() {
    return this.servers.map(s => ({
      id: s.id,
      port: s.port,
      status: s.status,
      activeConnections: s.activeConnections,
      weight: s.weight,
      requestCount: s.requestCount
    }));
  }
}

module.exports = ServerManager;
