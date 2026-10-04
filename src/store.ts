import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export const INTERVAL = 5 * 60 * 60 * 1000;
export interface Task { id: string; title: string; description: string; effort: number; status: string; employee_id: string | null; assigned_at: number | null }
export interface Employee { id: string; name: string; active: number; capacity: number; load: number }
export interface Notice extends Task { delivery: string; message_id: string | null }
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, capacity INTEGER NOT NULL CHECK(capacity>0), last_assigned INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, effort INTEGER NOT NULL CHECK(effort>0), priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'backlog', employee_id TEXT REFERENCES employees(id), assigned_at INTEGER, completed_at INTEGER);
      CREATE TABLE IF NOT EXISTS dependencies(task_id TEXT REFERENCES tasks(id), depends_on TEXT REFERENCES tasks(id), PRIMARY KEY(task_id,depends_on));
      CREATE TABLE IF NOT EXISTS schedule(id INTEGER PRIMARY KEY CHECK(id=1), next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notices(task_id TEXT PRIMARY KEY REFERENCES tasks(id), delivery TEXT NOT NULL DEFAULT 'pending', message_id TEXT);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, result TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  request(id: string, fn: () => string) {
    return this.transaction(() => {
      const cached = this.db.prepare('SELECT result FROM requests WHERE id=?').get(id) as {result: string} | undefined;
      if (cached) return cached.result;
      const result = fn(); this.db.prepare('INSERT INTO requests VALUES (?,?)').run(id, result); return result;
    });
  }
  employee(id: string, name: string, capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new Error('Capacity must be 1–100');
    this.db.prepare('INSERT INTO employees(id,name,capacity) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,capacity=excluded.capacity,active=1').run(id,name,capacity);
  }
  pause(id: string, active: boolean) {
    if (!this.db.prepare('UPDATE employees SET active=? WHERE id=?').run(Number(active),id).changes) throw new Error('Employee not found');
  }
  employees(): Employee[] {
    return this.db.prepare(`SELECT e.*, COALESCE(SUM(CASE WHEN t.status='assigned' THEN t.effort ELSE 0 END),0) AS load FROM employees e LEFT JOIN tasks t ON t.employee_id=e.id GROUP BY e.id ORDER BY e.id`).all() as unknown as Employee[];
  }
  add(task: {id: string; title: string; description?: string; effort?: number; priority?: number}, deps: string[] = []) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(task.id) || !task.title.trim() || task.title.length>200 || (task.description?.length || 0)>3000) throw new Error('Invalid task ID/title/description');
    const effort = task.effort ?? 1;
    if (!Number.isInteger(effort) || effort<1 || effort>100) throw new Error('Effort must be 1–100');
    for (const dep of deps) if (dep===task.id || !this.db.prepare('SELECT id FROM tasks WHERE id=?').get(dep)) throw new Error(`Unknown dependency: ${dep}`);
    this.db.prepare('INSERT INTO tasks(id,title,description,effort,priority) VALUES(?,?,?,?,?)').run(task.id,task.title,task.description || '',effort,task.priority ?? 0);
    for (const dep of new Set(deps)) this.db.prepare('INSERT INTO dependencies VALUES(?,?)').run(task.id,dep);
  }
  tasks(status?: string, page = 1): Task[] {
    return this.db.prepare('SELECT * FROM tasks WHERE (? IS NULL OR status=?) ORDER BY id LIMIT 10 OFFSET ?').all(status ?? null,status ?? null,(page-1)*10) as unknown as Task[];
  }
  complete(id: string, user: string, manager: boolean, now = Date.now()) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as unknown as Task | undefined;
    if (!task || task.status!=='assigned') throw new Error('Task is not assigned');
    if (!manager && task.employee_id!==user) throw new Error('Only the assignee or a manager can complete this task');
    this.db.prepare("UPDATE tasks SET status='done',completed_at=? WHERE id=?").run(now,id);
  }
  nextAt(): number | null { return (this.db.prepare('SELECT next_at FROM schedule WHERE id=1').get() as {next_at:number}|undefined)?.next_at ?? null; }
  assign(now: number): Task | null {
    return this.transaction(() => {
      if ((this.nextAt() ?? 0)>now) return null;
      // Pending/uncertain delivery blocks further assignments until resolved.
      if (this.db.prepare("SELECT task_id FROM notices WHERE delivery!='sent' LIMIT 1").get()) return null;
      const ready = this.db.prepare(`SELECT t.* FROM tasks t WHERE status='backlog' AND NOT EXISTS (SELECT 1 FROM dependencies d JOIN tasks p ON p.id=d.depends_on WHERE d.task_id=t.id AND p.status!='done') ORDER BY priority DESC,id`).all() as unknown as Task[];
      for (const task of ready) {
        const employee = this.db.prepare(`SELECT e.id FROM employees e LEFT JOIN tasks t ON t.employee_id=e.id AND t.status='assigned' WHERE e.active=1 GROUP BY e.id HAVING COALESCE(SUM(t.effort),0)+?<=e.capacity ORDER BY COALESCE(SUM(t.effort),0)*1.0/e.capacity,e.last_assigned,e.id LIMIT 1`).get(task.effort) as {id:string}|undefined;
        if (!employee) continue;
        this.db.prepare("UPDATE tasks SET status='assigned',employee_id=?,assigned_at=? WHERE id=?").run(employee.id,now,task.id);
        this.db.prepare('UPDATE employees SET last_assigned=? WHERE id=?').run(now,employee.id);
        this.db.prepare('INSERT INTO schedule VALUES(1,?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at').run(now+INTERVAL);
        this.db.prepare('INSERT INTO notices(task_id) VALUES(?)').run(task.id);
        return {...task,status:'assigned',employee_id:employee.id,assigned_at:now};
      }
      return null;
    });
  }
  notice(): Notice | undefined { return this.db.prepare("SELECT t.*,n.delivery,n.message_id FROM notices n JOIN tasks t ON t.id=n.task_id WHERE n.delivery!='sent' ORDER BY t.assigned_at LIMIT 1").get() as unknown as Notice | undefined; }
  claim(id: string): boolean { return Boolean(this.db.prepare("UPDATE notices SET delivery='sending' WHERE task_id=? AND delivery='pending'").run(id).changes); }
  sent(id: string, message: string) { this.db.prepare("UPDATE notices SET delivery='sent',message_id=? WHERE task_id=?").run(message,id); }
  retry(id: string) { if (!this.db.prepare("UPDATE notices SET delivery='pending' WHERE task_id=? AND delivery='sending'").run(id).changes) throw new Error('No uncertain notification for this task'); }
  close() { this.db.close(); }
}
