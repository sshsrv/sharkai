import { randomBytes } from 'node:crypto';
import { ButtonInteraction } from 'discord.js';
import { genId } from '../pending.js';
import { replyComponents, text, type V2Component } from '../components.js';
import { t } from '../strings.js';
import type { Language } from '../config.js';
import { box } from '../components.js';

// ── Character map (Changed game Latex alphabet) ──

const LATIN_TO_LATEX: Record<string, string> = {
  'A': 'σ', 'a': 'σ', 'B': '£', 'b': '£', 'C': 'Ǝ', 'c': 'Ǝ', 'Ç': 'ǝ', 'ç': 'ǝ',
  'D': '₳', 'd': '₳', 'E': 'ε', 'e': 'ε', 'F': '╛', 'f': '╛', 'G': 'Γ', 'g': 'Γ',
  'H': 'µ', 'h': 'µ', 'I': '∩', 'i': '∩', 'J': '⌠', 'j': '⌠', 'K': '≡', 'k': '≡',
  'L': 'Œ', 'l': 'Œ', 'M': 'β', 'm': 'β', 'N': 'þ', 'n': 'þ', 'Ñ': 'Þ', 'ñ': 'Þ',
  'O': '⌐', 'o': '⌐', 'P': 'Æ', 'p': 'Æ', 'Q': '¶', 'q': '¶', 'R': 'Ω', 'r': 'Ω',
  'S': 'Φ', 's': 'Φ', 'T': '╪', 't': '╪', 'U': '↨', 'u': '↨', 'V': 'ǂ', 'v': 'ǂ',
  'W': 'w', 'w': 'w', 'X': '⋛', 'x': '⋛', 'Y': '¥', 'y': '¥', 'Z': '√', 'z': '√',
  '1': '●', '2': '▬', '3': '▲', '4': '■', '5': '▱', '6': '◈', '7': '▩', '8': '▣',
  '9': '▶', '0': '◀',
};

// Reverse map: latex char → lowercase latin char (many-to-one, pick lowercase as default)
const LATEX_TO_LATIN: Record<string, string> = {};
for (const [lat, tex] of Object.entries(LATIN_TO_LATEX)) {
  if (!LATEX_TO_LATIN[tex]) {
    LATEX_TO_LATIN[tex] = lat.toLowerCase();
  }
}

export function toLatex(text: string): string {
  return [...text].map(ch => LATIN_TO_LATEX[ch] ?? ch).join('');
}

export function toLatin(text: string): string {
  return [...text].map(ch => LATEX_TO_LATIN[ch] ?? ch).join('');
}

// ── Translation store (for copy button) ──

const TRANSLATION_TTL_MS = 2 * 60 * 60 * 1000;
const translationStore = new Map<string, { text: string; createdAt: number }>();

setInterval(() => {
  const cutoff = Date.now() - TRANSLATION_TTL_MS;
  for (const [id, d] of translationStore) {
    if (d.createdAt < cutoff) translationStore.delete(id);
  }
}, 10 * 60 * 1000).unref();

function storeTranslation(text: string): string {
  const id = genId();
  translationStore.set(id, { text, createdAt: Date.now() });
  return id;
}

// ── Render helpers ──

export function renderTranslation(
  original: string,
  translated: string,
  direction: 'latex' | 'latin',
  lang: Language,
  guildId: string | null,
  channelId: string,
  targetMessageId: string | null,
): V2Component[] {
  const translationId = storeTranslation(translated);
  const typeLabel = direction === 'latex' ? t(lang, 'translationToLatex') : t(lang, 'translationToLatin');

  const header = targetMessageId
    ? `# [${original}](https://discord.com/channels/${guildId ?? '@me'}/${channelId}/${targetMessageId})`
    : `# ${original}`;

  return [box([
    text(header),
    text(`-# ${typeLabel}`),
    text('---'),
    text(translated),
  ]),
  // action row with copy button
  { type: 1, components: [
    { type: 2, style: 2, label: t(lang, 'copyButton'), custom_id: `copy_translation:${translationId}` },
  ]},
  ];
}

export async function handleCopyTranslation(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? translationStore.get(contentId) : undefined;
  if (!data || Date.now() - data.createdAt > TRANSLATION_TTL_MS) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }
  const codeBlock = `\`\`\`\n${data.text}\n\`\`\``;
  await replyComponents(interaction, [text(codeBlock)], { ephemeral: true });
}
