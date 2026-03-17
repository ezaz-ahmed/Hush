#!/bin/bash

# Build script for Store API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Environment defaults
ENV=${1:-dev}
DOCKER_IMAGE=${2:-store-api:latest}

echo -e "${YELLOW}Building Store API for environment: ${ENV}${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed!${NC}"
    exit 1
fi

# Build Docker image
echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t "${DOCKER_IMAGE}" -f deploy/Dockerfile .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Build completed successfully!${NC}"
    echo "Image: ${DOCKER_IMAGE}"
else
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi
