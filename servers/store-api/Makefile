# Makefile for Store API
.PHONY: build run test clean docker-build docker-up docker-down migrate help

# Variables
BINARY_NAME=store-api
DOCKER_IMAGE=$(BINARY_NAME):latest
ENV?=dev

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## Build the application locally
	@echo "Building $(BINARY_NAME)..."
	@go build -o bin/$(BINARY_NAME) ./cmd/store-api

run: ## Run the application locally
	@echo "Running $(BINARY_NAME) in $(ENV) environment..."
	@go run ./cmd/store-api

test: ## Run tests
	@echo "Running tests..."
	@go test -v -race ./...

test-coverage: ## Run tests with coverage
	@echo "Running tests with coverage..."
	@go test -v -race -coverprofile=coverage.out ./...
	@go tool cover -html=coverage.out

clean: ## Clean build artifacts
	@echo "Cleaning..."
	@rm -rf bin/
	@rm -f coverage.out

fmt: ## Format code
	@echo "Formatting code..."
	@go fmt ./...
	@goimports -w .

lint: ## Run linter
	@echo "Running linter..."
	@golangci-lint run

docker-build: ## Build Docker image
	@echo "Building Docker image $(DOCKER_IMAGE)..."
	@docker build -t $(DOCKER_IMAGE) -f deploy/Dockerfile .

docker-up: ## Start Docker containers
	@echo "Starting Docker containers ($(ENV))..."
	@docker-compose --env-file configs/.env.$(ENV) up -d

docker-down: ## Stop Docker containers
	@echo "Stopping Docker containers..."
	@docker-compose down

docker-logs: ## View Docker logs
	@echo "Viewing logs..."
	@docker-compose logs -f store-api

db-migrate: ## Run database migrations
	@echo "Running migrations..."
	@bash scripts/migrate.sh

db-rollback: ## Rollback database migrations
	@echo "Rolling back migrations..."
	@psql -h localhost -U user -d store_api_dev -f migrations/001_init_schema.down.sql

dev-setup: ## Setup development environment
	@echo "Setting up development environment..."
	@go mod download
	@go mod tidy
	@echo "✓ Development environment setup complete"

deps: ## Download dependencies
	@echo "Downloading dependencies..."
	@go mod download
	@go mod tidy

.DEFAULT_GOAL := help
