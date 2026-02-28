import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardSetText, EventsOn } from "../wailsjs/runtime/runtime";
import {
  DeleteManagedBind,
  GetDashboard,
  GetStartupError,
  ListEmojiCatalog,
  ReloadFromDisk,
  SetFavorite,
  UpdateSettings,
  UpsertManagedBind,
} from "../wailsjs/go/main/App";
import { domain } from "../wailsjs/go/models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Copy,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  RefreshCcw,
  Pencil,
  CopyPlus,
  Keyboard,
  Save,
  X,
  Zap,
  ChevronRight,
  ListFilter,
  ArrowLeft,
  Check,
  Info,
  AlertCircle,
} from "lucide-react";
import {
  buildCommandPreview,
  insertAtCursor,
  normalizeSearch,
} from "@/lib/text";
import { toDotaKeyFromKeyboardEvent, PROTECTED_KEYS } from "@/lib/keymap";
import { motion, AnimatePresence } from "framer-motion";

type DashboardState = domain.DashboardState;
type BindEntry = domain.BindEntry;
type EmojiItem = domain.EmojiItem;

type BindModeFilter = "all" | "say" | "say_team";
type BindSourceFilter = "all" | "managed" | "external";
type MainTab = "binds" | "editor" | "config";

type EditorDraft = {
  oldKey: string;
  key: string;
  mode: "say" | "say_team";
  message: string;
};

type ToastMessage = {
  id: string;
  type: "success" | "error" | "info";
  text: string;
};

const EMPTY_DRAFT: EditorDraft = {
  oldKey: "",
  key: "",
  mode: "say",
  message: "",
};

/* ──── Animation Variants ──── */
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.03 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 500, damping: 35 } },
} as const;

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
} as const;

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { type: "spring" as const, stiffness: 400, damping: 30 } },
  exit: { opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.15 } },
} as const;

