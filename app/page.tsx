"use client";

import { useState } from "react";

export default function Home() {
  const [companyName, setCompanyName] = useState("Google");
  const [roleName, setRoleName] = useState("Program Manager");
  const [jobDescription, setJobDescription] = useState("");
  const [cv, setCv] = useState("");
  const [extra, setExtra] = useState("Create a concise interview prep pack and Lua mock interview brief.");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

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

      if (!res.ok) {
        throw new Error("Backend returned an error");
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-zinc-400">Interview Intel Agent</p>

        <h1 className="mt-3 text-4xl font-bold tracking-tight">
          Build an interview prep pack in minutes
        </h1>

        <p className="mt-4 text-zinc-400">
          Paste a role, add a CV, and generate a prep pack plus a Lua mock interview brief.
        </p>

        <div className="mt-10 grid gap-5 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm text-zinc-300">Company</span>
              <input
                className="rounded-xl border border-zinc-800 bg-black p-3 outline-none focus:border-white"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm text-zinc-300">Role</span>
              <input
                className="rounded-xl border border-zinc-800 bg-black p-3 outline-none focus:border-white"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
              />
            </label>
          </div>

          <label className="grid gap-2">
            <span className="text-sm text-zinc-300">Job description</span>
            <textarea
              className="min-h-40 rounded-xl border border-zinc-800 bg-black p-3 outline-none focus:border-white"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste the job description here"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-zinc-300">CV</span>
            <textarea
              className="min-h-40 rounded-xl border border-zinc-800 bg-black p-3 outline-none focus:border-white"
              value={cv}
              onChange={(e) => setCv(e.target.value)}
              placeholder="Paste the CV here"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm text-zinc-300">Extra context</span>
            <textarea
              className="min-h-24 rounded-xl border border-zinc-800 bg-black p-3 outline-none focus:border-white"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </label>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-xl bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"
          >
            {loading ? "Creating prep pack..." : "Create prep pack"}
          </button>

          {error && (
            <div className="rounded-xl border border-red-900 bg-red-950 p-4 text-red-200">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-900 bg-emerald-950 p-4 text-emerald-100">
              <p className="font-semibold">Done</p>
              <p className="mt-2 text-sm">Output file: {result.output_file}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
