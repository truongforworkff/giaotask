import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Projects } from '../src/projects.js';
import { INTERVAL } from '../src/store.js';
test('projects isolate tasks, employees, outboxes and independent clocks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taskbot-projects-'));let projects=new Projects(dir);
 try {
  const a=projects.create('academic','Academic','guild','channel-a');
  const b=projects.create('website','Website','guild','channel-b');
  const sa=projects.store(a),sb=projects.store(b);
  sa.employee('alice','Alice',2);sb.employee('bob','Bob',2);
  sa.add({id:'T1',title:'Academic task'});sb.add({id:'T1',title:'Website task'});
  assert.equal(sa.assign(100)?.employee_id,'alice');assert.equal(sb.assign(200)?.employee_id,'bob');
  assert.equal(sa.nextAt(),100+INTERVAL);assert.equal(sb.nextAt(),200+INTERVAL);
  sa.sent('T1','academic-message');assert.equal(sa.notice(),undefined);assert.equal(sb.notice()?.id,'T1');
  assert.equal(projects.byChannel('other-guild','channel-a'),undefined);
  projects.close();projects=new Projects(dir);
  assert.equal(projects.list('guild').length,2);
  assert.equal(projects.store(projects.byChannel('guild','channel-b')!).notice()?.employee_id,'bob');
 } finally {projects.close();rmSync(dir,{recursive:true,force:true});}
});
test('duplicate channel and project IDs are rejected; traversal cannot create database files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taskbot-projects-'));const p=new Projects(dir);
 try {
  p.create('a','A','guild','channel');
  assert.throws(()=>p.create('a','B','guild','other'));
  assert.throws(()=>p.create('b','B','guild','channel'));
  assert.throws(()=>p.create('../escape','Bad','guild','other'));
  assert.equal(p.list().length,1);
 } finally {p.close();rmSync(dir,{recursive:true,force:true});}
});
test('legacy database can be adopted without discarding existing tasks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'taskbot-projects-'));const p=new Projects(dir);
 try {
  const a=p.create('academic','Academic','guild','channel',join(dir,'original.sqlite'));
  p.store(a).add({id:'BE-000',title:'Architecture'});
  assert.equal(p.store(a).tasks()[0]?.id,'BE-000');assert.equal(p.store(a),p.store(a));
 } finally {p.close();rmSync(dir,{recursive:true,force:true});}
});
