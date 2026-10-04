import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, INTERVAL } from '../src/store.js';
import { Scheduler } from '../src/scheduler.js';
function fixture() { const s=new Store(':memory:'); s.employee('a','A',5); s.employee('b','B',5); for(const id of ['T1','T2','T3']) s.add({id,title:id}); return s; }
test('5 hours from actual assignment, no calendar reset or catch-up burst',()=>{
 const s=fixture(); const first=s.assign(1000)!; s.sent(first.id,'m1');
 assert.equal(s.assign(1000+INTERVAL-1),null);
 const second=s.assign(1000+INTERVAL)!; assert.equal(second.employee_id,'b'); s.sent(second.id,'m2');
 const late=s.assign(1000+INTERVAL*4)!; s.sent(late.id,'m3');
 assert.equal(s.nextAt(),1000+INTERVAL*5); assert.equal(s.assign(1000+INTERVAL*4),null); s.close();
});
test('restart persists assignment, schedule, outbox, and request deduplication',()=>{
 const dir=mkdtempSync(join(tmpdir(),'academic-bot-')); const path=join(dir,'db.sqlite');
 try {
  let s=new Store(path); s.employee('a','A',2); s.add({id:'T1',title:'One'});
  const assigned=s.assign(1000)!; s.close(); s=new Store(path);
  assert.equal(s.tasks('assigned').length,1); assert.equal(s.nextAt(),1000+INTERVAL); assert.equal(s.assign(1000+INTERVAL),null);
  s.sent(assigned.id,'message'); assert.equal(s.request('interaction',()=>{s.add({id:'T2',title:'Two'});return 'added';}),'added');
  assert.equal(s.request('interaction',()=>{throw new Error('must not execute');}),'added'); s.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('dependencies, paused staff and capacity block assignment without advancing schedule',()=>{
 const s=new Store(':memory:'); s.employee('a','A',1); s.add({id:'A',title:'Architecture'}); s.add({id:'B',title:'Foundation'},['A']);
 s.pause('a',false); assert.equal(s.assign(100),null); assert.equal(s.nextAt(),null); s.pause('a',true);
 const a=s.assign(100)!; s.sent(a.id,'m'); assert.equal(s.assign(100+INTERVAL),null);
 assert.throws(()=>s.complete('A','other',false)); s.complete('A','a',false);
 assert.equal(s.assign(100+INTERVAL)?.id,'B'); s.close();
});
test('workload normalized by capacity, effort limits respected',()=>{
 const s=new Store(':memory:'); s.employee('a','A',2);s.employee('b','B',10);
 s.add({id:'A',title:'A',effort:3}); assert.equal(s.assign(1)?.employee_id,'b'); s.sent('A','m');
 s.add({id:'B',title:'B'}); assert.equal(s.assign(1+INTERVAL)?.employee_id,'a'); s.close();
});
test('ambiguous sends reconcile on restart without resending',async()=>{
 const s=fixture(); let sends=0; let found: string|undefined;
 const d={send:async()=>{sends++;throw new Error('lost response');},find:async()=>found};
 const scheduler=new Scheduler(s,d,()=>{}); await scheduler.tick(100);
 assert.equal(s.notice()?.delivery,'sending'); await scheduler.tick(100+INTERVAL); assert.equal(sends,1);
 found='existing-message'; await new Scheduler(s,d,()=>{}).tick(100+INTERVAL);
 assert.equal(s.notice(),undefined); assert.equal(s.tasks('assigned').length,1);s.close();
});
test('transaction rollback prevents partial task and dedup state',()=>{
 const s=fixture(); assert.throws(()=>s.request('bad',()=>{s.add({id:'X',title:'X'});throw new Error('fail');}));
 assert.equal(s.db.prepare("SELECT id FROM tasks WHERE id='X'").get(),undefined); s.close();
});
test('overlapping scheduler ticks send once',async()=>{
 const s=fixture();let sends=0;let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const scheduler=new Scheduler(s,{send:async()=>{sends++;await blocked;return 'message';},find:async()=>undefined});
 const first=scheduler.tick(1);await scheduler.tick(1);release();await first;assert.equal(sends,1);s.close();
});
test('notification delivery survives a process crash after remote send',async()=>{
 const s=fixture(); const task=s.assign(1)!;s.claim(task.id);
 let sends=0;
 await new Scheduler(s,{send:async()=>{sends++;return 'duplicate';},find:async()=> 'original-message'}).tick(1+INTERVAL);
 assert.equal(sends,0);assert.equal(s.notice(),undefined);
 assert.equal((s.db.prepare('SELECT message_id FROM notices WHERE task_id=?').get(task.id) as {message_id:string}).message_id,'original-message');s.close();
});
