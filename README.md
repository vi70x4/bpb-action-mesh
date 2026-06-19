# 🎮 BPB Action Panel

A GitHub Actions-based panel inspired by the legendary [BPB-Worker-Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel), but adapted for the GitHub Actions ecosystem. Built purely for educational purposes and lulz! 🚀

## 🎯 What Is This?

This project reimagines the BPB-Worker-Panel concept within the GitHub Actions environment. Instead of running proxy configurations on Cloudflare Workers, we provide a beautiful dashboard to monitor and manage your GitHub Actions workflows because... why not? 😄

## ✨ Features

- 🎨 **Beautiful Dark UI**: Inspired by the original BPB panel, with GitHub's Primer design language
- 📊 **Real-time Dashboard**: Monitor workflow runs, success rates, and system status in real-time
- 🔄 **Workflow Management**: View, trigger, and manage your GitHub Actions workflows from a fancy web interface
- 🏃 **Self-hosted Runners**: Track your self-hosted runner status
- 🔐 **Secrets Overview**: Manage repository secrets (display only, for safety!)
- ⚡ **Socket.IO Integration**: Real-time updates without page refreshes
- 🌗 **Theme Support**: Dark/Light/System theme toggle
- 📱 **Responsive Design**: Works on mobile, tablet, and desktop

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/bpb-action-panel.git
cd bpb-action-panel

# Install dependencies
npm install

# Start development server
npm run dev

# Or build for production
npm run build
npm start
```

### Access the Panel

Once the server is running, open your browser to:
```
http://localhost:3000/panel
```

## 🏗️ GitHub Actions Workflow

The `.github/workflows/panel.yml` file includes a fully-featured CI/CD pipeline:

- **Build & Test**: Compiles TypeScript and validates the build
- **Deploy**: Optionally deploys to GitHub Pages
- **Health Check**: Monitors the deployed service
- **Release**: Automatically creates GitHub releases on main branch pushes

## 📂 Project Structure

```
bpb-action/
├── .github/
│   └── workflows/
│       └── panel.yml          # GitHub Actions workflow
├── src/
│   ├── assets/
│   │   └── panel/
│   │       ├── index.html     # Panel UI
│   │       ├── style.css      # Panel styles
│   │       └── script.js      # Panel logic
│   ├── scripts/
│   │   └── build.js           # Build script
│   ├── server.ts              # Express server
│   └── index.ts               # Entry point
├── scripts/
│   └── build-panel.js         # Asset builder
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠️ Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build the TypeScript and panel assets |
| `npm run build:panel` | Build panel assets only |
| `npm start` | Start production server |
| `npm test` | Run tests (placeholder) |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |

## 🤝 Contributing

This is an educational project. Feel free to fork it, customize it, and make it your own!

## 📜 License

MIT - Because sharing is caring! 💙

---

**Disclaimer**: This project is not affiliated with the original BPB-Worker-Panel. It's a fan-made tribute that adapts the concept for GitHub Actions. No proxy functionality is included - this is purely a dashboard/interface tool!