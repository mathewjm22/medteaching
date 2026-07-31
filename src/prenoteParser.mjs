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
  "resolved",
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
    match: (value) => value === "SOCIAL",
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
      value === "CURRENT ACTIVE MEDICATIONS",
  },
  {
    key: "preventiveMedicine",
    match: (value) => value === "PREVENTIVE MEDICINE",
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
    match: (value) => value === "DIAGNOSTICS",
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
  "Medications - Current",
  "Past",
  "Lab trends relevant",
  "Recent control/trends",
  "Imaging/procedures",
  "Complications checked",
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

export function normalizePrenoteText(input) {
  return String(input ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normalizeSpaces)
    .join("\n");
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

function identifyStructuralToken(lines, index) {
  // Standalone ICD diagnosis lines are intentionally not global structure.
  // PMH uses the same line shape. They are checked only while DIAGNOSTICS
  // is open, where they can legitimately signal the next diagnosis block.
  return (
    parseBoxAt(lines, index) ||
    parseMarkdownHeadingAt(lines, index) ||
    parseInlineDiagnosisAt(lines, index)
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

  const sections = {};
  const sectionOrder = SECTION_DEFINITIONS.map((definition) => definition.key);
  for (const key of sectionOrder) {
    const parts = occurrences[key] ?? [];
    sections[key] = parts
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n\n");
  }

  return {
    normalizedText,
    sections,
    occurrences,
    tokens,
  };
}

function splitTrailingParenthetical(header) {
  const match = String(header ?? "").trim().match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!match) {
    return {
      name: String(header ?? "").trim(),
      code: "",
      status: "",
    };
  }

  const name = match[1].trim();
  const trailing = match[2].trim();
  const codeMatch = trailing.match(new RegExp(`^${ICD_CODE_SOURCE}$`, "i"));
  if (codeMatch) {
    return {
      name,
      code: trailing,
      status: "",
    };
  }

  const normalizedStatus = trailing.toLowerCase();
  if (
    STATUS_VALUES.includes(normalizedStatus) ||
    /^(?:active|stable|chronic|resolved|historical|inactive)\b/i.test(trailing)
  ) {
    return {
      name,
      code: "",
      status: trailing,
    };
  }

  return {
    name: String(header ?? "").trim(),
    code: "",
    status: "",
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

// Real PMH problem headers in the prenote follow the exact form:
//   DiagnosisName (Status)
// where Status is one of the recognized status values (Active/Changing,
// Stable/Chronic, Resolved, etc.). We enforce this strictly to prevent
// fragments from bullet content, WHAT TO KNOW summaries, or wrapped
// continuation lines from being misidentified as problems.
const PMH_PROBLEM_HEADER_RE = new RegExp(
  `^([A-Z][^()\\n]{2,120})\\s*\\((` +
    STATUS_VALUES
      .map((s) => s.replace(/[/]/g, "\\/"))
      .join("|") +
    `)\\)\\s*$`,
  "i",
);

function isPmhProblemHeader(lines, index) {
  const value = String(lines[index] ?? "").trim();
  if (!value) return false;
  if (isBulletLine(value) || isLikelyTableLine(value)) return false;
  if (dividerKind(value) || MARKDOWN_HEADING_RE.test(value)) return false;
  if (canonicalSectionKey(value)) return false;
  if (isPmhFieldLine(value)) return false;

  // Must match the strict "DiagnosisName (Status)" pattern.
  if (!PMH_PROBLEM_HEADER_RE.test(value)) return false;

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

    for (const line of current.detailLines) {
      const parsed = parseLabelValue(line);
      if (parsed) {
        fields[parsed.label] = parsed.value;
      } else if (String(line ?? "").trim()) {
        unstructuredDetails.push(
          String(line).replace(/^\s*[*-]\s*/, "").trim(),
        );
      }
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
  return String(problem?.name ?? problem?.rawHeader ?? "")
    .toLowerCase()
    .replace(ICD_AT_END_RE, "")
    .replace(/[^a-z0-9]+/g, " ")
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
