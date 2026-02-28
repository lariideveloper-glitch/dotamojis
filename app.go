package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"dota-bind-studio/internal/autoexec"
	"dota-bind-studio/internal/domain"
	"dota-bind-studio/internal/emojis"
	"dota-bind-studio/internal/settings"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx          context.Context
	mu           sync.RWMutex
	settings     domain.AppSettings
	snapshot     domain.AutoexecSnapshot
	settingsSvc  *settings.Store
	autoexecSvc  *autoexec.Service
	emojisSvc    *emojis.Service
	pollCancel   context.CancelFunc
	startupError string
}

// NewApp creates a new App application struct
func NewApp() *App {
	settingsSvc, err := settings.NewStore()
	if err != nil {
		return &App{startupError: err.Error()}
	}
	emojiSvc, err := emojis.NewService()
	if err != nil {
		return &App{startupError: err.Error()}
	}
	return &App{
		settingsSvc: settingsSvc,
		autoexecSvc: autoexec.NewService(),
		emojisSvc:   emojiSvc,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.startupError != "" {
		return
	}
	if err := a.bootstrap(); err != nil {
		a.startupError = err.Error()
	}
}

func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pollCancel != nil {
		a.pollCancel()
		a.pollCancel = nil
	}
}

func (a *App) bootstrap() error {
	cfg, err := a.settingsSvc.Load()
	if err != nil {
		return err
	}
	cfg.EnsureDefaults()
	if strings.TrimSpace(cfg.AutoexecPath) == "" {
		return errors.New("autoexec path vazio nas configurações")
	}

	if err := a.autoexecSvc.EnsureAutoexec(cfg.AutoexecPath); err != nil {
		return err
	}

	snapshot, err := a.autoexecSvc.Load(cfg.AutoexecPath, cfg.FavoriteKeys, cfg.RecentKeys)
	if err != nil {
		return err
	}

	a.mu.Lock()
	a.settings = cfg
	a.snapshot = snapshot
	a.mu.Unlock()

	a.startPoller()
	return nil
}

func (a *App) GetDashboard() (domain.DashboardState, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.startupError != "" {
		return domain.DashboardState{}, errors.New(a.startupError)
	}
	return a.dashboardLocked(), nil
}

func (a *App) ListEmojiCatalog() (domain.EmojiCatalog, error) {
	if a.startupError != "" {
		return domain.EmojiCatalog{}, errors.New(a.startupError)
	}
	return a.emojisSvc.Catalog(), nil
}

func (a *App) UpsertManagedBind(req domain.UpsertBindRequest) (domain.DashboardState, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.startupError != "" {
		return domain.DashboardState{}, errors.New(a.startupError)
	}

	key := normalizeKey(req.Key)
	if key == "" {
		return domain.DashboardState{}, errors.New("tecla é obrigatória")
	}
	if key == normalizeReloadBindKey(a.settings.ReloadBindKey) {
		return domain.DashboardState{}, errors.New("tecla reservada para reload. Edite a tecla de reload nas configurações")
	}

	mode := domain.ChatMode(strings.ToLower(strings.TrimSpace(req.Mode)))
	if !mode.IsValid() {
		mode = domain.ChatModeSay
	}

	message := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(req.Message, "\r", " "), "\n", " "))

	managedMap := a.managedMapLocked()
	oldKey := normalizeKey(req.OldKey)
	if oldKey != "" && oldKey != key {
		delete(managedMap, oldKey)
	}
	managedMap[key] = domain.BindEntry{Key: key, Mode: mode, Message: message, Parseable: true}

	if err := a.persistManagedMapLocked(managedMap); err != nil {
		return domain.DashboardState{}, err
	}
	a.touchRecentLocked(key)
	state := a.dashboardLocked()
	a.emit("autoexec:changed", state)
	return state, nil
}

func (a *App) DeleteManagedBind(key string) (domain.DashboardState, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.startupError != "" {
		return domain.DashboardState{}, errors.New(a.startupError)
	}

	key = normalizeKey(key)
	if key == "" {
		return domain.DashboardState{}, errors.New("tecla inválida")
	}

	managedMap := a.managedMapLocked()
	delete(managedMap, key)

	if err := a.persistManagedMapLocked(managedMap); err != nil {
		return domain.DashboardState{}, err
	}
	state := a.dashboardLocked()
	a.emit("autoexec:changed", state)
	return state, nil
}

