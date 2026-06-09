/**
 * CircuitBreaker.js
 * Implements a standard SRE Circuit Breaker state machine (CLOSED, OPEN, HALF-OPEN).
 * Protects downstream backend nodes by deflecting traffic during service degradation spikes.
 */

class CircuitBreaker {
  constructor(io, options = {}) {
    this.io = io;
    this.state = "CLOSED"; // CLOSED, OPEN, HALF-OPEN
    
    // Configurable thresholds
    this.failureThreshold = options.failureThreshold || 50;     // % of failures to trip
    this.cooldownPeriod = options.cooldownPeriod || 10000;       // ms to stay in OPEN state
    this.requestVolumeThreshold = options.requestVolumeThreshold || 4; // Min requests to evaluate trip

    // State stats
    this.windowRequests = 0;
    this.windowFailures = 0;
    this.lastTransitionTime = Date.now();
    this.halfOpenProbeCount = 0;
    this.halfOpenSuccesses = 0;
  }

  /**
   * Resets the statistics counters
   */
  resetWindow() {
    this.windowRequests = 0;
    this.windowFailures = 0;
  }

  /**
   * Main proxy interception check.
   * Returns true if request is allowed, false if deflected/blocked.
   */
  allowRequest() {
    const now = Date.now();

    if (this.state === "OPEN") {
      // If cooldown period elapsed, transition to HALF-OPEN to test recovery
      if (now - this.lastTransitionTime >= this.cooldownPeriod) {
        this.transitionTo("HALF-OPEN");
        return true;
      }
      return false; // Deflect request
    }

    if (this.state === "HALF-OPEN") {
      // Limit probe traffic: allow only a subset of requests
      this.halfOpenProbeCount++;
      return this.halfOpenProbeCount % 2 === 0; // block half the traffic for probes
    }

    return true; // CLOSED: allow all traffic
  }

  /**
   * Records a request success event
   */
  recordSuccess() {
    this.windowRequests++;

    if (this.state === "HALF-OPEN") {
      this.halfOpenSuccesses++;
      // If we get 3 consecutive successes, close the circuit (recovered)
      if (this.halfOpenSuccesses >= 3) {
        this.transitionTo("CLOSED");
      }
    }
    this.broadcastState();
  }

  /**
   * Records a request failure event
   */
  recordFailure() {
    this.windowRequests++;
    this.windowFailures++;

    if (this.state === "CLOSED") {
      const failureRate = (this.windowFailures / this.windowRequests) * 100;
      
      // Trip circuit if thresholds exceeded
      if (this.windowRequests >= this.requestVolumeThreshold && failureRate >= this.failureThreshold) {
        this.transitionTo("OPEN");
      }
    } else if (this.state === "HALF-OPEN") {
      // Any failure in HALF-OPEN trips the circuit right back to OPEN
      this.transitionTo("OPEN");
    }
    this.broadcastState();
  }

  /**
   * Transition state machine to targeted state
   * @param {string} newState 
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastTransitionTime = Date.now();
    this.resetWindow();

    if (newState === "HALF-OPEN") {
      this.halfOpenProbeCount = 0;
      this.halfOpenSuccesses = 0;
    }

    console.log(`⚠️ Circuit Breaker state changed: ${oldState} -> ${newState}`);
    this.io.emit("circuit-state-change", {
      state: this.state,
      oldState: oldState,
      timestamp: this.lastTransitionTime
    });
  }

  /**
   * Broadcast state to all connected terminals
   */
  broadcastState() {
    this.io.emit("circuit-stats", {
      state: this.state,
      windowRequests: this.windowRequests,
      windowFailures: this.windowFailures,
      failureRate: this.windowRequests ? Math.round((this.windowFailures / this.windowRequests) * 100) : 0
    });
  }
}

module.exports = CircuitBreaker;
