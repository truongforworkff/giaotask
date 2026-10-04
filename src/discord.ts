import { Client, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import type { Delivery } from './scheduler.js';
import { createHash } from 'node:crypto';
export async function createDelivery(client: Client, guildId: string, channelId: string, project: string): Promise<Delivery> {
 const channel = await client.channels.fetch(channelId);
 if (!channel || channel.type!==ChannelType.GuildText || channel.guildId!==guildId) throw new Error('DISCORD_CHANNEL_ID must be a text channel in the configured server');
 const permissions = channel.permissionsFor(client.user!);
 for (const flag of [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.ReadMessageHistory]) if (!permissions?.has(flag)) throw new Error('Bot needs View Channel, Send Messages, Embed Links, and Read Message History');
 return {
  async send(task) {
   const member = await channel.guild.members.fetch(task.employee_id!);
   if (member.user.bot) throw new Error('Assigned employee is a bot');
   const message = await channel.send({content:`<@${task.employee_id}> — task mới của ${project}`,
    embeds:[new EmbedBuilder().setTitle(`${task.id}: ${task.title}`).setDescription(task.description || 'Use /task show for details.').addFields({name:'Workload',value:`${task.effort} points`}).setTimestamp(task.assigned_at!).setFooter({text:`academic-assignment:${task.id}`})],
    nonce:createHash('sha256').update(`${channelId}:${task.id}`).digest('hex').slice(0,24),enforceNonce:true,allowedMentions:{parse:[],users:[task.employee_id!]}});
   return message.id;
  },
  async find(task) {
   // Read all history back to the assignment, including notifications older than nonce deduplication.
   let before: string | undefined;
   while (true) {
    const messages = await channel.messages.fetch({limit:100,...(before ? {before} : {})});
    if (!messages.size) return undefined;
    for (const message of messages.values()) if (message.author.id===client.user!.id && message.embeds.some(e=>e.footer?.text===`academic-assignment:${task.id}`)) return message.id;
    const oldest = messages.last()!;
    if (oldest.createdTimestamp < task.assigned_at!) return undefined;
    before=oldest.id;
   }
  }
 };
}
