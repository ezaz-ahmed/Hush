package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/config"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/db"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/handlers"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/logging"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/repositories"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/routes"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/services"
	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

func main() {
	// Load environment variables from .env file
	_ = godotenv.Load()

	// Load configuration
	cfg := config.Load()

	// Initialize logger
	logger, err := logging.NewLogger(cfg.LogLevel)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	logger.Info("Starting Store API",
		zap.String("env", cfg.Env),
		zap.String("host", cfg.Host),
		zap.Int("port", cfg.Port),
	)

	// Initialize database
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	database, err := db.NewDatabase(ctx, cfg.DatabaseURL, cfg.MaxConns, cfg.MinConns)
	if err != nil {
		logger.Error("Failed to initialize database", zap.Error(err))
		os.Exit(1)
	}
	defer database.Close()

	logger.Info("Database connection established")

	// Initialize repositories
	userRepo := repositories.NewUserRepository(database.GetPool())
	productRepo := repositories.NewProductRepository(database.GetPool())
	orderRepo := repositories.NewOrderRepository(database.GetPool())

	// Initialize services
	userService := services.NewUserService(userRepo)
	productService := services.NewProductService(productRepo)
	orderService := services.NewOrderService(orderRepo, productRepo)

	// Initialize handlers
	userHandler := handlers.NewUserHandler(userService, logger.Logger)
	productHandler := handlers.NewProductHandler(productService, logger.Logger)
	orderHandler := handlers.NewOrderHandler(orderService, logger.Logger)
	authHandler := handlers.NewAuthHandler(userService, logger.Logger)

	// Setup router
	router := routes.Router(userHandler, productHandler, orderHandler, authHandler, logger.Logger)

	// Create HTTP server
	server := &http.Server{
		Addr:         cfg.GetServerAddr(),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine
	go func() {
		logger.Info("Server starting", zap.String("address", server.Addr))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Server error", zap.Error(err))
		}
	}()

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("Shutting down server...")

	ctx, cancel = context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("Server shutdown error", zap.Error(err))
		os.Exit(1)
	}

	logger.Info("Server stopped gracefully")
}
