import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type DaytonaPreviewResponse = {
  url?: string;
  token?: string;
  data?: {
    url?: string;
    token?: string;
  };
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  query: string;
};

type SourceType =
  | "official_company_source"
  | "directional_glassdoor"
  | "directional_reddit"
  | "directional_blind"
  | "directional_blog"
  | "directional_prep"
  | "youtube_source";

type CandidateSource = SearchResult & {
  sourceType: SourceType;
  priority: number;
  confidence: "high" | "medium" | "low";
  host: string;
};

type ExtractedSource = CandidateSource & {
  content: string;
};

const TAVILY_SEARCH_TIMEOUT_MS = 15000;
const TAVILY_EXTRACT_TIMEOUT_MS = 15000;
const TAVILY_FALLBACK_RESEARCH = `[NAILIT_EXTERNAL_RESEARCH]
Research skipped: timeout

[OFFICIAL_SOURCES]
No official sources extracted. Use JD, CV, answer bank, and company context only.
[/OFFICIAL_SOURCES]

[DIRECTIONAL_SOURCES]
No directional sources extracted. Do not infer public interview process claims.
[/DIRECTIONAL_SOURCES]

[YOUTUBE_SOURCES]
No YouTube sources collected.
[/YOUTUBE_SOURCES]

[SOURCE_MANIFEST]
Research skipped: timeout
[/SOURCE_MANIFEST]
[/NAILIT_EXTERNAL_RESEARCH]`;

function getValue(response: DaytonaPreviewResponse, key: "url" | "token") {
  return response[key] || response.data?.[key] || "";
}

function buildDaytonaUrl(previewUrl: string, endpoint: string) {
  const url = new URL(previewUrl.trim());
  const cleanPath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${cleanPath}${endpoint}`;
  return url.toString();
}

async function getDaytonaPreview() {
  const apiKey = process.env.DAYTONA_API_KEY;
  const sandboxId = process.env.DAYTONA_SANDBOX_ID;
  const port = process.env.DAYTONA_PORT || "8000";

  if (!apiKey || !sandboxId || !port) {
    throw new Error("Daytona environment variables are missing.");
  }

  const response = await fetch(
    `https://app.daytona.io/api/sandbox/${sandboxId}/ports/${port}/preview-url`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Daytona preview lookup failed: ${response.status} ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text) as DaytonaPreviewResponse;
  const previewUrl = getValue(data, "url");
  const previewToken = getValue(data, "token");

  if (!previewUrl || !previewToken) {
    throw new Error(`Daytona preview response did not include url and token: ${text.slice(0, 500)}`);
  }

  return { previewUrl, previewToken };
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeCompany(value: string) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanContent(value: string, maxLength = 4000) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isLikelySeoSpam(url: string, title: string) {
  const host = safeHost(url);
  const text = `${host} ${title}`.toLowerCase();
  const spamTerms = [
    "coupon",
    "promo",
    "salary.com",
    "ziprecruiter",
    "jooble",
    "jobrapido",
    "simplyhired",
    "template",
    "resume example",
    "cover letter",
  ];
  return spamTerms.some((term) => text.includes(term));
}

function sourceTypeForUrl(url: string, company: string): SourceType {
  const host = safeHost(url);
  const companySlug = normalizeCompany(company);
  const hostSlug = normalizeCompany(host);

  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube_source";
  if (host.includes("glassdoor.")) return "directional_glassdoor";
  if (host.includes("reddit.com")) return "directional_reddit";
  if (host.includes("blind.app") || host.includes("teamblind.com")) return "directional_blind";
  if (host.includes("medium.com") || host.includes("substack.com") || host.includes("blog")) return "directional_blog";
  if (companySlug && hostSlug.includes(companySlug)) return "official_company_source";
  if (companySlug === "google" && (host.includes("google.com") || host.includes("abc.xyz"))) return "official_company_source";

  return "directional_prep";
}

function sourcePriority(type: SourceType) {
  switch (type) {
    case "official_company_source": return 100;
    case "directional_glassdoor": return 85;
    case "directional_reddit": return 82;
    case "directional_blind": return 80;
    case "directional_blog": return 62;
    case "youtube_source": return 55;
    case "directional_prep": return 35;
  }
}

function confidenceForType(type: SourceType): "high" | "medium" | "low" {
  if (type === "official_company_source") return "high";
  if (["directional_glassdoor", "directional_reddit", "directional_blind"].includes(type)) return "medium";
  return "low";
}

function researchQueries(company: string, role: string) {
  const c = company.trim();
  const r = role.trim();

  return [
    `${c} official interview process`,
    `${c} ${r} interview questions site:glassdoor.com`,
    `${c} interview experience site:reddit.com`,
    `${c} values leadership principles`,
    `${c} careers how we hire`,
    `${r} ${c} interview rounds behavioral questions`,
    `${c} interview site:blind.app`,
    `${c} ${r} interview tips site:medium.com`,
    `${c} ${r} interview questions preparation 2024 2025`,
    `${c} ${r} offer process timeline`,
    `${c} engineering blog culture values`,
    `${c} ${r} interview experience candidate`,
  ];
}

async function tavilySearch(query: string, company: string): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: 8,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
      }),
      cache: "no-store",
    });

    if (!response.ok) return [];

    const data = await response.json();
    const rows: SearchResult[] = [];

    for (const item of data.results || []) {
      const url = String(item.url || "").trim();
      const title = cleanContent(String(item.title || ""), 240);
      const snippet = cleanContent(String(item.content || ""), 900);

      if (!url || url === "tavily_answer" || url === "tavily_error") continue;
      if (isLikelySeoSpam(url, title)) continue;
      if (!safeHost(url)) continue;

      rows.push({ title, url, snippet, query });
    }

    return rows;
  } catch (err) {
    console.log(`[Nailit research] search skipped query="${query}" reason=${err instanceof Error ? err.message : "unknown"}`);
    return [];
  }
}

function canonicalUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.split("?")[0].replace(/\/$/, "").toLowerCase();
  }
}

function dedupeAndPrioritize(rows: SearchResult[], company: string) {
  const byUrl = new Map<string, CandidateSource>();

  for (const row of rows) {
    const key = canonicalUrl(row.url);
    if (!key || isLikelySeoSpam(row.url, row.title)) continue;

    const sourceType = sourceTypeForUrl(row.url, company);
    const host = safeHost(row.url);
    const candidate: CandidateSource = {
      ...row,
      url: row.url,
      sourceType,
      priority: sourcePriority(sourceType) + Math.min(row.snippet.length / 300, 6),
      confidence: confidenceForType(sourceType),
      host,
    };

    const existing = byUrl.get(key);
    if (!existing || candidate.priority > existing.priority) {
      byUrl.set(key, candidate);
    }
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.priority - a.priority || b.snippet.length - a.snippet.length)
    .slice(0, 30);
}

async function tavilyExtract(urls: string[]) {
  const key = process.env.TAVILY_API_KEY;
  if (!key || !urls.length) return new Map<string, string>();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TAVILY_EXTRACT_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls,
        extract_depth: "basic",
        format: "text",
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) return new Map();

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    const extracted = new Map<string, string>();

    for (const item of results) {
      const url = String(item.url || "").trim();
      const content = cleanContent(String(item.raw_content || item.content || item.markdown || ""), 5000);
      if (url && content.length >= 120) {
        extracted.set(canonicalUrl(url), content);
      }
    }

    return extracted;
  } catch (err) {
    console.log(`[Nailit research] extract skipped reason=${err instanceof Error ? err.message : "unknown"}`);
    return new Map<string, string>();
  } finally {
    clearTimeout(timeout);
  }
}

function sourceBlock(source: ExtractedSource, index: number) {
  return [
    `SOURCE_INDEX: ${index}`,
    `SOURCE_TYPE: ${source.sourceType}`,
    `SOURCE_CONFIDENCE: ${source.confidence}`,
    `QUERY: ${source.query}`,
    `TITLE: ${source.title}`,
    `URL: ${source.url}`,
    `CONTENT: ${source.content}`,
  ].join("\n");
}

async function buildExternalResearch(company: string, role: string) {
  const started = Date.now();
  const queries = researchQueries(company, role);
  const searchBatch = Promise.all(queries.map((query) => tavilySearch(query, company)));
  const settled = await Promise.race([
    searchBatch,
    new Promise<SearchResult[][]>((resolve) => setTimeout(() => resolve([]), TAVILY_SEARCH_TIMEOUT_MS)),
  ]);

  const discovered = settled.flat();
  const candidates = dedupeAndPrioritize(discovered, company);
  const youtubeSources = candidates.filter((source) => source.sourceType === "youtube_source");
  const extractCandidates = candidates
    .filter((source) => source.sourceType !== "youtube_source")
    .slice(0, 25);
  const extractedMap = await tavilyExtract(extractCandidates.map((source) => source.url));

  const extractedSources: ExtractedSource[] = extractCandidates
    .map((source) => ({
      ...source,
      content: extractedMap.get(canonicalUrl(source.url)) || source.snippet,
    }))
    .filter((source) => source.content && source.content.length >= 120);

  const officialSources = extractedSources.filter((source) => source.sourceType === "official_company_source");
  const directionalSources = extractedSources.filter((source) => source.sourceType !== "official_company_source");
  const manifestSources = [...candidates];
  const elapsed = Date.now() - started;

  console.log(
    `[Nailit research] searches=${queries.length} discovered=${discovered.length} candidates=${candidates.length} extracted=${extractedSources.length} youtube=${youtubeSources.length} elapsed=${elapsed}ms`
  );

  if (!extractedSources.length && !youtubeSources.length) return "";

  const officialBlock = officialSources.length
    ? officialSources.map((source, index) => sourceBlock(source, index + 1)).join("\n\n---\n\n")
    : "No official sources extracted. Use JD, CV, answer bank, and company context only for factual claims.";

  const directionalBlock = directionalSources.length
    ? directionalSources.map((source, index) => sourceBlock(source, index + 1)).join("\n\n---\n\n")
    : "No directional sources extracted. Do not infer public interview process claims.";

  const youtubeBlock = youtubeSources.length
    ? youtubeSources.map((source, index) => [
        `YOUTUBE_INDEX: ${index + 1}`,
        `TITLE: ${source.title}`,
        `URL: ${source.url}`,
        `QUERY: ${source.query}`,
        `CONFIDENCE: low`,
      ].join("\n")).join("\n\n---\n\n")
    : "No YouTube sources collected.";

  const manifestBlock = manifestSources.map((source, index) => [
    `${index + 1}. ${source.title}`,
    `URL: ${source.url}`,
    `TYPE: ${source.sourceType}`,
    `CONFIDENCE: ${source.confidence}`,
    `QUERY: ${source.query}`,
  ].join("\n")).join("\n\n");

  return `
[NAILIT_EXTERNAL_RESEARCH]
Research Lab 50 percent capacity payload collected by Vercel before Daytona synthesis.
Searches requested: ${queries.length}
Candidate URLs discovered before dedupe: ${discovered.length}
Candidate URLs after dedupe/prioritization: ${candidates.length}
Extracted non-YouTube sources: ${extractedSources.length}
YouTube URLs collected for transcript workflow: ${youtubeSources.length}
Elapsed ms: ${elapsed}

Rules for Daytona synthesis:
Use official_company_source as high confidence factual evidence.
Use directional_glassdoor, directional_reddit, directional_blind, directional_blog, and directional_prep only as directional public themes.
Use youtube_source URLs only as leads unless the user supplied transcript text.
Never call directional sources official.
Never state exact interview rounds as fact unless official sources confirm them.

[OFFICIAL_SOURCES]
${officialBlock}
[/OFFICIAL_SOURCES]

[DIRECTIONAL_SOURCES]
${directionalBlock}
[/DIRECTIONAL_SOURCES]

[YOUTUBE_SOURCES]
${youtubeBlock}
[/YOUTUBE_SOURCES]

[SOURCE_MANIFEST]
${manifestBlock || "No sources collected."}
[/SOURCE_MANIFEST]
[/NAILIT_EXTERNAL_RESEARCH]
`.trim();
}

