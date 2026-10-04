import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { Projects, projectDirectory } from './projects.js';
import { Scheduler } from './scheduler.js';
import { createDelivery } from './discord.js';
import { route } from './commands.js';
const cfg=config();
const projects=new Projects(projectDirectory(cfg.database));
// Preserve the original project's data when upgrading an existing installation.
if (cfg.channelId && !projects.byChannel(cfg.guildId,cfg.channelId)) projects.create('academic',cfg.project,cfg.guildId,cfg.channelId,cfg.database);
const client=new Client({intents:[GatewayIntentBits.Guilds],allowedMentions:{parse:[]}});
const schedulers=new Map<string,Scheduler>();
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshing: Promise<void> | undefined;
async function refresh() {
 for (const project of projects.list(cfg.guildId)) {
  if (closing) return;
  if (schedulers.has(project.id)) continue;
  try {
   const delivery=await createDelivery(client,project.guild_id,project.channel_id,project.name);
   if (closing) return;
   const scheduler=new Scheduler(projects.store(project),delivery,message=>console.error(`[${project.id}] ${message}`));
   schedulers.set(project.id,scheduler);scheduler.start();
  } catch {console.error(`Project ${project.id}: channel unavailable or permissions missing; will retry.`);}
 }
}
client.once(Events.ClientReady, () => {
 const run=async()=>{refreshing=refresh();await refreshing;if(!closing) refreshTimer=setTimeout(run,10_000);};
 void run();console.log(`Task bot ready: ${client.user!.tag}`);
});
client.on(Events.InteractionCreate,i=>{if(!closing && i.isChatInputCommand()) void route(i,projects,cfg,async p=>{await createDelivery(client,p.guild_id,p.channel_id,p.name);}).catch(()=>console.error('Interaction response failed'));});
client.on(Events.Error,()=>console.error('Discord client error; connection may be unavailable'));
let closing=false;
async function shutdown(code=0) { if(closing) return; closing=true;clearTimeout(refreshTimer);await refreshing;await Promise.all([...schedulers.values()].map(s=>s.stop()));client.destroy();projects.close();process.exitCode=code; }
process.once('SIGINT',()=>void shutdown()); process.once('SIGTERM',()=>void shutdown());
try { await client.login(cfg.token); } catch { console.error('Discord login failed. Check bot token and network.'); await shutdown(1); }
