package domain

import (
	"strings"
	"time"
)

type ChatMode string

const (
	ChatModeSay     ChatMode = "say"
	ChatModeSayTeam ChatMode = "say_team"
)

const (
	DefaultReloadCommand = "exec autoexec.cfg"
	DefaultReloadBindKey = "F10"
)

func (m ChatMode) IsValid() bool {
	return m == ChatModeSay || m == ChatModeSayTeam
}

type BindSource string

const (
	BindSourceManaged  BindSource = "managed"
	BindSourceExternal BindSource = "external"
)

type BindEntry struct {
	Key         string     `json:"key"`
	Mode        ChatMode   `json:"mode"`
	Message     string     `json:"message"`
	CommandRaw  string     `json:"commandRaw"`
	Parseable   bool       `json:"parseable"`
	Source      BindSource `json:"source"`
	Favorite    bool       `json:"favorite"`
	Recent      bool       `json:"recent"`
	UpdatedAt   int64      `json:"updatedAt"`
	Emojis      []string   `json:"emojis"`
	PreviewText string     `json:"previewText"`
}

type BindConflict struct {
	Key         string `json:"key"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
}

type AutoexecSnapshot struct {
	Path         string         `json:"path"`
	Exists       bool           `json:"exists"`
	ManagedBlock bool           `json:"managedBlock"`
	ManagedBinds []BindEntry    `json:"managedBinds"`
	AllBinds     []BindEntry    `json:"allBinds"`
	Conflicts    []BindConflict `json:"conflicts"`
	LastModified int64          `json:"lastModified"`
	Fingerprint  string         `json:"fingerprint"`
}

type EmojiItem struct {
	Code          int      `json:"code"`
	Name          string   `json:"name"`
	ChatCode      string   `json:"chatCode"`
	Unicode       string   `json:"unicode"`
	UnicodeEscape string   `json:"unicodeEscape"`
	GifURL        string   `json:"gifUrl"`
	GifFile       string   `json:"gifFile"`
	Tags          []string `json:"tags"`
	Source        []string `json:"source"`
}

type EmojiCatalog struct {
	GeneratedAt string      `json:"generatedAt"`
	Items       []EmojiItem `json:"items"`
}

type AppSettings struct {
	AutoexecPath  string          `json:"autoexecPath"`
	ReloadCommand string          `json:"reloadCommand"`
	ReloadBindKey string          `json:"reloadBindKey"`
	FavoriteKeys  map[string]bool `json:"favoriteKeys"`
	RecentKeys    []string        `json:"recentKeys"`
	UpdatedAt     int64           `json:"updatedAt"`
}

func (s *AppSettings) EnsureDefaults() {
	s.ReloadCommand = strings.TrimSpace(s.ReloadCommand)
	if s.ReloadCommand == "" {
		s.ReloadCommand = DefaultReloadCommand
	}
	s.ReloadBindKey = strings.ToUpper(strings.TrimSpace(s.ReloadBindKey))
	if s.ReloadBindKey == "" {
		s.ReloadBindKey = DefaultReloadBindKey
	}
	if s.FavoriteKeys == nil {
		s.FavoriteKeys = map[string]bool{}
	}
	if s.RecentKeys == nil {
		s.RecentKeys = []string{}
	}
	if s.UpdatedAt == 0 {
		s.UpdatedAt = time.Now().UnixMilli()
	}
}

type DashboardState struct {
	Settings      AppSettings      `json:"settings"`
	Snapshot      AutoexecSnapshot `json:"snapshot"`
	EmojiCount    int              `json:"emojiCount"`
	ReloadSamples []string         `json:"reloadSamples"`
	LastSyncAt    int64            `json:"lastSyncAt"`
}

type UpsertBindRequest struct {
	OldKey  string `json:"oldKey"`
	Key     string `json:"key"`
	Mode    string `json:"mode"`
	Message string `json:"message"`
}

type UpdateSettingsRequest struct {
	AutoexecPath  *string `json:"autoexecPath"`
	ReloadCommand *string `json:"reloadCommand"`
	ReloadBindKey *string `json:"reloadBindKey"`
}
