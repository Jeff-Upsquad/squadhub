# VPS Deployment Guide

## VPS Details
- **Host**: 72.61.245.97
- **User**: root
- **Basic Setup**: Docker + Docker Compose already installed
- **App Path**: /opt/squadhub

## Deployment Steps

### 1. SSH into VPS
```bash
ssh root@72.61.245.97
```

### 2. Navigate to squadhub directory
```bash
cd /opt/squadhub
```

### 3. Pull latest changes from GitHub
```bash
git pull origin main
```

### 4. Ensure .env file exists
The `.env.example` template should be in the repo. Copy it and update with your values:
```bash
cat .env.example > .env
# Edit .env with your actual URLs:
# - CLIENT_URL=https://squadhub.in
# - ADMIN_URL=https://admin.squadhub.in
nano .env
```

### 5. Build and deploy with Docker Compose
```bash
docker compose up --build -d
```

This will:
- Pull latest images
- Build any modified services
- Start all containers in detached mode
- Automatically restart containers on reboot

### 6. Verify deployment
```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f

# Test endpoints
curl https://squadhub.in
curl https://admin.squadhub.in
```

### 7. Cleanup old images (optional, saves disk space)
```bash
docker image prune -f
```

## Troubleshooting

**Containers not starting?**
```bash
docker compose logs [service-name]
```

**Port conflicts?**
Check if ports are already in use:
```bash
netstat -tulpn | grep LISTEN
```

**Need to restart?**
```bash
docker compose restart
```

**Need to stop everything?**
```bash
docker compose down
```

## Manual Execution

Run these commands one at a time on your VPS:

```bash
ssh root@72.61.245.97
cd /opt/squadhub
git pull origin main
docker compose up --build -d
docker compose ps
```
