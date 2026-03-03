import { BindEntry } from "../types/domain";

export function escapeQuoted(s: string): string {
    return s.replace(/\\/g, "\\\\");
}

export function sanitizeMessage(s: string): string {
    return s.replace(/\r/g, " ").replace(/\n/g, " ").trim();
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
): string {
    const out: string[] = [
        "// Binds gerados por Dotamojis",
    ];

    for (const bind of binds) {
        if (bind.parseable) {
            out.push(formatBindLine(bind));
        }
    }

    return out.join("\n");
}
