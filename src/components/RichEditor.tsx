import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EmojiItem } from "../types/domain";

interface RichEditorProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
    emojiMap: Map<string, EmojiItem>;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export interface RichEditorRef {
    insertEmoji: (emoji: EmojiItem) => void;
    focus: () => void;
}

function parseDOMToText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue || "";
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === "IMG") {
            return el.getAttribute("data-unicode") || "";
        }
        if (el.tagName === "BR") {
            return "\n";
        }
        if (el.tagName === "DIV" && node.previousSibling) {
            return "\n" + Array.from(node.childNodes).map(parseDOMToText).join("");
        }
        return Array.from(node.childNodes).map(parseDOMToText).join("");
    }
    return "";
}

function textToHTML(text: string, emojiMap: Map<string, EmojiItem>): string {
    if (!text) return "";

    // Use Array.from to correctly iterate over surrogate pairs
    return Array.from(text).map(char => {
        const emoji = emojiMap.get(char);
        if (emoji && emoji.gifUrl) {
            return `<img src="${emoji.gifUrl}" data-unicode="${char}" alt="${emoji.name}" title="${emoji.name}" class="inline h-5 w-5 -mt-1 mx-0.5 object-contain select-none align-middle" contenteditable="false" />`;
        }
        // escape HTML chars
        return char
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
    }).join("");
}

export const RichEditor = forwardRef<RichEditorRef, RichEditorProps>(({ value, onChange, className, placeholder, emojiMap, onKeyDown }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const lastEmittedValue = useRef(value);

    useEffect(() => {
        if (!editorRef.current) return;
        // Apply if text changed from outside, or on first mount when empty
        if (value !== lastEmittedValue.current || editorRef.current.innerHTML === "") {
            editorRef.current.innerHTML = textToHTML(value, emojiMap);
            lastEmittedValue.current = value;
        }
    }, [value, emojiMap]);

    const handleInput = () => {
        if (!editorRef.current) return;
        const plainText = parseDOMToText(editorRef.current);
        lastEmittedValue.current = plainText;
        onChange(plainText);
    };

    useImperativeHandle(ref, () => ({
        focus: () => {
            editorRef.current?.focus();
        },
        insertEmoji: (emoji: EmojiItem) => {
            if (!editorRef.current) return;

            // Ensure focus before inserting
            editorRef.current.focus();

            // If document.activeElement is not the editor, selection might be elsewhere. 
            // ExecCommand usually targets active selection.
            const imgHtml = `<img src="${emoji.gifUrl}" data-unicode="${emoji.unicode}" alt="${emoji.name}" title="${emoji.name}" class="inline h-5 w-5 -mt-1 mx-0.5 object-contain select-none align-middle" contenteditable="false" />`;

            // Using execCommand is the most robust way to insert HTML at the current caret position in contentEditable
            document.execCommand("insertHTML", false, imgHtml);

            handleInput(); // Sync back to React state
        }
    }));

    return (
        <div className="relative group w-full">
            <div
                ref={editorRef}
                contentEditable
                onInput={handleInput}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                    // Force plain-text pasting
                    e.preventDefault();
                    const text = e.clipboardData.getData("text/plain");
                    document.execCommand("insertText", false, text);
                }}
                className={`outline-none whitespace-pre-wrap break-words ${className}`}
            />
            {!value && placeholder && (
                <div className="absolute top-0 left-0 p-4 pointer-events-none text-slate-500 whitespace-pre-wrap select-none" aria-hidden="true">
                    {placeholder}
                </div>
            )}
        </div>
    );
});

RichEditor.displayName = "RichEditor";
