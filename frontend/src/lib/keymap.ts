export const DOTA_KEY_MAP: Record<string, string> = {
  Escape: "ESCAPE",
  Tab: "TAB",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "SPACE",

  Enter: "ENTER",
  NumpadEnter: "KP_ENTER",

  ShiftLeft: "SHIFT",
  ShiftRight: "SHIFT",
  ControlLeft: "CTRL",
  ControlRight: "CTRL",
  AltLeft: "ALT",
  AltRight: "ALT",

  CapsLock: "CAPSLOCK",
  Backspace: "BACKSPACE",

  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",

  Insert: "INS",
  Delete: "DEL",
  Home: "HOME",
  End: "END",
  PageUp: "PGUP",
  PageDown: "PGDN",

  Numpad0: "KP_0",
  Numpad1: "KP_1",
  Numpad2: "KP_2",
  Numpad3: "KP_3",
  Numpad4: "KP_4",
  Numpad5: "KP_5",
  Numpad6: "KP_6",
  Numpad7: "KP_7",
  Numpad8: "KP_8",
  Numpad9: "KP_9",
  NumpadAdd: "KP_PLUS",
  NumpadSubtract: "KP_MINUS",
  NumpadMultiply: "KP_MULTIPLY",
  NumpadDivide: "KP_DIVIDE",
  NumpadDecimal: "KP_DEL",
};

export function toDotaKeyFromKeyboardEvent(event: KeyboardEvent): string | null {
  const { code } = event;

  if (code in DOTA_KEY_MAP) {
    return DOTA_KEY_MAP[code];
  }

  if (code.startsWith("Key") && code.length === 4) {
    return code.slice(3).toUpperCase();
  }

  if (code.startsWith("Digit") && code.length === 6) {
    return code.slice(5);
  }

  if (code.startsWith("F")) {
    const n = Number(code.slice(1));
    if (Number.isInteger(n) && n >= 1 && n <= 24) {
      return `F${n}`;
    }
  }

  return null;
}

export const PROTECTED_KEYS = new Set([
  "Q", "W", "E", "R", "D", "F", // Spells
  "Z", "X", "C", "V", "B", "N", // Items/Actions
  "ENTER", "ESCAPE", "TAB", "SHIFT", "CTRL", "ALT", "SPACE", // System
  "1", "2", "3", "4", "5", "6", // Control groups or items
]);

