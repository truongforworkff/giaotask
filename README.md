# GiaoTask — Discord task assignment bot

A reusable Node.js + TypeScript + discord.js bot for multiple projects in a Discord server. Each project has its own channel, backlog, employee roster, workload capacity, five-hour clock and notification outbox. SQLite preserves assignments across restarts. No privileged Message Content or Guild Members intent is required.

## Deploy on a server

Source is stored in GitHub. Run this repository on a VPS or another host with an always-running Docker container and a persistent volume. GitHub stores source code; a running host is still needed. The bot does not need to run on your personal computer.

1. Create a bot at https://discord.com/developers/applications.
2. Install with `bot` and `applications.commands` scopes. Grant View Channel, Send Messages, Embed Links, Read Message History and Attach Files in project channels. Administrator is unnecessary.
3. On the deployment host, copy `.env.example` to `.env`. Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` (Application ID), and `DISCORD_GUILD_ID` (server ID). Optional `MANAGER_ROLE_ID` allows a custom manager role; Manage Server permission also grants management access. Keep credentials out of Git.
4. Deploy:

```sh
docker compose build
docker compose run --rm bot node dist/src/deploy.js
docker compose up -d
docker compose logs -f bot
```

The container runs as a non-root user and needs no inbound public port. The named `taskbot-data` volume persists all databases. Keep one bot instance; do not scale replicas or share SQLite on network storage. `docker compose down` preserves data; `down -v` destroys it. Back up with SQLite online backup, or stop the bot and copy the data directory including WAL files. Restore while stopped.

## Multiple projects

In `#academic-tasks`:

```text
/project create id:academic name:Academic
/employee add user:@Nam capacity:3
/employee add user:@Minh capacity:3
/task add id:T-001 title:Define-domain effort:1
```

In `#website-tasks`:

```text
/project create id:website name:Website
/employee add user:@Huy capacity:5
/task add id:T-001 title:Build-homepage effort:2
```

Commands target the project belonging to the current channel. Identical task IDs can exist in different projects. New schedulers start within ten seconds. Each project assigns one task per five-hour interval independently; a blocked project does not block other projects.

Employee capacity is per project. A person on multiple projects needs an appropriate capacity in each; there is no shared cross-project workload limit. Projects run within the configured server. Another Discord server requires another deployment and data directory.

## Commands

Commands are server-only and responses private. Adding tasks, changing employees, creating/listing projects and retrying uncertain notifications require Manage Server permission or the configured role. Completing a task requires its assignee or a manager.

```text
/project list page:1
/task add id:T-002 title:Build-API effort:2 priority:10 depends:T-001
/task list status:backlog page:1
/task list status:assigned
/task show id:T-001
/task complete id:T-001
/employee list page:1
/employee pause user:@Nam
/employee resume user:@Nam
/schedule
```

Dependencies must exist in the same project and be completed before assignment; requiring existing IDs prevents cycles. Adding an existing employee updates capacity and reactivates them. Pause stops future assignments while keeping current work and history. Capacity reductions do not cancel assignments. Lists show ten rows per page. Long task descriptions are attached as text files.

## Backlog import

Create the project first. JSON tasks must be in dependency order and have `id`, `title`, and optional `description`, `effort`, `priority`, `depends` fields. Imports are atomic and preserve existing IDs. Import on the deployment host:

```sh
docker compose run --rm -v /path/backlog.json:/app/backlog.json:ro bot node dist/src/seed.js website /app/backlog.json
```

`examples/backlog.json` is a generic example. The Academic backlog is optional and never loaded automatically:

```sh
docker compose run --rm bot node dist/src/seed.js academic
```

It includes BE-000–BE-017 extracted from the original backend task document: scope, outputs, acceptance criteria and dependencies. Effort starts at one point since the source gives no estimates. BE-017 depends on all previous tasks as a conservative interpretation of “Core APIs stable”. Completing BE-000 represents architecture approval.

## Five-hour timing and recovery

The first task is assigned when a ready task and employee capacity exist. Every committed assignment persists `next_at = assigned_at + 18,000,000 ms`. Ready tasks are ordered by priority descending then ID. Employees minimize open effort divided by capacity; ties prefer the person assigned longest ago, then user ID. A task must fit remaining capacity.

The scheduler wakes at the saved due timestamp and checks idle/blocked queues every thirty seconds. Five hours is the minimum gap from the previous committed assignment. Network availability, operating-system timing, dependencies and capacity can delay delivery. After downtime, create at most one overdue assignment and start the next five-hour period from that actual assignment; do not flood missed intervals. Completion does not reset the timer.

Task state, workload, clock and outbox commit together in a SQLite transaction. Slash-command mutation IDs prevent duplicate processing. A `sending` state is persisted before the remote send. After a crash or ambiguous response, search channel history for the bot’s assignment footer. A found message is recorded without resending. An uncertain delivery blocks that project until a manager checks the channel and explicitly retries:

```text
/task retry-notification id:T-001 checked-channel:true
```

Retry only after verifying the announcement is absent. Discord nonce enforcement adds short-term deduplication but cannot guarantee exactly-once remote delivery indefinitely; manual retry can duplicate a delayed send. Keep announcements until delivery is confirmed. If an employee left the server, re-add them before retrying, or complete their task as manager and pause them.

## Upgrade from the original Academic bot

`DISCORD_CHANNEL_ID` and `PROJECT_NAME` are optional legacy settings. A legacy channel bootstraps Academic using `DATABASE_PATH`, preserving the original backlog and clock. Leave the channel empty on a fresh installation and use `/project create`. The directory containing `DATABASE_PATH` stores `_projects.sqlite` and project databases; mount this directory persistently.

## Development and checks

Use Node.js 22.14 or newer. Node 22 may print an experimental warning for built-in SQLite.

```sh
npm ci
npm run check
npm test
npm run build
npm run deploy
npm start
```

`deploy` replaces the application’s commands in the configured server; rerun when command definitions change. GitHub Actions checks types, tests, compilation and the Docker build.

Modules: `config.ts` validates environment; `projects.ts` persists projects and selects stores; `store.ts` handles transactions, backlog and workload; `commands.ts` routes by channel and checks permissions; `scheduler.ts` handles the clock/outbox; `discord.ts` sends and reconciles announcements; `index.ts` handles startup/shutdown; `seed.ts` imports backlogs.

Tests cover timing boundaries, delayed recovery, restarts, workload/capacity, dependencies, ownership, manager authorization, request deduplication, rollback, overlapping ticks, ambiguous sends and project isolation. Live Discord requires your application and credentials. Future schema changes require explicit migrations; project databases initialize at version 1.

Official references: [discord.js docs](https://discord.js.org/docs/packages/discord.js/14.27.0), [Discord message API](https://discord.com/developers/docs/resources/message#create-message).
