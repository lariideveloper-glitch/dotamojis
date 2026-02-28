package autoexec

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"dota-bind-studio/internal/domain"
)

const (
	ManagedBegin = "// >>> DOTA_BIND_STUDIO:BEGIN v1"
	ManagedEnd   = "// <<< DOTA_BIND_STUDIO:END"
)

var (
	bindQuotedPattern = regexp.MustCompile(`^\s*bind\s+"?([^"\s]+)"?\s+"((?:\\.|[^"\\])*)"\s*(?://.*)?$`)
	bindRawPattern    = regexp.MustCompile(`^\s*bind\s+"?([^"\s]+)"?\s+(.+?)\s*$`)
	chatQuotedPattern = regexp.MustCompile(`^\s*(say_team|say)\s+"((?:\\.|[^"\\])*)"\s*$`)
	chatRawPattern    = regexp.MustCompile(`^\s*(say_team|say)\s+(.+?)\s*$`)
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

type parsedData struct {
	lines        []string
	eol          string
	begin        int
	end          int
	hasManaged   bool
	lastModified int64
	fingerprint  string
	path         string
	exists       bool
}

func (s *Service) EnsureAutoexec(path string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create autoexec dir: %w", err)
	}
	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if writeErr := os.WriteFile(path, []byte(""), 0o644); writeErr != nil {
				return fmt.Errorf("create autoexec file: %w", writeErr)
			}
			return nil
		}
		return fmt.Errorf("stat autoexec: %w", err)
	}
	return nil
}

func (s *Service) Load(path string, favorites map[string]bool, recentKeys []string) (domain.AutoexecSnapshot, error) {
	p, err := s.parseFile(path)
	if err != nil {
		return domain.AutoexecSnapshot{}, err
	}
	recent := toSet(recentKeys)

	managed := make([]domain.BindEntry, 0)
	all := make([]domain.BindEntry, 0)
	externalCountByKey := map[string]int{}
	managedCountByKey := map[string]int{}

	for i, line := range p.lines {
		if bind, ok := parseBindLine(line); ok {
			if p.hasManaged && i > p.begin && i < p.end {
				bind.Source = domain.BindSourceManaged
				managedCountByKey[bind.Key]++
			} else {
				bind.Source = domain.BindSourceExternal
				externalCountByKey[bind.Key]++
			}
			bind.Favorite = favorites[bind.Key]
			bind.Recent = recent[bind.Key]
			bind.UpdatedAt = p.lastModified
			all = append(all, bind)
			if bind.Source == domain.BindSourceManaged {
				managed = append(managed, bind)
			}
		}
	}

	conflicts := make([]domain.BindConflict, 0)
	for key, managedCount := range managedCountByKey {
		if managedCount > 1 {
			conflicts = append(conflicts, domain.BindConflict{
				Key:         key,
				Kind:        "duplicate_managed",
				Description: fmt.Sprintf("A tecla %s aparece %d vezes no bloco gerenciado", key, managedCount),
			})
		}
		if extCount := externalCountByKey[key]; extCount > 0 {
			conflicts = append(conflicts, domain.BindConflict{
				Key:         key,
				Kind:        "managed_vs_external",
				Description: fmt.Sprintf("A tecla %s também está bindada fora do bloco gerenciado", key),
			})
		}
	}
	sort.Slice(conflicts, func(i, j int) bool {
		if conflicts[i].Kind == conflicts[j].Kind {
			return conflicts[i].Key < conflicts[j].Key
		}
		return conflicts[i].Kind < conflicts[j].Kind
	})

	snapshot := domain.AutoexecSnapshot{
		Path:         path,
		Exists:       p.exists,
		ManagedBlock: p.hasManaged,
		ManagedBinds: managed,
		AllBinds:     all,
		Conflicts:    conflicts,
		LastModified: p.lastModified,
		Fingerprint:  p.fingerprint,
	}
	return snapshot, nil
}

