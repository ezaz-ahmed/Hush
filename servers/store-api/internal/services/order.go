package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/models"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/repositories"
)

// OrderService handles order business logic
type OrderService struct {
	orderRepo   *repositories.OrderRepository
	productRepo *repositories.ProductRepository
}

// NewOrderService creates a new order service
func NewOrderService(orderRepo *repositories.OrderRepository, productRepo *repositories.ProductRepository) *OrderService {
	return &OrderService{
		orderRepo:   orderRepo,
		productRepo: productRepo,
	}
}

// CreateOrder creates a new order
func (s *OrderService) CreateOrder(ctx context.Context, userID string, req *models.CreateOrderRequest) (*models.Order, error) {
	if len(req.Items) == 0 {
		return nil, errors.New("order must have at least one item")
	}

	var total float64
	items := make([]models.OrderItem, 0)

	// Validate and calculate total
	for _, itemReq := range req.Items {
		product, err := s.productRepo.GetProductByID(ctx, itemReq.ProductID)
		if err != nil {
			return nil, fmt.Errorf("product not found: %s", itemReq.ProductID)
		}

		if product.Stock < itemReq.Quantity {
			return nil, fmt.Errorf("insufficient stock for product: %s", itemReq.ProductID)
		}

		itemTotal := product.Price * float64(itemReq.Quantity)
		total += itemTotal

		item := models.OrderItem{
			ID:        fmt.Sprintf("itm_%d", time.Now().UnixNano()),
			ProductID: itemReq.ProductID,
			Quantity:  itemReq.Quantity,
			UnitPrice: product.Price,
			CreatedAt: time.Now(),
		}
		items = append(items, item)
	}

	order := &models.Order{
		ID:        fmt.Sprintf("ord_%d", time.Now().UnixNano()),
		UserID:    userID,
		Status:    "pending",
		Total:     total,
		Items:     items,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.orderRepo.CreateOrder(ctx, order); err != nil {
		return nil, fmt.Errorf("failed to create order: %w", err)
	}

	// Add items to order
	for i := range order.Items {
		order.Items[i].OrderID = order.ID
		if err := s.orderRepo.AddOrderItem(ctx, &order.Items[i]); err != nil {
			return nil, fmt.Errorf("failed to add order item: %w", err)
		}
	}

	return order, nil
}

// GetOrder retrieves an order
func (s *OrderService) GetOrder(ctx context.Context, orderID string) (*models.Order, error) {
	order, err := s.orderRepo.GetOrderByID(ctx, orderID)
	if err != nil {
		return nil, fmt.Errorf("order not found: %w", err)
	}
	return order, nil
}

// UpdateOrderStatus updates the status of an order
func (s *OrderService) UpdateOrderStatus(ctx context.Context, orderID, status string) error {
	validStatuses := map[string]bool{
		"pending":    true,
		"confirmed":  true,
		"shipped":    true,
		"delivered":  true,
		"cancelled":  true,
	}

	if !validStatuses[status] {
		return errors.New("invalid order status")
	}

	if err := s.orderRepo.UpdateOrderStatus(ctx, orderID, status); err != nil {
		return fmt.Errorf("failed to update order status: %w", err)
	}

	return nil
}

// ListUserOrders lists all orders for a user
func (s *OrderService) ListUserOrders(ctx context.Context, userID string, limit, offset int) ([]*models.Order, error) {
	orders, err := s.orderRepo.ListUserOrders(ctx, userID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list orders: %w", err)
	}
	return orders, nil
}
