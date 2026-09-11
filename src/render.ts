import { text, separator, button, actionRow, box, type V2Component } from './components.js';
import { footer } from './display.js';
import { t } from './strings.js';
import type { PendingData, PendingKind } from './pending.js';

const CHARS_BUDGET = 4000;

export function cleanAnswer(text: string, promptTemplateKey: PendingKind | null): string {
  let out = text;
  if (out.length > CHARS_BUDGET - 200) {
    out = out.slice(0, CHARS_BUDGET - 200);
    const nl = out.lastIndexOf('\n');
    if (nl > CHARS_BUDGET * 0.6) out = out.slice(0, nl);
    if (out.lastIndexOf('[', out.length - 1) > out.length - 200) {
      const lineStart = out.lastIndexOf('\n');
      out = out.slice(0, lineStart === -1 ? 0 : lineStart);
    }
    out = `${out.replace(/\s+$/, '')}\n\u2026`;
  }
  if (promptTemplateKey === 'factCheckPrompt') {
    out = out
      .replace(/\n{3}/g, '\n\n')
      .replace(/\n{2}(?=## )/g, '\n')
      .replace(/(## [^\n]+\n)\n+/g, '$1')
      .replace(/\n{2}(?=- )/g, '\n')
      .replace(/(## (?:Verdict|Veredicto)\n[\u{1F7E2}\u{1F7E1}\u{1F7E0}\u{1F534}\u26AA][^\n]*\n)(?!- )/u, '$1- ');
  }
  return out;
}

export function renderComponents(pending: PendingData, contentId: string, visible: boolean): V2Component[] {
  const { kind, text: body, emoji, modelId, used, limit, lang, targetContent, targetMessageId, channelId, guildId } = pending;

  const header = targetContent
    ? kind === 'ask'
      ? `# ${targetContent}`
      : `# [${targetContent}](https://discord.com/channels/${guildId ?? '@me'}/${channelId}/${targetMessageId})`
    : undefined;

  const label = kind === 'factCheckPrompt' ? t(lang, 'factCheckLabel') : '';

  const content: V2Component[] = [
    ...(header ? [text(header)] : []),
    ...(label ? [text(`-# ${label}`)] : []),
    separator(),
    text(body),
    separator(),
    text(footer(emoji, modelId, used, limit)),
  ];

  const buttons: V2Component[] = [
    button(t(lang, 'askButton'), `ask:${contentId}`, 1),
  ];

  if (kind !== 'ask') {
    buttons.push(button(t(lang, 'addContext'), `add_context:${contentId}`, 2));
  }

  buttons.push(
    button(t(lang, 'copyButton'), `copy:${contentId}`, 2),
    button(t(lang, 'regenButton'), `regen:${contentId}`, 2),
  );

  if (!visible) {
    buttons.push(button(t(lang, 'makeVisible'), `make_visible:${contentId}`, 2));
  }

  const row = actionRow(...buttons);

  if (visible) return [...content, row];
  return [box(content), row];
}