func (s *Service) SaveManaged(path string, managed []domain.BindEntry, reloadBindKey string, reloadCommand string) (domain.AutoexecSnapshot, error) {
	p, err := s.parseFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			p = parsedData{path: path, exists: false, lines: []string{}, eol: "\n", begin: -1, end: -1}
		} else {
			return domain.AutoexecSnapshot{}, err
		}
	}

	normalized := normalizeManagedList(managed)
	blockLines := renderManagedBlock(normalized, reloadBindKey, reloadCommand)

	outLines := make([]string, 0, len(p.lines)+len(blockLines)+4)
	if p.hasManaged {
		outLines = append(outLines, p.lines[:p.begin]...)
		outLines = append(outLines, blockLines...)
		if p.end+1 < len(p.lines) {
			outLines = append(outLines, p.lines[p.end+1:]...)
		}
	} else {
		outLines = append(outLines, p.lines...)
		trimmedEmpty := len(outLines) == 0 || (len(outLines) == 1 && strings.TrimSpace(outLines[0]) == "")
		if !trimmedEmpty {
			if strings.TrimSpace(outLines[len(outLines)-1]) != "" {
				outLines = append(outLines, "")
			}
		}
		outLines = append(outLines, blockLines...)
	}

	content := strings.Join(outLines, p.eol)
	if content != "" && !strings.HasSuffix(content, p.eol) {
		content += p.eol
	}

	if err := writeAtomicWithBackup(path, content); err != nil {
		return domain.AutoexecSnapshot{}, err
	}
	return s.Load(path, map[string]bool{}, []string{})
}

func (s *Service) parseFile(path string) (parsedData, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return parsedData{path: path, exists: false, lines: []string{}, eol: "\n", begin: -1, end: -1}, err
		}
		return parsedData{}, fmt.Errorf("read autoexec: %w", err)
	}

	content := string(b)
	eol := "\n"
	if strings.Contains(content, "\r\n") {
		eol = "\r\n"
	}
	lines := splitLines(content)
	begin, end := findManagedBlock(lines)

	stat, statErr := os.Stat(path)
	lastModified := time.Now().UnixMilli()
	if statErr == nil {
		lastModified = stat.ModTime().UnixMilli()
	}

	hash := sha1.Sum(b)
	fingerprint := hex.EncodeToString(hash[:])[:16]

	return parsedData{
		lines:        lines,
		eol:          eol,
		begin:        begin,
		end:          end,
		hasManaged:   begin >= 0 && end > begin,
		lastModified: lastModified,
		fingerprint:  fingerprint,
		path:         path,
		exists:       true,
	}, nil
}

func splitLines(content string) []string {
	if content == "" {
		return []string{}
	}
	content = strings.ReplaceAll(content, "\r\n", "\n")
	if strings.HasSuffix(content, "\n") {
		content = content[:len(content)-1]
	}
	if content == "" {
		return []string{}
	}
	return strings.Split(content, "\n")
}

func findManagedBlock(lines []string) (int, int) {
	begin := -1
	end := -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if begin == -1 && strings.Contains(trimmed, ManagedBegin) {
			begin = i
			continue
		}
		if begin != -1 && strings.Contains(trimmed, ManagedEnd) {
			end = i
			break
		}
	}
	if begin == -1 || end == -1 || end <= begin {
		return -1, -1
	}
	return begin, end
}

func parseBindLine(line string) (domain.BindEntry, bool) {
	entry := domain.BindEntry{}
	if strings.TrimSpace(line) == "" {
		return entry, false
	}

	match := bindQuotedPattern.FindStringSubmatch(line)
	if len(match) > 0 {
		key := normalizeKey(match[1])
		command := unescapeQuoted(match[2])
		mode, message, parseable := parseChatCommand(command)
		entry = domain.BindEntry{
			Key:         key,
			Mode:        mode,
			Message:     message,
			CommandRaw:  command,
			Parseable:   parseable,
			PreviewText: message,
			Emojis:      extractEmojiRunes(message),
		}
		return entry, true
	}

	fallback := bindRawPattern.FindStringSubmatch(line)
	if len(fallback) > 0 {
		key := normalizeKey(fallback[1])
		cmd := strings.TrimSpace(fallback[2])
		cmd = strings.Trim(cmd, "\"")
		mode, message, parseable := parseChatCommand(cmd)
		entry = domain.BindEntry{
			Key:         key,
			Mode:        mode,
			Message:     message,
			CommandRaw:  cmd,
			Parseable:   parseable,
			PreviewText: message,
			Emojis:      extractEmojiRunes(message),
		}
		return entry, true
	}

	return entry, false
}

