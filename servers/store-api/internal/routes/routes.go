package routes

import (
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/handlers"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/middleware"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// Router sets up all routes
func Router(
	userHandler *handlers.UserHandler,
	productHandler *handlers.ProductHandler,
	orderHandler *handlers.OrderHandler,
	authHandler *handlers.AuthHandler,
	logger *zap.Logger,
) chi.Router {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.JSONContentTypeMiddleware)
	r.Use(middleware.CORSMiddleware(nil))
	r.Use(middleware.LoggingMiddleware(logger))

	// Health check
	r.Get("/health", authHandler.HealthCheck)

	// Auth routes
	r.Post("/v1/auth/login", authHandler.Login)
	r.Post("/v1/auth/register", userHandler.RegisterUser)

	// User routes
	r.Route("/v1/users", func(r chi.Router) {
		r.Get("/", userHandler.ListUsers)
		r.Get("/{id}", userHandler.GetUser)
		r.Put("/{id}", userHandler.UpdateUser)
	})

	// Product routes
	r.Route("/v1/products", func(r chi.Router) {
		r.Get("/", productHandler.ListProducts)
		r.Post("/", productHandler.CreateProduct)
		r.Get("/{id}", productHandler.GetProduct)
		r.Put("/{id}", productHandler.UpdateProduct)
		r.Delete("/{id}", productHandler.DeleteProduct)
		r.Get("/category/{category}", productHandler.ListProductsByCategory)
	})

	// Order routes
	r.Route("/v1/users/{userId}/orders", func(r chi.Router) {
		r.Get("/", orderHandler.ListUserOrders)
		r.Post("/", orderHandler.CreateOrder)
		r.Get("/{id}", orderHandler.GetOrder)
		r.Put("/{id}", orderHandler.UpdateOrderStatus)
	})

	return r
}
