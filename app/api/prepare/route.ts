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

function researchQueries(company: string, role: string) {
  return [
    `${company} official careers interview tips how we hire values`,
    `${company} official company culture values principles hiring process`,
    `${company} ${role} interview process questions experience`,
    `${company} ${role} interview preparation behavioral technical rounds`,
    `${company} ${role} Glassdoor interview questions experience`,
    `site:reddit.com ${company} ${role} interview experience questions`,
    `site:youtube.com ${company} ${role} interview preparation questions`,
  ];
}

async function tavilySearch(query: string) {
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
      max_results: 5,
      search_depth: "advanced",
      include_answer: true,
      include_raw_content: false,
    }),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    return [
      {
        title: `Tavily failed for query: ${query}`,
        url: "tavily_error",
        content: text.slice(0, 500),
      },
    ];
  }

  const data = JSON.parse(text);

  const rows = [];

  if (data.answer) {
    rows.push({
      title: `Search answer: ${query}`,
      url: "tavily_answer",
      content: data.answer,
    });
  }

  for (const item of data.results || []) {
    rows.push({
      title: item.title || "",
      url: item.url || "",
      content: item.content || "",
    });
  }

  return rows;
}

async function buildExternalResearch(company: string, role: string) {
  const seen = new Set<string>();
  const chunks: string[] = [];

  for (const query of researchQueries(company, role)) {
    const results = await tavilySearch(query);

    for (const item of results) {
      const key = `${item.url}|${item.title}`;

      if (seen.has(key)) continue;
      seen.add(key);

      if (!item.content || item.content.length < 80) continue;

      chunks.push(
        [
          `QUERY: ${query}`,
          `TITLE: ${item.title}`,
          `URL: ${item.url}`,
          `CONTENT: ${item.content}`,
        ].join("\n")
      );
    }
  }

  if (!chunks.length) {
    return "";
  }

  return `
[NAILIT_EXTERNAL_RESEARCH]
This research was collected by the Vercel API route before calling Daytona.
Use it as company and interview intelligence.
Treat official company sources as highest confidence.
Treat Reddit, Glassdoor, YouTube, blogs, and forums as directional public candidate experience themes.

${chunks.join("\n\n---\n\n").slice(0, 45000)}
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
