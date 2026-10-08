# Milestone

A project timeline for freelancers and small agencies where the schedule reacts to money.

Paste or upload a contract, and Milestone turns it into a Gantt plan with a PayPal invoice on
each payment milestone. From then on PayPal drives the plan: a paid invoice unlocks the next
phase, a late one holds it, and a payments agent watches the project and drafts what to do next.
You approve every action before anything reaches your client or PayPal.

Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

## What it does

- **Contract to plan.** `gemma4:31b` reads the contract (text, PDF or photo) and pulls out phases,
  payment milestones and subcontractor payouts. Dates and amounts are worked out in code, not by
  the model, and you review the plan before saving.
- **A schedule that follows the money.** Phases that wait for payment start on hold (dashed bars
  in the Gantt). PayPal invoice webhooks mark invoices paid and unblock the next phase live.
- **A payments agent that asks first.** On a schedule, after each save, and after each PayPal
  webhook, the agent syncs invoices and payouts from PayPal, finds what needs doing, and drafts
  suggestions:
  - send an invoice that's coming due
  - remind a client about a late invoice (PayPal's reminder email, with a drafted note)
  - split a late invoice so the client can pay part now and unblock the next phase
  - move a phase that's stuck waiting on money, and everything after it
  - pay a subcontractor through PayPal Payouts once the client has paid for their phase
  - hold work when a client opens a PayPal dispute on a payment

  Each suggestion shows the reason, the numbers, and the exact message. You can edit it, approve
  it, or dismiss it. The model can look up invoices and disputes through the
  [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) (read-only); every change goes
  through an approval.
- **Replans you can see.** After a phase moves, the Gantt keeps its original dates as a dotted
  ghost bar (Bryntum baselines), so the slip is visible at a glance.

## Stack

| Part | Tech |
| --- | --- |
| Frontend | React 19, Vite 8, Tailwind CSS 4, TanStack Query, Bryntum Gantt 7 |
| Backend | Hono 4 on Node 22, Drizzle ORM, Postgres |
| AI | Vercel AI SDK 7 with Ollama Cloud (`gemma4:31b`), PayPal Agent Toolkit |
| PayPal | Invoicing, Payouts, Webhooks, Disputes (sandbox) |
| Hosting | Render (web service), Neon (Postgres) |

## Run locally

Needs Node 22+, pnpm, and a PayPal sandbox app with Invoicing and Payouts turned on. Payouts
only work from a US sandbox business account.

```sh
cp .env.example .env      # fill in PayPal, Ollama and database settings
pnpm install
pnpm db:up                # local Postgres on port 5433 (or use a Neon URL)
pnpm db:push              # create tables
pnpm dev                  # web on :5173, API on :8787
```

PayPal webhooks need a public URL. Run `pnpm tunnel`, copy the `trycloudflare.com` URL it prints,
then run `pnpm webhook:register <url>`. That creates the webhook on your sandbox app, saves its ID
to `.env`, and removes old tunnel webhooks. Restart `pnpm dev` afterwards.

To try the agent without waiting for real dates to pass, run
`pnpm --filter @milestone/server seed:demo`. It creates a project that started a month ago, with
a paid deposit and a late design invoice, using real sandbox invoices. Open the link it prints and
press **Check now**.

## Deploy

`render.yaml` sets up one Render web service (Singapore, next to the Neon database) that serves
both the API and the built frontend.

1. Create a Neon database and run `pnpm db:push` against it once.
2. Create the service from `render.yaml` and fill in the secret env vars.
3. Run `pnpm webhook:register https://<your-app>.onrender.com` and copy the new
   `PAYPAL_WEBHOOK_ID` into Render.
4. Free Render instances sleep after 15 minutes without traffic. Point an external pinger such as
   [cron-job.org](https://cron-job.org) at `https://<your-app>.onrender.com/api/ping` every 10
   minutes so webhooks and the agent's schedule keep running.

## License

MIT
