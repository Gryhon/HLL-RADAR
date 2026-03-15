package config

import (
	"fmt"
	"log/slog"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/viper"
)

// Load loads the configuration from config.toml
func Load() error {
	viper.SetConfigName("config")
	viper.SetConfigType("toml")
	viper.AddConfigPath(".")    // Project root (local dev) or /app (Docker)

	if err := viper.ReadInConfig(); err != nil {
		return fmt.Errorf("error reading config file: %w", err)
	}

	return nil
}

// StartWatching enables config file hot reloading
func StartWatching(logger *slog.Logger) {
	viper.WatchConfig()
	viper.OnConfigChange(func(e fsnotify.Event) {
		logger.Info("Config file changed, reloading", "file", e.Name, "operation", e.Op.String())

		// Re-validate config after reload
		if err := Validate(); err != nil {
			logger.Error("Config validation failed after reload", "error", err)
		} else {
			logger.Info("Config reloaded successfully")
		}
	})
}

// ServerConfig represents a single RCON server configuration
type ServerConfig struct {
	Name        string `mapstructure:"name"`
	DisplayName string `mapstructure:"display_name"`
	Host        string `mapstructure:"host"`
	Port        int    `mapstructure:"port"`
	Password    string `mapstructure:"password"`
	Enabled     bool   `mapstructure:"enabled"`
}

// GetServers returns all configured servers
func GetServers() ([]ServerConfig, error) {
	var servers []ServerConfig
	if err := viper.UnmarshalKey("servers", &servers); err != nil {
		return nil, fmt.Errorf("failed to unmarshal servers: %w", err)
	}
	return servers, nil
}

// Validate validates that all required configuration values are present
func Validate() error {
	servers, err := GetServers()
	if err != nil {
		return fmt.Errorf("failed to get servers: %w", err)
	}

	if len(servers) == 0 {
		return fmt.Errorf("no servers configured - at least one server is required")
	}

	for i, server := range servers {
		if server.Name == "" {
			return fmt.Errorf("server %d: name is required", i)
		}
		if server.DisplayName == "" {
			return fmt.Errorf("server %s: display_name is required", server.Name)
		}
		if server.Host == "" {
			return fmt.Errorf("server %s: host is required", server.Name)
		}
		if server.Port == 0 {
			return fmt.Errorf("server %s: port is required", server.Name)
		}
		if server.Password == "" {
			return fmt.Errorf("server %s: password is required", server.Name)
		}
	}

	return nil
}
