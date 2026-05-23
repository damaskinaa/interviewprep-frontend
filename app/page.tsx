"use client";

import { useMemo, useState } from "react";

type Result = {
  status?: string;
  output_file?: string;
  markdown?: string;
  product_json?: unknown;
  error?: string;
  detail?: string;
};

type UploadState = {
  fileName: string;
  characters: number;
  warning: string;
};

type PackSection = {
  title: string;
  content: string;
};

function splitPack(markdown: string): PackSection[] {
  const lines = markdown.split("\n");
  const sections: PackSection[] = [];
  let currentTitle = "Executive summary";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentLines.join("\n").trim()) {
        sections.push({
          title: currentTitle,
          content: currentLines.join("\n").trim(),
        });
      }

      currentTitle = line.replace(/^##\s+/, "").trim();
      currentLines = [];
      continue;
    }

    if (!line.startsWith("# Interview Prep Pack")) {
      currentLines.push(line);
    }
  }

  if (currentLines.join("\n").trim()) {
    sections.push({
      title: currentTitle,
      content: currentLines.join("\n").trim(),
    });
  }

  return sections.filter((section) => section.content.trim());
}

function prettyTitle(title: string) {
  return title
    .replace(/And/g, "and")
    .replace(/Json/g, "JSON")
    .replace(/Cv/g, "CV")
    .replace(/Lua/g, "Lua");
}

function sectionTone(title: string) {
  const t = title.toLowerCase();

  if (t.includes("risk") || t.includes("gap")) return "Risk";
  if (t.includes("question") || t.includes("answer")) return "Practice";
  if (t.includes("source") || t.includes("research")) return "Evidence";
  if (t.includes("strategy") || t.includes("signal")) return "Strategy";
  if (t.includes("story")) return "Stories";
  if (t.includes("plan") || t.includes("checklist")) return "Plan";

  return "Brief";
}

