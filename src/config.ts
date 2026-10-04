import 'dotenv/config';
export function config() {
  const required = (name: string, snowflake = false) => {
    const value = process.env[name]?.trim();
    if (!value || (snowflake && !/^\d{17,20}$/.test(value))) throw new Error(`Invalid or missing ${name}`);
    return value;
  };
  const role = process.env.MANAGER_ROLE_ID?.trim();
  if (role && !/^\d{17,20}$/.test(role)) throw new Error('Invalid MANAGER_ROLE_ID');
  const channel = process.env.DISCORD_CHANNEL_ID?.trim();
  if (channel && !/^\d{17,20}$/.test(channel)) throw new Error('Invalid DISCORD_CHANNEL_ID');
  return { token: required('DISCORD_TOKEN'), clientId: required('DISCORD_CLIENT_ID', true), guildId: required('DISCORD_GUILD_ID', true), channelId: channel, managerRoleId: role, database: process.env.DATABASE_PATH || './data/default.sqlite', project: process.env.PROJECT_NAME || 'Academic' };
}
