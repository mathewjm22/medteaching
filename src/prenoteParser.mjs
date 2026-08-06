/**
 * Deterministic prenote parser.
 *
 * Design rules:
 * 1. ASCII divider boxes define document structure.
 * 2. AI may clean or summarize content, but it must not choose section boundaries.
 * 3. Repeated sections are preserved and concatenated.
 * 4. DIAGNOSTICS remains open until a verified hard endpoint, diagnosis block,
 *    or the end of the document.
 */

const DIVIDER_RE = /^\s*([=\-.])\1{7,}\s*$/;
const PAUSE_RE = /^\s*\[\[PAUSED\s*-\s*TYPE\s+CONTINUE\]\]\s*$/i;
const MARKDOWN_HEADING_RE = /^\s*#{1,6}\s+(.+?)\s*$/;

const STATUS_VALUES = [
  "unstable/new",
  "active/changing",
  "stable/chronic",
  "in remission",
  "resolved",
  "controlled",
  "uncontrolled",
  "suspected",
  "remission",
  "registry",
  "unknown",
  "active",
  "changing",
  "stable",
  "chronic",
  "inactive",
  "historical",
];

const ICD_CODE_SOURCE =
  "(?:[A-TV-Z][0-9][0-9AB](?:\\.[0-9A-Z]{1,7})?|U0[0-9](?:\\.[0-9A-Z]{1,7})?|[A-Z]\\d{2}(?:\\.\\d{1,4})?)";

const ICD_AT_END_RE = new RegExp(
  `\\(\\s*(${ICD_CODE_SOURCE})\\s*\\)\\s*$`,
  "i",
);

const KEY_DX_STATUS_RE =
  /^\s*--?\s*\[\s*(Unstable\/New|Active\/Changing|Stable\/Chronic|Resolved)\s*\]\s*$/i;

const INLINE_KEY_DX_RE =
  /^\s*(.+?)\s+\.{2,}\s+\[(Unstable\/New|Active\/Changing|Stable\/Chronic|Resolved)\]\s*$/i;

const SECTION_DEFINITIONS = [
  {
    key: "prenote",
    match: (value) => value === "PRENOTE",
  },
  {
    key: "whatToKnow",
    match: (value) => /^WHAT TO KNOW ABOUT(?:\s+.+)?$/i.test(value),
  },
  {
    key: "recentVisits",
    match: (value) => value === "UPDATES / RECENT VISITS",
  },
  {
    key: "pastMedicalHistory",
    match: (value) => value === "PAST MEDICAL HISTORY",
  },
  {
    key: "social",
    match: (value) => value === "SOCIAL" || value === "SOCIAL HISTORY",
  },
  {
    key: "familyHistory",
    match: (value) => value === "FAMILY HISTORY",
  },
  {
    key: "allergies",
    match: (value) => value === "ALLERGIES",
  },
  {
    key: "surgicalHistory",
    match: (value) => value === "SURGICAL HISTORY",
  },
  {
    key: "militaryHistory",
    match: (value) => value === "MILITARY HISTORY",
  },
  {
    key: "medRec",
    match: (value) =>
      value === "MED REC" ||
      value === "MEDICATION RECONCILIATION" ||
      value === "CURRENT ACTIVE MEDICATIONS" ||
      value === "CURRENT MEDICATIONS" ||
      value === "CURRENT MEDICATIONS (GROUPED BY SPECIALTY)" ||
      value === "PAST MEDICATIONS" ||
      value === "MEDICATION ADHERENCE" ||
      value === "MEDICATION ADHERENCE / BARRIERS" ||
      value === "RECENTLY DISCONTINUED" ||
      value === "RECENTLY DISCONTINUED (PAST 6 MONTHS)" ||
      value === "SIGNIFICANT HISTORICAL MEDICATIONS" ||
      value === "SIGNIFICANT HISTORICAL MEDICATIONS / TIMELINE" ||
      value === "HISTORICAL MEDICATIONS",
  },
  {
    key: "preventiveMedicine",
    match: (value) => value === "PREVENTIVE MEDICINE",
  },
  {
    key: "advanceDirectives",
    match: (value) =>
      value === "ADVANCE DIRECTIVES" ||
      value === "ADVANCE DIRECTIVE",
  },
  {
    key: "healthMaintenance",
    match: (value) =>
      value === "HEALTH MAINTENANCE" ||
      value === "HEALTH MAINTENANCE / SCREENING",
  },
  {
    key: "specialtyCare",
    match: (value) =>
      value === "SPECIALTY CARE / CONSULTS" ||
      value === "SPECIALTY CARE" ||
      value === "CONSULTS" ||
      value === "ACTIVE CONSULTS" ||
      value === "CARE TEAM" ||
      value === "PENDING STUDIES/REFERRALS" ||
      value === "PENDING STUDIES / REFERRALS" ||
      value === "PENDING STUDIES AND REFERRALS" ||
      value === "PENDING WORKUP / REFERRALS" ||
      value === "PENDING WORKUP AND REFERRALS",
  },
  {
    key: "hospitalizations",
    match: (value) =>
      value === "HOSPITALIZATIONS / ER VISITS" ||
      value === "HOSPITALIZATIONS / ER VISITS (PAST YEAR)" ||
      value === "HOSPITALIZATIONS" ||
      value === "ER VISITS" ||
      value === "HOSPITALIZATIONS AND ER VISITS",
  },
  {
    key: "assessmentPlanSummary",
    match: (value) =>
      value === "ASSESSMENT & PLAN SUMMARY" ||
      value === "ASSESSMENT AND PLAN SUMMARY" ||
      value === "A&P SUMMARY",
  },
  {
    key: "lastPrimaryCareVisit",
    match: (value) =>
      value === "LAST PRIMARY CARE VISIT" ||
      value === "LAST PCP VISIT",
  },
  {
    key: "vitalSigns",
    match: (value) =>
      value === "VITAL SIGNS TRENDS" ||
      value === "VITAL SIGN TRENDS" ||
      value === "VITALS" ||
      value === "VITAL SIGNS",
  },
  {
    key: "diagnostics",
    match: (value) =>
      value === "DIAGNOSTICS" ||
      value === "DIAGNOSTICS LAB TRENDS" ||
      value === "LAB TRENDS" ||
      /^PART\s*\d+\s*[-:]?\s*DIAGNOSTICS/.test(value) ||
      /^DIAGNOSTICS\s+LAB\s+TRENDS/.test(value),
  },
  {
    key: "activeMedicalProblems",
    match: (value) =>
      value === "ACTIVE MEDICAL PROBLEMS & ASSESSMENTS" ||
      value === "ACTIVE MEDICAL PROBLEMS AND ASSESSMENTS" ||
      value === "ACTIVE MEDICAL PROBLEMS" ||
      value === "ASSESSMENT AND PLAN",
  },
  {
    key: "keyDiagnoses",
    match: (value) =>
      value === "KEY DIAGNOSES" ||
      value === "KEY DIAGNOSIS" ||
      value === "KEY DX",
  },
  {
    key: "followUp",
    match: (value) =>
      value === "FOLLOW-UP" ||
      value === "FOLLOW UP" ||
      value === "FOLLOWUP",
  },
];

