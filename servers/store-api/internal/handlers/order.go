package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/models"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/response"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/services"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// OrderHandler handles order endpoints
type OrderHandler struct {
	service *services.OrderService
	logger  *zap.Logger
}

// NewOrderHandler creates a new order handler
func NewOrderHandler(service *services.OrderService, logger *zap.Logger) *OrderHandler {
	return &OrderHandler{service: service, logger: logger}
}

// CreateOrder creates a new order
func (h *OrderHandler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")

	req := &models.CreateOrderRequest{}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		h.logger.Error("Failed to decode request", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	order, err := h.service.CreateOrder(r.Context(), userID, req)
	if err != nil {
		h.logger.Error("Failed to create order", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, err.Error())
		return
	}

	response.SendSuccess(w, http.StatusCreated, "Order created successfully", order)
}

// GetOrder retrieves an order
func (h *OrderHandler) GetOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")

	order, err := h.service.GetOrder(r.Context(), orderID)
	if err != nil {
		h.logger.Error("Failed to get order", zap.Error(err))
		response.SendError(w, http.StatusNotFound, "Order not found")
		return
	}

	response.SendSuccess(w, http.StatusOK, "Order retrieved successfully", order)
}

// UpdateOrderStatus updates the status of an order
func (h *OrderHandler) UpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")

	req := &models.UpdateOrderStatusRequest{}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		h.logger.Error("Failed to decode request", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := h.service.UpdateOrderStatus(r.Context(), orderID, req.Status); err != nil {
		h.logger.Error("Failed to update order status", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, err.Error())
		return
	}

	response.SendSuccess(w, http.StatusOK, "Order status updated successfully", nil)
}

// ListUserOrders lists all orders for a user
func (h *OrderHandler) ListUserOrders(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	limit := 10
	offset := 0

	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 {
			limit = val
		}
	}

	if o := r.URL.Query().Get("offset"); o != "" {
		if val, err := strconv.Atoi(o); err == nil && val > 0 {
			offset = val
		}
	}

	orders, err := h.service.ListUserOrders(r.Context(), userID, limit, offset)
	if err != nil {
		h.logger.Error("Failed to list orders", zap.Error(err))
		response.SendError(w, http.StatusInternalServerError, "Failed to list orders")
		return
	}

	response.SendSuccess(w, http.StatusOK, "Orders retrieved successfully", orders)
}
