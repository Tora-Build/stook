// The browser tab's title for a page; the site's name follows the page's own.
import { useEffect } from "react";

export function Title({ text }: { text: string }) {
  useEffect(() => { document.title = text ? `${text} — Stook Street` : "Stook Street — where will it land?"; }, [text]);
  return null;
}