func parseChatCommand(cmd string) (domain.ChatMode, string, bool) {
	if m := chatQuotedPattern.FindStringSubmatch(cmd); len(m) > 0 {
		mode := domain.ChatMode(m[1])
		message := unescapeQuoted(m[2])
		message = sanitizeMessage(message)
		if !mode.IsValid() {
			return "", message, false
		}
		return mode, message, true
	}

	if m := chatRawPattern.FindStringSubmatch(cmd); len(m) > 0 {
		mode := domain.ChatMode(m[1])
		message := strings.TrimSpace(m[2])
		message = strings.Trim(message, "\"")
		message = sanitizeMessage(unescapeQuoted(message))
		if !mode.IsValid() {
			return "", message, false
		}
		return mode, message, true
	}

	return "", "", false
}

func renderManagedBlock(binds []domain.BindEntry, reloadBindKey string, reloadCommand string) []string {
	reloadBindKey = normalizeReloadBindKey(reloadBindKey)
	reloadCommand = normalizeReloadCommand(reloadCommand)

	out := []string{
		ManagedBegin,
		"// Managed automatically by Dota Bind Studio.",
		"// Dedicated reload bind (editable in app settings).",
		formatReloadBindLine(reloadBindKey, reloadCommand),
	}
	if len(binds) > 0 {
		out = append(out, "")
	}
	for _, bind := range binds {
		out = append(out, formatBindLine(bind))
	}
	out = append(out, ManagedEnd)
	return out
}

func formatReloadBindLine(key string, command string) string {
	keyEscaped := escapeQuoted(normalizeReloadBindKey(key))
	commandEscaped := escapeQuoted(normalizeReloadCommand(command))
	return fmt.Sprintf("bind \"%s\" \"%s\"", keyEscaped, commandEscaped)
}

func formatBindLine(bind domain.BindEntry) string {
	key := escapeQuoted(bind.Key)
	message := sanitizeMessage(bind.Message)
	command := fmt.Sprintf("%s \"%s\"", bind.Mode, escapeQuoted(message))
	commandEscaped := escapeQuoted(command)
	return fmt.Sprintf("bind \"%s\" \"%s\"", key, commandEscaped)
}

func normalizeManagedList(binds []domain.BindEntry) []domain.BindEntry {
	byKey := map[string]domain.BindEntry{}
	for _, bind := range binds {
		key := normalizeKey(bind.Key)
		if key == "" {
			continue
		}
		mode := bind.Mode
		if !mode.IsValid() {
			mode = domain.ChatModeSay
		}
		message := sanitizeMessage(bind.Message)
		byKey[key] = domain.BindEntry{Key: key, Mode: mode, Message: message}
	}
	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]domain.BindEntry, 0, len(keys))
	for _, key := range keys {
		out = append(out, byKey[key])
	}
	return out
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

func writeAtomicWithBackup(path string, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create autoexec dir: %w", err)
	}

	if old, err := os.ReadFile(path); err == nil {
		backup := path + ".bak_last"
		_ = os.WriteFile(backup, old, 0o644)
	}

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write autoexec temp: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("replace autoexec: %w", err)
	}
	return nil
}

func toSet(items []string) map[string]bool {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		set[item] = true
	}
	return set
}

func normalizeKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	return strings.ToUpper(key)
}

func sanitizeMessage(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func escapeQuoted(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	return s
}

func unescapeQuoted(s string) string {
	s = strings.ReplaceAll(s, "\\\"", "\"")
	s = strings.ReplaceAll(s, "\\\\", "\\")
	return s
}

func extractEmojiRunes(message string) []string {
	if message == "" {
		return nil
	}
	items := []string{}
	for len(message) > 0 {
		r, size := utf8.DecodeRuneInString(message)
		if size <= 0 {
			break
		}
		if r >= 0xE000 && r <= 0xF8FF {
			items = append(items, string(r))
		}
		message = message[size:]
	}
	return items
}
