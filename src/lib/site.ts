export const SITE_NAME = "CardTrace";
export const SITE_DESCRIPTION =
  "Agent-readable Pokémon and One Piece TCG card catalog with live last-sold price tracking.";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}
