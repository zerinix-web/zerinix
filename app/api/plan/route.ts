import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildNexoraPrompt } from "../../lib/orchestrator";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    const response = await client.responses.create({
      model: "gpt-5-mini",
      input: buildNexoraPrompt(prompt),
    
    });

    return NextResponse.json({
      result: response.output_text,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Bir hata oluştu." },
      { status: 500 }
    );
  }
}