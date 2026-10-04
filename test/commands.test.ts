import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { commands, isManager } from '../src/commands.js';
test('commands serialize and remain guild-only',()=>{
 assert.deepEqual(commands.map(c=>c.name),['task','employee','schedule','project']);
 for(const command of commands) assert.equal(command.dm_permission,false);
});
test('manager authorization checks server permission or configured role',()=>{
 const interaction=(flags:bigint,roles:string[])=>({memberPermissions:new PermissionsBitField(flags),member:{roles}} as unknown as ChatInputCommandInteraction);
 assert.equal(isManager(interaction(0n,[]),'manager'),false);
 assert.equal(isManager(interaction(PermissionFlagsBits.ManageGuild,[])),true);
 assert.equal(isManager(interaction(0n,['manager']),'manager'),true);
 assert.equal(isManager(interaction(0n,['other']),'manager'),false);
});
