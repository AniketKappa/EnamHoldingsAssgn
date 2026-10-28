// Seed the demo user: the 18-stock portfolio, the research picks and the
// default watch rules (spec 5.7, 12). Idempotent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";
import { seedDefaultRules } from "./alerts";

interface Holding { symbol: string; name: string; bse_code: string; sector?: string; weight_pct?: number; is_financial?: boolean }
interface PortfolioFile { holdings: Holding[]; research_picks: Holding[] }

export function loadPortfolio(): PortfolioFile {
  return JSON.parse(readFileSync(join(process.cwd(), "data", "portfolio.json"), "utf8")) as PortfolioFile;
}

export async function seedDemo(): Promise<{ companies: number; holdings: number; rules: number }> {
  const sql = db();
  const p = loadPortfolio();
  const all = [...p.holdings, ...p.research_picks];
  for (const c of all) {
    await sql`insert into companies (symbol, name, bse_code, sector, is_financial)
      values (${c.symbol}, ${c.name}, ${c.bse_code}, ${c.sector ?? null}, ${!!c.is_financial})
      on conflict (symbol) do update set name = excluded.name, sector = coalesce(excluded.sector, companies.sector),
        bse_code = coalesce(companies.bse_code, excluded.bse_code), is_financial = companies.is_financial or excluded.is_financial`;
  }
  await sql`insert into users (id) values ('demo') on conflict do nothing`;
  for (const h of p.holdings) {
    await sql`insert into holdings (user_id, symbol, weight_pct) values ('demo', ${h.symbol}, ${h.weight_pct ?? null})
      on conflict (user_id, symbol) do update set weight_pct = excluded.weight_pct`;
  }
  const rules = await seedDefaultRules("demo");
  return { companies: all.length, holdings: p.holdings.length, rules };
}
