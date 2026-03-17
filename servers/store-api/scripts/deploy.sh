#!/bin/bash

# Deploy script for Store API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Environment defaults
ENV=${1:-dev}
COMPOSE_FILE=${2:-docker-compose.yml}

echo -e "${YELLOW}Deploying Store API (Environment: ${ENV})${NC}"

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed!${NC}"
    exit 1
fi

# Source environment file
if [ -f "configs/.env.${ENV}" ]; then
    echo -e "${YELLOW}Loading environment from configs/.env.${ENV}${NC}"
    export $(grep -v '^#' "configs/.env.${ENV}" | xargs)
else
    echo -e "${RED}Environment file not found: configs/.env.${ENV}${NC}"
    exit 1
fi

# Start services
echo -e "${YELLOW}Starting services...${NC}"
docker-compose -f "${COMPOSE_FILE}" up -d

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Deployment completed successfully!${NC}"
    echo "Check logs with: docker-compose logs -f store-api"
else
    echo -e "${RED}Deployment failed!${NC}"
    exit 1
fi
