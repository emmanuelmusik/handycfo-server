import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { dropboxAuthRouter } from './routes/dropboxAuth.js';
import { receiptsRouter } from './routes/receipts.js';
import { networkRouter } from './routes/network.js';
import { accountRouter } from './routes/account.js';
import { invoicesRouter } from './routes/invoices.js';
import { runReminderJob } from './jobs/sendInvoiceReminders.js';

const app = express();
// Receipt uploads arrive as base64 JSON, so that one route gets a larger body limit.
app.use('/receipts/scan', express.json({ limit: '28mb' }));
app.use(express.json({ limit: '100kb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(dropboxAuthRouter);
app.use(receiptsRouter);
app.use(networkRouter);
app.use(invoicesRouter);
app.use(accountRouter);

// Manual trigger for testing/observability — e.g. an uptime pinger,
// or just curling it yourself after deploying — without exposing
// the reminder job to the public internet unauthenticated.
app.post('/jobs/reminders/run', async (req, res) => {
  if (req.headers['x-cron-secret'] !== process.env.CRON_TRIGGER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const results = await runReminderJob();
  res.json(results);
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`HandyCFO server listening on :${port}`));

// Runs once a day at 08:00 server time. Railway keeps this process
// alive continuously, so an in-process schedule is enough — no
// separate cron infrastructure needed for a single-service deploy.
cron.schedule('0 8 * * *', () => {
  console.log('Running scheduled invoice reminder job…');
  runReminderJob().catch((err) => console.error('Scheduled reminder job failed:', err));
});
