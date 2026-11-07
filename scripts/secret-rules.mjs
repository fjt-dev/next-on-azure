// Credential patterns for scripts/secret-scan.mjs. No third-party binary: the rules are listed here.

export const rules = [
  [
    "private key",
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  ],
  ["Azure storage account key or connection string", /AccountKey=[A-Za-z0-9+/]{40,}={0,2}/],
  ["Azure SAS signature", /[?&]sig=[A-Za-z0-9%+/]{30,}={0,3}/],
  ["Azure AD client secret", /(?:^|[^A-Za-z0-9])[A-Za-z0-9_~.-]{3}8Q~[A-Za-z0-9_~.-]{30,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["AWS access key id", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["JSON web token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  [
    "Application Insights instrumentation key in a connection string",
    /InstrumentationKey=[0-9a-f-]{36}/i,
  ],
  [
    "password assignment",
    /\b(?:password|passwd|secret|client_secret)\s*[:=]\s*["'][^"'\s$<{]{12,}["']/i,
  ],
];

// Public values that look like secrets: the fixed development account key documented for Azurite.
const publicValues = [
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
];

/** Returns the rule names that match a line. */
export function scanLine(line) {
  if (publicValues.some((v) => line.includes(v))) return [];
  return rules.filter(([, re]) => re.test(line)).map(([name]) => name);
}
