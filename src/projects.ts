import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Store } from './store.js';
export interface Project { id: string; name: string; guild_id: string; channel_id: string; database_path: string }
/** Each project owns a backlog, roster, clock and durable outbox. */
export class Projects {
 private db: DatabaseSync;
 private stores = new Map<string, Store>();
 constructor(private directory: string) {
  mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, '_projects.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL UNIQUE,database_path TEXT NOT NULL UNIQUE);`);
 }
 create(id: string, name: string, guild: string, channel: string, legacyPath?: string): Project {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) throw new Error('Project ID must be 1–40 lowercase letters, digits, underscores or hyphens');
  if (!name.trim() || name.length > 100) throw new Error('Project name must be 1–100 characters');
  const project = {id,name:name.trim(),guild_id:guild,channel_id:channel,database_path:legacyPath || join(this.directory,`${id}.sqlite`)};
  this.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(id,project.name,guild,channel,project.database_path);
  return project;
 }
 list(guild?: string): Project[] {return this.db.prepare('SELECT * FROM projects WHERE (? IS NULL OR guild_id=?) ORDER BY id').all(guild ?? null,guild ?? null) as unknown as Project[];}
 byChannel(guild: string, channel: string): Project | undefined {return this.db.prepare('SELECT * FROM projects WHERE guild_id=? AND channel_id=?').get(guild,channel) as unknown as Project | undefined;}
 store(project: Project): Store {
  let store=this.stores.get(project.id);
  if (!store) {store=new Store(project.database_path);this.stores.set(project.id,store);}
  return store;
 }
 close() {for (const store of this.stores.values()) store.close();this.stores.clear();this.db.close();}
}
export function projectDirectory(databasePath: string) {return dirname(databasePath);}
