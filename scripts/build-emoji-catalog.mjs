import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outPath = path.join(rootDir, "internal", "emojis", "catalog.json");

const SOURCES = {
  descriptions: "https://raw.githubusercontent.com/s3rbug/dota2_emojis_unicode/main/descriptions.js",
  emojis: "https://raw.githubusercontent.com/s3rbug/dota2_emojis_unicode/main/emojis.txt",
  fandomApi:
    "https://dota2.fandom.com/api.php?action=query&titles=Emoticons&prop=revisions&rvprop=content&format=json",
};

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^:+|:+$/g, "");
}

function parseDescriptions(content) {
  const re = /code:\s*(\d+),\s*\n\s*description:\s*"([^"]+)"/g;
  const items = new Map();
  for (const match of content.matchAll(re)) {
    const code = Number(match[1]);
    const raw = match[2];
    const chatMatch = raw.match(/:([a-zA-Z0-9_]+):/);
    if (!chatMatch) continue;

    const name = chatMatch[1];
    const chatCode = `:${name}:`;
    const trailing = raw.replace(chatMatch[0], "").trim();
    const tags = trailing
      ? trailing
          .split(/[\s/]+/)
          .map((p) => p.trim())
          .filter(Boolean)
      : [];

    items.set(code, {
      code,
      name,
      chatCode,
      tags,
      descriptionRaw: raw,
    });
  }
  return items;
}

function parseEmojisTxt(content) {
  const map = new Map();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(\d+) \(%u([ef][0-9a-f]{3})\): bind <your_key> "say (.*?)"(?: - (.*))?$/i);
    if (!m) continue;
    const code = Number(m[1]);
    const unicodeEscape = `%u${m[2].toLowerCase()}`;
    const unicode = m[3] || "";
    const trailingDescription = m[4] || "";
    map.set(code, {
      unicodeEscape,
      unicode,
      trailingDescription,
    });
  }
  return map;
}

function parseFandomWikitext(apiJson) {
  const pages = apiJson?.query?.pages || {};
  const firstPage = Object.values(pages)[0];
  const revisions = firstPage?.revisions || [];
  const wikitext = revisions[0]?.["*"] || "";
  const chatToFile = new Map();

  const patterns = [
    /\|\s*:([a-zA-Z0-9_]+):\s*\|\|\s*\[\[File:([^\]|]+)(?:\|[^\]]*)?\]\]/g,
    /\|\s*:([a-zA-Z0-9_]+):\s*\n\|\s*\[\[File:([^\]|]+)(?:\|[^\]]*)?\]\]/g,
  ];

  for (const pattern of patterns) {
    for (const match of wikitext.matchAll(pattern)) {
      const chat = normalizeName(match[1]);
      const fileName = String(match[2] || "").trim();
      if (!chat || !fileName) continue;
      if (!chatToFile.has(chat)) {
        chatToFile.set(chat, fileName);
      }
    }
  }

  return chatToFile;
}

function buildGifUrl(fileName) {
  if (!fileName) return "";
  return `https://dota2.fandom.com/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "dota-bind-studio-catalog-builder/1.0",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed request ${res.status} for ${url}`);
  }
  return await res.text();
}

async function fetchJSON(url) {
  const txt = await fetchText(url);
  return JSON.parse(txt);
}

async function main() {
  const [descriptionsText, emojisText, fandomJson] = await Promise.all([
    fetchText(SOURCES.descriptions),
    fetchText(SOURCES.emojis),
    fetchJSON(SOURCES.fandomApi),
  ]);

  const descriptions = parseDescriptions(descriptionsText);
  const emojiUnicode = parseEmojisTxt(emojisText);
  const fandomByChatCode = parseFandomWikitext(fandomJson);

  const aliases = new Map([
    ["techywheeze", "techweeze"],
    ["foggy", "foggyh"],
  ]);

  const items = [];
  for (const [code, desc] of descriptions.entries()) {
    const unicodeMeta = emojiUnicode.get(code);
    if (!unicodeMeta || !unicodeMeta.unicode) continue;

    const normalizedName = normalizeName(desc.name);
    let lookupName = normalizedName;
    if (!fandomByChatCode.has(lookupName) && aliases.has(lookupName)) {
      lookupName = aliases.get(lookupName);
    }

    const gifFile = fandomByChatCode.get(lookupName) || "";
    const gifUrl = buildGifUrl(gifFile);

    items.push({
      code,
      name: desc.name,
      chatCode: desc.chatCode,
      unicode: unicodeMeta.unicode,
      unicodeEscape: unicodeMeta.unicodeEscape,
      gifFile,
      gifUrl,
      tags: desc.tags,
      source: gifUrl ? ["github", "fandom"] : ["github"],
    });
  }

  items.sort((a, b) => a.code - b.code);

  const payload = {
    generatedAt: new Date().toISOString(),
    stats: {
      total: items.length,
      withGif: items.filter((i) => Boolean(i.gifUrl)).length,
      withoutGif: items.filter((i) => !i.gifUrl).length,
    },
    items,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`emoji catalog generated: ${outPath}`);
  console.log(payload.stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

