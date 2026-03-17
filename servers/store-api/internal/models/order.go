package models

import "time"

// Order represents an order in the system
type Order struct {
	ID        string        `json:"id"`
	UserID    string        `json:"user_id"`
	Status    string        `json:"status"` // pending, confirmed, shipped, delivered, cancelled
	Total     float64       `json:"total"`
	Items     []OrderItem   `json:"items"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
}

// OrderItem represents an item in an order
type OrderItem struct {
	ID        string    `json:"id"`
	OrderID   string    `json:"order_id"`
	ProductID string    `json:"product_id"`
	Quantity  int       `json:"quantity"`
	UnitPrice float64   `json:"unit_price"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateOrderRequest represents the request body for creating an order
type CreateOrderRequest struct {
	Items []OrderItemRequest `json:"items" validate:"required,min=1"`
}

// OrderItemRequest represents an item in the order request
type OrderItemRequest struct {
	ProductID string `json:"product_id" validate:"required"`
	Quantity  int    `json:"quantity" validate:"required,gt=0"`
}

// UpdateOrderStatusRequest represents the request to update order status
type UpdateOrderStatusRequest struct {
	Status string `json:"status" validate:"required,oneof=pending confirmed shipped delivered cancelled"`
}
