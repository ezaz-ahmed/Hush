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

// UserHandler handles user endpoints
type UserHandler struct {
	service *services.UserService
	logger  *zap.Logger
}

// NewUserHandler creates a new user handler
func NewUserHandler(service *services.UserService, logger *zap.Logger) *UserHandler {
	return &UserHandler{service: service, logger: logger}
}

// RegisterUser registers a new user
func (h *UserHandler) RegisterUser(w http.ResponseWriter, r *http.Request) {
	req := &models.CreateUserRequest{}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		h.logger.Error("Failed to decode request", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	user, err := h.service.RegisterUser(r.Context(), req)
	if err != nil {
		h.logger.Error("Failed to register user", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, err.Error())
		return
	}

	response.SendSuccess(w, http.StatusCreated, "User registered successfully", user)
}

// GetUser retrieves a user
func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")

	user, err := h.service.GetUser(r.Context(), userID)
	if err != nil {
		h.logger.Error("Failed to get user", zap.Error(err))
		response.SendError(w, http.StatusNotFound, "User not found")
		return
	}

	response.SendSuccess(w, http.StatusOK, "User retrieved successfully", user)
}

// UpdateUser updates a user
func (h *UserHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")

	req := &models.UpdateUserRequest{}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		h.logger.Error("Failed to decode request", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	user, err := h.service.UpdateUser(r.Context(), userID, req)
	if err != nil {
		h.logger.Error("Failed to update user", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, err.Error())
		return
	}

	response.SendSuccess(w, http.StatusOK, "User updated successfully", user)
}

// ListUsers lists all users
func (h *UserHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
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

	users, err := h.service.ListUsers(r.Context(), limit, offset)
	if err != nil {
		h.logger.Error("Failed to list users", zap.Error(err))
		response.SendError(w, http.StatusInternalServerError, "Failed to list users")
		return
	}

	response.SendSuccess(w, http.StatusOK, "Users retrieved successfully", users)
}
