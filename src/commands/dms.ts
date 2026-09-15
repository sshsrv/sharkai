import { Message, ChannelType } from 'discord.js';
import { ask } from '../providers.js';
import { recordRequest } from '../usage.js';
import { appendHistory, getLanguage } from '../store.js';
import { WHITELIST_USER_IDS } from '../config.js';
import { t } from '../strings.js';

const SPLIT_THRESHOLD = 300;
const MESSAGE_DELAY_MS = 1500;
const PARAGRAPH_MAX = 2000;

function splitText(text: string): string[] {
  if (text.length <= SPLIT_THRESHOLD) {
    return [text];
  }

  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= PARAGRAPH_MAX) {
      chunks.push(paragraph);
    } else {
      const lines = paragraph.split('\n');
      let current = '';
      for (const line of lines) {
        if ((current.length + line.length + 1) > PARAGRAPH_MAX && current.length > 0) {
          chunks.push(current);
          current = line;
        } else {
          current = current ? current + '\n' + line : line;
        }
      }
      if (current) chunks.push(current);
    }
  }

  return chunks;
}

export async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (WHITELIST_USER_IDS.length > 0 && !WHITELIST_USER_IDS.includes(message.author.id)) return;

  const isDM = message.channel.type === ChannelType.DM;
  const botId = message.client.user.id;
  const mentionedBot = message.mentions.has(botId);

  if (!isDM && !mentionedBot) return;

  const userId = message.author.id;
  const lang = getLanguage(userId);
  const question = message.content
    .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
    .trim();

  if (!question) {
    const reply = t(lang, 'emptyMention');
    if (isDM) {
      await message.channel.send(reply);
    } else {
      await message.reply({ content: reply, allowedMentions: { repliedUser: true } });
    }
    return;
  }

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }

    const result = await ask(question, null, userId);
    recordRequest(result.provider, result.model);
    appendHistory(userId, 'user', question);
    appendHistory(userId, 'assistant', result.text);

    if (isDM) {
      const chunks = splitText(result.text);
      if (chunks.length === 1) {
        await message.channel.send(chunks[0]);
      } else {
        for (let i = 0; i < chunks.length; i++) {
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
          }
          await message.channel.send(chunks[i]);
        }
      }
    } else {
      await message.reply({ content: result.text, allowedMentions: { repliedUser: true } });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    try {
      if (isDM) {
        await message.channel.send(`Error: ${errorMsg}`);
      } else {
        await message.reply(`Error: ${errorMsg}`);
      }
    } catch {}
  }
}