function formatInline(text: string) {
  return text
    .replace(/\*\*/g, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function parseSectionBlocks(content: string) {
  const lines = content.split("\n");
  const blocks: { kind: string; text: string }[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  }

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      blocks.push({ kind: "h3", text: line.replace(/^###\s+/, "").trim() });
      continue;
    }

    if (line.startsWith("#### ")) {
      flushParagraph();
      blocks.push({ kind: "h4", text: line.replace(/^####\s+/, "").trim() });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      blocks.push({ kind: "numbered", text: line.replace(/^\d+\.\s+/, "").trim() });
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      blocks.push({ kind: "bullet", text: formatInline(line) });
      continue;
    }

    if (line.startsWith("{") || line.startsWith("}") || line.includes('":')) {
      flushParagraph();
      blocks.push({ kind: "code", text: line });
      continue;
    }

    paragraph.push(formatInline(line));
  }

  flushParagraph();
  return blocks;
}

function RenderSection({ title, content }: { title: string; content: string }) {
  const blocks = parseSectionBlocks(content);
  const tone = sectionTone(title);

  return (
    <article className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b0b0a]/80 shadow-2xl shadow-black/30">
      <div className="border-b border-white/10 bg-white/[0.025] px-6 py-5 sm:px-8">
        <div className="mb-3 inline-flex rounded-full border border-[#c9a96a]/25 bg-[#c9a96a]/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-[#f2dfb8]/80">
          {tone}
        </div>
        <h2 className="text-3xl font-semibold tracking-[-0.055em] text-white sm:text-4xl">
          {prettyTitle(title)}
        </h2>
      </div>

      <div className="space-y-4 px-6 py-7 sm:px-8">
        {blocks.map((block, index) => {
          if (block.kind === "h3") {
            return (
              <h3 key={index} className="pt-4 text-xl font-semibold tracking-[-0.035em] text-white">
                {block.text}
              </h3>
            );
          }

          if (block.kind === "h4") {
            return (
              <h4 key={index} className="pt-2 text-base font-semibold tracking-[-0.02em] text-[#f2dfb8]">
                {block.text}
              </h4>
            );
          }

          if (block.kind === "numbered") {
            return (
              <div key={index} className="group rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition hover:border-[#c9a96a]/30 hover:bg-white/[0.055]">
                <div className="mb-2 text-[10px] uppercase tracking-[0.28em] text-white/35">
                  Point {index + 1}
                </div>
                <p className="leading-8 text-white/78">{block.text}</p>
              </div>
            );
          }

          if (block.kind === "bullet") {
            return (
              <div key={index} className="flex gap-3 rounded-2xl bg-white/[0.02] px-4 py-3">
                <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c9a96a]" />
                <p className="leading-8 text-white/76">{block.text}</p>
              </div>
            );
          }

          if (block.kind === "code") {
            return (
              <pre key={index} className="overflow-auto rounded-2xl border border-white/10 bg-black/50 p-4 text-xs leading-6 text-white/50">
                {block.text}
              </pre>
            );
          }

          return (
            <p key={index} className="leading-8 text-white/74">
              {block.text}
            </p>
          );
        })}
      </div>
    </article>
  );
}


export default function Home() {
  const [companyName, setCompanyName] = useState("Google");
  const [roleName, setRoleName] = useState("Program Manager");
  const [jobDescription, setJobDescription] = useState("");
  const [cv, setCv] = useState("");
  const [answerBank, setAnswerBank] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [extra, setExtra] = useState(
    "Create a detailed interview prep pack and Lua mock interview brief. Build top 1 percent CV-plausible answers later: realistic for the candidate's background, with believable metrics and a clear winning process."
  );
  const [jobUpload, setJobUpload] = useState<UploadState | null>(null);
  const [cvUpload, setCvUpload] = useState<UploadState | null>(null);
  const [answerUpload, setAnswerUpload] = useState<UploadState | null>(null);
  const [extraUpload, setExtraUpload] = useState<UploadState | null>(null);
  const [extracting, setExtracting] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState("");

  const sections = useMemo(() => splitPack(result?.markdown || ""), [result?.markdown]);
  const currentSection =
    sections.find((section) => section.title === activeSection) || sections[0];

  async function extractIntoTextarea(
    file: File,
    currentText: string,
    setText: (value: string) => void,
    setUpload: (value: UploadState | null) => void,
    label: string
  ) {
    setError("");
    setExtracting(label);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/extract", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Could not extract file.");
      }

      const header = `\n\n[Uploaded file: ${data.fileName}]\n`;
      const nextText = `${currentText.trim()}${header}${data.text}`.trim();

      setText(nextText);
      setUpload({
        fileName: data.fileName,
        characters: data.characters,
        warning: data.warning || "",
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not extract file.");
    } finally {
      setExtracting("");
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setError("");
    setResult(null);
    setActiveSection("");

    try {
      const res = await fetch("/api/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          company_name: companyName,
          role_name: roleName,
          job_description: jobDescription,
          cv,
          answer_bank: answerBank,
          company_description: companyDescription,
          extra
        })
      });

      const data = await res.json();

      if (!res.ok) {
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : data?.body || data?.message || JSON.stringify(data?.detail || data);

        throw new Error(`${data?.error || "Request failed"}: ${detail}`);
      }

      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function cleanPastedText(value: string) {
    return value
      .replace(/\r/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  const canSubmit = companyName.trim() && roleName.trim() && jobDescription.trim() && cv.trim();

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#f5f0e8]">
      <section className="px-6 py-8">
        <div className="mx-auto max-w-[1500px]">
          <nav className="flex items-center justify-between border-b border-[#2a2a2a] pb-6">
            <div>
              <img
                src="/nailit-logo-final.png?v=2"
                alt="Nailit"
                className="h-10 w-auto object-contain"
              />
              <p className="mt-2 text-sm text-[#f5f0e8]/45">
                Interview strategy for people who want the offer.
              </p>
            </div>

            <div className="hidden items-center gap-3 rounded-full border border-[#2a2a2a] bg-[#141414] px-4 py-2 text-sm text-[#f5f0e8]/60 md:flex">
              <span className="h-2 w-2 rounded-full bg-[#c9a96e]" />
              Secure prep workspace
            </div>
          </nav>

          <header className="grid gap-8 py-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-[#c9a96e]">
                Career prep, sharpened
              </p>

              <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.06em] text-[#f5f0e8] md:text-7xl">
                Walk into the interview with a plan.
              </h1>
            </div>

            <div className="max-w-2xl lg:ml-auto">
              <p className="text-lg leading-8 text-[#f5f0e8]/62">
                Upload the role, CV, prepared stories, and company context. Nailit turns the material into a private interview strategy pack.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <MiniCard number="01" label="Extract" />
                <MiniCard number="02" label="Review" />
                <MiniCard number="03" label="Generate" />
              </div>
            </div>
          </header>

          <section className="rounded-[2rem] border border-[#2a2a2a] bg-[#141414] p-4 shadow-2xl shadow-black/60">
            <div className="rounded-[1.5rem] border border-[#2a2a2a] bg-[#141414] p-5 md:p-8">
              <div className="flex flex-col justify-between gap-5 border-b border-[#2a2a2a] pb-6 md:flex-row md:items-start">
                <div>
                  <h2 className="text-3xl font-semibold tracking-[-0.04em]">
                    Build your prep pack
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[#f5f0e8]/48">
                    Upload files or paste text manually. Extracted text is placed into the text boxes so you can verify the content before Nailit uses it.
                  </p>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={loading || extracting !== "" || !canSubmit}
                  className="rounded-2xl bg-[#c9a96e] px-8 py-4 text-base font-semibold text-[#0a0a0a] transition hover:bg-[#f5f0e8] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? "Building..." : extracting ? "Reading file..." : "Create prep pack"}
                </button>
              </div>

              <div className="mt-7 grid gap-5 lg:grid-cols-2">
                <div className="grid gap-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Company">
                      <input
                        className="input"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                      />
                    </Field>

                    <Field label="Role">
                      <input
                        className="input"
                        value={roleName}
                        onChange={(e) => setRoleName(e.target.value)}
                      />
                    </Field>
                  </div>

                  <Field label="Job description">
                    <FileUpload
                      label="Upload job description"
                      upload={jobUpload}
                      busy={extracting === "job"}
                      onFile={(file) =>
                        extractIntoTextarea(file, jobDescription, setJobDescription, setJobUpload, "job")
                      }
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setJobDescription(cleanPastedText(jobDescription))}
                        className="rounded-xl border border-[#2a2a2a] px-3 py-2 text-xs text-[#f5f0e8]/58 hover:text-[#f5f0e8]"
                      >
                        Clean text
                      </button>
                    </div>
                    <textarea
                      className="textarea min-h-[520px]"
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      placeholder="Paste the full job description here, or upload a file above"
                    />
                  </Field>
                </div>

                <div className="grid gap-5">
                  <Field label="CV">
                    <FileUpload
                      label="Upload CV"
                      upload={cvUpload}
                      busy={extracting === "cv"}
                      onFile={(file) =>
                        extractIntoTextarea(file, cv, setCv, setCvUpload, "cv")
                      }
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setCv(cleanPastedText(cv))}
                        className="rounded-xl border border-[#2a2a2a] px-3 py-2 text-xs text-[#f5f0e8]/58 hover:text-[#f5f0e8]"
                      >
                        Clean text
                      </button>
                    </div>
                    <textarea
                      className="textarea min-h-[520px]"
                      value={cv}
                      onChange={(e) => setCv(e.target.value)}
                      placeholder="Paste the full CV here, or upload a file above"
                    />
                  </Field>

                  <Field label="Your prepared answers and stories (optional)">
                    <FileUpload
                      label="Upload prepared answers"
                      upload={answerUpload}
                      busy={extracting === "answer_bank"}
                      onFile={(file) =>
                        extractIntoTextarea(file, answerBank, setAnswerBank, setAnswerUpload, "answer_bank")
                      }
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setAnswerBank(cleanPastedText(answerBank))}
                        className="rounded-xl border border-[#2a2a2a] px-3 py-2 text-xs text-[#f5f0e8]/58 hover:text-[#f5f0e8]"
                      >
                        Clean text
                      </button>
                    </div>
                    <textarea
                      className="textarea min-h-[300px]"
                      value={answerBank}
                      onChange={(e) => setAnswerBank(e.target.value)}
                      placeholder="Paste prepared answers, interview stories, achievements, project notes, or examples you want Nailit to use"
                    />
                  </Field>

                  <Field label="Additional company context (optional)">
                    <textarea
                      className="textarea min-h-[180px]"
                      value={companyDescription}
                      onChange={(e) => setCompanyDescription(e.target.value)}
                      placeholder="Paste extra company notes, team details, recruiter context, interview hints, or anything you already know"
                    />
                  </Field>

                  <Field label="Extra instructions">
                    <FileUpload
                      label="Upload extra notes"
                      upload={extraUpload}
                      busy={extracting === "extra"}
                      onFile={(file) =>
                        extractIntoTextarea(file, extra, setExtra, setExtraUpload, "extra")
                      }
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setExtra(cleanPastedText(extra))}
                        className="rounded-xl border border-[#2a2a2a] px-3 py-2 text-xs text-[#f5f0e8]/58 hover:text-[#f5f0e8]"
                      >
                        Clean text
                      </button>
                    </div>
                    <textarea
                      className="textarea min-h-[260px]"
                      value={extra}
                      onChange={(e) => setExtra(e.target.value)}
                      placeholder="Add any specific instruction, concern, or preference for this prep pack"
                    />
                  </Field>
                </div>
              </div>

              {error && (
                <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-red-100">
                  {error}
                </div>
              )}
            </div>
          </section>

          {result && (
            <section className="py-10">
              <div className="rounded-[2rem] border border-[#2a2a2a] bg-[#141414] p-5 md:p-8">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-[#c9a96e]">
                      Ready
                    </p>
                    <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
                      Your prep pack is ready.
                    </h2>
                    {result.output_file && (
                      <p className="mt-2 text-sm text-white/45">
                        Generated file: {result.output_file}
                      </p>
                    )}
                  </div>

                  {result.markdown && (
                    <button
                      onClick={() => navigator.clipboard.writeText(result.markdown || "")}
                      className="rounded-2xl bg-[#c9a96e] px-5 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-[#f5f0e8]"
                    >
                      Copy full pack
                    </button>
                  )}
                </div>

                {sections.length > 0 && currentSection && (
                  <div className="mt-8 grid gap-5 xl:grid-cols-[340px_1fr]">
                    <aside className="rounded-3xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                      <p className="px-3 pb-3 text-sm font-semibold text-[#f5f0e8]">
                        Inside this pack
                      </p>

                      <div className="flex gap-2 overflow-x-auto pb-2 xl:block xl:space-y-2 xl:overflow-visible xl:pb-0">
                        {sections.map((section) => {
                          const selected = section.title === currentSection.title;

                          return (
                            <button
                              key={section.title}
                              onClick={() => setActiveSection(section.title)}
                              className={`shrink-0 rounded-full px-4 py-3 text-left text-sm transition xl:w-full xl:rounded-2xl ${
                                selected
                                  ? "bg-[#c9a96e] text-[#0a0a0a]"
                                  : "border border-[#2a2a2a] text-[#f5f0e8]/50 hover:border-[#c9a96e]/45 hover:text-[#f5f0e8]"
                              }`}
                            >
                              {prettyTitle(section.title)}
                            </button>
                          );
                        })}
                      </div>
                    </aside>

                    <article className="rounded-3xl border border-[#2a2a2a] bg-[#0a0a0a] p-6 md:p-9">
                      <p className="text-sm uppercase tracking-[0.28em] text-[#c9a96e]">
                        Section
                      </p>
                      <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                        {prettyTitle(currentSection.title)}
                      </h3>
                      <div className="mt-8 max-h-[820px] overflow-auto pr-4">
                        <RenderSection title={currentSection.title} content={currentSection.content} />
                      </div>
                    </article>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </section>

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 1rem;
          border: 1px solid #2a2a2a;
          background: #1e1e1e;
          padding: 1rem;
          color: #f5f0e8;
          outline: none;
          font-size: 1rem;
        }

        .textarea {
          width: 100%;
          resize: vertical;
          border-radius: 1rem;
          border: 1px solid #2a2a2a;
          background: #1e1e1e;
          padding: 1rem;
          color: #f5f0e8;
          outline: none;
          font-size: 1rem;
          line-height: 1.65;
        }

        .input:focus,
        .textarea:focus {
          border-color: #c9a96e;
          box-shadow: 0 0 0 4px rgba(201, 169, 110, 0.16);
        }

        .input::placeholder,
        .textarea::placeholder {
          color: rgba(245, 240, 232, 0.32);
        }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-3">
      <span className="text-sm text-white/60">{label}</span>
      {children}
    </label>
  );
}

function MiniCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <p className="text-2xl font-semibold text-white">{number}</p>
      <p className="mt-2 text-sm text-white/50">{label}</p>
    </div>
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-white/75">{label}</p>
          <p className="mt-1 text-xs text-white/35">
            PDF, DOCX, TXT, MD, RTF, or CSV. Text appears below for review.
          </p>
        </div>

        <label className="cursor-pointer rounded-xl border border-[#c9a96a]/35 bg-[#c9a96a]/10 px-4 py-2 text-sm font-semibold text-[#f5e6c8] transition hover:bg-[#c9a96a]/20">
          {busy ? "Reading..." : "Choose file"}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx,.txt,.md,.rtf,.csv"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {upload && (
        <div className="mt-3 rounded-xl bg-black/40 px-3 py-3 text-sm text-white/60">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="truncate">{upload.fileName}</span>
            <span>{upload.characters.toLocaleString()} characters extracted</span>
          </div>
          {upload.warning && (
            <p className="mt-2 text-xs leading-5 text-amber-200">
              {upload.warning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
