import { randomBytes } from 'node:crypto';
import { ButtonInteraction } from 'discord.js';
import { genId } from '../pending.js';
import { replyComponents, text, separator, button, actionRow, box, type V2Component } from '../components.js';
import { t } from '../strings.js';
import type { Language } from '../config.js';

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

// ── Translation store (for copy + make visible) ──

interface TranslationData {
  original: string;
  translated: string;
  direction: 'latex' | 'latin';
  lang: Language;
  guildId: string | null;
  channelId: string;
  targetMessageId: string | null;
  authorId: string;
  createdAt: number;
}

const TRANSLATION_TTL_MS = 2 * 60 * 60 * 1000;
const translationStore = new Map<string, TranslationData>();

setInterval(() => {
  const cutoff = Date.now() - TRANSLATION_TTL_MS;
  for (const [id, d] of translationStore) {
    if (d.createdAt < cutoff) translationStore.delete(id);
  }
}, 10 * 60 * 1000).unref();

function storeTranslation(data: Omit<TranslationData, 'createdAt'>): string {
  const id = genId();
  translationStore.set(id, { ...data, createdAt: Date.now() });
  return id;
}

export function getTranslationData(id: string): TranslationData | undefined {
  const data = translationStore.get(id);
  if (!data) return undefined;
  if (Date.now() - data.createdAt > TRANSLATION_TTL_MS) {
    translationStore.delete(id);
    return undefined;
  }
  return data;
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
  authorId: string,
  visible: boolean,
): V2Component[] {
  const translationId = storeTranslation({ original, translated, direction, lang, guildId, channelId, targetMessageId, authorId });
  const typeLabel = direction === 'latex' ? t(lang, 'translationToLatex') : t(lang, 'translationToLatin');

  const header = targetMessageId
    ? `# [${original}](https://discord.com/channels/${guildId ?? '@me'}/${channelId}/${targetMessageId})`
    : `# ${original}`;

  const content: V2Component[] = [
    text(header),
    text(`-# ${typeLabel}`),
    separator(),
    text(translated),
  ];

  const buttons: V2Component[] = [
    button(t(lang, 'copyButton'), `copy_translation:${translationId}`, 2),
  ];

  if (!visible) {
    buttons.push(button(t(lang, 'makeVisible'), `make_visible_translation:${translationId}`, 2));
  }

  const row = actionRow(...buttons);

  if (visible) return [box(content), row];
  return [box(content), row];
}

export async function handleCopyTranslation(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getTranslationData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }
  const codeBlock = `\`\`\`\n${data.translated}\n\`\`\``;
  await replyComponents(interaction, [text(codeBlock)], { ephemeral: true });
}

export async function handleMakeVisibleTranslation(interaction: ButtonInteraction): Promise<void> {
  const contentId = interaction.customId.split(':')[1];
  const data = contentId ? getTranslationData(contentId) : undefined;
  if (!data) {
    await replyComponents(interaction, [text('Not available (expired).')], { ephemeral: true });
    return;
  }
  if (interaction.user.id !== data.authorId) {
    await replyComponents(interaction, [text(t(data.lang, 'notAuthor'))], { ephemeral: true });
    return;
  }
  await replyComponents(
    interaction,
    renderTranslation(data.original, data.translated, data.direction, data.lang, data.guildId, data.channelId, data.targetMessageId, data.authorId, true),
  );
}
