/**
 * BPB Action Panel - Frontend JavaScript
 *
 * This is a GitHub Actions-inspired panel for educational/lulz purposes.
 * It provides a dashboard interface to monitor and manage workflow runs.
 */

class BPBActionPanel {
  constructor() {
    this.socket = null;
    this.currentSection = "dashboard";
    this.workflows = [];
    this.runs = [];
    this.autoRefreshInterval = null;
    this.init();
  }

  init() {
    console.log("🚀 BPB Action Panel initializing...");
    this.setupSocketIO();
    this.setupNavigation();
    this.setupTheme();
    this.setupAutoRefresh();
    this.loadDashboardData();
    this.log("System initialized and ready", "success");
  }

  // --- Socket.IO Integration ---
  setupSocketIO() {
    try {
      this.socket = io("/");

      this.socket.on("connect", () => {
        this.log("Connected to real-time updates", "success");
        this.socket.emit("subscribe-actions");
      });

      this.socket.on("disconnect", () => {
        this.log("Disconnected from real-time updates", "warn");
      });

      this.socket.on("action-update", (data) => {
        this.handleActionUpdate(data);
      });
    } catch (error) {
      console.warn("Socket.IO not available, using fallback mode");
      this.log("Running in fallback mode (no real-time updates)", "info");
    }
  }

