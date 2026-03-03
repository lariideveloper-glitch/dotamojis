import { useEffect, useMemo, useRef, useState } from "react";
import { useBindStore } from "./store/useBindStore";
import { loadEmojiCatalog } from "./lib/emojis";
import { EmojiItem, BindEntry, ChatMode } from "./types/domain";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { RichEditor, RichEditorRef } from "./components/RichEditor";
import { Badge } from "./components/ui/badge";
import {
  AlertTriangle,
  Copy,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Pencil,
  CopyPlus,
  X,
  Zap,
  ListFilter,
  Download,
  Check,
  Info,
} from "lucide-react";
import { insertAtCursor, normalizeSearch } from "./lib/text";
import { toDotaKeyFromKeyboardEvent, PROTECTED_KEYS } from "./lib/keymap";
import { motion, AnimatePresence } from "framer-motion";
import { renderManagedBlock } from "./lib/autoexec";

type BindModeFilter = "all" | "say" | "say_team";
type MainTab = "binds" | "editor" | "config";

type EditorDraft = {
  oldKey: string;
  key: string;
  mode: ChatMode;
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

export default function App() {
  const store = useBindStore();
  const dashboard = store.getDashboardState();

  const [catalog] = useState(loadEmojiCatalog());
  const [error, setError] = useState("");

  const [mainTab, setMainTab] = useState<MainTab>("binds");

  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<BindModeFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);

  const [editorDraft, setEditorDraft] = useState<EditorDraft>(EMPTY_DRAFT);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");

  const [keyCaptureOpen, setKeyCaptureOpen] = useState(false);
  const [pendingCursor, setPendingCursor] = useState<number | null>(null);

  const [settingsReloadCommand, setSettingsReloadCommand] = useState(store.settings.reloadCommand);
  const [settingsReloadBindKey, setSettingsReloadBindKey] = useState(store.settings.reloadBindKey);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const messageRef = useRef<RichEditorRef>(null);

  function showToast(text: string, type: "success" | "error" | "info" = "success") {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }

  const emojiByUnicode = useMemo(() => {
    const map = new Map<string, EmojiItem>();
    for (const item of catalog.items) {
      map.set(item.unicode, item);
    }
    return map;
  }, [catalog]);

  const visibleBinds = useMemo(() => {
    const all = dashboard.snapshot?.allBinds || [];
    const q = normalizeSearch(query);

    const filtered = all.filter((bind) => {
      if (modeFilter !== "all" && bind.mode !== modeFilter) return false;
      if (favoritesOnly && !bind.favorite) return false;
      if (recentOnly && !bind.recent) return false;

      if (!q) return true;
      const haystack = `${bind.key} ${bind.mode} ${bind.message} ${bind.commandRaw}`.toLowerCase();
      return haystack.includes(q);
    });

    return filtered.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }, [dashboard.snapshot?.allBinds, query, modeFilter, favoritesOnly, recentOnly]);

  const filteredEmojis = useMemo(() => {
    const term = normalizeSearch(emojiSearch);
    const items = catalog.items;
    if (!term) return items.slice(0, 240);
    return items
      .filter((item) => {
        const tags = (item.tags ?? []).join(" ");
        return `${item.name} ${item.chatCode} ${tags}`.toLowerCase().includes(term);
      })
      .slice(0, 240);
  }, [catalog, emojiSearch]);

  // Extract emojis purely to show little chips in the UI
  // Real parsing relies on unicode matches
  const extractEmojiItems = (text: string) => {
    const out: EmojiItem[] = [];
    if (!text) return out;
    for (const char of text) {
      const match = emojiByUnicode.get(char);
      if (match && !out.includes(match)) out.push(match);
    }
    return out;
  };

  // Inline rich text emoji renderer
  const EmojiText = ({ text, className }: { text: string; className?: string }) => {
    if (!text) return null;
    const result: React.ReactNode[] = [];
    let currentStr = "";

    // Use Array.from for correct unicode surrogate pair iteration
    const chars = Array.from(text);

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const emoji = emojiByUnicode.get(char);
      if (emoji && emoji.gifUrl) {
        if (currentStr) {
          result.push(<span key={`str-${i}`}>{currentStr}</span>);
          currentStr = "";
        }
        result.push(
          <img
            key={`emoji-${i}`}
            src={emoji.gifUrl}
            alt={emoji.name}
            title={emoji.name}
            className="inline h-5 w-5 -mt-1 mx-0.5 object-contain select-none"
          />
        );
      } else {
        currentStr += char;
      }
    }
    if (currentStr) {
      result.push(<span key="str-end">{currentStr}</span>);
    }

    return <span className={className}>{result}</span>;
  };

  // Live Autoexec string preview
  const livePreviewString = useMemo(() => {
    let binds = [...(dashboard.snapshot?.allBinds || [])];

    // Inject the active editor draft for live preview
    if (mainTab === "editor" && editorDraft.key) {
      const draftBind: BindEntry = {
        key: editorDraft.key,
        mode: editorDraft.mode,
        message: editorDraft.message,
        commandRaw: `${editorDraft.mode} ${editorDraft.message}`,
        parseable: true,
        source: "managed",
        favorite: false,
        recent: true,
        updatedAt: Date.now(),
        previewText: editorDraft.message,
        emojis: [],
      };
      // remove old element if we are replacing it
      binds = binds.filter(b => b.key !== editorDraft.oldKey && b.key !== editorDraft.key);
      binds.push(draftBind);

      // Keep them sorted like before
      binds.sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        if (a.recent !== b.recent) return a.recent ? -1 : 1;
        return a.key.localeCompare(b.key);
      });
    }

    return renderManagedBlock(binds, store.settings.reloadBindKey, store.settings.reloadCommand);
  }, [dashboard.snapshot?.allBinds, store.settings.reloadBindKey, store.settings.reloadCommand, mainTab, editorDraft]);


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
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [keyCaptureOpen]);


  function openCreate() {
    setEditorDraft(EMPTY_DRAFT);
    setShowEmojiPicker(false);
    setEmojiSearch("");
    setMainTab("editor");
  }

  function openEdit(bind: BindEntry) {
    if (!bind.parseable) return;
    setEditorDraft({
      oldKey: bind.key,
      key: bind.key,
      mode: bind.mode,
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
      mode: bind.mode,
      message: bind.message,
    });
    setShowEmojiPicker(false);
    setEmojiSearch("");
    setMainTab("editor");
  }

  function handleDelete(bind: BindEntry) {
    if (!window.confirm(`Deletar bind da tecla ${bind.key}?`)) return;
    store.deleteBind(bind.key);
    showToast("Bind removido!");
  }

  function handleToggleFavorite(bind: BindEntry) {
    store.toggleFavorite(bind.key);
  }

  function handleSaveEditor() {
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
    store.upsertBind(editorDraft.oldKey, k, editorDraft.mode, editorDraft.message);
    setMainTab("binds");
    showToast("Bind salvo com sucesso!");
    setError("");
  }

  function handleSaveSettings() {
    store.updateSettings({
      reloadCommand: settingsReloadCommand,
      reloadBindKey: settingsReloadBindKey,
    });
    showToast("Configurações atualizadas!");
  }

  function insertEmoji(emoji: EmojiItem) {
    if (messageRef.current) {
      messageRef.current.insertEmoji(emoji);
    } else {
      setEditorDraft((prev) => ({
        ...prev,
        message: `${prev.message}${emoji.unicode}`,
      }));
    }
  }

  function downloadAutoexec() {
    const blob = new Blob([livePreviewString], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "autoexec.cfg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Download iniciado!");
  }

  async function copyAutoexec() {
    try {
      await navigator.clipboard.writeText(livePreviewString);
      showToast("Autoexec copiado para a área de transferência!");
    } catch {
      setError("Falha ao copiar. Selecione manualmente.");
    }
  }

  const managedCount = dashboard.snapshot?.allBinds.length || 0;

  return (
    <div className="dark-bg min-h-screen relative overflow-hidden flex flex-col items-center">
      {/* ── Background particles ── */}
      <div className="bg-particle top-16 left-[8%] h-28 w-28 bg-cyan-500/[0.03] blur-2xl" />
      <div
        className="bg-particle top-32 right-[12%] h-32 w-32 bg-violet-500/[0.03] blur-3xl"
        style={{ animationDelay: "-2s" }}
      />

      <div className="w-full max-w-7xl h-screen flex flex-col p-4 md:p-8 z-10 gap-6">
        {/* ━━━ HEADER ━━━ */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500 shadow-lg shadow-cyan-500/20">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gradient">
                Dota Bind Studio
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Modern Web Config Generator
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-cyan-500/20 text-cyan-400 bg-cyan-500/5 px-3 py-1">{managedCount} binds ativos</Badge>
            <Button size="sm" onClick={openCreate} className="bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-500/20 border-0 transition-all">
              <Plus className="h-4 w-4 mr-1.5" /> Novo bind
            </Button>
          </div>
        </motion.header>

        {/* ━━━ ERROR BANNER ━━━ */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{ opacity: 1, height: "auto", scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300 text-sm flex items-center gap-3 backdrop-blur-md shadow-lg shadow-rose-900/20"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="flex-1 font-medium">{error}</span>
              <button onClick={() => setError("")} className="text-rose-400 hover:text-rose-300 transition-colors bg-rose-500/10 rounded-md p-1">
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ━━━ MAIN LAYOUT (SPLIT) ━━━ */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">

          {/* LEFT: Builder Panel */}
          <div className="flex-1 flex flex-col min-w-0 glass rounded-2xl border border-white/[0.06] overflow-hidden shadow-2xl backdrop-blur-xl">
            {/* Tabs */}
            <div className="flex items-center gap-1 border-b border-white/[0.04] p-2 bg-white/[0.01]">
              <button
                onClick={() => setMainTab("binds")}
                className={`tab-btn flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${mainTab === "binds" ? "bg-white/[0.06] text-white shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"}`}
              >
                <ListFilter className="h-4 w-4" />
                Meus Binds
              </button>
              <button
                onClick={() => setMainTab("editor")}
                className={`tab-btn flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${mainTab === "editor" ? "bg-white/[0.06] text-white shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"}`}
              >
                <Pencil className="h-4 w-4" />
                {editorDraft.oldKey ? "Editar Bind" : "Novo Bind"}
              </button>
              <button
                onClick={() => setMainTab("config")}
                className={`tab-btn flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${mainTab === "config" ? "bg-white/[0.06] text-white shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]"}`}
              >
                <Settings className="h-4 w-4" />
                Configurar Reloader
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-6 custom-scrollbar">
              {/* ─── BINDS TAB ─── */}
              {mainTab === "binds" && (
                <div className="h-full flex flex-col gap-4">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col sm:flex-row gap-3"
                  >
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar por tecla ou mensagem..."
                        className="pl-9 h-10 bg-black/20 border-white/[0.05] focus:border-cyan-500/50 transition-colors"
                      />
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={modeFilter}
                        onChange={(e) => setModeFilter(e.target.value as BindModeFilter)}
                        className="h-10 rounded-md border border-white/[0.05] bg-black/20 px-3 text-sm text-slate-300 outline-none cursor-pointer hover:border-white/15 transition-colors"
                      >
                        <option value="all">Modo: todos</option>
                        <option value="say">All Chat (say)</option>
                        <option value="say_team">Team Chat (say_team)</option>
                      </select>
                      <Button
                        variant={favoritesOnly ? "default" : "outline"}
                        className={favoritesOnly ? "bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30" : "border-white/[0.05] bg-black/20 hover:bg-white/[0.05] text-slate-300"}
                        onClick={() => setFavoritesOnly((v) => !v)}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>

                  <div className="flex-1">
                    {visibleBinds.length === 0 ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center text-center py-20">
                        <div className="mb-4 h-14 w-14 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center shadow-inner">
                          <Search className="h-6 w-6 text-slate-500" />
                        </div>
                        <p className="text-base font-medium text-slate-300">Nenhum bind encontrado</p>
                        <p className="text-sm text-slate-500 mt-1.5 max-w-sm">Crie um novo bind utilizando o botão acima para começar a preencher seu autoexec.</p>
                      </motion.div>
                    ) : (
                      <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {visibleBinds.map((bind) => {
                          const used = extractEmojiItems(bind.message);
                          return (
                            <motion.article
                              key={bind.key}
                              variants={itemVariants}
                              layout
                              className="group relative overflow-hidden rounded-xl border border-white/[0.04] bg-white/[0.02] p-4 hover:bg-white/[0.04] hover:border-white/[0.08] transition-all duration-300"
                            >
                              <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500/50 scale-y-0 group-hover:scale-y-100 origin-top transition-transform duration-300" />

                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex items-center gap-2">
                                  <kbd className="px-2 py-0.5 rounded-md bg-black/40 border border-white/10 text-xs font-mono font-medium text-cyan-300 shadow-sm">
                                    {bind.key}
                                  </kbd>
                                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-slate-400 border-white/[0.05] bg-black/20">
                                    {bind.mode.replace('_', ' ')}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleToggleFavorite(bind)} className={`p-1.5 rounded-md transition-colors ${bind.favorite ? 'text-amber-400 bg-amber-400/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
                                    <Star className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => openEdit(bind)} className="p-1.5 rounded-md text-slate-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => openDuplicate(bind)} className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
                                    <CopyPlus className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => handleDelete(bind)} className="p-1.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 transition-colors">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>

                              <div className="text-sm text-slate-200 mt-2 line-clamp-2 leading-relaxed">
                                <EmojiText text={bind.message} />
                              </div>

                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {used.length > 0 ? used.map(item => (
                                  <span key={item.code} className="inline-flex h-6 w-6 items-center justify-center rounded bg-black/30 border border-white/[0.05]" title={item.name}>
                                    {item.gifUrl ? <img src={item.gifUrl} className="h-4 w-4 object-contain" /> : <span className="text-xs">{item.unicode}</span>}
                                  </span>
                                )) : <span className="text-[10px] text-slate-600 font-medium">SEM EMOJIS</span>}
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
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="max-w-3xl mx-auto space-y-6 py-2">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tecla de Ativação</label>
                      <button
                        className={`w-full group relative flex h-14 items-center justify-between rounded-xl border-2 transition-all ${keyCaptureOpen ? "border-cyan-500 bg-cyan-500/5 shadow-[0_0_15px_rgba(6,182,212,0.15)]" : "border-white/[0.08] bg-black/20 hover:border-white/20"
                          } px-4`}
                        onClick={() => setKeyCaptureOpen(!keyCaptureOpen)}
                      >
                        <div className="flex items-center gap-3">
                          <kbd className={`flex h-8 min-w-[32px] items-center justify-center rounded-md border font-mono text-sm shadow-sm transition-colors ${editorDraft.key ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" : "border-white/10 bg-white/5 text-slate-400"
                            }`}>
                            {editorDraft.key || "?"}
                          </kbd>
                          <span className="text-sm font-medium text-slate-300">
                            {keyCaptureOpen ? "Pressione a nova tecla agora... (Esc para cancelar)" : editorDraft.key ? "Clique para mudar a tecla" : "Clique para definir uma tecla"}
                          </span>
                        </div>
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Canal de Chat</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setEditorDraft(p => ({ ...p, mode: "say" }))}
                          className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-all ${editorDraft.mode === "say" ? "border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-md shadow-cyan-500/10" : "border-white/[0.05] bg-black/20 text-slate-400 hover:bg-white/5"
                            }`}
                        >
                          All Chat (say)
                        </button>
                        <button
                          onClick={() => setEditorDraft(p => ({ ...p, mode: "say_team" }))}
                          className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-all ${editorDraft.mode === "say_team" ? "border-violet-500 bg-violet-500/10 text-violet-300 shadow-md shadow-violet-500/10" : "border-white/[0.05] bg-black/20 text-slate-400 hover:bg-white/5"
                            }`}
                        >
                          Team Chat (say_team)
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Mensagem</label>
                        <button
                          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                          className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors ${showEmojiPicker ? "bg-amber-500/20 text-amber-400" : "text-amber-400/80 hover:bg-amber-500/10 hover:text-amber-400"
                            }`}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Dota Emojis (Alt+E)
                        </button>
                      </div>
                      <div className="relative group">
                        <RichEditor
                          ref={messageRef}
                          value={editorDraft.message}
                          onChange={(val) => setEditorDraft(p => ({ ...p, message: val }))}
                          placeholder="Digite sua mensagem de chat roleta..."
                          emojiMap={emojiByUnicode}
                          className="min-h-[100px] w-full bg-black/20 border border-white/[0.08] focus:border-cyan-500/50 resize-y rounded-xl p-4 text-sm leading-relaxed text-slate-200"
                          onKeyDown={(e) => {
                            if (e.altKey && e.key.toLowerCase() === "e") {
                              e.preventDefault();
                              setShowEmojiPicker(p => !p);
                            }
                          }}
                        />
                      </div>
                    </div>

                    <AnimatePresence>
                      {showEmojiPicker && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="rounded-xl border border-white/[0.08] bg-black/40 shadow-inner p-4 space-y-4">
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                <Input
                                  autoFocus
                                  value={emojiSearch}
                                  onChange={(e) => setEmojiSearch(e.target.value)}
                                  placeholder="Procurar emojis (ex: laugh, roshan)..."
                                  className="pl-9 h-9 text-sm bg-black/40 border-white/[0.05]"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-1 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                              {filteredEmojis.map((emoji) => (
                                <button
                                  key={emoji.code}
                                  onClick={() => insertEmoji(emoji)}
                                  className="flex h-10 items-center justify-center rounded-lg bg-white/[0.02] hover:bg-cyan-500/20 hover:scale-110 active:scale-95 transition-all outline-none border border-transparent hover:border-cyan-500/30"
                                  title={emoji.name}
                                >
                                  {emoji.gifUrl ? (
                                    <img src={emoji.gifUrl} alt={emoji.name} className="h-6 w-6 object-contain" />
                                  ) : (
                                    <span className="text-lg">{emoji.unicode}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                            {filteredEmojis.length === 0 && (
                              <p className="text-center text-sm text-slate-500 py-4">Nenhum emoji encontrado.</p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="pt-6 border-t border-white/[0.04] flex items-center justify-end gap-3">
                    <Button variant="ghost" onClick={() => setMainTab("binds")} className="text-slate-400 hover:text-white">
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveEditor} className="bg-cyan-600 hover:bg-cyan-500 text-white min-w-[120px]">
                      Salvar Bind
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* ─── CONFIG TAB ─── */}
              {mainTab === "config" && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-8 py-4">
                  <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-white">Configurações de Reload</h2>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      O Dota precisa recarregar o arquivo <code className="text-slate-300">autoexec.cfg</code> para aplicar os novos binds.
                      Nós adicionamos um "bind de reload" no seu arquivo para você não precisar digitar no console toda vez.
                    </p>

                    <div className="space-y-4 rounded-xl border border-white/[0.08] bg-black/20 p-5 mt-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tecla de Reload</label>
                        <Input
                          value={settingsReloadBindKey}
                          onChange={(e) => setSettingsReloadBindKey(e.target.value)}
                          placeholder="F10"
                          className="bg-black/30 border-white/[0.05]"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">Tecla usada para recarregar o autoexec in-game.</p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Comando de Reload</label>
                        <Input
                          value={settingsReloadCommand}
                          onChange={(e) => setSettingsReloadCommand(e.target.value)}
                          placeholder="exec autoexec.cfg"
                          className="bg-black/30 border-white/[0.05]"
                        />
                      </div>

                      <Button onClick={handleSaveSettings} className="w-full sm:w-auto mt-4">
                        Salvar Configurações
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* RIGHT: Live Preview Panel (Code Aesthetic) */}
          <div className="w-full lg:w-[480px] xl:w-[560px] flex flex-col shrink-0 min-h-[400px] glass rounded-2xl border border-white/[0.06] overflow-hidden shadow-2xl backdrop-blur-xl relative group">
            <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0E1117]/80 px-4 py-3 backdrop-blur-md sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                  <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                </div>
                <span className="text-xs font-mono text-slate-400 tracking-wide">autoexec.cfg</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="icon-sm" variant="ghost" onClick={copyAutoexec} className="text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 h-8 w-8 rounded-md" title="Copiar código">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={downloadAutoexec} className="bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30 hover:text-cyan-300 h-8" title="Fazer Download do .cfg">
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-[#0E1117]/95 p-4 md:p-6 custom-scrollbar font-mono text-sm leading-[1.6]">
              {managedCount === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-slate-600 italic">O autoexec gerado aparecerá aqui...</p>
                </div>
              ) : (
                <pre className="text-slate-300 w-full whitespace-pre-wrap word-break-all">
                  {livePreviewString.split('\n').map((line, i) => {
                    const isComment = line.trim().startsWith('//');
                    const isBind = line.trim().startsWith('bind');

                    if (isComment) {
                      return <div key={i} className="text-emerald-500/70">{line}</div>;
                    }
                    if (isBind) {
                      // rough simplistic syntax highlighting
                      return (
                        <div key={i}>
                          <span className="text-cyan-400">bind</span>
                          <span className="text-amber-300">{line.substring(4)}</span>
                        </div>
                      );
                    }
                    return <div key={i}>{line}</div>;
                  })}
                </pre>
              )}
            </div>

            {/* Premium Glow effect bottom */}
            <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-cyan-900/10 to-transparent pointer-events-none" />
          </div>

        </div>
      </div>

      {/* Global Toast Container */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg pointer-events-auto backdrop-blur-md ${toast.type === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : toast.type === "error"
                  ? "border-rose-500/20 bg-rose-500/10 text-rose-400"
                  : "border-cyan-500/20 bg-cyan-500/10 text-cyan-400"
                }`}
            >
              {toast.type === "success" && <Check className="h-4 w-4 shrink-0" />}
              {toast.type === "error" && <AlertTriangle className="h-4 w-4 shrink-0" />}
              {toast.type === "info" && <Info className="h-4 w-4 shrink-0" />}
              <span className="text-sm font-medium">{toast.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
