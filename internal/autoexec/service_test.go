package autoexec

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dota-bind-studio/internal/domain"
)

func TestSaveAndLoadManagedBlock(t *testing.T) {
	svc := NewService()
	tmp := t.TempDir()
	path := filepath.Join(tmp, "autoexec.cfg")

	initial := "bind \"F2\" \"dota_camera_distance 1134\"\n"
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	message := "hello \ue003 \"quoted\""
	_, err := svc.SaveManaged(path, []domain.BindEntry{
		{Key: "F1", Mode: domain.ChatModeSayTeam, Message: message},
	}, "F11", "exec autoexec.cfg")
	if err != nil {
		t.Fatalf("save managed: %v", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	text := string(content)

	if !strings.Contains(text, ManagedBegin) || !strings.Contains(text, ManagedEnd) {
		t.Fatalf("managed markers not written: %s", text)
	}
	if !strings.Contains(text, `bind "F11" "exec autoexec.cfg"`) {
		t.Fatalf("expected dedicated reload bind line, got: %s", text)
	}
	if !strings.Contains(text, `bind "F1" "say_team \"hello`) {
		t.Fatalf("expected managed bind line, got: %s", text)
	}

	snapshot, err := svc.Load(path, map[string]bool{}, nil)
	if err != nil {
		t.Fatalf("load snapshot: %v", err)
	}
	if len(snapshot.ManagedBinds) != 2 {
		t.Fatalf("expected 2 managed binds (reload + chat), got %d", len(snapshot.ManagedBinds))
	}

	var bind domain.BindEntry
	chatCount := 0
	foundReload := false
	for _, item := range snapshot.ManagedBinds {
		if item.Key == "F11" {
			foundReload = true
			if item.Parseable {
				t.Fatalf("reload bind should not be parseable as chat bind")
			}
			if item.CommandRaw != "exec autoexec.cfg" {
				t.Fatalf("unexpected reload command raw: %s", item.CommandRaw)
			}
			continue
		}
		if item.Parseable {
			chatCount++
			bind = item
		}
	}
	if !foundReload {
		t.Fatalf("reload bind not found in managed binds")
	}
	if chatCount != 1 {
		t.Fatalf("expected exactly 1 parseable chat bind, got %d", chatCount)
	}

	if bind.Key != "F1" {
		t.Fatalf("unexpected key: %s", bind.Key)
	}
	if bind.Mode != domain.ChatModeSayTeam {
		t.Fatalf("unexpected mode: %s", bind.Mode)
	}
	if bind.Message != message {
		t.Fatalf("unexpected message: %q != %q", bind.Message, message)
	}
}
