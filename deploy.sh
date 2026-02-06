#!/bin/bash
set -e

SERVER="root@178.156.239.120"
APP_DIR="/opt/self-building-game"
DOMAIN="chaos.waweapps.win"

echo "=== Self-Building Game Deployment ==="

# Step 1: Install Docker if not present
echo "[1/7] Checking Docker..."
ssh $SERVER 'command -v docker >/dev/null 2>&1 || {
  echo "Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  echo "Docker installed!"
}'

# Step 2: Create app directory
echo "[2/7] Setting up app directory..."
ssh $SERVER "mkdir -p $APP_DIR"

# Step 3: Sync project files
echo "[3/7] Syncing project files..."
rsync -avz --exclude node_modules --exclude dist --exclude .git --exclude .env \
  /Users/rodrigosoto/repos/self-building-game/ $SERVER:$APP_DIR/

# Step 4: Create production .env on server (preserving secrets across deploys)
echo "[4/7] Setting up production .env..."
ssh $SERVER "
  if [ -f $APP_DIR/.env ]; then
    echo 'Existing .env found — preserving secrets'
    EXISTING_DB_PASSWORD=\$(grep '^DB_PASSWORD=' $APP_DIR/.env | cut -d= -f2)
    EXISTING_JWT_SECRET=\$(grep '^JWT_SECRET=' $APP_DIR/.env | cut -d= -f2)
  fi

  DB_PASSWORD=\${EXISTING_DB_PASSWORD:-\$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)}
  JWT_SECRET=\${EXISTING_JWT_SECRET:-\$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)}

  cat > $APP_DIR/.env << ENVEOF
PORT=3000
NODE_ENV=production
DB_PASSWORD=\$DB_PASSWORD
JWT_SECRET=\$JWT_SECRET
PRIVY_APP_ID=cml9kfosm02swkw0b9l2ct7tq
PRIVY_APP_SECRET=privy_app_secret_4Fbgdo5pAARnf2V3rhrAyGzmB3ZEXrLznuR8BCBLECFCSmNLHZBvX3hK7jj2HqZtYbV5jtZqzdSsFU6d32BEWuiA
VITE_PRIVY_APP_ID=cml9kfosm02swkw0b9l2ct7tq
VITE_PRIVY_CLIENT_ID=client-WY6Vr2Mx3BaBS1LuUr5LNdae5ZeqzzNwpCrLkuRaE8LAw
AI_PLAYERS=false
ENVEOF
  echo \"DB_PASSWORD persisted: \${DB_PASSWORD:0:4}...\"
"

# Step 5: Get SSL cert (first time: use HTTP-only nginx, get cert, then restart with HTTPS)
echo "[5/7] Setting up SSL..."
ssh $SERVER "cd $APP_DIR && {
  # Check if cert already exists
  if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
    echo 'Getting SSL certificate...'

    # Start with HTTP-only nginx config for cert
    cat > /tmp/nginx-http-only.conf << 'NGEOF'
server {
    listen 80;
    server_name chaos.waweapps.win;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 'Setting up...';
    }
}
NGEOF

    # Start temporary nginx for ACME challenge
    docker compose up -d db
    docker compose up -d game
    docker run -d --name temp-nginx -p 80:80 \
      -v /tmp/nginx-http-only.conf:/etc/nginx/conf.d/default.conf:ro \
      -v self-building-game_webroot:/var/www/certbot \
      nginx:alpine

    sleep 3

    # Get certificate
    docker run --rm \
      -v self-building-game_certbot-etc:/etc/letsencrypt \
      -v self-building-game_certbot-var:/var/lib/letsencrypt \
      -v self-building-game_webroot:/var/www/certbot \
      certbot/certbot certonly --webroot -w /var/www/certbot \
      -d $DOMAIN --non-interactive --agree-tos --email admin@waweapps.win

    docker rm -f temp-nginx

    echo 'SSL cert obtained, nginx will use real config from docker-compose mount'
  else
    echo 'SSL cert already exists'
  fi
}"

# Step 6: Start everything
echo "[6/7] Starting services..."
ssh $SERVER "cd $APP_DIR && docker compose up -d --build"

# Step 7: Setup agent-runner as host-side systemd service
echo "[7/7] Setting up Chaos Agent (agent-runner)..."

# Read Anthropic API key from local OpenClaw config
ANTHROPIC_KEY=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/openclaw.json')); print(d['models']['providers']['anthropic']['apiKey'])" 2>/dev/null || echo "")
if [ -z "$ANTHROPIC_KEY" ]; then
  echo "WARNING: No Anthropic API key found in ~/.openclaw/openclaw.json"
  echo "Agent-runner will not work without it. Set ANTHROPIC_API_KEY env var on VPS manually."
fi

# Install Node.js on VPS if not present
ssh $SERVER 'command -v node >/dev/null 2>&1 || {
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
}'

# Install OpenClaw CLI globally if not present
ssh $SERVER 'command -v openclaw >/dev/null 2>&1 || {
  echo "Installing OpenClaw CLI..."
  npm install -g @anthropic-ai/openclaw 2>/dev/null || npm install -g openclaw 2>/dev/null || echo "OpenClaw install failed - may need manual install"
}'

# Setup minimal OpenClaw config for agent (write locally, scp to server)
OPENCLAW_TMP=$(mktemp)
cat > "$OPENCLAW_TMP" << OCEOF
{
  "models": {
    "providers": {
      "anthropic": {
        "baseUrl": "https://api.anthropic.com",
        "apiKey": "${ANTHROPIC_KEY}",
        "api": "anthropic-messages",
        "models": [{
          "id": "claude-haiku-4-5",
          "name": "Claude Haiku 4.5",
          "api": "anthropic-messages",
          "reasoning": false,
          "input": ["text"],
          "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
          "contextWindow": 200000,
          "maxTokens": 8192
        }]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-haiku-4-5" },
      "workspace": "/root/.openclaw/workspace",
      "compaction": { "mode": "safeguard" },
      "maxConcurrent": 2
    }
  },
  "commands": { "native": "auto", "nativeSkills": "auto" },
  "skills": { "install": { "nodeManager": "npm" } }
}
OCEOF
ssh $SERVER "mkdir -p /root/.openclaw"
scp "$OPENCLAW_TMP" $SERVER:/root/.openclaw/openclaw.json
rm -f "$OPENCLAW_TMP"

# Create systemd service for agent-runner
SVCFILE=$(mktemp)
cat > "$SVCFILE" << 'SVCEOF'
[Unit]
Description=Chaos Magician Agent Runner
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/self-building-game
ExecStart=/usr/bin/node /opt/self-building-game/agent-runner.js
Environment=GAME_SERVER_URL=http://localhost:3000
Environment=TICK_INTERVAL=10000
Environment=NODE_ENV=production
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF
scp "$SVCFILE" $SERVER:/etc/systemd/system/chaos-agent.service
rm -f "$SVCFILE"

ssh $SERVER "systemctl daemon-reload && systemctl enable chaos-agent && systemctl restart chaos-agent && echo 'Agent runner service started!'"

echo ""
echo "=== Deployment complete! ==="
echo "URL: https://$DOMAIN"
echo "Spectator: https://$DOMAIN/?spectator=true"
echo ""
echo "To check logs:"
echo "  Game:  ssh $SERVER 'cd $APP_DIR && docker compose logs -f game'"
echo "  Agent: ssh $SERVER 'journalctl -u chaos-agent -f'"
