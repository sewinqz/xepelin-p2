export interface ScrapeRequest {
  category: string;
  webhook: string;
}

export interface Article {
  title: string;
  url: string;
  date: string;
  author: string;
  readingTime: string;
  category: string;
}

export interface WebhookPayload {
  sheetUrl: string;
  category: string;
  count: number;
  scrapedAt: string;
  articles: Article[];
}
