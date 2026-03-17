package config

import (
	"fmt"
	"os"
	"strconv"
)

const (
	Dev        = "dev"
	Staging    = "staging"
	Production = "production"
)

// Config holds application configuration loaded from environment variables.
type Config struct {
	Port           int
	Host           string
	Env            string
	DatabaseURL    string
	MaxConns       int
	MinConns       int
	JWTSecret      string
	AllowedOrigins []string
	LogLevel       string
}

// Load reads environment variables and returns a Config.
// Panics if required values are missing in production.
func Load() *Config {
	cfg := &Config{
		Port:           getEnvInt("PORT", 8080),
		Host:           getEnvString("HOST", "0.0.0.0"),
		Env:            getEnvString("ENV", Dev),
		DatabaseURL:    getEnvString("DATABASE_URL", ""),
		MaxConns:       getEnvInt("DB_MAX_CONNS", 25),
		MinConns:       getEnvInt("DB_MIN_CONNS", 5),
		JWTSecret:      getEnvString("JWT_SECRET", "your-secret-key"),
		AllowedOrigins: []string{"*"},
		LogLevel:       getEnvString("LOG_LEVEL", "info"),
	}

	if cfg.DatabaseURL == "" && cfg.IsProduction() {
		panic("DATABASE_URL is required in production")
	}

	return cfg
}

// getEnvString retrieves a string environment variable or returns a default.
func getEnvString(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

// getEnvInt retrieves an integer environment variable or returns a default.
func getEnvInt(key string, defaultValue int) int {
	if v := os.Getenv(key); v != "" {
		if intValue, err := strconv.Atoi(v); err == nil {
			return intValue
		}
	}
	return defaultValue
}

// GetServerAddr returns the server address in host:port format.
func (c *Config) GetServerAddr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// IsProduction returns true if the environment is production.
func (c *Config) IsProduction() bool {
	return c.Env == Production
}

// IsStaging returns true if the environment is staging.
func (c *Config) IsStaging() bool {
	return c.Env == Staging
}

// IsDevelopment returns true if the environment is development.
func (c *Config) IsDevelopment() bool {
	return c.Env == Dev
}