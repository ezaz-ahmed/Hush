package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/models"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/repositories"
)

// ProductService handles product business logic
type ProductService struct {
	repo *repositories.ProductRepository
}

// NewProductService creates a new product service
func NewProductService(repo *repositories.ProductRepository) *ProductService {
	return &ProductService{repo: repo}
}

// CreateProduct creates a new product
func (s *ProductService) CreateProduct(ctx context.Context, req *models.CreateProductRequest) (*models.Product, error) {
	if req.Name == "" || req.Price <= 0 {
		return nil, errors.New("invalid product data")
	}

	product := &models.Product{
		ID:          fmt.Sprintf("prd_%d", time.Now().UnixNano()),
		Name:        req.Name,
		Description: req.Description,
		Price:       req.Price,
		Stock:       req.Stock,
		SKU:         req.SKU,
		Category:    req.Category,
		ImageURL:    req.ImageURL,
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.repo.CreateProduct(ctx, product); err != nil {
		return nil, fmt.Errorf("failed to create product: %w", err)
	}

	return product, nil
}

// GetProduct retrieves a product by ID
func (s *ProductService) GetProduct(ctx context.Context, productID string) (*models.Product, error) {
	product, err := s.repo.GetProductByID(ctx, productID)
	if err != nil {
		return nil, fmt.Errorf("product not found: %w", err)
	}
	return product, nil
}

// UpdateProduct updates a product
func (s *ProductService) UpdateProduct(ctx context.Context, productID string, req *models.UpdateProductRequest) (*models.Product, error) {
	product, err := s.repo.GetProductByID(ctx, productID)
	if err != nil {
		return nil, fmt.Errorf("product not found: %w", err)
	}

	if req.Name != "" {
		product.Name = req.Name
	}
	if req.Description != "" {
		product.Description = req.Description
	}
	if req.Price != nil && *req.Price > 0 {
		product.Price = *req.Price
	}
	if req.Stock != nil && *req.Stock >= 0 {
		product.Stock = *req.Stock
	}
	if req.Category != "" {
		product.Category = req.Category
	}
	if req.ImageURL != "" {
		product.ImageURL = req.ImageURL
	}
	if req.IsActive != nil {
		product.IsActive = *req.IsActive
	}

	product.UpdatedAt = time.Now()

	if err := s.repo.UpdateProduct(ctx, product); err != nil {
		return nil, fmt.Errorf("failed to update product: %w", err)
	}

	return product, nil
}

// DeleteProduct deletes a product
func (s *ProductService) DeleteProduct(ctx context.Context, productID string) error {
	if err := s.repo.DeleteProduct(ctx, productID); err != nil {
		return fmt.Errorf("failed to delete product: %w", err)
	}
	return nil
}

// ListProducts lists all products
func (s *ProductService) ListProducts(ctx context.Context, limit, offset int) ([]*models.Product, error) {
	products, err := s.repo.ListProducts(ctx, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list products: %w", err)
	}
	return products, nil
}

// ListProductsByCategory lists products by category
func (s *ProductService) ListProductsByCategory(ctx context.Context, category string, limit, offset int) ([]*models.Product, error) {
	products, err := s.repo.ListProductsByCategory(ctx, category, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list products: %w", err)
	}
	return products, nil
}
