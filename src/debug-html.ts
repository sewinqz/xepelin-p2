import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9' });

  await page.goto('https://xepelin.com/blog/pymes', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(4_000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2_000);

  // Find all pagination-related elements
  const paginationEls = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all
      .filter(el => {
        const cls = el.className?.toString() ?? '';
        return /pagination|Pagination|page|Page|next|Next|prev|Prev|load.*more|more.*load/i.test(cls);
      })
      .map(el => ({
        tag: el.tagName,
        classes: el.className?.toString(),
        text: el.textContent?.trim().slice(0, 100),
        html: el.outerHTML.slice(0, 400),
      }))
      .filter(el => el.text && el.text.length > 0 && el.text.length < 200);
  });
  console.log('=== PAGINATION ELEMENTS ===');
  paginationEls.forEach(el => {
    console.log(`\n${el.tag} | ${el.classes}`);
    console.log('Text:', el.text);
    console.log('HTML:', el.html);
  });

  // Also look for buttons/links at the bottom of the article list
  const bottomEls = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, a[href]'));
    return all
      .filter(el => {
        const text = el.textContent?.trim().toLowerCase() ?? '';
        return text.includes('más') || text.includes('more') || text.includes('cargar') ||
               text.includes('siguiente') || text.includes('next') || /^\d+$/.test(text);
      })
      .map(el => ({
        tag: el.tagName,
        classes: el.className?.toString().slice(0, 100),
        text: el.textContent?.trim(),
        href: el.getAttribute('href'),
        html: el.outerHTML.slice(0, 300),
      }));
  });
  console.log('\n=== LOAD MORE / NEXT BUTTONS ===');
  bottomEls.forEach(el => console.log(el));
})();
