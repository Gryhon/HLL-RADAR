package logging

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/lmittmann/tint"
	"github.com/spf13/viper"
)

// runLogFile is the shared log file for the current run, opened once at startup
var runLogFile *os.File

// Init initializes the logging system. If file logging is enabled, creates a
// single timestamped log file for this run (e.g. logs/hll-radar_2025-01-15_14-30-00.log).
// Must be called before CreateLogger.
func Init() error {
	if !viper.GetBool("global.log_file") {
		return nil
	}

	if err := os.MkdirAll("logs", 0755); err != nil {
		return fmt.Errorf("failed to create logs directory: %w", err)
	}

	timestamp := time.Now().Format("2006-01-02_15-04-05")
	filename := fmt.Sprintf("logs/hll-radar_%s.log", timestamp)

	f, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file %s: %w", filename, err)
	}

	runLogFile = f
	return nil
}

// Close closes the shared log file. Call on shutdown.
func Close() {
	if runLogFile != nil {
		runLogFile.Close()
		runLogFile = nil
	}
}

// CreateLogger creates a logger for a module that writes to stdout and optionally to the run log file
func CreateLogger(name string) *slog.Logger {
	level := parseLevel(getLogLevel(name))

	var writer io.Writer = os.Stdout
	if runLogFile != nil {
		writer = io.MultiWriter(runLogFile, os.Stdout)
	}

	handler := tint.NewHandler(writer, &tint.Options{
		Level:      level,
		TimeFormat: time.Kitchen,
	})

	return slog.New(handler).With("module", name)
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// getLogLevel gets the log level for a module.
// Checks module-specific key first (e.g. "tracker.log_level"),
// then base module name for suffixed loggers (e.g. "tracker-server1" checks "tracker.log_level"),
// then falls back to "global.log_level".
func getLogLevel(module string) string {
	// Try exact module name first
	moduleKey := module + ".log_level"
	if viper.IsSet(moduleKey) {
		return viper.GetString(moduleKey)
	}
	// Try base name (before first "-") for suffixed loggers like "tracker-server1"
	if idx := strings.IndexByte(module, '-'); idx > 0 {
		baseKey := module[:idx] + ".log_level"
		if viper.IsSet(baseKey) {
			return viper.GetString(baseKey)
		}
	}
	if viper.IsSet("global.log_level") {
		return viper.GetString("global.log_level")
	}
	return "info"
}
