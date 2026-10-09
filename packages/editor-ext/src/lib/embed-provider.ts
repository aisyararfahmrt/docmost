export interface IEmbedProvider {
  id: string;
  name: string;
  regex: RegExp;
  getEmbedUrl: (match: RegExpMatchArray, url?: string) => string;
}

export const embedProviders: IEmbedProvider[] = [
  {
    id: "loom",
    name: "Loom",
    regex: /^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([\da-zA-Z]+)\/?/,
    getEmbedUrl: (match, url) => {
      if (url.includes("/embed/")) {
        return url;
      }
      return `https://loom.com/embed/${match[1]}`;
    },
  },
  {
    id: "airtable",
    name: "Airtable",
    regex: /^https:\/\/(www.)?airtable.com\/([a-zA-Z0-9]{2,})\/.*/,
    getEmbedUrl: (match, url: string) => {
      const path = url.split("airtable.com/");
      if (url.includes("/embed/")) {
        return url;
      }
      return `https://airtable.com/embed/${path[1]}`;
    },
  },
  {
    id: "figma",
    name: "Figma",
    regex:
      /^https:\/\/(?:[\w\.-]+\.)?figma\.com\/(?:(file|proto|board|design|slides|deck)\/([0-9a-zA-Z]{22,128})|embed\?.*url=.+|(?:design|board|proto|slides|deck)\/[0-9a-zA-Z]{22,128})/,
    getEmbedUrl: (match, url: string) => {
      // Unwrap old Kit 1 embed URLs (www.figma.com/embed?url=...) to the
      // original file URL first.
      let sourceUrl = url;
      try {
        const parsed = new URL(url);
        const nested = parsed.searchParams.get("url");
        if (parsed.pathname.includes("/embed") && nested) {
          sourceUrl = nested;
        }
      } catch {
        sourceUrl = url;
      }

      try {
        const parsed = new URL(sourceUrl);
        // Support both www.figma.com and embed.figma.com hosts.
        const parts = parsed.pathname.split("/").filter(Boolean);
        const rawType = (parts[0] || "design").toLowerCase();
        const fileKey = parts[1] || "";
        // Kit 1 used `file`, Kit 2 uses `design`.
        const type =
          rawType === "file"
            ? "design"
            : ["design", "board", "proto", "slides", "deck"].includes(rawType)
              ? rawType
              : "design";

        const params = new URLSearchParams();
        params.set("embed-host", "docmost");
        // Browser-like: no footer link, but pages + zoom/pan stay on.
        params.set("footer", "false");
        params.set("page-selector", "true");
        params.set("viewport-controls", "true");
        const nodeId =
          parsed.searchParams.get("node-id") ||
          parsed.searchParams.get("node_id");
        if (nodeId) params.set("node-id", nodeId);

        if (fileKey) {
          return `https://embed.figma.com/${type}/${fileKey}?${params.toString()}`;
        }
      } catch {
        // Fall through to safe fallback below.
      }

      const encodedSourceUrl = encodeURIComponent(sourceUrl);
      return `https://www.figma.com/embed?embed_host=docmost&url=${encodedSourceUrl}`;
    },
  },
  {
    id: "typeform",
    name: "Typeform",
    regex: /^(https?:)?(\/\/)?[\w\.]+\.typeform\.com\/to\/.+/,
    getEmbedUrl: (match, url: string) => {
      return url;
    },
  },
  {
    id: "miro",
    name: "Miro",
    regex: /^https:\/\/(www\.)?miro\.com\/app\/board\/([\w-]+=)/,
    getEmbedUrl: (match, url) => {
      if (url.includes("/live-embed/")) {
        return url;
      }
      return `https://miro.com/app/live-embed/${match[2]}?embedMode=view_only_without_ui&autoplay=true&embedSource=docmost`;
    },
  },
  {
    id: "youtube",
    name: "YouTube",
    regex:
      /^((?:https?:)?\/\/)?((?:www|m|music)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/,
    getEmbedUrl: (match, url) => {
      if (url.includes("/embed/")) {
        return url;
      }
      return `https://www.youtube-nocookie.com/embed/${match[5]}`;
    },
  },
  {
    id: "vimeo",
    name: "Vimeo",
    regex:
      /^(https:)?\/\/(?:www\.|player\.)?vimeo.com\/(?:channels\/(?:\w+\/)?|groups\/([^/]*)\/videos\/|album\/(\d+)\/video\/|video\/|)(\d+)/,
    getEmbedUrl: (match) => {
      return `https://player.vimeo.com/video/${match[4]}`;
    },
  },
  {
    id: "framer",
    name: "Framer",
    regex: /^https:\/\/(www\.)?framer\.com\/embed\/([\w-]+)/,
    getEmbedUrl: (match, url: string) => {
      return url;
    },
  },
  {
    id: "gdrive",
    name: "Google Drive",
    regex:
      /^((?:https?:)?\/\/)?((?:www|m)\.)?(drive\.google\.com)\/file\/d\/([a-zA-Z0-9_-]+)\/.*$/,
    getEmbedUrl: (match) => {
      return `https://drive.google.com/file/d/${match[4]}/preview`;
    },
  },
  {
    id: "gsheets",
    name: "Google Sheets",
    regex:
      /^((?:https?:)?\/\/)?((?:www|m)\.)?(docs\.google\.com)\/spreadsheets\/d\/([a-zA-Z0-9_-]+)\/.*$/,
    getEmbedUrl: (match, url: string) => {
      return url;
    },
  },
  {
    id: "iframe",
    name: "Iframe",
    regex: /any-iframe/,
    getEmbedUrl: (match, url) => {
      return url;
    },
  },
];

/**
 * Reduce a Figma URL to its minimal canonical form for storage, so the
 * original slug and extra query params (potentially private) are never
 * persisted or rendered. Only type + file key (+ node-id) are kept.
 */
export function normalizeFigmaSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const nested = parsed.searchParams.get("url");
    const source = parsed.pathname.includes("/embed") && nested ? nested : url;
    const p = new URL(source);
    const parts = p.pathname.split("/").filter(Boolean);
    const rawType = (parts[0] || "design").toLowerCase();
    const fileKey = parts[1] || "";
    const type =
      rawType === "file"
        ? "design"
        : ["design", "board", "proto", "slides", "deck"].includes(rawType)
          ? rawType
          : "design";
    if (!fileKey) return url;
    const nodeId =
      p.searchParams.get("node-id") || p.searchParams.get("node_id");
    return (
      `https://www.figma.com/${type}/${fileKey}` +
      (nodeId ? `?node-id=${encodeURIComponent(nodeId)}` : "")
    );
  } catch {
    return url;
  }
}

export function getEmbedProviderById(id: string) {
  return embedProviders.find(
    (provider) => provider.id.toLowerCase() === id.toLowerCase(),
  );
}

export interface IEmbedResult {
  embedUrl: string;
  provider: string;
}

export function getEmbedUrlAndProvider(url: string): IEmbedResult {
  for (const provider of embedProviders) {
    const match = url.match(provider.regex);
    if (match) {
      return {
        embedUrl: provider.getEmbedUrl(match, url),
        provider: provider.name.toLowerCase(),
      };
    }
  }
  return {
    embedUrl: url,
    provider: "iframe",
  };
}
