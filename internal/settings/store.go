package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"dota-bind-studio/internal/domain"
)

type Store struct {
	path string
}

func NewStore() (*Store, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve user home: %w", err)
	}
	cfgDir := filepath.Join(home, ".config", "dota-bind-studio")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return nil, fmt.Errorf("create config dir: %w", err)
	}
	return &Store{path: filepath.Join(cfgDir, "settings.json")}, nil
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Load() (domain.AppSettings, error) {
	var cfg domain.AppSettings

	b, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			cfg = defaultSettings()
			if saveErr := s.Save(cfg); saveErr != nil {
				return cfg, saveErr
			}
			return cfg, nil
		}
		return cfg, fmt.Errorf("read settings: %w", err)
	}

	if err := json.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("decode settings: %w", err)
	}

	cfg.EnsureDefaults()
	if cfg.AutoexecPath == "" {
		cfg.AutoexecPath = resolveDefaultAutoexecPath()
	}
	return cfg, nil
}

func (s *Store) Save(cfg domain.AppSettings) error {
	cfg.EnsureDefaults()
	cfg.UpdatedAt = time.Now().UnixMilli()

	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode settings: %w", err)
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return fmt.Errorf("write settings temp: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("replace settings: %w", err)
	}
	return nil
}

func defaultSettings() domain.AppSettings {
	cfg := domain.AppSettings{
		AutoexecPath:  resolveDefaultAutoexecPath(),
		ReloadCommand: domain.DefaultReloadCommand,
		ReloadBindKey: domain.DefaultReloadBindKey,
		FavoriteKeys:  map[string]bool{},
		RecentKeys:    []string{},
	}
	cfg.EnsureDefaults()
	return cfg
}

func resolveDefaultAutoexecPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "autoexec.cfg"
	}

	candidates := []string{}
	switch runtime.GOOS {
	case "linux":
		candidates = []string{
			filepath.Join(home, ".local", "share", "Steam", "steamapps", "common", "dota 2 beta", "game", "dota", "cfg", "autoexec.cfg"),
			filepath.Join(home, ".steam", "steam", "steamapps", "common", "dota 2 beta", "game", "dota", "cfg", "autoexec.cfg"),
		}
	case "darwin":
		candidates = []string{
			filepath.Join(home, "Library", "Application Support", "Steam", "steamapps", "common", "dota 2 beta", "game", "dota", "cfg", "autoexec.cfg"),
		}
	case "windows":
		steamPath := os.Getenv("PROGRAMFILES(X86)")
		if strings.TrimSpace(steamPath) != "" {
			candidates = append(candidates, filepath.Join(steamPath, "Steam", "steamapps", "common", "dota 2 beta", "game", "dota", "cfg", "autoexec.cfg"))
		}
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return filepath.Join(home, "autoexec.cfg")
}
