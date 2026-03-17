package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/models"
	"github.com/ezaz-ahmed/codewind/servers/store-api/internal/repositories"
	"golang.org/x/crypto/bcrypt"
)

// UserService handles user business logic
type UserService struct {
	repo *repositories.UserRepository
}

// NewUserService creates a new user service
func NewUserService(repo *repositories.UserRepository) *UserService {
	return &UserService{repo: repo}
}

// RegisterUser registers a new user
func (s *UserService) RegisterUser(ctx context.Context, req *models.CreateUserRequest) (*models.User, error) {
	if req.Email == "" || req.Password == "" {
		return nil, errors.New("email and password are required")
	}

	// Check if user already exists
	existingUser, err := s.repo.GetUserByEmail(ctx, req.Email)
	if err == nil && existingUser != nil {
		return nil, errors.New("user with this email already exists")
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user := &models.User{
		ID:        fmt.Sprintf("usr_%d", time.Now().UnixNano()),
		Email:     req.Email,
		Password:  string(hashedPassword),
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Role:      "customer",
		IsActive:  true,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.repo.CreateUser(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	user.Password = "" // Never return password
	return user, nil
}

// GetUser retrieves a user by ID
func (s *UserService) GetUser(ctx context.Context, userID string) (*models.User, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	user.Password = "" // Never return password
	return user, nil
}

// UpdateUser updates a user
func (s *UserService) UpdateUser(ctx context.Context, userID string, req *models.UpdateUserRequest) (*models.User, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	if req.FirstName != "" {
		user.FirstName = req.FirstName
	}
	if req.LastName != "" {
		user.LastName = req.LastName
	}
	if req.IsActive != nil {
		user.IsActive = *req.IsActive
	}

	user.UpdatedAt = time.Now()

	if err := s.repo.UpdateUser(ctx, user); err != nil {
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	user.Password = "" // Never return password
	return user, nil
}

// ListUsers lists all users
func (s *UserService) ListUsers(ctx context.Context, limit, offset int) ([]*models.User, error) {
	users, err := s.repo.ListUsers(ctx, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}

	// Remove passwords from response
	for _, user := range users {
		user.Password = ""
	}

	return users, nil
}

// ValidatePassword validates user password
func (s *UserService) ValidatePassword(ctx context.Context, email, password string) (*models.User, error) {
	user, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, errors.New("invalid email or password")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, errors.New("invalid email or password")
	}

	user.Password = "" // Never return password
	return user, nil
}
