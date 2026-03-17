package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Database wraps a pgx connection pool.
type Database struct {
	pool *pgxpool.Pool
}

// NewDatabase creates a new database connection pool.
// maxConns and minConns are used for pooling; if pooling is disabled, pass 0 for both.
func NewDatabase(ctx context.Context, databaseURL string, maxConns, minConns int) (*Database, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database config: %w", err)
	}

	// Only set pool limits if values are positive
	if maxConns > 0 {
		config.MaxConns = int32(maxConns)
	}
	if minConns > 0 {
		config.MinConns = int32(minConns)
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to create database pool: %w", err)
	}

	// Verify connection immediately
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return &Database{pool: pool}, nil
}

// GetPool returns the underlying connection pool.
func (db *Database) GetPool() *pgxpool.Pool {
	return db.pool
}

// Close closes the database connection pool.
func (db *Database) Close() {
	db.pool.Close()
}

// Health pings the database to check connectivity.
func (db *Database) Health(ctx context.Context) error {
	return db.pool.Ping(ctx)
}