func (a *App) SetFavorite(key string, favorite bool) (domain.DashboardState, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.startupError != "" {
		return domain.DashboardState{}, errors.New(a.startupError)
	}
	key = normalizeKey(key)
	if key == "" {
		return domain.DashboardState{}, errors.New("tecla inválida")
	}

	if favorite {
		a.settings.FavoriteKeys[key] = true
	} else {
		delete(a.settings.FavoriteKeys, key)
	}
	if err := a.settingsSvc.Save(a.settings); err != nil {
		return domain.DashboardState{}, err
	}
	state, err := a.reloadLocked()
	if err != nil {
		return domain.DashboardState{}, err
	}
	a.emit("autoexec:changed", state)
	return state, nil
}

func (a *App) ReloadFromDisk() (domain.DashboardState, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.startupError != "" {
		return domain.DashboardState{}, errors.New(a.startupError)
	}
	state, err := a.reloadLocked()
	if err != nil {
		return domain.DashboardState{}, err
	}
	a.emit("autoexec:changed", state)
	return state, nil
}

func (a *App) UpdateSettings(req domain.UpdateSettingsRequest) (domain.DashboardState, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.startupError != "" {
		return domain.DashboardState{}, errors.New(a.startupError)
	}

	pathChanged := false
	reloadConfigChanged := false
	if req.AutoexecPath != nil {
		newPath := strings.TrimSpace(*req.AutoexecPath)
		if newPath == "" {
			return domain.DashboardState{}, errors.New("caminho do autoexec não pode ser vazio")
		}
		if newPath != a.settings.AutoexecPath {
			pathChanged = true
			a.settings.AutoexecPath = newPath
		}
	}
	if req.ReloadCommand != nil {
		cmd := normalizeReloadCommand(*req.ReloadCommand)
		if cmd != a.settings.ReloadCommand {
			a.settings.ReloadCommand = cmd
			reloadConfigChanged = true
		}
	}
	if req.ReloadBindKey != nil {
		key := normalizeReloadBindKey(*req.ReloadBindKey)
		if _, exists := a.managedMapLocked()[key]; exists && !pathChanged {
			return domain.DashboardState{}, errors.New("tecla de reload já está em uso por um bind de chat gerenciado")
		}
		if key != a.settings.ReloadBindKey {
			a.settings.ReloadBindKey = key
			reloadConfigChanged = true
		}
	}

	if pathChanged {
		if err := a.autoexecSvc.EnsureAutoexec(a.settings.AutoexecPath); err != nil {
			return domain.DashboardState{}, err
		}
	}

	if err := a.settingsSvc.Save(a.settings); err != nil {
		return domain.DashboardState{}, err
	}

	state, err := a.reloadLocked()
	if err != nil {
		return domain.DashboardState{}, err
	}
	if reloadConfigChanged {
		if err := a.persistManagedMapLocked(a.managedMapLocked()); err != nil {
			return domain.DashboardState{}, err
		}
		state = a.dashboardLocked()
	}
	if pathChanged {
		a.startPoller()
	}
	a.emit("autoexec:changed", state)
	return state, nil
}

func (a *App) GetReloadSamples() []string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	cmd := normalizeReloadCommand(a.settings.ReloadCommand)
	key := normalizeReloadBindKey(a.settings.ReloadBindKey)
	return []string{
		formatReloadBindLine(key, cmd),
		cmd,
		domain.DefaultReloadCommand,
		"exec autoexec",
	}
}

func (a *App) GetStartupError() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.startupError
}

func (a *App) reloadLocked() (domain.DashboardState, error) {
	snapshot, err := a.autoexecSvc.Load(a.settings.AutoexecPath, a.settings.FavoriteKeys, a.settings.RecentKeys)
	if err != nil {
		return domain.DashboardState{}, err
	}
	a.snapshot = snapshot
	return a.dashboardLocked(), nil
}

func (a *App) persistManagedMapLocked(m map[string]domain.BindEntry) error {
	managed := make([]domain.BindEntry, 0, len(m))
	for _, bind := range m {
		managed = append(managed, bind)
	}
	if _, err := a.autoexecSvc.SaveManaged(
		a.settings.AutoexecPath,
		managed,
		a.settings.ReloadBindKey,
		a.settings.ReloadCommand,
	); err != nil {
		return err
	}
	snapshot, err := a.autoexecSvc.Load(a.settings.AutoexecPath, a.settings.FavoriteKeys, a.settings.RecentKeys)
	if err != nil {
		return err
	}
	a.snapshot = snapshot
	if err := a.settingsSvc.Save(a.settings); err != nil {
		return err
	}
	return nil
}

