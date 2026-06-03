"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type SessionMeta = {
  session_id: string;
  company_name: string;
  role_name: string;
  created_at?: string;
};

type ModuleName =
  | "company_intelligence"
  | "role_intelligence"
  | "candidate_profile"
  | "gap_map"
  | "interview_strategy"
  | "prep_pack";

type ModuleState = {
  jobId: string;
  status: string;
  stage: string;
  progress: number;
  result?: unknown;
  markdown?: string;
  error?: string;
};

type AnswerOption = {
  label: string;
  full_answer: string;
  why_it_wins: string;
  metric_used: string;
  tradeoff_shown: string;
  delivery_notes: string;
};

type QuestionAnswerState = {
  status: "idle" | "loading" | "done" | "failed";
  answers: AnswerOption[];
  selectedAnswer?: AnswerOption;
  error?: string;
};

type QuestionContext = {
  question: string;
  round_name: string;
  assigned_story_id: string;
  assigned_story_title: string;
};

type UploadState = {
  fileName: string;
  characters: number;
  warning?: string;
};

const MODULES: {
  name: ModuleName;
  title: string;
  description: string;
  button: string;
  dependsOn?: ModuleName[];
}[] = [
  {
    name: "company_intelligence",
    title: "Company Intelligence",
    description: "Researches the company, interview process, role signals, and directional public themes.",
    button: "Run Research",
  },
  {
    name: "role_intelligence",
    title: "Role Intelligence",
    description: "Analyzes the JD to extract what you must prove, hidden expectations, danger zones, and question seeds.",
    button: "Analyze JD",
  },
  {
    name: "candidate_profile",
    title: "Candidate Profile",
    description: "Maps your CV and prepared stories to the role requirements using raw documents from the session.",
    button: "Build Profile",
    dependsOn: ["role_intelligence"],
  },
  {
    name: "gap_map",
    title: "Gap Map",
    description: "Finds dangerous gaps and writes repair scripts you can actually say in the interview.",
    button: "Map Gaps",
    dependsOn: ["candidate_profile", "company_intelligence"],
  },
  {
    name: "interview_strategy",
    title: "Interview Strategy",
    description: "Generates the executive win strategy, round plan, full answers, pressure scripts, and seven day plan.",
    button: "Generate Strategy",
    dependsOn: ["gap_map"],
  },
  {
    name: "prep_pack",
    title: "Prep Pack",
    description: "Assembles every completed artifact into the final readable prep document. No new AI calls.",
    button: "Generate Pack",
    dependsOn: ["company_intelligence", "role_intelligence", "candidate_profile", "gap_map", "interview_strategy"],
  },
];

const emptyModules = MODULES.reduce((acc, item) => {
  acc[item.name] = { jobId: "", status: "idle", stage: "Not started", progress: 0 };
  return acc;
}, {} as Record<ModuleName, ModuleState>);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value: string) {
  return value.replace(/\r/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{4,}/g, "\n\n\n").trim();
}

