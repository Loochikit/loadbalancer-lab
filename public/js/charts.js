/**
 * charts.js
 * Configures and updates Chart.js instances for Load Balancer telemetry.
 */

class TelemetryCharts {
  constructor() {
    this.latencyChart = null;
    this.errorChart = null;

    this.initCharts();
  }

  initCharts() {
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#8492a6", font: { size: 8 } }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: { color: "#8492a6", font: { size: 8 } }
        }
      }
    };

    // 1. Latency Chart (Line)
    const ctxLatency = document.getElementById("latencyChart").getContext("2d");
    this.latencyChart = new Chart(ctxLatency, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: "#00f2fe",
          backgroundColor: "rgba(0, 242, 254, 0.05)",
          fill: true,
          tension: 0.3,
          borderWidth: 1.5
        }]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            title: { display: true, text: "Latency (ms)", color: "#8492a6", font: { size: 8 } }
          }
        }
      }
    });

    // 2. Error Rate Chart (Line)
    const ctxError = document.getElementById("scoreChart").getContext("2d"); // using the existing element name "scoreChart" from styles/index
    this.errorChart = new Chart(ctxError, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: "#ff1744",
          backgroundColor: "rgba(255, 23, 68, 0.05)",
          fill: true,
          tension: 0.3,
          borderWidth: 1.5
        }]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            min: 0,
            max: 100,
            grid: { color: "rgba(255, 255, 255, 0.04)" },
            ticks: { color: "#8492a6", font: { size: 8 } },
            title: { display: true, text: "Failure Rate (%)", color: "#8492a6", font: { size: 8 } }
          }
        }
      }
    });
  }

  /**
   * Refreshes datasets with latest logs
   * @param {Array} recentLogs 
   */
  update(recentLogs) {
    if (!recentLogs || recentLogs.length === 0) {
      this.latencyChart.data.labels = [];
      this.latencyChart.data.datasets[0].data = [];
      this.latencyChart.update();

      this.errorChart.data.labels = [];
      this.errorChart.data.datasets[0].data = [];
      this.errorChart.update();
      return;
    }

    const plotLogs = recentLogs.slice(-10);
    const labels = plotLogs.map(l => {
      const t = new Date(l.timestamp);
      return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    });

    // 1. Update Latencies
    this.latencyChart.data.labels = labels;
    this.latencyChart.data.datasets[0].data = plotLogs.map(l => l.latency);
    this.latencyChart.update();

    // 2. Update Window Failure Rates (rolling estimate)
    // We plot the historical status code status (500+ = 100%, <500 = 0%) to visualize request success vs failure
    this.errorChart.data.labels = labels;
    this.errorChart.data.datasets[0].data = plotLogs.map(l => l.statusCode >= 500 ? 100 : 0);
    this.errorChart.update();
  }
}

window.TelemetryCharts = TelemetryCharts;
