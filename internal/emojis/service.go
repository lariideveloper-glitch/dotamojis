package emojis

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"dota-bind-studio/internal/domain"
)

//go:embed catalog.json
var catalogJSON []byte

type Service struct {
	catalog domain.EmojiCatalog
	byRune  map[string]domain.EmojiItem
}

type catalogFile struct {
	GeneratedAt string             `json:"generatedAt"`
	Items       []domain.EmojiItem `json:"items"`
}

func NewService() (*Service, error) {
	var file catalogFile
	if err := json.Unmarshal(catalogJSON, &file); err != nil {
		return nil, fmt.Errorf("decode emoji catalog: %w", err)
	}

	byRune := make(map[string]domain.EmojiItem, len(file.Items))
	for _, item := range file.Items {
		if item.Unicode == "" {
			continue
		}
		byRune[item.Unicode] = item
	}

	return &Service{
		catalog: domain.EmojiCatalog{
			GeneratedAt: file.GeneratedAt,
			Items:       file.Items,
		},
		byRune: byRune,
	}, nil
}

func (s *Service) Catalog() domain.EmojiCatalog {
	return s.catalog
}

func (s *Service) ByRunes(runes []string) []domain.EmojiItem {
	out := make([]domain.EmojiItem, 0, len(runes))
	seen := map[string]bool{}
	for _, r := range runes {
		if seen[r] {
			continue
		}
		seen[r] = true
		if item, ok := s.byRune[r]; ok {
			out = append(out, item)
		}
	}
	return out
}

func (s *Service) RuneToChatCode(r string) string {
	if item, ok := s.byRune[r]; ok {
		return item.ChatCode
	}
	return ""
}