function readableJson(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function splitMarkdown(markdown: string) {
  const parts = markdown.split(/\n(?=## )/g).filter(Boolean);
  return parts.length ? parts : [markdown];
}

function normalizeQuestion(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function questionId(question: string, roundName: string) {
  return `q_${hashText(`${roundName}::${question}`)}`;
}

function selectedAnswerStorageKey(sessionId: string, id: string) {
  return `nailit_selected_answer:${sessionId}:${id}`;
}

function isQuestionBankSection(section: string) {
  const title = section.split("\n")[0]?.toLowerCase() || "";
  return title.includes("question bank") || title.includes("questions and answers by round");
}

function parseQuestionBlocks(section: string) {
  const matches = [...section.matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*/gm)];
  if (!matches.length) return { intro: section, questions: [] as { block: string; question: string; round_name: string }[] };
  const intro = section.slice(0, matches[0].index).trim();
  const questions = matches.map((match, index) => {
    const start = match.index || 0;
    const end = matches[index + 1]?.index ?? section.length;
    const block = section.slice(start, end).trim();
    const round = block.match(/^\s*-\s*Round:\s*(.+)$/m)?.[1]?.trim() || "";
    return {
      block,
      question: match[2].trim(),
      round_name: round,
    };
  });
  return { intro, questions };
}

function strategyQuestionContexts(result: unknown) {
  const data = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const rows = [
    ...(Array.isArray(data.top_10_likely_questions) ? data.top_10_likely_questions : []),
    ...(Array.isArray(data.top_10_dangerous_questions) ? data.top_10_dangerous_questions : []),
    ...(Array.isArray(data.questions_by_round)
      ? data.questions_by_round.flatMap((round) => {
          if (!round || typeof round !== "object") return [];
          const roundData = round as Record<string, unknown>;
          const roundName = String(roundData.round_name || roundData.round || "");
          const questions = Array.isArray(roundData.questions) ? roundData.questions : [];
          return questions.map((question) => ({ ...(question as Record<string, unknown>), round: roundName }));
        })
      : []),
  ];
  return rows.reduce((acc, row) => {
    if (!row || typeof row !== "object") return acc;
    const item = row as Record<string, unknown>;
    const question = String(item.question || "");
    if (!question) return acc;
    acc[normalizeQuestion(question)] = {
      question,
      round_name: String(item.round || item.round_name || ""),
      assigned_story_id: String(item.assigned_story_id || ""),
      assigned_story_title: String(item.assigned_story_title || item.assigned_story || ""),
    };
    return acc;
  }, {} as Record<string, QuestionContext>);
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#f5f0e8]">{label}</span>
      {description && <span className="mt-1 block text-xs leading-5 text-[#f5f0e8]/48">{description}</span>}
      <div className="mt-3 space-y-3">{children}</div>
    </label>
  );
}

function FileUpload({
  label,
  upload,
  busy,
  onFile,
}: {
  label: string;
  upload: UploadState | null;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#f5f0e8]/70">{busy ? "Reading file..." : label}</p>
          {upload && (
            <p className="mt-1 text-xs text-[#f5f0e8]/42">
              {upload.fileName} · {upload.characters.toLocaleString()} characters
            </p>
          )}
        </div>
        <input
          type="file"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.currentTarget.value = "";
          }}
          className="text-xs text-[#f5f0e8]/50 file:mr-3 file:rounded-lg file:border-0 file:bg-[#c9a96e] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#0a0a0a]"
        />
      </div>
      {upload?.warning && <p className="mt-2 text-xs text-[#c9a96e]">{upload.warning}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
      : status === "running" || status === "queued"
        ? "border-[#c9a96e]/30 bg-[#c9a96e]/10 text-[#f2dfb8]"
        : status === "failed"
          ? "border-red-400/25 bg-red-500/10 text-red-100"
          : "border-[#2a2a2a] bg-[#0a0a0a] text-[#f5f0e8]/45";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tone}`}>{status}</span>;
}

export default function Home() {
  const [screen, setScreen] = useState<"setup" | "dashboard">("setup");
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [companyName, setCompanyName] = useState("Google");
  const [roleName, setRoleName] = useState("Program Manager");
  const [jobDescription, setJobDescription] = useState("");
  const [cv, setCv] = useState("");
  const [answerBank, setAnswerBank] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [youtubeTranscripts, setYoutubeTranscripts] = useState("");
  const [uploads, setUploads] = useState<Record<string, UploadState | null>>({});
  const [extracting, setExtracting] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [modules, setModules] = useState<Record<ModuleName, ModuleState>>(emptyModules);
  const [activeModule, setActiveModule] = useState<ModuleName | "prep_pack" | "">("");
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, QuestionAnswerState>>({});

  useEffect(() => {
    const saved = localStorage.getItem("nailit_session");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SessionMeta;
        if (parsed.session_id) {
          setSession(parsed);
          setCompanyName(parsed.company_name || "");
          setRoleName(parsed.role_name || "");
          setScreen("dashboard");
        }
      } catch {
        localStorage.removeItem("nailit_session");
      }
    }
  }, []);

  useEffect(() => {
    if (!session?.session_id) return;
    const prefix = `nailit_selected_answer:${session.session_id}:`;
    const restored: Record<string, QuestionAnswerState> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const selectedAnswer = JSON.parse(localStorage.getItem(key) || "") as AnswerOption;
        const id = key.slice(prefix.length);
        restored[id] = { status: "idle", answers: [], selectedAnswer };
      } catch {
        localStorage.removeItem(key);
      }
    }
    setAnswersByQuestion(restored);
  }, [session?.session_id]);

  const canSave = companyName.trim() && roleName.trim() && jobDescription.trim() && cv.trim();
  const completed = useMemo(() => {
    return MODULES.reduce((acc, item) => {
      acc[item.name] = modules[item.name]?.status === "done";
      return acc;
    }, {} as Record<ModuleName, boolean>);
  }, [modules]);

  async function extractIntoTextarea(file: File, key: string, currentText: string, setText: (value: string) => void) {
    setError("");
    setExtracting(key);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || "Could not extract file.");
      const nextText = `${currentText.trim()}\n\n[Uploaded file: ${data.fileName}]\n${data.text}`.trim();
      setText(nextText);
      setUploads((current) => ({
        ...current,
        [key]: { fileName: data.fileName, characters: data.characters, warning: data.warning || "" },
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not extract file.");
    } finally {
      setExtracting("");
    }
  }

  async function createSession() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          role_name: roleName,
          job_description: jobDescription,
          cv,
          answer_bank: answerBank,
          company_description: companyContext,
          youtube_transcripts: youtubeTranscripts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.body || data?.message || data?.error || "Could not create session.");
      const nextSession: SessionMeta = {
        session_id: data.session_id,
        company_name: data.company_name || companyName,
        role_name: data.role_name || roleName,
        created_at: data.created_at,
      };
      setSession(nextSession);
      localStorage.setItem("nailit_session", JSON.stringify(nextSession));
      setModules(emptyModules);
      setScreen("dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create session.");
    } finally {
      setSaving(false);
    }
  }

  async function pollModule(moduleName: ModuleName, jobId: string) {
    for (;;) {
      await wait(3000);
      const res = await fetch(`/api/module/status?job_id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.body || data?.message || data?.error || "Could not read module status.");
      setModules((current) => ({
        ...current,
        [moduleName]: {
          ...current[moduleName],
          jobId,
          status: data.status || "running",
          stage: data.stage || "Working",
          progress: Number(data.progress || 0),
          result: data.product_json,
          markdown: data.markdown || "",
          error: data.error || "",
        },
      }));
      if (data.status === "done") return;
      if (data.status === "failed") throw new Error(data.error || `${moduleName} failed.`);
    }
  }

  async function runModule(moduleName: ModuleName) {
    if (!session) return;
    setError("");
    setModules((current) => ({
      ...current,
      [moduleName]: { ...current[moduleName], status: "queued", stage: "Starting", progress: 1, error: "" },
    }));
    try {
      const res = await fetch("/api/module/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.session_id, module_name: moduleName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.body || data?.message || data?.error || "Could not start module.");
      setModules((current) => ({
        ...current,
        [moduleName]: {
          ...current[moduleName],
          jobId: data.job_id,
          status: data.status || "queued",
          stage: data.stage || "Job created",
          progress: Number(data.progress || 0),
        },
      }));
      await pollModule(moduleName, data.job_id);
      setActiveModule(moduleName);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : `${moduleName} failed.`;
      setError(message);
      setModules((current) => ({
        ...current,
        [moduleName]: { ...current[moduleName], status: "failed", stage: "Failed", progress: 100, error: message },
      }));
    }
  }

  function moduleLocked(item: (typeof MODULES)[number]) {
    if (!session) return true;
    return Boolean(item.dependsOn?.some((dependency) => !completed[dependency]));
  }

  function resetSession() {
    localStorage.removeItem("nailit_session");
    setSession(null);
    setModules(emptyModules);
    setActiveModule("");
    setAnswersByQuestion({});
    setScreen("setup");
  }

  const activeState = activeModule ? modules[activeModule] : null;
  const markdownSections = activeState?.markdown ? splitMarkdown(activeState.markdown) : [];
  const questionContexts = useMemo(() => strategyQuestionContexts(modules.interview_strategy.result), [modules.interview_strategy.result]);

  async function generateAnswersForQuestion(context: QuestionContext) {
    if (!session) return;
    const id = questionId(context.question, context.round_name);
    setError("");
    setAnswersByQuestion((current) => ({
      ...current,
      [id]: { ...(current[id] || { answers: [] }), status: "loading", error: "" },
    }));
    try {
      const res = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: session.session_id,
          question: context.question,
          round_name: context.round_name,
          assigned_story_id: context.assigned_story_id,
          assigned_story_title: context.assigned_story_title,
          company_name: session.company_name,
          role_name: session.role_name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.body || data?.message || data?.error || "Could not generate answers.");
      setAnswersByQuestion((current) => ({
        ...current,
        [id]: {
          ...(current[id] || {}),
          status: "done",
          answers: Array.isArray(data.answers) ? data.answers : [],
          error: "",
        },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not generate answers.";
      setAnswersByQuestion((current) => ({
        ...current,
        [id]: { ...(current[id] || { answers: [] }), status: "failed", error: message },
      }));
    }
  }

  function selectAnswer(context: QuestionContext, answer: AnswerOption) {
    if (!session) return;
    const id = questionId(context.question, context.round_name);
    localStorage.setItem(selectedAnswerStorageKey(session.session_id, id), JSON.stringify(answer));
    setAnswersByQuestion((current) => ({
      ...current,
      [id]: {
        ...(current[id] || { status: "idle", answers: [] }),
        selectedAnswer: answer,
      },
    }));
  }

  function renderQuestionBankSection(section: string, index: number) {
    const parsed = parseQuestionBlocks(section);
    return (
      <div key={index} className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-5">
        {parsed.intro && <pre className="whitespace-pre-wrap text-sm leading-7 text-[#f5f0e8]/75">{parsed.intro}</pre>}
        <div className="mt-5 space-y-5">
          {parsed.questions.map((item) => {
            const matched = questionContexts[normalizeQuestion(item.question)];
            const context: QuestionContext = {
              question: item.question,
              round_name: matched?.round_name || item.round_name,
              assigned_story_id: matched?.assigned_story_id || "",
              assigned_story_title: matched?.assigned_story_title || "",
            };
            const id = questionId(context.question, context.round_name);
            const state = answersByQuestion[id] || { status: "idle", answers: [] };
            const loading = state.status === "loading";
            return (
              <article key={id} className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
                <pre className="whitespace-pre-wrap text-sm leading-7 text-[#f5f0e8]/75">{item.block}</pre>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    disabled={loading}
                    onClick={() => generateAnswersForQuestion(context)}
                    className="rounded-xl bg-[#c9a96e] px-4 py-3 text-sm font-bold text-[#0a0a0a] transition hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? "Generating..." : state.answers.length ? "Regenerate Answers" : "Generate Answers"}
                  </button>
                  {state.selectedAnswer && (
                    <span className="rounded-full border border-[#c9a96e]/40 bg-[#c9a96e]/10 px-3 py-2 text-xs font-semibold text-[#f2dfb8]">
                      Gold check: {state.selectedAnswer.label} selected
                    </span>
                  )}
                </div>
                {state.error && <p className="mt-3 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">{state.error}</p>}
                {state.answers.length > 0 && (
                  <div className="mt-4 grid gap-3">
                    {state.answers.map((answer) => {
                      const selected = state.selectedAnswer?.label === answer.label;
                      return (
                        <details key={answer.label} className={`rounded-xl border p-4 ${selected ? "border-[#c9a96e] bg-[#c9a96e]/10" : "border-[#2a2a2a] bg-[#0a0a0a]"}`}>
                          <summary className="cursor-pointer list-none text-sm font-semibold text-[#f5f0e8]">
                            <span className="mr-2 text-[#c9a96e]">{selected ? "✓" : "+"}</span>
                            {answer.label}
                          </summary>
                          <div className="mt-4 space-y-4 text-sm leading-7 text-[#f5f0e8]/72">
                            <p className="whitespace-pre-wrap">{answer.full_answer}</p>
                            <div className="grid gap-3 md:grid-cols-2">
                              <p><span className="font-semibold text-[#f5f0e8]">Why it wins:</span> {answer.why_it_wins}</p>
                              <p><span className="font-semibold text-[#f5f0e8]">Metric:</span> {answer.metric_used}</p>
                              <p><span className="font-semibold text-[#f5f0e8]">Tradeoff:</span> {answer.tradeoff_shown}</p>
                              <p><span className="font-semibold text-[#f5f0e8]">Delivery:</span> {answer.delivery_notes}</p>
                            </div>
                            <button onClick={() => selectAnswer(context, answer)} className="rounded-xl border border-[#c9a96e]/50 px-4 py-3 text-sm font-semibold text-[#f2dfb8] hover:bg-[#c9a96e]/10">
                              Use This Answer
                            </button>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#f5f0e8]">
      <div className="mx-auto max-w-[1500px] px-6 py-8">
        <nav className="flex flex-col justify-between gap-4 border-b border-[#2a2a2a] pb-6 md:flex-row md:items-center">
          <div>
            <img src="/nailit-logo-final.png?v=2" alt="Nailit" className="h-10 w-auto object-contain" />
            <p className="mt-2 text-sm text-[#f5f0e8]/45">Interview intelligence, built in modules.</p>
          </div>
          <div className="flex gap-3">
            {session && (
              <button onClick={resetSession} className="rounded-xl border border-[#2a2a2a] px-4 py-2 text-sm text-[#f5f0e8]/65 hover:border-[#c9a96e]/50">
                New Session
              </button>
            )}
          </div>
        </nav>

        {screen === "setup" && (
          <section className="py-10">
            <div className="mb-8">
              <p className="text-sm uppercase tracking-[0.35em] text-[#c9a96e]">Setup</p>
              <h1 className="mt-4 text-5xl font-semibold tracking-[-0.06em] md:text-7xl">Store the source truth once.</h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-[#f5f0e8]/58">
                Nailit saves the JD, CV, prepared stories, company context, and transcripts in a session. Every module reads the originals from Daytona, so the build does not lose context.
              </p>
            </div>

            <section className="rounded-[1.75rem] border border-[#2a2a2a] bg-[#141414] p-5 md:p-8">
              <div className="flex flex-col justify-between gap-4 border-b border-[#2a2a2a] pb-6 md:flex-row md:items-center">
                <div>
                  <h2 className="text-3xl font-semibold tracking-[-0.04em]">Create session</h2>
                  <p className="mt-2 text-sm text-[#f5f0e8]/48">No AI calls happen here. This is pure document storage.</p>
                </div>
                <button
                  onClick={createSession}
                  disabled={!canSave || saving || Boolean(extracting)}
                  className="rounded-2xl bg-[#c9a96e] px-7 py-4 text-sm font-bold text-[#0a0a0a] transition hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? "Saving..." : "Save and Begin Research"}
                </button>
              </div>

              <div className="mt-7 grid gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Company Name">
                      <input className="w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] px-4 py-3 text-[#f5f0e8] outline-none focus:border-[#c9a96e]" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
                    </Field>
                    <Field label="Role Name">
                      <input className="w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] px-4 py-3 text-[#f5f0e8] outline-none focus:border-[#c9a96e]" value={roleName} onChange={(event) => setRoleName(event.target.value)} />
                    </Field>
                  </div>
                  <Field label="Job Description">
                    <FileUpload label="Upload job description" upload={uploads.jd || null} busy={extracting === "jd"} onFile={(file) => extractIntoTextarea(file, "jd", jobDescription, setJobDescription)} />
                    <button type="button" onClick={() => setJobDescription(cleanText(jobDescription))} className="rounded-lg border border-[#2a2a2a] px-3 py-2 text-xs text-[#f5f0e8]/55">Clean text</button>
                    <textarea className="min-h-[520px] w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4 leading-7 text-[#f5f0e8] outline-none focus:border-[#c9a96e]" value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} />
                  </Field>
                </div>

                <div className="space-y-5">
                  <Field label="CV">
                    <FileUpload label="Upload CV" upload={uploads.cv || null} busy={extracting === "cv"} onFile={(file) => extractIntoTextarea(file, "cv", cv, setCv)} />
                    <button type="button" onClick={() => setCv(cleanText(cv))} className="rounded-lg border border-[#2a2a2a] px-3 py-2 text-xs text-[#f5f0e8]/55">Clean text</button>
                    <textarea className="min-h-[420px] w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4 leading-7 text-[#f5f0e8] outline-none focus:border-[#c9a96e]" value={cv} onChange={(event) => setCv(event.target.value)} />
                  </Field>
                  <Field label="Answer Bank" description="Paste your prepared stories here, one per paragraph.">
                    <FileUpload label="Upload prepared stories" upload={uploads.answer || null} busy={extracting === "answer"} onFile={(file) => extractIntoTextarea(file, "answer", answerBank, setAnswerBank)} />
                    <textarea className="min-h-[240px] w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4 leading-7 text-[#f5f0e8] outline-none focus:border-[#c9a96e]" value={answerBank} onChange={(event) => setAnswerBank(event.target.value)} />
                  </Field>
                  <Field label="Company Context">
                    <textarea className="min-h-[150px] w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4 leading-7 text-[#f5f0e8] outline-none focus:border-[#c9a96e]" value={companyContext} onChange={(event) => setCompanyContext(event.target.value)} />
                  </Field>
                  <Field label="YouTube Transcripts" description="Paste transcripts from relevant interview videos. Tip: open any YouTube video, click the three dots, then Open Transcript.">
                    <FileUpload label="Upload transcripts" upload={uploads.youtube || null} busy={extracting === "youtube"} onFile={(file) => extractIntoTextarea(file, "youtube", youtubeTranscripts, setYoutubeTranscripts)} />
                    <textarea className="min-h-[260px] w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4 leading-7 text-[#f5f0e8] outline-none focus:border-[#c9a96e]" value={youtubeTranscripts} onChange={(event) => setYoutubeTranscripts(event.target.value)} />
                  </Field>
                </div>
              </div>

              {error && <div className="mt-6 rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>}
            </section>
          </section>
        )}

        {screen === "dashboard" && session && (
          <section className="py-10">
            <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="text-sm uppercase tracking-[0.35em] text-[#c9a96e]">Session Dashboard</p>
                <h1 className="mt-4 text-5xl font-semibold tracking-[-0.06em]">{session.company_name}</h1>
                <p className="mt-2 text-xl text-[#f5f0e8]/58">{session.role_name}</p>
                <p className="mt-2 text-xs text-[#f5f0e8]/35">Session ID: {session.session_id}</p>
              </div>
            </div>

            {error && <div className="mb-6 rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>}

            <div className="grid gap-5 lg:grid-cols-3">
              {MODULES.map((item) => {
                const state = modules[item.name];
                const locked = moduleLocked(item);
                const busy = state.status === "queued" || state.status === "running";
                return (
                  <article key={item.name} className="rounded-[1.5rem] border border-[#2a2a2a] bg-[#141414] p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-xl font-semibold tracking-[-0.03em]">{item.title}</h2>
                      <StatusBadge status={state.status} />
                    </div>
                    <p className="mt-3 min-h-[72px] text-sm leading-6 text-[#f5f0e8]/50">{item.description}</p>
                    <div className="mt-5">
                      <div className="flex items-center justify-between text-xs text-[#f5f0e8]/42">
                        <span>{state.stage}</span>
                        <span>{Math.round(state.progress || 0)}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1e1e1e]">
                        <div className="h-full bg-[#c9a96e] transition-all" style={{ width: `${Math.max(0, Math.min(100, state.progress || 0))}%` }} />
                      </div>
                    </div>
                    <div className="mt-5 flex gap-3">
                      <button
                        disabled={locked || busy}
                        onClick={() => runModule(item.name)}
                        className="rounded-xl bg-[#c9a96e] px-4 py-3 text-sm font-bold text-[#0a0a0a] transition hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? "Running..." : item.button}
                      </button>
                      {state.status === "done" && (
                        <button onClick={() => setActiveModule(item.name)} className="rounded-xl border border-[#2a2a2a] px-4 py-3 text-sm text-[#f5f0e8]/70 hover:border-[#c9a96e]/50">
                          View Results
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
              <article className="rounded-[1.5rem] border border-[#2a2a2a] bg-[#141414] p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-semibold tracking-[-0.03em]">Module 7: Answer Generator</h2>
                  <StatusBadge status={completed.prep_pack ? "ready" : "locked"} />
                </div>
                <p className="mt-3 min-h-[72px] text-sm leading-6 text-[#f5f0e8]/50">
                  Generates three elite answer options under each question in the final prep pack. Uses the session CV, answer bank, and candidate profile.
                </p>
                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs text-[#f5f0e8]/42">
                    <span>{completed.prep_pack ? "Open the Prep Pack and click Generate Answers under any question." : "Locked until Prep Pack is done"}</span>
                    <span>{completed.prep_pack ? "100%" : "0%"}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1e1e1e]">
                    <div className="h-full bg-[#c9a96e] transition-all" style={{ width: completed.prep_pack ? "100%" : "0%" }} />
                  </div>
                </div>
                <div className="mt-5">
                  <button
                    disabled={!completed.prep_pack}
                    onClick={() => setActiveModule("prep_pack")}
                    className="rounded-xl bg-[#c9a96e] px-4 py-3 text-sm font-bold text-[#0a0a0a] transition hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Open Prep Pack
                  </button>
                </div>
              </article>
            </div>

            {activeState && (
              <section className="mt-8 rounded-[1.5rem] border border-[#2a2a2a] bg-[#141414] p-5 md:p-8">
                <div className="flex flex-col justify-between gap-4 border-b border-[#2a2a2a] pb-5 md:flex-row md:items-center">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[#c9a96e]">Module Output</p>
                    <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{MODULES.find((item) => item.name === activeModule)?.title}</h2>
                  </div>
                  <button onClick={() => setActiveModule("")} className="rounded-xl border border-[#2a2a2a] px-4 py-2 text-sm text-[#f5f0e8]/60">Close</button>
                </div>
                {activeState.markdown ? (
                  <div className="mt-6 grid gap-5">
                    {markdownSections.map((section, index) => (
                      isQuestionBankSection(section) ? (
                        renderQuestionBankSection(section, index)
                      ) : (
                        <pre key={index} className="whitespace-pre-wrap rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-5 text-sm leading-7 text-[#f5f0e8]/75">{section}</pre>
                      )
                    ))}
                  </div>
                ) : (
                  <pre className="mt-6 max-h-[720px] overflow-auto whitespace-pre-wrap rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-5 text-sm leading-7 text-[#f5f0e8]/70">
                    {readableJson(activeState.result)}
                  </pre>
                )}
              </section>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
