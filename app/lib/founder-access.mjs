function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeGmailAddress(value) {
  const email = normalizeEmail(value);
  const [localPart, domain] = email.split("@");

  if (!localPart || (domain !== "gmail.com" && domain !== "googlemail.com")) {
    return email;
  }

  return `${localPart.split("+")[0].replace(/\./g, "")}@gmail.com`;
}

export function parseFounderEmails(value = "") {
  return String(value)
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

export function isFounderEmail(email, founderEmails = process.env.FOUNDER_EMAILS || "") {
  const normalizedEmail = normalizeEmail(email);
  const normalizedGmailEmail = normalizeGmailAddress(email);

  if (!normalizedEmail) {
    return false;
  }

  return parseFounderEmails(founderEmails).some((founderEmail) => {
    return (
      normalizedEmail === normalizeEmail(founderEmail) ||
      normalizedGmailEmail === normalizeGmailAddress(founderEmail)
    );
  });
}
