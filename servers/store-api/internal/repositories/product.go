package repositories

import (
	"context"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProductRepository handles product database operations
type ProductRepository struct {
	pool *pgxpool.Pool
}

// NewProductRepository creates a new product repository
func NewProductRepository(pool *pgxpool.Pool) *ProductRepository {
	return &ProductRepository{pool: pool}
}

// CreateProduct creates a new product
func (r *ProductRepository) CreateProduct(ctx context.Context, product *models.Product) error {
	query := `
		INSERT INTO products (id, name, description, price, stock, sku, category, image_url, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`
	_, err := r.pool.Exec(ctx, query,
		product.ID, product.Name, product.Description, product.Price, product.Stock,
		product.SKU, product.Category, product.ImageURL, product.IsActive, product.CreatedAt, product.UpdatedAt,
	)
	return err
}

// GetProductByID retrieves a product by ID
func (r *ProductRepository) GetProductByID(ctx context.Context, productID string) (*models.Product, error) {
	query := `
		SELECT id, name, description, price, stock, sku, category, image_url, is_active, created_at, updated_at
		FROM products
		WHERE id = $1 AND is_active = true
	`
	product := &models.Product{}
	err := r.pool.QueryRow(ctx, query, productID).Scan(
		&product.ID, &product.Name, &product.Description, &product.Price, &product.Stock,
		&product.SKU, &product.Category, &product.ImageURL, &product.IsActive, &product.CreatedAt, &product.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return product, nil
}

// UpdateProduct updates a product
func (r *ProductRepository) UpdateProduct(ctx context.Context, product *models.Product) error {
	query := `
		UPDATE products
		SET name = $1, description = $2, price = $3, stock = $4, category = $5, image_url = $6, is_active = $7, updated_at = $8
		WHERE id = $9
	`
	_, err := r.pool.Exec(ctx, query,
		product.Name, product.Description, product.Price, product.Stock, product.Category,
		product.ImageURL, product.IsActive, product.UpdatedAt, product.ID,
	)
	return err
}

// DeleteProduct soft deletes a product
func (r *ProductRepository) DeleteProduct(ctx context.Context, productID string) error {
	query := `UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1`
	_, err := r.pool.Exec(ctx, query, productID)
	return err
}

// ListProducts lists all active products
func (r *ProductRepository) ListProducts(ctx context.Context, limit, offset int) ([]*models.Product, error) {
	query := `
		SELECT id, name, description, price, stock, sku, category, image_url, is_active, created_at, updated_at
		FROM products
		WHERE is_active = true
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`
	rows, err := r.pool.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	products := make([]*models.Product, 0)
	for rows.Next() {
		product := &models.Product{}
		err := rows.Scan(
			&product.ID, &product.Name, &product.Description, &product.Price, &product.Stock,
			&product.SKU, &product.Category, &product.ImageURL, &product.IsActive, &product.CreatedAt, &product.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		products = append(products, product)
	}

	return products, rows.Err()
}

// ListProductsByCategory lists products by category
func (r *ProductRepository) ListProductsByCategory(ctx context.Context, category string, limit, offset int) ([]*models.Product, error) {
	query := `
		SELECT id, name, description, price, stock, sku, category, image_url, is_active, created_at, updated_at
		FROM products
		WHERE category = $1 AND is_active = true
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.pool.Query(ctx, query, category, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	products := make([]*models.Product, 0)
	for rows.Next() {
		product := &models.Product{}
		err := rows.Scan(
			&product.ID, &product.Name, &product.Description, &product.Price, &product.Stock,
			&product.SKU, &product.Category, &product.ImageURL, &product.IsActive, &product.CreatedAt, &product.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		products = append(products, product)
	}

	return products, rows.Err()
}
