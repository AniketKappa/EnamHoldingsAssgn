// Who is asking. The proxy gives every visitor a finn_uid cookie; the first
// request from a new id copies the demo portfolio and rules for them.
import { cookies } from "next/headers";
import { ensureUser } from "../pipeline/alerts";

export const UID_COOKIE = "finn_uid";

export async function currentUser(): Promise<string> {
  const jar = await cookies();
  const raw = jar.get(UID_COOKIE)?.value ?? "";
  const id = /^[a-f0-9-]{16,64}$/i.test(raw) ? raw : "demo";
  await ensureUser(id);
  return id;
}
