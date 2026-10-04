import 'dotenv/config';
import backlog from './backlog.json' with { type: 'json' };
import { Store } from './store.js';
import { readFileSync } from 'node:fs';
import { Projects, projectDirectory } from './projects.js';
const projectId=process.argv[2];
const inputFile=process.argv[3];
let projects: Projects | undefined;
let store: Store;
if (projectId) {
 projects=new Projects(projectDirectory(process.env.DATABASE_PATH || './data/default.sqlite'));
 const project=projects.list().find(p=>p.id===projectId);
 if (!project) {projects.close();throw new Error('Unknown project. Run /project create in Discord first.');}
 store=projects.store(project);
} else store=new Store(process.env.DATABASE_PATH || './data/academic.sqlite');
try {
 const tasks=(inputFile ? JSON.parse(readFileSync(inputFile,'utf8').replace(/^\uFEFF/,'')) : backlog) as {id:string;title:string;description?:string;effort?:number;depends?:string[]}[];
 if (!Array.isArray(tasks)) throw new Error('Backlog JSON must be an array of tasks');
 const inserted=store.transaction(()=>{
  let count=0;
  for(const task of tasks) {
   if(store.db.prepare('SELECT id FROM tasks WHERE id=?').get(task.id)) continue;
   store.add(task,task.depends ?? []); count++;
  }
  return count;
 });
 console.log(`Imported ${inserted} tasks${projectId ? ` into ${projectId}` : ''}; existing tasks preserved.`);
} finally {if (projects) projects.close();else store.close();}
