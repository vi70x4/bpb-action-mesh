import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files from panel assets
app.use("/panel", express.static(join(__dirname, "assets/panel")));

// Redirect root to panel
app.get("/", (req, res) => {
  res.redirect("/panel");
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "BPB Action Panel is running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Get workflow runs
app.get("/api/runs", (req, res) => {
  res.json({
    runs: [
      {
        id: 1,
        name: "CI/CD Pipeline",
        status: "running",
        branch: "main",
        started: Date.now() - 120000,
      },
      {
        id: 2,
        name: "Deploy to Production",
        status: "success",
        branch: "release/v1.0",
        started: Date.now() - 900000,
      },
      {
        id: 3,
        name: "Test Suite",
        status: "failure",
        branch: "feature/new-auth",
        started: Date.now() - 3600000,
      },
    ],
  });
});

// Trigger workflow
app.post("/api/trigger-workflow", (req, res) => {
  const { workflow_id } = req.body;

  // Broadcast to all connected clients
  io.emit("action-update", {
    type: "workflow-triggered",
    workflow_id,
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: `Workflow ${workflow_id} triggered`,
  });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("subscribe-actions", () => {
    socket.join("actions");
    socket.emit("action-update", {
      type: "subscribed",
      message: "Subscribed to action updates",
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// Error handling
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  },
);

server.listen(PORT, () => {
  console.log(`🚀 BPB Action Panel server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/panel`);
});
