import { NextRequest, NextResponse } from "next/server";
import { runTopicDiscovery } from "@/lib/topic-discovery/discovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return authorization === `Bearer ${secret}` || headerSecret === secret || querySecret === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runTopicDiscovery();
  const status = result.errors.length > 0 ? 207 : 200;

  return NextResponse.json(result, { status });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
