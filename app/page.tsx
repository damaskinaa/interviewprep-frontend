"use client";

import { useMemo, useState } from "react";

type Result = {
  status?: string;
  output_file?: string;
  markdown?: string;
  product_json?: any;
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

function RenderSection({ content }: { content: string }) {
  const lines = content.split("\n");
  let inCode = false;

  return (
    <div className="space-y-4">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();

        if (!line) {
          return <div key={index} className="h-2" />;
        }

        if (line.startsWith("```")) {
          inCode = !inCode;
          return null;
        }

        if (inCode) {
          return (
            <pre
              key={index}
              className="overflow-auto rounded-2xl border border-white/10 bg-black/60 p-4 text-sm leading-7 text-white/70"
            >
              {line}
            </pre>
          );
        }

        if (line.startsWith("### ")) {
          return (
            <h3
              key={index}
              className="pt-4 text-xl font-semibold tracking-[-0.03em] text-white"
            >
              {line.replace(/^###\s+/, "")}
            </h3>
          );
        }

        if (line.startsWith("#### ")) {
          return (
            <h4
              key={index}
              className="pt-3 text-lg font-semibold tracking-[-0.02em] text-[#f2dfb8]"
            >
              {line.replace(/^####\s+/, "")}
            </h4>
          );
        }

        if (/^\d+\.\s+/.test(line)) {
          return (
            <div
              key={index}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-white/78"
            >
              {line}
            </div>
          );
        }

        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={index} className="flex gap-3 text-white/75">
              <span className="mt-3 h-1.5 w-1.5 rounded-full bg-[#c9a96a]" />
              <p className="leading-8">{line.slice(2)}</p>
            </div>
          );
        }

        if (line.startsWith("{") || line.startsWith("}") || line.includes('":')) {
          return (
            <pre
              key={index}
              className="overflow-auto rounded-xl bg-black/40 px-4 py-2 text-xs leading-6 text-white/45"
            >
              {line}
            </pre>
          );
        }

        return (
          <p key={index} className="leading-8 text-white/75">
            {line}
          </p>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [companyName, setCompanyName] = useState("Google");
  const [roleName, setRoleName] = useState("Program Manager");
  const [jobDescription, setJobDescription] = useState("");
  const [cv, setCv] = useState("");
  const [extra, setExtra] = useState(
    "Create a detailed interview prep pack and Lua mock interview brief. Use exact evidence from the CV, job description, and answer bank. Avoid generic advice."
  );
  const [jobUpload, setJobUpload] = useState<UploadState | null>(null);
  const [cvUpload, setCvUpload] = useState<UploadState | null>(null);
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
    } catch (err: any) {
      setError(err.message || "Could not extract file.");
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
    } catch (err: any) {
      setError(err.message || "Something went wrong");
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
    <main className="min-h-screen bg-[#050505] text-white">
      <section className="relative overflow-hidden px-6 py-8">
        <div className="absolute left-0 top-0 h-[480px] w-[480px] rounded-full bg-[#c9a96a]/10 blur-[140px]" />
        <div className="absolute right-0 top-20 h-[520px] w-[520px] rounded-full bg-white/8 blur-[150px]" />

        <div className="relative mx-auto max-w-[1500px]">
          <nav className="flex items-center justify-between border-b border-white/10 pb-6">
            <div>
              <p className="text-2xl font-semibold tracking-[0.24em] text-white">
                NAILIT
              </p>
              <p className="mt-1 text-sm text-white/40">
                Interview strategy for people who want the offer.
              </p>
            </div>

            <div className="hidden items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/55 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              Secure prep workspace
            </div>
          </nav>

          <header className="grid gap-8 py-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-sm uppercase tracking-[0.35em] text-[#c9a96a]">
                Career prep, sharpened
              </p>

              <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.06em] text-white md:text-7xl">
                Walk into the interview with a plan.
              </h1>
            </div>

            <div className="max-w-2xl lg:ml-auto">
              <p className="text-lg leading-8 text-white/55">
                Upload or paste the role, your CV, and your answer bank. Nailit extracts the text first so you can review it before generating.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <MiniCard number="01" label="Extract" />
                <MiniCard number="02" label="Review" />
                <MiniCard number="03" label="Generate" />
              </div>
            </div>
          </header>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <div className="rounded-[1.5rem] border border-white/10 bg-[#0b0b0b] p-5 md:p-8">
              <div className="flex flex-col justify-between gap-5 border-b border-white/10 pb-6 md:flex-row md:items-start">
                <div>
                  <h2 className="text-3xl font-semibold tracking-[-0.04em]">
                    Build your prep pack
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">
                    Upload files or paste text manually. Extracted text is placed into the text boxes so you can verify the content before Nailit uses it.
                  </p>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={loading || extracting !== "" || !canSubmit}
                  className="rounded-2xl bg-[#f5f0e6] px-8 py-4 text-base font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
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
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55 hover:text-white"
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
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55 hover:text-white"
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

                  <Field label="Answer bank or extra context">
                    <FileUpload
                      label="Upload answer bank"
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
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/55 hover:text-white"
                      >
                        Clean text
                      </button>
                    </div>
                    <textarea
                      className="textarea min-h-[260px]"
                      value={extra}
                      onChange={(e) => setExtra(e.target.value)}
                      placeholder="Paste prepared answers, interview stories, notes, concerns, or company context"
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
              <div className="rounded-[2rem] border border-[#c9a96a]/20 bg-[#0b0905] p-5 md:p-8">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-[#c9a96a]">
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
                      className="rounded-2xl bg-[#f5f0e6] px-5 py-3 text-sm font-semibold text-black transition hover:bg-white"
                    >
                      Copy full pack
                    </button>
                  )}
                </div>

                {sections.length > 0 && currentSection && (
                  <div className="mt-8 grid gap-5 xl:grid-cols-[340px_1fr]">
                    <aside className="rounded-3xl border border-white/10 bg-black/30 p-4">
                      <p className="px-3 pb-3 text-sm font-semibold text-white">
                        Inside this pack
                      </p>

                      <div className="space-y-2">
                        {sections.map((section) => {
                          const selected = section.title === currentSection.title;

                          return (
                            <button
                              key={section.title}
                              onClick={() => setActiveSection(section.title)}
                              className={`w-full rounded-2xl px-4 py-3 text-left text-sm transition ${
                                selected
                                  ? "bg-[#c9a96a]/15 text-[#f5e6c8]"
                                  : "text-white/45 hover:bg-white/[0.04] hover:text-white"
                              }`}
                            >
                              {prettyTitle(section.title)}
                            </button>
                          );
                        })}
                      </div>
                    </aside>

                    <article className="rounded-3xl border border-white/10 bg-[#080808] p-6 md:p-9">
                      <p className="text-sm uppercase tracking-[0.28em] text-[#c9a96a]">
                        Section
                      </p>
                      <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                        {prettyTitle(currentSection.title)}
                      </h3>
                      <div className="mt-8 max-h-[820px] overflow-auto pr-4">
                        <RenderSection content={currentSection.content} />
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
          border: 1px solid rgba(255, 255, 255, 0.11);
          background: rgba(0, 0, 0, 0.48);
          padding: 1rem;
          color: white;
          outline: none;
          font-size: 1rem;
        }

        .textarea {
          width: 100%;
          resize: vertical;
          border-radius: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.11);
          background: rgba(0, 0, 0, 0.48);
          padding: 1rem;
          color: white;
          outline: none;
          font-size: 1rem;
          line-height: 1.65;
        }

        .input:focus,
        .textarea:focus {
          border-color: rgba(201, 169, 106, 0.75);
          box-shadow: 0 0 0 4px rgba(201, 169, 106, 0.10);
        }

        .input::placeholder,
        .textarea::placeholder {
          color: rgba(255, 255, 255, 0.28);
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
