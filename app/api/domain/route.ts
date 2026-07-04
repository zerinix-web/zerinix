import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { domain } = await req.json();

    if (!domain || typeof domain !== "string") {
      return NextResponse.json(
        { error: "Domain gerekli." },
        { status: 400 }
      );
    }

    const cleanDomain = domain
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "");

    if (!cleanDomain.endsWith(".com")) {
      return NextResponse.json(
        { error: "Şimdilik sadece .com kontrol ediliyor." },
        { status: 400 }
      );
    }

    const rdapUrl = `https://rdap.verisign.com/com/v1/domain/${cleanDomain.toUpperCase()}`;

    const response = await fetch(rdapUrl, {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 404) {
      return NextResponse.json({
        domain: cleanDomain,
        available: true,
        status: "available",
      });
    }

    if (response.ok) {
      return NextResponse.json({
        domain: cleanDomain,
        available: false,
        status: "taken",
      });
    }

    return NextResponse.json({
      domain: cleanDomain,
      available: null,
      status: "unknown",
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Domain kontrol edilemedi." },
      { status: 500 }
    );
  }
}