  // --- Navigation ---
  setupNavigation() {
    const navLinks = document.querySelectorAll(".sidebar-nav a");
    navLinks.forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const target = e.currentTarget.getAttribute("href").substring(1);
        this.switchSection(target);
      });
    });
  }

  switchSection(sectionId) {
    // Update active nav item
    document.querySelectorAll(".sidebar-nav li").forEach((item) => {
      item.classList.remove("active");
    });
    document
      .querySelector(`a[href="#${sectionId}"]`)
      .parentElement.classList.add("active");

    // Update active section
    document.querySelectorAll(".section").forEach((section) => {
      section.classList.remove("active");
    });
    document.getElementById(sectionId).classList.add("active");

    // Update page title
    const titles = {
      dashboard: "Dashboard",
      workflows: "Workflow Management",
      runners: "Self-Hosted Runners",
      secrets: "Repository Secrets",
      settings: "Panel Settings",
    };
    document.getElementById("page-title").textContent =
      titles[sectionId] || "BPB Action";

    this.currentSection = sectionId;

    // Load section-specific data
    switch (sectionId) {
      case "dashboard":
        this.loadDashboardData();
        break;
      case "workflows":
        this.loadWorkflows();
        break;
      case "runners":
        this.loadRunners();
        break;
      case "secrets":
        this.loadSecrets();
        break;
    }
  }

  // --- Theme ---
  setupTheme() {
    const themeToggle = document.getElementById("theme-toggle");
    themeToggle.addEventListener("click", () => {
      this.toggleTheme();
    });

    // Set initial theme
    const savedTheme = localStorage.getItem("bpb-theme") || "dark";
    this.applyTheme(savedTheme);
  }

  toggleTheme() {
    const currentTheme = document.body.classList.contains("light")
      ? "light"
      : "dark";
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    this.applyTheme(newTheme);
  }

  applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.style.setProperty("--bg-primary", "#ffffff");
      document.documentElement.style.setProperty("--bg-secondary", "#f6f8fa");
      document.documentElement.style.setProperty("--bg-tertiary", "#eaeef2");
      document.documentElement.style.setProperty("--text-primary", "#1f2328");
      document.documentElement.style.setProperty("--text-secondary", "#656d76");
      document.documentElement.style.setProperty("--border-color", "#d0d7de");
    } else {
      document.documentElement.style.setProperty("--bg-primary", "#0d1117");
      document.documentElement.style.setProperty("--bg-secondary", "#161b22");
      document.documentElement.style.setProperty("--bg-tertiary", "#21262d");
      document.documentElement.style.setProperty("--text-primary", "#c9d1d9");
      document.documentElement.style.setProperty("--text-secondary", "#8b949e");
      document.documentElement.style.setProperty("--border-color", "#30363d");
    }
    localStorage.setItem("bpb-theme", theme);
  }

  // --- Auto Refresh ---
  setupAutoRefresh() {
    const autoRefreshCheckbox = document.getElementById("auto-refresh");
    const refreshIntervalInput = document.getElementById("refresh-interval");

    autoRefreshCheckbox.addEventListener("change", () => {
      this.updateAutoRefresh();
    });

    refreshIntervalInput.addEventListener("change", () => {
      this.updateAutoRefresh();
    });

    this.updateAutoRefresh();
  }

  updateAutoRefresh() {
    const autoRefresh = document.getElementById("auto-refresh").checked;
    const interval =
      parseInt(document.getElementById("refresh-interval").value) * 1000;

    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }

    if (autoRefresh) {
      this.autoRefreshInterval = setInterval(() => {
        if (this.currentSection === "dashboard") {
          this.loadDashboardData();
        }
      }, interval);
      this.log(`Auto-refresh enabled (${interval / 1000}s interval)`, "info");
    } else {
      this.log("Auto-refresh disabled", "info");
    }
  }

  // --- Data Loading ---
  async loadDashboardData() {
    try {
      this.updateMetrics({
        totalRuns: 142,
        successRate: 87,
        avgDuration: "3m 24s",
        activeRuns: 3,
      });

      this.updateWorkflowRuns([
        {
          name: "CI/CD Pipeline",
          status: "running",
          branch: "main",
          time: "2m ago",
        },
        {
          name: "Deploy to Production",
          status: "success",
          branch: "release/v1.0",
          time: "15m ago",
        },
        {
          name: "Test Suite",
          status: "failure",
          branch: "feature/new-auth",
          time: "1h ago",
        },
        {
          name: "Lint Code",
          status: "success",
          branch: "main",
          time: "2h ago",
        },
        {
          name: "Build Docker Image",
          status: "pending",
          branch: "develop",
          time: "3h ago",
        },
      ]);

      this.updateSystemStatus({
        "API Status": "Operational",
        WebSocket: "Connected",
        "Last Sync": "Just now",
        Version: "v1.0.0",
      });
    } catch (error) {
      this.log("Error loading dashboard data", "error");
    }
  }

  async loadWorkflows() {
    const workflowsList = document.getElementById("workflows-list");
    workflowsList.innerHTML = `
            <div class="workflow-card">
                <h4>CI/CD Pipeline</h4>
                <p>Main CI/CD workflow for building and testing</p>
                <div class="workflow-meta">
                    <span>🌿 main</span>
                    <span>Last run: Just now</span>
                </div>
                <button onclick="panel.triggerWorkflow('ci-cd')" class="btn-primary">Run Workflow</button>
            </div>
            <div class="workflow-card">
                <h4>Deploy to Production</h4>
                <p>Production deployment workflow</p>
                <div class="workflow-meta">
                    <span>🌿 release/v1.0</span>
                    <span>Last run: 15m ago</span>
                </div>
                <button onclick="panel.triggerWorkflow('deploy-prod')" class="btn-primary">Run Workflow</button>
            </div>
            <div class="workflow-card">
                <h4>Build Docker Image</h4>
                <p>Build and push Docker images to registry</p>
                <div class="workflow-meta">
                    <span>🌿 develop</span>
                    <span>Last run: 3h ago</span>
                </div>
                <button onclick="panel.triggerWorkflow('docker-build')" class="btn-primary">Run Workflow</button>
            </div>
        `;
  }

  async loadRunners() {
    const runnersList = document.getElementById("runners-list");
    runnersList.innerHTML = `
            <div class="panel">
                <h4>Ubuntu Runner 01</h4>
                <div class="runner-status">
                    <span class="status-dot online"></span>
                    <span>Online</span>
                </div>
                <p>Last seen: Just now</p>
            </div>
            <div class="panel">
                <h4>Ubuntu Runner 02</h4>
                <div class="runner-status">
                    <span class="status-dot online"></span>
                    <span>Online</span>
                </div>
                <p>Last seen: 2m ago</p>
            </div>
            <div class="panel">
                <h4>Windows Runner 01</h4>
                <div class="runner-status">
                    <span class="status-dot offline"></span>
                    <span>Offline</span>
                </div>
                <p>Last seen: 3d ago</p>
            </div>
        `;
  }

  async loadSecrets() {
    const secretsList = document.getElementById("secrets-list");
    secretsList.innerHTML = `
            <div class="panel">
                <h4>🔐 PROD_API_KEY</h4>
                <p>Last updated: 3 days ago</p>
            </div>
            <div class="panel">
                <h4>🔐 DOCKER_PASSWORD</h4>
                <p>Last updated: 1 week ago</p>
            </div>
        `;
  }

  // --- UI Updates ---
  updateMetrics(metrics) {
    document.getElementById("total-runs").textContent = metrics.totalRuns;
    document.getElementById("success-rate").textContent =
      metrics.successRate + "%";
    document.getElementById("avg-duration").textContent = metrics.avgDuration;
    document.getElementById("active-runs").textContent = metrics.activeRuns;
  }

  updateWorkflowRuns(runs) {
    const container = document.getElementById("workflow-runs");
    container.innerHTML = runs
      .map(
        (run) => `
            <div class="run-item">
                <div class="run-status ${run.status}"></div>
                <div class="run-info">
                    <div class="run-name">${run.name}</div>
                    <div class="run-meta">${run.branch} • ${run.time}</div>
                </div>
            </div>
        `,
      )
      .join("");
  }

  updateSystemStatus(status) {
    const container = document.getElementById("system-status");
    container.innerHTML = Object.entries(status)
      .map(
        ([key, value]) => `
            <div class="status-item">
                <span class="status-label">${key}</span>
                <span class="status-value">${value}</span>
            </div>
        `,
      )
      .join("");
  }

  // --- Actions ---
  triggerWorkflow(workflowId) {
    this.log(`Triggering workflow: ${workflowId}`, "info");
    // In a real implementation, this would make an API call to GitHub Actions
    this.log("Workflow triggered successfully (simulated)", "success");
  }

  handleActionUpdate(data) {
    this.log(`Action update: ${JSON.stringify(data)}`, "info");
    if (this.currentSection === "dashboard") {
      this.loadDashboardData();
    }
  }

  // --- Logging ---
  log(message, type = "info") {
    const logOutput = document.getElementById("log-output");
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  clearLog() {
    document.getElementById("log-output").innerHTML = "";
  }
}

// Initialize the panel
const panel = new BPBActionPanel();

// Global functions for onclick handlers
window.triggerWorkflow = (id) => panel.triggerWorkflow(id);
