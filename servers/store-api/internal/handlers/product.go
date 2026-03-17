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

// ProductHandler handles product endpoints
type ProductHandler struct {
	service *services.ProductService
	logger  *zap.Logger
}

// NewProductHandler creates a new product handler
func NewProductHandler(service *services.ProductService, logger *zap.Logger) *ProductHandler {
	return &ProductHandler{service: service, logger: logger}
}

// CreateProduct creates a new product
func (h *ProductHandler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	req := &models.CreateProductRequest{}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		h.logger.Error("Failed to decode request", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	product, err := h.service.CreateProduct(r.Context(), req)
	if err != nil {
		h.logger.Error("Failed to create product", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, err.Error())
		return
	}

	response.SendSuccess(w, http.StatusCreated, "Product created successfully", product)
}

// GetProduct retrieves a product
func (h *ProductHandler) GetProduct(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "id")

	product, err := h.service.GetProduct(r.Context(), productID)
	if err != nil {
		h.logger.Error("Failed to get product", zap.Error(err))
		response.SendError(w, http.StatusNotFound, "Product not found")
		return
	}

	response.SendSuccess(w, http.StatusOK, "Product retrieved successfully", product)
}

// UpdateProduct updates a product
func (h *ProductHandler) UpdateProduct(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "id")

	req := &models.UpdateProductRequest{}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		h.logger.Error("Failed to decode request", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	product, err := h.service.UpdateProduct(r.Context(), productID, req)
	if err != nil {
		h.logger.Error("Failed to update product", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, err.Error())
		return
	}

	response.SendSuccess(w, http.StatusOK, "Product updated successfully", product)
}

// DeleteProduct deletes a product
func (h *ProductHandler) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	productID := chi.URLParam(r, "id")

	if err := h.service.DeleteProduct(r.Context(), productID); err != nil {
		h.logger.Error("Failed to delete product", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, err.Error())
		return
	}

	response.SendSuccess(w, http.StatusOK, "Product deleted successfully", nil)
}

// ListProducts lists all products
func (h *ProductHandler) ListProducts(w http.ResponseWriter, r *http.Request) {
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

	products, err := h.service.ListProducts(r.Context(), limit, offset)
	if err != nil {
		h.logger.Error("Failed to list products", zap.Error(err))
		response.SendError(w, http.StatusInternalServerError, "Failed to list products")
		return
	}

	response.SendSuccess(w, http.StatusOK, "Products retrieved successfully", products)
}

// ListProductsByCategory lists products by category
func (h *ProductHandler) ListProductsByCategory(w http.ResponseWriter, r *http.Request) {
	category := chi.URLParam(r, "category")
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

	products, err := h.service.ListProductsByCategory(r.Context(), category, limit, offset)
	if err != nil {
		h.logger.Error("Failed to list products", zap.Error(err))
		response.SendError(w, http.StatusInternalServerError, "Failed to list products")
		return
	}

	response.SendSuccess(w, http.StatusOK, "Products retrieved successfully", products)
}
