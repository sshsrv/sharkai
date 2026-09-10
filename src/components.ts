import {
 ChatInputCommandInteraction,
 MessageContextMenuCommandInteraction,
 ButtonInteraction,
 ModalSubmitInteraction,
 InteractionResponseType,
 Routes} from 'discord.js';
import { ACCENT_COLOR } from './config.js';

export const IS_COMPONENTS_V2 = 1 << 15;
export const EPHEMERAL = 1 << 6;

type AnyInteraction =
 ChatInputCommandInteraction |
 MessageContextMenuCommandInteraction |
 ButtonInteraction |
 ModalSubmitInteraction;

export type V2Component =
 | { type: 10; content: string }
 | { type: 14; divider?: boolean; spacing?: 1 | 2 }
 | { type: 17; components: V2Component[]; accent_color?: number; spoiler?: boolean }
 | { type: 9; components: V2Component[]; accessory?: unknown }
 | { type: 1; components: unknown[] }
 | { type: 2; style: 1 | 2 | 3 | 4 | 5; label: string; custom_id: string; disabled?: boolean };

export const text = (content: string): V2Component => ({ type: 10, content });
export const separator = (divider = true, spacing: 1 | 2 = 1): V2Component => ({
 type: 14,
 divider,
 spacing});

export const heading = (content: string, level = 1): V2Component =>
 ({ type: 10, content: `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${content}` }) as V2Component;

export const button = (label: string, customId: string, style: 1 | 2 | 3 | 4 | 5 = 2): V2Component =>
 ({ type: 2, style, label, custom_id: customId });

export const actionRow = (...components: V2Component[]): V2Component =>
 ({ type: 1, components });

export const box = (components: V2Component[]): V2Component =>
 ({ type: 17, components, ...(ACCENT_COLOR !== undefined ? { accent_color: ACCENT_COLOR } : {}) });

export const section = (components: V2Component[]): V2Component =>
 ({ type: 9, components });

function flags(opts: { ephemeral?: boolean } = {}): number {
 return IS_COMPONENTS_V2 | (opts.ephemeral ? EPHEMERAL : 0);
}

export async function replyComponents(
 interaction: AnyInteraction,
 components: V2Component[],
 opts: { ephemeral?: boolean } = {}
): Promise<void> {
 await interaction.client.rest.post(
 Routes.interactionCallback(interaction.id, interaction.token),
 {
 body: {
 type: InteractionResponseType.ChannelMessageWithSource,
 data: { flags: flags(opts), components }}}
 );
}

export async function deferComponents(
 interaction: ChatInputCommandInteraction,
 opts: { ephemeral?: boolean } = {}
): Promise<void> {
 await interaction.client.rest.post(
 Routes.interactionCallback(interaction.id, interaction.token),
 {
 body: {
 type: InteractionResponseType.DeferredChannelMessageWithSource,
 data: { flags: flags(opts) }}}
 );
}

export async function editComponents(
 interaction: AnyInteraction,
 components: V2Component[]
): Promise<void> {
 await interaction.client.rest.patch(
 Routes.webhookMessage(interaction.client.user.id, interaction.token),
 { body: { flags: IS_COMPONENTS_V2, components } }
 );
}

export function totalChars(components: V2Component[]): number {
 let n = 0;
 for (const c of components) {
 if (c.type === 10) n += c.content.length;
 else if (c.type === 17) n += totalChars(c.components);
 else if (c.type === 9) n += totalChars(c.components);
 }
 return n;
}