func (a *App) managedMapLocked() map[string]domain.BindEntry {
	managed := map[string]domain.BindEntry{}
	for _, bind := range a.snapshot.ManagedBinds {
		if !bind.Parseable {
			continue
		}
		managed[bind.Key] = domain.BindEntry{
			Key:     bind.Key,
			Mode:    bind.Mode,
			Message: bind.Message,
		}
	}
	return managed
}

func (a *App) touchRecentLocked(key string) {
	if key == "" {
		return
	}
	list := []string{key}
	for _, item := range a.settings.RecentKeys {
		if item == key {
			continue
		}
		list = append(list, item)
		if len(list) >= 30 {
			break
		}
	}
	a.settings.RecentKeys = list
	_ = a.settingsSvc.Save(a.settings)
}

func (a *App) dashboardLocked() domain.DashboardState {
	snapshot := a.snapshot
	managed := append([]domain.BindEntry{}, snapshot.ManagedBinds...)
	sort.Slice(managed, func(i, j int) bool {
		return managed[i].Key < managed[j].Key
	})
	snapshot.ManagedBinds = managed

	reloadCommand := normalizeReloadCommand(a.settings.ReloadCommand)
	reloadBindKey := normalizeReloadBindKey(a.settings.ReloadBindKey)
	reloadSamples := []string{
		formatReloadBindLine(reloadBindKey, reloadCommand),
		reloadCommand,
		domain.DefaultReloadCommand,
		"exec autoexec",
	}

	return domain.DashboardState{
		Settings:      a.settings,
		Snapshot:      snapshot,
		EmojiCount:    len(a.emojisSvc.Catalog().Items),
		ReloadSamples: reloadSamples,
		LastSyncAt:    time.Now().UnixMilli(),
	}
}

func (a *App) startPoller() {
	a.mu.Lock()
	if a.pollCancel != nil {
		a.pollCancel()
		a.pollCancel = nil
	}
	fingerprint := a.snapshot.Fingerprint
	ctx, cancel := context.WithCancel(context.Background())
	a.pollCancel = cancel
	a.mu.Unlock()

	go func(initialFingerprint string, loopCtx context.Context) {
		ticker := time.NewTicker(1500 * time.Millisecond)
		defer ticker.Stop()
		lastFingerprint := initialFingerprint
		for {
			select {
			case <-loopCtx.Done():
				return
			case <-ticker.C:
				a.mu.RLock()
				path := a.settings.AutoexecPath
				fav := copyFavoriteMap(a.settings.FavoriteKeys)
				recent := append([]string{}, a.settings.RecentKeys...)
				a.mu.RUnlock()

				snap, err := a.autoexecSvc.Load(path, fav, recent)
				if err != nil {
					if !errors.Is(err, os.ErrNotExist) {
						a.emit("autoexec:error", err.Error())
					}
					continue
				}
				if snap.Fingerprint == lastFingerprint {
					continue
				}
				lastFingerprint = snap.Fingerprint
				a.mu.Lock()
				a.snapshot = snap
				a.mu.Unlock()
				a.emit("autoexec:changed", snap)
			}
		}
	}(fingerprint, ctx)
}

func (a *App) emit(event string, payload interface{}) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, event, payload)
}

func copyFavoriteMap(m map[string]bool) map[string]bool {
	out := make(map[string]bool, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func normalizeKey(key string) string {
	return strings.ToUpper(strings.TrimSpace(key))
}

func normalizeReloadBindKey(key string) string {
	key = strings.ToUpper(strings.TrimSpace(key))
	if key == "" {
		return domain.DefaultReloadBindKey
	}
	return key
}

func normalizeReloadCommand(command string) string {
	command = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(command, "\r", " "), "\n", " "))
	if command == "" {
		return domain.DefaultReloadCommand
	}
	return command
}

func formatReloadBindLine(key string, command string) string {
	key = normalizeReloadBindKey(key)
	command = normalizeReloadCommand(command)
	return fmt.Sprintf(`bind "%s" "%s"`, escapeQuoted(key), escapeQuoted(command))
}

func escapeQuoted(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}
