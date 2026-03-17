#!/bin/bash

# Migrate database script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Environment
ENV=${1:-dev}

# Load environment variables from config file
ENV_FILE="configs/.env.${ENV}"
if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}Loading environment from ${ENV_FILE}${NC}"
    set -a
    source "$ENV_FILE"
    set +a
fi

# Load .env.local if it exists (overrides config file)
if [ -f ".env.local" ]; then
    echo -e "${YELLOW}Loading environment from .env.local${NC}"
    set -a
    source ".env.local"
    set +a
fi

# Load .env if it exists (overrides both)
if [ -f ".env" ]; then
    echo -e "${YELLOW}Loading environment from .env${NC}"
    set -a
    source ".env"
    set +a
fi

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL is not set in environment or ${ENV_FILE}${NC}"
    exit 1
fi

echo -e "${YELLOW}Running database migrations (Environment: ${ENV})${NC}"

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}psql is not installed!${NC}"
    exit 1
fi

# Run migrations
echo -e "${YELLOW}Applying migrations...${NC}"
for f in migrations/*.up.sql; do
    echo -e "${YELLOW}Applying $f...${NC}"
    psql "$DATABASE_URL" -f "$f"
done

echo -e "${GREEN}Migrations completed successfully!${NC}"