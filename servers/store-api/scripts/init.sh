#!/bin/bash

# Make scripts executable
chmod +x scripts/build.sh
chmod +x scripts/deploy.sh
chmod +x scripts/stop.sh
chmod +x scripts/migrate.sh

echo "✓ Store API project initialized successfully!"
echo ""
echo "Next steps:"
echo "1. Copy environment file: cp .env.example .env"
echo "2. Update database credentials in .env"
echo "3. Install dependencies: go mod download"
echo "4. Run locally: go run ./cmd/store-api"
echo "5. Or use Docker: docker-compose up"
echo ""
echo "For more information, see README.md and DEPLOYMENT.md"
