import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands.js';
const cfg=config();
try {
 await new REST().setToken(cfg.token).put(Routes.applicationGuildCommands(cfg.clientId,cfg.guildId),{body:commands});
 console.log('Registered /project, /task, /employee, /schedule for the configured server.');
} catch { console.error('Command registration failed. Check credentials, application ID and server ID.'); process.exitCode=1; }
