declare module "google-trends-api" {
  export function dailyTrends(options: { trendDate: Date; geo: string }): Promise<string>;
  export function relatedQueries(options: { keyword: string; geo: string }): Promise<string>;
}
