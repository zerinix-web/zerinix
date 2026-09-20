// Shared by AIChatWorkspace and AdvisorProfilePanel. Plain types and a
// pure helper -- no "use client", so either side can import it freely.

export type ChatProfile = {
  preferred_country: string;
  preferred_industries: string[];
  investment_budget_ranges: string[];
  preferred_language: string;
  experience_level: string;
  available_time: string;
  business_interests: string[];
  risk_tolerance: string;
  long_term_goals: string[];
};

export function hasProfileContent(profile: ChatProfile) {
  return Boolean(
    profile.preferred_country ||
      profile.preferred_industries.length ||
      profile.investment_budget_ranges.length ||
      profile.preferred_language ||
      profile.experience_level ||
      profile.available_time ||
      profile.business_interests.length ||
      profile.risk_tolerance ||
      profile.long_term_goals.length
  );
}

export function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function formatList(value: string[]) {
  return value.join(", ");
}
