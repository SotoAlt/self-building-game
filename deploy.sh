#!/bin/bash
set -e

SERVER="root@178.156.239.120"
APP_DIR="/opt/self-building-game"
DOMAIN="chaos.waweapps.win"

echo "=== Self-Building Game Deployment ==="

# Step 1: Install Docker if not present
echo "[1/6] Checking Docker..."
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
echo "[2/6] Setting up app directory..."
ssh $SERVER "mkdir -p $APP_DIR"

# Step 3: Sync project files
echo "[3/6] Syncing project files..."
rsync -avz --exclude node_modules --exclude dist --exclude .git --exclude .env \
  /Users/rodrigosoto/repos/self-building-game/ $SERVER:$APP_DIR/

# Step 4: Create production .env on server (preserving secrets across deploys)
echo "[4/6] Setting up production .env..."
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
echo "[5/6] Setting up SSL..."
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
    cp /tmp/nginx-http-only.conf $APP_DIR/nginx.conf.tmp

    # Start just nginx for ACME
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
echo "[6/6] Starting services..."
ssh $SERVER "cd $APP_DIR && docker compose up -d --build"

echo ""
echo "=== Deployment complete! ==="
echo "URL: https://$DOMAIN"
echo "Spectator: https://$DOMAIN/?spectator=true"
echo ""
echo "To check logs: ssh $SERVER 'cd $APP_DIR && docker compose logs -f game'"
