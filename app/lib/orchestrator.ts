import { ceoAgent } from "./agents/ceo";

export function buildNexoraPrompt(prompt: string) {
  return `
Sen Nexora CEO Agent'sın.

${ceoAgent(prompt)}

Kullanıcı:
${prompt}

Cevabı Türkçe ver.
`;
}