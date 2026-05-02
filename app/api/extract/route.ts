import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function normalizeText(text: string) {
  const headingWords = new Set([
    "SUMMARY",
    "PROFILE",
    "EXPERIENCE",
    "WORK EXPERIENCE",
    "PROFESSIONAL EXPERIENCE",
    "EDUCATION",
    "SKILLS",
    "CERTIFICATIONS",
    "PROJECTS",
    "LANGUAGES",
    "TOOLS",
    "ACHIEVEMENTS",
    "CONTACT",
  ]);

  const rawLines = text
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim());

  const cleaned: string[] = [];

  for (const line of rawLines) {
    if (line === "") {
      if (cleaned[cleaned.length - 1] !== "") {
        cleaned.push("");
      }
      continue;
    }

    const upper = line.toUpperCase();
    const isKnownHeading = headingWords.has(upper);
    const isLikelyHeading =
      line.length <= 45 &&
      /^[A-Z0-9][A-Z0-9 /&().,+-]{2,44}$/.test(line) &&
      !line.includes("@");

    if (isKnownHeading || isLikelyHeading) {
      if (cleaned.length && cleaned[cleaned.length - 1] !== "") {
        cleaned.push("");
      }
      cleaned.push(line);
      cleaned.push("");
      continue;
    }

    const previous = cleaned[cleaned.length - 1] || "";
    const startsBullet = /^([•*]|\d+[.)]|[-–—])\s+/.test(line);
    const previousEndsSentence = /[.!?:;)]$/.test(previous);
    const previousIsEmpty = previous === "";
    const previousIsHeading =
      headingWords.has(previous.toUpperCase()) ||
      (previous.length <= 45 && /^[A-Z0-9][A-Z0-9 /&().,+-]{2,44}$/.test(previous));

    const shouldJoin =
      !previousIsEmpty &&
      !previousIsHeading &&
      !startsBullet &&
      !previousEndsSentence &&
      line.length > 25;

    if (shouldJoin) {
      cleaned[cleaned.length - 1] = `${previous} ${line}`;
    } else {
      cleaned.push(line);
    }
  }

  return cleaned
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function extractFileText(file: File) {
  if (!file || file.size === 0) {
    throw new Error("No file uploaded.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File is too large. Please upload a file under 10MB.");
  }

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".pdf")) {
    const pdfParseModule: any = await import("pdf-parse");
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const data = await pdfParse(buffer);
    return normalizeText(data.text || "");
  }

  if (name.endsWith(".docx")) {
    const mammoth: any = await import("mammoth");
    const data = await mammoth.extractRawText({ buffer });
    return normalizeText(data.value || "");
  }

  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".rtf") ||
    name.endsWith(".csv")
  ) {
    return normalizeText(buffer.toString("utf8"));
  }

  throw new Error("Unsupported file type. Use PDF, DOCX, TXT, MD, RTF, or CSV.");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No valid file was uploaded." },
        { status: 400 }
      );
    }

    const text = await extractFileText(file);

    const warning =
      text.length < 500
        ? "The extracted text looks short. If this is a scanned PDF or image based file, export it as text, DOCX, or a searchable PDF."
        : "";

    return NextResponse.json({
      fileName: file.name,
      size: file.size,
      characters: text.length,
      text,
      warning,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Could not read file.",
        message: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
