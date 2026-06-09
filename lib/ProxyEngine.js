/**
 * ProxyEngine.js
 * Implements HTTP reverse proxy forwarding and load balancing logic:
 * 1. Round-Robin routing
 * 2. Weighted Round-Robin routing
 * 3. Least Connections routing
 * 4. IP Hash routing (session stickiness)
 */

const http = require("http");

class ProxyEngine {
  constructor(serverManager) {
    this.serverManager = serverManager;
    this.rrIndex = 0;      // Pointer for Round-Robin
    this.wrrIndex = 0;     // Pointer for Weighted Round-Robin
  }

  /**
   * Selects an online server based on the chosen algorithm
   * @param {string} algorithm 'round-robin' | 'weighted-round-robin' | 'least-connections' | 'ip-hash'
   * @param {string} clientIp Client IP address for IP Hash
   * @returns {Object|null} Selected server object
   */
  selectServer(algorithm, clientIp) {
    const onlineServers = this.serverManager.getOnlineServers();
    if (onlineServers.length === 0) return null;

    switch (algorithm) {
      case "round-robin":
        return this.getRoundRobin(onlineServers);
      case "weighted-round-robin":
        return this.getWeightedRoundRobin(onlineServers);
      case "least-connections":
        return this.getLeastConnections(onlineServers);
      case "ip-hash":
        return this.getIpHash(onlineServers, clientIp);
      default:
        return this.getRoundRobin(onlineServers);
    }
  }

  /**
   * Standard Round-Robin
   */
  getRoundRobin(servers) {
    const server = servers[this.rrIndex % servers.length];
    this.rrIndex = (this.rrIndex + 1) % servers.length;
    return server;
  }

  /**
   * Weighted Round-Robin using choice expansion
   */
  getWeightedRoundRobin(servers) {
    // Build an array list where servers are duplicated based on their weight
    const pool = [];
    servers.forEach(srv => {
      for (let i = 0; i < srv.weight; i++) {
        pool.push(srv);
      }
    });

    if (pool.length === 0) return servers[0];
    
    const server = pool[this.wrrIndex % pool.length];
    this.wrrIndex = (this.wrrIndex + 1) % pool.length;
    return server;
  }

  /**
   * Least Connections
   */
  getLeastConnections(servers) {
    let selected = servers[0];
    for (let i = 1; i < servers.length; i++) {
      if (servers[i].activeConnections < selected.activeConnections) {
        selected = servers[i];
      }
    }
    return selected;
  }

  /**
   * IP Hash based session stickiness
   */
  getIpHash(servers, clientIp) {
    if (!clientIp) return this.getRoundRobin(servers);

    // Simple hash algorithm
    let hash = 0;
    for (let i = 0; i < clientIp.length; i++) {
      hash = clientIp.charCodeAt(i) + ((hash << 5) - hash);
    }

    const index = Math.abs(hash) % servers.length;
    return servers[index];
  }

  /**
   * Forwards client request to targeted backend server with proxy headers and failover handlers
   * @param {http.IncomingMessage} clientReq 
   * @param {http.ServerResponse} clientRes 
   * @param {Object} targetServer 
   * @param {Function} onFailover Called if connection to target node fails, triggers re-routing
   */
  forward(clientReq, clientRes, targetServer, onFailover) {
    // Track client IP
    const clientIp = clientReq.headers["x-forwarded-for"] || clientReq.socket.remoteAddress;

    // Build headers with proxy details
    const headers = { ...clientReq.headers };
    headers["x-forwarded-for"] = clientIp;
    headers["x-forwarded-host"] = clientReq.headers["host"];
    headers["x-forwarded-proto"] = clientReq.socket.encrypted ? "https" : "http";
    headers["x-proxy-agent"] = "Node-LoadBalancer-Lab";

    const proxyOptions = {
      hostname: "127.0.0.1", // local loopback
      port: targetServer.port,
      path: clientReq.url,
      method: clientReq.method,
      headers: headers,
      timeout: 3000 // 3-second timeout for failover trigger
    };

    // Increment server active connections
    const serverRef = this.serverManager.servers.find(s => s.id === targetServer.id);
    if (serverRef) {
      serverRef.activeConnections++;
    }

    const proxyReq = http.request(proxyOptions, (proxyRes) => {
      // Decrement connection on response
      if (serverRef) {
        serverRef.activeConnections = Math.max(0, serverRef.activeConnections - 1);
      }

      // Copy response details
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      
      // Pipe response stream to client
      proxyRes.pipe(clientRes);
    });

    // Handle proxy timeout
    proxyReq.on("timeout", () => {
      proxyReq.destroy();
    });

    // Handle connection failures (e.g. ECONNREFUSED) to trigger transparent failover routing
    proxyReq.on("error", (err) => {
      if (serverRef) {
        serverRef.activeConnections = Math.max(0, serverRef.activeConnections - 1);
      }
      console.warn(`⚠️ Proxy failed to forward to ${targetServer.id} (${err.code}). Triggering failover...`);
      
      // Execute failover callback
      onFailover(err);
    });

    // Pipe client request body (e.g., POST data) into the proxy request
    clientReq.pipe(proxyReq);
  }
}

module.exports = ProxyEngine;
