"use client";

import { useState } from "react";

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

export default function Home() {
  const [companyName, setCompanyName] = useState("Google");
  const [roleName, setRoleName] = useState("Program Manager");
  const [jobDescription, setJobDescription] = useState("");
  const [cv, setCv] = useState("");
  const [extra, setExtra] = useState("Create a detailed interview prep pack and Lua mock interview brief. Use exact evidence from the CV and job description. Avoid generic advice.");
  const [jobUpload, setJobUpload] = useState<UploadState | null>(null);
  const [cvUpload, setCvUpload] = useState<UploadState | null>(null);
  const [extraUpload, setExtraUpload] = useState<UploadState | null>(null);
  const [extracting, setExtracting] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

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
        throw new Error(data?.error || data?.detail || "Backend returned an error");
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
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
              <p className="text-2xl font-semibold tracking-[-0.04em] text-white">
                Nailit
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
                Upload or paste the role and your CV. Nailit extracts the text first so you can review it before generating.
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
                    <textarea
                      className="textarea min-h-[520px]"
                      value={cv}
                      onChange={(e) => setCv(e.target.value)}
                      placeholder="Paste the full CV here, or upload a file above"
                    />
                  </Field>

                  <Field label="Extra context">
                    <FileUpload
                      label="Upload extra context"
                      upload={extraUpload}
                      busy={extracting === "extra"}
                      onFile={(file) =>
                        extractIntoTextarea(file, extra, setExtra, setExtraUpload, "extra")
                      }
                    />
                    <textarea
                      className="textarea min-h-[160px]"
                      value={extra}
                      onChange={(e) => setExtra(e.target.value)}
                      placeholder="Add concerns, interview style, seniority, or company notes"
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
              <div className="rounded-[2rem] border border-[#c9a96a]/20 bg-[#c9a96a]/[0.06] p-5 md:p-8">
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

                {result.markdown && (
                  <div className="mt-8 grid gap-5 xl:grid-cols-[320px_1fr]">
                    <aside className="rounded-3xl border border-white/10 bg-black/30 p-6">
                      <p className="text-sm font-semibold text-white">Inside this pack</p>
                      <div className="mt-5 space-y-4 text-sm text-white/50">
                        <p>Executive interview strategy</p>
                        <p>Role and CV analysis</p>
                        <p>Candidate risks and repairs</p>
                        <p>Likely interview questions</p>
                        <p>Story bank</p>
                        <p>Seven day prep plan</p>
                        <p>Lua mock interview brief</p>
                      </div>
                    </aside>

                    <article className="rounded-3xl border border-white/10 bg-[#080808] p-6 md:p-9">
                      <pre className="max-h-[820px] overflow-auto whitespace-pre-wrap font-sans text-[15px] leading-8 text-white/82">
                        {result.markdown}
                      </pre>
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