const DIAGNOSTICS_HARD_END_KEYS = new Set([
  "activeMedicalProblems",
  "keyDiagnoses",
  "pastMedicalHistory",
  "social",
  "familyHistory",
  "allergies",
  "surgicalHistory",
  "militaryHistory",
  "medRec",
  "preventiveMedicine",
  "followUp",
]);

const DIAGNOSTIC_SUBSECTION_NAMES = new Set([
  "RECENT LABS SUMMARY (MOST RECENT FIRST)",
  "RECENT LABS SUMMARY",
  "LAB TREND TABLES (MOST RECENT FIRST)",
  "LAB TREND TABLES",
  "IMAGING AND DIAGNOSTIC PROCEDURES",
  "IMAGING",
  "DIAGNOSTIC PROCEDURES",
  "CBC",
  "RENAL",
  "RENAL / ELECTROLYTES",
  "LIVER",
  "ENDOCRINE",
  "GLUCOSE / NUTRITION",
  "COAGULATION",
  "LIPIDS",
  "URINE / KIDNEY RISK",
]);

const PMH_FIELD_PREFIXES = [
  "Current status or brief chronological course",
  "Current status",
  "Medications - Current",
  "Medications - Past",
  "Past",
  "Lab trends relevant",
  "Recent control/trends",
  "Recent control",
  "Imaging/procedures",
  "Imaging",
  "Complications checked",
  "Complications",
  "Care team/Specialists",
  "Care team",
  "What this means now",
  "Status notes",
  "Consult",
];

const KEY_DX_BODY_LABELS = [
  "CLINICAL SIGNIFICANCE AT THIS VISIT",
  "BACKGROUND AND CONTEXT",
  "MEDICATIONS CONTEXT",
  "COMPLICATING FACTORS",
  "DIAGNOSTICS/PROCEDURES",
  "SUGGESTED PLAN ELEMENTS FOR PROVIDER TO CONSIDER",
  "CARE COORDINATION",
  "ASSOCIATED MEDICATIONS",
  "PRIOR THERAPIES TIMELINE",
  "FOLLOW-UP / MONITORING",
  "LONGITUDINAL DIAGNOSIS HISTORY:",
  "MOST RECENT CONSULTANT NOTE REVIEW:",
  "MOST RECENT MANAGING NOTE:",
];

function normalizeSpaces(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[ \t]+$/g, "")
    .replace(/^[ \t]+/g, (spaces) => spaces.replace(/\t/g, "  "));
}



// Strip a C-CDA hospital record dump if one is appended to the prenote.
// These dumps start with markers like "Print\nContinuity of Care Document",
// "Creation Date:", "Table of Contents", or "[-] Patient & Contact Information"
// and can be 50K+ characters of machine-generated tables. They cause
// catastrophic regex backtracking in the parser and are not useful for
// teaching content generation.
function stripCcdaAppendix(text) {
  if (!text) return text;

  const markers = [
    /\nPrint\s*\nContinuity of Care Document/i,
    /\nContinuity of Care Document\s*\nCreation Date:/i,
    /\n\[-\]\s+Patient\s*&\s*Contact Information/i,
    /\n\[-\]\s+Table of Contents/i,
    /\nCreation Date:\s*[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/i,
    /\n\[-\]\s+Encounter\b/i,
    /\n\[-\]\s+Allergies, Adverse Reactions, Alerts/i,
  ];

  let earliest = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && match.index < earliest) {
      earliest = match.index;
    }
  }

  if (earliest < text.length) {
    const stripped = text.length - earliest;
    console.warn(
      `[prenoteParser] Stripped ${stripped} characters of C-CDA appendix from prenote (parser and AI would choke on it).`
    );
    return text.slice(0, earliest).trim();
  }

  return text;
}

