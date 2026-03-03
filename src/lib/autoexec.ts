import { BindEntry } from "../types/domain";

const MANAGED_BEGIN = "// >>> DOTA_BIND_STUDIO:BEGIN v1";
const MANAGED_END = "// <<< DOTA_BIND_STUDIO:END";

export function escapeQuoted(s: string): string {
    return s.replace(/\\/g, "\\\\");
}

export function sanitizeMessage(s: string): string {
    return s.replace(/\r/g, " ").replace(/\n/g, " ").trim();
}

export function formatReloadBindLine(key: string, command: string): string {
    const keyEscaped = escapeQuoted(key);
    const commandEscaped = escapeQuoted(command);
    return `bind "${keyEscaped}" "${commandEscaped}"`;
}

export function formatBindLine(bind: BindEntry): string {
    const key = escapeQuoted(bind.key);
    const message = sanitizeMessage(bind.message);
    const command = `${bind.mode} ${message}`;
    const commandEscaped = escapeQuoted(command);
    return `bind "${key}" "${commandEscaped}"`;
}

export function renderManagedBlock(
    binds: BindEntry[],
    reloadBindKey: string,
    reloadCommand: string
): string {
    const out: string[] = [
        MANAGED_BEGIN,
        "// Managed automatically by Dota Bind Studio Web.",
        "// Dedicated reload bind (editable in app settings).",
        formatReloadBindLine(reloadBindKey, reloadCommand),
    ];

    if (binds.length > 0) {
        out.push("");
    }

    for (const bind of binds) {
        if (bind.parseable) {
            out.push(formatBindLine(bind));
        }
    }

    out.push(MANAGED_END);
    return out.join("\n");
}
