import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AppSettings, BindEntry, AutoexecSnapshot, DashboardState, ChatMode } from "../types/domain";

export const DEFAULT_RELOAD_COMMAND = "exec autoexec.cfg";
export const DEFAULT_RELOAD_KEY = "F10";

interface BindStoreState {
    settings: AppSettings;
    managedBinds: Record<string, BindEntry>;

    // Actions
    upsertBind: (oldKey: string, key: string, mode: ChatMode, message: string) => void;
    deleteBind: (key: string) => void;
    toggleFavorite: (key: string) => void;
    updateSettings: (partial: Partial<AppSettings>) => void;

    // Computed (will be derived in the store or components, but we provide a helper to generate the DashboardState facade)
    getDashboardState: () => DashboardState;
}

export const useBindStore = create<BindStoreState>()(
    persist(
        (set, get) => ({
            settings: {
                autoexecPath: "",
                reloadCommand: DEFAULT_RELOAD_COMMAND,
                reloadBindKey: DEFAULT_RELOAD_KEY,
                favoriteKeys: {},
                recentKeys: [],
            },
            managedBinds: {},

            upsertBind: (oldKey, key, mode, message) => {
                set((state) => {
                    const newBinds = { ...state.managedBinds };

                    if (oldKey && oldKey !== key) {
                        delete newBinds[oldKey];
                    }

                    newBinds[key] = {
                        key,
                        mode,
                        message,
                        commandRaw: `${mode} ${message}`,
                        parseable: true,
                        source: "managed",
                        favorite: state.settings.favoriteKeys[key] || false,
                        recent: true,
                        updatedAt: Date.now(),
                        previewText: message,
                        emojis: [], // Will be parsed later inside components or via a helper
                    };

                    // Update recent keys
                    const newRecent = [key, ...state.settings.recentKeys.filter(k => k !== key)].slice(0, 30);

                    return {
                        managedBinds: newBinds,
                        settings: {
                            ...state.settings,
                            recentKeys: newRecent
                        }
                    };
                });
            },

            deleteBind: (key) => {
                set((state) => {
                    const newBinds = { ...state.managedBinds };
                    delete newBinds[key];
                    return { managedBinds: newBinds };
                });
            },

            toggleFavorite: (key) => {
                set((state) => {
                    const newFavs = { ...state.settings.favoriteKeys };
                    if (newFavs[key]) {
                        delete newFavs[key];
                    } else {
                        newFavs[key] = true;
                    }

                    // Also update the tracked entity if it exists
                    const newBinds = { ...state.managedBinds };
                    if (newBinds[key]) {
                        newBinds[key] = { ...newBinds[key], favorite: !!newFavs[key] };
                    }

                    return {
                        settings: { ...state.settings, favoriteKeys: newFavs },
                        managedBinds: newBinds
                    };
                });
            },

            updateSettings: (partial) => {
                set((state) => ({
                    settings: { ...state.settings, ...partial }
                }));
            },

            getDashboardState: () => {
                const state = get();
                const bindsArray = Object.values(state.managedBinds).sort((a, b) => a.key.localeCompare(b.key));

                const snapshot: AutoexecSnapshot = {
                    path: "web-local-storage",
                    exists: true,
                    managedBlock: true,
                    managedBinds: bindsArray,
                    allBinds: bindsArray, // in web version, all binds are managed binds
                    conflicts: [], // no external file = no conflits
                    lastModified: Date.now(),
                    fingerprint: "web-" + Date.now(),
                };

                return {
                    settings: state.settings,
                    snapshot,
                    emojiCount: 0, // Injected by component
                    reloadSamples: [
                        `bind "${state.settings.reloadBindKey}" "${state.settings.reloadCommand}"`,
                        state.settings.reloadCommand,
                        DEFAULT_RELOAD_COMMAND
                    ],
                    lastSyncAt: Date.now()
                };
            }
        }),
        {
            name: "dota-bind-studio-storage",
        }
    )
);
