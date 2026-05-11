import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type DaytonaPreviewResponse = {
  url?: string;
  token?: string;
  data?: {
    url?: string;
    token?: string;
  };
};

function getValue(response: DaytonaPreviewResponse, key: "url" | "token") {
  return response[key] || response.data?.[key] || "";
}

function buildPrepareUrl(previewUrl: string) {
  const url = new URL(previewUrl.trim());
  const cleanPath = url.pathname.replace(/\/+$/, "").replace(/\/prepare$/, "");
  url.pathname = `${cleanPath}/prepare`;
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

  const data: DaytonaPreviewResponse = JSON.parse(text);
  const previewUrl = getValue(data, "url");
  const previewToken = getValue(data, "token");

  if (!previewUrl || !previewToken) {
    throw new Error(`Daytona preview response did not include url and token: ${text.slice(0, 500)}`);
  }

  return { previewUrl, previewToken };
}

type ResearchRow = {
  title: string;
  url: string;
  content: string;
  query: string;
  sourceType: string;
  confidence: number;
};

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

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function cleanContent(value: string) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 2500);
}

function researchQueries(company: string, role: string) {
  const c = company.trim();
  const r = role.trim();

  return [
    `${c} official careers interview tips`,
    `${c} official how we hire interview process`,
    `${c} official hiring process interview`,
    `${c} official values culture principles`,
    `${c} careers ${r} responsibilities requirements`,
    `${c} ${r} interview process`,
    `${c} ${r} interview questions`,
    `${c} ${r} interview experience`,
    `${c} ${r} behavioral interview`,
    `${c} ${r} execution interview`,
    `${c} ${r} stakeholder interview`,
    `${c} ${r} leadership interview`,
    `${c} ${r} hiring manager interview`,
    `${c} ${r} recruiter screen`,
    `${c} ${r} cross functional interview`,
    `${c} ${r} role expectations`,
    `${c} program manager execution stakeholder metrics change management`,
    `${c} program manager data driven decisions process improvement`,
    `${c} global network delivery program manager`,
    `${c} network infrastructure program manager`,
    `${c} data center network delivery program manager`,
    `site:reddit.com ${c} ${r} interview experience`,
    `site:reddit.com ${c} program manager interview`,
    `site:glassdoor.com ${c} ${r} interview questions`,
    `site:glassdoor.com ${c} program manager interview`,
    `site:youtube.com ${c} ${r} interview`,
    `site:youtube.com ${c} program manager interview prep`,
    `site:levels.fyi ${c} ${r} interview`,
    `site:teamblind.com ${c} ${r} interview`,
    `site:interviewing.io ${c} ${r} interview`
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
      max_results: 8,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
    }),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    return [];
  }

  const data = JSON.parse(text);
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
  const seen = new Set<string>();
  const rows: ResearchRow[] = [];

  for (const query of researchQueries(company, role)) {
    const results = await tavilySearch(query);

    for (const item of results) {
      const key = item.url.split("?")[0].replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
    }
  }

  const sorted = rows
    .sort((a, b) => b.confidence - a.confidence || b.content.length - a.content.length)
    .slice(0, 70);

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
Research collected by the Vercel API route before calling Daytona.

Research quality notes:
Official source count: ${officialCount}
Directional public theme count: ${directionalCount}
Use official company sources as highest confidence.
Use Reddit, Glassdoor, YouTube, LinkedIn, forums, and prep sites only as directional public themes.
Do not describe directional public themes as official facts.
Do not invent exact interview rounds unless supported by official or repeated public evidence.
Prefer role specific evidence over generic company commentary.

${chunks.join("\n\n---\n\n").slice(0, 65000)}
[/NAILIT_EXTERNAL_RESEARCH]
`.trim();
}


export async function POST(request: Request) {
  try {
    const appApiKey = process.env.APP_API_KEY;

    if (!appApiKey) {
      return NextResponse.json(
        {
          error: "Server is not configured",
          hasAppApiKey: false,
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const externalResearch = await buildExternalResearch(
      body.company_name || "",
      body.role_name || ""
    );

    const enrichedBody = {
      ...body,
      extra: externalResearch
        ? `${body.extra || ""}\n\n${externalResearch}`
        : body.extra || "",
    };

    const { previewUrl, previewToken } = await getDaytonaPreview();
    const targetUrl = buildPrepareUrl(previewUrl);

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
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Backend returned an error",
          status: response.status,
          body: text.slice(0, 2000),
        },
        { status: response.status }
      );
    }

    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        {
          error: "Backend returned non JSON response",
          status: response.status,
          body: text.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    return NextResponse.json(JSON.parse(text));
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Frontend API route crashed",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
