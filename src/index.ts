import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { scrapeBlog } from './scraper';
import { writeToSheet } from './sheets';

const app = express();
app.use(express.json());

const ScrapeRequestSchema = z.object({
  category: z.string().min(1, 'category is required'),
  webhook: z.string().url('webhook must be a valid URL'),
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/scrape', (req: Request, res: Response) => {
  const parsed = ScrapeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { category, webhook } = parsed.data;

  // Acknowledge immediately so the caller isn't left hanging
  res.status(202).json({ message: 'Scrape queued', category });

  // Run scrape + sheet write + webhook in background
  (async () => {
    try {
      console.log(`[scrape] starting – category="${category}"`);
      const articles = await scrapeBlog(category);
      console.log(`[scrape] found ${articles.length} articles`);

      const sheetUrl = await writeToSheet(category, articles);
      console.log(`[sheets] written → ${sheetUrl}`);

      // Zapier webhook expects exactly: { email, link }
      await axios.post(
        webhook,
        { email: process.env.CONTACT_EMAIL ?? '', link: sheetUrl },
        { timeout: 10_000 },
      );
      console.log(`[webhook] delivered to ${webhook}`);
    } catch (err) {
      console.error('[error]', err);
      // Best-effort error notification to webhook
      try {
        await axios.post(
          webhook,
          { error: String(err), category },
          { timeout: 5_000 },
        );
      } catch {
        // ignore
      }
    }
  })();
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
