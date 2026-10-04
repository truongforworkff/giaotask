import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { Store } from './store.js';
import { Projects, type Project } from './projects.js';
import type { config } from './config.js';
const task = new SlashCommandBuilder().setName('task').setDescription('Project task backlog')
 .addSubcommand(s=>s.setName('add').setDescription('Manager: add a task').addStringOption(o=>o.setName('id').setDescription('Unique ID, e.g. BE-018').setRequired(true).setMaxLength(40)).addStringOption(o=>o.setName('title').setDescription('Task title').setRequired(true).setMaxLength(200)).addStringOption(o=>o.setName('description').setDescription('Scope and acceptance criteria').setMaxLength(3000)).addIntegerOption(o=>o.setName('effort').setDescription('Workload points (default 1)').setMinValue(1).setMaxValue(100)).addIntegerOption(o=>o.setName('priority').setDescription('Higher first').setMinValue(0).setMaxValue(100)).addStringOption(o=>o.setName('depends').setDescription('Comma-separated existing task IDs')))
 .addSubcommand(s=>s.setName('list').setDescription('List tasks').addStringOption(o=>o.setName('status').setDescription('Filter').addChoices({name:'Backlog',value:'backlog'},{name:'Assigned',value:'assigned'},{name:'Done',value:'done'})).addIntegerOption(o=>o.setName('page').setDescription('Page of 10 tasks').setMinValue(1)))
 .addSubcommand(s=>s.setName('show').setDescription('Scope and dependencies').addStringOption(o=>o.setName('id').setDescription('Task ID').setRequired(true)))
 .addSubcommand(s=>s.setName('complete').setDescription('Complete your assigned task').addStringOption(o=>o.setName('id').setDescription('Task ID').setRequired(true)))
 .addSubcommand(s=>s.setName('retry-notification').setDescription('Manager: retry an uncertain delivery after checking the channel').addStringOption(o=>o.setName('id').setDescription('Task ID').setRequired(true)).addBooleanOption(o=>o.setName('checked-channel').setDescription('I verified this assignment was not posted; retry may duplicate a late send').setRequired(true)));
const employee = new SlashCommandBuilder().setName('employee').setDescription('Project employees')
 .addSubcommand(s=>s.setName('add').setDescription('Manager: add/update/reactivate employee').addUserOption(o=>o.setName('user').setDescription('Server member').setRequired(true)).addIntegerOption(o=>o.setName('capacity').setDescription('Maximum open workload points').setRequired(true).setMinValue(1).setMaxValue(100)))
 .addSubcommand(s=>s.setName('pause').setDescription('Manager: stop new assignments').addUserOption(o=>o.setName('user').setDescription('Employee').setRequired(true)))
 .addSubcommand(s=>s.setName('resume').setDescription('Manager: resume assignments').addUserOption(o=>o.setName('user').setDescription('Employee').setRequired(true)))
 .addSubcommand(s=>s.setName('list').setDescription('Employees and workload').addIntegerOption(o=>o.setName('page').setDescription('Page of 10 employees').setMinValue(1)));
const schedule = new SlashCommandBuilder().setName('schedule').setDescription('View next assignment and notification state');
const project = new SlashCommandBuilder().setName('project').setDescription('Manage projects')
 .addSubcommand(s=>s.setName('create').setDescription('Manager: use this text channel for a new project').addStringOption(o=>o.setName('id').setDescription('Unique lowercase ID, e.g. academic or website').setRequired(true).setMaxLength(40)).addStringOption(o=>o.setName('name').setDescription('Project display name').setRequired(true).setMaxLength(100)))
 .addSubcommand(s=>s.setName('list').setDescription('Manager: list projects in this server').addIntegerOption(o=>o.setName('page').setDescription('Page of 10 projects').setMinValue(1)));
