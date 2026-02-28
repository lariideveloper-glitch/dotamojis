# Dota Bind Studio - Handoff (Ler no próximo chat)

Este arquivo resume o estado atual do projeto para retomar rápido em outra sessão.

## 1) Objetivo do app
App desktop em **Wails (Go) + React/TypeScript + Tailwind + shadcn/ui** para:
- Ler `autoexec.cfg` do Dota 2
- Mostrar binds como espelho do arquivo
- Criar/editar/deletar binds de chat (`say` / `say_team`) com unicode de emoji
- Inserir emojis via galeria (com mapeamento unicode + nome + gif)
- Escrever com segurança em bloco gerenciado no `autoexec.cfg`
- Detectar mudanças externas no arquivo

## 2) Estado atual (implementado)

### Backend Go
Implementado em:
- `app.go`
- `internal/autoexec/service.go`
- `internal/settings/store.go`
- `internal/emojis/service.go`
- `internal/domain/types.go`

Funcionalidades:
- Carrega/salva settings em `~/.config/dota-bind-studio/settings.json`
- Resolve path padrão de autoexec (Linux/macOS/Windows)
- Garante existência do `autoexec.cfg`
- Parse de binds do arquivo todo
- Bloco gerenciado com delimitadores:
  - `// >>> DOTA_BIND_STUDIO:BEGIN v1`
  - `// <<< DOTA_BIND_STUDIO:END`
- Escrita atômica com backup (`autoexec.cfg.bak_last`)
- Detecção de conflitos de tecla (managed vs external, duplicados)
- Polling de mudança externa com evento Wails (`autoexec:changed`)
- API Wails exposta:
  - `GetDashboard`
  - `ListEmojiCatalog`
  - `UpsertManagedBind`
  - `DeleteManagedBind`
  - `SetFavorite`
  - `ReloadFromDisk`
  - `UpdateSettings`
  - `GetReloadSamples`
  - `GetStartupError`

### Catálogo de emojis (cruzamento unicode + nomes + gif)
- Script: `scripts/build-emoji-catalog.mjs`
- Saída: `internal/emojis/catalog.json`
- Fontes usadas no script:
  - Repo unicode: `s3rbug/dota2_emojis_unicode`
  - Fandom API (wikitext da página Emoticons)
- Resultado atual: **1481 emojis**, **279 com gif** mapeado
- O unicode salvo é o caractere real (ex.: ``), com `unicodeEscape` (`%ue003`) só para referência

### Frontend React
Implementado em:
- `frontend/src/App.tsx`
- `frontend/src/index.css`
- `frontend/src/lib/keymap.ts`
- `frontend/src/lib/text.ts`
- `frontend/src/components/ui/textarea.tsx`
- `frontend/src/components/ui/badge.tsx`

Funcionalidades de UI:
- Tema claro premium com gradientes e micro-animações
- Lista de binds com busca/filtros
- Ações: favoritar, editar, duplicar, deletar
- Editor de bind com:
  - captura de tecla
  - toggle `say` / `say_team`
  - preview do comando final
  - preview de emojis usados
- Galeria de emojis com busca e inserção no cursor
- Painel de configurações (`autoexecPath`, `reloadCommand`)
- Botão para copiar comando de reload do console
- Painel de conflitos

## 3) Validação executada
Comandos já testados com sucesso:
- `go test ./...`
- `go build ./...`
- `cd frontend && npm run build`

## 4) Como rodar local

### Dev
```bash
cd /home/larissa/dota-bind-studio
wails dev
```

### Build frontend manual (opcional)
```bash
cd /home/larissa/dota-bind-studio/frontend
npm install
npm run build
```

## 5) Pontos importantes (não perder)
- O app trabalha com unicode real no texto (`say "...  ..."`), não com `%ue...` no `autoexec`.
- O `autoexec.cfg` continua sendo a fonte de verdade; favoritos/recentes ficam em settings do app.
- O bloco gerenciado é idempotente e não mexe no restante do arquivo.

## 6) Próximos passos sugeridos
1. Melhorar cobertura de GIF (mais aliases/fallback por Liquipedia quando acessível).
2. Adicionar “perfil de binds” (ranked, pub, troll).
3. Adicionar import/export JSON de binds gerenciados.
4. Refinar parser para mais variações de sintaxe de bind externas.
5. Adicionar testes unitários extras para conflitos e merge de bloco.

## 7) Comando para recontextualizar próxima sessão
Na próxima conversa, peça:

> "Leia `/home/larissa/dota-bind-studio/README_HANDOFF.md` e continue de onde parou."

