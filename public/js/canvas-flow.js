/**
 * canvas-flow.js
 * Renders the load balancer traffic flow particle system on HTML5 Canvas.
 * Animates request packets (colored particles) travelling from Client -> Load Balancer -> Server Node
 * and back.
 */

class TrafficFlowVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    
    // Layout anchor coordinates (normalized to canvas boundaries, computed on resize)
    this.layout = {
      client: { x: 0, y: 0, label: "Client Pool" },
      gateway: { x: 0, y: 0, label: "Load Balancer Gateway (8090)" },
      servers: [] // array of { id, x, y, port, status }
    };

    this.particles = []; // list of traveling { startX, startY, endX, endY, progress, speed, color, isResponse, callback }
    
    this.resize();
    this.initEvents();
    this.animate();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    // Recalculate anchors based on new sizes
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.layout.client.x = w * 0.15;
    this.layout.client.y = h * 0.5;

    this.layout.gateway.x = w * 0.5;
    this.layout.gateway.y = h * 0.5;

    // 3 Backend servers stacked vertically on the right
    this.serversPositions = [
      { id: "srv_node_1", x: w * 0.82, y: h * 0.22 },
      { id: "srv_node_2", x: w * 0.82, y: h * 0.50 },
      { id: "srv_node_3", x: w * 0.82, y: h * 0.78 }
    ];
  }

  initEvents() {
    window.addEventListener("resize", () => this.resize());
  }

  /**
   * Syncs server status lists from the backend controller
   * @param {Array} serverList 
   */
  syncServers(serverList) {
    this.layout.servers = this.serversPositions.map(pos => {
      const match = serverList.find(s => s.id === pos.id);
      return {
        ...pos,
        port: match ? match.port : 0,
        status: match ? match.status : "offline",
        weight: match ? match.weight : 1,
        activeConnections: match ? match.activeConnections : 0,
        flashTimer: 0
      };
    });
  }

  /**
   * Spawns a request packet particle travelling Client -> Gateway -> Server
   * @param {Object} logRecord 
   */
  spawnPacket(logRecord) {
    const targetSrv = this.layout.servers.find(s => s.id === logRecord.serverId);
    const color = logRecord.success && logRecord.statusCode < 500 ? "#00f2fe" : "#ff1744";
    
    // Phase 1: Client -> Gateway
    this.particles.push({
      x: this.layout.client.x,
      y: this.layout.client.y,
      startX: this.layout.client.x,
      startY: this.layout.client.y,
      endX: this.layout.gateway.x,
      endY: this.layout.gateway.y,
      progress: 0,
      speed: 0.045,
      color,
      isResponse: false,
      onComplete: () => {
        // Phase 2: Gateway -> Server (only if we reached a server)
        if (targetSrv && targetSrv.status === "online") {
          this.particles.push({
            x: this.layout.gateway.x,
            y: this.layout.gateway.y,
            startX: this.layout.gateway.x,
            startY: this.layout.gateway.y,
            endX: targetSrv.x,
            endY: targetSrv.y,
            progress: 0,
            speed: 0.05,
            color,
            isResponse: false,
            onComplete: () => {
              targetSrv.flashTimer = 10; // Trigger server node flash ripple
              
              // Spawn returning response particle Server -> Gateway -> Client
              this.spawnResponsePacket(targetSrv, color);
            }
          });
        }
      }
    });
  }

  /**
   * Spawns response packet Server -> Gateway -> Client
   */
  spawnResponsePacket(serverNode, color) {
    this.particles.push({
      x: serverNode.x,
      y: serverNode.y,
      startX: serverNode.x,
      startY: serverNode.y,
      endX: this.layout.gateway.x,
      endY: this.layout.gateway.y,
      progress: 0,
      speed: 0.045,
      color,
      isResponse: true,
      onComplete: () => {
        // Phase 4: Gateway -> Client
        this.particles.push({
          x: this.layout.gateway.x,
          y: this.layout.gateway.y,
          startX: this.layout.gateway.x,
          startY: this.layout.gateway.y,
          endX: this.layout.client.x,
          endY: this.layout.client.y,
          progress: 0,
          speed: 0.05,
          color,
          isResponse: true
        });
      }
    });
  }

  update() {
    // Update active particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.progress += p.speed;
      
      // Interpolate coordinates
      p.x = p.startX + (p.endX - p.startX) * p.progress;
      p.y = p.startY + (p.endY - p.startY) * p.progress;

      if (p.progress >= 1.0) {
        if (p.onComplete) p.onComplete();
        this.particles.splice(i, 1);
      }
    }

    // Decay server flashes
    this.layout.servers.forEach(s => {
      if (s.flashTimer > 0) s.flashTimer--;
    });
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawGrid();

    // 1. Draw Network Conduit Lines (Client -> Gateway -> Servers)
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    
    // Line Client to Gateway
    this.ctx.beginPath();
    this.ctx.moveTo(this.layout.client.x, this.layout.client.y);
    this.ctx.lineTo(this.layout.gateway.x, this.layout.gateway.y);
    this.ctx.stroke();

    // Lines from Gateway to Servers
    this.layout.servers.forEach(srv => {
      this.ctx.strokeStyle = srv.status === "online" ? "rgba(255,255,255,0.04)" : "rgba(255, 23, 68, 0.08)";
      this.ctx.beginPath();
      this.ctx.moveTo(this.layout.gateway.x, this.layout.gateway.y);
      this.ctx.lineTo(srv.x, srv.y);
      this.ctx.stroke();
    });

    // 2. Draw Particles (Req/Res packets)
    this.particles.forEach(p => {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = p.color;
      this.ctx.shadowBlur = 8;
      this.ctx.shadowColor = p.color;
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    });

    // 3. Draw Client Node
    const client = this.layout.client;
    this.drawNode(client.x, client.y, 22, "#4facfe", "CLIENT POOL", null);

    // 4. Draw Gateway Node (Load Balancer)
    const gateway = this.layout.gateway;
    this.drawNode(gateway.x, gateway.y, 26, "#00f2fe", "LOAD BALANCER", "GATEWAY");

    // 5. Draw Backend Server Nodes
    this.layout.servers.forEach(srv => {
      const color = srv.status === "online" ? "#00e676" : "#ff1744";
      
      // Flash animation ripple if hit
      if (srv.flashTimer > 0) {
        this.ctx.beginPath();
        this.ctx.arc(srv.x, srv.y, 20 + (10 - srv.flashTimer) * 2, 0, Math.PI * 2);
        this.ctx.strokeStyle = `rgba(0, 230, 118, ${srv.flashTimer / 10})`;
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
      }

      this.drawNode(
        srv.x, 
        srv.y, 
        22, 
        color, 
        srv.id.replace("srv_", "").toUpperCase(), 
        `:${srv.port} (${srv.status.toUpperCase()})`
      );
    });
  }

  drawGrid() {
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
    this.ctx.lineWidth = 1;
    const spacing = 30;
    for (let x = 0; x < this.canvas.width; x += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
  }

  drawNode(x, y, radius, color, label, sublabel) {
    // Outer glass circle ring
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
    this.ctx.fillStyle = "rgba(10, 18, 32, 0.8)";
    this.ctx.strokeStyle = `rgba(${this.hexToRgb(color)}, 0.35)`;
    this.ctx.lineWidth = 1.5;
    this.ctx.fill();
    this.ctx.stroke();

    // Inner glowing core
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(${this.hexToRgb(color)}, 0.15)`;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.fill();
    this.ctx.stroke();

    // Core point dot
    this.ctx.beginPath();
    this.ctx.arc(x, y, 4, 0, Math.PI * 2);
    this.ctx.fillStyle = color;
    this.ctx.fill();

    // Node labels
    this.ctx.font = "bold 9px Outfit";
    this.ctx.fillStyle = "#ffffff";
    this.ctx.textAlign = "center";
    this.ctx.fillText(label, x, y - radius - 10);

    if (sublabel) {
      this.ctx.font = "8px JetBrains Mono";
      this.ctx.fillStyle = "var(--text-muted)";
      this.ctx.fillText(sublabel, x, y + radius + 14);
    }
  }

  // Helper to convert hex strings to rgb components for alphas
  hexToRgb(hex) {
    const bigint = parseInt(hex.replace("#", ""), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
  }

  animate() {
    this.update();
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
}

window.TrafficFlowVisualizer = TrafficFlowVisualizer;