async function buildExternalResearchWithFallback(company: string, role: string) {
  const started = Date.now();

  try {
    const research = await buildExternalResearch(company, role);
    return research || TAVILY_FALLBACK_RESEARCH;
  } catch (err: unknown) {
    const elapsed = Date.now() - started;
    const message = err instanceof Error ? err.message : "Unknown Tavily error";
    console.log(`[Nailit async] Tavily searches=12 elapsed=${elapsed}ms fallback_used=true reason=${message}`);
    return TAVILY_FALLBACK_RESEARCH;
  }
}

function shouldForceTavilyTimeout(body: Record<string, unknown>) {
  return body.research_lab_force_tavily_timeout === true;
}

function forcedTavilyTimeoutFallback() {
  console.log("[Nailit async] Tavily searches=12 elapsed=0ms fallback_used=true reason=forced_research_lab_timeout_test");
  return TAVILY_FALLBACK_RESEARCH;
}

export async function POST(request: Request) {
  try {
    const appApiKey = process.env.APP_API_KEY;

    if (!appApiKey) {
      return NextResponse.json({ error: "Server is not configured" }, { status: 500 });
    }

    const body = await request.json();
    const answerBank = String(body.answer_bank || "").trim();
    const companyDescription = String(body.company_description || "").trim();
    const youtubeTranscripts = String(body.youtube_transcripts || "").trim();
    const extraInstructions = String(body.extra || "").trim();

    const userContextBlocks = [
      extraInstructions,
      answerBank
        ? `[CANDIDATE_ANSWER_BANK]\nCandidate's own prepared answers and stories:\n${answerBank}\n[/CANDIDATE_ANSWER_BANK]`
        : "",
      companyDescription
        ? `[ADDITIONAL_COMPANY_CONTEXT]\nAdditional company context from the user:\n${companyDescription}\n[/ADDITIONAL_COMPANY_CONTEXT]`
        : "",
      youtubeTranscripts
        ? `[YOUTUBE_TRANSCRIPTS]\n${youtubeTranscripts}\n[/YOUTUBE_TRANSCRIPTS]`
        : "",
    ].filter(Boolean);

    const externalResearch = shouldForceTavilyTimeout(body)
      ? forcedTavilyTimeoutFallback()
      : await buildExternalResearchWithFallback(
          body.company_name || "",
          body.role_name || ""
        );

    const enrichedBody = {
      ...body,
      extra: `${userContextBlocks.join("\n\n")}\n\n${externalResearch}`.trim(),
    };

    const { previewUrl, previewToken } = await getDaytonaPreview();
    const targetUrl = buildDaytonaUrl(previewUrl, "/prepare/start");

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Key": appApiKey,
        "x-daytona-preview-token": previewToken,
        "X-Daytona-Skip-Preview-Warning": "true",
      },
      body: JSON.stringify(enrichedBody),
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: "Backend returned an error", status: response.status, body: text.slice(0, 2000) },
        { status: response.status }
      );
    }

    return NextResponse.json(JSON.parse(text));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Prepare start route crashed", message }, { status: 500 });
  }
}
