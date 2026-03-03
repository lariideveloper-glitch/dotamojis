import catalogData from "./emojis/catalog.json";
import { EmojiCatalog } from "../types/domain";

export function loadEmojiCatalog(): EmojiCatalog {
    // In the Web version we just return the imported JSON directly
    return catalogData as EmojiCatalog;
}
