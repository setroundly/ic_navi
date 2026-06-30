import { NextResponse } from "next/server";

import { searchRouteIcs } from "@/lib/ic-estimator";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      origin?: string;
      destination?: string;
    };

    const origin = body.origin?.trim() ?? "";
    const destination = body.destination?.trim() ?? "";

    if (!origin || !destination) {
      return NextResponse.json(
        { error: "出発地と目的地を入力してください" },
        { status: 400 },
      );
    }

    const result = await searchRouteIcs(origin, destination);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "検索中にエラーが発生しました";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