// Some LLM outputs collapse the entire prenote into one giant line separated
// by spaces rather than newlines. Reintroduce structural newlines so downstream
// parsers (which expect line-oriented input) work correctly.
function reintroduceStructuralNewlines(text) {
  let t = text;

  // IMPORTANT: every inline-boundary expression below uses horizontal
  // whitespace only. Using \s here also matches existing newlines, which
  // previously stripped indentation from nested bullets and split normal
  // lines such as "- Living status: ..." into an orphan dash plus a value.

  // Convert triple-backtick fences to newlines
  t = t.replace(/```[a-z0-9_-]*\s*/gi, "\n");
  t = t.replace(/```/g, "\n");

  // Break before markdown headers (## Foo, ### Bar) that appear inline
  t = t.replace(/[ \t]+(#{1,6}\s+[A-Z])/g, "\n$1");

  // Break before bullet markers that appear inline: " - " or " * "
  // Only trigger when preceded by 2+ spaces (avoids breaking natural
  // hyphens like "hot-cold" or asterisks inside words)
  t = t.replace(/([^\n])[ \t]{2,}([-*])\s+(?=[A-Z0-9])/g, "$1\n$2 ");

  // Break before well-known section headers when they appear inline
  const knownSectionHeaders = [
    "PRENOTE", "WHAT TO KNOW ABOUT", "UPDATES / RECENT VISITS",
    "PAST MEDICAL HISTORY", "SOCIAL HISTORY", "SOCIAL", "FAMILY HISTORY",
    "ALLERGIES", "SURGICAL HISTORY", "MILITARY HISTORY",
    "MED REC", "MEDICATION RECONCILIATION",
    "CURRENT MEDICATIONS", "RECENTLY DISCONTINUED", "SIGNIFICANT HISTORICAL MEDICATIONS",
    "PREVENTIVE MEDICINE", "VITAL SIGNS TRENDS", "VITAL SIGNS",
    "DIAGNOSTICS", "LAB TRENDS", "IMAGING AND DIAGNOSTIC PROCEDURES",
    "KEY DIAGNOSES", "FOLLOW-UP",
  ];
  for (const header of knownSectionHeaders) {
    // Match " HEADER " when it's not already at line start
    const re = new RegExp(`[ \\t]+(${header.replace(/\//g, "\\/")})(?=\\s|:)`, "g");
    t = t.replace(re, "\n$1");
  }

  // Break before pipe-delimited table rows (COLLECTION | ... or similar)
  // when they appear inline
  t = t.replace(/[ \t]+(COLLECTION\s*\|)/gi, "\n$1");
  // Also break before rows that start with a date like "07/2026 |"
  t = t.replace(/[ \t]+(\d{1,2}\/\d{4}\s*\|)/g, "\n$1");
  t = t.replace(/[ \t]+(\d{1,2}\/\d{1,2}\/\d{2,4}\s*\|)/g, "\n$1");

  // Break before common PMH field labels that appear inline
  const knownFieldLabels = [
    "Current status", "Current status or brief chronological course",
    "Medications - Current", "Medications - Past",
    "Past:", "Lab trends relevant", "Recent control", "Recent control/trends",
    "Imaging/procedures", "Complications checked", "Care team",
    "What this means now", "Status notes", "Consult:",
  ];
  for (const label of knownFieldLabels) {
    const re = new RegExp(`[ \\t]+(${label.replace(/[-\/]/g, m => "\\" + m)})(?=\\s|:)`, "g");
    t = t.replace(re, "\n$1");
  }

  // The inline-field pass above can split a normal bullet such as
  // "* Current status: ..." into an orphan "*" line followed by the field.
  // Reattach those markers before the line-oriented PMH parser runs.
  const knownFieldSource = knownFieldLabels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  t = t.replace(
    new RegExp(`^\\s*([*-])\\s*\\n\\s*(?=(?:${knownFieldSource})(?:\\s|:))`, "gim"),
    "$1 ",
  );


  // Break before "Living status:", "Marital status:", etc. in social section
  const socialLabels = [
    "Living status", "Marital status", "Religion", "Alcohol", "Tobacco",
    "IVDA", "Employment", "Housing", "Support system",
  ];
  for (const label of socialLabels) {
    const re = new RegExp(`[ \\t]+(${label})(?=:)`, "g");
    t = t.replace(re, "\n$1");
  }

  // Reattach source bullets when a social label was split after an existing
  // marker, for example "- Living status: ...". Without this cleanup the
  // exported document shows an orphan dash followed by an unbulleted value.
  const socialFieldSource = socialLabels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  t = t.replace(
    new RegExp(`^\\s*([-*•])\\s*\\n\\s*(?=(?:${socialFieldSource}):)`, "gim"),
    "$1 ",
  );

  // Break before common vital-sign labels
  const vitalLabels = ["BP:", "HR:", "Pulse:", "Temp:", "SpO2:", "Wt:", "Weight:", "BMI:", "Resp:"];
  for (const label of vitalLabels) {
    const re = new RegExp(`[ \\t]+(${label.replace(/:/g, "")})(?=:)`, "g");
    t = t.replace(re, "\n$1");
  }

  // Break before date-prefixed timeline entries: "07/13/26:" or "07/13/26 "
  t = t.replace(/[ \t]+(\d{1,2}\/\d{1,2}\/\d{2,4}:\s)/g, "\n$1");

  // Collapse runs of 3+ newlines to 2
  t = t.replace(/\n{3,}/g, "\n\n");

  return t;
}

export function normalizePrenoteText(input) {
  const normalized = String(input ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeSpaces)
    .join("\n");

  // Reintroduce structural newlines if the LLM collapsed the prenote into
  // one giant line separated by spaces.
  const structured = reintroduceStructuralNewlines(normalized);

  return stripCcdaAppendix(structured);
}

function normalizeHeading(value) {
  return String(value ?? "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:$/, "")
    .toUpperCase();
}

function dividerKind(line) {
  const match = String(line ?? "").match(DIVIDER_RE);
  if (!match) return null;
  if (match[1] === "=") return "major";
  if (match[1] === "-") return "minor";
  return "dotted";
}

function nextNonBlankIndex(lines, from, maxDistance = 6) {
  const end = Math.min(lines.length, from + maxDistance + 1);
  for (let i = from; i < end; i += 1) {
    if (String(lines[i] ?? "").trim()) return i;
  }
  return -1;
}

function previousNonBlankIndex(lines, from, maxDistance = 6) {
  const start = Math.max(-1, from - maxDistance - 1);
  for (let i = from; i > start; i -= 1) {
    if (String(lines[i] ?? "").trim()) return i;
  }
  return -1;
}

function canonicalSectionKey(heading) {
  const normalized = normalizeHeading(heading);
  for (const definition of SECTION_DEFINITIONS) {
    if (definition.match(normalized)) return definition.key;
  }
  return null;
}

function isDiagnosticsSelfCheck(heading) {
  return normalizeHeading(heading) === "DIAGNOSTICS SELF-CHECK";
}

function isKnownDiagnosticsSubsection(heading) {
  return DIAGNOSTIC_SUBSECTION_NAMES.has(normalizeHeading(heading));
}

function isLikelyTableLine(line) {
  const value = String(line ?? "").trim();
  return value.includes("|") && value.split("|").length >= 2;
}

function isBulletLine(line) {
  return /^\s*(?:[-*]|\u2022)\s+/.test(String(line ?? ""));
}

function isPmhFieldLine(line) {
  const value = String(line ?? "").replace(/^\s*[*-]\s*/, "").trim();
  return PMH_FIELD_PREFIXES.some((label) =>
    value.toLowerCase().startsWith(`${label.toLowerCase()}:`),
  );
}

function isKeyDxBodyLabel(line) {
  const normalized = normalizeHeading(String(line ?? "").replace(/^\s*[-*]\s*/, ""));
  return KEY_DX_BODY_LABELS.some((label) => normalized.startsWith(label));
}

function parseBoxAt(lines, index) {
  const kind = dividerKind(lines[index]);
  if (!kind) return null;

  const first = nextNonBlankIndex(lines, index + 1, 4);
  if (first < 0 || dividerKind(lines[first])) return null;

  const second = nextNonBlankIndex(lines, first + 1, 4);
  if (second < 0) return null;

  // Key diagnosis box: divider, diagnosis, status, divider.
  if (KEY_DX_STATUS_RE.test(lines[second])) {
    const close = nextNonBlankIndex(lines, second + 1, 4);
    if (close >= 0 && dividerKind(lines[close]) === kind) {
      const statusMatch = lines[second].match(KEY_DX_STATUS_RE);
      return {
        type: "diagnosis",
        kind,
        start: index,
        headingStart: first,
        headingEnd: second,
        end: close,
        title: lines[first].trim(),
        status: statusMatch?.[1] ?? "",
      };
    }
  }

  // Standard box: divider, one heading line, matching divider.
  if (dividerKind(lines[second]) === kind) {
    const inlineDiagnosis = String(lines[first] ?? "").match(INLINE_KEY_DX_RE);
    if (inlineDiagnosis) {
      return {
        type: "diagnosis",
        kind,
        start: index,
        headingStart: first,
        headingEnd: first,
        end: second,
        title: inlineDiagnosis[1].trim(),
        status: inlineDiagnosis[2],
      };
    }

    return {
      type: "heading",
      kind,
      start: index,
      headingStart: first,
      headingEnd: first,
      end: second,
      title: lines[first].trim(),
      status: "",
    };
  }

  return null;
}

function parseMarkdownHeadingAt(lines, index) {
  const match = String(lines[index] ?? "").match(MARKDOWN_HEADING_RE);
  if (!match) return null;
  return {
    type: "markdown",
    kind: "markdown",
    start: index,
    headingStart: index,
    headingEnd: index,
    end: index,
    title: match[1].trim(),
    status: "",
  };
}

function parseInlineDiagnosisAt(lines, index) {
  const match = String(lines[index] ?? "").match(INLINE_KEY_DX_RE);
  if (!match) return null;
  return {
    type: "diagnosis",
    kind: "inline",
    start: index,
    headingStart: index,
    headingEnd: index,
    end: index,
    title: match[1].trim(),
    status: match[2],
  };
}

function hasDiagnosisBodyEvidence(lines, index) {
  for (let i = index + 1; i < Math.min(lines.length, index + 8); i += 1) {
    const value = String(lines[i] ?? "").trim();
    if (!value) continue;
    if (isKeyDxBodyLabel(value)) return true;
    if (dividerKind(value) || canonicalSectionKey(value)) return false;
  }
  return false;
}

function parseStandaloneDiagnosisAt(lines, index) {
  const value = String(lines[index] ?? "").trim();
  if (!value || isBulletLine(value) || isLikelyTableLine(value)) return null;
  if (!ICD_AT_END_RE.test(value)) return null;

  // This function is only called while DIAGNOSTICS is open. A plain,
  // non-bulleted line ending in a valid ICD code is therefore a safe signal
  // that diagnostic content has ended and a diagnosis block has begun.
  return {
    type: "diagnosis",
    kind: "standalone",
    start: index,
    headingStart: index,
    headingEnd: index,
    end: index,
    title: value,
    status: "",
  };
}

// Recognize a naked section heading — a line by itself matching one of the
// known section names, without divider box wrapping. Used when the LLM
// generating the prenote skipped the divider format.
//
// Rules:
// - Line must contain ONLY the heading text (optional trailing colon)
// - Accept both ALL CAPS ("SOCIAL") and Title Case ("Social History")
// - Must not be inside a divider box (identifyStructuralToken checks
//   parseBoxAt first, so if we got here it's a naked line)
// - Adjacent lines must NOT be divider chars (that would be a box we
//   should let parseBoxAt handle)
function parseNakedHeadingAt(lines, index) {
  const raw = String(lines[index] ?? "").trim();
  if (!raw) return null;
  if (raw.length > 60) return null;

  // Strip trailing colon
  const stripped = raw.replace(/:\s*$/, "").trim();
  if (!stripped) return null;

  // Reject if line contains anything that looks like content (numbers,
  // lowercase words in ALL CAPS mode with mixed content, etc.)
  // Allow letters, spaces, /, &, -, and periods for things like "PAST MEDICAL HISTORY"
  if (!/^[A-Za-z][A-Za-z0-9 /&.\-']*$/.test(stripped)) return null;

  // Must map to a canonical section key
  const key = canonicalSectionKey(stripped);
  if (!key) return null;

  // Guard: if previous or next non-blank line is a divider, this line is
  // the interior of a box — let parseBoxAt handle it, don't double-count.
  const prev = previousNonBlankIndex(lines, index - 1, 3);
  const next = nextNonBlankIndex(lines, index + 1, 3);
  if (prev >= 0 && dividerKind(lines[prev])) return null;
  if (next >= 0 && dividerKind(lines[next])) return null;

  return {
    type: "heading",
    kind: "naked",
    start: index,
    headingStart: index,
    headingEnd: index,
    end: index,
    title: stripped,
    status: "",
  };
}

function identifyStructuralToken(lines, index) {
  // Standalone ICD diagnosis lines are intentionally not global structure.
  // PMH uses the same line shape. They are checked only while DIAGNOSTICS
  // is open, where they can legitimately signal the next diagnosis block.
  return (
    parseBoxAt(lines, index) ||
    parseMarkdownHeadingAt(lines, index) ||
    parseInlineDiagnosisAt(lines, index) ||
    parseNakedHeadingAt(lines, index)
  );
}

function trimSectionLines(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && !String(lines[start] ?? "").trim()) start += 1;
  while (end > start && !String(lines[end - 1] ?? "").trim()) end -= 1;

  return lines.slice(start, end);
}

function pushSectionOccurrence(store, key, occurrence) {
  if (!store[key]) store[key] = [];
  const cleanedLines = trimSectionLines(occurrence.lines);
  store[key].push({
    ...occurrence,
    lines: cleanedLines,
    text: cleanedLines.join("\n").trim(),
  });
}

function stripPauseMarkers(lines) {
  return lines.map((line) => (PAUSE_RE.test(line) ? "" : line));
}

function shouldEndDiagnostics(token) {
  if (!token) return false;
  if (token.type === "diagnosis") return true;
  if (isDiagnosticsSelfCheck(token.title)) return true;

  const key = canonicalSectionKey(token.title);
  return Boolean(key && DIAGNOSTICS_HARD_END_KEYS.has(key));
}

function chooseTargetSection(currentKey, token) {
  if (!token) return currentKey;

  if (token.type === "diagnosis") return "keyDiagnoses";

  const key = canonicalSectionKey(token.title);
  if (key) return key;

  if (isDiagnosticsSelfCheck(token.title)) return null;

  return currentKey;
}

function tokenIsSectionHeading(token) {
  if (!token || token.type === "diagnosis") return false;
  return Boolean(canonicalSectionKey(token.title));
}

function tokenIsSubsection(token, currentKey) {
  if (!token || token.type === "diagnosis") return false;
  if (tokenIsSectionHeading(token)) return false;
  if (currentKey === "diagnostics" && isKnownDiagnosticsSubsection(token.title)) {
    return true;
  }
  return token.kind === "minor" || token.kind === "dotted" || token.kind === "markdown";
}

/**
 * Find divider boxes and recognized headings without assigning content.
 */
export function scanPrenoteStructure(input) {
  const normalizedText = normalizePrenoteText(input);
  const lines = normalizedText.split("\n");
  const tokens = [];

  for (let i = 0; i < lines.length; i += 1) {
    const token = identifyStructuralToken(lines, i);
    if (!token) continue;

    tokens.push({
      ...token,
      sectionKey:
        token.type === "diagnosis" ? "keyDiagnoses" : canonicalSectionKey(token.title),
      diagnosticsSelfCheck: isDiagnosticsSelfCheck(token.title),
    });

    i = Math.max(i, token.end);
  }

  return {
    normalizedText,
    lines,
    tokens,
  };
}

/**
 * Parse major prenote sections. Section headings and outer divider lines are
 * not included in section text; internal subsection headings are preserved.
 */
export function extractPrenoteSections(input) {
  const { normalizedText, lines: originalLines, tokens } =
    scanPrenoteStructure(input);
  const lines = stripPauseMarkers(originalLines);
  const tokenByStart = new Map(tokens.map((token) => [token.start, token]));
  const occurrences = {};

  let currentKey = null;
  let currentStart = -1;
  let currentHeader = null;
  let currentLines = [];

  const flush = (endLineExclusive) => {
    if (!currentKey) {
      currentLines = [];
      return;
    }

    pushSectionOccurrence(occurrences, currentKey, {
      key: currentKey,
      header: currentHeader?.title ?? "",
      startLine: currentStart + 1,
      endLine: endLineExclusive,
      lines: currentLines,
    });

    currentLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    let token = tokenByStart.get(i);

    if (!token && currentKey === "diagnostics") {
      token = parseStandaloneDiagnosisAt(lines, i);
    }

    if (!token) {
      if (currentKey) currentLines.push(lines[i]);
      continue;
    }

    if (currentKey === "diagnostics" && shouldEndDiagnostics(token)) {
      flush(i);
      currentKey = null;
      currentStart = -1;
      currentHeader = null;

      if (isDiagnosticsSelfCheck(token.title)) {
        i = token.end;
        continue;
      }
    }

    if (token.type === "diagnosis") {
      if (currentKey !== "keyDiagnoses") {
        flush(i);
        currentKey = "keyDiagnoses";
        currentStart = token.start;
        currentHeader = {
          title: "KEY DIAGNOSES",
        };
      }

      // Preserve diagnosis header text but not its visual divider lines.
      currentLines.push(
        token.status
          ? `${token.title} [${token.status}]`
          : token.title,
      );
      i = token.end;
      continue;
    }

    const sectionKey = canonicalSectionKey(token.title);

    if (sectionKey) {
      flush(i);
      currentKey = sectionKey;
      currentStart = token.start;
      currentHeader = token;
      currentLines = [];
      i = token.end;
      continue;
    }

    if (isDiagnosticsSelfCheck(token.title)) {
      if (currentKey === "diagnostics") {
        flush(i);
        currentKey = null;
        currentStart = -1;
        currentHeader = null;
      }
      i = token.end;
      continue;
    }

    if (tokenIsSubsection(token, currentKey)) {
      if (currentKey) {
        currentLines.push(token.title);
      }
      i = token.end;
      continue;
    }

    // Unrecognized major box: preserve it inside the current section instead
    // of silently dropping content.
    if (currentKey) {
      currentLines.push(token.title);
    }
    i = token.end;
  }

  flush(lines.length);

  // Similarity-based dedup helpers. When a section appears in Part 1 and
  // Part 2 of a summary, or repeats with minor whitespace differences, keep
  // only the first occurrence. This prevents visible artifacts like
  // "Appendectomy - 2010 - Appendectomy - 2010" from bleeding into the doc.
  const normalizeForCompare = (text) =>
    String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const bodiesAreSimilar = (a, b) => {
    const normA = normalizeForCompare(a);
    const normB = normalizeForCompare(b);
    if (!normA || !normB) return false;
    if (normA === normB) return true;

    const shorter = normA.length <= normB.length ? normA : normB;
    const longer = shorter === normA ? normB : normA;
    if (longer.includes(shorter)) return true;

    const tokensA = new Set(normA.split(" ").filter((t) => t.length > 2));
    const tokensB = new Set(normB.split(" ").filter((t) => t.length > 2));
    if (tokensA.size === 0 || tokensB.size === 0) return false;

    const smaller = tokensA.size <= tokensB.size ? tokensA : tokensB;
    const larger = smaller === tokensA ? tokensB : tokensA;
    let shared = 0;
    smaller.forEach((t) => {
      if (larger.has(t)) shared++;
    });
    return shared / smaller.size >= 0.85;
  };

  const sections = {};
  const sectionOrder = SECTION_DEFINITIONS.map((definition) => definition.key);
  for (const key of sectionOrder) {
    const parts = occurrences[key] ?? [];
    const uniqueTexts = [];
    for (const part of parts) {
      const bodyText = part.text;
      if (!bodyText) continue;

      const text =
        key === "specialtyCare" && part.header
          ? `${String(part.header).replace(/:\s*$/, "").trim()}:\n${bodyText}`
          : bodyText;

      if (uniqueTexts.some((existing) => bodiesAreSimilar(existing, text))) {
        continue; // silently drop duplicate
      }
      uniqueTexts.push(text);
    }
    sections[key] = uniqueTexts.join("\n\n");
  }

  return {
    normalizedText,
    sections,
    occurrences,
    tokens,
  };
}

function normalizeProblemStatus(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isRecognizedProblemStatus(value) {
  return STATUS_VALUES.includes(normalizeProblemStatus(value));
}

const ICD_LIST_RE = new RegExp(
  `^${ICD_CODE_SOURCE}(?:\\s*,\\s*${ICD_CODE_SOURCE})*$`,
  "i",
);

const PROBLEM_STATUS_SOURCE = STATUS_VALUES
  .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const ICD_AND_STATUS_RE = new RegExp(
  `^(${ICD_CODE_SOURCE}(?:\\s*,\\s*${ICD_CODE_SOURCE})*)\\s*[-,]\\s*(${PROBLEM_STATUS_SOURCE})$`,
  "i",
);

// Parse one or more trailing parentheticals. Real prenotes commonly use:
//   Diagnosis (F43.12) (Active/Changing)
//   Diagnosis (F43.12, F41.9) (Stable/Chronic)
//   Diagnosis (F43.12 - Active/Changing)
// Unrecognized trailing parentheticals are preserved as part of the diagnosis
// name rather than silently discarded.
function splitTrailingParenthetical(header) {
  const original = String(header ?? "").trim();
  let remaining = original;
  const suffixes = [];

  while (true) {
    const match = remaining.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!match) break;
    suffixes.unshift(match[2].trim());
    remaining = match[1].trim();
  }

  if (suffixes.length === 0) {
    return { name: original, code: "", status: "" };
  }

  const codes = [];
  const unrecognized = [];
  let status = "";

  for (const suffix of suffixes) {
    if (isRecognizedProblemStatus(suffix)) {
      status = status || suffix;
      continue;
    }

    if (ICD_LIST_RE.test(suffix)) {
      codes.push(...suffix.split(/\s*,\s*/).filter(Boolean));
      continue;
    }

    const combined = suffix.match(ICD_AND_STATUS_RE);
    if (combined) {
      codes.push(...combined[1].split(/\s*,\s*/).filter(Boolean));
      status = status || combined[2];
      continue;
    }

    unrecognized.push(suffix);
  }

  const preservedSuffixes = unrecognized.map((value) => `(${value})`).join(" ");
  const name = [remaining, preservedSuffixes].filter(Boolean).join(" ").trim();

  return {
    name: name || original,
    code: [...new Set(codes)].join(", "),
    status,
  };
}

function parseLabelValue(line) {
  const value = String(line ?? "").replace(/^\s*[*-]\s*/, "").trim();
  const colon = value.indexOf(":");
  if (colon < 0) return null;

  return {
    label: value.slice(0, colon).trim(),
    value: value.slice(colon + 1).trim(),
  };
}

function canonicalPmhFieldLabel(label) {
  const normalized = String(label ?? "").toLowerCase().trim();
  if (!normalized) return null;

  const match = PMH_FIELD_PREFIXES.find((candidate) => {
    const normalizedCandidate = candidate.toLowerCase();
    return (
      normalized === normalizedCandidate ||
      normalized.startsWith(`${normalizedCandidate} `) ||
      normalized.startsWith(`${normalizedCandidate}/`)
    );
  });

  return match || null;
}

// Real PMH problem headers may contain one or more trailing parentheticals,
// including separate ICD and status groups. Header validity is determined by
// splitTrailingParenthetical(), not by a single-parenthetical regex.
function parsePmhProblemHeaderValue(value) {
  const parsed = splitTrailingParenthetical(value);
  if (!parsed.name || (!parsed.code && !parsed.status)) return null;
  if (!/^[A-Z]/.test(parsed.name)) return null;
  if (parsed.name.length > 180) return null;
  return parsed;
}

function isPmhProblemHeader(lines, index) {
  const value = String(lines[index] ?? "").trim();
  if (!value) return false;
  if (isBulletLine(value) || isLikelyTableLine(value)) return false;
  if (dividerKind(value) || MARKDOWN_HEADING_RE.test(value)) return false;
  if (canonicalSectionKey(value)) return false;
  if (isPmhFieldLine(value)) return false;

  // Must contain at least one recognized ICD code or status, including
  // dual-suffix headers such as "Diagnosis (F43.12) (Active/Changing)".
  if (!parsePmhProblemHeaderValue(value)) return false;

  // Must be followed within a few lines by a bullet or a PMH field line
  // (its detail block), otherwise it's just a mention, not a section header.
  const next = nextNonBlankIndex(lines, index + 1, 5);
  if (next < 0) return false;

  return isBulletLine(lines[next]) || isPmhFieldLine(lines[next]);
}

/**
 * PMH conditions are identified from their plain, non-bulleted header line.
 * Detail bullets belong to the condition block and can never become problems.
 */
export function parsePmhProblemBlocks(pmhText) {
  const lines = normalizePrenoteText(pmhText).split("\n");
  const blocks = [];
  let current = null;

  const finish = () => {
    if (!current) return;

    const fields = {};
    const unstructuredDetails = [];
    let currentFieldLabel = null;

    const appendFieldText = (label, value) => {
      const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
      if (!cleaned) return;
      fields[label] = [fields[label], cleaned].filter(Boolean).join(" ").trim();
    };

    for (const line of current.detailLines) {
      const raw = String(line ?? "");
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const parsed = parseLabelValue(raw);
      const recognizedLabel = parsed
        ? canonicalPmhFieldLabel(parsed.label)
        : null;

      if (parsed && recognizedLabel) {
        // Preserve the source label so existing consumers such as
        // readPrenoteProblemField() continue to work unchanged.
        currentFieldLabel = parsed.label.trim();
        appendFieldText(currentFieldLabel, parsed.value);
        continue;
      }

      const cleanedLine = raw.replace(/^\s*[*-]\s*/, "").trim();

      // Wrapped continuation lines belong to the most recent PMH field. This
      // is essential because generated prenotes wrap long values across many
      // physical lines (for example Current status, Consult, and Care team).
      if (currentFieldLabel && !isBulletLine(raw)) {
        appendFieldText(currentFieldLabel, cleanedLine);
        continue;
      }

      currentFieldLabel = null;
      if (cleanedLine) unstructuredDetails.push(cleanedLine);
    }

    const parsedHeader = splitTrailingParenthetical(current.rawHeader);

    blocks.push({
      rawHeader: current.rawHeader,
      name: parsedHeader.name,
      code: parsedHeader.code,
      status: parsedHeader.status,
      fields,
      details: unstructuredDetails,
      rawText: [current.rawHeader, ...current.detailLines].join("\n").trim(),
    });

    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isPmhProblemHeader(lines, i)) {
      finish();
      current = {
        rawHeader: line.trim(),
        detailLines: [],
      };
      continue;
    }

    if (current) current.detailLines.push(line);
  }

  finish();
  return blocks;
}

function classifyMedRecSubsection(value) {
  const normalized = normalizeHeading(value);
  if (
    normalized === "CURRENT MEDICATIONS (GROUPED BY SPECIALTY)" ||
    normalized === "CURRENT MEDICATIONS" ||
    normalized === "CURRENT ACTIVE MEDICATIONS"
  ) {
    return "current";
  }
  if (normalized === "RECENTLY DISCONTINUED (PAST 6 MONTHS)" ||
      normalized === "RECENTLY DISCONTINUED") {
    return "discontinued";
  }
  if (
    normalized === "SIGNIFICANT HISTORICAL MEDICATIONS / TIMELINE" ||
    normalized === "SIGNIFICANT HISTORICAL MEDICATIONS" ||
    normalized === "HISTORICAL MEDICATIONS"
  ) {
    return "historical";
  }
  return null;
}

function cleanBullet(value) {
  return String(value ?? "").replace(/^\s*[-*]\s*/, "").trim();
}

/**
 * Parse MED REC while preserving specialty grouping and subsection status.
 */
export function parseMedicationReconciliation(medRecText) {
  const lines = normalizePrenoteText(medRecText).split("\n");
  const groups = [];
  const currentMedications = [];
  const discontinued = [];
  const historical = [];

  let subsection = "current";
  let specialty = "Unspecified";
  let lastMedication = null;

  const ensureGroup = (name) => {
    let group = groups.find((entry) => entry.specialty === name);
    if (!group) {
      group = { specialty: name, medications: [] };
      groups.push(group);
    }
    return group;
  };

  for (const rawLine of lines) {
    const value = String(rawLine ?? "").trim();
    if (!value) continue;

    const markdown = value.match(MARKDOWN_HEADING_RE);
    const subsectionValue = classifyMedRecSubsection(markdown?.[1] ?? value);
    if (subsectionValue) {
      subsection = subsectionValue;
      lastMedication = null;
      continue;
    }

    if (
      subsection === "current" &&
      /^-\s+.+:\s*$/.test(value) &&
      !/^(?:-\s+)?(?:reason|context):/i.test(value)
    ) {
      specialty = cleanBullet(value).replace(/:\s*$/, "").trim() || "Unspecified";
      ensureGroup(specialty);
      lastMedication = null;
      continue;
    }

    if (/^\s*\*\s+/.test(rawLine)) {
      const medication = cleanBullet(rawLine);
      const record = {
        text: medication,
        specialty,
        subsection,
        notes: [],
      };

      if (subsection === "current") {
        currentMedications.push(record);
        ensureGroup(specialty).medications.push(record);
      } else if (subsection === "discontinued") {
        discontinued.push(record);
      } else {
        historical.push(record);
      }

      lastMedication = record;
      continue;
    }

    if (/^-\s+/.test(value)) {
      const medication = cleanBullet(value);
      const record = {
        text: medication,
        specialty,
        subsection,
        notes: [],
      };

      if (subsection === "current") {
        currentMedications.push(record);
        ensureGroup(specialty).medications.push(record);
      } else if (subsection === "discontinued") {
        discontinued.push(record);
      } else {
        historical.push(record);
      }

      lastMedication = record;
      continue;
    }

    if (lastMedication) {
      lastMedication.notes.push(value);
    }
  }

  return {
    groups,
    current: currentMedications,
    discontinued,
    historical,
  };
}

function looksLikeCollectionHeader(cells) {
  return cells.length >= 2 && /^(?:COLLECTION|DATE)$/i.test(cells[0]);
}

function splitTableCells(line) {
  return String(line ?? "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Parse diagnostics without discarding prose or imaging content.
 */

/**
 * Parse Key Diagnosis blocks after section boundaries have been assigned.
 */
export function parseKeyDiagnosisBlocks(keyDiagnosesText) {
  const lines = normalizePrenoteText(keyDiagnosesText).split("\n");
  const blocks = [];
  let current = null;

  const headerRe =
    /^\s*(.+?)(?:\s+\.{2,})?\s+\[(Unstable\/New|Active\/Changing|Stable\/Chronic|Resolved)\]\s*$/i;

  const finish = () => {
    if (!current) return;
    const parsedHeader = splitTrailingParenthetical(current.rawHeader);
    blocks.push({
      rawHeader: current.rawHeader,
      name: parsedHeader.name,
      code: parsedHeader.code,
      status: current.status,
      lines: trimSectionLines(current.lines),
      rawText: [
        `${current.rawHeader} [${current.status}]`,
        ...trimSectionLines(current.lines),
      ].join("\n").trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const match = String(line ?? "").trim().match(headerRe);
    if (match) {
      finish();
      current = {
        rawHeader: match[1].trim(),
        status: match[2],
        lines: [],
      };
      continue;
    }

    if (current) current.lines.push(line);
  }

  finish();
  return blocks;
}

export function parseDiagnosticsContent(diagnosticsText) {
  const lines = normalizePrenoteText(diagnosticsText).split("\n");
  const tables = [];
  const subsections = [];
  const imaging = [];
  const unclassified = [];

  let currentSubsection = "";
  let currentImagingStudy = null;

  for (let i = 0; i < lines.length; i += 1) {
    const value = String(lines[i] ?? "").trim();
    if (!value) continue;

    if (
      isKnownDiagnosticsSubsection(value) ||
      normalizeHeading(value) === "IMAGING AND DIAGNOSTIC PROCEDURES"
    ) {
      currentSubsection = value;
      subsections.push({
        title: value,
        startLine: i + 1,
      });
      currentImagingStudy = null;
      continue;
    }

    if (isLikelyTableLine(value)) {
      const firstCells = splitTableCells(value);
      if (looksLikeCollectionHeader(firstCells)) {
        const rawLines = [value];
        const rows = [];
        let j = i + 1;

        while (j < lines.length && isLikelyTableLine(lines[j])) {
          const rowCells = splitTableCells(lines[j]);
          rawLines.push(String(lines[j]).trim());
          rows.push(rowCells);
          j += 1;
        }

        const previous = previousNonBlankIndex(lines, i - 1, 2);
        const possibleTitle =
          previous >= 0 &&
          !isBulletLine(lines[previous]) &&
          !isLikelyTableLine(lines[previous]) &&
          !isKnownDiagnosticsSubsection(lines[previous])
            ? String(lines[previous]).trim()
            : "";

        tables.push({
          title: possibleTitle,
          subsection: currentSubsection,
          columns: firstCells,
          rows: rows.map((cells) =>
            Object.fromEntries(
              firstCells.map((column, columnIndex) => [
                column,
                cells[columnIndex] ?? "--",
              ]),
            ),
          ),
          rawText: rawLines.join("\n"),
        });

        i = j - 1;
        continue;
      }
    }

    const inImaging =
      normalizeHeading(currentSubsection) ===
      "IMAGING AND DIAGNOSTIC PROCEDURES";

    if (inImaging) {
      if (!isBulletLine(value) && !isLikelyTableLine(value)) {
        currentImagingStudy = {
          studyType: value,
          entries: [],
        };
        imaging.push(currentImagingStudy);
        continue;
      }

      if (currentImagingStudy) {
        currentImagingStudy.entries.push(cleanBullet(value));
        continue;
      }
    }

    unclassified.push(value);
  }

  return {
    rawText: normalizePrenoteText(diagnosticsText).trim(),
    subsections,
    tables,
    imaging,
    unclassified,
  };
}

function normalizedProblemKey(problem) {
  const source = String(
    problem?.name ?? problem?.problem ?? problem?.rawHeader ?? "",
  );
  const parsed = splitTrailingParenthetical(source);

  return parsed.name
    .toLowerCase()
    .replace(/\b(?:active|changing|stable|chronic|resolved|controlled|uncontrolled|suspected|remission|registry|unknown|historical|inactive)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic PMH conditions are authoritative for presence. AI problem
 * metadata may enrich those conditions, but cannot remove them.
 */
export function mergeProblemsDeterministically(pmhProblems, aiProblems = []) {
  const aiByName = new Map();

  for (const problem of Array.isArray(aiProblems) ? aiProblems : []) {
    const key = normalizedProblemKey(problem);
    if (key) aiByName.set(key, problem);
  }

  const merged = [];
  const usedAiKeys = new Set();

  for (const problem of Array.isArray(pmhProblems) ? pmhProblems : []) {
    const key = normalizedProblemKey(problem);
    const aiMatch = aiByName.get(key);
    if (aiMatch) usedAiKeys.add(key);

    merged.push({
      ...(aiMatch ?? {}),
      ...problem,
      source: aiMatch ? "prenote+ai" : "prenote",
    });
  }

  for (const problem of Array.isArray(aiProblems) ? aiProblems : []) {
    const key = normalizedProblemKey(problem);
    if (!key || usedAiKeys.has(key)) continue;
    merged.push({
      ...problem,
      source: "ai",
    });
  }

  return merged;
}

/**
 * Build the labeled AI input from deterministic slices. This replaces any
 * "essential note" reducer that drops MED REC, diagnostics, PMH, or history.
 */
export function buildPrenoteAiInput(parsedPrenote) {
  const sections = parsedPrenote?.sections ?? {};
  const labels = [
    ["WHAT TO KNOW", sections.whatToKnow],
    ["UPDATES / RECENT VISITS", sections.recentVisits],
    ["PAST MEDICAL HISTORY", sections.pastMedicalHistory],
    ["SOCIAL", sections.social],
    ["FAMILY HISTORY", sections.familyHistory],
    ["ALLERGIES", sections.allergies],
    ["SURGICAL HISTORY", sections.surgicalHistory],
    ["MILITARY HISTORY", sections.militaryHistory],
    ["MED REC", sections.medRec],
    ["PREVENTIVE MEDICINE", sections.preventiveMedicine],
    ["VITAL SIGNS TRENDS", sections.vitalSigns],
    ["DIAGNOSTICS", sections.diagnostics],
    ["ACTIVE MEDICAL PROBLEMS & ASSESSMENTS", sections.activeMedicalProblems],
    ["KEY DIAGNOSES", sections.keyDiagnoses],
    ["FOLLOW-UP", sections.followUp],
  ];

  return labels
    .filter(([, value]) => String(value ?? "").trim())
    .map(([label, value]) => `===== ${label} =====\n${String(value).trim()}`)
    .join("\n\n");
}

/**
 * Main entry point for UI code.
 */
export function parsePrenote(input, aiData = {}) {
  const extracted = extractPrenoteSections(input);
  const pmhProblems = parsePmhProblemBlocks(
    extracted.sections.pastMedicalHistory,
  );
  const medications = parseMedicationReconciliation(
    extracted.sections.medRec,
  );
  const diagnostics = parseDiagnosticsContent(
    extracted.sections.diagnostics,
  );
  const keyDiagnosisBlocks = parseKeyDiagnosisBlocks(
    extracted.sections.keyDiagnoses,
  );

  const aiProblems =
    aiData?.activeProblems ??
    aiData?.problems ??
    aiData?.medicalProblems ??
    [];

  return {
    ...extracted,
    problems: mergeProblemsDeterministically(pmhProblems, aiProblems),
    pmhProblems,
    medications,
    diagnostics,
    keyDiagnosisBlocks,
    aiInput: buildPrenoteAiInput(extracted),
  };
}

export default parsePrenote;
