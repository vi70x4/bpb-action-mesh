# 🎮 BPB Action Panel

A GitHub Actions-based proxy system inspired by the legendary [BPB-Worker-Panel](https://github.com/bia-pain-bache/BPB-Worker-Panel), but adapted to run inside GitHub Actions runners. Built purely for educational purposes and lulz! 🚀

## 🎯 What Is This?

This project turns a GitHub Actions runner into a temporary proxy server (VLESS or Hysteria2) and provides a Cloudflare Worker coordinator that serves Hiddify-compatible subscription links. Because... why not run proxies in GitHub Actions? 😄

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your GitHub Repo                         │
│                                                                  │
│  ┌─────────────────────┐     ┌──────────────────────────────┐  │
│  │ GitHub Actions      │────▶│  Proxy Runner (VLESS/Hys2)   │  │
│  │ - Triggered on push │     │  Runs on: ubuntu-latest      │  │
│  │ - Sets up proxy     │     │  Duration: 45 min max      │  │
│  └─────────────────────┘     └──────────────┬───────────────┘  │
│          │                                  │                  │
│          │                                  │ public URL        │
│          │                                  ▼                  │
│          │                         ┌──────────────────┐       │
│          │                         │  Cloudflare      │       │
│          │                         │  Tunnel/DNS    │       │
│          │                         │  (trycloudflare)│       │
│          │                         └────────┬────────┘       │
│          │                                  │                  │
│          │                                  ├──────────────────┼──┐
│          │                                  │                  │  │
│          │   POST /register                 │                  │  │
│          │◄───────────────────────────────┘                  │  │
│          │                                                   │  │
├──────────┼──────────────────────────────────────────────────│──│
│          │   ┌─────────────────────────────┐                  │  │
│          │   │  Cloudflare Worker         │                  │  │
│          │   │  (Coordinator)             │                  │  │
│          │   │  - Receives registrations │                  │  │
│          │   │  - Serves /sub endpoint   │◄─────────────────┘  │
│          │   │  - KV storage for creds  │                      │
│          │   └────────────┬──────────────┘                     │
│          │                │                                     │
│          │                │ GET /sub/all                      │
│          │                ▼                                   │
│          │         ┌──────────────────┐                     │
│          └─────▶│  Hiddify Client  │                     │
│                    │  (or any v2ray   │                     │
│                    │   client)         │                     │
│                    └──────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

## ✨ Features

- 🚀 **Zero-config setup**: Fork, add secrets, push to main
- ⚡ **Auto-triggers on push**: Each push to `main` spins up a fresh proxy
- 🌐 **Cloudflare Tunnel**: Built-in tunneling for public access (no server needed!)
- 📋 **Hiddify-compatible subscriptions**: Get a single subscription URL to paste into Hiddify
- 🔐 **Secure**: Credentials auto-generated and stored in KV
- ⏱️ **Self-terminating**: Auto-cleans up after 45 minutes
- 🔄 **Real-time dashboard**: Monitor your proxy status via the web panel
- 🌗 **Dark mode**: Because aesthetics matter

## 🚀 Quick Start

### Prerequisites

1. A GitHub account (free tier works!)
2. A Cloudflare account (free tier)
3. [Hiddify](https://hiddify.com/) or any v2ray-compatible client

### Step 1: Fork & Setup

1. Fork this repository
2. Go to **Settings > Secrets and variables > Actions**
3. Add the following secrets:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `COORDINATOR_URL` | Your Cloudflare Worker URL | `https://bpb-coordinator.yourname.workers.dev` |
| `AUTH_TOKEN` | Shared secret for auth | `your-secret-token-123` |

### Step 2: Deploy the Coordinator

```bash
# Clone your fork
git clone https://github.com/YOURUSERNAME/bpb-action.git
cd bpb-action

# Install wrangler globally
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy the worker
cd worker
wrangler deploy

# Store the URL (e.g., https://bpb-coordinator.yourname.workers.dev)
```

### Step 3: Trigger the Proxy

Push to the `main` branch:

```bash
echo "trigger" >> README.md
git add -A
git commit -m "trigger proxy"
git push origin main
```

Or manually trigger via GitHub Actions:
- Go to **Actions > BPB Action Proxy > Run workflow**
- Select protocol: `hysteria2` or `vless`
- Click **Run workflow**

### Step 4: Get Your Subscription

After the workflow runs (~2 minutes), you'll see the output:

```
═══════════════════════════════════════════════
🎉 BPB Action Proxy is running!

🔗 Protocol: hysteria2
🔗 Public URL: https://xxxx-xxx-xxx.trycloudflare.com

📋 Subscription URL: https://bpb-coordinator.yourname.workers.dev/sub/all
   (Paste this into Hiddify!)
═══════════════════════════════════════════════
```

Or get it programmatically:

```bash
curl https://bpb-coordinator.yourname.workers.dev/sub/all
```

### Step 5: Import into Hiddify

1. Open **Hiddify** (or your preferred client)
2. Go to **Subscriptions > Add**
3. Paste the subscription URL
4. Click **Update**
5. Connect! 🎉

## 📂 Project Structure

```
bpb-action/
├── .github/
│   └── workflows/
│       ├── panel.yml          # Dashboard panel CI/CD
│       └── proxy.yml          # Proxy runner (VLESS/Hysteria2)
├── src/
│   ├── assets/panel/          # Web dashboard UI
│   ├── server.ts              # Express + Socket.IO backend
│   └── index.ts               # Entry point
├── worker/
│   ├── src/index.ts           # Cloudflare Worker coordinator
│   ├── wrangler.toml          # Worker config
│   └── package.json           # Worker dependencies
├── scripts/
│   └── build-panel.js         # Asset builder
├── package.json               # Root package.json
├── tsconfig.json              # TypeScript config
└── README.md                  # This file
```

## 🛠️ Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dashboard in dev mode |
| `npm run build` | Build TypeScript and panel assets |
| `npm run build:panel` | Build panel HTML/CSS/JS |
| `npm run start` | Start production dashboard server |

### Local Development

```bash
# Install dependencies
npm install

# Run the dashboard locally
npm run dev

# Access the panel
open http://localhost:3000/panel
```

### Worker Development

```bash
cd worker

# Install wrangler
npm install

# Run in dev mode (with hot reload)
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## 🔧 Troubleshooting

### "Failed to register with coordinator"
- Check that `COORDINATOR_URL` and `AUTH_TOKEN` secrets are set correctly
- Verify the Cloudflare Worker is deployed and running (`wrangler tail`)

### "Tunnel URL not found"
- Cloudflare Tunnel takes ~10 seconds to establish
- Check the GitHub Actions logs for `tunnel.log`
- Sometimes trycloudflare is rate-limited; wait a few minutes and retry

### "Connection refused" in Hiddify
- Make sure the runner is still active (max 45 minutes)
- Check the public URL is accessible directly in a browser
- Verify the subscription URL returns valid configs:
  ```bash
  curl https://bpb-coordinator.yourname.workers.dev/sub/all
  ```

## 📜 FAQ

**Q: Is this free?**  
A: Yes! GitHub Actions free tier gives you 2,000 minutes/month. Each proxy run uses ~45 minutes.

**Q: How long does the proxy stay up?**  
A: Up to 45 minutes per GitHub Actions run. You can trigger it again by pushing to main.

**Q: Can I use this for... reasons?**  
A: Only for educational purposes. Respect GitHub's ToS and your local laws.

**Q: Why Hysteria2 instead of VLESS?**  
A: Hysteria2 is easier to set up in CI environments (no TLS cert needed). VLESS is available if you prefer it.

**Q: Is my traffic encrypted?**  
A: Yes, between you and the Cloudflare Tunnel (TLS). Within GitHub's network, it's standard HTTPS.

## 🤝 Contributing

This is an educational project. Feel free to fork, customize, and make it your own!

## 📜 License

MIT - Because sharing is caring! 💙

---

**Disclaimer**: This project is not affiliated with the original BPB-Worker-Panel. It's a fan-made tribute that adapts the concept for GitHub Actions. Use responsibly and in accordance with GitHub's Terms of Service!
