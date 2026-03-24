import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db/app-settings";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

const SETTINGS_VALIDATORS: Record<string, (v: string) => boolean> = {
  session_retention_days: (v) =>
    v === "" || (/^\d+$/.test(v) && parseInt(v, 10) >= 1 && parseInt(v, 10) <= 3650),
};

export const GET = withErrorHandler(async () => {
  const settings = getAllSettings();
  return NextResponse.json(settings);
});

export const PATCH = withErrorHandler(async (request: Request) => {
  const body = await request.json();

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const errors: string[] = [];
  const validated: [string, string][] = [];
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") {
      errors.push(`${key}: value must be a string`);
      continue;
    }
    const validator = SETTINGS_VALIDATORS[key];
    if (!validator) {
      errors.push(`${key}: unknown setting`);
      continue;
    }
    if (!validator(value)) {
      errors.push(`${key}: invalid value`);
      continue;
    }
    validated.push([key, value]);
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(", ") }, { status: 400 });
  }

  for (const [key, value] of validated) {
    setSetting(key, value);
  }

  const settings = getAllSettings();
  return NextResponse.json(settings);
});
