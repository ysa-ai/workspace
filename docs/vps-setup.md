# VPS Setup

How to set up a fresh Ubuntu VPS to run ysa workspace. Tested on Ubuntu 22.04 / 24.04.

## 1. System update

```bash
apt update && apt upgrade -y
```

## 2. Install Docker

```bash
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
```

## 3. Create a deploy user

```bash
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
```

Add your SSH public key:
```bash
mkdir -p /home/deploy/.ssh
echo "<your-public-key>" >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

## 4. Firewall

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw --force enable
```

## 5. Point DNS to your VPS

Create an A record pointing your domain to the VPS IP address. Wait for it to propagate before continuing.

## 6. Clone and configure

Switch to the deploy user:
```bash
su - deploy
git clone https://github.com/ysa-ai/workspace /opt/ysa
cd /opt/ysa
cp .env.example .env
```

Generate secrets and fill in the `.env`:
```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
echo "MASTER_KEY=$(openssl rand -hex 32)"
echo "AUTH_SECRET=$(openssl rand -hex 32)"
```

Paste the output into `.env`, then add your domain:
```env
POSTGRES_PASSWORD=<generated above>
ORIGIN=https://your-domain.com
MASTER_KEY=<generated above>
AUTH_SECRET=<generated above>
```

Optional — enable email for password reset:
```env
RESEND_API_KEY=re_...
FROM_EMAIL=noreply@your-domain.com
```

Secure the file:
```bash
chmod 600 /opt/ysa/.env
```

## 7. Build and start

```bash
cd /opt/ysa
docker compose up -d --build
```

Check it's running:
```bash
docker compose ps
curl http://localhost:3333/health
# → {"ok":true}
```

View logs:
```bash
docker compose logs -f app
```

## 8. Set up a reverse proxy

**Caddy** (recommended — handles TLS automatically):

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Create `/etc/caddy/Caddyfile`:
```
your-domain.com {
    reverse_proxy localhost:3333
}
```

```bash
systemctl reload caddy
```

**nginx** (bring your own TLS):
```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 9. Verify

```bash
curl https://your-domain.com/health
# → {"ok":true}
```

Open `https://your-domain.com` in your browser — you'll be redirected to the sign-up page. **The first account you create is the owner** of the organization. Once set up, you can disable public sign-ups:

```env
SIGNUP_DISABLED=true
```

Then restart: `docker compose up -d`.

## Upgrading

```bash
cd /opt/ysa
git pull
docker compose up -d --build
```

## Useful commands

```bash
# View logs
docker compose logs -f app

# Restart the app
docker compose restart app

# Stop everything
docker compose down

# Open a shell in the app container
docker compose exec app sh
```
