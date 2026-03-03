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
  Search,
  Sparkles,
  Star,
  Trash2,
  Pencil,
  X,
  HelpCircle,
  Check,
  Info,
  FolderOpen,
  Terminal,
  Gamepad2,
  Clipboard,
  Smile,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { normalizeSearch } from "./lib/text";
import { toDotaKeyFromKeyboardEvent, PROTECTED_KEYS } from "./lib/keymap";
import { motion, AnimatePresence } from "framer-motion";
import { renderManagedBlock } from "./lib/autoexec";

type BindModeFilter = "all" | "say" | "say_team";

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

  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('dotamojis_welcomed'));
  const [welcomeStep, setWelcomeStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  const [rightTab, setRightTab] = useState<"binds" | "preview">("binds");
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    variant: "danger" | "warning";
    onConfirm: () => void;
  }>({ open: false, title: "", message: "", confirmLabel: "Confirmar", variant: "danger", onConfirm: () => { } });
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<BindModeFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [editorDraft, setEditorDraft] = useState<EditorDraft>(EMPTY_DRAFT);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");

  const [keyCaptureOpen, setKeyCaptureOpen] = useState(false);

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


      if (!q) return true;
      const haystack = `${bind.key} ${bind.mode} ${bind.message} ${bind.commandRaw}`.toLowerCase();
      return haystack.includes(q);
    });

    return filtered.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
  }, [dashboard.snapshot?.allBinds, query, modeFilter, favoritesOnly]);

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
    if (editorDraft.key) {
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

    return renderManagedBlock(binds);
  }, [dashboard.snapshot?.allBinds, editorDraft]);


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
  }

  function handleDelete(bind: BindEntry) {
    setConfirmModal({
      open: true,
      title: "Deletar bind",
      message: `Tem certeza que deseja deletar o bind da tecla "${bind.key}"?`,
      confirmLabel: "Deletar",
      variant: "danger",
      onConfirm: () => {
        store.deleteBind(bind.key);
        if (editorDraft.oldKey === bind.key || editorDraft.key === bind.key) {
          openCreate();
        }
        showToast("Bind removido!");
        setConfirmModal(m => ({ ...m, open: false }));
      },
    });
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
      setConfirmModal({
        open: true,
        title: "Tecla protegida",
        message: `A tecla "${k}" é usada por padrão no Dota 2 (spells/items). Tem certeza que deseja usá-la para um bind?`,
        confirmLabel: "Usar mesmo assim",
        variant: "warning",
        onConfirm: () => {
          store.upsertBind(editorDraft.oldKey, k, editorDraft.mode, editorDraft.message);
          openCreate();
          setRightTab("binds");
          showToast("Bind salvo com sucesso!");
          setError("");
          setConfirmModal(m => ({ ...m, open: false }));
        },
      });
      return;
    }
    store.upsertBind(editorDraft.oldKey, k, editorDraft.mode, editorDraft.message);
    openCreate();
    setRightTab("binds");
    showToast("Bind salvo com sucesso!");
    setError("");
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
      <div className="bg-particle top-16 left-[8%] h-28 w-28 bg-rose-500/[0.04] blur-2xl" />
      <div
        className="bg-particle top-32 right-[12%] h-32 w-32 bg-violet-500/[0.04] blur-3xl"
        style={{ animationDelay: "-2s" }}
      />
      <div
        className="bg-particle bottom-24 left-[25%] h-24 w-24 bg-cyan-500/[0.03] blur-2xl"
        style={{ animationDelay: "-4s" }}
      />
      <div
        className="bg-particle top-[45%] right-[5%] h-20 w-20 bg-pink-500/[0.03] blur-xl"
        style={{ animationDelay: "-3s" }}
      />

      <div className="w-full max-w-7xl h-screen flex flex-col p-4 md:p-6 z-10 gap-4">

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
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">

          <div className="flex-1 flex flex-col min-w-0 glass-premium rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.04] p-3 px-5 bg-white/[0.01] header-accent">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-extrabold tracking-tight text-gradient-pink">
                  Dotamojis
                </h1>
                <span className="text-slate-600 text-sm">•</span>
                <span className="text-xs text-slate-400 font-medium">
                  {editorDraft.oldKey ? "Editar Bind" : "Novo Bind"}
                </span>
              </div>
              <button
                onClick={() => setShowTutorial(true)}
                className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium hover:text-pink-400 transition-colors px-2 py-1 rounded-lg hover:bg-pink-500/10"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Como instalar?
              </button>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden p-4 md:p-5">
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="max-w-3xl mx-auto flex flex-col gap-3 h-full">

                {/* Row 1: Key Capture + Chat Mode on same line */}
                <div className="flex gap-2 items-stretch">
                  <button
                    className={`flex-1 group relative flex h-12 items-center rounded-xl border-2 transition-all ${keyCaptureOpen ? "border-cyan-500 bg-cyan-500/5 shadow-[0_0_15px_rgba(6,182,212,0.15)]" : "border-white/[0.08] bg-black/20 hover:border-white/20"
                      } px-3`}
                    onClick={() => setKeyCaptureOpen(!keyCaptureOpen)}
                  >
                    <div className="flex items-center gap-2">
                      <kbd className={`flex h-7 min-w-[28px] items-center justify-center rounded-md border font-mono text-xs shadow-sm transition-colors ${editorDraft.key ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" : "border-white/10 bg-white/5 text-slate-400"
                        }`}>
                        {editorDraft.key || "?"}
                      </kbd>
                      <span className="text-xs font-medium text-slate-400 truncate">
                        {keyCaptureOpen ? "Pressione a tecla..." : editorDraft.key ? "Mudar tecla" : "Definir tecla"}
                      </span>
                    </div>
                  </button>
                  <select
                    value={editorDraft.mode}
                    onChange={(e) => setEditorDraft(p => ({ ...p, mode: e.target.value as "say" | "say_team" }))}
                    className={`h-12 rounded-xl border-2 px-3 text-xs font-medium outline-none transition-all cursor-pointer ${editorDraft.mode === "say"
                        ? "border-cyan-500/30 bg-cyan-500/5 text-cyan-300"
                        : "border-violet-500/30 bg-violet-500/5 text-violet-300"
                      }`}
                  >
                    <option value="say">All Chat</option>
                    <option value="say_team">Team Chat</option>
                  </select>
                </div>

                {/* Row 2: Message textarea (compact) */}
                <div className="relative">
                  <RichEditor
                    ref={messageRef}
                    value={editorDraft.message}
                    onChange={(val) => setEditorDraft(p => ({ ...p, message: val }))}
                    placeholder="Digite seu novo bind..."
                    emojiMap={emojiByUnicode}
                    className="min-h-[72px] w-full bg-black/20 border border-white/[0.08] focus:border-cyan-500/50 resize-none rounded-xl p-3 text-sm leading-relaxed text-slate-200"
                  />
                </div>

                {/* Row 3: Emoji grid — fills remaining space */}
                <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-white/[0.08] bg-black/40 shadow-inner overflow-hidden">
                  <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Emojis</span>
                    <div className="relative flex-1 ml-1">
                      <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                      <Input
                        value={emojiSearch}
                        onChange={(e) => setEmojiSearch(e.target.value)}
                        placeholder="Buscar..."
                        className="pl-7 h-7 text-[11px] bg-black/40 border-white/[0.05]"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-3 pb-3 custom-scrollbar">
                    <div className="grid grid-cols-8 sm:grid-cols-10 md:grid-cols-12 gap-1">
                      {filteredEmojis.map((emoji) => (
                        <button
                          key={emoji.code}
                          onClick={() => insertEmoji(emoji)}
                          className="flex h-8 items-center justify-center rounded-lg bg-white/[0.02] hover:bg-cyan-500/20 hover:scale-110 active:scale-95 transition-all outline-none border border-transparent hover:border-cyan-500/30"
                          title={emoji.name}
                        >
                          {emoji.gifUrl ? (
                            <img src={emoji.gifUrl} alt={emoji.name} className="h-5 w-5 object-contain" />
                          ) : (
                            <span className="text-sm">{emoji.unicode}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    {filteredEmojis.length === 0 && (
                      <p className="text-center text-xs text-slate-500 py-2">Nenhum emoji encontrado.</p>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>

            {/* ─── STICKY FOOTER BUTTONS ─── */}
            <div className="border-t border-white/[0.06] bg-[#0a0e1a]/80 backdrop-blur-md px-5 py-3 flex items-center justify-end gap-3 shrink-0">
              <Button variant="ghost" onClick={openCreate} className="text-slate-400 hover:text-white">
                Limpar
              </Button>
              <Button onClick={handleSaveEditor} className="bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500 text-white min-w-[120px] shadow-lg shadow-pink-500/20 transition-all border-0">
                Salvar Bind
              </Button>
            </div>
          </div>

          {/* RIGHT: Binds & Preview Panel */}
          <div className="w-full lg:w-[480px] xl:w-[560px] flex flex-col shrink-0 min-h-[400px] glass-right rounded-2xl overflow-hidden relative">
            {/* Tab Header */}
            <div className="flex items-center justify-between border-b border-white/[0.04] p-3 px-5 bg-white/[0.01] header-accent-cyan">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setRightTab("binds")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${rightTab === "binds" ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white hover:bg-white/[0.04]"}`}
                >
                  Meus Binds
                  {managedCount > 0 && (
                    <span className="ml-1.5 text-[10px] text-cyan-400/80 bg-cyan-500/10 px-1.5 py-0.5 rounded-full">{managedCount}</span>
                  )}
                </button>
                <button
                  onClick={() => setRightTab("preview")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${rightTab === "preview" ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-white hover:bg-white/[0.04]"}`}
                >
                  Preview
                </button>
              </div>
              {managedCount > 0 && (
                <Button size="sm" onClick={copyAutoexec} className="bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30 hover:text-cyan-300 h-8 text-xs">
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Copiar todos
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar">
              {/* === BINDS TAB === */}
              {rightTab === "binds" && (
                <div className="h-full flex flex-col gap-4 p-4 md:p-5">
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
                        className="h-10 rounded-md border border-white/[0.08] bg-black/20 px-3 text-sm text-slate-300 focus:border-cyan-500/50 outline-none transition-colors"
                      >
                        <option value="all">Modo: todos</option>
                        <option value="say">say</option>
                        <option value="say_team">say_team</option>
                      </select>

                      <button
                        onClick={() => setFavoritesOnly(!favoritesOnly)}
                        className={`flex items-center justify-center h-10 w-10 rounded-md border transition-colors ${favoritesOnly
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
                          : "border-white/[0.08] bg-black/20 text-slate-400 hover:text-amber-400"
                          }`}
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.div>

                  <div className="flex-1">
                    {visibleBinds.length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-center py-16 gap-3 opacity-60">
                        <Info className="h-8 w-8 text-slate-500" />
                        <p className="text-sm text-slate-400">Nenhum bind encontrado</p>
                      </div>
                    ) : (
                      <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 gap-3">
                        {visibleBinds.map((bind) => {
                          const isSay = bind.mode === "say";
                          return (
                            <motion.article
                              key={bind.key}
                              variants={itemVariants}
                              onClick={() => openEdit(bind)}
                              className={`group relative rounded-xl border cursor-pointer transition-all hover:shadow-lg ${isSay
                                ? "border-cyan-500/10 hover:border-cyan-500/25 bg-gradient-to-r from-cyan-500/[0.04] to-transparent hover:shadow-cyan-500/5"
                                : "border-violet-500/10 hover:border-violet-500/25 bg-gradient-to-r from-violet-500/[0.04] to-transparent hover:shadow-violet-500/5"
                                } overflow-hidden`}
                            >
                              {/* Gradient accent bar */}
                              <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${isSay ? "bg-gradient-to-b from-cyan-400 to-cyan-600" : "bg-gradient-to-b from-violet-400 to-violet-600"
                                }`} />

                              <div className="flex items-start gap-3 p-3.5 pl-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${isSay ? "bg-cyan-500/15 text-cyan-400" : "bg-violet-500/15 text-violet-400"
                                      }`}>{bind.key.toUpperCase()}</span>
                                    <span className={`text-[10px] font-medium uppercase tracking-wider ${isSay ? "text-cyan-500/60" : "text-violet-500/60"}`}>{bind.mode === "say" ? "SAY" : "TEAM"}</span>
                                  </div>
                                  <div className="text-sm text-slate-300 leading-relaxed break-words">
                                    <EmojiText text={bind.message} />
                                  </div>
                                  {/* Raw command preview */}
                                  <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-[#0E1117]/80 border border-white/[0.04] font-mono text-[11px] text-slate-500 truncate">
                                    <span className="text-cyan-500/70">bind</span> <span className="text-amber-400/60">"{bind.key}"</span> <span className="text-slate-500/80">"{bind.mode} {bind.message}"</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => handleToggleFavorite(bind)} className={`p-1.5 rounded-md transition-colors ${bind.favorite ? 'text-amber-400 bg-amber-400/10' : 'text-slate-500 hover:text-amber-400 hover:bg-amber-400/10'}`}>
                                    <Star className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => openEdit(bind)} className="p-1.5 rounded-md text-slate-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => handleDelete(bind)} className="p-1.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 transition-colors">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
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

              {/* === PREVIEW TAB === */}
              {rightTab === "preview" && (
                <div className="h-full flex flex-col p-4 md:p-5 gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">Conteúdo do seu autoexec.cfg</p>
                    <Button size="sm" onClick={copyAutoexec} className="bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30 hover:text-cyan-300 h-7 text-xs">
                      <Copy className="h-3 w-3 mr-1.5" />
                      Copiar
                    </Button>
                  </div>
                  <pre className="flex-1 rounded-xl bg-[#0a0e18] border border-white/[0.05] p-4 font-mono text-xs text-slate-400 leading-relaxed overflow-auto whitespace-pre-wrap break-all custom-scrollbar">
                    {livePreviewString || <span className="text-slate-600 italic">Nenhum bind criado ainda...</span>}
                  </pre>
                </div>
              )}
            </div>

            {/* Premium Glow effect bottom */}
            <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-cyan-900/10 to-transparent pointer-events-none" />
          </div>

        </div>
      </div>

      {/* ━━━ TUTORIAL MODAL (Step Wizard) ━━━ */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => { setShowTutorial(false); setTutorialStep(0); }}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="relative w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0d1221]/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Gradient progress bar */}
              <div className="h-1 bg-white/[0.05]">
                <motion.div
                  className="h-full bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500"
                  initial={{ width: "25%" }}
                  animate={{ width: `${((tutorialStep + 1) / 4) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Header */}
              <div className="p-5 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white">Como instalar</h2>
                    <span className="text-[11px] text-slate-500 bg-white/[0.05] px-2 py-0.5 rounded-full">Passo {tutorialStep + 1} de 4</span>
                  </div>
                  <button onClick={() => { setShowTutorial(false); setTutorialStep(0); }} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Step content — fixed height, animated */}
              <div className="px-5 pb-3 min-h-[200px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tutorialStep}
                    initial={{ opacity: 0, x: 30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                  >
                    {tutorialStep === 0 && (
                      <div className="flex flex-col items-center text-center gap-4 py-4">
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-pink-500/20 to-pink-600/10 flex items-center justify-center border border-pink-500/20">
                          <Sparkles className="h-7 w-7 text-pink-400" />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white mb-2">Crie seus binds</h3>
                          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
                            Use o editor para criar seus binds com emojis do Dota. Escolha a <span className="text-white font-medium">tecla de ativação</span>, o <span className="text-white font-medium">canal de chat</span>, e escreva a <span className="text-white font-medium">mensagem</span> com emojis!
                          </p>
                        </div>
                      </div>
                    )}

                    {tutorialStep === 1 && (
                      <div className="flex flex-col items-center text-center gap-4 py-4">
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-600/10 flex items-center justify-center border border-violet-500/20">
                          <Clipboard className="h-7 w-7 text-violet-400" />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white mb-2">Copie o código</h3>
                          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
                            Após criar seus binds, clique em <span className="text-cyan-400 font-semibold">"Copiar todos"</span> no painel de binds. Todo o código do autoexec será copiado automáticamente.
                          </p>
                        </div>
                      </div>
                    )}

                    {tutorialStep === 2 && (
                      <div className="flex flex-col items-center text-center gap-4 py-4">
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 flex items-center justify-center border border-cyan-500/20">
                          <FolderOpen className="h-7 w-7 text-cyan-400" />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white mb-2">Abra a pasta do Dota</h3>
                          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto mb-3">
                            No <span className="text-white font-medium">Steam</span> → <span className="text-white font-medium">Biblioteca</span> → botão direito no <span className="text-white font-medium">Dota 2</span> → <span className="text-white font-medium">Arquivos Instalados</span> → <span className="text-white font-medium">Explorar</span>
                          </p>
                          <code className="inline-block text-xs text-amber-400/80 bg-black/50 border border-white/[0.06] rounded-lg px-4 py-2 font-mono">
                            game → dota → cfg
                          </code>
                        </div>
                      </div>
                    )}

                    {tutorialStep === 3 && (
                      <div className="flex flex-col items-center text-center gap-4 py-4">
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center border border-emerald-500/20">
                          <Terminal className="h-7 w-7 text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-white mb-2">Cole no autoexec.cfg</h3>
                          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
                            Na pasta <span className="text-white font-medium">cfg</span>, abra (ou crie) o arquivo <span className="text-amber-400 font-medium">autoexec.cfg</span> com o <span className="text-white font-medium">Bloco de Notas</span>. Cole com <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white text-xs font-mono">Ctrl+V</kbd> e salve!
                          </p>
                          <div className="mt-3 flex items-center gap-2 justify-center p-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                            <Gamepad2 className="h-4 w-4 text-emerald-400" />
                            <span className="text-xs text-emerald-300/80 font-medium">Pronto! Abra o Dota e jogue!</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Footer: dots + navigation */}
              <div className="flex items-center justify-between p-5 pt-2  border-t border-white/[0.04]">
                {/* Dot indicators */}
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <button
                      key={i}
                      onClick={() => setTutorialStep(i)}
                      className={`h-2 rounded-full transition-all duration-300 ${i === tutorialStep ? "w-6 bg-gradient-to-r from-pink-500 to-violet-500" : "w-2 bg-white/[0.15] hover:bg-white/[0.3]"
                        }`}
                    />
                  ))}
                </div>

                {/* Navigation buttons */}
                <div className="flex gap-2">
                  {tutorialStep > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTutorialStep(s => s - 1)}
                      className="text-slate-400 hover:text-white h-8"
                    >
                      Anterior
                    </Button>
                  )}
                  {tutorialStep < 3 ? (
                    <Button
                      size="sm"
                      onClick={() => setTutorialStep(s => s + 1)}
                      className="bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500 text-white h-8 border-0"
                    >
                      Próximo
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => { setShowTutorial(false); setTutorialStep(0); }}
                      className="bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white h-8 border-0"
                    >
                      Entendi!
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ━━━ WELCOME MODAL (First Visit) ━━━ */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 350, damping: 28 }}
              className="relative w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0d1221]/95 backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden"
            >
              {/* Progress bar */}
              <div className="h-1 bg-white/[0.05]">
                <motion.div
                  className="h-full bg-gradient-to-r from-pink-500 via-rose-500 to-violet-500"
                  animate={{ width: `${((welcomeStep + 1) / 3) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Content */}
              <div className="px-6 pt-6 pb-3 min-h-[260px] flex flex-col justify-center">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={welcomeStep}
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -40 }}
                    transition={{ duration: 0.25 }}
                  >
                    {welcomeStep === 0 && (
                      <div className="flex flex-col items-center text-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-pink-500/20 to-violet-500/10 flex items-center justify-center border border-pink-500/15 shadow-lg shadow-pink-500/5">
                          <Sparkles className="h-8 w-8 text-pink-400" />
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-white mb-1">Bem-vindo ao Dotamojis!</h2>
                          <p className="text-xs text-pink-400/60 font-medium uppercase tracking-wider mb-3">Gerador de Binds com Emojis</p>
                          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
                            <span className="text-white font-medium">Binds</span> são atalhos de teclado que enviam mensagens automaticamente no chat do Dota 2. Com o Dotamojis, você cria binds <span className="text-pink-400 font-medium">personalizados com emojis</span> de forma rápida e fácil!
                          </p>
                        </div>
                      </div>
                    )}

                    {welcomeStep === 1 && (
                      <div className="flex flex-col items-center text-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/10 flex items-center justify-center border border-violet-500/15 shadow-lg shadow-violet-500/5">
                          <Smile className="h-8 w-8 text-violet-400" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-white mb-2">Emojis sem comprar?!</h2>
                          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
                            Sim! Os emojis do Dota normalmente precisam ser desbloqueados no Battle Pass. Mas existe um <span className="text-violet-400 font-medium">truque via autoexec</span>: usando os códigos unicode dos emojis diretamente nos comandos de bind, eles aparecem no chat <span className="text-white font-medium">mesmo sem tê-los na conta</span>!
                          </p>
                        </div>
                      </div>
                    )}

                    {welcomeStep === 2 && (
                      <div className="flex flex-col items-center text-center gap-4">
                        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/10 flex items-center justify-center border border-emerald-500/15 shadow-lg shadow-emerald-500/5">
                          <ShieldCheck className="h-8 w-8 text-emerald-400" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-white mb-2">É seguro?</h2>
                          <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto">
                            <span className="text-emerald-400 font-medium">Sim, totalmente!</span> O autoexec.cfg é apenas um <span className="text-white font-medium">arquivo de texto</span> da própria Steam que configura comandos do jogo. Não altera arquivos do sistema, não instala nada e <span className="text-white font-medium">não há risco de ban</span>.
                          </p>
                          <a
                            href="https://developer.valvesoftware.com/wiki/Autoexec"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Saiba mais sobre autoexec (Valve Wiki)
                          </a>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Footer: checkbox + dots + navigation */}
              {welcomeStep === 2 && (
                <div className="flex items-center justify-center px-6 pb-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={dontShowAgain}
                      onChange={(e) => setDontShowAgain(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-pink-500 cursor-pointer"
                    />
                    <span className="text-xs text-slate-500 group-hover:text-slate-400 transition-colors">Não mostrar novamente</span>
                  </label>
                </div>
              )}
              <div className="flex items-center justify-between px-6 pb-5 pt-2">
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <button
                      key={i}
                      onClick={() => setWelcomeStep(i)}
                      className={`h-2 rounded-full transition-all duration-300 ${i === welcomeStep ? "w-6 bg-gradient-to-r from-pink-500 to-rose-500" : "w-2 bg-white/[0.15] hover:bg-white/[0.3]"
                        }`}
                    />
                  ))}
                </div>

                <div className="flex gap-2">
                  {welcomeStep > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setWelcomeStep(s => s - 1)}
                      className="text-slate-400 hover:text-white h-8"
                    >
                      Anterior
                    </Button>
                  )}
                  {welcomeStep < 2 ? (
                    <Button
                      size="sm"
                      onClick={() => setWelcomeStep(s => s + 1)}
                      className="bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white h-8 border-0"
                    >
                      Próximo
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => { setShowWelcome(false); if (dontShowAgain) localStorage.setItem('dotamojis_welcomed', '1'); }}
                      className="bg-gradient-to-r from-pink-600 to-violet-600 hover:from-pink-500 hover:to-violet-500 text-white h-8 border-0"
                    >
                      Começar!
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ━━━ CUSTOM CONFIRM MODAL ━━━ */}
      <AnimatePresence>
        {confirmModal.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmModal(m => ({ ...m, open: false }))} />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="relative w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0d1221]/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-6"
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className={`h-14 w-14 rounded-2xl flex items-center justify-center border ${confirmModal.variant === "danger"
                  ? "bg-gradient-to-br from-rose-500/20 to-rose-600/10 border-rose-500/20"
                  : "bg-gradient-to-br from-amber-500/20 to-amber-600/10 border-amber-500/20"
                  }`}>
                  <AlertTriangle className={`h-7 w-7 ${confirmModal.variant === "danger" ? "text-rose-400" : "text-amber-400"}`} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white mb-1">{confirmModal.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{confirmModal.message}</p>
                </div>
                <div className="flex gap-2 w-full mt-1">
                  <Button
                    variant="ghost"
                    className="flex-1 text-slate-400 hover:text-white h-9"
                    onClick={() => setConfirmModal(m => ({ ...m, open: false }))}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className={`flex-1 h-9 border-0 text-white ${confirmModal.variant === "danger"
                      ? "bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600"
                      : "bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600"
                      }`}
                    onClick={confirmModal.onConfirm}
                  >
                    {confirmModal.confirmLabel}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