function App() {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [catalog, setCatalog] = useState<domain.EmojiCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mainTab, setMainTab] = useState<MainTab>("binds");

  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<BindModeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<BindSourceFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);

  const [editorDraft, setEditorDraft] = useState<EditorDraft>(EMPTY_DRAFT);
  const [editorSaving, setEditorSaving] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");

  const [keyCaptureOpen, setKeyCaptureOpen] = useState(false);
  const [pendingCursor, setPendingCursor] = useState<number | null>(null);

  const [settingsPath, setSettingsPath] = useState("");
  const [settingsReloadCommand, setSettingsReloadCommand] = useState("");
  const [settingsReloadBindKey, setSettingsReloadBindKey] = useState("F10");
  const [settingsSaving, setSettingsSaving] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const messageRef = useRef<HTMLTextAreaElement>(null);

  function showToast(text: string, type: "success" | "error" | "info" = "success") {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }

  const emojiByUnicode = useMemo(() => {
    const map = new Map<string, EmojiItem>();
    for (const item of catalog?.items ?? []) {
      map.set(item.unicode, item);
    }
    return map;
  }, [catalog]);

  const conflictByKey = useMemo(() => {
    const map = new Map<string, domain.BindConflict[]>();
    for (const conflict of dashboard?.snapshot.conflicts ?? []) {
      const k = conflict.key;
      const list = map.get(k) ?? [];
      list.push(conflict);
      map.set(k, list);
    }
    return map;
  }, [dashboard]);

  const visibleBinds = useMemo(() => {
    const all = dashboard?.snapshot.allBinds ?? [];
    const q = normalizeSearch(query);

    const filtered = all.filter((bind) => {
      if (modeFilter !== "all" && bind.mode !== modeFilter) return false;
      if (sourceFilter !== "all" && bind.source !== sourceFilter) return false;
      if (favoritesOnly && !bind.favorite) return false;
      if (recentOnly && !bind.recent) return false;

      if (!q) return true;
      const haystack =
        `${bind.key} ${bind.mode} ${bind.message} ${bind.commandRaw}`.toLowerCase();
      return haystack.includes(q);
    });

    return filtered.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      if (a.source !== b.source) return a.source === "managed" ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }, [dashboard, query, modeFilter, sourceFilter, favoritesOnly, recentOnly]);

  const filteredEmojis = useMemo(() => {
    const term = normalizeSearch(emojiSearch);
    const items = catalog?.items ?? [];
    if (!term) return items.slice(0, 240);
    return items
      .filter((item) => {
        const tags = (item.tags ?? []).join(" ");
        return `${item.name} ${item.chatCode} ${tags}`
          .toLowerCase()
          .includes(term);
      })
      .slice(0, 240);
  }, [catalog, emojiSearch]);

  const draftCommandPreview = useMemo(() => {
    return buildCommandPreview(
      editorDraft.key,
      editorDraft.mode,
      editorDraft.message,
    );
  }, [editorDraft]);

  const draftUsedEmojis = useMemo(() => {
    return extractEmojiItems(editorDraft.message, emojiByUnicode);
  }, [editorDraft.message, emojiByUnicode]);

  const editorConflicts = useMemo(() => {
    return conflictByKey.get(editorDraft.key) ?? [];
  }, [conflictByKey, editorDraft.key]);

  useEffect(() => {
    void bootstrap();

    const offChanged = EventsOn("autoexec:changed", (...payload) => {
      const data = payload?.[0];
      if (!data) return;

      if (data.snapshot) {
        setDashboard(domain.DashboardState.createFrom(data));
        return;
      }

      if (data.managedBinds) {
        setDashboard((prev) => {
          if (!prev) return prev;
          const nextSnapshot = domain.AutoexecSnapshot.createFrom(data);
          return domain.DashboardState.createFrom({
            ...prev,
            snapshot: nextSnapshot,
            lastSyncAt: Date.now(),
          });
        });
      }
    });

    const offErr = EventsOn("autoexec:error", (...payload) => {
      const msg = payload?.[0];
      if (typeof msg === "string" && msg.trim()) {
        setError(msg);
      }
    });

    return () => {
      offChanged();
      offErr();
    };
  }, []);

  useEffect(() => {
    if (!dashboard) return;
    setSettingsPath(dashboard.settings.autoexecPath ?? "");
    setSettingsReloadCommand(
      dashboard.settings.reloadCommand ?? "exec autoexec.cfg",
    );
    setSettingsReloadBindKey(
      (dashboard.settings.reloadBindKey ?? "F10").toUpperCase(),
    );
  }, [
    dashboard?.settings.autoexecPath,
    dashboard?.settings.reloadCommand,
    dashboard?.settings.reloadBindKey,
  ]);

  useEffect(() => {
    if (!keyCaptureOpen) return;

    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setKeyCaptureOpen(false);
        return;
      }

      const mapped = toDotaKeyFromKeyboardEvent(event);
      if (!mapped) return;

      setEditorDraft((prev) => ({ ...prev, key: mapped }));
      setKeyCaptureOpen(false);
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () =>
      window.removeEventListener("keydown", handler, { capture: true });
  }, [keyCaptureOpen]);

  useEffect(() => {
    if (pendingCursor === null) return;

    const frame = requestAnimationFrame(() => {
      const el = messageRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pendingCursor, pendingCursor);
      setPendingCursor(null);
    });

    return () => cancelAnimationFrame(frame);
  }, [pendingCursor, editorDraft.message]);

  async function bootstrap() {
    setLoading(true);
    setError("");
    try {
      const startupError = await GetStartupError();
      if (startupError) {
        setError(startupError);
        return;
      }

      const [state, emojiCatalog] = await Promise.all([
        GetDashboard(),
        ListEmojiCatalog(),
      ]);
      setDashboard(domain.DashboardState.createFrom(state));
      setCatalog(domain.EmojiCatalog.createFrom(emojiCatalog));
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    try {
      const next = await ReloadFromDisk();
      setDashboard(domain.DashboardState.createFrom(next));
    } catch (err) {
      setError(toMessage(err));
    }
  }

  function openCreate() {
    setEditorDraft(EMPTY_DRAFT);
    setShowEmojiPicker(false);
    setEmojiSearch("");
    setMainTab("editor");
  }

  function openEdit(bind: BindEntry) {
    if (!bind.parseable) return;
    setEditorDraft({
      oldKey: bind.source === "managed" ? bind.key : "",
      key: bind.key,
      mode: bind.mode === "say_team" ? "say_team" : "say",
      message: bind.message,
    });
    setShowEmojiPicker(false);
    setEmojiSearch("");
    setMainTab("editor");
  }

  function openDuplicate(bind: BindEntry) {
    setEditorDraft({
      oldKey: "",
      key: "",
      mode: bind.mode === "say_team" ? "say_team" : "say",
      message: bind.message,
    });
    setShowEmojiPicker(false);
    setEmojiSearch("");
    setMainTab("editor");
  }

  async function handleDelete(bind: BindEntry) {
    if (bind.source !== "managed") return;
    if (!window.confirm(`Deletar bind da tecla ${bind.key}?`)) return;

    try {
      const next = await DeleteManagedBind(bind.key);
      setDashboard(domain.DashboardState.createFrom(next));
      showToast("Bind removido!");
    } catch (err) {
      setError(toMessage(err));
    }
  }

  async function handleToggleFavorite(bind: BindEntry) {
    try {
      const next = await SetFavorite(bind.key, !bind.favorite);
      setDashboard(domain.DashboardState.createFrom(next));
    } catch (err) {
      setError(toMessage(err));
    }
  }

  async function handleSaveEditor() {
    const k = editorDraft.key.trim();
    if (!k) {
      setError("Defina uma tecla para o bind.");
      return;
    }

    if (PROTECTED_KEYS.has(k)) {
      if (!window.confirm(`A tecla "${k}" é padrão do Dota (spells/items). Tem certeza que deseja usar?`)) {
        return;
      }
    }

    setEditorSaving(true);
    try {
      const next = await UpsertManagedBind(
        domain.UpsertBindRequest.createFrom({
          oldKey: editorDraft.oldKey,
          key: k,
          mode: editorDraft.mode,
          message: editorDraft.message,
        }),
      );
      setDashboard(domain.DashboardState.createFrom(next));
      setMainTab("binds");
      showToast("Bind salvo com sucesso!");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setEditorSaving(false);
    }
  }

  async function handleSaveSettings() {
    setSettingsSaving(true);
    try {
      const next = await UpdateSettings(
        domain.UpdateSettingsRequest.createFrom({
          autoexecPath: settingsPath,
          reloadCommand: settingsReloadCommand,
          reloadBindKey: settingsReloadBindKey,
        }),
      );
      setDashboard(domain.DashboardState.createFrom(next));
      showToast("Configurações atualizadas!");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleCopyReloadCommand() {
    const cmd = settingsReloadCommand.trim() || "exec autoexec.cfg";
    try {
      await ClipboardSetText(cmd);
      showToast("Comando copiado!");
    } catch {
      await navigator.clipboard.writeText(cmd);
      showToast("Comando copiado!");
    }
  }

  function insertEmoji(emoji: EmojiItem) {
    const el = messageRef.current;
    if (!el) {
      setEditorDraft((prev) => ({
        ...prev,
        message: `${prev.message}${emoji.unicode}`,
      }));
      return;
    }

    const start = el.selectionStart ?? editorDraft.message.length;
    const end = el.selectionEnd ?? editorDraft.message.length;
    const inserted = insertAtCursor(
      editorDraft.message,
      emoji.unicode,
      start,
      end,
    );

    setEditorDraft((prev) => ({ ...prev, message: inserted.value }));
    setPendingCursor(inserted.cursor);
  }

  /* ━━━━━━━━━━━━━━━━━━ LOADING ━━━━━━━━━━━━━━━━━━ */
  if (loading) {
    return (
      <div className="dark-bg min-h-screen flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="modal-solid w-[320px] p-6 text-center space-y-3"
        >
          <div className="mx-auto h-10 w-10 rounded-md bg-cyan-500 flex items-center justify-center">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div className="dark-shimmer h-2.5 rounded" />
          <div className="dark-shimmer h-2.5 w-3/4 mx-auto rounded" />
          <p className="text-slate-500 text-xs">Carregando...</p>
        </motion.div>
      </div>
    );
  }

  /* ━━━━━━━━━━━━━━━━━━ MAIN RENDER ━━━━━━━━━━━━━━━━━━ */
  const managedCount = dashboard?.snapshot.managedBinds.length ?? 0;
  const conflictCount = dashboard?.snapshot.conflicts.length ?? 0;

  return (
    <div className="dark-bg min-h-screen relative overflow-hidden">
      {/* ── Background particles ── */}
      <div className="bg-particle top-16 left-[8%] h-28 w-28 bg-cyan-500/[0.03] blur-2xl" />
      <div
        className="bg-particle top-32 right-[12%] h-32 w-32 bg-violet-500/[0.03] blur-3xl"
        style={{ animationDelay: "-2s" }}
      />

      {/* ── Container ── */}
      <div className="relative z-10 h-screen flex flex-col p-4">
        {/* ━━━ HEADER ━━━ */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center justify-between mb-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-500">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-gradient">
                Dota Bind Studio
              </h1>
              <p className="text-[11px] text-slate-600">
                Binds · <code className="text-cyan-500/70">autoexec.cfg</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge>{managedCount} binds</Badge>
            {conflictCount > 0 && (
              <Badge variant="warn">{conflictCount} conflitos</Badge>
            )}
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCcw className="h-3 w-3" /> Recarregar
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3 w-3" /> Novo bind
            </Button>
          </div>
        </motion.header>

        {/* ━━━ ERROR BANNER ━━━ */}
        <AnimatePresence>
          {error ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-rose-300 text-xs flex items-center gap-2"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError("")} className="text-rose-400 hover:text-rose-300">
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* ━━━ TAB BAR ━━━ */}
        <div className="flex items-center gap-1 border-b border-white/[0.06] mb-4">
          <button
            onClick={() => setMainTab("binds")}
            className={`tab-btn flex items-center gap-1.5 ${mainTab === "binds" ? "tab-btn-active" : ""}`}
          >
            <ListFilter className="h-3.5 w-3.5" />
            Binds
          </button>
          <button
            onClick={() => setMainTab("editor")}
            className={`tab-btn flex items-center gap-1.5 ${mainTab === "editor" ? "tab-btn-active" : ""}`}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editorDraft.oldKey ? "Editar bind" : "Editor"}
          </button>
          <button
            onClick={() => setMainTab("config")}
            className={`tab-btn flex items-center gap-1.5 ${mainTab === "config" ? "tab-btn-active" : ""}`}
          >
            <Settings className="h-3.5 w-3.5" />
            Configuração
          </button>
        </div>

        {/* ━━━ TAB CONTENT ━━━ */}
        <div className="flex-1 overflow-hidden">
          {/* ─── BINDS TAB ─── */}
          {mainTab === "binds" && (
            <div className="h-full flex flex-col gap-3">
              {/* Filters */}
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="flex flex-col gap-2 md:flex-row md:items-center"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por tecla, mensagem ou comando..."
                    className="pl-8"
                  />
                </div>

                <div className="flex gap-1.5">
                  <select
                    value={modeFilter}
                    onChange={(e) =>
                      setModeFilter(e.target.value as BindModeFilter)
                    }
                    className="h-8 rounded-md border border-white/[0.08] bg-[#1a1f2e] px-2.5 text-xs text-slate-300 outline-none cursor-pointer hover:border-white/15 transition-colors"
                  >
                    <option value="all">Modo: todos</option>
                    <option value="say">say</option>
                    <option value="say_team">say_team</option>
                  </select>
                  <select
                    value={sourceFilter}
                    onChange={(e) =>
                      setSourceFilter(e.target.value as BindSourceFilter)
                    }
                    className="h-8 rounded-md border border-white/[0.08] bg-[#1a1f2e] px-2.5 text-xs text-slate-300 outline-none cursor-pointer hover:border-white/15 transition-colors"
                  >
                    <option value="all">Fonte: todas</option>
                    <option value="managed">Gerenciados</option>
                    <option value="external">Externos</option>
                  </select>
                  <Button
                    variant={favoritesOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFavoritesOnly((v) => !v)}
                  >
                    <Star className="h-3 w-3" /> Favoritos
                  </Button>
                  <Button
                    variant={recentOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRecentOnly((v) => !v)}
                  >
                    Recentes
                  </Button>
                </div>
              </motion.div>

              {/* Bind List */}
              <div className="flex-1 overflow-auto pr-1 space-y-1.5">
                {visibleBinds.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center text-center py-16"
                  >
                    <div className="mb-3 h-10 w-10 rounded-md bg-white/[0.04] flex items-center justify-center">
                      <Search className="h-4 w-4 text-slate-600" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">
                      Nenhum bind encontrado
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      Ajuste os filtros ou crie um novo bind.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="show"
                    className="space-y-1.5"
                  >
                    {visibleBinds.map((bind, idx) => {
                      const used = extractEmojiItems(bind.message, emojiByUnicode);
                      const hasConflict =
                        (conflictByKey.get(bind.key) ?? []).length > 0;

                      return (
                        <motion.article
                          key={`${bind.source}:${bind.key}:${idx}`}
                          variants={itemVariants}
                          layout
                          className={`group glass px-3 py-2.5 hover:bg-white/[0.06] transition-all duration-150 cursor-default ${bind.source === "managed"
                            ? "accent-bar-managed"
                            : "accent-bar-external"
                            }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge className="font-mono text-[10px]">
                                  {bind.key}
                                </Badge>
                                <Badge variant="subtle">
                                  {bind.mode || "raw"}
                                </Badge>
                                <Badge
                                  variant={
                                    bind.source === "managed"
                                      ? "default"
                                      : "warn"
                                  }
                                >
                                  {bind.source}
                                </Badge>
                                {hasConflict ? (
                                  <Badge variant="danger">conflito</Badge>
                                ) : null}
                                {bind.favorite ? (
                                  <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                                ) : null}
                              </div>

                              <p className="truncate text-xs text-slate-300">
                                {bind.message || bind.commandRaw}
                              </p>

                              <div className="flex flex-wrap items-center gap-1 min-h-6">
                                {used.length ? (
                                  used.slice(0, 8).map((item) => (
                                    <span
                                      key={`${bind.key}:${item.code}`}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/[0.06] bg-white/[0.03] overflow-hidden"
                                      title={item.chatCode}
                                    >
                                      {item.gifUrl ? (
                                        <img
                                          src={item.gifUrl}
                                          alt={item.chatCode}
                                          className="h-4 w-4 object-contain"
                                        />
                                      ) : (
                                        <span className="text-xs leading-none">
                                          {item.unicode}
                                        </span>
                                      )}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[10px] text-slate-600">
                                    sem emoji
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleToggleFavorite(bind)}
                                className={
                                  bind.favorite
                                    ? "text-amber-400"
                                    : "text-slate-500"
                                }
                              >
                                <Star className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => openEdit(bind)}
                                disabled={!bind.parseable}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => openDuplicate(bind)}
                              >
                                <CopyPlus className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => void handleDelete(bind)}
                                disabled={bind.source !== "managed"}
                                className="hover:!text-rose-400"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </motion.article>
                      );
                    })}
                  </motion.div>
                )}
              </div>
            </div>
          )}

          {/* ─── EDITOR TAB ─── */}
          {mainTab === "editor" && (
            <motion.div
              key="editor-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col gap-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setMainTab("binds")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-cyan-400" />
                  {editorDraft.oldKey ? `Editar bind — ${editorDraft.oldKey}` : "Novo bind"}
                </h2>
              </div>

              {/* Editor form + emoji picker side by side */}
              <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Left: form */}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-slate-500">
                        Tecla
                      </label>
                      <div className="flex gap-1.5">
                        <Input
                          value={editorDraft.key}
                          onChange={(e) =>
                            setEditorDraft((prev) => ({
                              ...prev,
                              key: e.target.value.toUpperCase().trim(),
                            }))
                          }
                          placeholder="Ex: F6"
                          className="font-mono"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setKeyCaptureOpen(true)}
                        >
                          <Keyboard className="h-3 w-3" /> Capturar
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-slate-500">
                        Modo
                      </label>
                      <select
                        value={editorDraft.mode}
                        onChange={(e) =>
                          setEditorDraft((prev) => ({
                            ...prev,
                            mode: e.target.value as "say" | "say_team",
                          }))
                        }
                        className="h-8 w-full rounded-md border border-white/[0.08] bg-[#1a1f2e] px-2.5 text-sm text-slate-300 outline-none cursor-pointer"
                      >
                        <option value="say">say (all chat)</option>
                        <option value="say_team">say_team (team chat)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-slate-500">
                        Mensagem
                      </label>
                      <Button
                        variant={showEmojiPicker ? "default" : "outline"}
                        size="sm"
                        onClick={() => setShowEmojiPicker((v) => !v)}
                      >
                        <Sparkles className="h-3 w-3" />
                        {showEmojiPicker ? "Ocultar emojis" : "Emojis"}
                      </Button>
                    </div>
                    <Textarea
                      ref={messageRef}
                      value={editorDraft.message}
                      onChange={(e) =>
                        setEditorDraft((prev) => ({
                          ...prev,
                          message: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          void handleSaveEditor();
                        }
                      }}
                      placeholder="Ex: smoke agora + emoji"
                      className="min-h-20"
                    />
                  </div>

                  {/* Used emojis */}
                  <div className="flex flex-wrap items-center gap-1 min-h-6">
                    {draftUsedEmojis.length ? (
                      draftUsedEmojis.map((item) => (
                        <span
                          key={`draft:${item.code}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/[0.06] bg-white/[0.03]"
                          title={item.chatCode}
                        >
                          {item.gifUrl ? (
                            <img
                              src={item.gifUrl}
                              alt={item.chatCode}
                              className="h-5 w-5 object-contain"
                            />
                          ) : (
                            <span className="text-sm">{item.unicode}</span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-600">
                        nenhum emoji selecionado
                      </span>
                    )}
                  </div>

                  {/* Command preview */}
                  <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-1">
                    <p className="text-[11px] font-medium text-slate-500">
                      Comando final no autoexec
                    </p>
                    <code className="block rounded bg-black/40 p-2 text-[10px] text-cyan-300 font-mono break-all">
                      {draftCommandPreview}
                    </code>
                    {editorConflicts.length ? (
                      <div className="space-y-0.5 mt-1">
                        {editorConflicts.map((item, i) => (
                          <p
                            key={`${item.key}:${i}`}
                            className="text-[10px] text-amber-400"
                          >
                            ⚠ {item.description}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Save / cancel */}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMainTab("binds")}
                    >
                      <ArrowLeft className="h-3 w-3" /> Voltar
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleSaveEditor()}
                      disabled={editorSaving}
                    >
                      <Save className="h-3 w-3" />
                      {editorSaving ? "Salvando..." : "Salvar bind"}
                    </Button>
                  </div>
                </div>

                {/* Right: inline emoji picker */}
                {showEmojiPicker && (
                  <motion.div
                    initial={{ opacity: 0, x: 15 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-violet-400" />
                        Emojis
                      </h3>
                      <span className="text-[10px] text-slate-600">
                        Clique para inserir
                      </span>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                      <Input
                        value={emojiSearch}
                        onChange={(e) => setEmojiSearch(e.target.value)}
                        placeholder="Buscar :wink:, :laugh:, team..."
                        className="pl-8"
                      />
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 max-h-[52vh] overflow-auto pr-1">
                      {filteredEmojis.map((emoji) => (
                        <button
                          key={emoji.code}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="group rounded-md border border-white/[0.04] bg-white/[0.02] p-1.5 text-left transition-all duration-150 hover:bg-white/[0.07] hover:border-cyan-400/15"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-white/[0.03] border border-white/[0.04] shrink-0">
                              {emoji.gifUrl ? (
                                <img
                                  src={emoji.gifUrl}
                                  alt={emoji.chatCode}
                                  className="h-4 w-4 object-contain"
                                />
                              ) : (
                                <span className="text-sm leading-none">
                                  {emoji.unicode}
                                </span>
                              )}
                            </span>
                            <span className="text-[9px] font-medium text-slate-500 truncate group-hover:text-cyan-300 transition-colors">
                              {emoji.chatCode}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {/* ─── CONFIG TAB ─── */}
          {mainTab === "config" && (
            <motion.div
              key="config-tab"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className="max-w-lg space-y-4"
            >
              <div className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-500">
                    Path do autoexec.cfg
                  </span>
                  <Input
                    value={settingsPath}
                    onChange={(e) => setSettingsPath(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-500">
                    Comando de reload no console
                  </span>
                  <Input
                    value={settingsReloadCommand}
                    onChange={(e) =>
                      setSettingsReloadCommand(e.target.value)
                    }
                    className="font-mono text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-500">
                    Tecla exclusiva de reload
                  </span>
                  <Input
                    value={settingsReloadBindKey}
                    onChange={(e) =>
                      setSettingsReloadBindKey(
                        e.target.value.toUpperCase().trim(),
                      )
                    }
                    placeholder="Ex: F10"
                    className="font-mono text-xs"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                  size="sm"
                >
                  <Save className="h-3 w-3" />{" "}
                  {settingsSaving ? "Salvando..." : "Salvar"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyReloadCommand}
                >
                  <Copy className="h-3 w-3" /> Copiar comando
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━ TOASTS ━━━━━━━━━━━━━━━━━━ */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              layout
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              className="pointer-events-auto flex items-center gap-3 rounded-md border border-white/10 bg-[#111827] px-4 py-3 shadow-xl"
            >
              {toast.type === "success" && <Check className="h-4 w-4 text-cyan-400" />}
              {toast.type === "error" && <AlertCircle className="h-4 w-4 text-rose-400" />}
              {toast.type === "info" && <Info className="h-4 w-4 text-slate-400" />}
              <p className="text-sm font-medium text-slate-200">{toast.text}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━ KEY CAPTURE OVERLAY ━━━━━━━━━━━━━━━━━━ */}
      {/* Only overlay remaining — lightweight and ephemeral */}
      <AnimatePresence>
        {keyCaptureOpen ? (
          <motion.div
            key="key-overlay"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          >
            <motion.div
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="modal-solid p-6 text-center max-w-sm w-full space-y-3"
            >
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-cyan-500"
              >
                <Keyboard className="h-6 w-6 text-white" />
              </motion.div>
              <h4 className="text-sm font-bold text-slate-200">
                Pressione uma tecla
              </h4>
              <p className="text-xs text-slate-500">
                Captura ativa.{" "}
                <code className="rounded bg-white/[0.06] px-1 py-0.5 text-cyan-400 text-[10px]">
                  Esc
                </code>{" "}
                para cancelar.
              </p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function extractEmojiItems(
  message: string,
  emojiByUnicode: Map<string, EmojiItem>,
): EmojiItem[] {
  const out: EmojiItem[] = [];
  const seen = new Set<string>();
  for (const rune of [...message]) {
    const item = emojiByUnicode.get(rune);
    if (!item) continue;
    if (seen.has(item.chatCode)) continue;
    seen.add(item.chatCode);
    out.push(item);
  }
  return out;
}

function toMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: string }).message || "Erro desconhecido");
  }
  return "Erro desconhecido";
}

export default App;
