import { useEffect } from "react";

/**
 * useSEO - Sets document title and meta description for each page.
 * Call at the top of every public-facing page component.
 * `robots` (optional) sets the robots meta for this page, e.g. "noindex, nofollow" on a share link, and puts the
 * site's value back when the page unmounts.
 */
export function useSEO({ title, description, robots }: { title: string; description: string; robots?: string }) {
  useEffect(() => {
    // Title
    document.title = title;

    // Meta description
    let meta = document.querySelector<HTMLMetaElement>("meta[name='description']");
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;

    // Open Graph
    setOG("og:title", title);
    setOG("og:description", description);
    setOG("og:url", window.location.href);

    return () => {
      document.title = "VeritaAssure® | Veritas Lab Services";
    };
  }, [title, description]);

  useEffect(() => {
    if (!robots) return;
    let el = document.querySelector<HTMLMetaElement>("meta[name='robots']");
    const before = el?.content ?? null;
    if (!el) {
      el = document.createElement("meta");
      el.name = "robots";
      document.head.appendChild(el);
    }
    el.content = robots;
    return () => {
      if (before == null) el?.remove();
      else if (el) el.content = before;
    };
  }, [robots]);
}

function setOG(property: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property='${property}']`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.content = content;
}
