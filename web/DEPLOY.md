# Deploying Spirit Tips

The app stores data in Postgres. A serverless host has a read-only, ephemeral
filesystem, so a file database would silently lose every show — Postgres is not
optional in production.

Two accounts are needed, both free to start: **Neon** (Postgres) and **Vercel**
(hosting). Nothing below requires sharing a password or token with anyone.

## 1. Create the database

1. Sign up at [neon.tech](https://neon.tech) and create a project — pick the
   region closest to St. John's (`aws-us-east-1` is the nearest default).
2. Open **Connection Details** and copy the **Pooled connection** string. It
   contains `-pooler` in the hostname:

   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```

   **Use the pooled string, not the direct one.** Each serverless invocation
   opens its own connection; without the pooler the database hits its
   connection limit under normal use.

## 2. Deploy

1. Sign in to [vercel.com](https://vercel.com) with the GitHub account that owns
   this repository.
2. **Add New → Project**, import `SpiritProductions_Tips`.
3. Set **Root Directory** to `web`. This is the one setting that is easy to miss
   and the build fails without it.
4. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the pooled Neon string from step 1 |

5. Deploy. The schema creates itself on first request — `ensureSchema()` runs
   once per process behind a Postgres advisory lock, so concurrent instances
   cannot race. To create it ahead of time instead, run `npm run migrate`
   locally with `DATABASE_URL` set to the same database.

The app is now live. It runs on **demo timecards** until Square is connected;
the header says which.

## 3. Connect Square (optional, later)

Add these in Vercel → Settings → Environment Variables, then redeploy:

| Name | Value |
|---|---|
| `SQUARE_ACCESS_TOKEN` | access token for the Square account |
| `SQUARE_ENVIRONMENT` | `sandbox` while testing, `production` when live |
| `SQUARE_LOCATION_SPIRIT` | Square location id for Spirit Theater |
| `SQUARE_LOCATION_ACC` | Square location id for the ACC |

One token covers both venues — they sit under one Square merchant account, so
the location is a filter on each request, not a separate login. Find the two
location ids with `GET /v2/locations`, or in the Square dashboard.

Start in **sandbox**. Nothing in this app writes to Square, but a wrong location
id would pull the wrong venue's timecards into a payout sheet.

## 4. Create the first account

**Nobody can sign in until you do this**, including anyone who finds the URL.
That is deliberate: a fresh deployment is locked, not open.

```bash
DATABASE_URL='<the pooled Neon string>' \
ADMIN_EMAIL='you@example.com' \
ADMIN_PASSWORD='a long passphrase you have not used elsewhere' \
ADMIN_NAME='Your Name' \
npm run create-admin
```

Run it from your own machine against the deployed database. The password is
never stored as text — only a salted scrypt hash — and it is not saved in
Vercel's environment.

Then sign in and use **People** in the top bar to add everyone else. Each person
gets a role and a set of venues:

- **Admin** — everything, including managing people.
- **Manager** — shows only, and only at the venues you tick. Leave every venue
  unticked to grant all of them.

A manager scoped to Spirit cannot open, export or edit an ACC show: the venue
simply is not there, and a direct link returns "not found".

## 5. Seed the sample show (optional)

To load the verified Forever Country night into the deployed database:

```bash
DATABASE_URL='<the pooled Neon string>' npm run seed
```

Run it once. It exits without changes if that show already exists.

## Running locally

```bash
cp .env.example .env.local     # set DATABASE_URL
npm install
npm run migrate
npm run seed
npm run dev
```

A local Postgres works with a plain connection string — TLS is skipped
automatically for `localhost` and `127.0.0.1`.

## Costs

Neon and Vercel both have free tiers that comfortably fit a few shows a week.
Neon's free project sleeps when idle, so the first request after a quiet spell
takes a second or two to wake.

## Security notes

- Sessions are random 32-byte tokens in an httpOnly, SameSite=Lax cookie,
  marked Secure in production. The database stores only a SHA-256 of the token,
  so a database leak does not hand over live sessions.
- Passwords are salted scrypt hashes, compared in constant time. Minimum 12
  characters.
- Eight failed sign-ins lock an account for 15 minutes. The failure message is
  the same whether the email or the password was wrong, so the form cannot be
  used to discover which addresses have accounts.
- Changing someone's password, or deactivating them, signs them out everywhere
  immediately.
- There is no self-service sign-up and no password-reset email. An admin sets
  passwords on the People page. That suits a small team and removes a whole
  class of account-takeover risk; it does mean an admin must be reachable.

## Before real payouts

- ACC's **public** show rules are assumed to match Spirit's and are unconfirmed.
- The Gower sheet lists no office staff yet its formula adds 6 office hours;
  the app seeds the public office roster there. Confirm who should receive them.
