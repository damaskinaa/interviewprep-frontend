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

type ResearchRow = {
  title: string;
  url: string;
  content: string;
  query: string;
  sourceType: string;
  confidence: number;
};

const TAVILY_TIMEOUT_MS = 8000;
const TAVILY_FALLBACK_RESEARCH = `[NAILIT_EXTERNAL_RESEARCH]
Research skipped: timeout
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

function sourceTypeForUrl(url: string) {
  const host = safeHost(url);

  if (!host) return "Weak or background source";
  if (host.includes("google.com") || host.includes("abc.xyz")) return "Official company source";
  if (host.includes("reddit.com")) return "Reddit directional theme";
  if (host.includes("glassdoor.")) return "Glassdoor directional theme";
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube public theme";
  if (host.includes("linkedin.com")) return "Public prep or candidate experience";
  if (
    host.includes("interviewing.io") ||
    host.includes("levels.fyi") ||
    host.includes("teamblind.com") ||
    host.includes("igotanoffer.com") ||
    host.includes("exponent.com")
  ) return "Public prep or candidate experience";

  return "High signal public source";
}

function sourceConfidence(type: string) {
  if (type === "Official company source") return 5;
  if (type === "High signal public source") return 4;
  if (type.includes("directional") || type.includes("YouTube") || type.includes("candidate")) return 3;
  return 2;
}

function cleanContent(value: string) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 1400);
}

function researchQueries(company: string, role: string) {
  const c = company.trim();
  const r = role.trim();

  return [
    `${c} official careers interview tips hiring process`,
    `${c} official values culture leadership principles`,
    `${c} careers ${r} responsibilities requirements`,
    `${c} ${r} interview process questions experience`,
    `site:glassdoor.com ${c} ${r} interview questions`,
    `site:reddit.com ${c} ${r} interview experience`,
  ];
}

async function tavilySearch(query: string): Promise<ResearchRow[]> {
  const key = process.env.TAVILY_API_KEY;

  if (!key) return [];

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: 3,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
    cache: "no-store",
  });

  if (!response.ok) return [];

  const data = await response.json();
  const rows: ResearchRow[] = [];

  for (const item of data.results || []) {
    const url = item.url || "";
    const title = item.title || "";
    const content = cleanContent(item.content || "");

    if (!url || url === "tavily_answer" || url === "tavily_error") continue;
    if (!content || content.length < 120) continue;

    const sourceType = sourceTypeForUrl(url);

    rows.push({
      title,
      url,
      content,
      query,
      sourceType,
      confidence: sourceConfidence(sourceType),
    });
  }

  return rows;
}

async function buildExternalResearch(company: string, role: string) {
  const started = Date.now();
  const queries = researchQueries(company, role).slice(0, 6);
  const seen = new Set<string>();
  const rows: ResearchRow[] = [];

  const research = Promise.allSettled(queries.map((query) => tavilySearch(query)));
  const results = await Promise.race([
    research,
    new Promise<PromiseSettledResult<ResearchRow[]>[]>((_, reject) =>
      setTimeout(() => reject(new Error("Tavily research timed out")), TAVILY_TIMEOUT_MS)
    ),
  ]);

  for (const result of results) {
    if (result.status !== "fulfilled") continue;

    for (const item of result.value) {
      const key = item.url.split("?")[0].replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
    }
  }

  const sorted = rows
    .sort((a, b) => b.confidence - a.confidence || b.content.length - a.content.length)
    .slice(0, 18);

  const elapsed = Date.now() - started;
  console.log(`[Nailit async] Tavily searches=${queries.length} elapsed=${elapsed}ms fallback_used=false results=${sorted.length}`);

  if (!sorted.length) return "";

  const officialCount = sorted.filter((x) => x.sourceType === "Official company source").length;
  const directionalCount = sorted.filter((x) => x.sourceType.includes("directional") || x.sourceType.includes("YouTube")).length;

  const chunks = sorted.map((item, index) =>
    [
      `SOURCE_INDEX: ${index + 1}`,
      `SOURCE_TYPE: ${item.sourceType}`,
      `SOURCE_CONFIDENCE: ${item.confidence}`,
      `QUERY: ${item.query}`,
      `TITLE: ${item.title}`,
      `URL: ${item.url}`,
      `CONTENT: ${item.content}`,
    ].join("\n")
  );

  return `
[NAILIT_EXTERNAL_RESEARCH]
Bounded research collected by the Vercel async start route before calling Daytona.

Research quality notes:
Tavily searches used: ${queries.length}
Tavily elapsed ms: ${elapsed}
Official source count: ${officialCount}
Directional public theme count: ${directionalCount}
Use official company sources as highest confidence.
Use Reddit, Glassdoor, YouTube, LinkedIn, forums, blogs, and prep sites only as directional public themes.
Do not describe directional public themes as official facts.
Do not invent exact interview rounds unless supported by official or repeated public evidence.
Prefer JD, CV, answer bank, and company context as the targeting core. Research enhances them; it does not replace them.

${chunks.join("\n\n---\n\n").slice(0, 24000)}
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
    console.log(`[Nailit async] Tavily searches=6 elapsed=${elapsed}ms fallback_used=true reason=${message}`);
    return TAVILY_FALLBACK_RESEARCH;
  }
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
    const extraInstructions = String(body.extra || "").trim();

    const userContextBlocks = [
      extraInstructions,
      answerBank
        ? `[CANDIDATE_ANSWER_BANK]\nCandidate's own prepared answers and stories:\n${answerBank}\n[/CANDIDATE_ANSWER_BANK]`
        : "",
      companyDescription
        ? `[ADDITIONAL_COMPANY_CONTEXT]\nAdditional company context from the user:\n${companyDescription}\n[/ADDITIONAL_COMPANY_CONTEXT]`
        : "",
    ].filter(Boolean);

    const externalResearch = await buildExternalResearchWithFallback(
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
