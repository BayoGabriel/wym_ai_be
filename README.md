# WymNet AI Backend — Starter Scaffold

A clean, minimal Express + TypeScript backend foundation for WymNet AI Solutions & Automation.

## Technology Stack

- Node.js + TypeScript
- Express.js
- PostgreSQL
- Drizzle ORM
- Zod (env validation)
- Vitest (tests)
- ESLint + Prettier
- Docker + Docker Compose

## Prerequisites

- Node.js 20+
- Docker & Docker Compose

## Environment Variables

Create a `.env` based on `.env.example`:

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wymnet
```

## Install Dependencies

```
npm install
```

## Start PostgreSQL with Docker

```
docker compose up -d
```

Database data persists in a Docker volume `wymnet_pg_data`.

## Drizzle Workflow

- Generate migrations (after adding schema in `src/database/schema/`):

```
npm run db:generate
```

- Apply migrations:

```
npm run db:migrate
```

- Optional Studio:

```
npm run db:studio
```

## Run the Backend (dev)

```
npm run dev
```

Server starts on `http://localhost:3000`.

- Health: `GET /api/v1/health` → `{ "status": "ok", "db": "up|down" }`

## Build & Start (prod-like)

```
npm run build
npm start
```

## Testing

```
npm test
```

Covers app initialization, `/health`, error handling, and env validation.

## Code Quality

- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Format: `npm run format`

## Project Structure

```
src/
  config/env.ts
  database/
    client.ts
    schema/
  middleware/
  routes/
    health.ts
    index.ts
  app.ts
  server.ts

drizzle/
  migrations/

tests/
```

## Notes

- This scaffold intentionally avoids future modules until implemented.
- Use `src/modules/` for new features when they are built.
