#!/bin/bash
# ============================================================
# SquadHub VPS Setup Script
# Run this once on your Hostinger VPS to set everything up
# ============================================================

set -e

echo "=== SquadHub VPS Setup ==="

# Update system
echo "Updating system packages..."
apt-get update && apt-get upgrade -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
  systemctl enable docker
  systemctl start docker
  echo "Docker installed successfully"
else
  echo "Docker already installed"
fi

# Install Docker Compose plugin if not present
if ! docker compose version &> /dev/null; then
  echo "Installing Docker Compose plugin..."
  apt-get install -y docker-compose-plugin
  echo "Docker Compose installed successfully"
else
  echo "Docker Compose already installed"
fi

# Install Git if not present
if ! command -v git &> /dev/null; then
  echo "Installing Git..."
  apt-get install -y git
fi

# Create app directory
mkdir -p /opt/squadhub
cd /opt/squadhub

echo ""
echo "=== Setup Complete ==="
echo "Next steps:"
echo "1. Clone the repo: git clone https://github.com/Jeff-Upsquad/squadhub.git /opt/squadhub"
echo "2. Run: cd /opt/squadhub && docker compose up --build -d"
echo "3. Visit: http://72.61.245.97"
