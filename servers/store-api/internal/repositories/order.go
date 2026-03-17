package repositories

import (
	"context"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OrderRepository handles order database operations
type OrderRepository struct {
	pool *pgxpool.Pool
}

// NewOrderRepository creates a new order repository
func NewOrderRepository(pool *pgxpool.Pool) *OrderRepository {
	return &OrderRepository{pool: pool}
}

// CreateOrder creates a new order
func (r *OrderRepository) CreateOrder(ctx context.Context, order *models.Order) error {
	query := `
		INSERT INTO orders (id, user_id, status, total, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := r.pool.Exec(ctx, query,
		order.ID, order.UserID, order.Status, order.Total, order.CreatedAt, order.UpdatedAt,
	)
	return err
}

// AddOrderItem adds an item to an order
func (r *OrderRepository) AddOrderItem(ctx context.Context, item *models.OrderItem) error {
	query := `
		INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := r.pool.Exec(ctx, query,
		item.ID, item.OrderID, item.ProductID, item.Quantity, item.UnitPrice, item.CreatedAt,
	)
	return err
}

// GetOrderByID retrieves an order with its items
func (r *OrderRepository) GetOrderByID(ctx context.Context, orderID string) (*models.Order, error) {
	query := `
		SELECT id, user_id, status, total, created_at, updated_at
		FROM orders
		WHERE id = $1
	`
	order := &models.Order{}
	err := r.pool.QueryRow(ctx, query, orderID).Scan(
		&order.ID, &order.UserID, &order.Status, &order.Total, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Get order items
	itemQuery := `
		SELECT id, order_id, product_id, quantity, unit_price, created_at
		FROM order_items
		WHERE order_id = $1
	`
	rows, err := r.pool.Query(ctx, itemQuery, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]models.OrderItem, 0)
	for rows.Next() {
		item := models.OrderItem{}
		err := rows.Scan(&item.ID, &item.OrderID, &item.ProductID, &item.Quantity, &item.UnitPrice, &item.CreatedAt)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	order.Items = items
	return order, rows.Err()
}

// UpdateOrderStatus updates the status of an order
func (r *OrderRepository) UpdateOrderStatus(ctx context.Context, orderID, status string) error {
	query := `
		UPDATE orders
		SET status = $1, updated_at = NOW()
		WHERE id = $2
	`
	_, err := r.pool.Exec(ctx, query, status, orderID)
	return err
}

// ListUserOrders lists all orders for a user
func (r *OrderRepository) ListUserOrders(ctx context.Context, userID string, limit, offset int) ([]*models.Order, error) {
	query := `
		SELECT id, user_id, status, total, created_at, updated_at
		FROM orders
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	orders := make([]*models.Order, 0)
	for rows.Next() {
		order := &models.Order{}
		err := rows.Scan(&order.ID, &order.UserID, &order.Status, &order.Total, &order.CreatedAt, &order.UpdatedAt)
		if err != nil {
			return nil, err
		}
		orders = append(orders, order)
	}

	return orders, rows.Err()
}
