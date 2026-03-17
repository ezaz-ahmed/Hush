package models

import (
	"testing"
	"time"
)

func TestUserModel(t *testing.T) {
	user := &User{
		ID:        "usr_123",
		Email:     "test@example.com",
		Password:  "hashed_password",
		FirstName: "John",
		LastName:  "Doe",
		Role:      "customer",
		IsActive:  true,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if user.ID != "usr_123" {
		t.Errorf("Expected ID to be usr_123, got %s", user.ID)
	}

	if user.Email != "test@example.com" {
		t.Errorf("Expected email to be test@example.com, got %s", user.Email)
	}
}

func TestProductModel(t *testing.T) {
	product := &Product{
		ID:          "prd_123",
		Name:        "Test Product",
		Description: "A test product",
		Price:       99.99,
		Stock:       100,
		SKU:         "TEST-001",
		Category:    "test",
		ImageURL:    "https://example.com/image.jpg",
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if product.ID != "prd_123" {
		t.Errorf("Expected ID to be prd_123, got %s", product.ID)
	}

	if product.Price != 99.99 {
		t.Errorf("Expected price to be 99.99, got %f", product.Price)
	}
}

func TestOrderModel(t *testing.T) {
	order := &Order{
		ID:        "ord_123",
		UserID:    "usr_123",
		Status:    "pending",
		Total:     199.98,
		Items:     []OrderItem{},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if order.ID != "ord_123" {
		t.Errorf("Expected ID to be ord_123, got %s", order.ID)
	}

	if order.Status != "pending" {
		t.Errorf("Expected status to be pending, got %s", order.Status)
	}
}
