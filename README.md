# Milestone

A project timeline for freelancers and small agencies where the schedule reacts to money.
An AI agent turns a contract into a Gantt plan with a PayPal invoice on each milestone. PayPal
webhooks move the plan: a paid invoice unlocks the next phase, a late one holds it, and approved
subcontractor work gets paid out through PayPal Payouts.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

> Work in progress.

## Stack

| Part | Tech |
| --- | --- |
| Frontend | React 19, Vite 8, Tailwind CSS 4, TanStack Query, Bryntum Gantt 7 |
| Backend | Hono 4 on Node 22, Drizzle ORM, Postgres |
| AI | Vercel AI SDK 7 with Ollama Cloud (`gemma4:31b`), PayPal Agent Toolkit |
| PayPal | Invoicing, Payouts, Webhooks, Disputes, Transaction Search (sandbox) |
| Hosting | Render (web service), Neon (Postgres) |

## Run locally

Needs Node 22+, pnpm, Docker, and a PayPal sandbox app with Invoicing, Payouts and Transaction
search turned on.

```sh
cp .env.example .env      # fill in PayPal and Ollama keys
pnpm install
pnpm db:up                # local Postgres on port 5433
pnpm db:push              # create tables
pnpm dev                  # web on :5173, API on :8787
```

PayPal webhooks need a public URL. Run `pnpm tunnel`, then add
`<tunnel-url>/api/webhooks/paypal` as a webhook in the PayPal developer dashboard and put its ID in
`PAYPAL_WEBHOOK_ID`.

## Deploy

`render.yaml` sets up one Render web service that serves both the API and the built frontend.
Point `DATABASE_URL` at a Neon database and run `pnpm db:push` against it once. The
`keep-alive` GitHub Action pings the app every 10 minutes so the free instance stays awake; set the
`APP_URL` repository variable to turn it on.

## License

MIT
