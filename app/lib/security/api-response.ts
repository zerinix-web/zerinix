import { NextResponse } from "next/server";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export function noStoreJson<T>(
  body: T,
  init: ResponseInit = {}
) {
  const headers = new Headers(init.headers);

  for (const [key, value] of Object.entries(noStoreHeaders)) {
    headers.set(key, value);
  }

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}
