import { useEffect } from "react";

/**
 * useSEO - Sets document title and meta description for each page.
 * Call at the top of every public-facing page component.
 */
export function useSEO({ title, description }: { title: string; description: string }) {
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
      document.title = "Veritas Lab Services";
    };
  }, [title, description]);
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
