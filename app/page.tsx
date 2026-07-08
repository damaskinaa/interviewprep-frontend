"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import posthog from "posthog-js";
if (typeof window !== "undefined") {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "", {
    api_host: "https://app.posthog.com",
    capture_pageview: false,
  });
}

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

type LuaFeedback = {
  status: string;
  score_out_of_10?: number;
  verdict?: string;
  what_worked?: string[];
  what_was_weak?: string[];
  better_structure?: string[];
  top_1_percent_answers?: { safe_strong?: string; elite_concise?: string; pressure_proof?: string };
  voice_and_delivery_coaching?: { pace?: string; tone?: string; confidence?: string; words_to_remove?: string[]; sentence_to_practise?: string };
  adaptive_follow_up_question?: string;
  move_on_allowed?: boolean;
  raw_response?: string;
};

type PracticeState = {
  questionId: string;
  attempt: string;
  submitting: boolean;
  feedback?: LuaFeedback;
  error?: string;
  attemptCount: number;
};

type MockTurn = {
  question: string;
  round_name: string;
  pickedAnswer?: AnswerOption;
  userAnswer: string;
  feedback?: LuaFeedback;
  score?: number;
};

type MockState = {
  active: boolean;
  questions: QuestionContext[];
  currentIndex: number;
  turns: MockTurn[];
  // phase: "pick" = show 3 ideal answers to choose from; "practice" = practice delivering chosen answer
  phase: "pick" | "practice";
  pickedAnswer?: AnswerOption;
  loadingAnswers: boolean;
  availableAnswers: AnswerOption[];
  inputText: string;
  submitting: boolean;
  error?: string;
  done: boolean;
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
  const [practiceState, setPracticeState] = useState<PracticeState | null>(null);
  const [mockState, setMockState] = useState<MockState | null>(null);
  const [hint2Dismissed, setHint2Dismissed] = useState(false);
  const [hint4Dismissed, setHint4Dismissed] = useState(false);
  const practiceRef = useRef<HTMLDivElement | null>(null);
  const generatingRef = useRef(false);

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
      if (data.status === "done") {
        if (moduleName === "prep_pack") {
          posthog.capture("session_completed", {
            company: session?.company_name,
            tier: "free",
          });
        }
        return;
      }
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
    // Ref-based guard: synchronous check prevents double-calls even with async state lag
    if (generatingRef.current) return;
    generatingRef.current = true;
    const id = questionId(context.question, context.round_name);
    // Guard: don't fire if already loading or done
    const existing = answersByQuestion[id];
    if (existing?.status === "loading" || existing?.status === "done") {
      generatingRef.current = false;
      return;
    }
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
    } finally {
      generatingRef.current = false;
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

  async function callLua(question: string, userAnswer: string): Promise<LuaFeedback> {
    if (!session) throw new Error("No session");
    const res = await fetch("/api/lua", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: session.company_name,
        role: session.role_name,
        question,
        candidate_answer: userAnswer,
        lua_brief: {},
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || data?.message || "Lua feedback failed.");
    return data as LuaFeedback;
  }

  function openPractice(context: QuestionContext) {
    const id = questionId(context.question, context.round_name);
    setPracticeState({ questionId: id, attempt: "", submitting: false, attemptCount: 0 });
    setTimeout(() => practiceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  async function submitPractice(context: QuestionContext) {
    if (!practiceState || !practiceState.attempt.trim()) return;
    setPracticeState((s) => s ? { ...s, submitting: true, error: undefined } : s);
    try {
      const feedback = await callLua(context.question, practiceState.attempt);
      setPracticeState((s) => s ? { ...s, submitting: false, feedback, attemptCount: s.attemptCount + 1 } : s);
    } catch (err: unknown) {
      setPracticeState((s) => s ? { ...s, submitting: false, error: err instanceof Error ? err.message : "Feedback failed." } : s);
    }
  }

  function startMockInterview() {
    const all = Object.values(questionContexts) as QuestionContext[];
    if (!all.length) return;
    posthog.capture("paid_conversion", {
      plan: "mock_interview",
      source: "session_end",
    });
    const firstQ = all[0];
    // Pre-load answers for first question if already generated
    const firstState = answersByQuestion[normalizeQuestion(firstQ.question)];
    const preloaded = firstState?.answers ?? [];
    setMockState({
      active: true,
      questions: all,
      currentIndex: 0,
      turns: [],
      phase: "pick",
      pickedAnswer: undefined,
      loadingAnswers: preloaded.length === 0,
      availableAnswers: preloaded,
      inputText: "",
      submitting: false,
      done: false,
    });
    setPracticeState(null);
    setActiveModule("");
    // If no answers preloaded, fetch them now
    if (preloaded.length === 0) {
      generateAnswersForQuestion(firstQ).then(() => {
        setMockState((s) => {
          if (!s) return s;
          const st = answersByQuestion[normalizeQuestion(firstQ.question)];
          return { ...s, loadingAnswers: false, availableAnswers: st?.answers ?? [] };
        });
      }).catch(() => {
        setMockState((s) => s ? { ...s, loadingAnswers: false } : s);
      });
    }
  }

  function mockPickAnswer(answer: AnswerOption) {
    setMockState((s) => s ? { ...s, phase: "practice", pickedAnswer: answer, inputText: "" } : s);
  }

  async function mockAdvanceToQuestion(index: number) {
    if (!mockState) return;
    const q = mockState.questions[index];
    if (!q) {
      // All questions done
      setMockState((s) => s ? { ...s, done: true } : s);
      return;
    }
    const existing = answersByQuestion[normalizeQuestion(q.question)];
    const preloaded = existing?.answers ?? [];
    setMockState((s) => s ? {
      ...s,
      currentIndex: index,
      phase: "pick",
      pickedAnswer: undefined,
      loadingAnswers: preloaded.length === 0,
      availableAnswers: preloaded,
      inputText: "",
      submitting: false,
      error: undefined,
    } : s);
    if (preloaded.length === 0) {
      try {
        await generateAnswersForQuestion(q);
        setMockState((s) => {
          if (!s) return s;
          const st = answersByQuestion[normalizeQuestion(q.question)];
          return { ...s, loadingAnswers: false, availableAnswers: st?.answers ?? [] };
        });
      } catch {
        setMockState((s) => s ? { ...s, loadingAnswers: false } : s);
      }
    }
  }

  async function submitMockAnswer() {
    if (!mockState || !mockState.inputText.trim()) return;
    const q = mockState.questions[mockState.currentIndex];
    setMockState((s) => s ? { ...s, submitting: true, error: undefined } : s);
    try {
      const feedback = await callLua(q.question, mockState.inputText);
      const newTurn: MockTurn = {
        question: q.question,
        round_name: q.round_name,
        pickedAnswer: mockState.pickedAnswer,
        userAnswer: mockState.inputText,
        feedback,
        score: typeof feedback.score_out_of_10 === "number" ? feedback.score_out_of_10 : undefined,
      };
      const newTurns = [...mockState.turns, newTurn];
      if (newTurns.length === 3) {
        posthog.capture("lua_three_rounds", {
          company: session?.company_name,
        });
      }
      setMockState((s) => s ? { ...s, submitting: false, turns: newTurns } : s);
    } catch (err: unknown) {
      setMockState((s) => s ? { ...s, submitting: false, error: err instanceof Error ? err.message : "Feedback failed." } : s);
    }
  }

  function mockNextQuestion() {
    if (!mockState) return;
    const next = mockState.currentIndex + 1;
    mockAdvanceToQuestion(next);
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
              <article key={id} className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4" ref={practiceState?.questionId === id ? practiceRef : null}>
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
                            <div className="flex gap-3 flex-wrap">
                              <button onClick={() => selectAnswer(context, answer)} className="rounded-xl border border-[#c9a96e]/50 px-4 py-3 text-sm font-semibold text-[#f2dfb8] hover:bg-[#c9a96e]/10">
                                Use This Answer
                              </button>
                              <button
                                onClick={() => { selectAnswer(context, answer); openPractice(context); }}
                                className="rounded-xl bg-[#1e1e1e] border border-[#c9a96e] px-4 py-3 text-sm font-semibold text-[#c9a96e] hover:bg-[#c9a96e]/10"
                              >
                                Practice with Lua →
                              </button>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}

                {/* Practice panel — shown when this question is open for practice */}
                {practiceState?.questionId === id && (
                  <div className="mt-5 rounded-xl border border-[#c9a96e]/30 bg-[#0d0d0d] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-[#c9a96e]">Lua Practice</p>
                        <p className="mt-1 text-sm text-[#f5f0e8]/60">Type your version of the answer. Lua will score structure, content, and company alignment.</p>
                      </div>
                      <button onClick={() => setPracticeState(null)} className="text-xs text-[#f5f0e8]/40 hover:text-[#f5f0e8]/70">Close</button>
                    </div>

                    {/* Reference answer */}
                    {state.selectedAnswer && (
                      <details className="mb-4 rounded-xl border border-[#2a2a2a] bg-[#141414] p-3">
                        <summary className="cursor-pointer text-xs font-semibold text-[#f5f0e8]/50">Reference answer: {state.selectedAnswer.label}</summary>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#f5f0e8]/70">{state.selectedAnswer.full_answer}</p>
                      </details>
                    )}

                    <textarea
                      className="min-h-[160px] w-full rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4 text-sm leading-7 text-[#f5f0e8] outline-none focus:border-[#c9a96e]"
                      placeholder="Type your answer here..."
                      value={practiceState.attempt}
                      onChange={(e) => setPracticeState((s) => s ? { ...s, attempt: e.target.value } : s)}
                    />

                    <div className="mt-3 flex gap-3 flex-wrap items-center">
                      <button
                        disabled={practiceState.submitting || !practiceState.attempt.trim()}
                        onClick={() => submitPractice(context)}
                        className="rounded-xl bg-[#c9a96e] px-5 py-3 text-sm font-bold text-[#0a0a0a] hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {practiceState.submitting ? "Lua is reading..." : "Get Feedback"}
                      </button>
                      {practiceState.attemptCount > 0 && (
                        <span className="text-xs text-[#f5f0e8]/40">Attempt {practiceState.attemptCount}</span>
                      )}
                    </div>

                    {practiceState.error && (
                      <p className="mt-3 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">{practiceState.error}</p>
                    )}

                    {/* Lua feedback */}
                    {practiceState.feedback && practiceState.feedback.status === "coaching" && (
                      <div className="mt-5 space-y-4">
                        {/* Score */}
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-[#f5f0e8]/60">Score</span>
                              <span className="text-lg font-bold text-[#c9a96e]">{practiceState.feedback.score_out_of_10 ?? "—"}<span className="text-sm text-[#f5f0e8]/40">/10</span></span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-[#1e1e1e]">
                              <div className="h-full bg-[#c9a96e] transition-all" style={{ width: `${((practiceState.feedback.score_out_of_10 ?? 0) / 10) * 100}%` }} />
                            </div>
                          </div>
                        </div>

                        {/* Verdict */}
                        {practiceState.feedback.verdict && (
                          <p className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4 text-sm leading-6 text-[#f5f0e8]/80">{practiceState.feedback.verdict}</p>
                        )}

                        {/* What worked */}
                        {practiceState.feedback.what_worked && practiceState.feedback.what_worked.length > 0 && (
                          <div className="rounded-xl border-l-4 border-emerald-400/50 bg-emerald-500/5 p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">What worked</p>
                            <ul className="space-y-1">
                              {practiceState.feedback.what_worked.map((item, i) => (
                                <li key={i} className="text-sm leading-6 text-[#f5f0e8]/75">• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* What was weak */}
                        {practiceState.feedback.what_was_weak && practiceState.feedback.what_was_weak.length > 0 && (
                          <div className="rounded-xl border-l-4 border-amber-400/50 bg-amber-500/5 p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">What to sharpen</p>
                            <ul className="space-y-1">
                              {practiceState.feedback.what_was_weak.map((item, i) => (
                                <li key={i} className="text-sm leading-6 text-[#f5f0e8]/75">• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Top 1% answers */}
                        {practiceState.feedback.top_1_percent_answers && (
                          <div className="rounded-xl border border-[#c9a96e]/25 bg-[#c9a96e]/5 p-4 space-y-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c9a96e]">Lua&apos;s top 1% versions</p>
                            {Object.entries(practiceState.feedback.top_1_percent_answers).map(([key, val]) => val && (
                              <div key={key}>
                                <p className="text-xs font-semibold text-[#f5f0e8]/50 mb-1 capitalize">{key.replace(/_/g, " ")}</p>
                                <p className="text-sm leading-7 text-[#f5f0e8]/80 whitespace-pre-wrap">{val}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Voice coaching */}
                        {practiceState.feedback.voice_and_delivery_coaching && (
                          <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4 space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f5f0e8]/45">Delivery coaching</p>
                            {practiceState.feedback.voice_and_delivery_coaching.pace && <p className="text-sm text-[#f5f0e8]/70"><span className="font-semibold text-[#f5f0e8]/90">Pace: </span>{practiceState.feedback.voice_and_delivery_coaching.pace}</p>}
                            {practiceState.feedback.voice_and_delivery_coaching.tone && <p className="text-sm text-[#f5f0e8]/70"><span className="font-semibold text-[#f5f0e8]/90">Tone: </span>{practiceState.feedback.voice_and_delivery_coaching.tone}</p>}
                            {practiceState.feedback.voice_and_delivery_coaching.confidence && <p className="text-sm text-[#f5f0e8]/70"><span className="font-semibold text-[#f5f0e8]/90">Confidence: </span>{practiceState.feedback.voice_and_delivery_coaching.confidence}</p>}
                            {practiceState.feedback.voice_and_delivery_coaching.sentence_to_practise && (
                              <p className="mt-2 rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 p-3 text-sm italic text-[#f2dfb8]">&quot;{practiceState.feedback.voice_and_delivery_coaching.sentence_to_practise}&quot;</p>
                            )}
                          </div>
                        )}

                        {/* Follow-up */}
                        {practiceState.feedback.adaptive_follow_up_question && (
                          <div className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f5f0e8]/45 mb-2">Lua follow-up</p>
                            <p className="text-sm leading-6 text-[#f5f0e8]/80">{practiceState.feedback.adaptive_follow_up_question}</p>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 flex-wrap pt-2">
                          <button
                            onClick={() => setPracticeState((s) => s ? { ...s, attempt: "", feedback: undefined } : s)}
                            className="rounded-xl border border-[#2a2a2a] px-4 py-3 text-sm text-[#f5f0e8]/70 hover:border-[#c9a96e]/50"
                          >
                            Try Again
                          </button>
                          <button
                            onClick={() => setPracticeState(null)}
                            className="rounded-xl bg-[#c9a96e] px-4 py-3 text-sm font-bold text-[#0a0a0a] hover:bg-[#f5f0e8]"
                          >
                            Next Question →
                          </button>
                        </div>
                      </div>
                    )}
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

        {/* ── MOCK INTERVIEW OVERLAY ─────────────────────────────────── */}
        {mockState?.active && (
          <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] text-[#f5f0e8] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#2a2a2a] px-6 py-4 flex-shrink-0">
              <div className="flex items-center gap-4">
                <img src="/nailit-logo-final.png?v=2" alt="Nailit" className="h-8 w-auto object-contain" />
                <span className="text-xs uppercase tracking-[0.3em] text-[#c9a96e]">Mock Interview — Live</span>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-sm text-[#f5f0e8]/50">
                  {mockState.done ? "Complete" : `Question ${mockState.currentIndex + 1} of ${mockState.questions.length}`}
                </span>
                <button
                  onClick={() => setMockState(null)}
                  className="rounded-xl border border-[#2a2a2a] px-3 py-1.5 text-xs text-[#f5f0e8]/50 hover:border-[#c9a96e]/40 hover:text-[#f5f0e8]"
                >
                  Exit
                </button>
              </div>
            </div>

            {/* Progress bar */}
            {!mockState.done && (
              <div className="h-1 w-full bg-[#1e1e1e] flex-shrink-0">
                <div
                  className="h-full bg-[#c9a96e] transition-all duration-500"
                  style={{ width: `${(mockState.currentIndex / mockState.questions.length) * 100}%` }}
                />
              </div>
            )}

            <div className="flex-1 mx-auto w-full max-w-3xl px-6 py-10">

              {/* ── DONE / SUMMARY SCREEN ── */}
              {mockState.done ? (
                <div className="space-y-8">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-[#c9a96e]">Debrief</p>
                    <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">Interview Complete</h2>
                    <p className="mt-3 text-[#f5f0e8]/55 text-sm leading-6">
                      {mockState.turns.length} question{mockState.turns.length !== 1 ? "s" : ""} answered.
                      Average score:{" "}
                      <span className="font-bold text-[#c9a96e]">
                        {mockState.turns.filter(t => t.score != null).length > 0
                          ? (mockState.turns.reduce((sum, t) => sum + (t.score ?? 0), 0) / mockState.turns.filter(t => t.score != null).length).toFixed(1)
                          : "—"
                        }/10
                      </span>
                    </p>
                  </div>

                  <div className="space-y-5">
                    {mockState.turns.map((turn, i) => (
                      <article key={i} className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-5 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium text-[#f5f0e8]/90 leading-6">Q{i + 1}. {turn.question}</p>
                          {turn.score != null && (
                            <span className="shrink-0 rounded-lg border border-[#c9a96e]/30 bg-[#c9a96e]/10 px-2 py-0.5 text-sm font-bold text-[#c9a96e]">
                              {turn.score}/10
                            </span>
                          )}
                        </div>
                        {turn.feedback?.verdict && (
                          <p className="text-xs leading-5 text-[#f5f0e8]/55 italic">{turn.feedback.verdict}</p>
                        )}
                        {turn.feedback?.what_worked && turn.feedback.what_worked.length > 0 && (
                          <ul className="space-y-1">
                            {turn.feedback.what_worked.slice(0, 2).map((w, j) => (
                              <li key={j} className="flex items-start gap-2 text-xs text-green-300/80">
                                <span className="mt-0.5 shrink-0 text-green-400">✓</span>{w}
                              </li>
                            ))}
                          </ul>
                        )}
                        {turn.feedback?.what_was_weak && turn.feedback.what_was_weak.length > 0 && (
                          <ul className="space-y-1">
                            {turn.feedback.what_was_weak.slice(0, 2).map((w, j) => (
                              <li key={j} className="flex items-start gap-2 text-xs text-amber-300/80">
                                <span className="mt-0.5 shrink-0 text-amber-400">△</span>{w}
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>

                  <button
                    onClick={() => setMockState(null)}
                    className="rounded-xl bg-[#c9a96e] px-6 py-3 text-sm font-bold text-[#0a0a0a] hover:bg-[#f5f0e8] transition"
                  >
                    Back to Prep Pack
                  </button>
                </div>

              ) : (
                /* ── ACTIVE QUESTION SCREEN ── */
                (() => {
                  const currentQ = mockState.questions[mockState.currentIndex];
                  const currentTurn = mockState.turns[mockState.currentIndex];
                  const hasFeedback = !!currentTurn?.feedback;

                  return (
                    <div className="space-y-6">
                      {/* Round label */}
                      {currentQ.round_name && (
                        <p className="text-xs uppercase tracking-[0.3em] text-[#f5f0e8]/35">{currentQ.round_name}</p>
                      )}

                      {/* Question */}
                      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6">
                        <p className="text-xs uppercase tracking-[0.25em] text-[#c9a96e] mb-3">Question {mockState.currentIndex + 1}</p>
                        <p className="text-lg font-medium leading-7 text-[#f5f0e8]">{currentQ.question}</p>
                      </div>

                      {/* ── PHASE: PICK AN ANSWER ── */}
                      {mockState.phase === "pick" && !hasFeedback && (
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.25em] text-[#c9a96e]">Step 1 — Choose your answer</p>
                            <p className="mt-1 text-sm text-[#f5f0e8]/50">Lua prepared three top-1% answers. Pick one to practise. Read them, decide which fits you best, then commit.</p>
                          </div>

                          {mockState.loadingAnswers ? (
                            <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 text-center">
                              <p className="text-sm text-[#f5f0e8]/50">Lua is preparing your answers...</p>
                            </div>
                          ) : mockState.availableAnswers.length === 0 ? (
                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
                              <p className="text-sm text-amber-200/80">No answers generated yet for this question.</p>
                              <button
                                onClick={() => {
                                  setMockState(s => s ? { ...s, loadingAnswers: true } : s);
                                  generateAnswersForQuestion(currentQ).then(() => {
                                    setMockState(s => {
                                      if (!s) return s;
                                      const st = answersByQuestion[normalizeQuestion(currentQ.question)];
                                      return { ...s, loadingAnswers: false, availableAnswers: st?.answers ?? [] };
                                    });
                                  }).catch(() => setMockState(s => s ? { ...s, loadingAnswers: false } : s));
                                }}
                                className="rounded-xl bg-[#c9a96e] px-4 py-2 text-sm font-bold text-[#0a0a0a] hover:bg-[#f5f0e8] transition"
                              >
                                Generate Answers
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {mockState.availableAnswers.map((answer, i) => (
                                <button
                                  key={i}
                                  onClick={() => mockPickAnswer(answer)}
                                  className="w-full text-left rounded-2xl border border-[#2a2a2a] bg-[#141414] p-5 hover:border-[#c9a96e]/50 hover:bg-[#1e1e1e] transition group"
                                >
                                  <div className="flex items-start justify-between gap-3 mb-3">
                                    <span className="rounded-lg bg-[#c9a96e]/15 px-2.5 py-1 text-xs font-bold text-[#c9a96e]">{answer.label}</span>
                                    <span className="text-xs text-[#f5f0e8]/30 group-hover:text-[#c9a96e] transition">Pick this →</span>
                                  </div>
                                  <p className="text-sm leading-6 text-[#f5f0e8]/80 line-clamp-4">{answer.full_answer}</p>
                                  {answer.why_it_wins && (
                                    <p className="mt-2 text-xs text-[#f5f0e8]/40 italic">{answer.why_it_wins}</p>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── PHASE: PRACTICE THE PICKED ANSWER ── */}
                      {mockState.phase === "practice" && !hasFeedback && mockState.pickedAnswer && (
                        <div className="space-y-4">
                          {/* Show picked answer as reference */}
                          <details className="rounded-xl border border-[#c9a96e]/20 bg-[#c9a96e]/5 p-4" open>
                            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.25em] text-[#c9a96e] select-none">
                              Your chosen answer — {mockState.pickedAnswer.label}
                            </summary>
                            <p className="mt-3 text-sm leading-7 text-[#f5f0e8]/80 whitespace-pre-wrap">{mockState.pickedAnswer.full_answer}</p>
                          </details>

                          <div>
                            <p className="text-xs uppercase tracking-[0.25em] text-[#c9a96e]">Step 2 — Deliver it</p>
                            <p className="mt-1 text-sm text-[#f5f0e8]/50">Now say it in your own words. Do not copy it — adapt it. Lua coaches your version.</p>
                          </div>

                          <div className="space-y-3">
                            <textarea
                              rows={6}
                              placeholder="Deliver the answer in your own words. Adapt the story, own the language."
                              value={mockState.inputText}
                              onChange={(e) => setMockState(prev => prev ? { ...prev, inputText: e.target.value } : prev)}
                              className="w-full resize-none rounded-2xl border border-[#2a2a2a] bg-[#1e1e1e] px-5 py-4 text-sm leading-6 text-[#f5f0e8] placeholder-[#f5f0e8]/25 focus:border-[#c9a96e]/50 focus:outline-none"
                            />
                            <div className="flex items-center gap-3">
                              <button
                                onClick={submitMockAnswer}
                                disabled={mockState.submitting || !mockState.inputText.trim()}
                                className="rounded-xl bg-[#c9a96e] px-5 py-3 text-sm font-bold text-[#0a0a0a] transition hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {mockState.submitting ? "Lua is reading..." : "Get Feedback"}
                              </button>
                              <button
                                onClick={() => setMockState(s => s ? { ...s, phase: "pick", pickedAnswer: undefined, inputText: "" } : s)}
                                className="rounded-xl border border-[#2a2a2a] px-4 py-3 text-sm text-[#f5f0e8]/50 hover:border-[#c9a96e]/30 transition"
                              >
                                ← Choose different answer
                              </button>
                              {mockState.error && <p className="text-xs text-red-400">{mockState.error}</p>}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ── FEEDBACK ── */}
                      {hasFeedback && currentTurn.feedback && (
                        <div className="space-y-4">
                          {/* Picked answer reminder */}
                          {currentTurn.pickedAnswer && (
                            <details className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                              <summary className="cursor-pointer text-xs uppercase tracking-[0.25em] text-[#f5f0e8]/40 select-none">Target answer: {currentTurn.pickedAnswer.label}</summary>
                              <p className="mt-3 text-sm leading-6 text-[#f5f0e8]/60 whitespace-pre-wrap">{currentTurn.pickedAnswer.full_answer}</p>
                            </details>
                          )}

                          {/* Score */}
                          <div className="flex items-center gap-4 rounded-2xl border border-[#2a2a2a] bg-[#141414] p-5">
                            <span className="text-3xl font-bold text-[#c9a96e]">
                              {currentTurn.feedback.score_out_of_10 ?? "—"}<span className="text-base text-[#f5f0e8]/40">/10</span>
                            </span>
                            <div className="flex-1">
                              <div className="h-2 overflow-hidden rounded-full bg-[#1e1e1e]">
                                <div className="h-full bg-[#c9a96e] transition-all duration-700" style={{ width: `${((currentTurn.feedback.score_out_of_10 ?? 0) / 10) * 100}%` }} />
                              </div>
                              {currentTurn.feedback.verdict && (
                                <p className="mt-2 text-sm text-[#f5f0e8]/70 italic">{currentTurn.feedback.verdict}</p>
                              )}
                            </div>
                          </div>

                          {/* Your delivery shown */}
                          <details className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                            <summary className="cursor-pointer text-xs uppercase tracking-[0.25em] text-[#f5f0e8]/40 select-none">Your delivery</summary>
                            <p className="mt-3 text-sm leading-6 text-[#f5f0e8]/65">{currentTurn.userAnswer}</p>
                          </details>

                          {currentTurn.feedback.what_worked && currentTurn.feedback.what_worked.length > 0 && (
                            <div className="rounded-xl border border-green-500/15 bg-green-500/5 p-4 space-y-2">
                              <p className="text-xs uppercase tracking-[0.25em] text-green-400">What Worked</p>
                              <ul className="space-y-1.5">
                                {currentTurn.feedback.what_worked.map((item, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-green-200/80"><span className="mt-0.5 shrink-0 text-green-400">✓</span>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {currentTurn.feedback.what_was_weak && currentTurn.feedback.what_was_weak.length > 0 && (
                            <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4 space-y-2">
                              <p className="text-xs uppercase tracking-[0.25em] text-amber-400">Sharpen This</p>
                              <ul className="space-y-1.5">
                                {currentTurn.feedback.what_was_weak.map((item, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-amber-200/80"><span className="mt-0.5 shrink-0 text-amber-400">△</span>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {currentTurn.feedback.voice_and_delivery_coaching && (
                            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4 space-y-2">
                              <p className="text-xs uppercase tracking-[0.25em] text-[#c9a96e]">Delivery Coaching</p>
                              {currentTurn.feedback.voice_and_delivery_coaching.pace && <p className="text-sm text-[#f5f0e8]/70"><span className="font-semibold text-[#f5f0e8]/90">Pace: </span>{currentTurn.feedback.voice_and_delivery_coaching.pace}</p>}
                              {currentTurn.feedback.voice_and_delivery_coaching.tone && <p className="text-sm text-[#f5f0e8]/70"><span className="font-semibold text-[#f5f0e8]/90">Tone: </span>{currentTurn.feedback.voice_and_delivery_coaching.tone}</p>}
                              {currentTurn.feedback.voice_and_delivery_coaching.confidence && <p className="text-sm text-[#f5f0e8]/70"><span className="font-semibold text-[#f5f0e8]/90">Confidence: </span>{currentTurn.feedback.voice_and_delivery_coaching.confidence}</p>}
                              {currentTurn.feedback.voice_and_delivery_coaching.sentence_to_practise && (
                                <p className="mt-2 rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 p-3 text-sm italic text-[#f2dfb8]">&quot;{currentTurn.feedback.voice_and_delivery_coaching.sentence_to_practise}&quot;</p>
                              )}
                            </div>
                          )}

                          {currentTurn.feedback.adaptive_follow_up_question && (
                            <div className="rounded-xl border border-[#c9a96e]/20 bg-[#c9a96e]/5 p-4">
                              <p className="text-xs uppercase tracking-[0.25em] text-[#c9a96e] mb-2">Lua Follow-up</p>
                              <p className="text-sm leading-6 text-[#f5f0e8]/80">{currentTurn.feedback.adaptive_follow_up_question}</p>
                            </div>
                          )}

                          {/* Actions: retry same answer OR next question */}
                          <div className="flex items-center gap-3 pt-2 flex-wrap">
                            <button
                              onClick={() => {
                                // retry: go back to practice phase with same picked answer
                                setMockState(s => s ? {
                                  ...s,
                                  phase: "practice",
                                  turns: s.turns.slice(0, s.currentIndex),
                                  inputText: "",
                                  error: undefined,
                                } : s);
                              }}
                              className="rounded-xl border border-[#2a2a2a] px-5 py-3 text-sm text-[#f5f0e8]/65 hover:border-[#c9a96e]/40 transition"
                            >
                              Try Again
                            </button>
                            <button
                              onClick={mockNextQuestion}
                              className="rounded-xl bg-[#c9a96e] px-5 py-3 text-sm font-bold text-[#0a0a0a] transition hover:bg-[#f5f0e8]"
                            >
                              {mockState.currentIndex + 1 >= mockState.questions.length ? "See Results →" : "Next Question →"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        )}

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
                const prepPackDone = modules.prep_pack?.status === "done";
                return (
                  <div key={item.name} className="contents">
                    <article className="rounded-[1.5rem] border border-[#2a2a2a] bg-[#141414] p-5">
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

                    {/* Hint: scary question after Module 2 (role_intelligence) */}
                    {item.name === "role_intelligence" &&
                      state.status === "done" &&
                      !hint2Dismissed &&
                      !prepPackDone && (() => {
                        const r = state.result as Record<string, unknown> | null;
                        const dangerZones = r?.danger_zones as {requirement?: string}[] | undefined;
                        const questionSeeds = r?.question_seeds as {question?: string}[] | undefined;
                        const text = dangerZones?.[0]?.requirement || questionSeeds?.[0]?.question;
                        if (!text) return null;
                        return (
                          <div
                            onClick={() => setHint2Dismissed(true)}
                            className="activation-hint cursor-pointer rounded-[1.5rem] border border-amber-600/40 bg-amber-950/20 p-5"
                          >
                            <p className="hint-label mb-2 text-xs font-semibold uppercase tracking-widest text-amber-500/70">
                              Question you may not have prepared for
                            </p>
                            <p className="hint-text text-sm leading-6 text-[#f5f0e8]/80 line-clamp-3">{text}</p>
                            <p className="mt-3 text-xs text-[#f5f0e8]/30">Click to dismiss</p>
                          </div>
                        );
                      })()}

                    {/* Hint: gap repair script after Module 4 (gap_map) */}
                    {item.name === "gap_map" &&
                      state.status === "done" &&
                      !hint4Dismissed &&
                      !prepPackDone && (() => {
                        const r = state.result as Record<string, unknown> | null;
                        const repairScripts = r?.repair_scripts as {verbatim_repair_answer?: string}[] | undefined;
                        const text = repairScripts?.[0]?.verbatim_repair_answer;
                        if (!text) return null;
                        return (
                          <div
                            onClick={() => setHint4Dismissed(true)}
                            className="activation-hint cursor-pointer rounded-[1.5rem] border border-amber-600/40 bg-amber-950/20 p-5"
                          >
                            <p className="hint-label mb-2 text-xs font-semibold uppercase tracking-widest text-amber-500/70">
                              Your biggest gap — what to say
                            </p>
                            <p className="hint-text text-sm leading-6 text-[#f5f0e8]/80 line-clamp-3">{text}</p>
                            <p className="mt-3 text-xs text-[#f5f0e8]/30">Click to dismiss</p>
                          </div>
                        );
                      })()}
                  </div>
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

              {/* Module 8: Mock Interview */}
              <article className="rounded-[1.5rem] border border-[#c9a96e]/20 bg-[#141414] p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-semibold tracking-[-0.03em]">Module 8: Mock Interview</h2>
                  <StatusBadge status={completed.prep_pack && Object.values(questionContexts).length > 0 ? "ready" : "locked"} />
                </div>
                <p className="mt-3 min-h-[72px] text-sm leading-6 text-[#f5f0e8]/50">
                  Live mock interview with Lua. Questions appear one at a time. No hints. Immediate feedback per answer. Score tracked. Final debrief at the end.
                </p>
                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs text-[#f5f0e8]/42">
                    <span>{completed.prep_pack ? `${Object.values(questionContexts).length} questions ready` : "Run all modules first"}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#1e1e1e]">
                    <div className="h-full bg-[#c9a96e] transition-all" style={{ width: completed.prep_pack ? "100%" : "0%" }} />
                  </div>
                </div>
                <div className="mt-5">
                  <button
                    disabled={!completed.prep_pack || Object.values(questionContexts).length === 0}
                    onClick={startMockInterview}
                    className="rounded-xl bg-[#c9a96e] px-4 py-3 text-sm font-bold text-[#0a0a0a] transition hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Start Mock Interview
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
