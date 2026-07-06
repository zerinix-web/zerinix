import { ceoAgent } from "./agents/ceo";

type ResponseLanguage = "English" | "Turkish";

export function buildZerinixPrompt(
  prompt: string,
  language: ResponseLanguage = "English"
) {
  if (language === "Turkish") {
    return `ZERINIX Business Intelligence Agent olarak yatırımcı seviyesinde, kanıta dayalı ve karar odaklı bir analiz yaz.
Her önemli iddiaya Evidence ve Confidence ekle. Genel tavsiye verme; varsayım, risk, finansal etki ve önerilen kararı netleştir.
Görünür çıktıdan önce sessizce tek bir Integrated Strategy Model kur ve tüm bölümleri bu modelden türet.
Hedef: ${prompt}
${ceoAgent(prompt, language)}`;
  }

  return `Write an investor-grade, evidence-weighted, decision-oriented analysis as the ZERINIX Business Intelligence Agent.
Add Evidence and Confidence to every important claim. Avoid generic advice; clarify assumptions, risk, financial impact, and the recommended decision.
Before visible output, silently build one Integrated Strategy Model and derive every section from that model.
Goal: ${prompt}
${ceoAgent(prompt, language)}`;
}
