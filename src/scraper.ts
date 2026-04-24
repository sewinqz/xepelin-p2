import axios from 'axios';
import { chromium } from 'playwright';
import type { Article } from './types';

const BLOG_BASE = 'https://xepelin.com/blog';

const IGNORED_TEXTS = new Set(['blog', 'explorarcategoria', 'ingresar', 'registrate']);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');

// In-memory cache of nav links — populated once per process lifetime.
// Each test run is a separate process so tests always fetch fresh.
let navCache: Array<{ text: string; href: string }> | null = null;

async function getNavLinks(page: import('playwright').Page): Promise<Array<{ text: string; href: string }>> {
  if (navCache) return navCache;

  await page.goto(BLOG_BASE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(2_000);

  const raw: Array<{ text: string; href: string }> = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a'))
      .filter(a => /xepelin\.com\/blog\/[^/]+\/?$/.test(a.href))
      .map(a => ({ text: a.textContent?.trim() ?? '', href: a.href })),
  );

  navCache = raw.filter(l => {
    const t = norm(l.text);
    return t.length > 2 && !IGNORED_TEXTS.has(t);
  });

  console.log('[nav] cached', navCache.length, 'category links');
  return navCache;
}

async function resolveCategoryUrl(
  page: import('playwright').Page,
  category: string,
): Promise<string> {
  const categoryLinks = await getNavLinks(page);
  const catNorm = norm(category);

  const match = categoryLinks.find(l => {
    const t = norm(l.text);
    if (t === catNorm) return true;
    if (catNorm.length >= 4 && t.includes(catNorm)) return true;
    if (t.length >= 4 && catNorm.includes(t)) return true;
    return false;
  });
  if (match) return match.href;

  const available = [...new Set(categoryLinks.map(l => l.text).filter(Boolean))];
  console.warn(`[scraper] category "${category}" not found in nav. Available: ${available.join(', ')}`);

  const slug = category.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
  return `${BLOG_BASE}/${slug}`;
}

// Build a URL→lastmod map from the sitemap for the blog section.
async function buildDateMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await axios.get<string>('https://xepelin.com/sitemap.xml', { timeout: 15_000 });
    const re = /<loc>(https:\/\/xepelin\.com\/blog\/[^<]+)<\/loc>\s*(?:<changefreq>[^<]*<\/changefreq>\s*)?(?:<lastmod>([^<]+)<\/lastmod>)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(data)) !== null) {
      if (m[2]) map.set(m[1], m[2]);
    }
  } catch (err) {
    console.warn('[sitemap] failed to load:', err);
  }
  return map;
}

// Fetch a single article page with axios and extract reading time.
// Next.js SSRs the content so it's present in the raw HTML.
async function getReadingTime(url: string): Promise<string> {
  try {
    const { data } = await axios.get<string>(url, {
      timeout: 10_000,
      headers: { 'Accept-Language': 'es-CL,es;q=0.9', 'User-Agent': 'Mozilla/5.0' },
    });
    const m = /(\d+)<!-- --> min de lectura/.exec(data);
    return m ? `${m[1]} min de lectura` : '';
  } catch {
    return '';
  }
}

export async function getCategories(): Promise<string[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9' });
    const links = await getNavLinks(page);
    return [...new Set(links.map(l => l.text).filter(Boolean))];
  } finally {
    await browser.close();
  }
}

export async function scrapeBlog(category: string): Promise<Article[]> {
  const [dateMap] = await Promise.all([buildDateMap()]);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9' });

    const categoryUrl = await resolveCategoryUrl(page, category);
    console.log(`[scraper] category URL: ${categoryUrl}`);

    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(3_000);

    const articles: Article[] = [];
    const seen = new Set<string>();
    let pageNum = 1;

    while (pageNum <= 20) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_500);

      // Leaf cards only (exclude wrapper divs that contain other cards)
      const cards = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll<HTMLElement>('.ArticlesPagination_articleNormal__TZRAC'));
        return all
          .filter(el => el.querySelectorAll('.ArticlesPagination_articleNormal__TZRAC').length === 0)
          .map(el => {
            // URL
            const link = el.querySelector<HTMLAnchorElement>('a.absolute');
            const url = link?.href ?? '';

            // Title
            const titleEl = el.querySelector('h3');
            const title = titleEl?.textContent?.trim().replace(/\s+/g, ' ') ?? '';

            // Author: img alt inside the card bottom section
            const authorImg = el.querySelector<HTMLImageElement>('div.\\-mb-1 img[alt], div[class*="-mb-1"] img[alt]');
            // Fallback: any small text div with "| " separator
            const authorTextEl = el.querySelector<HTMLElement>('div.flex.gap-2 > div');
            const authorText = authorImg?.alt ?? authorTextEl?.textContent?.trim() ?? '';
            // Strip job title (everything after " | ")
            const author = authorText.split(' | ')[0].trim();

            // Category: the colored badge in top-left
            const catEl = el.querySelector<HTMLElement>('p.absolute');
            const cardCategory = catEl?.textContent?.trim() ?? '';

            return { url, title, author, category: cardCategory };
          })
          .filter(a => a.url && a.title);
      });

      let newThisPage = 0;
      for (const card of cards) {
        if (seen.has(card.url)) continue;
        seen.add(card.url);
        articles.push({
          title: card.title,
          url: card.url,
          author: card.author,
          category: card.category || category,
          date: '',       // filled in below
          readingTime: '', // filled in below
        });
        newThisPage++;
      }

      console.log(`[scraper] page ${pageNum}: +${newThisPage} articles (total ${articles.length})`);

      // "Cargar más" button — loads the next batch of articles in place
      const loadMore = await page.$('button:has-text("Cargar más"), button:has-text("Cargar mas")');
      if (loadMore && await loadMore.isVisible() && !(await loadMore.isDisabled())) {
        await loadMore.scrollIntoViewIfNeeded();
        await loadMore.click();
        await page.waitForTimeout(2_500);
        pageNum++;
      } else {
        break;
      }
    }

    // Enrich with reading time (parallel axios calls, max 5 at a time)
    console.log(`[scraper] fetching reading times for ${articles.length} articles...`);
    const CONCURRENCY = 10;
    for (let i = 0; i < articles.length; i += CONCURRENCY) {
      const batch = articles.slice(i, i + CONCURRENCY);
      const times = await Promise.all(batch.map(a => getReadingTime(a.url)));
      times.forEach((t, j) => {
        articles[i + j].readingTime = t;
      });
    }

    // Enrich with dates from sitemap
    for (const article of articles) {
      const sitemapDate = dateMap.get(article.url);
      if (sitemapDate) {
        // Convert "2025-01-15" → "15 enero 2025"
        article.date = formatSitemapDate(sitemapDate);
      }
    }

    return articles;
  } finally {
    await browser.close();
  }
}

const MONTHS_ES = [
  'enero','febrero','marzo','abril','mayo','junio',
  'julio','agosto','septiembre','octubre','noviembre','diciembre',
];

function formatSitemapDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
