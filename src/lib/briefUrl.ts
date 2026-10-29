/** The Brief's API address for a window, shared by the server render and the client. */
export function briefUrl(w: string, from: string | null, to: string | null): string {
  return `/api/brief?w=${encodeURIComponent(w)}${w === "custom" && from ? `&from=${from}${to ? `&to=${to}` : ""}` : ""}`;
}
