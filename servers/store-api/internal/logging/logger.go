package logging

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Logger wraps a zap.Logger instance.
type Logger struct {
	*zap.Logger
}

// NewLogger creates a new zap logger configured based on the log level.
// Supports: "debug", "info", "error". Defaults to "info".
func NewLogger(logLevel string) (*Logger, error) {
	var cfg zap.Config

	switch logLevel {
	case "debug":
		cfg = zap.NewDevelopmentConfig()
		cfg.Level = zap.NewAtomicLevelAt(zapcore.DebugLevel)
	case "error":
		cfg = zap.NewProductionConfig()
		cfg.Level = zap.NewAtomicLevelAt(zapcore.ErrorLevel)
	default: // "info" or any unknown value
		cfg = zap.NewProductionConfig()
		cfg.Level = zap.NewAtomicLevelAt(zapcore.InfoLevel)
	}

	logger, err := cfg.Build()
	if err != nil {
		return nil, err
	}

	return &Logger{logger}, nil
}

// Sync flushes any buffered log entries.
func (l *Logger) Sync() error {
	return l.Logger.Sync()
}