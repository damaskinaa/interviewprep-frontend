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
  | "directional_linkedin"
  | "directional_indeed"
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

const TAVILY_SEARCH_TIMEOUT_MS = 28000;
const TAVILY_EXTRACT_TIMEOUT_MS = 22000;
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
  if (host.includes("linkedin.com")) return "directional_linkedin";
  if (host.includes("indeed.com")) return "directional_indeed";
  if (host.includes("medium.com") || host.includes("substack.com") || host.includes("blog")) return "directional_blog";
  if (companySlug && hostSlug.includes(companySlug)) return "official_company_source";
  if (companySlug === "google" && (host.includes("google.com") || host.includes("abc.xyz"))) return "official_company_source";

  return "directional_prep";
}

function sourcePriority(type: SourceType) {
  switch (type) {
    case "official_company_source": return 100;
    case "directional_glassdoor": return 88;
    case "directional_blind": return 85;
    case "directional_reddit": return 82;
    case "directional_linkedin": return 78;
    case "directional_indeed": return 75;
    case "directional_blog": return 62;
    case "youtube_source": return 55;
    case "directional_prep": return 35;
  }
}

function confidenceForType(type: SourceType): "high" | "medium" | "low" {
  if (type === "official_company_source") return "high";
  if (["directional_glassdoor", "directional_blind", "directional_reddit", "directional_linkedin", "directional_indeed"].includes(type)) return "medium";
  return "low";
}

function importantRoleTokens(role: string) {
  return role
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !["manager", "program", "product", "role"].includes(token));
}

function isRelevantSource(row: SearchResult, company: string, role: string, sourceType: SourceType) {
  const companySlug = normalizeCompany(company);
  const host = safeHost(row.url);
  const sourceText = `${row.title} ${row.snippet} ${row.url}`.toLowerCase();
  const sourceSlug = normalizeCompany(sourceText);
  const roleTokens = importantRoleTokens(role);
  const hasCompanySignal = companySlug && sourceSlug.includes(companySlug);
  const hasRoleSignal = roleTokens.length === 0 || roleTokens.some((token) => sourceText.includes(token));
  const hasInterviewProcessSignal =
    sourceText.includes("interview") ||
    sourceText.includes("hiring") ||
    sourceText.includes("how we hire") ||
    sourceText.includes("recruit");
  const hasValuesSignal =
    sourceText.includes("values") ||
    sourceText.includes("commitments") ||
    sourceText.includes("culture") ||
    sourceText.includes("principles");

  if (sourceType === "official_company_source") {
    return Boolean(hasCompanySignal && (hasRoleSignal || hasInterviewProcessSignal || hasValuesSignal));
  }
  const isDirectionalCommunity =
    sourceType === "directional_glassdoor" ||
    sourceType === "directional_reddit" ||
    sourceType === "directional_blind";

  if (isDirectionalCommunity) return Boolean(hasCompanySignal && (hasRoleSignal || hasInterviewProcessSignal));
  if (sourceType === "directional_linkedin" || sourceType === "directional_indeed")
    return Boolean(hasCompanySignal && (hasRoleSignal || hasInterviewProcessSignal));
  if (sourceType === "youtube_source") return Boolean(hasCompanySignal && (hasRoleSignal || hasInterviewProcessSignal));

  const genericPrepHost =
    host.includes("igotanoffer") ||
    host.includes("exponent") ||
    host.includes("prep") ||
    host.includes("interview") ||
    host.includes("medium.com") ||
    host.includes("substack.com");

  if (genericPrepHost) return Boolean(hasCompanySignal && (hasRoleSignal || hasInterviewProcessSignal));

  return Boolean(hasCompanySignal && (hasRoleSignal || hasInterviewProcessSignal));
}

