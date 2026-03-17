# Quick Start Guide for Store API

### With Docker (Recommended)

```bash
# 1. Navigate to the project
cd servers/store-api

# 2. Start services (DB + API)
docker compose up -d

# 3. Wait for startup (check logs)
docker compose logs -f

# 4. Test the API
curl http://localhost:8080/health
```

### Local Development

```bash
# 1. Navigate to the project
cd servers/store-api

# 2. Download dependencies
go mod download

# 3. Start PostgreSQL (or use docker)
docker compose up -d store-api-db

# 4. Run migrations
bash scripts/migrate.sh

# 5. Run the application
go run ./cmd/store-api

# 6. Test the API
curl http://localhost:8080/health
```
