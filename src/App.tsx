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

  CopyPlus,
  X,
  HelpCircle,
  Check,
  Info,
  FolderOpen,
  Terminal,
  Gamepad2,
  Clipboard,
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

    return renderManagedBlock(binds, store.settings.reloadBindKey, store.settings.reloadCommand);
  }, [dashboard.snapshot?.allBinds, store.settings.reloadBindKey, store.settings.reloadCommand, editorDraft]);


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
    if (!window.confirm(`Deletar bind da tecla ${bind.key}?`)) return;
    store.deleteBind(bind.key);
    if (editorDraft.oldKey === bind.key || editorDraft.key === bind.key) {
      openCreate();
    }
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
    openCreate();
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

            <div className="flex-1 overflow-auto p-4 md:p-6 custom-scrollbar">
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
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Mensagem</label>
                    <div className="relative group">
                      <RichEditor
                        ref={messageRef}
                        value={editorDraft.message}
                        onChange={(val) => setEditorDraft(p => ({ ...p, message: val }))}
                        placeholder="Digite sua mensagem de chat roleta..."
                        emojiMap={emojiByUnicode}
                        className="min-h-[100px] w-full bg-black/20 border border-white/[0.08] focus:border-cyan-500/50 resize-y rounded-xl p-4 pr-36 text-sm leading-relaxed text-slate-200"
                        onKeyDown={(e) => {
                          if (e.altKey && e.key.toLowerCase() === "e") {
                            e.preventDefault();
                            setShowEmojiPicker(p => !p);
                          }
                        }}
                      />
                      <button
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className={`absolute top-2.5 right-2.5 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-all ${showEmojiPicker ? "bg-amber-500/20 text-amber-400 shadow-sm shadow-amber-500/10" : "text-amber-400/70 bg-black/30 hover:bg-amber-500/10 hover:text-amber-400 border border-white/[0.05]"
                          }`}
                      >
                        <Sparkles className="h-3 w-3" />
                        Emojis
                      </button>
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

                {/* ─── HOW IT WORKS ─── */}
                <div className="mt-4 rounded-xl border border-white/[0.05] bg-gradient-to-br from-white/[0.02] to-transparent p-5 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gradient-pink">Como funciona?</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pink-500/15 text-pink-400 text-xs font-bold">1</span>
                      <div>
                        <p className="text-xs font-semibold text-slate-300">Escolha a tecla</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">Clique e pressione qualquer tecla do teclado.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-400 text-xs font-bold">2</span>
                      <div>
                        <p className="text-xs font-semibold text-slate-300">Escreva a mensagem</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">Use emojis do Dota para personalizar!</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-400 text-xs font-bold">3</span>
                      <div>
                        <p className="text-xs font-semibold text-slate-300">Baixe o autoexec</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">Coloque em <code className="text-slate-400">/cfg/</code> e jogue!</p>
                      </div>
                    </div>
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

          {/* RIGHT: Binds List Panel */}
          <div className="w-full lg:w-[480px] xl:w-[560px] flex flex-col shrink-0 min-h-[400px] glass-right rounded-2xl overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.04] p-3 px-5 bg-white/[0.01] header-accent-cyan">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Meus Binds</h2>
                {managedCount > 0 && (
                  <span className="text-[11px] text-cyan-400/80 bg-cyan-500/10 px-2 py-0.5 rounded-full font-medium">{managedCount}</span>
                )}
              </div>
              {managedCount > 0 && (
                <Button size="sm" onClick={copyAutoexec} className="bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30 hover:text-cyan-300 h-8 text-xs">
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                  Copiar todos
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar">
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
                      <p className="text-sm text-slate-500 mt-1.5 max-w-sm">Crie um novo bind no painel ao lado para começar.</p>
                    </motion.div>
                  ) : (
                    <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 gap-3">
                      {visibleBinds.map((bind) => {
                        const isSay = bind.mode === "say";
                        return (
                          <motion.article
                            key={bind.key}
                            variants={itemVariants}
                            layout
                            className="group relative overflow-hidden rounded-xl border border-white/[0.05] bg-gradient-to-r from-white/[0.03] to-transparent p-4 pl-5 hover:border-white/[0.1] hover:shadow-lg hover:shadow-black/20 transition-all duration-300 cursor-pointer"
                            onClick={() => openEdit(bind)}
                          >
                            {/* Gradient accent bar */}
                            <div className={`absolute top-0 left-0 w-1 h-full ${isSay ? "bg-gradient-to-b from-cyan-400 to-cyan-600" : "bg-gradient-to-b from-violet-400 to-violet-600"}`} />

                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <kbd className={`px-2 py-0.5 rounded-md border text-xs font-mono font-bold shadow-sm ${isSay ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-300" : "bg-violet-500/10 border-violet-500/20 text-violet-300"}`}>
                                    {bind.key}
                                  </kbd>
                                  <Badge variant="outline" className={`text-[10px] uppercase tracking-wider border-0 ${isSay ? "bg-cyan-500/10 text-cyan-400/80" : "bg-violet-500/10 text-violet-400/80"}`}>
                                    {bind.mode.replace('_', ' ')}
                                  </Badge>
                                  {bind.favorite && (
                                    <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                                  )}
                                </div>
                                <div className="text-sm text-slate-200 line-clamp-2 leading-relaxed">
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
                                <button onClick={() => openDuplicate(bind)} className="p-1.5 rounded-md text-slate-500 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors">
                                  <CopyPlus className="h-3.5 w-3.5" />
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
                            No <span className="text-white font-medium">Steam</span> → botão direito no <span className="text-white font-medium">Dota 2</span> → <span className="text-white font-medium">Gerenciar</span> → <span className="text-white font-medium">Ver arquivos locais</span>
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
