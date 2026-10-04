import { Store } from './store.js';
export interface Delivery { send(task: NonNullable<ReturnType<Store['notice']>>): Promise<string>; find(task: NonNullable<ReturnType<Store['notice']>>): Promise<string | undefined> }
export class Scheduler {
 private busy = false;
 private timer?: ReturnType<typeof setTimeout>;
 private stopped = false;
 private current?: Promise<void>;
 constructor(private store: Store, private delivery: Delivery, private log: (message: string) => void = console.error) {}
 async tick(now = Date.now()) {
  if (this.busy) return;
  this.busy=true;
  try {
   this.store.assign(now);
   const notice = this.store.notice();
   if (!notice) return;
   if (notice.delivery==='sending') {
    const existing = await this.delivery.find(notice);
    if (existing) this.store.sent(notice.id,existing);
    else this.log(`Uncertain notification ${notice.id}; scheduling blocked. Check channel, then use /task retry-notification.`);
    return;
   }
   if (!this.store.claim(notice.id)) return;
   // Persist BEFORE sending. A crash or ambiguous HTTP error is never blindly retried.
   const messageId = await this.delivery.send(notice);
   this.store.sent(notice.id,messageId);
  } catch (error) { this.log(`Scheduler: ${error instanceof Error ? error.message : 'failed'}`); }
  finally { this.busy=false; }
 }
 start() {
  this.stopped=false;
  const run = async () => {
   this.current = this.tick(); await this.current;
   if (this.stopped) return;
   const due = this.store.nextAt();
   // Wake at the persisted due time, poll idle/blocked queues every 30 seconds.
   this.timer=setTimeout(run,due && due>Date.now() ? Math.min(due-Date.now(),30_000) : 30_000);
  };
  void run();
 }
 async stop() { this.stopped=true; clearTimeout(this.timer); await this.current; }
}
