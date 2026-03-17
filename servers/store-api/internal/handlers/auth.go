package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/models"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/response"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/services"
	"go.uber.org/zap"
)

// AuthHandler handles authentication endpoints
type AuthHandler struct {
	service *services.UserService
	logger  *zap.Logger
}

// NewAuthHandler creates a new auth handler
func NewAuthHandler(service *services.UserService, logger *zap.Logger) *AuthHandler {
	return &AuthHandler{service: service, logger: logger}
}

// Login handles user login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	req := &models.LoginRequest{}
	if err := json.NewDecoder(r.Body).Decode(req); err != nil {
		h.logger.Error("Failed to decode request", zap.Error(err))
		response.SendError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	user, err := h.service.ValidatePassword(r.Context(), req.Email, req.Password)
	if err != nil {
		h.logger.Error("Failed to login", zap.Error(err))
		response.SendError(w, http.StatusUnauthorized, err.Error())
		return
	}

	// TODO: Generate JWT token
	loginResponse := &models.LoginResponse{
		Token: "jwt_token_placeholder",
		User:  *user,
	}

	response.SendSuccess(w, http.StatusOK, "Login successful", loginResponse)
}

// HealthCheck handles health check endpoint
func (h *AuthHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	response.SendSuccess(w, http.StatusOK, "Service is healthy", map[string]string{"status": "ok"})
}