function researchQueries(company: string, role: string) {
  const c = company.trim();
  const r = role.trim();

  return [
    // ── OFFICIAL SOURCES ──────────────────────────────────────────
    `${c} official interview process how we hire`,
    `${c} careers interview tips what to expect`,
    `${c} values leadership principles culture`,
    `${c} ${r} job description requirements 2025`,
    `${c} how we hire engineering program management`,

    // ── GLASSDOOR — real reported questions ───────────────────────
    `site:glassdoor.com "${c}" "${r}" interview questions`,
    `site:glassdoor.com "${c}" interview experience 2024 2025`,
    `site:glassdoor.com "${c}" behavioral interview questions`,
    `site:glassdoor.com "${c}" hiring manager interview`,
    `site:glassdoor.com "${c}" recruiter screen questions`,

    // ── BLIND — candid insider reports ───────────────────────────
    `site:teamblind.com "${c}" interview process`,
    `site:teamblind.com "${c}" "${r}" interview`,
    `site:blind.app "${c}" interview questions rounds`,

    // ── REDDIT — community experience threads ─────────────────────
    `site:reddit.com "${c}" "${r}" interview questions asked`,
    `site:reddit.com "${c}" interview experience offer 2024 2025`,
    `site:reddit.com "${c}" behavioral interview what they ask`,
    `site:reddit.com "${c}" googliness culture interview questions`,

    // ── LINKEDIN ─────────────────────────────────────────────────
    `site:linkedin.com/interview-questions "${c}" "${r}"`,
    `${c} ${r} interview questions linkedin 2024 2025`,

    // ── INDEED ───────────────────────────────────────────────────
    `site:indeed.com "${c}" "${r}" interview questions`,
    `${c} interview questions indeed candidate experience`,

    // ── ROUND-SPECIFIC QUESTION TARGETING ────────────────────────
    `"${c}" behavioral interview questions STAR method`,
    `"${c}" googliness OR "culture fit" interview questions`,
    `"${c}" hiring manager interview questions program manager`,
    `"${c}" cross functional stakeholder interview questions`,
    `"${c}" technical execution interview questions "${r}"`,

    // ── PREP COMMUNITIES ─────────────────────────────────────────
    `${c} ${r} interview questions igotanoffer OR exponent OR tryexponent`,
    `${c} ${r} interview preparation guide 2024 2025`,
    `${c} ${r} interview tips medium substack`,

    // ── YOUTUBE ──────────────────────────────────────────────────
    `site:youtube.com "${c}" "${r}" interview preparation`,
    `site:youtube.com "${c}" interview questions mock`,
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

function dedupeAndPrioritize(rows: SearchResult[], company: string, role: string) {
  const byUrl = new Map<string, CandidateSource>();

  for (const row of rows) {
    const key = canonicalUrl(row.url);
    if (!key || isLikelySeoSpam(row.url, row.title)) continue;

    const sourceType = sourceTypeForUrl(row.url, company);
    if (!isRelevantSource(row, company, role, sourceType)) continue;
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
    .slice(0, 60);
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

// Pull literal interview questions that candidates actually reported being asked.
// Looks for question-like sentences in Glassdoor, Blind, Reddit, LinkedIn, Indeed content.
function extractReportedQuestions(sources: ExtractedSource[]): string {
  const communityTypes: SourceType[] = [
    "directional_glassdoor",
    "directional_blind",
    "directional_reddit",
    "directional_linkedin",
    "directional_indeed",
  ];
  const questionPattern = /(?:^|\n|•|-|\d+[\).])\s*([A-Z][^.!?\n]{20,180}\?)/gm;
  const seen = new Set<string>();
  const bySource: { sourceType: string; url: string; questions: string[] }[] = [];

  for (const source of sources) {
    if (!communityTypes.includes(source.sourceType)) continue;
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    questionPattern.lastIndex = 0;
    while ((m = questionPattern.exec(source.content)) !== null) {
      const q = m[1].trim();
      const key = q.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      // Skip generic non-interview questions
      if (/salary|compensation|benefits|location|remote|relocation/i.test(q)) continue;
      seen.add(key);
      matches.push(q);
    }
    if (matches.length > 0) {
      bySource.push({ sourceType: source.sourceType, url: source.url, questions: matches.slice(0, 12) });
    }
  }

  if (!bySource.length) return "No literal questions extracted from community sources.";

  return bySource.map((s, i) =>
    `REPORTED_SOURCE_${i + 1}\nTYPE: ${s.sourceType}\nURL: ${s.url}\nQUESTIONS:\n${s.questions.map((q, j) => `  ${j + 1}. ${q}`).join("\n")}`
  ).join("\n\n");
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
  const candidates = dedupeAndPrioritize(discovered, company, role);
  const youtubeSources = candidates.filter((source) => source.sourceType === "youtube_source");
  const extractCandidates = candidates
    .filter((source) => source.sourceType !== "youtube_source")
    .slice(0, 50);
  const extractedMap = await tavilyExtract(extractCandidates.map((source) => source.url));

  const extractedSources: ExtractedSource[] = extractCandidates
    .map((source) => ({
      ...source,
      content: extractedMap.get(canonicalUrl(source.url)) || source.snippet,
    }))
    .filter((source) => source.content && source.content.length >= 120);

  const officialSources = extractedSources.filter((source) => source.sourceType === "official_company_source");
  const directionalSources = extractedSources.filter((source) => source.sourceType !== "official_company_source");
  const reportedQuestionsBlock = extractReportedQuestions(extractedSources);
  const manifestSources = [...candidates];
  const elapsed = Date.now() - started;

  // Count by source type for logging
  const typeCounts = candidates.reduce((acc, s) => {
    acc[s.sourceType] = (acc[s.sourceType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(
    `[Nailit research] searches=${queries.length} discovered=${discovered.length} candidates=${candidates.length} extracted=${extractedSources.length} youtube=${youtubeSources.length} elapsed=${elapsed}ms types=${JSON.stringify(typeCounts)}`
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
Research payload collected by Vercel before Daytona synthesis.
Searches requested: ${queries.length}
Candidate URLs discovered before dedupe: ${discovered.length}
Candidate URLs after dedupe/prioritization: ${candidates.length}
Extracted non-YouTube sources: ${extractedSources.length}
YouTube URLs collected for transcript workflow: ${youtubeSources.length}
Source type breakdown: ${JSON.stringify(typeCounts)}
Elapsed ms: ${elapsed}

Rules for Daytona synthesis:
1. Use official_company_source as high confidence factual evidence only.
2. Use directional_glassdoor, directional_blind, directional_reddit, directional_linkedin, directional_indeed as real candidate-reported signals. These people sat in the interviews. Treat repeated themes as strong evidence.
3. REPORTED_QUESTIONS block contains literal questions candidates reported being asked. These are the seed for the question bank — use them directly, do not replace them with invented questions.
4. Each interview round must be grounded in reported source evidence or official confirmation. Label the confidence level (confirmed / reported pattern / inferred).
5. Never call directional sources official.
6. Never hallucinate rounds or questions not supported by at least one source.
7. If a question appears in multiple community sources it is high-confidence real.

[OFFICIAL_SOURCES]
${officialBlock}
[/OFFICIAL_SOURCES]

[DIRECTIONAL_SOURCES]
${directionalBlock}
[/DIRECTIONAL_SOURCES]

[REPORTED_QUESTIONS]
Literal questions that candidates reported being asked in interviews at ${reportedQuestionsBlock.includes("No literal") ? "this company" : "this company"}.
Use these as the primary seed for the question bank. Do not replace with invented questions.
${reportedQuestionsBlock}
[/REPORTED_QUESTIONS]

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
  const allowOverride = process.env.ALLOW_RESEARCH_TEST_OVERRIDE === "true";

  if (!allowOverride) {
    return false;
  }

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
