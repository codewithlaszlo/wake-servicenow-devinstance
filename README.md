# 🚀 ServiceNow Instance Wake Service

A powerful automation tool to wake hibernating ServiceNow Personal Developer Instances (PDIs). Available as both a **CLI tool** for local use and a **web service** for remote monitoring via Docker.

## 📋 Table of Contents

- [What This Does](#what-this-does)
- [How It Works](#how-it-works)
- [Features](#features)
- [Usage Options](#usage-options)
  - [Option 1: CLI Tool (index.js)](#option-1-cli-tool-indexjs)
  - [Option 2: Web Service (Docker)](#option-2-web-service-docker)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## 🎯 What This Does

ServiceNow Personal Developer Instances (PDIs) automatically hibernate after 10 days of inactivity. To wake them up, you normally need to:
1. Navigate to the developer portal
2. Log in with SSO
3. Navigate to your instance page
4. Wait for it to wake (~10 minutes)

This tool **automates the entire process** by:
- Checking if your instance is online or hibernating
- Automatically logging into the developer portal using headless browser automation
- Triggering the instance wake process
- Monitoring the status until the instance is online

---

## 🔧 How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Two Usage Modes                      │
├──────────────────────────┬──────────────────────────────┤
│      CLI Mode            │      Web Service Mode         │
│   (index.js)             │      (server.js)              │
├──────────────────────────┼──────────────────────────────┤
│ • Run locally            │ • Runs in Docker              │
│ • Interactive output     │ • Web interface               │
│ • Debug screenshots      │ • API endpoints               │
│ • Tree-style logging     │ • Auto-checks every 2 min     │
│ • Headful mode option    │ • Always headless             │
└──────────────────────────┴──────────────────────────────┘
                           ↓
              ┌────────────────────────┐
              │   Playwright/Chromium  │
              │   Browser Automation   │
              └────────────────────────┘
                           ↓
        ┌──────────────────────────────────────┐
        │  ServiceNow Developer Portal Login   │
        │  • Cookie banner dismissal           │
        │  • Two-step SSO authentication       │
        │  • Shadow DOM navigation             │
        │  • Instance status detection         │
        └──────────────────────────────────────┘
                           ↓
                  ┌─────────────────┐
                  │  Your Instance  │
                  │   Wakes Up! ✨  │
                  └─────────────────┘
```

### Login Process

1. **Navigate** to `developer.servicenow.com`
2. **Dismiss** cookie consent banners (including iframe-based TrustArc)
3. **Click** "Sign In" button
4. **Fill** email address and click "Next" (two-step authentication)
5. **Fill** password and submit
6. **Wait** for redirect to developer portal
7. **Navigate** Shadow DOM components (`<dps-page-new-header>`)
8. **Extract** instance status from nested shadow roots
9. **Monitor** until instance is online

### Status Checking

The web service uses a **two-tier approach** for efficiency:

#### Fast Check (HTTP - 1-2 seconds)
```javascript
GET https://your-instance.service-now.com/
  ↓
Check HTML for "Your instance is hibernating"
  ↓
Return: online | offline
```

#### Full Check (Browser Automation - 30+ seconds)
- Only used when clicking "Wake Instance"
- Performs full login to trigger wake
- Monitors status until online

---

## ✨ Features

### CLI Tool (`index.js`)
- ✅ **Interactive progress display** with tree-style logging
- ✅ **Visual feedback** with checkmarks and spinners (via `ora`)
- ✅ **Debug mode** with `--headfull` flag to watch browser actions
- ✅ **Screenshot capture** on errors for troubleshooting
- ✅ **Full HTML dumps** for debugging Shadow DOM issues
- ✅ **Robust error handling** with detailed error messages
- ✅ **Command-line arguments** or environment variables

### Web Service (`server.js`)
- ✅ **Beautiful web interface** with real-time status updates
- ✅ **Automatic status checking** every 2 minutes (HTTP-based)
- ✅ **One-click wake** via web button
- ✅ **REST API** for programmatic access
- ✅ **Docker containerized** for easy deployment
- ✅ **Cloudflare Tunnel compatible** for remote access
- ✅ **Health checks** and auto-restart on failure
- ✅ **Animated UI** with loading states and progress indicators

---

## 🚀 Usage Options

## Option 1: CLI Tool (index.js)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd wake-servicenow-instance

# Install dependencies
npm install
```

### Configuration

Create a `.env` file or set environment variables:

```bash
SERVICENOW_USERNAME=your-email@example.com
SERVICENOW_PASSWORD=your-password
INSTANCE_URL=https://dev123456.service-now.com/
```

### Running the CLI

```bash
# Using environment variables from .env
node index.js

# Or pass credentials directly
node index.js --username your-email@example.com --password your-password

# Debug mode (watch the browser)
node index.js --headfull

# Using npx (if installed globally)
npx wake-servicenow-instance
```

### CLI Output Example

```
✔ ServiceNow Developer page opened
  → Dismissing cookie banner...
  → Clicking Sign In button...
✔ Logged into ServiceNow Developer account
  → Filling email...
  → Clicking Next...
  → Filling password...
  → Submitting login form...
✔ Instance is Online 🎉
```

### CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--username` | ServiceNow username | From `.env` |
| `--password` | ServiceNow password | From `.env` |
| `--headfull` | Show browser window | `false` |

---

## Option 2: Web Service (Docker)

### Prerequisites

- Docker and Docker Compose installed
- Cloudflare Tunnel (optional, for remote access)

### Quick Start

1. **Clone and navigate to the directory:**

```bash
git clone <your-repo-url>
cd wake-servicenow-instance
```

2. **Create `.env` file:**

```bash
# Copy the example
cp env.example .env

# Edit with your credentials
nano .env
```

Add your credentials:

```bash
SERVICENOW_USERNAME=your-email@example.com
SERVICENOW_PASSWORD=your-password
INSTANCE_URL=https://dev123456.service-now.com/
PORT=3000
NODE_ENV=production
```

3. **Build and start the service:**

```bash
# Build the Docker image
docker compose build

# Start the service
docker compose up -d

# View logs
docker compose logs -f
```

4. **Access the web interface:**

```
http://localhost:3000
```

### Docker Commands Reference

```bash
# Start service
docker compose up -d

# Stop service
docker compose down

# View logs
docker compose logs -f

# Restart service
docker compose restart

# Rebuild after changes
docker compose up -d --build

# Check status
docker compose ps
```

### Web Interface

The web interface provides:

- **Real-time status display** (Online/Offline/Waking)
- **Last checked timestamp**
- **One-click wake button**
- **Automatic status polling** (every 30 seconds)
- **Direct link to instance** (when online)
- **Beautiful animated UI** with loading states

### API Endpoints

#### GET `/api/status`

Returns current instance status.

**Response:**
```json
{
  "status": "online",
  "lastChecked": "2026-01-12T15:30:00.000Z",
  "lastWakeAttempt": null,
  "error": null,
  "instanceName": "dev281644",
  "instanceUrl": "https://dev281644.service-now.com/"
}
```

**Status Values:**
- `online` - Instance is running
- `offline` - Instance is hibernating
- `waking` - Wake process in progress (~10 minutes)
- `checking` - Currently checking status
- `error` - Error occurred

#### POST `/api/wake`

Triggers the instance wake process.

**Response:**
```json
{
  "message": "Wake process started - logging into developer portal",
  "status": "waking",
  "estimatedTime": "10 minutes"
}
```

**Error Response (429):**
```json
{
  "error": "Operation already in progress"
}
```

### Cloudflare Tunnel Setup

To access your service remotely via a custom domain:

1. **Install Cloudflare Tunnel:**

```bash
# On your server (Pi, VPS, etc.)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

2. **Authenticate:**

```bash
cloudflared tunnel login
```

3. **Create tunnel:**

```bash
cloudflared tunnel create servicenow-wake
```

4. **Configure tunnel:**

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR-TUNNEL-ID>
credentials-file: /home/pi/.cloudflared/<YOUR-TUNNEL-ID>.json

ingress:
  - hostname: wake-servicenow.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

5. **Add DNS record in Cloudflare dashboard:**

```
Type: CNAME
Name: wake-servicenow
Content: <YOUR-TUNNEL-ID>.cfargotunnel.com
```

6. **Run tunnel:**

```bash
cloudflared tunnel run servicenow-wake
```

Or set up as a service:

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SERVICENOW_USERNAME` | ✅ Yes | - | Your ServiceNow account email |
| `SERVICENOW_PASSWORD` | ✅ Yes | - | Your ServiceNow account password |
| `INSTANCE_URL` | ✅ Yes | - | Your instance URL (e.g., `https://dev123456.service-now.com/`) |
| `PORT` | ❌ No | `3000` | Web service port |
| `NODE_ENV` | ❌ No | `production` | Node environment |

### Port Configuration

If port 3000 is already in use, change it in `docker-compose.yml`:

```yaml
ports:
  - "3002:3000"  # External:Internal
```

Then update your Cloudflare Tunnel to point to the new port.

### `.dockerignore`

The following files are excluded from the Docker image:

```
node_modules
.git
.gitignore
debug-*.png
debug-*.html
npm-debug.log
.env
```

---

## 🏗️ Architecture

### Project Structure

```
wake-servicenow-instance/
├── index.js              # CLI tool (standalone)
├── server.js             # Web service (Express + Playwright)
├── public/
│   └── index.html        # Web interface
├── package.json          # Dependencies
├── Dockerfile            # Docker image definition
├── docker-compose.yml    # Docker Compose configuration
├── .env                  # Environment variables (not in repo)
├── env.example           # Example environment file
└── README.md             # This file
```

### Technology Stack

- **Node.js** - Runtime environment
- **Playwright** - Browser automation
- **Express** - Web server framework
- **Chromium** - Headless browser
- **Docker** - Containerization
- **ora** - Terminal spinners (CLI only)
- **command-line-args** - Argument parsing (CLI only)

### Two Implementations

#### `index.js` - CLI Tool
- Full-featured with rich logging
- Debug screenshots and HTML dumps
- Headful mode for debugging
- Ideal for development and troubleshooting

#### `server.js` - Web Service
- Simplified Playwright implementation
- Always runs headless
- HTTP-based status checks (fast)
- Full browser automation only when waking
- Designed for 24/7 operation

---

## 🔒 Security

### What's Exposed Remotely?

✅ **Safe to expose:**
- Web interface (HTML/CSS/JavaScript)
- `/api/status` endpoint (returns status, no credentials)
- `/api/wake` endpoint (triggers wake, but requires no input)
- Instance URL (already public anyway)

❌ **NOT exposed:**
- `.env` file (never served)
- Environment variables (only in container memory)
- ServiceNow credentials (never sent to frontend)
- Docker container internals

### Security Best Practices

1. **Secure your `.env` file:**
```bash
chmod 600 .env
```

2. **Use strong passwords** for ServiceNow account

3. **Enable 2FA** on Cloudflare account

4. **Keep dependencies updated:**
```bash
npm audit
npm audit fix
```

5. **Monitor access logs:**
```bash
docker compose logs | grep -i error
```

6. **Use SSH keys** instead of passwords for server access

### Remote Attack Surface

For remote attackers (without SSH/physical access):
- ✅ **Cannot** access your `.env` file
- ✅ **Cannot** see your credentials
- ✅ **Cannot** execute arbitrary code (without critical vulnerability)
- ⚠️ **Can** trigger wake (minor annoyance, not a security issue)
- ⚠️ **Can** see your instance URL (already public)

**Verdict:** Safe for home lab / personal use behind Cloudflare Tunnel.

---

## 🐛 Troubleshooting

### Common Issues

#### "Port already in use"

```bash
# Check what's using the port
sudo lsof -i :3000

# Change port in docker-compose.yml
ports:
  - "3002:3000"
```

#### "Instance shows online but is hibernating"

```bash
# Verify INSTANCE_URL in .env
cat .env | grep INSTANCE_URL

# Restart Docker to pick up new env vars
docker compose down && docker compose up -d
```

#### "Cannot find password input"

This usually means the login flow changed. Run in debug mode:

```bash
# CLI with headful mode
node index.js --headfull

# Check debug screenshots
ls -la debug-*.png
```

#### "Cookie banner blocking clicks"

The script handles TrustArc cookie banners, but if ServiceNow changes their implementation:

1. Run in headful mode to see what's happening
2. Check debug screenshots
3. Update the cookie dismissal selectors in the code

#### "Shadow DOM content not found"

ServiceNow uses Shadow DOM extensively. If the structure changes:

1. Save debug HTML: `debug-page-*.html`
2. Search for your instance name in the HTML
3. Update the Shadow DOM navigation code

### Debug Mode (CLI Only)

```bash
# Watch the browser automation in real-time
node index.js --headfull

# Debug output includes:
# - Current URL
# - Frame URLs
# - Shadow DOM content
# - Screenshots on error
# - Full HTML dumps
```

### Docker Logs

```bash
# View all logs
docker compose logs

# Follow logs in real-time
docker compose logs -f

# Check specific errors
docker compose logs | grep -i error

# Check startup logs
docker compose logs | grep "ServiceNow Wake Service"
```

### Health Check

The Docker container includes a health check:

```bash
# Check container health
docker compose ps

# Should show "healthy" status
```

### Testing Status Check Manually

```bash
# Test HTTP check
curl -s https://your-instance.service-now.com/ | grep -i "hibernating"

# If it returns text, instance is hibernating
# If empty, instance is online

# Test API endpoint
curl http://localhost:3000/api/status
```

---

## 📝 License

Apache-2.0

---

## 🙏 Acknowledgments

This project uses:
- [Playwright](https://playwright.dev/) for browser automation
- [Express](https://expressjs.com/) for the web server
- [ora](https://github.com/sindresorhus/ora) for terminal spinners
- ServiceNow Developer Portal (obviously!)

---

## 📧 Support

Having issues? Check:
1. The [Troubleshooting](#troubleshooting) section above
2. Docker logs: `docker compose logs -f`
3. Run CLI in debug mode: `node index.js --headfull`

---

**Happy Instance Waking! 🚀**
