# HandyCFO server

Handles anything the React app can't do safely on its own: the Dropbox
OAuth handshake, and the daily invoice reminder job. Deploys as a single
Railway service.

## Setup

1. Run `migrations/001_schema.sql` then `migrations/002_add_email_fields.sql`
   in the Supabase SQL editor, in that order.
   *(001 is the schema from earlier in this chat — save it into
   `migrations/001_schema.sql` alongside this folder.)*
2. Create a Dropbox app at https://www.dropbox.com/developers/apps
   - Access type: **App folder** (not "Full Dropbox") — this is what
     keeps HandyCFO scoped to its own folder instead of the user's
     entire Dropbox.
   - Add `DROPBOX_REDIRECT_URI` (see `.env.example`) under
     "Redirect URIs" in the app's settings.
   - Under Permissions, enable `files.content.write`,
     `files.content.read`, and `account_info.read`.
3. Create a Resend account and API key for sending reminder emails.
4. Copy `.env.example` to `.env` and fill in every value. Generate
   `TOKEN_ENCRYPTION_KEY` with:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
5. `npm install`, then `npm run dev` to run locally, or push to
   Railway and set the same env vars there.

## Testing the reminder job without waiting for 08:00

```
npm run reminders:run-now
```

Or, once deployed:

```
curl -X POST https://your-api.up.railway.app/jobs/reminders/run \
  -H "x-cron-secret: $CRON_TRIGGER_SECRET"
```

## What's intentionally NOT here yet

- **Receipt AI parsing** — the endpoint the React app would call after
  uploading a photo. Needs you to pick a provider first (Claude's own
  vision API is a reasonable default given the rest of the stack).
- **Invoice PDF generation** — reminders currently just say "the
  invoice for €X," they don't attach anything. Worth adding once the
  React app can render an invoice template server-side.
- **Bank auto-matching** — needs an open banking provider (GoCardless
  Bank Account Data, Salt Edge, or TrueLayer all support Austria)
  wired up as its own route + webhook handler.
- **Account deletion endpoint** — the schema is ready (cascading
  deletes), but this needs a route that calls Supabase's admin
  "delete user" API with the service role key. A few lines, but
  should go behind extra confirmation (e.g. require the user to
  re-enter their password) given it's irreversible.