export const commands = [task,employee,schedule,project].map(c=>c.setDMPermission(false).toJSON());
export function isManager(i: ChatInputCommandInteraction, role?: string): boolean {
 return Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || (role && i.member && ('cache' in i.member.roles ? i.member.roles.cache.has(role) : i.member.roles.includes(role))));
}
export async function route(i: ChatInputCommandInteraction, projects: Projects, cfg: ReturnType<typeof config>, validate: (project: Project) => Promise<void>) {
 if (i.commandName!=='project') {
  const selected = i.guildId ? projects.byChannel(i.guildId,i.channelId) : undefined;
  if (!selected) {await i.reply({content:'Run /project create in this project’s text channel first.',flags:MessageFlags.Ephemeral});return;}
  await handle(i,projects.store(selected),{...cfg,project:selected.name,channelId:selected.channel_id});return;
 }
 await i.deferReply({flags:MessageFlags.Ephemeral});
 try {
  if (i.guildId!==cfg.guildId || !isManager(i,cfg.managerRoleId)) throw new Error('Requires Manage Server permission or the manager role in the configured server');
  if (i.options.getSubcommand()==='list') {
   const page=i.options.getInteger('page') ?? 1;
   const content=projects.list(i.guildId).slice((page-1)*10,page*10).map(p=>`${p.id}: ${p.name} — <#${p.channel_id}>`).join('\n') || 'No projects on this page.';
   await i.editReply({content,allowedMentions:{parse:[]}});return;
  }
  if (i.channel?.type!==ChannelType.GuildText) throw new Error('Create projects in a normal server text channel');
  const id=i.options.getString('id',true),name=i.options.getString('name',true);
  await validate({id,name,guild_id:i.guildId!,channel_id:i.channelId,database_path:''});
  const existing=projects.byChannel(i.guildId!,i.channelId);
  if (existing) {
   if (existing.id===id && existing.name===name) {await i.editReply(`Project ${id} is already configured here.`);return;}
   throw new Error('This channel already belongs to another project');
  }
  projects.create(id,name,i.guildId!,i.channelId);
  await i.editReply({content:`Project ${id} created. Add employees and tasks in this channel; assignments start automatically.`,allowedMentions:{parse:[]}});
 } catch(error) {
  const message=error instanceof Error ? error.message : 'Project command failed';
  await i.editReply({content:/UNIQUE constraint/.test(message) ? 'Project ID or channel already exists.' : message.slice(0,1900),allowedMentions:{parse:[]}});
 }
}
export async function handle(i: ChatInputCommandInteraction, store: Store, cfg: ReturnType<typeof config>) {
 await i.deferReply({flags:MessageFlags.Ephemeral});
 try {
  if (i.guildId!==cfg.guildId) throw new Error('This bot is configured for another server');
  const manager = isManager(i,cfg.managerRoleId);
  const sub = i.commandName==='schedule' ? '' : i.options.getSubcommand();
  const mutation = (i.commandName==='task' && !['list','show'].includes(sub)) || (i.commandName==='employee' && sub!=='list');
  if (mutation && sub!=='complete' && !manager) throw new Error('Requires Manage Server permission or the manager role');
  let result: string;
  const execute = () => {
   if (i.commandName==='task') {
    const id = i.options.getString('id',sub!=='list') ?? '';
    if (sub==='add') {
     store.add({id,title:i.options.getString('title',true),description:i.options.getString('description') ?? '',effort:i.options.getInteger('effort') ?? 1,priority:i.options.getInteger('priority') ?? 0},(i.options.getString('depends') || '').split(',').map(s=>s.trim()).filter(Boolean));
     return `Added ${id}.`;
    }
    if (sub==='complete') { store.complete(id,i.user.id,manager); return `Completed ${id}.`; }
    if (sub==='retry-notification') { if (!i.options.getBoolean('checked-channel',true)) throw new Error('Check the assignment channel before retrying'); store.retry(id); return `Queued notification retry for ${id}.`; }
    if (sub==='show') {
     const row = store.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as {title:string;description:string}|undefined;
     if (!row) throw new Error('Task not found');
     const deps = store.db.prepare('SELECT depends_on FROM dependencies WHERE task_id=?').all(id).map(d=>d.depends_on).join(', ');
     return `${id}: ${row.title}\nDependencies: ${deps || 'none'}\n${row.description}`;
    }
    return store.tasks(i.options.getString('status') ?? undefined,i.options.getInteger('page') ?? 1).map(t=>`${t.id} | ${t.status} | ${t.effort} pts | ${t.title}${t.employee_id ? ` | <@${t.employee_id}>` : ''}`).join('\n') || 'No tasks on this page.';
   }
   if (i.commandName==='employee') {
    if (sub==='list') {
     const page = i.options.getInteger('page') ?? 1;
     return store.employees().slice((page-1)*10,page*10).map(e=>`<@${e.id}> | ${e.active ? 'active':'paused'} | ${e.load}/${e.capacity} pts`).join('\n') || 'No employees on this page.';
    }
    const user = i.options.getUser('user',true);
    if (sub==='add') store.employee(user.id,user.username,i.options.getInteger('capacity',true));
    else store.pause(user.id,sub==='resume');
    return `Employee ${user.username}: ${sub}.`;
   }
   const next = store.nextAt(); const notice = store.notice();
   return `Next eligible assignment: ${next ? `<t:${Math.floor(next/1000)}:F>` : 'immediately when backlog and employees are ready'}.\nDelivery: ${notice ? `${notice.id}: ${notice.delivery}` : 'clear'}.\nRequires a dependency-ready task and available employee capacity.`;
  };
  // Server fetch precedes transaction; no network calls hold a database lock.
  if (i.commandName==='employee' && sub==='add') {
   const member = await i.guild!.members.fetch(i.options.getUser('user',true).id);
   if (member.user.bot) throw new Error('Employees must be human server members');
  }
  result = mutation ? store.request(i.id,execute) : execute();
  // Discord content limit: long scopes are attached, never silently truncated.
  if (result.length>1900) await i.editReply({content:`${cfg.project} task details`,files:[{attachment:Buffer.from(result),name:'project-task.txt'}],allowedMentions:{parse:[]}});
  else await i.editReply({content:result,allowedMentions:{parse:[]}});
 } catch (error) {
  const message = error instanceof Error ? error.message : 'Command failed';
  const safe = /UNIQUE constraint/.test(message) ? 'This ID already exists.' : message;
  await i.editReply({content:safe.slice(0,1900),allowedMentions:{parse:[]}});
 }
}
