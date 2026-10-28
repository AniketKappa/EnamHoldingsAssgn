// HTTP responses cached in Postgres (http_cache), so repeat reads of screener
// pages cost nothing and the sites see one polite request per period.
import { db, hasDb } from "../db";
import { getText, type FetchOpts } from "./http";
import { sha1 } from "../text";

export async function cachedText(url: string, opts: FetchOpts & { ttlHours: number }): Promise<string> {
  const key = sha1(url);
  if (hasDb()) {
    try {
      const rows = await db()`select body, fetched_at from http_cache where url_hash = ${key} and status = 200
        and fetched_at > now() - make_interval(hours => ${opts.ttlHours})`;
      if (rows.length && rows[0].body) return String(rows[0].body);
    } catch { /* fall through to the network */ }
  }
  const body = await getText(url, opts);
  if (hasDb()) {
    try {
      await db()`insert into http_cache (url_hash, url, status, body, fetched_at) values (${key}, ${url}, 200, ${body}, now())
        on conflict (url_hash) do update set body = excluded.body, status = 200, fetched_at = now()`;
    } catch { /* caching is best effort */ }
  }
  return body;
}
