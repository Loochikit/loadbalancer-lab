# ⚖️ LoadBalancer-Lab // Reverse Proxy & Chaos Engineering Simulator

**LoadBalancer-Lab** is an interactive, zero-dependency full-stack HTTP reverse proxy load balancer and SRE reliability testing console. 

Written natively in Node.js, the system boots up a pool of **real HTTP backend servers** (listening on ports `8001-8003`) and exposes a **Reverse Proxy Gateway** (listening on port `8090`) that handles, load balances, and routes real HTTP connections. 

Through the SRE Control Panel (listening on port `8000`), developers can dynamically inject network latency, crash backend servers, manipulate routing weights, and trigger circuit breakers to observe distributed resilience in real time.

[![Deploy to Render](https://render.com/images/deploy-to-render.svg)](https://render.com)

---

## 🚀 Key Engineering Concepts Demonstrated

### 1. HTTP Reverse Proxy Forwarding
- Parses and rewrites HTTP client request headers natively (`X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`).
- Pipes stream payloads (e.g., standard GET request hashes or POST data streams) from proxy socket interfaces to destination servers, and pipes responses back to the client.

### 2. Network Routing Algorithms
- **Round-Robin**: Standard sequential distribution.
- **Weighted Round-Robin**: Routes traffic proportionately based on server capacity weights (e.g., Server A receives 4x more traffic than Server B).
- **Least Connections**: Evaluates server connection counts to route traffic to the server with the lowest concurrent requests load.
- **IP Hashing**: Hashes client IP addresses modulo active servers to maintain sticky sessions (client-to-server affinity).

### 3. SRE Circuit Breaker State Machine
- Intercepts proxy routes and protects backend pools from cascading failure spikes:
  - **CLOSED**: Normal operations. Traffic passes through.
  - **OPEN**: If failures exceed 50% in a 4-request window, the breaker trips, deflecting all traffic immediately with a fast-failing `HTTP 503 Service Unavailable` response.
  - **HALF-OPEN**: After an 8-second cooldown, passes a single trickle of probe traffic. If it succeeds, the circuit closes; if it fails, it returns to the open state.

### 4. Active Health Checks & Transparent Failover
- If a server socket connection fails during a request (e.g., connection reset or connection refused `ECONNREFUSED` because a node was crashed), the proxy gateway intercepts the exception and automatically reroutes the request to another healthy node.

### 5. High-Fidelity Network Flow visualizer
- A native HTML5 Canvas rendering loop scales for high DPI displays and animates request/response packets as colored particles travelling between Client Pool, Load Balancer, and Server Nodes.

---

## 🛠️ Tech Stack & Architecture

- **Backend**: Node.js, Express, Socket.io (WebSocket streaming traces), native http (proxy socket router).
- **Frontend**: Semantic HTML5, Vanilla CSS3 (Custom Glassmorphism, CSS variables, micro-interactions), HTML5 Canvas 2D API (particle flow physics), Chart.js (Observability graphs).

---

## 📂 Project Structure

```
loadbalancer-lab/
├── README.md               # GitHub Documentation
├── package.json            # Node.js configurations and dependencies
├── server.js               # Express dashboard server (8000) & HTTP proxy gateway (8090)
├── Dockerfile              # Docker container configuration
├── render.yaml             # Render Blueprint for 1-click deployments
├── lib/
│   ├── ServerManager.js    # Spawns mock HTTP servers on ports 8001-8003
│   ├── ProxyEngine.js      # Load balancing selectors and HTTP forwarders
│   └── CircuitBreaker.js   # Closed/Open/Half-Open state machine
└── public/
    ├── index.html          # Semantic dashboard portal
    ├── css/
    │   └── styles.css      # Neon glassmorphism stylesheet
    └── js/
        ├── app.js          # Controller & WebSocket connector
        ├── canvas-flow.js  # HTML5 Canvas visual packet tracer
        └── charts.js       # Chart.js telemetry charts
```

---

## 💻 Local Setup & Execution

### Prerequisites
Make sure you have Node.js (v18+) installed.

### 1. Install Dependencies
Navigate to the directory and install Express and Socket.io:
```bash
cd loadbalancer-lab
npm install
```

### 2. Run the Server
Start the development server:
```bash
npm start
```
*The SRE dashboard will listen on port **8000**, and the Reverse Proxy will listen on port **8090**.*

### 3. Open the SRE Dashboard
Open your browser and navigate to:
👉 **`http://localhost:8000`**

### 4. Route Real Traffic
Send requests to the proxy port (`8090`) using curl, postman, or your browser:
```bash
curl http://localhost:8090/api/users
```
Watch the request animate as a particle on the dashboard in real time! You can also click **"Start Traffic Generator"** on the dashboard to trigger automatic requests.

---

## ☣️ Chaos Engineering Scenarios (How to test)

1. **Active Node Failover**: Click **"Crash"** on Server 1 (port 8001) while sending requests. Watch the node turn red. Make a request: the balancer will detect port 8001 is closed, automatically reroute the request to Server 2 or 3, and ensure the user gets a successful response.
2. **Circuit Breaker Tripping**: Slide **"Inject Mock Failure Rate"** to 100% and start the traffic generator. Watch requests fail. After 4 failures, the Circuit Breaker trips to **OPEN** (red glow). Any subsequent requests will be deflected immediately with an HTTP 503 response. Slide the failure rate back to 0% and watch the circuit transition to **HALF-OPEN** (orange) and finally recover to **CLOSED** (green) once it verifies successful probe requests.
3. **Capacity Routing**: Set Server 1 capacity weight to `1` and Server 3 capacity weight to `4`. Select **Weighted Round-Robin** and start the traffic generator. Watch 4 times more particles flow to Server 3 than Server 1.
