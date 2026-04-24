import 'dotenv/config';
import { scrapeBlog } from './scraper';

const category = process.argv[2] ?? 'Pymes y Negocios';

console.log(`\nScraping category: "${category}"\n`);

const start = Date.now();

scrapeBlog(category).then((articles) => {
  if (articles.length === 0) {
    console.log('No articles found.');
    return;
  }
  console.log(`\n=== ${articles.length} articles found ===\n`);
  for (const a of articles) {
    const reading = a.readingTime || '?';
    const date    = a.date        || '?';
    const author  = a.author      || '?';
    console.log(`[${a.category}] ${a.title} | ${author} | ${reading} | ${date}`);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nDone in ${elapsed}s`);
}).catch(console.error);
