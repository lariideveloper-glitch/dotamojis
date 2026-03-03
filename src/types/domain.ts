export type ChatMode = "say" | "say_team";
export type BindSource = "managed" | "external";

export interface EmojiItem {
    code: string;
    unicode: string;
    name: string;
    chatCode: string;
    tags: string[];
    gifUrl: string;
}

export interface EmojiCatalog {
    items: EmojiItem[];
}

export interface BindEntry {
    key: string;
    mode: ChatMode;
    message: string;
    commandRaw: string;
    parseable: boolean;
    source: BindSource;
    favorite: boolean;
    recent: boolean;
    updatedAt: number;
    previewText: string;
    emojis: string[];
}

export interface BindConflict {
    key: string;
    kind: "duplicate_managed" | "managed_vs_external";
    description: string;
}

export interface AutoexecSnapshot {
    path: string;
    exists: boolean;
    managedBlock: boolean;
    managedBinds: BindEntry[];
    allBinds: BindEntry[];
    conflicts: BindConflict[];
    lastModified: number;
    fingerprint: string;
}

export interface AppSettings {
    autoexecPath: string; // Left here for UI compatibility, though unused in Web
    reloadCommand: string;
    reloadBindKey: string;
    favoriteKeys: Record<string, boolean>;
    recentKeys: string[];
}

export interface DashboardState {
    settings: AppSettings;
    snapshot: AutoexecSnapshot;
    emojiCount: number;
    reloadSamples: string[];
    lastSyncAt: number;
}
