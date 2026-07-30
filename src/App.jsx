import React, { useState, useEffect } from "react";
import { FileText, Printer, Copy, Check, Plus, X, BookOpen, Target, Stethoscope, Brain, ClipboardList, Users, TrendingUp, Save, Trash2, Sparkles, ChevronDown, ChevronRight, Calendar, User, AlertCircle, Zap, Loader2, Wand2 } from "lucide-react";

// ===== Hardcoded config =====
const WORKER_URL = "https://medteachingtool.sweet-dream-0ed6.workers.dev/";
const DEFAULT_MODEL = "gpt-oss-120b";
// ===== Doc title helper =====
// Used only for the exported HTML filename and the doc footer.
const deriveDocTitle = ({ workingDx, chiefConcern, sessionDate }) => {
  const date = sessionDate || new Date().toISOString().slice(0, 10);
  if (workingDx?.trim()) return `${workingDx.trim()} · ${date}`;
  if (chiefConcern?.trim()) {
    const short = chiefConcern.length > 40 ? chiefConcern.slice(0, 40).trim() + "…" : chiefConcern.trim();
    return `${short} · ${date}`;
  }
  return `Untitled · ${date}`;
};

// ===== PHI de-identification =====
// Client-side de-identification for VA prenotes. Runs a series of pattern
// passes and returns { deidentified, findings } where findings is a list
// of every change made (for the attending's preview panel).
//
// Rules per attending spec:
//   - Patient name → "Mr./Ms./Mx. [Initials]" (both first + last initial)
//   - Family members → "father", "mother", "brother", etc. — no names
//   - Physicians → KEPT as-is (they're not identifying the patient)
//   - Ages → KEPT as-is
//   - Dates → reduced to MM/YYYY
//   - Addresses, phones, MRNs, SSN-like numbers → REMOVED
//   - Pronoun-based sex detection with "they" fallback
//
// This is a best-effort tool. The attending MUST review the output before
// sending to the AI. Regex de-identification is ~90-95% reliable — the
// preview UI is where the last 5-10% gets caught.
const deidentifyPrenote = (rawText) => {
  if (!rawText || typeof rawText !== "string") return { deidentified: "", findings: [] };

  let text = rawText;
  const findings = [];
  const addFinding = (category, original, replacement, context = "") => {
    findings.push({ category, original, replacement, context: context.slice(0, 80) });
  };

  // ---- STEP 1: Detect the patient's name from the prenote ----
  // Real-world prenotes are messy: line breaks may or may not exist, headers
  // vary, EHR exports use "LAST, FIRST MIDDLE" order, human summaries use
  // "FIRST LAST" order. We collect ALL name candidates from multiple patterns
  // and replace every one — belt-and-suspenders.
  const candidateNames = new Set();

  const addCandidate = (nameStr) => {
    if (!nameStr) return;
    const cleaned = nameStr.trim().replace(/\s+/g, " ");
    if (cleaned.length < 3) return;
    // Reject if it's just a title + initial (already-anonymized artifact)
    if (/^(Mr|Ms|Mx|Mrs|Dr)\.?\s+[A-Z]{1,3}$/i.test(cleaned)) return;
    if (/^[A-Z]{2,4}$/.test(cleaned)) return;
    // Reject if any token is a common EHR header word that snuck through
    const badWords = /^(SUMMARY|VISIT|LAST|PRIMARY|CARE|DATE|PATIENT|NOTE|HISTORY|MEDICATION|PROBLEM|ASSESSMENT|PLAN|REVIEW|EXAM|VITALS|PRENOTE|ALLERGIES|SECTION|WHAT|KNOW|ABOUT|FOR|WITH|AND|THE|MEDICAL|CHART|RECENT|UPDATES|FOLLOW|CONTINUE|NONE|ACTIVE|SIGNIFICANT|BRANCH|SERVICE|DEPLOY|EXPOSURE|CURRENT|PAST|IMAGING|LAB|PANEL|COUNT|SIGN|PROCEDURE|COMPLETE|GENERAL|BEHAVIORAL|MENTAL|MHTC|BHIP|PMHNP|DSMV|DSM|CPG|CPAP|APAP|COPD|OSA|PTSD|ADHD|TSH|LDL|HDL|GFR|BMI|BP|HR)$/i;
    const tokens = cleaned.split(/\s+/);
    if (tokens.some(t => badWords.test(t))) return;
    candidateNames.add(cleaned);
  };

  // ---- Pattern set 1: Header phrases followed by names ----
  // These are triggers that reliably precede a patient name in VA prenotes.
    const triggers = [
    "Summary Since Last Visit for",
    "WHAT TO KNOW ABOUT",
    "Patient:",
    "PATIENT:",
    "Name:",
    "NAME:",
  ];

  triggers.forEach(trigger => {
    // Pattern A: LAST, FIRST [MIDDLE] — EHR comma-separated order
    // Match: trigger + optional title + LASTNAME + comma + FIRST [MIDDLE]
    // Allow 2+ character last names and first names; middle can be single initial
    const commaRe = new RegExp(
      `${escapeRegex(trigger)}\\s+(?:Mr\\.?|Ms\\.?|Mx\\.?|Mrs\\.?|Dr\\.?)?\\s*([A-Z][A-Z'\\-]{1,})\\s*,\\s*([A-Z][A-Z'\\-]+(?:\\s+[A-Z]\\.?(?:[A-Z'\\-]+)?)?)`,
      "g"
    );
    let m;
    while ((m = commaRe.exec(text)) !== null) {
      // Reorder to "First [Middle] Last"
      addCandidate(`${m[2]} ${m[1]}`);
    }

    // Pattern B: FIRST [MIDDLE INITIAL OR NAME] LAST — natural order
    // Middle can be a single initial like "C" or full name like "CHARLES".
    // We use two alternatives in the repeated group: {1,} allows single-char initials.
    const naturalRe = new RegExp(
      `${escapeRegex(trigger)}\\s+(?:Mr\\.?|Ms\\.?|Mx\\.?|Mrs\\.?|Dr\\.?)?\\s*([A-Z][A-Z'\\-]{1,}(?:\\s+[A-Z][A-Z'\\-]*\\.?){1,3})\\b`,
      "g"
    );
    while ((m = naturalRe.exec(text)) !== null) {
      addCandidate(m[1]);
    }
  });

  // ---- Pattern set 2: Standalone all-caps name lines ----
  // If the prenote has explicit line breaks, look at each line for name-like content.
  const lines = text.split(/[\n\r]+/).slice(0, 40);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 5 || trimmed.length > 60) continue;

    // Comma-separated all-caps: "WHITHORN, RYAN DUANE"
    const csvMatch = trimmed.match(/^([A-Z][A-Z'\-]{2,}),\s*([A-Z][A-Z'\-]+(?:\s+[A-Z][A-Z'\-]+)?)$/);
    if (csvMatch) addCandidate(`${csvMatch[2]} ${csvMatch[1]}`);

    // All-caps natural order: "RYAN DUANE WHITHORN" or "BENJAMIN C PARKS" (with middle initial)
const naturalMatch = trimmed.match(/^([A-Z][A-Z'\-]{1,}(?:\s+[A-Z][A-Z'\-]*\.?){1,3})$/);
if (naturalMatch) addCandidate(naturalMatch[1]);
  }

  // ---- Pattern set 3: Title + capitalized name anywhere ----
  // "Mr. Whithorn", "Ms. Smith", "Dr. Smith" (but we treat Dr. differently downstream)
  // We only match non-Dr. titles for the patient here — Dr. is preserved.
  const titledPattern = /\b(?:Mr|Ms|Mx|Mrs)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
  let tm;
  while ((tm = titledPattern.exec(text)) !== null) {
    addCandidate(tm[1]);
  }
  // ---- Pattern set 4: ordinary Title Case patient names ----
  // Catches:
  //   Patient: First Last
  //   WHAT TO KNOW ABOUT First Last
  //   First Last is a 60-year-old ...
  const titleCaseNameToken =
    "[A-Z][A-Za-z'’-]{1,}";

  const labeledTitleCaseRe =
    new RegExp(
      `\\b(?:Patient Name|Patient|Name|Summary Since Last Visit for|WHAT TO KNOW ABOUT|PATIENT SUMMARY FOR)[ \\t]*:?[ \\t]*(${titleCaseNameToken}(?:[ \\t]+(?:[A-Z]\\.?|${titleCaseNameToken})){1,3})\\b`,
      "g"
    );

  let titleCaseMatch;

  while (
    (
      titleCaseMatch =
        labeledTitleCaseRe.exec(text)
    ) !== null
  ) {
    addCandidate(titleCaseMatch[1]);
  }

  // Restrict the sentence-leading pattern to an age construction so a
  // diagnosis such as "Chronic Hypercapnia is..." is not mistaken for a name.
  const sentenceLeadAgeRe =
    new RegExp(
      `(?:^|\\n)[ \\t]*[*•-]?[ \\t]*(${titleCaseNameToken}(?:[ \\t]+(?:[A-Z]\\.?|${titleCaseNameToken})){1,3})[ \\t]+(?=(?:is|was)[ \\t]+(?:an?[ \\t]+)?(?:\\d{1,3}[- ]year[- ]old|\\d{1,3}[ \\t]*(?:y\\/o|yo))\\b)`,
      "gm"
    );

  while (
    (
      titleCaseMatch =
        sentenceLeadAgeRe.exec(text)
    ) !== null
  ) {
    addCandidate(titleCaseMatch[1]);
  }
  // Pick the primary candidate — longest one is usually the full name
  const sortedCandidates = [...candidateNames].sort((a, b) => b.length - a.length);
  let patientName = sortedCandidates[0] || null;
  let patientFirstName = null;
  let patientLastName = null;
  if (patientName) {
    const parts = patientName.split(/\s+/);
    patientFirstName = parts[0];
    patientLastName = parts[parts.length - 1];
  }

 

    // ---- STEP 2: Use a non-identifying replacement ----
  // Initials are not retained because they can still identify the patient
  // when combined with the surrounding chart context.

  // ---- STEP 3: Replace patient name occurrences ----
  if (patientName && patientFirstName && patientLastName) {
       const replacement = "the patient";

    // Step 3a: Replace EVERY candidate name we found in its full form.
    // This handles headers that list the name in multiple orders (e.g., "Mr. RW, RYAN DUANE"
    // where we detected both "RW" and "RYAN DUANE WATSON" as candidates).
    sortedCandidates.forEach(candidate => {
      const candRegex = new RegExp(
        candidate.split(/\s+/).map(p => escapeRegex(p)).join("\\s+"),
        "gi"
      );
      const before = (text.match(candRegex) || []).length;
      if (before > 0) {
        text = text.replace(candRegex, replacement);
        addFinding("patient_name", candidate, replacement, `${before} occurrences`);
      }
    });

    // Step 3b: Also strip each individual name TOKEN (first, middle, last).
    // This catches standalone first-name references ("Ryan says he..."),
    // last-name references ("Mr. Watson returns..."), AND middle-name mentions
    // that any full-name regex above may have missed.
    const allTokens = new Set();
    sortedCandidates.forEach(cand => {
      cand.split(/\s+/).forEach(tok => {
        // Skip short tokens (already-initials, common words) and titles
        if (tok.length < 4) return;
        if (/^(Mr|Ms|Mx|Mrs|Dr|Jr|Sr)$/i.test(tok)) return;
        allTokens.add(tok);
      });
    });

    allTokens.forEach(token => {
      const tokRegex = new RegExp(`\\b${escapeRegex(token)}\\b`, "gi");
      const before = (text.match(tokRegex) || []).length;
      if (before > 0) {
        text = text.replace(tokRegex, replacement);
        addFinding("patient_name_token", token, replacement, `${before} standalone occurrences`);
      }
    });
  }

  // ---- STEP 4: Reduce all dates to MM/YYYY ----
  // MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY → MM/YYYY
  text = text.replace(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g, (match, m, d, y) => {
    const mm = m.padStart(2, "0");
    const replacement = `${mm}/${y}`;
    addFinding("date", match, replacement);
    return replacement;
  });

  // Long-form: "December 28, 2023" → "December 2023" (already fine — day removed)
  text = text.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi,
    (match, month, day, year) => {
      const replacement = `${month} ${year}`;
      addFinding("date", match, replacement);
      return replacement;
    }
  );

  // ---- STEP 5: Strip street addresses ----
  // Common patterns: "123 Main St", "915 Highland Blvd", etc.
  text = text.replace(/\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Highway|Hwy)\.?(?:\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/g,
    (match) => {
      addFinding("address", match, "[address removed]");
      return "[address removed]";
    }
  );

  // ---- STEP 6: Strip phone numbers ----
  text = text.replace(/\b(?:\+?1[\s\-\.]?)?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/g, (match) => {
    // Skip if it looks like a lab value or dose (context matters)
    // But at this point most 10-digit numbers are phones
    addFinding("phone", match, "[phone removed]");
    return "[phone removed]";
  });

  // ---- STEP 7: Strip likely MRNs and identifier numbers ----
  // Long alphanumeric strings that look like IDs: VA authorization numbers, MRNs, etc.
  text = text.replace(/\b(?:MRN|Authorization|Auth|SSN|ID)[:\s#]+\s*([A-Z0-9\-]{6,})/gi, (match) => {
    addFinding("identifier", match, "[ID removed]");
    return "[ID removed]";
  });

  // VA-style auth numbers like "VA0030360811"
  text = text.replace(/\bVA\d{8,}\b/g, (match) => {
    addFinding("identifier", match, "[VA ID removed]");
    return "[VA ID removed]";
  });

  // DOB labels — even if the date has been reduced, the DOB context itself is identifying
  text = text.replace(/\bDOB:\s*\d{1,2}\/\d{4}\b/gi, (match) => {
    addFinding("dob", match, "[DOB removed]");
    return "[DOB removed]";
  });

  // Unlabeled numeric identifiers sitting next to the patient's replaced name.
  // Common EHR pattern: "Mr. RW 5723 B/p..." where 5723 is a patient identifier
  // (last-4 of SSN, station ID, etc.) that appears adjacent to the name.
  // Match 3-6 digit numbers immediately following our name replacement,
  // as long as they're not followed by clinical units (BPM, mg, mmHg, etc.)
    if (
    patientName &&
    patientFirstName &&
    patientLastName
  ) {
    const idPattern =
      /\b(the patient)\s+(\d{3,6})(?!\s*(?:mg|mcg|mL|mmHg|BPM|bpm|kg|lb|cm|mm|%|\/|\.\d))/gi;

    text = text.replace(
      idPattern,
      (match, patientLabel, number) => {
        addFinding(
          "identifier",
          number,
          "[ID removed]",
          "unlabeled ID next to patient label"
        );

        return `${patientLabel} [ID removed]`;
      }
    );
  }
  

    // ---- STEP 8: Family member name stripping ----
  // Preserve the relationship but remove an immediately following
  // capitalized family-member name. Do not use a case-insensitive regex here:
  // doing so would make ordinary words such as "has diabetes" look like names.
  const familyRelations = [
    "son",
    "daughter",
    "wife",
    "husband",
    "spouse",
    "partner",
    "mother",
    "father",
    "sister",
    "brother",
    "child",
    "grandchild",
    "grandson",
    "granddaughter",
  ];

  const familyRelationPattern = familyRelations
    .map((relation) => {
      const capitalized =
        `${relation[0].toUpperCase()}${relation.slice(1)}`;

      return `(?:${relation}|${capitalized}|${relation.toUpperCase()})`;
    })
    .join("|");

  const familyNameToken =
    "(?:[A-Z][A-Za-z'’-]+|[A-Z]\\.?)";

  const familyNameRegex = new RegExp(
    `\\b(${familyRelationPattern})\\s+` +
      `(${familyNameToken}(?:\\s+${familyNameToken}){0,2})\\b`,
    "g"
  );

  text = text.replace(
    familyNameRegex,
    (match, relation) => {
      const replacement =
        relation.toLowerCase();

      addFinding(
        "family_name",
        match,
        replacement,
        "family member name"
      );

      return replacement;
    }
  );


  // ---- STEP 9: Strip locations attached to family members ----
  // Match only capitalized location-like text so phrases such as
  // "son in remission" or "daughter in college" are not removed.
  const familyLocationRegex = new RegExp(
    `\\b(${familyRelationPattern})\\s+in\\s+` +
      `(` +
        `[A-Z][A-Za-z'’-]*` +
        `(?:\\s+[A-Z][A-Za-z'’-]*){0,2}` +
        `(?:,\\s*[A-Z]{2})?` +
      `)\\b`,
    "g"
  );

  text = text.replace(
    familyLocationRegex,
    (match, relation) => {
      const replacement =
        relation.toLowerCase();

      addFinding(
        "family_location",
        match,
        replacement
      );

      return replacement;
    }
  );

  // ---- STEP 10: City, State patterns not already caught ----
  // "Belgrade, MT" or "Auburn, WA"
  text = text.replace(/\b([A-Z][a-zA-Z]+),\s+([A-Z]{2})\b/g, (match) => {
    // Only strip if not a common medical abbreviation pattern
    if (/^(A|An|The|In|On|At|For|With|By)\b/i.test(match)) return match;
    addFinding("location", match, "[location removed]");
    return "[location removed]";
  });
  // Restore natural capitalization after name replacement.
  text = text.replace(
    /(^|\n)([ \t]*)the patient\b/g,
    "$1$2The patient"
  );

  text = text.replace(
    /([.!?]\s+)the patient\b/g,
    "$1The patient"
  );
  return { deidentified: text, findings };
};

// Utility for building regex from arbitrary strings
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Strips leading action verbs like "Continue", "Start", "Initiate", "Add",
// "Consider" that the AI sometimes prepends to medication names when framing
// treatment as ongoing management. Preserves the actual drug name.
// Module-scoped so both InRoomDocument and DocumentContent can use it.
const stripTreatmentVerb = (str) => {
  if (!str) return str;
  return str.replace(/^(Continue|Start|Initiate|Add|Consider|Prescribe|Begin|Maintain|Discontinue|Stop|Hold|Resume|Trial(?:\s+of)?)\s+/i, "");
};

// ===== Prenote section extractor =====
// Prenotes use divider lines of dashes (20+ hyphens) with section titles
// between them:
//   ----------------------------------------------------------------
//   WHAT TO KNOW ABOUT PATIENT NAME
//   ----------------------------------------------------------------
//   Body...
//
// Real-world prenotes come in TWO shapes:
//   (a) Multi-line: dividers are on their own lines separated by newlines
//   (b) Single-line: the whole prenote is one giant line, dividers are inline
// This parser handles both by treating the divider as a text-level splitter
// rather than requiring line-level structure.
//
// Returns a map keyed by normalized section name → raw text content.
const extractPrenoteSections = (rawText) => {
  if (!rawText || typeof rawText !== "string") return {};

  // Prenotes use MULTIPLE divider styles — hyphens (----) AND equals signs (====).
  // We must handle both. We also need to be tolerant of prenotes that use
  // equals-sign dividers for major "parts" and hyphens for subsections.
  // Split on either divider style (20+ of either char, possibly with whitespace).
  const dividerPattern = /\s*[-=]{20,}\s*/g;

  // Split the entire text on divider runs. Between each pair of dividers
  // we alternately have TITLE and BODY (title first when the prenote starts
  // with a divider, but in practice we don't assume — we look for what looks
  // like a title after each divider).
  const parts = rawText.split(dividerPattern).map(p => p.trim()).filter(p => p);

  // Now walk the parts array in pairs (title, body). A "title" is a short
  // line (<80 chars) with mostly uppercase letters — that's the sentinel for
  // a section header.
  const sections = {};
  const isTitleLike = (s) => {
    if (!s || s.length > 100) return false;
    // Take only the FIRST line for title detection — some parts have a title
    // on line 1 followed by body content on subsequent lines
    const firstLine = s.split(/[\n\r]/)[0].trim();
    if (!firstLine || firstLine.length > 100) return false;
    // Count uppercase letters vs. lowercase — titles are mostly uppercase
    const upper = (firstLine.match(/[A-Z]/g) || []).length;
    const lower = (firstLine.match(/[a-z]/g) || []).length;
    if (upper < 3) return false;
    // If mostly uppercase (and title is short), it's likely a title
    return upper > lower * 0.7 && firstLine.length < 100;
  };

  // Extract just the title portion (first line) from a title-like part
  const extractTitle = (s) => s.split(/[\n\r]/)[0].trim();

  // Extract the body portion (everything after the first line) if the title
  // and body are combined in one part
  const extractBodyAfterTitle = (s) => {
    const lines = s.split(/[\n\r]/);
    if (lines.length <= 1) return null;
    return lines.slice(1).join("\n").trim();
  };

  for (let i = 0; i < parts.length; i++) {
    const currentPart = parts[i];
    if (!isTitleLike(currentPart)) continue;

    const title = extractTitle(currentPart);

    // Body strategy: if the title-like part contains body content after the
    // first line, use that. Otherwise, look for the next non-title part.
    let body = extractBodyAfterTitle(currentPart);

    if (!body || body.length < 20) {
      // Look ahead for a body part
      for (let j = i + 1; j < parts.length; j++) {
        if (isTitleLike(parts[j])) break;
        body = parts[j];
        i = j; // consume this body
        break;
      }
    }

    if (!body) continue;

    const normalizedTitle = normalizeSectionTitle(title);
    if (!normalizedTitle) continue;

    // Keep the longer version if a section repeats (e.g., PART 1 and PART 2
    // might both have a WHAT_TO_KNOW section)
    if (!sections[normalizedTitle] || body.length > sections[normalizedTitle].length) {
      sections[normalizedTitle] = body;
    }
  }

  console.log("[extractPrenoteSections] parts count:", parts.length, "sections found:", Object.keys(sections));
  return sections;
};

// Normalize a section title to a stable key. Strips patient-name suffixes so
// e.g., "WHAT TO KNOW ABOUT JOHN DOE" and "WHAT TO KNOW ABOUT JANE" both map
// to "WHAT_TO_KNOW_ABOUT".
const normalizeSectionTitle = (title) => {
  if (!title) return null;
  let t = title.toUpperCase().trim();
  // Strip trailing patient-name-style suffixes
  t = t.replace(/\bABOUT\s+[A-Z][A-Z\s\.\-']+$/, "ABOUT");
  t = t.replace(/\bFOR\s+[A-Z][A-Z\s\.\-']+$/, "FOR");
  // Collapse whitespace and convert to underscore-key
  t = t.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
  return t || null;
};

// Convenience: get a section by trying multiple candidate keys
const getSection = (sections, ...candidates) => {
  for (const c of candidates) {
    const key = normalizeSectionTitle(c);
    if (key && sections[key]) return sections[key];
  }
  return null;
};

// Extract the "CURRENT MEDICATIONS" subsection out of the full MED REC text.
// Stops at "RECENTLY DISCONTINUED" or "SIGNIFICANT HISTORICAL" or end of text.
const extractCurrentMedsSubsection = (medRecText) => {
  if (!medRecText) return "";
  const lines = medRecText.split(/\r?\n/);
  let inCurrent = false;
  let started = false;
  const out = [];
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (/CURRENT\s+MEDICATIONS?/.test(upper)) {
      inCurrent = true;
      started = true;
      continue;
    }
    if (started && (/RECENTLY\s+DISCONTINUED/.test(upper) || /SIGNIFICANT\s+HISTORICAL/.test(upper) || /HISTORICAL\s+MEDICATIONS?/.test(upper))) {
      inCurrent = false;
      break;
    }
    if (inCurrent) out.push(line);
  }
  // If no explicit CURRENT header found, treat the whole thing as current
  return out.length > 0 ? out.join("\n").trim() : medRecText;
};

// Also extract discontinued and historical for the collapsible in-room dropdowns
const extractMedSubsection = (medRecText, targetHeaderRegex, stopRegexes = []) => {
  if (!medRecText) return "";
  const lines = medRecText.split(/\r?\n/);
  let inTarget = false;
  const out = [];
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (targetHeaderRegex.test(upper)) {
      inTarget = true;
      continue;
    }
    if (inTarget && stopRegexes.some(r => r.test(upper))) break;
    if (inTarget) out.push(line);
  }
  return out.join("\n").trim();
};

// Parse per-problem details out of the PAST MEDICAL HISTORY prenote section.
// Each problem in a VA-style prenote is a block starting with a diagnosis
// name followed by bulleted fields like "* Current status:", "* Medications - Current:", etc.
// Returns a map keyed by lowercased problem name → structured fields.
const parseProblemBlocks = (pmhText) => {
  if (!pmhText) return {};

  const blocks = {};
  const lines = pmhText.split(/\r?\n/);

  // A problem block starts with a line that looks like a diagnosis header:
  // e.g., "Anxiety (F41.9)" or "Postsurgical hypothyroidism (stable)" —
  // typically Capitalized, may contain parens with ICD or status, and is
  // NOT indented and NOT bulleted.
  const isProblemHeader = (line) => {
    const t = line.trim();
    if (!t || t.length > 120) return false;
    if (/^[\*\-•●○▪▫►◆·]/.test(t)) return false;      // starts with bullet
    if (/^[A-Z][A-Z0-9 /&\-,()]+$/.test(t)) return false; // ALL CAPS section header
    if (/^(current|past|lab|recent|imaging|complications|care|what|status|consult|medications)\b/i.test(t)) return false; // field label
    // Capitalized start, has letters, isn't a bullet or field
    return /^[A-Z]/.test(t) && /[a-z]/.test(t);
  };

  let currentProblem = null;
  let currentBuffer = [];

  const flush = () => {
    if (currentProblem && currentBuffer.length > 0) {
      const body = currentBuffer.join("\n");
      blocks[currentProblem.toLowerCase().trim()] = {
        rawHeader: currentProblem,
        rawBody: body,
        currentMeds: extractField(body, /Medications?\s*-?\s*Current:?/i),
        pastMeds: extractField(body, /Past:?/i, [/Lab trends/i, /Recent control/i, /Imaging/i]),
        labTrends: extractField(body, /Lab trends relevant:?/i, [/Recent control/i, /Imaging/i, /Complications/i]),
        recentControl: extractField(body, /Recent control(?:\/trends)?:?/i, [/Imaging/i, /Complications/i, /Care team/i]),
        imaging: extractField(body, /Imaging(?:\/procedures)?:?/i, [/Complications/i, /Care team/i, /What this/i]),
        careTeam: extractField(body, /Care team:?/i, [/What this/i, /Status notes/i, /Consult/i]),
        currentStatus: extractField(body, /Current status:?/i, [/Medications/i, /Past:/i, /Lab trends/i]),
        statusNotes: extractField(body, /Status notes:?/i, [/Consult/i]),
      };
    }
    currentBuffer = [];
  };

  for (const line of lines) {
    if (isProblemHeader(line)) {
      flush();
      currentProblem = line.trim();
    } else if (currentProblem) {
      currentBuffer.push(line);
    }
  }
  flush();

  return blocks;
};

// Extract the text of a single "* Field:" entry from a problem block.
// Field header regex matches the label, stop regexes mark where content ends.
const extractField = (blockText, fieldHeaderRegex, stopRegexes = []) => {
  const lines = blockText.split(/\r?\n/);
  let inField = false;
  const out = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*[\*\-•●○▪▫►◆·]?\s*/, "");
    if (fieldHeaderRegex.test(line)) {
      inField = true;
      // Content on the same line as the label
      const inline = line.replace(fieldHeaderRegex, "").trim();
      if (inline) out.push(inline);
      continue;
    }
    if (inField) {
      // Stop if we hit any of the "next field" headers
      if (stopRegexes.some(r => r.test(line))) break;
      // Stop if we hit a new bullet-labeled field entirely
      if (/^[A-Z][a-zA-Z\s\/]+:/.test(line.trim()) && !/^\s/.test(rawLine)) break;
      out.push(rawLine);
    }
  }
  const joined = out.join("\n").trim();
  // Filter out "none", "none documented", "not documented" as empty
  if (/^(none|none documented|not documented|not available)\.?$/i.test(joined)) return null;
  return joined || null;
};

// Parse medication names from a chunk of med-list text. Very forgiving —
// looks for lines with a med-name-like pattern followed by a dose.
// Returns just the generic/brand name (no dose, no route, no indication).
const parseMedNames = (text) => {
  if (!text) return [];
  const names = new Set();
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    // Strip bullet chars and specialty group markers
    line = line.replace(/^[\-\*•●○▪▫►◆·]+\s*/, "");
    line = line.replace(/^[A-Za-z\/\s]+:\s*$/, ""); // strip lines that are just "Endocrinology:"
    if (!line) continue;
    // Match: capitalized word (drug name) optionally followed by another word,
    // then a dose+unit like "10 mg" or "25 mcg" or "0.5 mg"
    const m = line.match(/([A-Z][a-zA-Z\-\/]+(?:\s+[a-zA-Z]+)?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|IU|units?|mL|meq|%)\b/i);
    if (m) {
      const name = m[1].trim();
      // Skip obvious false positives
      if (/^(Started|Stopped|Continue|Discontinued|Reason|Dose|Increased|Decreased|Active|Past)$/i.test(name)) continue;
      names.add(name);
    }
  }
  return Array.from(names);
};

// ===== Storage adapter =====
// Wraps localStorage in an async API matching the shape we use throughout.
// Falls back to no-op if storage is unavailable (private browsing, disabled, etc.)
const storage = {
  async get(key) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? { value } : null;
    } catch { return null; }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
      return { value };
    } catch (e) {
      // Quota exceeded, private browsing, etc.
      throw e;
    }
  },
  async delete(key) {
    try {
      localStorage.removeItem(key);
      return { deleted: true };
    } catch { return null; }
  },
  async list(prefix = "") {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return { keys };
    } catch { return { keys: [] }; }
  },
};
export default function App() {
  const [activeTab, setActiveTab] = useState("setup");
  const [saved, setSaved] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(null);
  const [promptViewerFor, setPromptViewerFor] = useState(null); // source key or { key, sourceName, prompt } when open
  const [expandedSections, setExpandedSections] = useState({});

  // AI is enabled by default; user only toggles on/off
  const [aiEnabled, setAiEnabled] = useState(true);

// Tracks whether the browser has blocked window.open at least once.
  // When true, the source panels fall back to showing the legacy separate
  // "Copy Prompt" + "Open ↗" buttons instead of the combined one, since
  // the combined button silently fails on popup-blocked browsers.
  const [popupBlocked, setPopupBlocked] = useState(false);

  // Which attached image is currently open in the lightbox (null = closed)
  const [attachmentLightbox, setAttachmentLightbox] = useState(null);

  // ===== Theme (dark/light UI) =====
  // theme: "system" | "light" | "dark". "system" tracks OS preference.
  // resolvedTheme: "light" | "dark" — what's actually applied.
  // Persisted to storage so it survives reload. The generated document stays
  // light-on-cream regardless — dark mode only affects the app chrome.
  const [theme, setTheme] = useState("system");
  const [resolvedTheme, setResolvedTheme] = useState("light");

  // Load persisted theme choice on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await storage.get("theme");
        if (stored?.value && ["system", "light", "dark"].includes(stored.value)) {
          setTheme(stored.value);
        }
      } catch {}
    })();
  }, []);

  // Resolve the effective theme whenever `theme` or the system preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const resolve = () => {
      if (theme === "system") setResolvedTheme(mq.matches ? "dark" : "light");
      else setResolvedTheme(theme);
    };
    resolve();
    // Watch for OS preference changes (only matters when theme === "system")
    const handler = () => { if (theme === "system") resolve(); };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [theme]);

  // Apply the resolved theme to the <html> element so CSS variables cascade correctly
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const cycleTheme = () => {
    // Cycle: system → light → dark → system
    const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    storage.set("theme", next).catch(() => {});
  };

 // ===== Session mode =====
  // "post" = attending pastes clinical note AFTER visit; AI teaches retrospectively.
  // "pre" = attending pastes prenote BEFORE visit; AI generates in-room reference doc.
  // Ephemeral state — resets on page refresh.
  const [sessionMode, setSessionMode] = useState("post");

  // De-identification review state.
  // rawPrenote: what the attending pasted before de-identification.
  // deidPreview: { deidentified, findings } from deidentifyPrenote()
  // showDeidReviewer: controls the review modal.
  const [rawPrenote, setRawPrenote] = useState("");
  const [deidPreview, setDeidPreview] = useState(null);
  const [showDeidReviewer, setShowDeidReviewer] = useState(false);
  const [deidStatus, setDeidStatus] = useState({
    running: false,
    error: "",
  });
  // NOTE: In-room checkbox and scratchpad state are intentionally NOT stored here.
  // The in-room document is a PREP ARTIFACT for the student, not a tracking tool
  // for the attending. Interactive elements exist for the student's convenience
  // when using the doc, but the attending's app doesn't record or persist them.
  // In the attending's preview: state is ephemeral (local to the InRoomDocument
  // component, resets on navigation). In the student's exported HTML: state
  // persists in the STUDENT's browser localStorage only.

  const [aiStatus, setAiStatus] = useState({ analyzing: false, generating: false, error: null, progress: null });

  // Per-unit generation tracking. Persists across "Generate" clicks so we can
  // retry ONLY what failed and reuse what succeeded. Reset on New Session,
  // when the user changes source content, or when they change selected problems.
  // Shape:
  //   synthesis: null | "success" | "failed" | "skipped" (with .error if failed)
  //   cases: { [problemName]: { status: "success"|"failed", error?: string, data?: {...} } }
  //   themes: null | "success" | "failed" | "skipped"
  const [generationAttempts, setGenerationAttempts] = useState({
    synthesis: null,
    cases: {},
    themes: null,
    lastRunAt: null,
    errors: [],
  });

  // Session metadata
  const [session, setSession] = useState({
    studentName: "",
    month: new Date().toLocaleString('default', { month: 'long' }),
    licStartMonth: "September", // CU Trek Foothills Base Camp begins in September
    sessionDate: new Date().toISOString().split('T')[0],
    encounterType: "telemedicine",
    complexity: "common",
  });

  // Clinical note
  const [clinicalNote, setClinicalNote] = useState("");
  const [chiefConcern, setChiefConcern] = useState("");
  const [workingDx, setWorkingDx] = useState("");
  const [extractedTopics, setExtractedTopics] = useState([]);
  const [noteAnalysis, setNoteAnalysis] = useState(null);
  const [activeProblems, setActiveProblems] = useState([]);
  const [selectedProblems, setSelectedProblems] = useState([]);
  const [newActiveProblem, setNewActiveProblem] = useState("");
  const [patientQuotes, setPatientQuotes] = useState([]);
  const [labTrends, setLabTrends] = useState([]);
  const [teachingLens, setTeachingLens] = useState("general_im");

  // Focus areas
  const [focusAreas, setFocusAreas] = useState({
    history: false, physicalExam: false, differential: false, workup: false,
    management: false, patientContext: false, ebm: false, communication: false,
  });
  const [aiSuggestedFocus, setAiSuggestedFocus] = useState(null);

  // Pre-visit learning content emphasis. Shapes the AI prompt for what KIND of
  // learning content to generate about the patient's diagnoses.
  //   "auto"        — phase-recommended (foundational→diagnosis, mid→workup, end→management)
  //   "diagnosis"   — why is this the diagnosis? what pointed here?
  //   "workup"      — why these tests? what were they ruling in/out?
  //   "management"  — why this treatment? evidence? alternatives? monitoring?
  //   "mixed"       — balanced across all three
  // Only affects pre-visit mode; ignored in post-visit.
  const [previsitEmphasis, setPrevisitEmphasis] = useState("auto");

const [customTopics, setCustomTopics] = useState([]);
  const [newCustomTopic, setNewCustomTopic] = useState("");
  // Sources
  const [sources, setSources] = useState({
    openevidence: false, uptodate: false, dynamed: false, doxgpt: false, pubmedai: false, other: false,
  });

  const [pdfAttachments, setPdfAttachments] = useState([]);
  const [imageAttachments, setImageAttachments] = useState([]);
  const [processingPdf, setProcessingPdf] = useState(false);


  const [sourceResponses, setSourceResponses] = useState({
    openevidence: { html: "", images: [] },
    uptodate: { html: "", images: [] },
    dynamed: { html: "", images: [] },
    doxgpt: { html: "", images: [] },
    other: { html: "", images: [] },
    // pubmedai stores an object keyed by diagnosis: {"Diagnosis 1": {html, images}, ...}
    pubmedai: {},
  });
  const [sessionImageBytes, setSessionImageBytes] = useState(0);

  // Goals
  const [longTermGoals, setLongTermGoals] = useState([]);
  const [newGoal, setNewGoal] = useState("");
  const [recommendedGoals, setRecommendedGoals] = useState([]);
  const [loadingGoalRecs, setLoadingGoalRecs] = useState(false);
  const [goalRecError, setGoalRecError] = useState(null);
  const [sessionGoal, setSessionGoal] = useState("");

  // Generated content
// Generated content
  const [aiTeachingContent, setAiTeachingContent] = useState(null);
  const [generatedDoc, setGeneratedDoc] = useState(null);
  const [synthesizedEvidence, setSynthesizedEvidence] = useState(null);
  const [pubmedResults, setPubmedResults] = useState(null);
  const [fetchingPubmed, setFetchingPubmed] = useState(false);

  // Preview/edit mode - each section has {enabled, content}
  const [previewMode, setPreviewMode] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  
  // Load only the persistent bits: long-term goals + student name.
  // Everything else starts blank on each page load.
  useEffect(() => {
    (async () => {
      const safeGet = async (key) => {
        try {
          const r = await storage.get(key);
          return r?.value ? JSON.parse(r.value) : null;
        } catch { return null; }
      };

      // Long-term learning goals — small, meant to accumulate across visits
      const g = await safeGet("longTermGoals");
      if (g) setLongTermGoals(g);

      // Student name and LIC start month — nice-to-have autofill from prior use.
      // Session date always defaults to today (set in initial state).
      const durSession = await safeGet("session");
      if (durSession) {
        setSession(prev => ({
          ...prev,
          studentName: durSession.studentName || prev.studentName,
          licStartMonth: durSession.licStartMonth || prev.licStartMonth,
          // sessionDate stays as today (already set in initial state)
        }));
      }

      // One-time cleanup: purge any old session data from the multi-session era
      // so it stops occupying quota. Safe to remove after a few weeks.
      try {
        const legacyKeys = Object.keys(localStorage).filter(k =>
          k.startsWith("session:") ||
          k === "sessions_index" ||
          k === "inProgress" ||
          k.startsWith("inProgress_")
        );
        if (legacyKeys.length > 0) {
          console.log(`[cleanup] Purging ${legacyKeys.length} legacy session keys`);
          legacyKeys.forEach(k => localStorage.removeItem(k));
        }
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist student name / LIC start month when they change. Small (<1KB).
  useEffect(() => {
    if (!session.studentName && !session.licStartMonth) return;
    storage.set("session", JSON.stringify({
      studentName: session.studentName,
      licStartMonth: session.licStartMonth,
    })).catch(() => {});
  }, [session.studentName, session.licStartMonth]);

  // beforeunload warning if there's meaningful in-progress work
  useEffect(() => {
    const hasWork = clinicalNote?.trim() || rawPrenote?.trim() || generatedDoc || previewData;
    if (!hasWork) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "You have work in progress that will be lost. Are you sure you want to leave?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [clinicalNote, rawPrenote, generatedDoc, previewData]);

  
  // Clear all editor state to blank defaults. Preserves student name / LIC start
  // month / long-term goals (those live in their own localStorage keys).
  const clearEditor = () => {
    if (!confirm("Clear all fields and start over? Any unsaved work will be lost.")) return;
    setSessionMode("post");
    setPrevisitEmphasis("auto");
    setRawPrenote("");
    setDeidPreview(null);
    setShowDeidReviewer(false);
    setDeidStatus({ running: false, error: "" });
    setClinicalNote(""); setChiefConcern(""); setWorkingDx("");
    setNewActiveProblem("");
    setExtractedTopics([]); setNoteAnalysis(null);
    setActiveProblems([]); setSelectedProblems([]);
    setPatientQuotes([]); setLabTrends([]);
    setTeachingLens("general_im");
    setFocusAreas({ history: false, physicalExam: false, differential: false, workup: false, management: false, patientContext: false, ebm: false, communication: false });
    setAiSuggestedFocus(null);
    setCustomTopics([]);
    setNewCustomTopic("");
    setSources({ openevidence: false, uptodate: false, dynamed: false, doxgpt: false, pubmedai: false, other: false });
    setSourceResponses({
      openevidence: { html: "", images: [] },
      uptodate: { html: "", images: [] },
      dynamed: { html: "", images: [] },
      doxgpt: { html: "", images: [] },
      other: { html: "", images: [] },
      pubmedai: {},
    });
    setPdfAttachments([]);
    setImageAttachments([]);
    setSessionImageBytes(0);
    setSessionGoal("");
    setAiTeachingContent(null);
    setSynthesizedEvidence(null);
    setGeneratedDoc(null);
    setPreviewData(null);
    setPreviewMode(false);
    setGenerationAttempts({ synthesis: null, cases: {}, themes: null, lastRunAt: null, errors: [] });
    // Reset session date to today
    setSession(prev => ({ ...prev, sessionDate: new Date().toISOString().split('T')[0] }));
    setActiveTab("setup");
  };

  // ===== Phase logic =====
  const getPhase = () => {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const startIdx = months.indexOf(session.licStartMonth);
    const currentIdx = months.indexOf(session.month);
    let monthsIn = currentIdx - startIdx;
    if (monthsIn < 0) monthsIn += 12;

    // Three-phase model anchored to CU Trek LIC benchmark checkpoints:
    // Mid-Year benchmarks are formally assessed ~month 5-6 (February for Sept starters);
    // End-of-Year benchmarks are assessed ~month 11-12 (August for Sept starters).
    // Foothills phase of the Trek Curriculum. Students below expected level for their
    // phase-in-year may need earlier intervention; this tool tailors teaching to the
    // benchmark they should be working toward.

    if (monthsIn <= 4) return {
      name: "Foundational (Early Foothills)",
      monthsIn,
      focus: "Building the basics: gathering complete patient-centered histories using templates, performing focused physical exams, starting to construct simple problem lists and basic differentials, learning oral presentation format, orienting to clinic workflow. Illness scripts are still forming — expect slow, deliberate pattern recognition.",
      color: "bg-blue-50 border-blue-200 text-blue-900",
      pace: "1-2 patients per half-day session is normal at this stage. Prioritize depth over volume — pick a patient who benefits from the extra time.",
      workingToward: "Mid-Year (February) benchmarks: independently gather organized histories on 2 patients per session, perform focused physical exams with minimal preceptor input, develop appropriate differential diagnoses with supporting justification, write notes with some editing needed, suggest management plans for the primary concern.",
      supervisionExpectation: "Most tasks: 'Do it with the student together' or 'Let the student do it and repeat all findings.' Full independence not yet expected.",
    };

    if (monthsIn <= 8) return {
      name: "Mid-Year Level (Approaching or At February Benchmarks)",
      monthsIn,
      focus: "Consolidating illness scripts and prioritized differentials, learning to justify diagnostic reasoning from patient history and record, starting to suggest management plans and simple orders, targeted hypothesis-driven data gathering, notes are more concise with fewer omissions, oral presentations follow standard format with less editorializing.",
      color: "bg-purple-50 border-purple-200 text-purple-900",
      pace: "2 patients per session independently — starting to navigate less-straightforward encounters. Beginning to help with basic follow-up tasks and pending orders.",
      workingToward: "End-of-Year (August) benchmarks: independently manage 3-4 patients per session, develop age-appropriate prioritized differentials with justification from multiple sources, know when to escalate care, create management plans with minimal preceptor support, produce notes usable for billing with minimal editing, present with pertinent information adjusted for audience.",
      supervisionExpectation: "Most tasks: 'Let the student do it and repeat all findings' progressing to 'repeat some findings or provide minimal input' for common concerns. Setbacks are normal — students may temporarily regress as they juggle new complexity.",
    };

    return {
      name: "End-of-Year Level (August Benchmarks)",
      monthsIn,
      focus: "Independent care of common internal medicine concerns: comprehensive histories on 3-4 patients per session, physical exams adapted for individual patient characteristics, prioritized differentials with justification from patient record and outside sources, management plans developed with minimal preceptor support, follow-up on tests and referrals, communication of patient-centered plans to patients and families, incorporation of interprofessional team members.",
      color: "bg-emerald-50 border-emerald-200 text-emerald-900",
      pace: "3-4 patients per session expected. Should be handling common presentations with minimal input and recognizing when to escalate to preceptor for complex or atypical cases.",
      workingToward: "Sub-Internship readiness. Care of patients with complex concerns is an expectation of the last two years of medical school (Alpine/Summit), not the LIC year. Focus feedback on what will help them transition into Acting Internships and residency-preparation courses.",
      supervisionExpectation: "For common presentations: 'Let the student do it on their own and repeat some findings or provide minimal input/revisions.' Complex patients still warrant supervision — that's appropriate for LIC level.",
    };
  };
  const phase = getPhase();

  // Recommended pre-visit learning emphasis based on where the student is in the year.
  //   Foundational (months 0-4): Focus on diagnostic reasoning — why this diagnosis? what pointed here?
  //   Mid-year (months 5-8):     Focus on workup — why these tests? what were they ruling in/out?
  //   End-of-year (months 9+):   Focus on management — why this treatment? evidence? alternatives?
  const getRecommendedEmphasis = () => {
    if (phase.monthsIn <= 4) return "diagnosis";
    if (phase.monthsIn <= 8) return "workup";
    return "management";
  };
  const recommendedEmphasis = getRecommendedEmphasis();
  const effectiveEmphasis = previsitEmphasis === "auto" ? recommendedEmphasis : previsitEmphasis;

  const mepoMap = {
    history: "MEPO Patient Care #6 (History) + ICS #16 (Written Documentation)",
    physicalExam: "MEPO Patient Care #7 (Physical Exam)",
    differential: "MEPO Patient Care #8 (Differential Diagnosis)",
    workup: "MEPO Patient Care #9 (Diagnostic Tests)",
    management: "MEPO Patient Care #10 (Management Plan)",
    patientContext: "MEPO Patient Care #13 (Socio-ecological Model)",
    ebm: "MEPO Curiosity #24 (Evidence-Based Medicine)",
    communication: "MEPO ICS #15 (Verbal & Nonverbal Communication) + ICS #17 (Oral Presentation)",
  };

  const focusIcons = { history: Stethoscope, physicalExam: Users, differential: Brain, workup: ClipboardList, management: Target, patientContext: Users, ebm: BookOpen, communication: Users };
  const focusLabels = {
    history: "History Taking & Documentation",
    physicalExam: "Physical Exam",
    differential: "Differential Diagnosis",
    workup: "Diagnostic Workup",
    management: "Management Plan",
    patientContext: "Patient Context / SDoH",
    ebm: "Evidence-Based Medicine",
    communication: "Communication & Oral Presentation",
  };
    const sourceLabels = {
    openevidence: "OpenEvidence",
    uptodate: "UpToDate",
    dynamed: "DynaMed",
    doxgpt: "DoxGPT (Doximity GPT)",
    pubmedai: "PubMed AI",
    other: "Other Source",
  };
  const sourceUrls = {
  openevidence: "https://www.openevidence.com/",
  uptodate: "https://ai.uptodate.com/",
  dynamed: "https://www.dynamed.com/",
    doxgpt: "https://www.doximity.com/gpt",
    pubmedai: "https://www.pubmed.ai/home",
    other: null,
  };

  const activeSources = Object.keys(sources).filter(k => sources[k]);
  const activeFocusList = Object.keys(focusAreas).filter(k => focusAreas[k]);

  // ===== Worker API call =====
  const callAi = async (systemPrompt, userPrompt, maxTokens = 2000, retryCount = 0) => {
    const MAX_RETRIES = 3;
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      const isRateLimit = res.status === 429 || (res.status === 413 && err.includes("rate_limit_exceeded"));
      if (isRateLimit && retryCount < MAX_RETRIES) {
        const waitMatch = err.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 3 : (retryCount + 1) * 30;
        console.warn(`[callAi] Rate limit. Waiting ${waitSec}s, retry ${retryCount + 1}/${MAX_RETRIES}`);
        setAiStatus(prev => ({ ...prev, progress: `Rate limited — waiting ${waitSec}s then retrying (${retryCount + 1}/${MAX_RETRIES})` }));
        await new Promise(r => setTimeout(r, waitSec * 1000));
        return callAi(systemPrompt, userPrompt, maxTokens, retryCount + 1);
      }
      throw new Error(`API error (${res.status}): ${err}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log("[callAi] Response length:", content.length, "Finish reason:", finishReason);
    if (finishReason === "length") {
      console.error("[callAi] TRUNCATED - increase max_tokens. Preview:", content.slice(-300));
    }
    return content;
  };

  const extractJson = (text) => {
    let s = text.trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const m = s.match(/\{[\s\S]*\}/);
    if (m) s = m[0];

    // Try parsing as-is first
    try {
      return JSON.parse(s);
    } catch (e) {
      // Attempt 1: normalize common AI-generated JSON pathologies
      let normalized = s
        // Smart quotes → straight (but only outside string values is hard; do all)
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        // Remove backslash-escaped quotes that shouldn't be escaped (\" inside outer strings)
        // This is the common failure mode: AI writes {"B": \"Ask, 'Can'\"} — the outer JSON expects "B": "Ask, 'Can'"
        // But we can't blindly unescape without breaking correctly-escaped strings.
        // Best heuristic: if a \" is preceded by another " (start of value) or comma/colon, it's likely wrong.
        .replace(/([:,]\s*)\\"/g, '$1"')  // \" at start of value → "
        .replace(/\\"(\s*[,}\]])/g, '"$1'); // \" at end of value → "

      try {
        console.warn("[extractJson] Normalized quotes; retrying");
        return JSON.parse(normalized);
      } catch (e2) {
        // Attempt 2: walk-and-repair truncation
        let repaired = normalized;
        let inString = false;
        let escape = false;
        let lastGoodIdx = 0;
        for (let i = 0; i < repaired.length; i++) {
          const ch = repaired[i];
          if (escape) { escape = false; continue; }
          if (ch === "\\") { escape = true; continue; }
          if (ch === '"') {
            inString = !inString;
            if (!inString) lastGoodIdx = i;
          } else if (!inString && (ch === "," || ch === "}" || ch === "]")) {
            lastGoodIdx = i;
          }
        }
        if (inString) {
          repaired = repaired.slice(0, lastGoodIdx + 1);
        }
        repaired = repaired.replace(/,\s*$/, "");
        const opens = (repaired.match(/\{/g) || []).length;
        const closes = (repaired.match(/\}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/\]/g) || []).length;
        for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
        for (let i = 0; i < opens - closes; i++) repaired += "}";

        try {
          console.warn("[extractJson] Repaired truncated JSON");
          return JSON.parse(repaired);
        } catch (e3) {
          console.error("[extractJson] Raw response:", s.slice(0, 800));
          console.error("[extractJson] Normalized:", normalized.slice(0, 800));
          console.error("[extractJson] Repair attempt:", repaired.slice(-400));
          throw new Error(`JSON parse failed (response truncated or malformed): ${e.message}`);
        }
      }
    }
  };

  // ===== Client-side note extractor =====
  // Strips a clinical note down to just the fields needed for teaching content generation.
  // Runs locally (no API call) to keep AI prompts small.
  const extractEssentialNote = (note) => {
    if (!note) return "";

    // Sections we want to KEEP (in priority order)
    const keepSections = [
      "OVERALL ASSESSMENT",
      "ROS",
      "PAST MEDICAL HISTORY",
      "EXAM",
      "ASSESSMENT",  // per-problem assessments
      "PLAN",        // per-problem plans
      "DIAGNOSTICS", // labs/imaging
      "ALLERGIES",
    ];

    // Sections we DROP entirely (bureaucratic/duplicative)
    const dropSections = [
      "COMPREHENSIVE MEDICATION MANAGEMENT",
      "MED REC",
      "CURRENT ACTIVE MEDICATIONS",
      "RECENTLY DISCONTINUED",
      "SIGNIFICANT HISTORICAL MEDICATIONS",
      "MEDICATION RECONCILIATION",
      "PREVENTIVE MEDICINE",
      "SURGICAL HISTORY",
      "FAMILY HISTORY",
      "MILITARY HISTORY",
      "CARE COORDINATION",
      "ITEMS TO TAKE CARE OF",
      "ICD CODES",
      "UPDATES/RECENT VISITS",
      "SOCIAL",   // keep the inline SOCIAL: line under ROS but drop the full block
    ];

    // Split on section headers (lines of "======" then a title, OR ALL-CAPS lines followed by content)
    const lines = note.split("\n");
    const chunks = [];
    let currentTitle = "PREAMBLE";
    let currentLines = [];

    const isHeaderLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      // Match ALL-CAPS section titles (possibly with parentheses, slashes, ampersands)
      return /^[A-Z][A-Z0-9 /&\-,()]{3,}$/.test(trimmed) && trimmed.length < 80;
    };

    const isDividerLine = (line) => /^={5,}$/.test(line.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // If we see a divider line, the next non-divider line is the section title
      if (isDividerLine(line)) {
        // Look ahead for the title
        let titleIdx = i + 1;
        while (titleIdx < lines.length && (isDividerLine(lines[titleIdx]) || !lines[titleIdx].trim())) titleIdx++;
        if (titleIdx < lines.length && isHeaderLine(lines[titleIdx])) {
          // Save current chunk
          if (currentLines.length > 0) chunks.push({ title: currentTitle, content: currentLines.join("\n").trim() });
          currentTitle = lines[titleIdx].trim();
          currentLines = [];
          // Skip past the title and any trailing divider
          i = titleIdx;
          while (i + 1 < lines.length && isDividerLine(lines[i + 1])) i++;
          continue;
        }
      }
      // Plain ALL-CAPS header (no divider)
      if (isHeaderLine(line) && !line.includes(":")) {
        if (currentLines.length > 0) chunks.push({ title: currentTitle, content: currentLines.join("\n").trim() });
        currentTitle = line.trim();
        currentLines = [];
        continue;
      }
      currentLines.push(line);
    }
    if (currentLines.length > 0) chunks.push({ title: currentTitle, content: currentLines.join("\n").trim() });

    // Filter: keep only relevant sections
    const filtered = chunks.filter(ch => {
      const t = ch.title.toUpperCase();
      // Explicit drop
      if (dropSections.some(d => t.includes(d))) return false;
      // Per-problem sections (ALL CAPS problem names) — keep these; they contain ASSESSMENT + PLAN
      // Explicit keep
      if (keepSections.some(k => t.includes(k))) return true;
      // Default: keep if it's not obviously a boilerplate section
      // (per-problem sections are usually the diagnosis in caps)
      if (ch.content.includes("ASSESSMENT") || ch.content.includes("PLAN") || ch.content.length > 200) return true;
      return false;
    });

    // Reassemble with clear section separators
    let result = filtered.map(ch => `## ${ch.title}\n${ch.content}`).join("\n\n");

    // Additional cleanup: collapse whitespace, drop empty lines runs
    result = result.replace(/\n{3,}/g, "\n\n").trim();

    return result;
  };

  // ===== Generate PubMed search queries via AI, then fetch papers =====
  const fetchPubmedForCase = async () => {
    if (!aiEnabled) return null;
    if (!workingDx && selectedProblems.length === 0) return null;

    const problemsList = selectedProblems.length > 0 ? selectedProblems : [workingDx];

    // Step 1: Ask AI to generate optimized MeSH queries
    const sys = `You generate optimized PubMed search queries using MeSH terms and boolean logic.
Return ONLY valid JSON (no markdown fences):
{
  "queries": [
    {"problem": "problem name", "query": "MeSH-optimized PubMed query string"}
  ]
}
For each problem, generate ONE focused query prioritizing recent guidelines, landmark trials, and systematic reviews. Use MeSH terms in brackets like [Mesh], article type filters like AND (guideline[pt] OR systematic review[pt] OR randomized controlled trial[pt]), and quotes around exact phrases.`;

    const user = `Generate PubMed queries for these clinical problems (student is at ${phase.name} level):\n${problemsList.map((p, i) => `${i+1}. ${p}`).join("\n")}\n\nContext: ${chiefConcern || "internal medicine encounter"}`;

    let queries = [];
    try {
      const resp = await callAi(sys, user, 600);
      const parsed = extractJson(resp);
      queries = parsed.queries || [];
    } catch (e) {
      throw new Error(`Query generation failed: ${e.message}`);
    }

    // Step 2: Call PubMed for each query in parallel
    const pubmedUrl = WORKER_URL.replace(/\/$/, "") + "/pubmed";
    const results = await Promise.all(queries.map(async (q) => {
      try {
        const res = await fetch(pubmedUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q.query, maxResults: 5, dateRange: "10" }),
        });
        if (!res.ok) return { problem: q.problem, query: q.query, papers: [], error: `HTTP ${res.status}` };
        const data = await res.json();
        return { problem: q.problem, query: q.query, papers: data.papers || [], totalCount: data.totalCount };
      } catch (e) {
        return { problem: q.problem, query: q.query, papers: [], error: e.message };
      }
    }));

    return results;
  };

  const runPubmedSearch = async () => {
    setFetchingPubmed(true);
    setAiStatus({ ...aiStatus, error: null });
    try {
      const results = await fetchPubmedForCase();
      setPubmedResults(results);
    } catch (e) {
      setAiStatus({ ...aiStatus, error: `PubMed search failed: ${e.message}` });
    }
    setFetchingPubmed(false);
  };
  const openDeidentificationReview = async (
    textToReview
  ) => {
    const input = String(
      textToReview || ""
    );

    if (
      !input.trim() ||
      deidStatus.running
    ) {
      return;
    }

    setDeidStatus({
      running: true,
      error: "",
    });

    // Give React time to paint the loading state before running the synchronous
    // regex passes on a long prenote.
    await new Promise((resolve) => {
      const afterPaint = () =>
        setTimeout(resolve, 0);

      if (
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame ===
          "function"
      ) {
        window.requestAnimationFrame(
          afterPaint
        );
      } else {
        afterPaint();
      }
    });

    try {
      const result =
        deidentifyPrenote(input);

      if (
        !result ||
        typeof result.deidentified !==
          "string"
      ) {
        throw new Error(
          "The de-identification function returned an invalid result."
        );
      }

      setDeidPreview({
        ...result,
        reviewId:
          `${Date.now()}-${Math.random()}`,
      });

      setShowDeidReviewer(true);
    } catch (error) {
      console.error(
        "[deidentification] Could not prepare review:",
        error
      );

      setDeidStatus({
        running: false,
        error:
          `Could not prepare the anonymized review: ${
            error?.message ||
            "unknown error"
          }`,
      });

      return;
    } finally {
      setDeidStatus((previous) => ({
        ...previous,
        running: false,
      }));
    }
  };
  // ===== Analyze note with AI =====
const analyzeNote = async () => {
    if (!clinicalNote.trim()) return;
    if (aiStatus.analyzing || aiStatus.generating) return;
    if (!aiEnabled) {
      setAiStatus({ ...aiStatus, error: "Enable AI on the Setup tab first." });
      return;
    }
    setAiStatus({ analyzing: true, generating: false, error: null, progress: null });
    try {
      const lensGuidance = {
        general_im: "This is a general internal medicine encounter.",
        geriatrics: "This is a geriatrics-focused encounter. Emphasize teaching on: Beers criteria, anticholinergic burden, STOPP/START criteria, deprescribing, goals-of-care, functional assessment, fall risk, dementia care, polypharmacy.",
        primary_care: "This is a primary care / annual wellness encounter. Emphasize: preventive care, chronic disease management, USPSTF recommendations, shared decision-making, motivational interviewing.",
        complex_multimorbidity: "This is a complex multi-morbid patient. Emphasize: problem prioritization, medication reconciliation, care coordination, competing treatment goals."
      };

      const isPreVisit = sessionMode === "pre";

      // Base intro — same for both modes
      const modeIntro = isPreVisit
        ? `You are a medical education assistant analyzing a PRENOTE (chart summary) for an UPCOMING patient visit. The medical student will see this patient soon and needs prep. Your extraction should support ANTICIPATORY teaching — what to think about going in, what to ask about, what to look for, what problems are prep-worthy.`
        : `You are a medical education assistant analyzing a clinical note from a COMPLETED patient encounter for retrospective teaching. Extract what actually happened so the student can learn from what was observed.`;

      const modeGuidance = isPreVisit
        ? `PRE-VISIT NOTE GUIDANCE:
- The prenote likely contains: PMH with a list of active problems, medications, recent labs, preventive care due, family/social history, and possibly notes from prior visits.
- There will NOT be patient quotes from THIS visit (the visit hasn't happened yet) — leave patientQuotes empty.
- labTrends should reflect chronic disease monitoring patterns visible in the chart (e.g., "TSH trending 15 → 5.78 → 2.74 over 2 years, now normalized after dose adjustment"), NOT visit-specific findings.
- activeProblems should extract EVERY chronic condition worth reviewing before the visit, not just the ones addressed at a hypothetical last visit.
- teachingValue should focus on what makes THIS problem teachable BEFORE seeing the patient (e.g., "student can practice medication reconciliation reasoning" or "chance to teach the workup for undifferentiated fatigue").
- keyIssue should be the anticipated clinical dilemma for the upcoming visit (e.g., "TSH normalized but on a lower dose than started — is this stable or drifting?").
- redFlags should be things to ACTIVELY SCREEN FOR in the upcoming encounter (e.g., "post-stroke: screen for recurrent neuro symptoms, medication non-adherence"), not concerning features already observed.
- suggestedFocus should reflect what SKILLS the student can practice in this specific upcoming encounter given the chart context.`
        : `POST-VISIT NOTE GUIDANCE:
- The note may have structured sections (Assessment, Plan, PMH, Meds, Labs, etc.), multiple active problems, direct patient/caregiver quotes, and trended lab/vital data. Extract all of this.
- patientQuotes: direct quotes verbatim from the note if any exist.
- labTrends: findings from this specific visit or recent trends that were discussed.
- redFlags: concerning features actually observed in this encounter.`;

      const sys = `${modeIntro}

${lensGuidance[teachingLens]}

CU DEFINITION OF PATIENT COMPLEXITY (for calibrating your teaching):
- Common presentation = single or a few uncomplicated concerns, routine problem, minimal intervention/orders/follow-up needed, or follow-up care of a stable chronic condition.
- Complex presentation = multiple problems that may interact and require extensive clinical decision-making, extensive test/referral/medication ordering, undifferentiated patient with unclear diagnosis, atypical presentation of a common diagnosis, patient needing urgent/emergent care, or decision-making heavily influenced by a complex social situation.

This patient is: ${session.complexity === "complex" ? "COMPLEX" : "COMMON"} per the attending's judgment. ${session.complexity === "complex" ? "Complexity means the student is not yet expected to manage this level independently — care of complex patients is an Alpine/Summit (M3/M4) expectation, not an LIC-year expectation. Your teaching should reflect that. Focus on helping the student recognize the features that MAKE this complex, and on the specific reasoning threads a preceptor uses to navigate the complexity. Do not expect Sub-I-level ownership of the plan." : "Common means the student SHOULD be building toward independent care of this type of presentation. Your teaching should reinforce the pattern recognition, workup, and management approach for this presentation type — this is the bread and butter they need to own by end of the LIC year."}

${modeGuidance}

Available focus areas: history, physicalExam, differential, workup, management, patientContext, ebm, communication

CRITICAL: The "suggestedFocus" field is REQUIRED and must contain 3-5 area keys from that list. This drives which teaching topics get emphasized. Never omit it, never return it empty.

Return ONLY valid JSON (no markdown fences):
{
  "chiefConcern": "${isPreVisit ? 'anticipated reason for the upcoming visit if stated in prenote, else the primary chronic issue driving the visit' : 'brief chief concern or reason for visit'}",
"workingDiagnosis": "${isPreVisit ? `primary problem the visit will center on, or the most teachable chronic condition, or "annual follow-up of multiple stable conditions" if truly multi-focal` : `primary/most teachable diagnosis, or "multiple active problems" if truly multi-focal`}",
  "oneLiner": "2-3 sentence admission-style one-liner. Anchor patient demographics, key active problems, current situation, medication status, and the 'why now' framing. Written in a fluent clinical voice — the way a resident would present the patient on rounds. Example: '38 y/o former Navy SEAL, 90% SC, with PTSD in remission after completing CBT-based psychotherapy, now re-engaging for court-ordered eval related to legal charges. On no systemic medications. Active issues include palmar-plantar keratolysis, chronic back/shoulder pain managed non-pharmacologically, IBS-D, and GERD.'",
  "patientDescriptor": "brief age+sex string like '38 y/o M' or '57 y/o F veteran' — used in the header next to name",
  "patientBadges": [
    {"text": "e.g. 'Navy SEAL (ret 2008)' or 'Type 1 Diabetic since age 12' — noteworthy identity/status facts a resident would mention in one-liner", "type": "info|warning|alert"}
  ],
  "scPercentages": [
    {"condition": "PTSD", "percent": 70}
  ],
  "activeProblems": [
    {
      "problem": "problem name",
      "icdContext": "ICD code if in note",
      "category": "REQUIRED — one of: mental, skin, gi, pain, ent, neuro, social, lab, cardiac, pulm, endocrine, renal, other. Used to pick an icon in the rendered document.",
      "status": "REQUIRED — one of: active, stable, remission, resolved, registry, controlled. Reflects current clinical state per the chart.",
      "scPercent": null,
      "shortSubtitle": "one-line summary shown under the problem title — include ICD if known, and 1-3 word context. Example: 'F43.10 — Combat-index trauma, Navy SEAL deployments' or 'K58.0 — Alternating diarrhea/constipation'",
      "teachingValue": "${isPreVisit ? 'why this problem is worth prepping the student on BEFORE the visit' : 'brief note on why teachable'}",
      "keyIssue": "${isPreVisit ? 'the anticipated clinical dilemma for the upcoming visit' : 'the core clinical question or dilemma'}"
    }
  ],
  "otherDiagnoses": ["list of other active problems as strings"],
  "keyTopics": ["specific clinical topics worth teaching - be specific"],
  "suggestedFocus": ["REQUIRED — return exactly 3-5 focus area keys from this list: history, physicalExam, differential, workup, management, patientContext, ebm, communication. Never return empty. Pick the areas most relevant to THIS specific patient and encounter — do not just default to the same set every time."],
  "reasoning": "2-3 sentence explanation",
  "complexity": "common" or "complex",
"redFlags": ["${isPreVisit ? `things to actively screen for during the upcoming visit` : `concerning features, can't-miss diagnoses, iatrogenic risks`}"],
  "perProblemRedFlags": {
    "exact problem name matching one in activeProblems": ["specific red flag or don't-miss item for THIS problem"]
  },
  "patientQuotes": [${isPreVisit ? '' : '"direct quotes verbatim from the note"'}],
  "labTrends": [
    {"parameter": "lab name", "trend": "${isPreVisit ? 'longitudinal chronic-disease monitoring pattern visible in chart' : 'brief description'}", "teachingPoint": "what this teaches"}
  ],
  "labTrendsSummary": "one-paragraph AI summary of key lab trends across the chart — used as a 'Lab Trends' quick-reference box. Example: 'A1c 4.9→5.1% (normal). eGFR >90→79→83 (mildly low, likely muscle-based). LFTs normalized 07/2026 after stopping energy drinks. LDL 99→82→99 (borderline). TSH 1.02 (normal).'",
  "diagnosticsSummary": "one-paragraph AI summary of imaging, endoscopy, and other diagnostic procedures visible in the chart — used as a 'Diagnostics' quick-reference box. Example: 'Endoscopy 09/2021: Colonoscopy normal mucosa, biopsies for colitis (pathology not in record). EGD non-severe reflux esophagitis. ENT 01/2026: minor salivary gland cyst, benign. Stool studies 2021: all negative. Imaging: none documented.'",
  "visitPlan": [
    "checklist items for today's visit — 10-15 items, ordered from most to least urgent. Cover: vitals recheck if abnormal, mandatory screens (C-SSRS, PHQ-2 if MH history), overdue preventive care, per-problem symptom check-ins, physical exam foci, follow-up authorizations expiring, documentation reminders (e.g., 'document objectively — legal case active')"
  ]
}

═══════════════════════════════════════════════════════════════
FINAL REMINDER — READ BEFORE GENERATING JSON
═══════════════════════════════════════════════════════════════

Your JSON response MUST include ALL of the following top-level fields — do not omit any. Missing fields will break the downstream document rendering. Double-check your response before finalizing:

REQUIRED TOP-LEVEL FIELDS:
✓ chiefConcern (string)
✓ workingDiagnosis (string)
✓ oneLiner (2-3 sentence admission-style string — REQUIRED, not optional)
✓ patientDescriptor (short age+sex string like "38 y/o M" — REQUIRED)
✓ patientBadges (array of {text, type} objects — REQUIRED; may be empty [] for patients with no notable identity/status facts, but the KEY must be present)
✓ scPercentages (array of {condition, percent} objects — REQUIRED; empty [] if patient is not a veteran or no SC data available, but the KEY must be present)
✓ activeProblems (array — EACH problem object MUST include: problem, category, status, shortSubtitle in addition to the older fields)
✓ otherDiagnoses (array of strings)
✓ keyTopics (array)
✓ suggestedFocus (array of 3-5 focus keys — REQUIRED, never empty)
✓ reasoning (string)
✓ complexity ("common" or "complex")
✓ redFlags (array)
✓ perProblemRedFlags (object keyed by problem name — REQUIRED; empty {} if none, but KEY must be present)
✓ patientQuotes (array — may be empty for pre-visit)
✓ labTrends (array of objects)
✓ labTrendsSummary (one-paragraph string — REQUIRED)
✓ diagnosticsSummary (one-paragraph string — REQUIRED)
✓ visitPlan (array of 10-15 checklist strings — REQUIRED)

FOR EACH activeProblems ENTRY, REQUIRED per-problem fields:
✓ problem (string)
✓ category (REQUIRED — one of: mental, skin, gi, pain, ent, neuro, social, lab, cardiac, pulm, endocrine, renal, other)
✓ status (REQUIRED — one of: active, stable, remission, resolved, registry, controlled)
✓ shortSubtitle (REQUIRED — ICD code + brief context, ≤80 chars)
✓ scPercent (integer or null)
✓ teachingValue, keyIssue, icdContext (as before)

If any of these fields are absent from your JSON, the response is invalid. Do a final check before returning.`;

      const extractedForAnalysis = extractEssentialNote(clinicalNote);
      console.log(`[analyzeNote] ${isPreVisit ? "Prenote" : "Note"}: ${clinicalNote.length} chars → ${extractedForAnalysis.length} chars`);
      const user = `${isPreVisit ? "Prenote / chart summary" : "Clinical note"} (de-identified):\n\n${extractedForAnalysis}\n\nStudent is in month ${phase.monthsIn} of LIC (${phase.name} phase). Focus on: ${phase.focus}`;
      // Increased from 4000 to accommodate the expanded output schema
      // (oneLiner, patientBadges, scPercentages, per-problem category/status,
      // labTrendsSummary, diagnosticsSummary, visitPlan, perProblemRedFlags).
      const response = await callAi(sys, user, 8000);
      const parsed = extractJson(response);

      setNoteAnalysis(parsed);
      // Always auto-fill chief concern and working dx from AI analysis
      if (parsed.chiefConcern) setChiefConcern(parsed.chiefConcern);
      if (parsed.workingDiagnosis) setWorkingDx(parsed.workingDiagnosis);
      if (parsed.complexity) setSession(prev => ({ ...prev, complexity: parsed.complexity }));
      if (parsed.keyTopics) setExtractedTopics(parsed.keyTopics);
      if (parsed.activeProblems) {
        setActiveProblems(parsed.activeProblems);
        setSelectedProblems(parsed.activeProblems.slice(0, 2).map(p => p.problem));
      }
      if (parsed.patientQuotes) setPatientQuotes(parsed.patientQuotes);
      if (parsed.labTrends) setLabTrends(parsed.labTrends);
      // Auto-select focus areas from AI suggestion. If the AI dropped the field or
// returned an empty list, fall back to a phase-appropriate default so the
// student always has something pre-selected on Step 3.
let focusToApply = parsed.suggestedFocus;
if (!Array.isArray(focusToApply) || focusToApply.length === 0) {
  console.warn("[analyzeNote] AI did not return suggestedFocus; applying phase-appropriate default");
  // Phase-appropriate defaults: foundational students get history+differential,
  // mid-year get differential+workup+management, end-of-year get the full clinical set.
  if (phase.monthsIn <= 4) focusToApply = ["history", "differential", "communication"];
  else if (phase.monthsIn <= 8) focusToApply = ["history", "differential", "workup", "management"];
  else focusToApply = ["differential", "workup", "management", "ebm"];
}
setAiSuggestedFocus(focusToApply);
const newFocus = { ...focusAreas };
Object.keys(newFocus).forEach(k => { newFocus[k] = false; });
focusToApply.forEach(k => { if (k in newFocus) newFocus[k] = true; });
setFocusAreas(newFocus);
      setAiStatus({ analyzing: false, generating: false, error: null, progress: null });
    } catch (e) {
      setAiStatus({ analyzing: false, generating: false, error: e.message, progress: null });
    }
  };

  // ===== Synthesize multiple external source responses =====
  // ===== Integrate external source responses into the document's voice =====
  // ===== Integrate multiple source responses with per-claim attribution =====
  const synthesizeSources = async () => {
    const filledNonPubmed = activeSources.filter(s => s !== "pubmedai" && sourceResponses[s]?.html?.trim());
    const filledPubmedTopics = Object.entries(sourceResponses.pubmedai || {}).filter(([_, v]) => v?.html?.trim());
    const filledPdfs = pdfAttachments.filter(p => p.extractedText?.trim() && !p.error);

    console.log("[synthesizeSources] INPUT CHECK:", {
      totalPdfsInState: pdfAttachments.length,
      pdfSummary: pdfAttachments.map(p => ({
        filename: p.filename,
        hasText: !!p.extractedText,
        textLength: p.extractedText?.length || 0,
        hasError: !!p.error,
        errorMsg: p.error || null,
      })),
      filledPdfsCount: filledPdfs.length,
      filledNonPubmedCount: filledNonPubmed.length,
    });

    const totalFilled = filledNonPubmed.length + (filledPubmedTopics.length > 0 ? 1 : 0) + filledPdfs.length;

    if (totalFilled === 0) return null;

    // Extract text + figure inventory from a rich HTML value.
    // Returns { text, figures: [{id, source, alt, dataUrl}] }
    const extractTextAndFigures = (html, sourceLabel) => {
      const div = document.createElement("div");
      div.innerHTML = html || "";
      const figures = [];
      div.querySelectorAll("img").forEach((img, i) => {
        const figId = `fig-${sourceLabel.toLowerCase().replace(/[^a-z0-9]/g, "")}-${i + 1}`;
        figures.push({
          id: figId,
          source: sourceLabel,
          alt: img.alt || `Figure from ${sourceLabel}`,
          dataUrl: img.src,
        });
        img.replaceWith(document.createTextNode(` [FIGURE:${figId} alt="${(img.alt || "figure").replace(/"/g, "'")}"] `));
      });
      const text = div.textContent.replace(/\s+/g, " ").trim();
      return { text, figures };
    };

    // Build a per-source content package for the AI
    const sourcePackages = [];
    filledNonPubmed.forEach(s => {
      const { text, figures } = extractTextAndFigures(sourceResponses[s].html, sourceLabels[s]);
      const wordCount = text.split(/\s+/).length;
      const detailLevel = wordCount > 800 ? "high" : wordCount > 300 ? "medium" : "brief";
      sourcePackages.push({
        key: s,
        label: sourceLabels[s],
        text,
        figures,
        wordCount,
        detailLevel,
      });
    });

    
    console.log("[synthesizeSources] BEFORE PDF PUSH: packages so far:", sourcePackages.map(p => p.label));
    // Add each PDF as its own source package. Prefer AI-extracted short citation for display;
    // fall back to filename if citation extraction failed or hasn't finished yet.
    filledPdfs.forEach(pdf => {
      const MAX_PDF_CHARS = 12000;
      const truncatedText = pdf.extractedText.length > MAX_PDF_CHARS
        ? pdf.extractedText.slice(0, MAX_PDF_CHARS) + " [truncated]"
        : pdf.extractedText;
      const wordCount = truncatedText.split(/\s+/).length;
      const displayLabel = pdf.shortLabel || pdf.filename.replace(/\.pdf$/i, "");
      sourcePackages.push({
        key: `pdf-${pdf.id}`,
        label: displayLabel,
        fullCitation: pdf.citation || null,
        text: truncatedText,
        figures: [],
        wordCount,
        detailLevel: wordCount > 800 ? "high" : wordCount > 300 ? "medium" : "brief",
      });
    });
    console.log("[synthesizeSources] AFTER PDF PUSH: packages:", sourcePackages.map(p => `${p.label} (${p.wordCount}w)`));

    if (filledPubmedTopics.length > 0) {
      // Roll up per-topic PubMed AI into one "source" but preserve topic labels inline
      let combinedText = "";
      const combinedFigures = [];
      filledPubmedTopics.forEach(([topic, v], ti) => {
        const { text, figures } = extractTextAndFigures(v.html, `PubMed AI (${topic})`);
        combinedText += `\n\n--- On "${topic}" ---\n${text}`;
        // Re-label figure IDs to include topic
        figures.forEach((f, i) => {
          f.id = `fig-pubmed-${ti + 1}-${i + 1}`;
          combinedFigures.push(f);
        });
      });
      const wordCount = combinedText.split(/\s+/).length;
      sourcePackages.push({
        key: "pubmedai",
        label: "PubMed AI",
        text: combinedText.trim(),
        figures: combinedFigures,
        wordCount,
        detailLevel: wordCount > 800 ? "high" : wordCount > 300 ? "medium" : "brief",
      });
    }

    const allFigures = sourcePackages.flatMap(p => p.figures);
    const sourceContribution = sourcePackages.map(p => ({
      source: p.label,
      fullCitation: p.fullCitation || null,
      wordCount: p.wordCount,
      detailLevel: p.detailLevel,
      figureCount: p.figures.length,
    }));

    // If AI is off or only one source, return a raw fallback
    if (!aiEnabled || totalFilled === 1) {
      return {
        synthesized: false,
        singleSource: totalFilled === 1 ? { source: sourcePackages[0].label, contentHtml: sourcePackages[0].text } : null,
        sourceContribution,
        allFigures,
      };
    }

    // Build a compact per-source view for the AI (with figure placeholders intact)
    const MAX_PER_SOURCE = 4500;
    const aiSourceBlock = sourcePackages.map(p => {
      const t = p.text.length > MAX_PER_SOURCE ? p.text.slice(0, MAX_PER_SOURCE) + " [truncated]" : p.text;
      const figList = p.figures.length > 0 ? `\nFigures available from this source: ${p.figures.map(f => `[FIGURE:${f.id}] (${f.alt})`).join(", ")}` : "";
      return `=== SOURCE: ${p.label} (${p.detailLevel} detail, ${p.wordCount} words) ===\n${t}${figList}`;
    }).join("\n\n");

    const sys = `You are a teaching attending in internal medicine integrating evidence from ${sourcePackages.length} AI research tools for your medical student. Your goal is a STRUCTURED synthesis where every claim carries a REAL clinical citation (trial name, society guideline, USPSTF grade, Cochrane review, FDA label) — not the name of the AI tool that surfaced it.

CRITICAL: The tool names below (OpenEvidence, UpToDate, DynaMed, DoxGPT, PubMed AI) are AI research aggregators. They are NOT clinical evidence. Attributing a clinical claim to "OpenEvidence" is like attributing a fact to "Google" — it tells the student nothing about the underlying evidence. Your job is to extract the REAL references from the source content (trials, guidelines, society statements) and cite THOSE.

WHAT GOES WHERE:
- \`citations\`: an array of REAL clinical references (e.g. ["ATA 2014", "SPRINT trial", "USPSTF Grade B", "ACOG PB 128", "Cochrane 2021"]). Every claim needs at least one citation here. If the source content doesn't name a specific reference, use your medical training to identify the canonical reference (e.g., "hypothyroidism and menorrhagia link" → "ATA 2014" or "ACOG PB 128"). NEVER put "OpenEvidence" here.
- \`provenance\`: the ORIGINAL SOURCE LABELS from the "=== SOURCE:" headers below (e.g. "OpenEvidence", "PDF: NEJMcpc2517866.pdf", "DoxGPT"). Use these EXACT labels verbatim — do NOT abbreviate, generalize, or drop labels. If a claim draws content from BOTH OpenEvidence and a PDF, include BOTH labels in the array. This is used for provenance tracking so we can see which of our sources contributed to each claim.
- \`perSourceDetail\`: what each AI tool specifically said, for the "provenance" expandable view.
- \`statement\`: written in attending voice with the real citation inline in parentheses.

RULES:
1. Organize by clinical topic (5-8 topics maximum). Deduplicate — no near-duplicate topics.
2. Under each topic, break into individual CLAIMS. One claim = one clinical statement.
3. Tag strength based on AI-tool agreement: "consensus" if 3+ tools agree, "majority" if 2 agree, "single-source" if 1, "conflict" if tools contradict.
4. NEVER fabricate journal names, DOIs, page numbers, or author names. "SPRINT trial" is fine; "N Engl J Med 2015;373:2103" is not (unless it appears verbatim in the source content).
5. When AI tools disagree, populate BOTH sides in perSourceDetail.
6. If a claim relates to a figure from source material, include the figure ID(s) in figureRefs.
7. Order topics: diagnosis/workup → treatment first-line → adjunctive → monitoring → special populations.
8. The crossReferenceMatrix maps topics to the REAL guidelines/trials that address them — NOT to AI tool names.

9. ACTIVE PER-SOURCE PASS (CRITICAL — do not skip):
   You have ${sourcePackages.length} sources. Before finalizing your output, perform this check for EACH source individually:
   - Read the source's content again with fresh eyes.
   - Ask: "What claim in this source is NOT already covered by claims I've generated from other sources?"
   - If the source contains a unique fact, trial, dosing detail, mechanism, or nuance not yet represented, ADD a claim for it with that source in its provenance.
   - Only after doing this pass may you consider the synthesis complete.

   PDF sources deserve especially close attention: they are often full-text articles or book chapters with detailed data (specific trial numbers, effect sizes, patient cohorts, dosing regimens, mechanistic explanations) that broad research aggregators like OpenEvidence or DoxGPT typically summarize away. Do not let a PDF's word count go to waste — extract its distinctive contributions.

   If, after honest review, a source truly contains nothing unique beyond what other sources already cover, that is acceptable — but you MUST have done the review. Do NOT default to attributing everything to the first source listed.


Return ONLY valid JSON (no markdown fences):
{
  "topics": [
    {
      "topic": "clinical topic name",
      "orderingCategory": "diagnosis|workup|treatment|monitoring|special|other",
      "claims": [
        {
          "statement": "1-2 sentence clinical claim in attending voice, with REAL citation in parentheses inline",
          "strength": "consensus|majority|single-source|conflict",
          "citations": ["REAL trial or guideline name — never a tool name"],
          "provenance": ["AI tool names for internal tracking"],
          "figureRefs": ["fig-id-here if referenced"],
          "perSourceDetail": [
            {"source": "OpenEvidence", "detail": "what specifically this tool said about this — 1-2 sentences"}
          ]
        }
      ]
    }
  ],
  "keyTakeaways": ["3-5 bullet takeaways with real citations inline"],
  "crossReferenceMatrix": [
    {"topic": "topic name", "primaryReferences": ["real guideline/trial names that establish this topic"], "provenanceTools": ["AI tools that covered it — internal"]}
  ]
}`;

    const user = `Chief concern: ${chiefConcern || "internal medicine encounter"}
Problems being taught: ${selectedProblems.join("; ") || workingDx}

Source content to integrate (each source clearly labeled with detail level and word count):

${aiSourceBlock}

Synthesize into structured claims with per-source attribution as specified. When a figure ID like [FIGURE:fig-xyz] appears in source content, you may reference it in figureRefs of a related claim. Do NOT invent figures that weren't listed.

CRITICAL: For every claim, the "provenance" array must accurately list which of the ${sourcePackages.length} sources above actually contributed to that claim. If two sources both discuss a topic, list both. If only one source discusses a topic (e.g., only the PDF has the case-specific dosing detail), list only that one. Do NOT lazily attribute every claim to just the first source.

BEFORE YOU FINALIZE: Look at your generated topics/claims and count how many claims have each source in their provenance. If any source has zero or only one claim cited to it, go back to that source's raw text above and find at least one distinctive contribution — a specific number, a mechanism, a patient-population nuance, a trial detail, a dosing subtlety — that isn't already represented. Add it as a claim. This is especially important for PDFs, which are dense full-text documents that always contain something unique. Attributing 4 of 10 claims to the first-listed source while leaving PDFs at 0-1 claims each indicates you did not perform this active per-source review — go back and do it before returning your JSON.`;

    console.log("[synthesizeSources] SENDING TO AI:", {
      sourcePackageCount: sourcePackages.length,
      packageLabels: sourcePackages.map(p => `${p.label} (${p.wordCount} words)`),
    });
    const response = await callAi(sys, user, 6000);
    const parsed = extractJson(response);
    console.log("[synthesizeSources] topics:", parsed.topics?.length, "first claim sample:", JSON.stringify(parsed.topics?.[0]?.claims?.[0], null, 2));

    return {
      synthesized: true,
      ...parsed,
      sourceContribution,
      allFigures,
    };
  };

  // ===== Generate case-specific teaching content =====
  // Generates ONE teaching case per API call with waits between,
  // to stay under Groq's tokens-per-minute rate limit.
  //
  // Accepts:
  //   synthesizedEvidenceParam: the synthesized evidence (or null)
  //   cachedCases: an object keyed by problem name → previously-generated case data.
  //                Problems present here are SKIPPED (reused from cache) instead of re-called.
  //   onlyRetryFailed: if true, skip problems that don't have an entry in cachedCases at all
  //                    (only used by "Retry failed parts" flow).
  // Returns { teachingCases, crossCuttingThemes, questionsForReflection, caseResults }
  // where caseResults is [{problem, status, error?, data?}] for downstream reporting.
  const generateAiTeachingContent = async (synthesizedEvidenceParam = null, cachedCases = {}, onlyRetryFailed = false) => {
        const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
    if (activeFocus.length === 0) return null;
    if (!aiEnabled) return null;

    const lensGuidance = {
      general_im: "",
      geriatrics: " Weave in Beers criteria, anticholinergic burden, STOPP/START, deprescribing, 4Ms framework where relevant.",
      primary_care: " Weave in USPSTF grades, shared decision-making, chronic disease guidelines.",
      complex_multimorbidity: " Weave in problem prioritization, competing goals, care coordination."
    };

    // Build a labeled list so we can pass the "kind" of each teaching item to the AI.
    // kind: "patient-diagnosis" = actually present in this patient; frame around HER story.
    // kind: "tangential" = topic the encounter sparked but the patient doesn't have; frame as an aside.
    const problemsToTeach = [
      ...(selectedProblems.length > 0
        ? selectedProblems.map(p => ({ name: p, kind: "patient-diagnosis" }))
        : (workingDx ? [{ name: workingDx, kind: "patient-diagnosis" }] : [])
      ),
      ...customTopics.map(t => ({ name: t, kind: "tangential" })),
    ];
    if (problemsToTeach.length === 0) problemsToTeach.push({ name: "primary clinical problem", kind: "patient-diagnosis" });

    const difficulty = phase.monthsIn <= 4
      ? "Foundational (early Foothills LIC): basic pattern recognition, single-step reasoning, template-based history and note structure. Working toward Mid-Year (February) benchmarks."
      : phase.monthsIn <= 8
      ? "Mid-Year Level: illness scripts, multi-step reasoning, prioritized differentials with justification, beginning management plans. At or approaching February benchmarks, working toward End-of-Year (August) benchmarks."
      : "End-of-Year Level: independent management of common internal medicine concerns, 3-4 patients per session, notes usable for billing with minimal editing. At or exceeding August benchmarks, preparing for Sub-I readiness. Complex/atypical presentations may still warrant preceptor input — that is appropriate for LIC level.";

    // Practice question calibration by phase — matches where student is in shelf/board exam trajectory
    const shelfDifficulty = phase.monthsIn <= 4
      ? `INTERN-LEVEL (early LIC, still building fundamentals):
- 3-4 sentence vignettes with clear presenting features
- Single-step reasoning; the correct answer follows directly from pattern recognition
- Distractors are clearly wrong to a student who knows the basics (not subtle)
- Focus on: classic presentations, first-line diagnostic tests, first-line treatments, immediate red flags
- Avoid: cost-effectiveness reasoning, subtle guideline nuances, atypical presentations, drug-drug interactions
- Aim for USMLE Step 1/early Step 2 CK difficulty — the student is learning to walk`
      : phase.monthsIn <= 8
      ? `SECOND-YEAR RESIDENT LEVEL (mid-LIC, building clinical judgment):
- 4-5 sentence vignettes with some contextual complexity (comorbidities, medications, social factors)
- Multi-step reasoning: student must integrate 2-3 pieces of information to arrive at the answer
- Distractors are plausible for the underprepared but wrong to someone who knows current guidelines
- Focus on: guideline application, second-line vs. first-line decisions, moderate-complexity management, contraindications
- Include: some cost/value considerations, occasional atypical presentations, drug interactions when clinically relevant
- Aim for USMLE Step 2 CK / early PGY-2 shelf difficulty`
      : `IM BOARD-PREP LEVEL (end-of-year LIC, preparing for shelf and Sub-I):
- 5-7 sentence dense vignettes with realistic complexity: multi-morbidity, medications, prior workup, subtle findings
- Multi-step synthesis: student must weigh competing considerations to arrive at the best (not just correct) answer
- Distractors are all defensible; the correct answer requires knowing current guideline nuance, evidence quality, or specific edge cases
- Focus on: guideline-directed nuance, cost-effectiveness, when to escalate vs. observe, atypical presentations, choosing between two reasonable options
- Include: recent practice-changing evidence, pharmacology depth, subtle diagnostic dilemmas, decision-making under uncertainty
- Aim for IM ABIM Certification / advanced Step 3 difficulty — the student is preparing to take care of patients independently`;

    // MEPO progression targets — what the student should be moving toward for each focus area.
    // Sourced from CU MEPO Milestones doc + Internal Medicine Benchmarks.
    // Format: for each focus area, describe where the student is now vs. where the next benchmark expects them.
    const buildMepoProgression = () => {
      const isFoundational = phase.monthsIn <= 4;
      const isMidYear = phase.monthsIn > 4 && phase.monthsIn <= 8;
      // isEndOfYear = phase.monthsIn > 8

      const progressions = {
        history: isFoundational
          ? "MEPO Patient Care #6 + ICS #16 — Currently using templates for comprehensive histories on medically stable patients. Teaching should help the student move toward gathering histories that are guided by an emerging differential, and toward writing notes with fewer omissions."
          : isMidYear
          ? "MEPO Patient Care #6 + ICS #16 — Currently obtains organized histories on 2 patients per session and starts to navigate less-straightforward encounters. Teaching should help them progress toward hypothesis-driven targeted questioning, incorporating secondary sources (chart review), and producing notes with minimal editing."
          : "MEPO Patient Care #6 + ICS #16 — Currently obtains histories on 3-4 patients per session for common concerns. Teaching should sharpen adaptive communication for individual patient needs, hypothesis-driven refinement, and notes usable for billing with minimal editing.",

        physicalExam: isFoundational
          ? "MEPO Patient Care #7 — Currently performing focused exams with preceptor input. Teaching should help the student begin selecting exam maneuvers guided by history and preliminary differential, and identifying normal vs. abnormal findings confidently."
          : isMidYear
          ? "MEPO Patient Care #7 — Currently performing focused exams that reflect the working differential for common concerns. Teaching should progress them toward independent selection of specialized maneuvers and identification/description of abnormal findings with clinical relevance."
          : "MEPO Patient Care #7 — Currently performs targeted exams for any chief concern, adapting to individual patient characteristics. Teaching should highlight subtle findings and their integration into diagnostic reasoning.",

        differential: isFoundational
          ? "MEPO Patient Care #8 — Currently constructing simple problem lists and basic differentials for common chief concerns. Teaching should help the student start building illness scripts, comparing/contrasting diagnoses, and justifying selections with history/exam features."
          : isMidYear
          ? "MEPO Patient Care #8 — Currently develops appropriately broad prioritized differentials for common conditions, with justification from patient record. Teaching should progress them toward gathering pertinent information from multiple sources in a hypothesis-driven fashion and recognizing when presentations fall outside typical illness scripts."
          : "MEPO Patient Care #8 — Currently develops prioritized differentials that are neither too broad nor too narrow for any chief concern. Teaching should reinforce updating the differential as emerging information arrives, and integrating context from patient record and outside sources.",

        workup: isFoundational
          ? "MEPO Patient Care #9 — Currently interpreting common labs (CBC, BMP, LFTs, UA, TSH, CXR, ECG) with normal reference ranges provided. Teaching should help the student recognize which tests connect to which differential items, and identify critically abnormal results needing escalation."
          : isMidYear
          ? "MEPO Patient Care #9 — Currently recommends and interprets common labs/imaging in core specialties, taking patient factors into account. Teaching should progress them toward applying guidelines, correlating labs with differential, and knowing when a test is high-value vs. low-value."
          : "MEPO Patient Care #9 — Currently recommends and interprets diagnostic and screening tests across specialties, including preventive care per USPSTF/guideline recommendations. Teaching should emphasize evidence-based selection, cost-consciousness, and shared decision-making around testing.",

        management: isFoundational
          ? "MEPO Patient Care #10 — Currently suggesting basic management for the primary concern of common cases, with preceptor doing the work of ordering. Teaching should help the student start naming appropriate medications with correct dose/route/frequency and identifying appropriate follow-up."
          : isMidYear
          ? "MEPO Patient Care #10 — Currently develops appropriate plans with preceptor support and can enter simple orders for co-signature. Teaching should progress them toward independent plans for common conditions, patient-centered plan communication, and following up on tests and referrals."
          : "MEPO Patient Care #10 — Currently develops management plans with minimal preceptor input for common conditions, communicates plans clearly to patients, and follows through on tests/referrals. Teaching should highlight edge cases, escalation triggers, and interprofessional collaboration.",

        patientContext: isFoundational
          ? "MEPO Patient Care #13 — Currently recognizing individual social determinants of health with preceptor prompting. Teaching should help the student proactively gather SDOH information and start describing how these factors affect the patient's care plan."
          : isMidYear
          ? "MEPO Patient Care #13 — Currently incorporates SDOH into care plans with some guidance. Teaching should progress them toward creating individualized plans that actively mitigate SDOH barriers and incorporate family/community context."
          : "MEPO Patient Care #13 — Currently incorporates contextual factors into plans without prompting for common presentations. Teaching should highlight interprofessional resources, community-level determinants, and structural competency in individual care.",

        ebm: isFoundational
          ? "MEPO Curiosity #24 — Currently retrieving basic information from aggregators (UpToDate, Google) when prompted. Teaching should model formulating focused clinical questions and start distinguishing types of evidence."
          : isMidYear
          ? "MEPO Curiosity #24 — Currently accesses medical literature when prompted and uses point-of-care resources. Teaching should progress them toward independently accessing guidelines to answer clinical questions and appraising levels of evidence."
          : "MEPO Curiosity #24 — Currently forms clinical questions and independently accesses medical literature and national guidelines. Teaching should sharpen critical appraisal of evidence quality and application to individual patients.",

        communication: isFoundational
          ? "MEPO ICS #15 + #17 — Currently using patient-centered communication basics and following an oral presentation template. Teaching should help the student start responding to patient verbal/nonverbal cues and organize presentations to minimize editorializing."
          : isMidYear
          ? "MEPO ICS #15 + #17 — Currently communicates effectively with team and patients, and presents in standard format with pertinent information. Teaching should progress them toward specialized communication (shared decision-making, motivational interviewing, delivering difficult news) and adjusting presentations for audience."
          : "MEPO ICS #15 + #17 — Currently uses patient-centered communication across most encounters and presents pertinent information adjusted for audience. Teaching should highlight advanced conversation types (goals of care, sensitive news) and refinement of presentation efficiency.",
      };

      return activeFocus.map(k => progressions[k]).filter(Boolean).join("\n\n");
    };
    const mepoProgression = buildMepoProgression();

    const focusFilters = {
      differential: activeFocus.includes("differential"),
      history: activeFocus.includes("history"),
      physicalExam: activeFocus.includes("physicalExam"),
      workup: activeFocus.includes("workup"),
      management: activeFocus.includes("management"),
      patientContext: activeFocus.includes("patientContext"),
      ebm: activeFocus.includes("ebm"),
      communication: activeFocus.includes("communication"),
    };
    const includedSections = Object.entries(focusFilters).filter(([_, v]) => v).map(([k]) => k).join(", ");

// Extract only the essential sections from the note (client-side, no API call)
    const extracted = extractEssentialNote(clinicalNote);
    console.log(`[extractEssentialNote] Original: ${clinicalNote.length} chars → Extracted: ${extracted.length} chars (${Math.round(100 * extracted.length / clinicalNote.length)}%)`);

    // Belt-and-suspenders: still hard-cap in case extraction leaves too much
    const MAX_NOTE = 12000;
    let notePayload = extracted.length > MAX_NOTE
      ? extracted.slice(0, MAX_NOTE) + "\n[truncated]"
      : extracted;
    // Normalize unusual unicode that can confuse tokenization
    // (non-breaking hyphens, smart quotes, etc.)
    notePayload = notePayload
      .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-")  // various dashes/hyphens
      .replace(/[\u2018\u2019]/g, "'")  // smart single quotes
      .replace(/[\u201C\u201D]/g, '"')  // smart double quotes
      .replace(/\u00A0/g, " ");  // non-breaking space

// Strip HTML/images to plain text with figure placeholders for AI
    // Build evidence context — prefer structured synthesis over raw text when available
    let evidenceContext = "";
    let availableFigureIds = [];

    if (synthesizedEvidenceParam?.synthesized && synthesizedEvidenceParam.topics?.length > 0) {
      // Use the structured claims from synthesis — much better for grounded citations
      const claimSummary = synthesizedEvidenceParam.topics.map(topic => {
        const claims = (topic.claims || []).map(c => {
          const figRef = c.figureRefs?.length > 0 ? ` [refs: ${c.figureRefs.join(", ")}]` : "";
          const realCites = (c.citations || []).join(", ") || "no citation";
          const tools = (c.provenance || c.sources || []).join(", ") || "unknown";
          return `  • [${c.strength}] ${c.statement} — citations: ${realCites} — via: ${tools}${figRef}`;
        }).join("\n");
        return `TOPIC: ${topic.topic}\n${claims}`;
      }).join("\n\n");

      const figureInventory = (synthesizedEvidenceParam.allFigures || []).map(f =>
        `  [FIGURE:${f.id}] from ${f.source} — ${f.alt}`
      ).join("\n");
      availableFigureIds = (synthesizedEvidenceParam.allFigures || []).map(f => f.id);

      evidenceContext = `\n\nSTRUCTURED EVIDENCE (already synthesized across sources — cite claims by their source names, use figure IDs when relevant):\n${claimSummary}${figureInventory ? `\n\nFIGURES AVAILABLE (reference by [FIGURE:id] in your teaching text where clinically relevant):\n${figureInventory}` : ""}`;
    } else {
      // Fallback: raw text from each source, if synthesis unavailable
      const htmlToAiText = (html) => {
        const div = document.createElement("div");
        div.innerHTML = html || "";
        let figIdx = 0;
        div.querySelectorAll("img").forEach(img => {
          figIdx++;
          img.replaceWith(document.createTextNode(` [Figure ${figIdx}: ${img.alt || "figure"}] `));
        });
        return div.textContent.replace(/\s+/g, " ").trim();
      };
      const filledSources = activeSources.filter(s => s !== "pubmedai" && sourceResponses[s]?.html?.trim());
      const filledPdfs = pdfAttachments.filter(p => p.extractedText?.trim() && !p.error);
      const totalItems = filledSources.length + filledPdfs.length;
      const MAX_EVIDENCE_TOTAL = 8000;
      const evidencePerItem = totalItems > 0 ? Math.floor(MAX_EVIDENCE_TOTAL / totalItems) : 0;
      const parts = [];
      filledSources.forEach(s => {
        const t = htmlToAiText(sourceResponses[s].html);
        parts.push(`[${sourceLabels[s]}]: ${t.length > evidencePerItem ? t.slice(0, evidencePerItem) + "[truncated]" : t}`);
      });
      filledPdfs.forEach(pdf => {
        const t = pdf.extractedText;
        parts.push(`[PDF: ${pdf.filename}]: ${t.length > evidencePerItem ? t.slice(0, evidencePerItem) + "[truncated]" : t}`);
      });
      evidenceContext = parts.length > 0
        ? "\n\nCurated evidence from clinician-selected sources (do NOT invent facts beyond this evidence and the note):\n" + parts.join("\n\n")
        : "";
    }

    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const teachingCases = [];
    const caseResults = []; // parallel array: [{problem, status: "success"|"failed"|"cached", error?, data?}]

    // Generate one teaching case per API call, with waits between.
    // Skip any problem present in cachedCases (successful in a prior attempt).
    for (let i = 0; i < problemsToTeach.length; i++) {
      const { name: problem, kind } = problemsToTeach[i];
      const isTangential = kind === "tangential";

      // Reuse cached success — avoids re-billing and preserves the exact prior output
      if (cachedCases[problem]) {
        console.log(`[teachingCase] Reusing cached case for "${problem}"`);
        teachingCases.push(cachedCases[problem]);
        caseResults.push({ problem, status: "cached", data: cachedCases[problem] });
        continue;
      }

      setAiStatus(prev => ({ ...prev, progress: `Generating teaching case ${i+1} of ${problemsToTeach.length}: ${problem}${isTangential ? " (tangential)" : ""}` }));

const isPreVisit = sessionMode === "pre";

// Pre-visit emphasis lens — shapes what KIND of learning content to generate.
// The attending picks a lens in Step 3, or "auto" which uses phase-recommended.
const emphasisGuidance = {
  diagnosis: `LEARNING CONTENT EMPHASIS: DIAGNOSTIC REASONING.

Focus the learning content on WHY this is the diagnosis for this patient. Frame everything around: what features on history, exam, and labs pointed to this diagnosis? What was the differential and how was it narrowed? What patterns did the diagnosing team recognize?

For each diagnosis in the chart:
- The illness script should emphasize the diagnostic features that fit (and don't fit) this patient
- The differential should be substantive — 3-5 alternatives with real reasoning for why each was considered and how it was ruled in or out for THIS patient
- keyLearningPoints should teach diagnostic-reasoning concepts: how to recognize this pattern, what distinguishes it from lookalikes, what would push you toward a different diagnosis
- focusedHistoryQuestions should be diagnostic-focused: questions that would confirm or refute the diagnosis
- physicalExam should focus on maneuvers that discriminate this diagnosis from alternatives
- keyLabsAndImaging should emphasize what each test tells you diagnostically (sensitivity, specificity, when to order)
- treatmentApproach: keep brief — this lens is about the diagnostic story, not the treatment story
- clinicalPearl: frame around a diagnostic insight ("The thing to remember about diagnosing X is...")`,

  workup: `LEARNING CONTENT EMPHASIS: WORKUP AND EVALUATION.

Focus the learning content on WHY the workup for this patient's diagnoses looks the way it does. Frame everything around: what tests were ordered and why, what were they ruling in or out, what did the results mean, what would trigger additional testing?

For each diagnosis in the chart:
- The illness script should note the classic workup pattern
- differential should exist but be brief — this lens is about workup, not diagnostic reasoning
- keyLearningPoints should teach workup concepts: why order this test now vs. later, what to do with abnormal results, when initial testing warrants escalation
- focusedHistoryQuestions should focus on history elements that inform test selection or interpretation
- physicalExam should focus on findings that would change test ordering
- keyLabsAndImaging is the STAR of this lens: explain each test's role in this diagnosis specifically — why it was ordered, what a positive/negative result means, how it changes the plan, what to order next based on the result
- treatmentApproach: emphasize the connection between workup findings and treatment choice
- clinicalPearl: frame around a workup insight ("The key thing about working up X is...")`,

  management: `LEARNING CONTENT EMPHASIS: MANAGEMENT.

Focus the learning content on WHY this patient's treatment plan is what it is. Frame everything around: why this drug, why this dose, why this monitoring plan, what alternatives existed, what evidence supports the choice, what to watch for on treatment.

For each diagnosis in the chart:
- The illness script should be brief — this lens assumes the student can recognize the diagnosis
- differential: brief, only as it affects treatment differentiation (e.g., subtypes that get treated differently)
- keyLearningPoints should teach management concepts: guideline-recommended first-line therapy, why THIS patient got the treatment they got (consider comorbidities, contraindications, preferences), when to escalate, when to switch, side effects to monitor
- focusedHistoryQuestions should focus on treatment tolerance, adherence, side effects
- physicalExam should focus on findings that would change management (BP for HTN meds, tremor for thyroid meds, etc.)
- keyLabsAndImaging should emphasize monitoring labs — what to check on treatment and why
- treatmentApproach is the STAR of this lens: detailed first-line with dosing, real citation, and clear explanation of WHY this fits this patient. Additional considerations should include monitoring plan, common adverse effects, patient-specific tradeoffs
- clinicalPearl: frame around a management insight ("The nuance in managing X is...")`,

  mixed: `LEARNING CONTENT EMPHASIS: BALANCED (diagnosis + workup + management).

Cover all three lenses in balance. For each diagnosis: explain the diagnostic reasoning, then the workup, then the management. Learning points should span the three domains rather than being weighted toward one.`,
};

const sys = `You are a warm, engaged teaching attending in internal medicine writing a personalized learning document for YOUR medical student ${isPreVisit ? "BEFORE a patient visit you're both about to do together. The student will read this to PREPARE for the visit — to understand why this patient's chart looks the way it does." : "about a patient you saw together today."}

${isPreVisit ? emphasisGuidance[effectiveEmphasis] || emphasisGuidance.mixed : ""}

DOCUMENT PURPOSE: ${isPreVisit ? "PRE-VISIT PREP" : "POST-VISIT DEBRIEF"}
${isPreVisit
  ? `This is a PREP DOCUMENT for a visit that has not happened yet. The student's job before reading this: get up to speed on why this patient's chart looks the way it does. The student's job after reading this: walk into the visit understanding the patient's medical story so they can have an intelligent conversation with the patient and present intelligently to the attending.

The learning content is NOT anticipatory checklists ("ask about X"). Those live elsewhere in the document. The learning content IS explanatory: "the patient is on levothyroxine 175 + liothyronine 5 because of [reasoning]. Here's why that specific combination, here's what alternatives exist, here's what to know about it."

Voice rules for pre-visit prep content:
- Explain the WHY behind the patient's current care. Every teaching point should connect a specific chart fact to the reasoning that produced it.
- Reference chart facts (the specific meds, the specific labs, the specific procedures they've had, the trajectory of their disease) and unpack why those facts exist.
- The student is preparing — they should come away thinking "now I understand why this patient is on X and had Y test done."
- It is fine to acknowledge unknowns and open questions ("we don't know from the chart whether they've had a discussion about Z, but you'll want to be ready to explain it if it comes up").
- Match the emphasis lens above — the shape of the learning content follows that lens.`
  : `This is a DEBRIEF DOCUMENT for a visit that has already happened. Frame everything retrospectively — what was observed, what was decided, what to learn from what you saw together.`
}

TEACHING CASE TYPE FOR THIS SPECIFIC OUTPUT: ${isTangential ? "TANGENTIAL TOPIC" : "PATIENT DIAGNOSIS"}

${isTangential
  ? `This is a TANGENTIAL TOPIC — a subject the ${isPreVisit ? "upcoming visit made the attending realize is worth prepping the student on" : "encounter reminded the attending they wanted to teach"}, but the patient DOES NOT have this condition. Frame the entire teaching case as "an aside" or "a related topic worth knowing." Do NOT invent that ${isPreVisit ? "the patient" : "our patient"} has this problem. Do NOT reference ${isPreVisit ? "her" : "her"} clinical features as if they are examples of this topic. Do NOT force patient-specific framing. Instead:
- Open the primaryDiagnosis definition as a general clinical topic ("This is worth reviewing because it comes up alongside cases like the one ${isPreVisit ? "we're about to see" : "we just saw"}...")
- The illnessScript should describe the classic pattern in general — NOT anchored to ${isPreVisit ? "the patient" : "our patient"}
- The differentialDiagnosis should be general (what would make you consider this diagnosis when you encounter it in another patient) — NOT tied to features of ${isPreVisit ? "the upcoming patient" : "today's patient"}
- keyLearningPoints should still be substantive and teaching-focused, but framed as "here's what you should know about this topic" rather than "notice how ${isPreVisit ? "the patient" : "our patient"}..."
- focusedHistoryQuestions, physicalExam, keyLabsAndImaging, treatmentApproach: general clinical approach, NOT "for ${isPreVisit ? "the patient" : "our patient"}"
- patientContextConsiderations: general context factors that come up with this topic in typical practice, NOT this patient's specific SDoH
- communicationTeaching: a generic scenario that WOULD arise with a patient who had this condition, framed hypothetically
- quoteToDiscuss: leave empty string — no patient quote applies since this isn't her problem
- clinicalPearl: a general teaching pearl framed for the student's future practice

Think of this as: "${isPreVisit ? "We're about to see a patient with hypothyroidism. As an aside, since we'll be reviewing labs, let me also teach you about interpreting thyroid antibodies — even though the patient's antibodies aren't in the chart." : "We saw a patient with hypothyroidism today. As an aside, since we were talking about labs, let me also teach you about interpreting thyroid antibodies — even though our patient's antibodies weren't checked."}"`
  : `This is a PATIENT DIAGNOSIS — the patient ${isPreVisit ? "you're about to see" : "we saw today"} actually has this problem. Frame the ENTIRE teaching case around THIS specific patient, her presentation, her labs, her context. Every section should reference her actual features (her age range, her meds, her ${isPreVisit ? "chart-documented history" : "quotes"}, ${isPreVisit ? "what you know from her records going into the visit" : "her decisions the attending made about HER care"}). This is the primary teaching mode described below.`}

STUDENT DEVELOPMENTAL CONTEXT (CU School of Medicine Trek Curriculum, Foothills LIC year):
- Current phase: ${phase.name}
- Focus at this stage: ${phase.focus}
- Pace expectation: ${phase.pace}
- Working toward: ${phase.workingToward || "phase-appropriate benchmarks"}
- Supervision expectation for common presentations: ${phase.supervisionExpectation || "phase-appropriate"}
- Difficulty calibration for this teaching content: ${difficulty}

SPECIFIC MEPO MILESTONE TARGETS FOR THE FOCUS AREAS OF THIS TEACHING SESSION:

${mepoProgression}

Every learning point you generate must move the student along the specific MEPO progression above. Do NOT teach concepts they've already mastered per their phase, and do NOT teach at a level beyond the next benchmark they're working toward. When the case gives you an opportunity to help them cross from their current level to the next benchmark, name that explicitly in the learning point (e.g., "This case is a great example of moving from template-based history to hypothesis-driven questioning — notice how our patient's...").

SHELF QUESTION CALIBRATION FOR THIS STUDENT'S PHASE:

${shelfDifficulty}

The three shelfQuestions you generate MUST match this difficulty level. Do not write generic-difficulty questions and hope they land — the shelf questions are one of the most useful outputs of this document, and mis-calibrated questions either bore the student (too easy) or discourage them (too hard). If in doubt, err slightly toward the harder end within the specified band.${lensGuidance[teachingLens]}

VOICE AND TONE (CRITICAL):
${isPreVisit ? `- Write directly TO the student in second person, EXPLAINING and TEACHING: "This patient is on X because...", "The reason they had this workup was...", "When you see [pattern] in a patient like this, it means..."
- Reference specifics from the chart — the meds, the labs, the trajectory, the procedures — and unpack each one. Every learning point starts with a specific chart fact and explains it.
- Sound like a thoughtful attending walking the student through the patient's story the night before the visit — patient, unhurried, focused on understanding.
- Include the REASONING behind each piece of care: "They chose combination T4+T3 despite guidelines favoring T4 monotherapy because [reasoning]. The tradeoff is [X]. This is worth knowing because [Y]."
- When the chart shows a trajectory (labs trending, med dose changes, procedures over time), narrate the story: what happened, why, what it means now.
- Do NOT write anticipatory checklist prose ("you should ask about X") — that content lives in other parts of the document. The learning content is EXPLANATORY prose about the patient's medical story.
- The student should finish reading and feel like they understand this patient's chart the way a resident who's known them would.` : `- Write directly TO the student in second person ("Notice how our patient...", "When you saw Ms. X today...", "This is a case where...")
- Reference the specific patient by their pronoun and clinical story throughout — not "the patient" abstractly, but "our patient today with her 45-lb weight loss on Zepbound and 6-month lapse in levothyroxine"
- Every learning point should START with what you observed together in this specific encounter, THEN pivot to the teaching principle
- Sound like a thoughtful attending debriefing a case over coffee, not a textbook chapter
- Include the WHY behind clinical decisions ("I held off on the GYN referral today because...")
- Reference the patient's own words, concerns, life context, and social situation when relevant
- When possible, tie teaching to what YOU as the attending noticed, decided, or would want the student to walk away thinking about`}

CITATION RULES — READ CAREFULLY:

The INLINE citation (what the student reads) must be a REAL clinical reference: a landmark trial NAME, a society guideline (ORG + YEAR), a Cochrane review, a USPSTF grade, or an FDA label. Examples of good inline citations: "(SPRINT trial)", "(2023 AHA/ACC guidelines)", "(ATA 2022)", "(USPSTF Grade B)", "(Cochrane 2021)", "(ACOG Practice Bulletin 128)".

DO NOT write "(per OpenEvidence)", "(per UpToDate)", "(per DoxGPT)", "(per DynaMed)", or "(per PubMed AI)" as your inline citation. These are AI research tools, not clinical evidence. Attributing a claim to "OpenEvidence" is like attributing a fact to "Google" — it tells the student nothing about the actual evidence base.

The names of source tools (OpenEvidence, UpToDate, DynaMed, DoxGPT, PubMed AI) are for INTERNAL provenance tracking only — populate them in the "provenance" array so we can trace where the AI-tool synthesis came from. They must NOT appear in your prose text or in the "citation" field.

Every clinical claim you make MUST have a real citation. If the structured evidence below gives you a claim but doesn't name the underlying guideline/trial, DO ONE of the following:
1. If you know the definitive reference for that claim from your medical training (e.g., "levothyroxine timing 60 min before food" → ATA 2014 guidelines), cite that.
2. If you truly do not know a real reference, mark the citation as "(clinical consensus)" or "(standard of care)" — but only sparingly.
3. NEVER fabricate specific journal names, page numbers, DOIs, or author names. It's fine to cite "SPRINT trial" but do NOT invent "N Engl J Med 2015;373:2103".

When a claim in the structured evidence has a figure reference like [refs: fig-openevidence-1], you may reference it in your teaching text by writing "(see Figure)" or "(see figure below)" — do NOT name the AI tool the figure came from. Only reference figures listed in FIGURES AVAILABLE.

If the structured evidence contains a "conflict" claim, address it explicitly in your teaching as a clinical equipoise teaching opportunity — cite BOTH real references that disagree.

EXAMPLES OF GOOD vs. BAD PRE-VISIT PREP CONTENT:
${isPreVisit ? `- BAD (checklist framing — belongs elsewhere in the doc, NOT in learning content): "Before you go in, ask her about her morning routine and whether she takes the levothyroxine on an empty stomach."

- GOOD (explanatory prep content): "This patient's thyroid story is complex — she had a total thyroidectomy in 2013 for papillary cancer, and she's been on TSH-suppressive doses ever since to prevent recurrence. Her current regimen is levothyroxine 175 mcg plus liothyronine 5 mcg daily. That combination is unusual — the ATA 2014 guidelines recommend levothyroxine monotherapy for most thyroid cancer survivors, but a subset of patients report better symptom control on combination therapy. Her chart notes she requested T3 in Feb 2026 for persistent fatigue despite normal T4, which is the typical clinical scenario that leads endocrinologists to add liothyronine even when the evidence base is limited (ATA 2014 guidelines; Wiersinga et al., Nat Rev Endocrinol 2019)."

- BAD (checklist framing): "Screen for medication adherence."

- GOOD (explanatory prep content): "You'll see her TSH trajectory in the chart is unusual: 9.99 in Dec 2025, then 0.06 in Feb 2026 after her dose was pushed up, now 0.01 in April 2026. That's the story of a patient whose dose was under-titrated for a year, then pushed into suppression once the cancer surveillance ultrasound raised concern for recurrence. The suppression target for intermediate-risk patients like her is TSH 0.1–0.5 per ATA — she's currently below that. That's why the endocrinologist reduced her from 224 to 175 mcg in May 2026. Understanding this trajectory matters because if her TSH is still very suppressed today, you're looking at a decision point about whether to reduce further (ATA 2014 guidelines)."

- BAD (textbook regurgitation): "Papillary thyroid cancer often metastasizes to cervical lymph nodes."

- GOOD (patient-specific explanation): "Her Feb 2026 neck ultrasound flagged multiple left cervical lymph nodes with suspicious features — rounded shape, loss of fatty hilum, microcalcifications. Those are the ultrasound features specific for metastatic papillary thyroid cancer (as opposed to reactive nodes, which are elongated, have preserved fatty hila, and lack microcalcifications). That's why endocrinology ordered the CT neck and would have proceeded to FNA with thyroglobulin washing if the CT confirmed pathologic nodes. When the CT read as 'lymph nodes present but do not appear pathologic' AND her thyroglobulin came back undetectable, that combination reassured them that this is likely NOT structural recurrence — but it's why she's on TSH suppression and why they're monitoring closely (ATA 2015 guidelines for management of thyroid nodules and differentiated thyroid cancer)."` : `- BAD (textbook + tool citation): "TSH >10 indicates severe hypothyroidism requiring treatment (per OpenEvidence)."
- GOOD (attending + real citation): "Our patient's TSH of 13.8 after six months off her levothyroxine tells us just how quickly the thyroid axis decompensates — she's essentially back to where she started at diagnosis. This is why I emphasized to her that adherence matters more than dose adjustments right now (ATA 2014 guidelines)."

- BAD: "Menorrhagia can be caused by hypothyroidism (OpenEvidence and DoxGPT)."
- GOOD: "You'll remember she described her periods as 'outrageously heavy' every two weeks. Before you jump to a GYN referral, consider: uncontrolled hypothyroidism is one of the most common reversible causes of menorrhagia we see. That's why I want to treat her thyroid first — if we fix that, we may fix her bleeding without a hysterectomy (ACOG Practice Bulletin 128; ATA 2014)."

- BAD: "The patient should be counseled on adherence (per OpenEvidence)."
- GOOD: "System-level barriers like a name mismatch on refill records — exactly what happened to our patient — are increasingly recognized as a driver of apparent 'non-adherence.' Asking 'have you been able to get your medications?' rather than 'are you taking them?' surfaces these barriers (VA/DoD Clinical Practice Guidelines 2022)."`}

Return ONLY valid JSON (no markdown fences, no commentary). CRITICAL JSON RULES: (1) Use straight quotes " and ' — NEVER smart/curly quotes. (2) When you need an apostrophe or quote inside a string value, use single quote ' — never backslash-escape (\\"). Example: "vignette": "The patient's mother says 'take a look'" — NOT "vignette": "The patient\\'s mother says \\"take a look\\"". (3) Never include line breaks inside string values.

{
  "problem": "${problem}",
  "primaryDiagnosis": {"name": "the diagnosis", "briefDefinition": "1-2 sentences framed around what makes it relevant for ${isPreVisit ? "the upcoming visit with THIS patient" : "THIS patient"}"},
  "illnessScript": {
    "epidemiology": "1-2 sentences on who typically gets this. Reference ${isPreVisit ? "the patient's chart-documented demographics" : "our patient's demographics"} where they fit or contrast the pattern.",
    "timeCourse": "1-2 sentences on the classic tempo of the illness. ${isPreVisit ? "Note where the patient's chart-documented trajectory fits on that spectrum." : "Note where our patient's presentation fits on that spectrum."}",
    "keySymptoms": "The classic symptom cluster (3-5 items in a sentence). ${isPreVisit ? "Note which of these the chart documents and which the student should specifically ask about in the upcoming visit." : "Note which of these our patient does and doesn't have."}",
    "keySigns": "The classic physical exam findings (2-4 items). ${isPreVisit ? "Note which of these the student should specifically look for during the upcoming exam." : "Note which of these are present or absent in our patient."}",
    "keyLabsImaging": "The characteristic lab/imaging pattern (2-3 items). ${isPreVisit ? "Reference the patient's known lab pattern from the chart and note what to watch for." : "Note where our patient's findings fit or diverge."}",
    "naturalHistory": "1-2 sentences on what happens if untreated, and typical response to first-line treatment. ${isPreVisit ? "Anchor to what the chart trajectory suggests to expect going forward." : "Anchor to what we expect for our patient specifically."}"
  },
  "differentialDiagnosis": [{"diagnosis": "alternative", "reasoning": "${isPreVisit ? "why you should hold this in mind going into the visit — reference the patient's chart features, meds, or context" : "why you considered it for OUR patient — reference her actual features, meds, or context"}"}],
  "keyLearningPoints": [{"point": "concise title", "explanation": "2-3 sentences that START with ${isPreVisit ? "something specific from the chart" : "something specific about our patient's presentation"}, THEN ${isPreVisit ? "tell the student what to think about or do in the upcoming visit" : "teach the concept"} — written TO the student. The real clinical citation appears in the 'citation' field below and will be shown inline in italics; do NOT also put it in the explanation prose in parentheses.", "citation": "real trial name / org+year / USPSTF grade — NEVER a tool name like OpenEvidence", "provenance": ["AI-tool names for internal tracking only"], "figureRef": "figure ID from FIGURES AVAILABLE if visualized, else empty"}],
  "shelfQuestions": [{"vignette": "clinical vignette calibrated to the SHELF DIFFICULTY level specified below. Can invent a new patient for the vignette if useful.", "options": {"A":"...","B":"...","C":"...","D":"..."}, "correctAnswer": "A/B/C/D", "explanation": "detailed teaching explanation of why the correct answer is right and why each distractor is wrong"}],
  "focusedHistoryQuestions": [{"question": "the question", "rationale": "${isPreVisit ? "what you'll be listening for when the student asks this in the upcoming visit — tie to what the chart tells us" : "what YOU as attending were listening for when I would have asked this in OUR patient's visit today"}"}],
  "physicalExam": {"maneuver": "exam maneuver relevant to ${isPreVisit ? "what the student should perform or ask the attending to demonstrate in the upcoming visit" : "OUR patient's presentation"}", "steps": ["step 1", "step 2"], "interpretation": "${isPreVisit ? "what a positive/negative finding would tell you and how it should change your thinking" : "what a positive/negative finding would tell you about THIS patient specifically"}"},
  "keyLabsAndImaging": [{"study": "name", "purpose": "${isPreVisit ? "why you might order it — or, if the chart shows it's already been done, what to look for in the result" : "why I ordered/would order it for OUR patient"}", "interpretation": "${isPreVisit ? "what the actual (or expected) result means clinically" : "what her actual result (or what a hypothetical result) would mean in her clinical context"}", "role": "${isPreVisit ? "how the result should change your plan" : "how it changes management for HER"}"}],
"treatmentApproach": {"firstLine": [{"treatment": "medication or intervention NAME ONLY — do NOT prefix with action verbs like 'Continue', 'Start', 'Initiate', 'Add', 'Consider'. Just the drug/intervention name (e.g., 'Hydrocodone/acetaminophen', 'Intra-articular corticosteroid injection', 'Neuromuscular physiotherapy'). The rendering context makes the action clear.", "dosing": "dose/route/frequency", "evidence": "landmark trial/guideline citation for why this is first-line — real reference, never a tool name", "provenance": ["AI-tool names for internal tracking only"]}], "additional": ["${isPreVisit ? "patient-specific considerations to bring up in the visit" : "patient-specific considerations, not generic bullet points"}"]},
  "suggestedQuestions": ["3-5 concrete questions the student should ask the patient about THIS specific problem during the visit — actionable, specific, and grounded in what the chart shows. Example: 'How are your bowel habits these days? Still alternating?' or 'Does shoulder pain wake you at night?' Written as questions a resident would actually ask, not screening tools."],
  "dontMiss": "one-line warning of the single most important don't-miss item, iatrogenic risk, or prescribing pitfall specific to THIS problem in THIS patient. Example for a patient asking to share their topical antibiotic with family: 'He wants to use topical erythromycin on family members. This is a prescription medication — you cannot prescribe for undiagnosed family members. Offer to evaluate them separately.' Leave empty string if no specific warning applies.",
  "patientContextConsiderations": "2-3 sentences about THIS patient's specific SDoH, values, goals, and life situation ${isPreVisit ? "from the chart — reference what to be aware of going in and what to gently probe on" : "— reference her actual story (job, family, MST, name issue, whatever's relevant)"}",
  "recommendedReading": [{"reference": "landmark trial/guideline name", "relevance": "${isPreVisit ? "why I want you to skim this BEFORE the visit" : "why I want you to read this after seeing OUR patient today"}"}],
  "communicationTeaching": {"scenario": "${isPreVisit ? "a specific conversation you should be ready for in the upcoming visit given the chart" : "a specific conversation that came up (or could have come up) in OUR visit today"}", "script": "${isPreVisit ? "example language you could use — reference her chart-documented context" : "example language YOU could use with this patient — reference her actual concerns, quotes, or emotional state"}"},
  "clinicalPearl": "one memorable teaching point framed as something YOU as the attending want the student to walk away ${isPreVisit ? "thinking about as they go into the visit" : "remembering from OUR encounter today"}",
  "quoteToDiscuss": "${isPreVisit ? "leave empty string — visit has not happened yet" : "if the patient said something in the note that is teachable, quote it verbatim; else empty string"}"
}

ALWAYS include these core sections regardless of focus selection: primaryDiagnosis, illnessScript, differentialDiagnosis, keyLearningPoints, shelfQuestions (exactly 3), recommendedReading, clinicalPearl, quoteToDiscuss, suggestedQuestions (3-5 questions), dontMiss (may be empty string if no specific warning).

═══════════════════════════════════════════════════════════════
FINAL REMINDER — REQUIRED FIELDS CHECK
═══════════════════════════════════════════════════════════════

Before returning your JSON, verify these NEW fields are present in your response (they are easy to forget in a long schema):

✓ suggestedQuestions — REQUIRED array of 3-5 concrete questions the student should ask the patient about THIS problem during the visit. Grounded in what the chart shows. Written as actual question strings, not screening tool names.

✓ dontMiss — REQUIRED string (may be empty "" if no specific warning applies, but the KEY must exist in your JSON output). Contains the single most important don't-miss item, iatrogenic risk, or prescribing pitfall for THIS problem in THIS patient.

If these fields are absent from your JSON output, the response is invalid.

The illnessScript section is the anchor for the student's growing library of pattern recognition — this is the CU Trek curriculum's explicit expectation (MEPO Patient Care #8: "organize knowledge of clinical and basic medical science using illness scripts"). Even if this is a case with an obvious diagnosis, the illness script section formalizes the pattern so the student can retrieve it faster next time. Do NOT skip this section. Do NOT make it generic textbook material — always anchor each element to what our specific patient does or does not show.

Additionally include ONLY these focus-driven optional subsections based on what the attending selected: ${includedSections || "(none — core sections only)"}. Map focus keys to subsections as follows: history → focusedHistoryQuestions, physicalExam → physicalExam, workup → keyLabsAndImaging, management → treatmentApproach, patientContext → patientContextConsiderations, communication → communicationTeaching. If a focus key isn't in the selected list above, OMIT that subsection entirely (return null or empty).

Provide substantive teaching content — 2-3 sentences per learning point, thorough differential reasoning tied to case features, complete treatment rationale, and detailed shelf question explanations.

REMEMBER: ${isPreVisit
  ? "This student is reading this to PREPARE for a visit tomorrow. Write to help them UNDERSTAND why this patient's chart looks the way it does — every med, every workup, every trajectory has a story. Explain those stories. Ground everything in the specific chart facts, not textbook generalities. When the student walks in tomorrow, they should be able to say 'I understand why this patient is on this treatment' — that is the point of the learning content."
  : "This student was IN the room with you for this encounter. Write like you're reflecting on the visit with them afterward, not writing a UWorld question. Reference specifics from the note — the patient's history, quotes, labs, medications, decisions you made — as much as possible."
}`;
      const user = `Focus ${isTangential ? "TANGENTIAL topic" : "PATIENT DIAGNOSIS"} for this teaching case: ${problem}

${isPreVisit ? "Anticipated chief concern for the upcoming visit" : "Chief concern of today's encounter"}: ${chiefConcern}

${isPreVisit ? "Prenote / chart summary" : "Full clinical note"} (for context — ${isTangential ? "the tangential topic is NOT one of the patient's problems; the chart is background only" : `this patient ${isPreVisit ? "has this problem in their chart" : "actually has the focus problem above"}`}):
${notePayload}${evidenceContext}

${isTangential
  ? `Write your teaching case as an ASIDE — a related topic ${isPreVisit ? "the upcoming visit makes worth prepping" : "the encounter sparked"}, but the patient does not have this condition. Frame everything as general clinical knowledge the student should have for future encounters. Do NOT invent patient-specific features for this topic. Do NOT write "our patient" or "the patient" in a way that implies she has this condition.`
  : (isPreVisit
    ? `Write your teaching case as if you're huddling with the student BEFORE this patient's visit. Ground every teaching point in what the chart tells you and frame everything as anticipatory: what to think about, what to ask, what to look for, what to be ready to discuss. Use her chart-documented features, medications, trajectories, and context — not abstract examples.`
    : `Write your teaching case as if you and the student just walked out of this patient's room together. Ground every teaching point in what you both observed in this specific patient. Use her actual clinical features, medications, quotes, and story — not abstract examples.`
  )
}`;
      try {
        const response = await callAi(sys, user, 8000);
        const parsed = extractJson(response);
        console.log(`[teachingCase] "${problem}" citations:`, parsed.keyLearningPoints?.map(lp => lp.citation).filter(Boolean));
        // Always inject the known problem name and kind — never trust the AI to echo them correctly
        parsed.problem = problem;
        parsed.kind = kind;
        teachingCases.push(parsed);
        caseResults.push({ problem, status: "success", data: parsed });
      } catch (e) {
        console.error(`Failed to generate case for "${problem}":`, e);
        caseResults.push({ problem, status: "failed", error: e.message });
        // Continue with remaining problems instead of failing entirely
      }

      if (i < problemsToTeach.length - 1) {
        setAiStatus(prev => ({ ...prev, progress: `Working on case ${i+2} of ${problemsToTeach.length}` }));
        await wait(8000);
      }
    }

    // Cross-cutting themes as a separate small call.
    // Only run when there are 2+ actual PATIENT-DIAGNOSIS cases — tangential topics
    // aren't threads in this patient's story, so weaving them into cross-cutting themes
    // would be dishonest.
    let crossCuttingThemes = [];
    let questionsForReflection = [];
    let themesStatus = "skipped"; // "success" | "failed" | "skipped"
    let themesError = null;
    const patientDxCases = teachingCases.filter(tc => tc.kind !== "tangential");
    if (patientDxCases.length > 1) {
      await wait(3000);
      setAiStatus(prev => ({ ...prev, progress: "Generating cross-cutting themes" }));
      try {
        const themesSys = `You are the attending debriefing a case with your medical student. Identify the CONCEPTUAL threads that connect this patient's multiple problems — not restating what the problems are, but revealing the underlying clinical reasoning threads that a student should see.

Good themes are things like: "how untreated hypothyroidism creates a cascade of downstream symptoms that mimic separate diseases" or "when to prioritize adherence over titration in complex regimens" or "the challenge of sequencing referrals when multiple specialists could be involved."

Bad themes are things like: "interrelated physical conditions" or "hormonal dysregulation affecting musculoskeletal health" — these are just categories, not insights.

IMPORTANT: Only weave in the problems the patient ACTUALLY has. Do NOT include any tangential topics that were added separately for teaching purposes — those aren't threads in this patient's story.

Return ONLY valid JSON (no markdown fences):
{
  "crossCuttingThemes": ["2-3 specific clinical reasoning insights that thread through this patient's problems — written as full sentences from the attending's perspective"],
  "questionsForReflection": ["2-3 thought-provoking open-ended questions for the student to sit with after this encounter"]
}`;
        const problemSummaries = patientDxCases.map(tc =>
          `- ${tc.problem}: ${tc.primaryDiagnosis?.name || ""} — ${tc.clinicalPearl || tc.primaryDiagnosis?.briefDefinition || ""}`
        ).join("\n");
        const themesUser = `Patient chief concern: ${chiefConcern || "internal medicine encounter"}\n\nTeaching cases generated for this patient (patient-diagnosis cases only — tangential topics excluded):\n${problemSummaries}\n\nWhat are the deeper clinical reasoning threads that connect these problems in THIS patient?`;
        const themesResp = await callAi(themesSys, themesUser, 1500);
        const themesParsed = extractJson(themesResp);
        crossCuttingThemes = themesParsed.crossCuttingThemes || [];
        questionsForReflection = themesParsed.questionsForReflection || [];
        themesStatus = "success";
      } catch (e) {
        console.warn("Themes generation failed:", e);
        themesStatus = "failed";
        themesError = e.message;
      }
    }

    return { teachingCases, crossCuttingThemes, questionsForReflection, caseResults, themesStatus, themesError };
  };

  // ===== Med descriptions (pre-visit only) =====
  // Takes a list of medication names, returns a map keyed by name → short
  // description ("what it treats / mechanism of action"). Used to annotate
  // the medication list in the in-room document so the student sees why the
  // patient is on each drug at a glance. One batch call to keep it cheap.
  const generateMedDescriptions = async (medNames) => {
    if (!aiEnabled || !medNames?.length) return {};

    const sys = `You are a clinical pharmacist writing brief medication summaries for a medical student. For each medication provided, return ONE object with two very short strings:

- "treats": common clinical indications for this drug, 3-8 words. E.g., "hypertension, heart failure" or "hypothyroidism, thyroid cancer suppression".
- "mechanism": mechanism of action in plain language, 6-15 words. E.g., "ARB — blocks angiotensin II at the AT1 receptor to lower BP" or "synthetic T4 that gets converted to T3 in tissue".

Keep descriptions FACTUAL and BRIEF. No filler, no caveats, no dosing info.

Return ONLY valid JSON (no markdown fences):
{
  "medications": {
    "medication_name_1": {"treats": "...", "mechanism": "..."},
    "medication_name_2": {"treats": "...", "mechanism": "..."}
  }
}

The keys in "medications" must EXACTLY match the medication names I provide (case-insensitive OK, but preserve spelling). If a name is a brand name, use it; if it's a generic, use it.`;

    const user = `Provide brief descriptions for these medications:\n${medNames.map((m, i) => `${i + 1}. ${m}`).join("\n")}`;

    try {
      const response = await callAi(sys, user, 1500);
      const parsed = extractJson(response);
      const result = {};
      // Normalize keys for reliable lookup
      Object.entries(parsed.medications || {}).forEach(([name, desc]) => {
        result[name.toLowerCase().trim()] = desc;
      });
      return result;
    } catch (e) {
      console.warn("[generateMedDescriptions] failed:", e.message);
      return {};
    }
  };

  // ===== Lightweight teaching for non-selected problems (pre-visit only) =====
  // The student sees ALL of the patient's chronic problems in the doc, not just the ones
  // the attending selected for deep teaching. For non-selected problems we generate
  // brief content in a single batch call: brief definition, classic picture, one learning
  // point, one clinical pearl. Just enough to ground the student.
  const generateLightweightTeaching = async (nonSelectedProblems) => {
    if (!aiEnabled || !nonSelectedProblems?.length) return {};

    const sys = `You are a teaching attending writing brief background content on a patient's chronic problems that the student will encounter tomorrow. For each problem below, generate lightweight prep content — enough that the student walks in with basic grounding.

Return ONLY valid JSON (no markdown fences):
{
  "problems": {
    "<exact problem name as provided>": {
      "primaryDiagnosis": {"name": "the diagnosis", "briefDefinition": "1-2 sentences on what this is, anchored to this patient's chart if relevant"},
      "theClassicPicture": "2-3 sentences on how this typically presents, what to recognize, key features",
      "oneKeyLearningPoint": {"point": "the ONE most important thing to know", "explanation": "1-2 sentences", "citation": "real trial/guideline reference — NEVER a tool name like OpenEvidence"},
      "clinicalPearl": "a memorable one-line teaching point"
    }
  }
}

Keep it brief. Skip if a problem name is nonsense or empty. Anchor to the patient's chart context where helpful. Cite real references — society guidelines by year (e.g., "ATA 2014"), landmark trials by name (e.g., "SPRINT"), USPSTF grades — NEVER cite AI tools like OpenEvidence/UpToDate.`;

    const problemList = nonSelectedProblems.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const contextLine = chiefConcern ? `\n\nPatient context: ${chiefConcern}` : "";
    const user = `Generate lightweight teaching content for these chronic problems on the patient's chart:\n${problemList}${contextLine}\n\nStudent is in month ${phase.monthsIn} of LIC (${phase.name} phase).`;

    try {
      // Lightweight teaching batches multiple problems in one call. When the
      // patient has many chronic problems (e.g., 10+ in a complex vet), 4000
      // tokens gets truncated. Bump to 6000.
      const response = await callAi(sys, user, 6000);
      const parsed = extractJson(response);
      const result = {};
      Object.entries(parsed.problems || {}).forEach(([name, content]) => {
        result[name.toLowerCase().trim()] = content;
      });
      return result;
    } catch (e) {
      console.warn("[generateLightweightTeaching] failed:", e.message);
      return {};
    }
  };

  // PubMed AI performs best here with a single, plain-language topic per prompt.

  const generatePubmedAiPrompt = (topic) => {
    const cleanTopic = String(topic || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "");

    return cleanTopic ? `Detailed review of ${cleanTopic}` : "Detailed review of this clinical topic";
  };


// UpToDate AI aggressively rejects prompts containing identifiable patient
  // descriptors — even de-identified age, sex, titles, and hospital stubs will
  // trigger a refusal. This function strips those signals while preserving all
  // clinically relevant content (meds, doses, labs, procedures, trajectories).
  const scrubForUpToDate = (text) => {
    if (!text) return text;
    let t = text;

    // Strip title + initials patterns produced by our de-identifier
    // e.g., "Mr. BP is a 57-year-old..." → "57-year-old..."
    t = t.replace(/\b(Mr|Ms|Mx|Mrs)\.?\s+[A-Z]{1,4}\b/g, "");

    // Strip age references entirely — "57-year-old male", "57-year-old",
    // "aged 57", "age 57", "in his 50s", "in her 80s"
    t = t.replace(/\b\d{1,3}[- ]?year[- ]?old\s*(?:male|female|man|woman|patient)?/gi, "");
    t = t.replace(/\b(?:aged?|age)\s+\d{1,3}\b/gi, "");
    t = t.replace(/\bin (?:his|her|their) \d{1,2}0s\b/gi, "");

    // Strip sex/gender descriptors that were left behind
    t = t.replace(/\b(?:male|female)\s+(veteran|patient)\b/gi, "$1");

    // Strip pronoun-heavy sentence starters that read as identifying
    // ("He receives...", "She was seen by..." → "Receives...", "Was seen by...")
    t = t.replace(/^\s*(?:He|She|They)\s+/gm, "");
    t = t.replace(/([.!?]\s+)(He|She|They)\s+/g, "$1");

    // Strip our own placeholder tokens that make it look like PHI-adjacent text
    // (leftover from de-identification): "NAME", "NAME NAME", "HOSPITAL NAME",
    // "ADDRESS", "IDENTIFYING NUMBER", "DATE"
    t = t.replace(/\b(?:HOSPITAL NAME|IDENTIFYING NUMBER|VA ID removed|ID removed|phone removed|address removed|DOB removed|location removed|VA ID)\b/gi, "");
    t = t.replace(/\bNAME(?:\s+NAME)*\b/g, "");
    t = t.replace(/\bADDRESS\b/g, "");
    t = t.replace(/\bDATE\b/g, "");
    t = t.replace(/\[[^\]]*removed[^\]]*\]/gi, "");
    t = t.replace(/\[[a-z\s]+removed\]/gi, "");

    // Strip specific facility/care team stubs left after de-identification
    // ("HOSPITAL NAME via HOSPITAL NAME" → "")
    t = t.replace(/(?:via|at|from|to|by)\s+HOSPITAL NAME(?:\s+(?:via|at|from|to|by)\s+HOSPITAL NAME)*/gi, "");

    // Strip parenthetical care team members entirely
    // e.g., "(Sebrell, Physical Therapy)" or "(Lasher, Medicine)"
    t = t.replace(/\([A-Z][a-z]+(?:,\s*[A-Za-z ]+)?\)/g, "");

    // Strip service-connection %, veteran status descriptors
    t = t.replace(/\b\d{1,3}%\s+service[- ]connected(?:\s+for[^.]+)?\.?/gi, "");
    t = t.replace(/\bveteran\b/gi, "patient");

    // Collapse runs of whitespace and orphaned punctuation left by removals
    t = t.replace(/\s+([,.;:])/g, "$1");
    t = t.replace(/([,.;:])\s*\1+/g, "$1");
    t = t.replace(/\s{2,}/g, " ");
    t = t.replace(/\n{3,}/g, "\n\n");
    t = t.replace(/^\s*[.,;:]+\s*/gm, "");

    return t.trim();
  };

     // ===== External evidence prompt helpers =====

  // ICD codes are useful inside the app, but they add little to an external
  // evidence search and can be actively confusing if a code and label do not
  // agree. Keep the clinical label and omit only a trailing ICD-style code.
  const stripIcdCodeForPrompt = (value) =>
    String(value || "")
      .replace(/\s*\(([A-Z]\d{2}(?:\.\d{1,4})?)\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();


  const normalizeProblemForPrompt = (value) =>
    stripIcdCodeForPrompt(value)
      .toLowerCase()
      .replace(
        /\b(?:active|stable|in remission|of unknown etiology|unspecified)\b/g,
        " "
      )
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();


  const uniqueProblemsForPrompt = (items) => {
    const seen = new Set();

    return (items || [])
      .map(stripIcdCodeForPrompt)
      .filter(Boolean)
      .filter((item) => {
        const key = normalizeProblemForPrompt(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };


  // Deliberately abbreviate at a natural boundary. Do not add "[truncated]",
  // because external tools then reasonably conclude that required information
  // is missing.
  const clipPromptText = (value, maxChars) => {
    const text = String(value || "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!maxChars || maxChars < 1) return "";
    if (text.length <= maxChars) return text;

    const head = text.slice(0, maxChars + 1);
    const candidates = [
      head.lastIndexOf(". "),
      head.lastIndexOf("; "),
      head.lastIndexOf("\n"),
      head.lastIndexOf(", "),
      head.lastIndexOf(" "),
    ];

    const boundary = Math.max(...candidates);
    const cut =
      boundary >= Math.floor(maxChars * 0.55)
        ? boundary + 1
        : maxChars;

    return head
      .slice(0, cut)
      .replace(/[\s,;:.-]+$/, "")
      .trim();
  };


  // Preserve only the type of specialty care. Provider and facility names are
  // intentionally discarded later.
  const extractCareTypesForPrompt = (value) => {
    const text = String(value || "");

    const careTypes = [
      ["primary care", /\b(?:primary care|family medicine|internal medicine|PCP)\b/i],
      ["pulmonology", /\bpulmonolog(?:y|ist)\b/i],
      ["cardiology", /\bcardiolog(?:y|ist)\b/i],
      ["neurology", /\bneurolog(?:y|ist)\b/i],
      ["ophthalmology", /\bophthalmolog(?:y|ist)\b/i],
      ["optometry", /\boptometr(?:y|ist)\b/i],
      ["orthopedics", /\borthop(?:edics?|edist)\b/i],
      ["physical therapy", /\bphysical therap(?:y|ist)\b/i],
      ["occupational therapy", /\boccupational therap(?:y|ist)\b/i],
      ["pain management", /\bpain management\b/i],
      ["psychiatry", /\bpsychiatr(?:y|ist)\b/i],
      ["psychology", /\bpsycholog(?:y|ist)\b/i],
      ["addiction medicine", /\baddiction medicine\b/i],
      ["gastroenterology", /\bgastroenterolog(?:y|ist)\b/i],
      ["nephrology", /\bnephrolog(?:y|ist)\b/i],
      ["endocrinology", /\bendocrinolog(?:y|ist)\b/i],
      ["rheumatology", /\brheumatolog(?:y|ist)\b/i],
      ["urology", /\burolog(?:y|ist)\b/i],
      ["dermatology", /\bdermatolog(?:y|ist)\b/i],
    ];

    return careTypes
      .filter(([, pattern]) => pattern.test(text))
      .map(([label]) => label);
  };


  // Defense-in-depth scrub applied specifically to text copied into external
  // evidence tools. This is separate from the prenote reviewer because an
  // external research prompt needs less administrative detail than the saved
  // de-identified chart summary.
  const scrubExternalPromptText = (value) => {
    if (!value) return "";

    let text = String(value).replace(/\r\n?/g, "\n");

    // Direct identifiers and contact information.
    text = text.replace(
      /^[ \t*•-]*(?:patient name|name|date of birth|dob|mrn|medical record number|ssn|social security number|phone|telephone|email|address)\s*:.*$/gim,
      ""
    );

    // A patient-name label can occur in the middle of a long exported line,
    // so the beginning-of-line rule above may not see it.
    text = text.replace(
      /\bpatient\s+name\s*:\s*[^.;\n]*/gi,
      "Patient: the patient"
    );

    text = text.replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      ""
    );

    text = text.replace(
      /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
      ""
    );

    text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "");

    text = text.replace(
      /\b(?:MRN|SSN|ID|AUTH(?:ORIZATION)?)\s*[:#-]?\s*[A-Z0-9-]{5,}\b/gi,
      ""
    );

    text = text.replace(
      /\b\d{1,5}\s+[A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,4}\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Highway|Hwy)\.?\b[^\n,;]*/g,
      ""
    );

    // Patient-name forms likely to survive an incomplete earlier pass.
    text = text.replace(
      /\b(WHAT TO KNOW ABOUT|PATIENT SUMMARY FOR)\s+[A-Z][A-Z'’ -]{3,}/g,
      "$1 THE PATIENT"
    );

    text = text.replace(
      /(^|[.!?][ \t]+|\n)(?:Mr|Mrs|Ms|Mx)\.?\s+[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2}\s+(?=(?:is|was)\s+(?:an?\s+)?(?:\d{1,3}[- ]year[- ]old|\d{1,3}\s*(?:y\/o|yo))\b)/gm,
      "$1The patient "
    );

    text = text.replace(
      /(^|[.!?][ \t]+|\n)([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,2})\s+(?=(?:is|was)\s+(?:an?\s+)?(?:\d{1,3}[- ]year[- ]old|\d{1,3}\s*(?:y\/o|yo))\b)/gm,
      "$1The patient "
    );

    text = text.replace(
      /\b(?:Mr|Mrs|Ms|Mx)\.?\s+[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2}\b/g,
      "the patient"
    );

    // Provider names.
    text = text.replace(
      /\bDr\.?\s+[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,2}\b/g,
      "the clinician"
    );

    text = text.replace(
      /\b[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,2},?\s*(?:MD|DO|MBBS|NP|APRN|PA-C|PA|RN|PhD|PsyD|DPT|PT|OT)\b/g,
      "the clinician"
    );

    // Service-connection, military, and disability-rating administration.
    text = text.replace(
      /\b\d{1,3}\s*%\s*(?:service[- ]?connected|SC)\b[^.;\n]*/gi,
      ""
    );

    text = text.replace(
      /\b(?:service[- ]?connected|service connection|combined disability rating|disability rating)\b\s*:?\s*[^.;\n]*/gi,
      ""
    );

    text = text.replace(
      /[^.\n]*\brated at\s+\d{1,3}\s*%[^.\n]*[.\n]?/gi,
      ""
    );

    text = text.replace(
      /\b(?:U\.?S\.?\s+)?(?:Army|Navy|Air Force|Marine Corps|Coast Guard|Space Force)\s+veteran\b/gi,
      ""
    );

    text = text.replace(/\bveteran\b/gi, "");

    text = text.replace(
      /^[ \t*•-]*(?:military history|branch of service|deployment history)\s*:.*$/gim,
      ""
    );

    // Remove event dates. Relative clinical durations such as "for 6 months"
    // remain useful and are not removed.
    const monthName =
      "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

    text = text.replace(
      new RegExp(
        `\\b${monthName}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+(?:19|20)\\d{2})?\\b`,
        "gi"
      ),
      ""
    );

    text = text.replace(
      new RegExp(
        `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${monthName}(?:\\s+(?:19|20)\\d{2})?\\b`,
        "gi"
      ),
      ""
    );

    text = text.replace(
      new RegExp(`\\b${monthName}\\s+(?:19|20)\\d{2}\\b`, "gi"),
      ""
    );

    text = text.replace(
      /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])(?:[-/.](?:0?[1-9]|[12]\d|3[01]))?\b/g,
      ""
    );

    text = text.replace(
      /\b(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.](?:\d{2}|(?:19|20)\d{2})\b/g,
      ""
    );

    text = text.replace(
      /\b(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}\b/g,
      ""
    );

    text = text.replace(/\b(?:19|20)\d{2}\b/g, "");

    // Clean remnants such as "04/" left by prior date scrubbing.
    text = text.replace(
      /\b(?:0?[1-9]|1[0-2])\/(?=\s|[,.;)]|$)/g,
      ""
    );

    text = text.replace(
      /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b,?/gi,
      ""
    );

    // Named facilities and locations.
    text = text.replace(
      /\b(?:at|from|through|via)\s+(?:the\s+)?[^,.;\n]{1,80}?\b(?:Medical Center|Hospital|Health(?:care)?|Health System|Clinic|CBOC|VAMC|Orthopedics|Pulmonology)\b/gi,
      ""
    );

    text = text.replace(
      /\b(?:[A-Z][A-Za-z'&.-]*\s+){1,5}(?:Medical Center|Hospital|Health(?:care)?|Health System|Clinic|CBOC|VAMC|Orthopedics)\b/g,
      ""
    );

    text = text.replace(
      /\b(?:[A-Z][a-z]+\s+){1,4}VA\b/g,
      ""
    );

    text = text.replace(
      /\b[A-Z][a-zA-Z]+,\s*[A-Z]{2}\b/g,
      ""
    );

    // Remove administrative lines after care-type extraction.
    text = text.replace(
      /^[ \t*•-]*(?:care team|provider|author|attending|supervising physician|cosigner|signed by|facility|location|site|campus|place of service)\s*:.*$/gim,
      ""
    );

    // Cleanup.
    text = text.replace(
      /\[\s*(?:ID|DOB|phone|address|location|VA ID)\s+removed\s*\]/gi,
      ""
    );

    text = text.replace(/\(\s*\)/g, "");
    text = text.replace(/\bwith\s*\./gi, ".");
    text = text.replace(/\bfrom\s+to\s+present\b/gi, "ongoing");
    text = text.replace(/\bfrom\s+to\b/gi, "");
    text = text.replace(
      /\b(?:he|she|they|the patient)\s+(?:is|was|has|had)\s*\./gi,
      ""
    );
    text = text.replace(/([.!?])\1+/g, "$1");
    text = text.replace(/(^|[.!?]\s+)the clinician\b/g, "$1The clinician");
    text = text.replace(/(^|[.!?]\s+)the patient\b/g, "$1The patient");
    text = text.replace(/[ \t]+([,.;:])/g, "$1");
    text = text.replace(/^[ \t]*[,.;:|/-]+[ \t]*$/gm, "");
    text = text.replace(/[ \t]{2,}/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
  };


  const promptProblemTokens = (value) => {
    const stopWords = new Set([
      "a",
      "an",
      "and",
      "the",
      "of",
      "on",
      "in",
      "with",
      "without",
      "for",
      "to",
      "due",
      "active",
      "stable",
      "history",
      "remission",
      "unknown",
      "etiology",
    ]);

    return normalizeProblemForPrompt(value)
      .split(" ")
      .filter(
        (token) =>
          token.length > 2 &&
          !stopWords.has(token)
      );
  };


  const findProblemBlockForPrompt = (problem, blocks) => {
    const targetKey = normalizeProblemForPrompt(problem);
    const targetTokens = promptProblemTokens(problem);

    let best = null;
    let bestScore = 0;

    Object.values(blocks || {}).forEach((block) => {
      const blockKey = normalizeProblemForPrompt(block.rawHeader);
      if (!blockKey) return;

      let score = 0;

      if (blockKey === targetKey) {
        score = 100;
      } else if (
        blockKey.includes(targetKey) ||
        targetKey.includes(blockKey)
      ) {
        score = 80;
      } else {
        const blockTokens = new Set(
          promptProblemTokens(block.rawHeader)
        );

        const overlap = targetTokens.filter(
          (token) => blockTokens.has(token)
        ).length;

        score = targetTokens.length
          ? (overlap / targetTokens.length) * 70
          : 0;
      }

      if (score > bestScore) {
        best = block;
        bestScore = score;
      }
    });

    return bestScore >= 35 ? best : null;
  };


  const relevantPromptSnippets = (
    value,
    problem,
    maxChars,
    scrubber = scrubExternalPromptText
  ) => {
    const cleaned = scrubber(value);
    if (!cleaned || maxChars < 80) return "";

    const tokens = promptProblemTokens(problem);

    const units = cleaned
      .replace(/([.!?])\s+/g, "$1\n")
      .split(/\n+/)
      .map((line) =>
        line.replace(/^[ *•-]+/, "").trim()
      )
      .filter((line) => line.length >= 20);

    const scored = units
      .map((line, index) => {
        const lower = line.toLowerCase();

        const hits = tokens.reduce(
          (sum, token) =>
            sum + (lower.includes(token) ? 1 : 0),
          0
        );

        return {
          line,
          index,
          score: hits,
        };
      })
      .filter((item) => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.index - b.index
      );

    const output = [];
    const seen = new Set();
    let used = 0;

    for (const item of scored) {
      const key = item.line.toLowerCase();
      if (seen.has(key)) continue;

      const room =
        maxChars -
        used -
        (output.length ? 1 : 0);

      if (room < 60) break;

      const clipped = clipPromptText(
        item.line,
        room
      );

      if (!clipped) continue;

      output.push(clipped);
      seen.add(key);

      used +=
        clipped.length +
        (output.length > 1 ? 1 : 0);
    }

    return output.join(" ");
  };


  // Build a small, evenly distributed context block. Each selected problem
  // receives its own allowance, so the first PMH problem cannot consume the
  // context intended for all later problems.
  const buildExternalContextForPrompt = (
    problems,
    totalBudget,
    scrubber = scrubExternalPromptText
  ) => {
    if (
      !clinicalNote ||
      !problems.length ||
      totalBudget < 250
    ) {
      return "";
    }

    let problemSource = "";
    let fallbackSource = "";

    if (sessionMode === "pre") {
      const sections =
        extractPrenoteSections(clinicalNote);

      problemSource =
        getSection(
          sections,
          "PAST MEDICAL HISTORY",
          "PMH"
        ) || "";

      fallbackSource = [
        getSection(
          sections,
          "WHAT TO KNOW ABOUT",
          "PATIENT SUMMARY",
          "SUMMARY"
        ),
        problemSource,
        getSection(
          sections,
          "LABORATORY STUDIES",
          "LABS",
          "LABORATORY RESULTS",
          "RECENT LABS"
        ),
        getSection(
          sections,
          "IMAGING AND DIAGNOSTIC PROCEDURES",
          "IMAGING",
          "DIAGNOSTIC PROCEDURES"
        ),
      ]
        .filter(Boolean)
        .join("\n");
    } else {
      problemSource =
        extractEssentialNote(clinicalNote);

      fallbackSource = problemSource;
    }

    const blocks =
      parseProblemBlocks(problemSource);

    const heading =
      "Concise clinical context by problem:";

    const separators =
      Math.max(0, problems.length - 1) * 2;

    const available =
      totalBudget -
      heading.length -
      2 -
      separators;

    const perSection = Math.floor(
      available / problems.length
    );

    if (perSection < 80) return "";

    const contextSections = problems
      .map((problem) => {
        const block =
          findProblemBlockForPrompt(
            problem,
            blocks
          );

        const label = `${problem}:\n`;

        const bodyBudget = Math.max(
          40,
          perSection - label.length
        );

        if (!block) {
          const fallback =
            relevantPromptSnippets(
              fallbackSource,
              problem,
              bodyBudget,
              scrubber
            );

          return fallback
            ? `${label}${fallback}`
            : "";
        }

        const careTypes =
          extractCareTypesForPrompt(
            block.careTeam || ""
          );

        const fields = [
          [
            "Status",
            block.currentStatus ||
              block.recentControl,
          ],
          [
            "Current treatment",
            block.currentMeds,
          ],
          [
            "Relevant trends",
            block.labTrends,
          ],
          [
            "Key tests",
            block.imaging,
          ],
          [
            "Additional context",
            block.statusNotes,
          ],
        ]
          .map(([fieldLabel, raw]) => [
            fieldLabel,
            scrubber(raw),
          ])
          .filter(([, cleaned]) =>
            Boolean(cleaned)
          );

        if (
          !fields.length &&
          block.rawBody
        ) {
          fields.push([
            "Clinical context",
            scrubber(block.rawBody),
          ]);
        }

        if (careTypes.length) {
          fields.push([
            "Specialty care",
            careTypes.join(", "),
          ]);
        }

        if (!fields.length) {
          const fallback =
            relevantPromptSnippets(
              fallbackSource,
              problem,
              bodyBudget,
              scrubber
            );

          return fallback
            ? `${label}${fallback}`
            : "";
        }

        const pieces = [];
        let remaining = bodyBudget;

        fields.forEach(
          ([fieldLabel, fieldText], index) => {
            const fieldsLeft =
              fields.length - index;

            const allotment = Math.floor(
              remaining / fieldsLeft
            );

            const valueBudget = Math.max(
              20,
              allotment -
                fieldLabel.length -
                2
            );

            const clipped = clipPromptText(
              fieldText,
              valueBudget
            );

            if (!clipped) return;

            const piece =
              `${fieldLabel}: ${clipped}`;

            pieces.push(piece);
            remaining -= piece.length + 1;
          }
        );

        const body = clipPromptText(
          pieces.join(" "),
          bodyBudget
        );

        return body
          ? `${label}${body}`
          : "";
      })
      .filter(Boolean);

    return contextSections.length
      ? `${heading}\n${contextSections.join("\n\n")}`
      : "";
  };

  // ===== Source prompt generator =====
  // External AI research tools (UpToDate, OpenEvidence, DynaMed, DoxGPT) have
  // input character limits (UpToDate caps around 10K). The old prompt dumped
  // the entire de-identified clinical note as context — for a full prenote
  // this could be 20K+ characters and blow past the limit.
  //
  // The new approach: extract ONLY the sections that are actually useful
  // context for an AI research tool — WHAT TO KNOW ABOUT (patient summary),
  // laboratory results, and imaging/diagnostic procedures — and cap the
  // whole prompt at 9500 chars with a console warning if we hit it.
  //
  // PubMed AI has its own single-topic prompt (generatePubmedAiPrompt) and
  // is intentionally untouched.
  // ===== Source prompt generator =====
  // External AI research tools (UpToDate, OpenEvidence, DynaMed, DoxGPT) have
  // input character limits (UpToDate caps around 10K). The old prompt dumped
  // the entire de-identified clinical note as context — for a full prenote
  // this could be 20K+ characters and blow past the limit.
  //
  // Approach: build context differently depending on session mode.
  //   Pre-visit: pull labeled sections (WHAT TO KNOW + Labs + Imaging)
  //   Post-visit: use extractEssentialNote() to strip social/family/surgical/
  //     military history, immunizations, normal exam, return precautions,
  //     med reconciliation, care coordination boilerplate. Keeps HPI,
  //     assessment, plan, active meds, labs, and relevant clinical findings.
  //
  // Hard cap at 9500 chars with a console warning + graceful truncation notice
  // so we never breach UpToDate's limit. PubMed AI has its own single-topic
  // prompt (generatePubmedAiPrompt) and is intentionally untouched.
    const generateSourcePrompt = (source) => {
    // These are conservative app budgets, not claims about each service's
    // official limit. The completed instructions are never sliced.
    // Caps bumped from prior version because the new output-structure block is
    // longer, and the requested output is longer too. UpToDate stays tighter
    // because it rejects long prompts more aggressively.
    const promptCaps = {
      uptodate: 7500,
      doxgpt: 7500,
      openevidence: 8500,
      dynamed: 8500,
      other: 8500,
    };

    const promptCap =
      promptCaps[source] || 6500;

    const scrubber = (value) => {
      const generallyScrubbed =
        scrubExternalPromptText(value);

      return source === "uptodate"
        ? scrubForUpToDate(generallyScrubbed)
        : generallyScrubbed;
    };

    const activeFocus = Object.keys(
      focusAreas
    ).filter((key) => focusAreas[key]);

    const focusText = activeFocus
      .map((key) => focusLabels[key])
      .join(", ");

    // The numbered list comes only from problems explicitly selected for
    // teaching. The chief concern remains an intact presenting concern.
    const problems = uniqueProblemsForPrompt(
      selectedProblems.length > 0
        ? selectedProblems
        : workingDx?.trim()
          ? [workingDx]
          : []
    );

    const presentingConcern =
      scrubber(chiefConcern);

    const topicItems = [
      ...extractedTopics,
      ...customTopics,
    ]
      .map((topic) =>
        clipPromptText(
          scrubber(topic),
          170
        )
      )
      .filter(Boolean)
      .slice(0, 6);

    // Learner level — phase-aware framing that reads naturally to external tools.
    // End-of-year students get shelf/PGY-1 framing; earlier students get their
    // phase mentioned so the tool calibrates depth appropriately.
    const learnerLine = phase.monthsIn >= 9
      ? "Learner level: End-of-clerkship / incoming PGY-1 internal medicine. Tailor teaching to shelf exam preparation AND early residency clinical decision-making."
      : phase.monthsIn >= 5
      ? `Learner level: Mid-clerkship medical student (month ${phase.monthsIn} of longitudinal integrated clerkship). Tailor teaching to shelf exam preparation and developing clinical reasoning — assume solid basic sciences but developing clinical judgment.`
      : `Learner level: Early clerkship medical student (month ${phase.monthsIn} of longitudinal integrated clerkship). Tailor teaching to foundational clinical reasoning and pattern recognition — assume strong basic sciences but limited clinical exposure.`;

    const concernLine = presentingConcern
      ? `Presenting concern: ${presentingConcern}${/[.!?]$/.test(presentingConcern) ? "" : "."}`
      : "";

    const focusLine = focusText
      ? `Teaching focus: ${focusText}. Apply these areas where clinically relevant; do not force repetitive subsections.`
      : "Teaching focus: clinical reasoning, diagnostic workup, and management.";

    // Multi-problem framing — enumerated as co-equal with an explicit demand
    // that each problem gets comparable depth. This is what makes the model
    // resist the "focus on the first problem, mention the rest" trap.
    let problemBlock = "";
    if (problems.length > 1) {
      const numberedProblems = problems
        .map((problem, index) => `${index + 1}. ${problem}`)
        .join("\n");
      problemBlock =
        "This is a MULTI-PROBLEM teaching case. Give each problem its own section with comparable depth and attention. Do not treat one problem merely as context for another. Identify clinically meaningful relationships and explain them.\n\n" +
        "Problems\n\n" +
        numberedProblems;
    } else if (problems.length === 1) {
      problemBlock = `Problem for teaching:\n1. ${problems[0]}`;
    } else {
      problemBlock = "Use the presenting concern above as the clinical problem for teaching.";
    }

    let topicsLine = topicItems.length
      ? `Additional topics to incorporate only where relevant\n${topicItems.join("; ")}.`
      : "";

    const lensName = {
      geriatrics: "geriatrics and deprescribing",
      primary_care: "primary care and prevention",
      complex_multimorbidity: "complex multimorbidity and competing priorities",
    }[teachingLens];
    const lensLine = lensName ? `Teaching lens: ${lensName}.` : "";

    // The output-structure block — the heart of the new prompt. Explicit,
    // numbered, with concrete examples of what "good" looks like. Same block
    // for all sources except UpToDate, which gets a variant that respects
    // its recommendation-grade convention.
    const requestBlock = source === "uptodate"
      ? `Output instructions
For each problem, include ALL of the following:

1. Shelf Exam Pearls — Board-testable pathophysiology, classifications, mnemonics, and key distinctions. Explain the physiologic reasoning, not just the fact.
2. Diagnostic reasoning — Patient-specific interpretation of labs, imaging, or findings. Highlight when findings are discordant or unexpected and explain the differential for that discordance.
3. Workup — Evidence-based next steps with UpToDate's current recommendations. Explain WHY each test is recommended.
4. Management — Current UpToDate-recommended treatment, including decision thresholds, dosing principles, and when to escalate or refer. Include UpToDate recommendation grades where explicitly provided.
5. Alternatives table — Where multiple treatment options exist, present a markdown table with columns for indication, efficacy, and key considerations.
6. High-yield citations — Up to 5 per problem. Name the guideline/society/year for the underlying evidence UpToDate references.
7. Practice-changing evidence — Note important updates from the last 2–3 years only when they materially affect care.
${problems.length > 1 ? `
After all problem sections, include:
* Cross-Problem Interactions section — Identify every clinically meaningful relationship between problems. Explain the physiologic or management link (e.g., oxygen delivery equation with concurrent anemia and hypoxemia; comorbidity burden affecting cancer screening decisions; perioperative risk implications). This section should be substantive, not a brief afterthought.
` : ""}
Formatting rules:
* Use current UpToDate recommendations; include a recommendation grade only when UpToDate explicitly supplies one.
* Include relevant figures, algorithms, and tables where available.
* Do not restate the full case history, invent patient facts, or repeat the same evidence across sections.
* Use markdown tables for comparisons. Use bold for key terms and diagnoses.
* Each problem section should be thorough but concise — prioritize clinical utility and scannability.`
      : `Output instructions
For each problem, include ALL of the following:

1. Shelf Exam Pearls — Board-testable pathophysiology, classifications, mnemonics, and key distinctions (e.g., RDW in IDA vs. thalassemia; AHI severity classification; LaPlace's law for AAA). Explain the physiologic reasoning, not just the fact.
2. Diagnostic reasoning — Patient-specific interpretation of labs, imaging, or findings. Highlight when findings are discordant or unexpected (e.g., mild obstruction with severe hypoxemia) and explain the differential for that discordance.
3. Workup — Evidence-based next steps with guideline source (society, year). Explain why each test is recommended (e.g., bidirectional endoscopy because synchronous upper/lower GI pathology occurs in 1–10% of cases).
4. Management — Current guideline-recommended treatment, including decision thresholds, dosing principles, and when to escalate or refer. Include landmark trial names (author, journal, year) for pivotal evidence (e.g., PIVOTAL trial for IV iron in CKD, NOTT/MRC for LTOT, ADAM trial for small AAA).
5. Guideline comparison table — Where multiple societies have differing recommendations (e.g., PSA screening: USPSTF vs. AUA vs. NCCN), present a concise markdown table comparing them.
6. Alternatives table — Where multiple treatment options exist (e.g., OSA alternatives to CPAP), present a markdown table with columns for indication, efficacy, and key considerations.
7. High-yield citations — Up to 5 per problem. Name the guideline/society/year; for key studies, give author or trial name, year, and journal.
8. Practice-changing evidence — Note important updates from the last 2–3 years only when they materially affect care.
${problems.length > 1 ? `
After all problem sections, include:
* Cross-Problem Interactions section — Identify every clinically meaningful relationship between problems. Explain the physiologic or management link (e.g., oxygen delivery equation with concurrent anemia and hypoxemia; comorbidity burden affecting cancer screening decisions; perioperative risk implications). This section should be substantive, not a brief afterthought.
` : ""}
Formatting rules:
* Use current guidelines and primary evidence. Name the guideline or society and year.
* Include relevant figures, algorithms, and tables from the literature where available.
* Do not restate the full case history, invent patient facts, or repeat the same evidence across sections.
* Use markdown tables for comparisons. Use bold for key terms and diagnoses.
* Each problem section should be thorough (no arbitrary word limit) but concise — prioritize clinical utility and scannability.`;

    // The teaching-focus line sits immediately before the problem framing.
    const renderPrompt = (contextBlock) =>
      [
        learnerLine,
        concernLine,
        focusLine,
        problemBlock,
        topicsLine,
        lensLine,
        contextBlock,
        requestBlock,
      ]
        .filter(Boolean)
        .join("\n\n");

    // Calculate context space before inserting any context. The instructions at
    // the end are therefore always preserved.
    let prompt = renderPrompt("");

    let contextBudget = Math.min(
      2600,
      Math.max(
        0,
        promptCap - prompt.length - 4
      )
    );

    let contextBlock =
      buildExternalContextForPrompt(
        problems,
        contextBudget,
        scrubber
      );

    // Fail closed if an obvious direct identifier somehow survived all passes.
        const obviousDirectIdentifier =
      /\b(?:DOB|MRN|SSN|medical record number|social security number|patient name)\b|\b\d{3}-\d{2}-\d{4}\b|\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/i;

    if (
      contextBlock &&
      obviousDirectIdentifier.test(
        contextBlock
      )
    ) {
      console.warn(
        "[generateSourcePrompt] Clinical context omitted because a possible direct identifier remained after scrubbing."
      );
      contextBlock = "";
    }

    prompt = renderPrompt(contextBlock);

    // Recalculate the context allocation if formatting overhead pushed us
    // slightly over budget. Never slice the completed prompt.
    if (
      prompt.length > promptCap &&
      contextBudget > 0
    ) {
      contextBudget = Math.max(
        0,
        contextBudget -
          (prompt.length - promptCap) -
          50
      );

      contextBlock =
        buildExternalContextForPrompt(
          problems,
          contextBudget,
          scrubber
        );

      prompt = renderPrompt(contextBlock);
    }

    // Last-resort reduction: drop optional topics and context while preserving
    // the clinical problem list and complete evidence request.
    if (prompt.length > promptCap) {
      topicsLine = "";
      prompt = renderPrompt("");
    }

    if (prompt.length > promptCap) {
      console.warn(
        `[generateSourcePrompt] Fixed prompt content is ${prompt.length} characters, above the internal ${promptCap}-character budget.`
      );
    }

    return prompt;
  };

  // ===== Generate preview (was: generate document) =====
  // Optional opts:
  //   retryFailedOnly: if true, only re-run units that failed in the last attempt.
  //                    Successful synthesis and cases are reused from state cache.
  const generateDocument = async (opts = {}) => {
    const { retryFailedOnly = false } = opts;
    setAiStatus({ ...aiStatus, generating: true, error: null });
    let aiContent = null;
    let synthesized = null;

    // Build cache of previously-successful outputs. Only used when retryFailedOnly is true.
    const cachedSuccessfulCases = {};
    if (retryFailedOnly && aiTeachingContent?.teachingCases) {
      aiTeachingContent.teachingCases.forEach(tc => {
        // A case is "successful" if it made it into teachingCases (failed ones never do)
        cachedSuccessfulCases[tc.problem] = tc;
      });
    }

    // Track this attempt's per-unit outcomes for the summary panel
    const attempt = {
      synthesis: null,
      cases: {},
      themes: null,
      lastRunAt: Date.now(),
      errors: [],
    };

    const filledSources = activeSources.filter(s =>
      s === "pubmedai"
        ? Object.values(sourceResponses.pubmedai || {}).some(v => v?.html?.trim())
        : sourceResponses[s]?.html?.trim()
    );

    if (aiEnabled && activeFocusList.length > 0) {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      // Call 1: Synthesize sources first, so teaching cases can reference structured claims.
      // Reuse cached synthesis if this is a retry AND synthesis previously succeeded.
      const hasPdfs = pdfAttachments.some(p => p.extractedText?.trim() && !p.error);
      const shouldSynthesize = filledSources.length >= 1 || hasPdfs;
      const canReuseSynthesis = retryFailedOnly && generationAttempts.synthesis === "success" && synthesizedEvidence;

      if (shouldSynthesize && canReuseSynthesis) {
        console.log("[generateDocument] Reusing cached synthesis from prior attempt");
        synthesized = synthesizedEvidence;
        attempt.synthesis = "success";
      } else if (shouldSynthesize) {
        setAiStatus({ analyzing: false, generating: true, error: null, progress: "Synthesizing evidence from all sources" });
        try {
          synthesized = await synthesizeSources();
          setSynthesizedEvidence(synthesized);
          attempt.synthesis = "success";
        } catch (e) {
          attempt.synthesis = "failed";
          attempt.errors.push({ unit: "synthesis", message: e.message });
        }
        await wait(3000);
      } else {
        attempt.synthesis = "skipped";
      }

      // Call 2: Teaching content — passes synthesis + cached successful cases
      setAiStatus(prev => ({ ...prev, progress: "Generating teaching cases" }));
      try {
        aiContent = await generateAiTeachingContent(synthesized, cachedSuccessfulCases, retryFailedOnly);

        // Pre-visit only: extract current-medications from the prenote and get brief
        // descriptions for each. This annotates the top medication table in the in-room doc.
        if (sessionMode === "pre") {
          const sections = extractPrenoteSections(clinicalNote);
          const medRec = getSection(sections, "MED REC", "MEDICATIONS", "MEDICATION LIST");
          if (medRec) {
            const currentMedSection = extractCurrentMedsSubsection(medRec);
            const medNames = parseMedNames(currentMedSection);
            if (medNames.length > 0) {
              setAiStatus(prev => ({ ...prev, progress: `Getting descriptions for ${medNames.length} medications` }));
              try {
                const descriptions = await generateMedDescriptions(medNames);
                aiContent.medDescriptions = descriptions;
              } catch (e) {
                console.warn("Med descriptions failed:", e);
                aiContent.medDescriptions = {};
              }
            }
          }

          // Also generate LIGHTWEIGHT teaching for all non-selected problems from PMH.
          // These are the problems the attending didn't pick for deep teaching — the student
          // still sees them in the doc, but with brief prep content rather than full cases.
          const pmhText = getSection(sections, "PAST MEDICAL HISTORY", "PMH");
          if (pmhText) {
            const problemBlocks = parseProblemBlocks(pmhText);
            const allProblemNames = Object.keys(problemBlocks).map(k => problemBlocks[k].rawHeader);
            const selectedLower = new Set((selectedProblems || []).map(p => p.toLowerCase().trim()));
            // Non-selected = problems in the prenote NOT already in the deep-teaching selection
            const nonSelected = allProblemNames.filter(name => {
              const nl = name.toLowerCase().trim();
              // Fuzzy match: skip if any selected problem shares significant tokens
              for (const sel of selectedLower) {
                if (nl.includes(sel) || sel.includes(nl)) return false;
                // Strip ICD parens and common qualifiers for a looser check
                const cleanN = nl.replace(/\([^)]*\)/g, "").replace(/\b(untreated|stable|chronic|active|history|of)\b/g, "").trim();
                const cleanS = sel.replace(/\([^)]*\)/g, "").replace(/\b(untreated|stable|chronic|active|history|of)\b/g, "").trim();
                if (cleanN && cleanS && (cleanN.includes(cleanS) || cleanS.includes(cleanN))) return false;
              }
              return true;
            });
            if (nonSelected.length > 0) {
              setAiStatus(prev => ({ ...prev, progress: `Generating brief teaching for ${nonSelected.length} background problems` }));
              try {
                const lightweight = await generateLightweightTeaching(nonSelected);
                aiContent.lightweightTeaching = lightweight;
              } catch (e) {
                console.warn("Lightweight teaching failed:", e);
                aiContent.lightweightTeaching = {};
              }
            }
          }
        }

        // Record per-case outcomes
        (aiContent?.caseResults || []).forEach(cr => {
          attempt.cases[cr.problem] = {
            status: cr.status,
            error: cr.error || null,
          };
          if (cr.status === "failed") {
            attempt.errors.push({ unit: `case: ${cr.problem}`, message: cr.error });
          }
        });

        // Record themes outcome
        attempt.themes = aiContent?.themesStatus || "skipped";
        if (aiContent?.themesStatus === "failed" && aiContent?.themesError) {
          attempt.errors.push({ unit: "themes", message: aiContent.themesError });
        }

        setAiTeachingContent(aiContent);
      } catch (e) {
        // Only reached if generateAiTeachingContent itself throws (not per-case failures).
        // Per-case failures are handled above by looking at caseResults.
        attempt.errors.push({ unit: "teaching-content-batch", message: e.message });
      }

      // Save attempt state so the summary panel can read it
      setGenerationAttempts(attempt);

      if (attempt.errors.length > 0) {
        console.error("Generation errors:", attempt.errors);
        const summaryMsg = attempt.errors.length === 1
          ? attempt.errors[0].message
          : `${attempt.errors.length} generation errors — see summary in Review tab`;
        setAiStatus({ analyzing: false, generating: false, error: summaryMsg, progress: null });
      } else {
        setAiStatus({ analyzing: false, generating: false, error: null, progress: null });
      }
    } else {
      // AI disabled or no focus areas selected — still handle sources
      const hasPdfs = pdfAttachments.some(p => p.extractedText?.trim() && !p.error);
      if (filledSources.length >= 1 || hasPdfs) {
        try {
          synthesized = await synthesizeSources();
          attempt.synthesis = "success";
        } catch (e) {
          console.error("Synthesis failed:", e);
          attempt.synthesis = "failed";
          attempt.errors.push({ unit: "synthesis", message: e.message });
        }
        setGenerationAttempts(attempt);
      }
    }

    // Collect all pasted images across sources for the final document
    const allSourceImages = [];
    activeSources.forEach(s => {
      if (s === "pubmedai") {
        Object.entries(sourceResponses.pubmedai || {}).forEach(([topic, v]) => {
          (v?.images || []).forEach(img => allSourceImages.push({ ...img, source: `PubMed AI: ${topic}` }));
        });
      } else {
        (sourceResponses[s]?.images || []).forEach(img => allSourceImages.push({ ...img, source: sourceLabels[s] }));
      }
    });

    const preview = {
      generated: new Date().toLocaleString(),
      generatedIso: new Date().toISOString(),
      sessionId: `s-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`,  // one-off ID for footer/filename
      sessionTitle: deriveDocTitle({
        workingDx,
        chiefConcern,
        sessionDate: session.sessionDate,
      }),
      appOrigin: window.location.origin + window.location.pathname,
      student: session.studentName || "Student",
      phase, chiefConcern, workingDx,
      complexity: session.complexity, sessionGoal, extractedTopics,
      focusAreas: activeFocusList,
      teachingLens,
      activeProblems, selectedProblems, patientQuotes, labTrends,
      longTermGoals,
      noteAnalysis,
      allSourceImages,
      imageAttachments,
      // Full de-identified prenote text — used by pre-visit in-room doc to render
      // verbatim chart sections (PMH, FH, SH, meds, labs, imaging, preventive, etc.)
      rawPrenote: sessionMode === "pre" ? clinicalNote : null,
      // AI-generated medication descriptions (pre-visit only) — keyed by lowercased med name
      medDescriptions: aiContent?.medDescriptions || null,
      // Lightweight teaching content for non-selected problems (pre-visit only)
      lightweightTeaching: aiContent?.lightweightTeaching || null,
      sessionMode,
      sections: {
        caseAtGlance: { enabled: true, editable: false },
        sessionGoal: { enabled: !!sessionGoal, content: sessionGoal },
        phaseFraming: { enabled: true, editable: false },
        teachingCases: (aiContent?.teachingCases || []).map((tc, idx) => ({
          enabled: true,
          data: tc,
          id: `tc-${idx}`,
        })),
        labTrends: { enabled: labTrends.length > 0, content: labTrends },
        crossCuttingThemes: {
          enabled: (aiContent?.crossCuttingThemes || []).length > 0,
          content: aiContent?.crossCuttingThemes || [],
        },
        synthesizedEvidence: {
          enabled: !!synthesized,
          content: synthesized,
          note: !!synthesized && !!aiContent ? "Evidence has been integrated into teaching cases above. Enable this section to also show as a standalone summary." : null,
        },
        longTermGoals: { enabled: longTermGoals.length > 0, content: longTermGoals },
        nextSessionPrep: {
          enabled: true,
          reflectionQuestions: aiContent?.questionsForReflection || [],
        },
      },
    };

    // Switch to output tab BEFORE preview data lands so the user sees the handoff panel
    setActiveTab("output");
    // Small delay so the tab switch registers visually before content pops in
    await new Promise(r => setTimeout(r, 400));
    setPreviewData(preview);
    setPreviewMode(true);
    setAiStatus({ analyzing: false, generating: false, error: aiStatus.error, progress: null });
  };

  const commitPreviewToDocument = () => {
    if (!previewData) return;
    setGeneratedDoc(previewData);
    setPreviewMode(false);
  };

  const togglePreviewSection = (path) => {
    setPreviewData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split(".");
      let obj = next.sections;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]].enabled = !obj[parts[parts.length - 1]].enabled;
      return next;
    });
  };
  const toggleTeachingCase = (idx) => {
    setPreviewData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.sections.teachingCases[idx].enabled = !next.sections.teachingCases[idx].enabled;
      return next;
    });
  };
  const updatePreviewField = (path, value) => {
    setPreviewData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const parts = path.split(".");
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  };
  const updateTeachingCaseField = (caseIdx, field, value) => {
    setPreviewData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      next.sections.teachingCases[caseIdx].data[field] = value;
      return next;
    });
  };

    

  const addPdfAttachments = async (files) => {
    if (!files || files.length === 0) return;
    setProcessingPdf(true);
    const results = [];
    for (const file of files) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) continue;
      try {
        const { text, pageCount, extractedPageCount } = await extractPdfText(file);
        const pdfEntry = {
          id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filename: file.name,
          extractedText: text,
          pageCount,
          extractedPageCount,
          isScannedLikely: text.length < 200 && pageCount > 0,
          citation: null, // will be populated asynchronously
          addedAt: new Date().toLocaleString(),
        };
        results.push(pdfEntry);
      } catch (e) {
        console.error(`PDF extraction failed for ${file.name}:`, e);
        results.push({
          id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          filename: file.name,
          extractedText: "",
          pageCount: 0,
          extractedPageCount: 0,
          error: e.message,
          citation: null,
          addedAt: new Date().toLocaleString(),
        });
      }
    }
    setPdfAttachments(prev => [...prev, ...results]);
    setProcessingPdf(false);

    // Kick off citation extraction serially in background (avoids rate limits).
    // Fire-and-forget — non-blocking to the user.
    if (aiEnabled) {
      (async () => {
        for (const pdf of results) {
          if (!pdf.extractedText || pdf.error) continue;
          await extractPdfCitation(pdf);
          // Small gap between PDFs to be gentle on rate limits
          await new Promise(r => setTimeout(r, 800));
        }
      })().catch(e => console.warn("PDF citation batch failed:", e));
    }
  };

  // Ask the AI to produce a short AMA-style citation from the PDF's title page / abstract text.
  // Runs once per PDF, non-blocking, populated into pdfAttachments state when ready.
  const extractPdfCitation = async (pdf, opts = {}) => {
    const { attempt = 1 } = opts;
    // Mark as "extracting" so UI can show a spinner on this specific card
    setPdfAttachments(prev => prev.map(p =>
      p.id === pdf.id ? { ...p, citationExtracting: true, citationError: null } : p
    ));

    // Build a smarter sample: header + tail (references often live at the end)
    const text = pdf.extractedText;
    let sample;
    if (attempt === 1) {
      // First pass: focused sample — header (title/authors/journal) + tail (bibliography sometimes has self-citation)
      const head = text.slice(0, 4000);
      const tail = text.length > 6000 ? text.slice(-1500) : "";
      sample = tail ? `${head}\n\n[...body omitted...]\n\n${tail}` : head;
    } else {
      // Retry pass: much bigger window — some PDFs have covers/TOCs before the real title page
      sample = text.slice(0, 10000);
    }

    const sys = `You extract short AMA-style citations from academic article text. Look for: title, first author's surname, "et al." for multiple authors, journal name (or its standard abbreviation), publication year, volume/issue/pages, DOI, and any "cite as" or "how to cite" instruction the article itself provides.

Return ONLY valid JSON (no markdown fences):
{
  "citation": "Short AMA format: 'FirstAuthor et al. JournalAbbrev. Year;Volume(Issue):Pages.' — omit any fields you cannot find. Examples: 'Rodondi N et al. JAMA. 2010;304(12):1365-72.', 'Layon et al. Aesthet Plast Surg. 2021.', 'Perdikis et al. Plast Reconstr Surg. 2022.'. For book chapters: 'Author. Chapter Title. In: Book Title. Publisher; Year.'. If you can only identify a title, use: 'Untitled — [title as shown]'.",
  "shortLabel": "Very short display label, 30 chars max: 'FirstAuthor et al. Year' — e.g. 'Layon et al. 2021', 'Rodondi et al. 2010'. If year is unknown, use just 'FirstAuthor et al.'. If author is unknown, use short title."
}

NEVER fabricate authors, years, journals, or numbers you cannot see in the text. Look carefully — the title is often in the largest heading; authors follow immediately below; journal/year often appear in a header, footer, or DOI line like "doi.org/10.1016/j.xxx.2021.xx.xxx". If the text truly contains no identifiable citation, return: {"citation": "", "shortLabel": ""}`;

    const user = `Extract the AMA citation from this PDF's text:\n\n${sample}`;

    try {
      const response = await callAi(sys, user, 400);
      const parsed = extractJson(response);
      const hasResult = parsed.citation?.trim() || parsed.shortLabel?.trim();

      if (hasResult) {
        setPdfAttachments(prev => prev.map(p =>
          p.id === pdf.id
            ? { ...p, citation: parsed.citation || null, shortLabel: parsed.shortLabel || null, citationExtracting: false, citationError: null }
            : p
        ));
        console.log(`[extractPdfCitation] ${pdf.filename} (attempt ${attempt}) → "${parsed.shortLabel}" / "${parsed.citation}"`);
        return;
      }

      // Empty result — retry with bigger sample if this was the first pass
      if (attempt === 1 && text.length > 4000) {
        console.log(`[extractPdfCitation] ${pdf.filename} attempt 1 empty; retrying with larger sample`);
        // Small wait so we don't stack calls
        await new Promise(r => setTimeout(r, 2000));
        return extractPdfCitation(pdf, { attempt: 2 });
      }

      // Truly no citation found
      setPdfAttachments(prev => prev.map(p =>
        p.id === pdf.id
          ? { ...p, citation: null, shortLabel: null, citationExtracting: false, citationError: "No citation info found in text" }
          : p
      ));
      console.warn(`[extractPdfCitation] ${pdf.filename}: no citation info extractable after ${attempt} attempts`);
    } catch (e) {
      // Rate limit or API error — mark as failed with error message so UI can offer retry
      setPdfAttachments(prev => prev.map(p =>
        p.id === pdf.id
          ? { ...p, citationExtracting: false, citationError: e.message.slice(0, 80) }
          : p
      ));
      console.warn(`[extractPdfCitation] ${pdf.filename} failed:`, e.message);
    }
  };

  const removePdfAttachment = (id) => {
    setPdfAttachments(prev => prev.filter(p => p.id !== id));
  };

  const addImageAttachments = async (files) => {
    if (!files || files.length === 0) return;
    let addedBytes = 0;
    const results = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const dataUrl = await blobToDataUrl(file);
        const result = await processImageSrc(dataUrl, sessionImageBytes + addedBytes);
        if (result.dataUrl) {
          results.push({
            id: `imgatt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            dataUrl: result.dataUrl,
            filename: file.name,
            caption: "",
            addedAt: new Date().toLocaleString(),
          });
          addedBytes += result.bytes;
        } else {
          console.warn(`Image ${file.name} rejected: ${result.warning}`);
        }
      } catch (e) {
        console.error(`Image processing failed for ${file.name}:`, e);
      }
    }
    if (addedBytes > 0) setSessionImageBytes(b => b + addedBytes);
    setImageAttachments(prev => [...prev, ...results]);
  };

  const removeImageAttachment = (id) => {
    setImageAttachments(prev => prev.filter(i => i.id !== id));
  };

  const updateImageCaption = (id, caption) => {
    setImageAttachments(prev => prev.map(i => i.id === id ? {...i, caption} : i));
  };

  const generateGoalRecommendations = async () => {
    if (!aiEnabled) {
      setGoalRecError("Enable AI on the Setup tab first.");
      return;
    }
    setLoadingGoalRecs(true);
    setGoalRecError(null);

    const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
    const problemsText = (selectedProblems.length > 0 ? selectedProblems : (workingDx ? [workingDx] : [])).join("; ");
    const existingGoalsText = longTermGoals.map(g => `- ${g.text}`).join("\n") || "(none yet)";

    // Phase-appropriate context — what benchmark they're working toward
    const phaseBenchmark = phase.monthsIn <= 4
      ? "Working toward Mid-Year (February) benchmarks: organized histories on 2 patients per session, focused physical exams, appropriate differentials with justification, notes with some editing, first-draft management plans."
      : phase.monthsIn <= 8
      ? "Working toward End-of-Year (August) benchmarks: 3-4 patients per session, prioritized differentials from multiple sources, independent management plans for common conditions, notes usable for billing with minimal editing, presentations adjusted for audience."
      : "Preparing for Sub-Internship readiness: independent care of common presentations, subtle diagnostic reasoning, escalation judgment, interprofessional collaboration.";

    const sys = `You are a warm, thoughtful teaching attending helping a medical student in a CU Trek Longitudinal Integrated Clerkship set long-term learning goals rooted in the CLINICAL CONTENT they just saw. These are topics they should master over weeks/months by reading, self-study, and encountering similar patients.

CRITICAL: Long-term goals must be about MEDICAL KNOWLEDGE and CLINICAL TOPICS — specific things to learn about the diagnoses in today's case. NOT meta-skills, NOT process skills, NOT "build a mental checklist" or "develop an approach."

BAD examples (never write these):
- "Build a systematic approach to differential diagnosis"
- "Develop a mental checklist for uncovering medication adherence barriers"
- "Improve your history-taking for endocrine cases"
- "Practice motivational interviewing"

GOOD examples (this is what you should write):

For a hypothyroidism case:
- "Learn the lab pattern that distinguishes subclinical hypothyroidism from overt hypothyroidism, and when to treat each"
- "Understand levothyroxine dosing: starting dose by weight, adjustment intervals, and how weight change affects requirements"
- "Learn when to consider ordering a T3 level and what a low T3 with normal T4 tells you"
- "Understand the peri-operative TSH targets for elective surgery and why hypothyroidism increases surgical risk"

For a hypertension case:
- "Understand the 2017 ACC/AHA thresholds for initiating pharmacotherapy vs. lifestyle, and when to start with two medications rather than one"
- "Learn the ACC/AHA recommended order of antihypertensive medications by patient population (age, race, comorbidities like CKD or diabetes)"
- "Learn the secondary causes of hypertension and which clinical features should prompt workup for each"
- "Understand resistant hypertension: definition, workup for secondary causes, and role of aldosterone antagonists"

For a heart failure case:
- "Learn the four pillars of GDMT for HFrEF and the evidence base (SGLT2i, ARNI, beta-blockers, MRA) — including which to start first"
- "Understand the difference between HFrEF and HFpEF in workup and management, especially the emerging role of SGLT2i in HFpEF"
- "Learn when to use natriuretic peptides diagnostically vs. for monitoring, and what confounds their interpretation"

For a UTI case:
- "Learn the empiric antibiotic choices for uncomplicated cystitis vs. pyelonephritis vs. catheter-associated UTI, and when to modify based on local resistance"
- "Understand asymptomatic bacteriuria: who to treat (pregnant patients, pre-procedure) and who NOT to treat"

Pattern: each goal names a SPECIFIC PIECE OF MEDICAL KNOWLEDGE tied to a diagnosis in the case. Verbs are "Learn," "Understand," "Master," "Know" — knowledge acquisition, not skill development.

Rules:
1. Every goal must reference a specific clinical topic connected to a diagnosis in today's case.
2. Vary the goals across: diagnosis/workup, treatment/pharmacology, guideline/threshold knowledge, and clinical dilemmas (when to X vs. Y).
3. Calibrate depth to phase: earlier students (foundational) get broader/simpler knowledge goals; later students (end-of-year) get nuance and edge cases.
4. Do not duplicate or near-duplicate goals the student already has.
5. Prefer goals that will pay off across multiple future patient encounters (thyroid dosing knowledge helps for every hypothyroid patient they see, not just this one).

Return ONLY valid JSON (no markdown fences):
{
  "recommendations": [
    {
      "goal": "specific medical knowledge goal — 1-2 sentences, starting with a verb like Learn/Understand/Master/Know",
      "rationale": "1 sentence on why this content matters for THIS student now — reference the specific diagnosis in the case that sparks the goal, and the phase level"
    }
  ]
}

Generate exactly 3-4 recommendations. Each must be about a DIFFERENT topic (don't have three thyroid goals for a single-thyroid case unless the case is very thyroid-focused — vary across diagnoses or across categories like workup / treatment / dilemma).`;

    const mepoContext = activeFocus.length > 0
      ? `Focus areas being taught today: ${activeFocus.map(f => focusLabels[f]).join(", ")}`
      : "";

    const user = `STUDENT PHASE: ${phase.name} (month ${phase.monthsIn + 1} of Foothills LIC)
${phaseBenchmark}

TODAY'S CASE CONTEXT:
- Chief concern: ${chiefConcern || "not specified"}
- Working diagnosis: ${workingDx || "not specified"}
- Problems in focus: ${problemsText || "not specified"}
- Complexity: ${session.complexity}
${noteAnalysis?.redFlags?.length > 0 ? `- Red flags in the case: ${noteAnalysis.redFlags.join("; ")}` : ""}
${noteAnalysis?.keyTopics?.length > 0 ? `- Key teaching topics from the note: ${noteAnalysis.keyTopics.join(", ")}` : ""}

${mepoContext}

EXISTING LONG-TERM GOALS THE STUDENT ALREADY HAS (do not duplicate):
${existingGoalsText}

Generate 3-4 CONTENT-BASED long-term learning goals for the diagnoses in this case. Focus on specific medical knowledge topics — lab patterns, dosing, guideline thresholds, when-to-order decisions, secondary workup considerations, treatment sequencing. Every goal should start with "Learn," "Understand," "Master," or "Know" and name a concrete clinical topic. Avoid meta-skills, process language, or general practice-improvement goals.`;

    try {
      const response = await callAi(sys, user, 1200);
      const parsed = extractJson(response);
      setRecommendedGoals(parsed.recommendations || []);
    } catch (e) {
      console.error("Goal recommendations failed:", e);
      setGoalRecError(e.message);
    }
    setLoadingGoalRecs(false);
  };

  const acceptGoalRecommendation = (rec) => {
    const updated = [...longTermGoals, {
      id: Date.now(),
      text: rec.goal,
      added: new Date().toLocaleDateString(),
      status: "active",
      source: "ai-recommended",
    }];
    setLongTermGoals(updated);
    storage.set("longTermGoals", JSON.stringify(updated)).catch(() => {});
    // Remove this recommendation from the shown list
    setRecommendedGoals(prev => prev.filter(r => r.goal !== rec.goal));
  };

  const dismissGoalRecommendation = (rec) => {
    setRecommendedGoals(prev => prev.filter(r => r.goal !== rec.goal));
  };

  const addGoal = () => {
    if (!newGoal.trim()) return;
    const updated = [...longTermGoals, { id: Date.now(), text: newGoal, added: new Date().toLocaleDateString(), status: "active" }];
    setLongTermGoals(updated); setNewGoal("");
    storage.set("longTermGoals", JSON.stringify(updated)).catch(() => {});
  };
  const removeGoal = (id) => {
    const updated = longTermGoals.filter(g => g.id !== id);
    setLongTermGoals(updated);
    storage.set("longTermGoals", JSON.stringify(updated)).catch(() => {});
  };
  const copyPrompt = (source) => {
    navigator.clipboard.writeText(generateSourcePrompt(source)).then(() => {
      setCopiedPrompt(source);
      setTimeout(() => setCopiedPrompt(null), 2000);
    });
  };
  const printDoc = () => window.print();
  const toggleSection = (key) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const tabs = [
    { id: "setup", label: "1. Setup", shortLabel: "Setup", icon: User },
    { id: "note", label: "2. Clinical Note", shortLabel: "Note", icon: FileText },
    { id: "focus", label: "3. Teaching Focus", shortLabel: "Focus", icon: Target },
    { id: "sources", label: "4. Sources", shortLabel: "Sources", icon: BookOpen },
    { id: "goals", label: "5. Goals", shortLabel: "Goals", icon: TrendingUp },
    { id: "output", label: "6. Review & Generate", shortLabel: "Review", icon: Sparkles },
  ];

  // Standard sources store just their source key. PubMed AI supplies a custom
  // one-line prompt for each topic, so its viewer stores the prompt directly.
  const promptViewer = promptViewerFor
    ? (typeof promptViewerFor === "string"
      ? {
          key: promptViewerFor,
          sourceName: sourceLabels[promptViewerFor],
          prompt: generateSourcePrompt(promptViewerFor),
        }
      : promptViewerFor)
    : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <style>{`
        /* ========== DESIGN TOKENS ========== */
        :root {
          --doc-navy: #0F2A44;
          --doc-navy-mid: #1E5B94;
          --doc-paper: #F5F1EA;
          --doc-surface: #FFFFFF;
          --doc-warm-gray: #5C6470;
          --doc-terracotta: #B85C2E;
          --doc-consensus: #0F7A5A;
          --doc-majority: #1E5B94;
          --doc-single: #8B7355;
          --doc-conflict: #B85C2E;
          --doc-hairline: #D8D3CA;

          /* ===== App chrome (dark-mode-aware) =====
             These override Tailwind's slate palette for the app UI.
             The document itself keeps its own tokens above and is unaffected. */
          --app-bg: #f8fafc;         /* slate-50 */
          --app-surface: #ffffff;
          --app-surface-alt: #f1f5f9; /* slate-100 */
          --app-border: #e2e8f0;      /* slate-200 */
          --app-border-strong: #cbd5e1; /* slate-300 */
          --app-text: #0f172a;        /* slate-900 */
          --app-text-muted: #64748b;  /* slate-500 */
          --app-text-subtle: #94a3b8; /* slate-400 */
          --app-input-bg: #ffffff;

          /* Floating developmental-phase card */
          --fft-bg: linear-gradient(180deg, #fefce8 0%, #ffffff 100%);
          --fft-border: #fef3c7;
          --fft-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          --fft-title: #1f2937;
          --fft-body: #4b5563;
          --fft-muted: #6b7280;
          --fft-accent: #78350f;
          --fft-divider: #fef3c7;

          /* Step 5: AI goal recommendations panel */
          --goal-rec-bg: linear-gradient(135deg, #fefce8 0%, #ffffff 100%);
          --goal-rec-border: #fef3c7;
          --goal-rec-shadow: none;
          --goal-rec-title: #78350f;
          --goal-rec-subtitle: #64748b;
          --goal-rec-helper: #64748b;
          --goal-rec-button-bg: #fef3c7;
          --goal-rec-button-hover: #fde68a;
          --goal-rec-button-text: #78350f;
          --goal-rec-item-bg: rgba(255, 255, 255, 0.72);
          --goal-rec-item-hover: #ffffff;
          --goal-rec-item-border: #fef3c7;
          --goal-rec-item-border-hover: #fcd34d;
          --goal-rec-item-text: #0f172a;
          --goal-rec-rationale: #64748b;
          --goal-rec-dismiss: #cbd5e1;
          --goal-rec-dismiss-hover: #475569;
        }

        /* Dark theme: applied via data-theme="dark" on <html>.
           Only affects app chrome — the .doc-body / .doc-cover / print styles
           keep their light appearance because they use their own --doc-* tokens. */
        :root[data-theme="dark"] {
          --app-bg: #0b1220;
          --app-surface: #131c2e;
          --app-surface-alt: #1a2338;
          --app-border: #263149;
          --app-border-strong: #33405d;
          --app-text: #e2e8f0;
          --app-text-muted: #94a3b8;
          --app-text-subtle: #64748b;
          --app-input-bg: #1a2338;

          /* Warm, low-glare treatment for the floating phase card */
          --fft-bg: linear-gradient(180deg, #252319 0%, #171f2d 100%);
          --fft-border: rgba(245, 158, 11, 0.36);
          --fft-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
          --fft-title: #f8fafc;
          --fft-body: #cbd5e1;
          --fft-muted: #94a3b8;
          --fft-accent: #fbbf24;
          --fft-divider: rgba(245, 158, 11, 0.28);

          /* Low-glare warm treatment for Step 5 recommendations */
          --goal-rec-bg: linear-gradient(135deg, #272316 0%, #171f2d 100%);
          --goal-rec-border: rgba(245, 158, 11, 0.38);
          --goal-rec-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
          --goal-rec-title: #fbbf24;
          --goal-rec-subtitle: #cbd5e1;
          --goal-rec-helper: #f1dfb8;
          --goal-rec-button-bg: rgba(245, 158, 11, 0.18);
          --goal-rec-button-hover: rgba(245, 158, 11, 0.30);
          --goal-rec-button-text: #fde68a;
          --goal-rec-item-bg: rgba(11, 18, 32, 0.66);
          --goal-rec-item-hover: rgba(26, 35, 56, 0.9);
          --goal-rec-item-border: rgba(245, 158, 11, 0.22);
          --goal-rec-item-border-hover: rgba(245, 158, 11, 0.52);
          --goal-rec-item-text: #f8fafc;
          --goal-rec-rationale: #d6c8ad;
          --goal-rec-dismiss: #64748b;
          --goal-rec-dismiss-hover: #cbd5e1;
        }

        /* Retint Tailwind's slate/white utilities via CSS-only overrides.
           This lets the existing utility-class markup respond to dark mode
           without rewriting hundreds of classNames. */
        :root[data-theme="dark"] body {
          background: var(--app-bg);
        }
        :root[data-theme="dark"] .bg-slate-50 { background-color: var(--app-bg) !important; }
        :root[data-theme="dark"] .bg-slate-100 { background-color: var(--app-surface-alt) !important; }
        :root[data-theme="dark"] .bg-white { background-color: var(--app-surface) !important; }
        :root[data-theme="dark"] .border-slate-100 { border-color: var(--app-border) !important; }
        :root[data-theme="dark"] .border-slate-200 { border-color: var(--app-border) !important; }
        :root[data-theme="dark"] .border-slate-300 { border-color: var(--app-border-strong) !important; }
        :root[data-theme="dark"] .text-slate-900 { color: var(--app-text) !important; }
        :root[data-theme="dark"] .text-slate-800 { color: var(--app-text) !important; }
        :root[data-theme="dark"] .text-slate-700 { color: #cbd5e1 !important; }
        :root[data-theme="dark"] .text-slate-600 { color: #94a3b8 !important; }
        :root[data-theme="dark"] .text-slate-500 { color: var(--app-text-muted) !important; }
        :root[data-theme="dark"] .text-slate-400 { color: var(--app-text-subtle) !important; }
        :root[data-theme="dark"] .hover\\:bg-slate-100:hover { background-color: var(--app-surface-alt) !important; }
        :root[data-theme="dark"] .hover\\:bg-slate-200:hover { background-color: #2a3654 !important; }
        :root[data-theme="dark"] .hover\\:bg-white:hover { background-color: var(--app-surface-alt) !important; }
        :root[data-theme="dark"] .divide-slate-100 > :not([hidden]) ~ :not([hidden]) { border-color: var(--app-border) !important; }

        /* Inputs and textareas — force dark surface + light text */
        :root[data-theme="dark"] input[type="text"],
        :root[data-theme="dark"] input[type="date"],
        :root[data-theme="dark"] input[type="email"],
        :root[data-theme="dark"] textarea,
        :root[data-theme="dark"] select {
          background-color: var(--app-input-bg) !important;
          color: var(--app-text) !important;
          border-color: var(--app-border-strong) !important;
        }
        :root[data-theme="dark"] input::placeholder,
        :root[data-theme="dark"] textarea::placeholder {
          color: var(--app-text-subtle) !important;
        }

        /* Step 4 rich-paste editors are contenteditable divs rather than
           textareas, so they need their own theme treatment. Pasted sites can
           also bring inline black text colors; the descendant rule overrides
           those colors in dark mode while retaining headings, lists, tables,
           emphasis, and images. */
        .rich-paste-editor {
          background-color: var(--app-input-bg);
          color: var(--app-text);
          caret-color: currentColor;
        }
        :root[data-theme="dark"] .rich-paste-editor {
          background-color: var(--app-input-bg) !important;
          color: var(--app-text) !important;
          border-color: var(--app-border-strong) !important;
          color-scheme: dark;
        }
        :root[data-theme="dark"] .rich-paste-editor * {
          color: inherit !important;
          -webkit-text-fill-color: currentColor !important;
        }
        :root[data-theme="dark"] .rich-paste-editor a {
          color: #a5b4fc !important;
          text-decoration-color: rgba(165, 180, 252, 0.65) !important;
        }
        :root[data-theme="dark"] .rich-paste-editor mark {
          background-color: rgba(245, 158, 11, 0.28) !important;
          color: #fef3c7 !important;
          -webkit-text-fill-color: #fef3c7 !important;
        }
        :root[data-theme="dark"] .rich-paste-editor:empty::before {
          color: var(--app-text-subtle) !important;
          -webkit-text-fill-color: var(--app-text-subtle) !important;
        }
        :root[data-theme="dark"] .rich-paste-editor::selection,
        :root[data-theme="dark"] .rich-paste-editor *::selection {
          background: rgba(99, 102, 241, 0.45);
          color: #ffffff;
          -webkit-text-fill-color: #ffffff;
        }

        /* Tint tinted panels (indigo/amber/emerald/purple/red backgrounds).
           These are used all over the app for status messages and callouts.
           In dark mode we shift them to darker versions of the same hues. */
        :root[data-theme="dark"] .bg-indigo-50 { background-color: rgba(79, 70, 229, 0.15) !important; }
        :root[data-theme="dark"] .bg-indigo-100 { background-color: rgba(79, 70, 229, 0.25) !important; }
        :root[data-theme="dark"] .border-indigo-200 { border-color: rgba(79, 70, 229, 0.45) !important; }
        :root[data-theme="dark"] .border-indigo-300 { border-color: rgba(79, 70, 229, 0.6) !important; }
        :root[data-theme="dark"] .text-indigo-700 { color: #a5b4fc !important; }
        :root[data-theme="dark"] .text-indigo-800 { color: #c7d2fe !important; }
        :root[data-theme="dark"] .text-indigo-900 { color: #e0e7ff !important; }

        :root[data-theme="dark"] .bg-amber-50 { background-color: rgba(245, 158, 11, 0.12) !important; }
        :root[data-theme="dark"] .bg-amber-100 { background-color: rgba(245, 158, 11, 0.22) !important; }
        :root[data-theme="dark"] .border-amber-100 { border-color: rgba(245, 158, 11, 0.35) !important; }
        :root[data-theme="dark"] .border-amber-200 { border-color: rgba(245, 158, 11, 0.45) !important; }
        :root[data-theme="dark"] .border-amber-300 { border-color: rgba(245, 158, 11, 0.6) !important; }
        :root[data-theme="dark"] .text-amber-700 { color: #fcd34d !important; }
        :root[data-theme="dark"] .text-amber-800 { color: #fde68a !important; }
        :root[data-theme="dark"] .text-amber-900 { color: #fef3c7 !important; }

        :root[data-theme="dark"] .bg-emerald-50 { background-color: rgba(16, 185, 129, 0.14) !important; }
        :root[data-theme="dark"] .bg-emerald-100 { background-color: rgba(16, 185, 129, 0.22) !important; }
        :root[data-theme="dark"] .border-emerald-200 { border-color: rgba(16, 185, 129, 0.45) !important; }
        :root[data-theme="dark"] .border-emerald-300 { border-color: rgba(16, 185, 129, 0.6) !important; }
        :root[data-theme="dark"] .text-emerald-700 { color: #6ee7b7 !important; }
        :root[data-theme="dark"] .text-emerald-800 { color: #a7f3d0 !important; }
        :root[data-theme="dark"] .text-emerald-900 { color: #d1fae5 !important; }

        :root[data-theme="dark"] .bg-purple-50 { background-color: rgba(147, 51, 234, 0.14) !important; }
        :root[data-theme="dark"] .bg-purple-100 { background-color: rgba(147, 51, 234, 0.22) !important; }
        :root[data-theme="dark"] .border-purple-200 { border-color: rgba(147, 51, 234, 0.45) !important; }
        :root[data-theme="dark"] .text-purple-700 { color: #d8b4fe !important; }
        :root[data-theme="dark"] .text-purple-900 { color: #f3e8ff !important; }

        /* The multi-source notice intentionally stays light in dark mode so its
           compact text remains easy to scan against a pale lavender surface. */
        .source-detection-banner {
          background-color: #faf5ff;
          border: 1px solid #e9d5ff;
          color: #581c87;
        }
        .source-detection-banner svg {
          color: #7e22ce;
          flex: 0 0 auto;
        }
        :root[data-theme="dark"] .source-detection-banner {
          background-color: #ede9fe;
          border-color: #c4b5fd;
          color: #3b0764;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
        }
        :root[data-theme="dark"] .source-detection-banner svg {
          color: #6d28d9;
        }

        .food-for-thought-card {
          transition: background 160ms ease, border-color 160ms ease,
            color 160ms ease, box-shadow 160ms ease;
        }

        /* Step 5 recommendation panel uses its own palette so the global dark-mode
           slate/amber utility overrides cannot create pale text on a pale card. */
        .ai-recommendations-card {
          background: var(--goal-rec-bg);
          border: 1px solid var(--goal-rec-border);
          border-radius: 10px;
          box-shadow: var(--goal-rec-shadow);
          padding: 1rem 1.25rem;
          transition: background 160ms ease, border-color 160ms ease,
            box-shadow 160ms ease;
        }
        .ai-recommendations-eyebrow {
          color: var(--goal-rec-title);
          font-family: 'Inter', sans-serif;
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.11em;
          text-transform: uppercase;
        }
        .ai-recommendations-subtitle {
          color: var(--goal-rec-subtitle);
        }
        .ai-recommendations-helper {
          color: var(--goal-rec-helper);
        }
        .ai-recommendations-button {
          background: var(--goal-rec-button-bg);
          color: var(--goal-rec-button-text);
        }
        .ai-recommendations-button:hover:not(:disabled) {
          background: var(--goal-rec-button-hover);
        }
        .ai-recommendation-item {
          background: var(--goal-rec-item-bg);
          border: 1px solid var(--goal-rec-item-border);
        }
        .ai-recommendation-item:hover {
          background: var(--goal-rec-item-hover);
          border-color: var(--goal-rec-item-border-hover);
        }
        .ai-recommendation-goal {
          color: var(--goal-rec-item-text);
        }
        .ai-recommendation-rationale {
          color: var(--goal-rec-rationale);
        }
        .ai-recommendation-dismiss {
          color: var(--goal-rec-dismiss);
        }
        .ai-recommendation-dismiss:hover {
          color: var(--goal-rec-dismiss-hover);
        }

        :root[data-theme="dark"] .bg-red-50 { background-color: rgba(220, 38, 38, 0.15) !important; }
        :root[data-theme="dark"] .border-red-200 { border-color: rgba(220, 38, 38, 0.45) !important; }
        :root[data-theme="dark"] .text-red-600 { color: #fca5a5 !important; }
        :root[data-theme="dark"] .text-red-700 { color: #fca5a5 !important; }
        :root[data-theme="dark"] .text-red-800 { color: #fecaca !important; }
        :root[data-theme="dark"] .text-red-900 { color: #fee2e2 !important; }

        /* Preview scaled document — keep it on white regardless of theme.
           This is the mini-preview shown in the PreviewEditor split view. */
        :root[data-theme="dark"] .preview-split-grid > div:last-child .bg-white {
          background: #ffffff !important;
          color: #1a1a1a !important;
        }

        /* The final generated document sits inside .doc-body — that class already
           forces its own colors via the --doc-* tokens above, so it stays light
           in dark mode. This is intentional (matches print/export appearance). */
        .doc-body { color-scheme: light; }

        /* ========== APP TYPOGRAPHY & LAYOUT (rest of original styles) ========== */

        /* ========== DOCUMENT TYPOGRAPHY ========== */
        .doc-body {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          font-size: 15px;
          line-height: 1.65;
          color: #1a1a1a;
          background: var(--doc-paper);
          font-feature-settings: 'ss01', 'cv11';
        }
        .doc-body h1, .doc-body h2, .doc-body h3, .doc-body h4 {
          font-family: 'Inter', system-ui, sans-serif;
          font-weight: 600;
          color: var(--doc-navy);
          line-height: 1.25;
        }
        .doc-serif {
          font-family: 'Source Serif 4', Georgia, serif;
          font-optical-sizing: auto;
        }
        .doc-caps {
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.11em;
          font-weight: 600;
          font-size: 0.72rem;
        }
        .doc-meta-label {
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-weight: 500;
          font-size: 0.65rem;
          color: var(--doc-warm-gray);
        }

        /* ========== COVER ========== */
        .doc-cover {
          background: linear-gradient(135deg, #0F2A44 0%, #1a3d5c 50%, #0F2A44 100%);
          color: white;
          padding: 3rem 3rem 2.25rem;
        }
        .doc-cover .cover-eyebrow {
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.24em;
          font-size: 0.68rem;
          font-weight: 500;
          color: rgba(255,255,255,0.7);
          margin-bottom: 0.75rem;
        }
        .doc-cover .cover-title {
          font-family: 'Inter', sans-serif;
          font-weight: 500;
          font-size: 2.25rem;
          line-height: 1.15;
          letter-spacing: -0.02em;
          color: #fff;
        }
        .doc-cover .cover-rule {
          height: 1px;
          background: rgba(255,255,255,0.25);
          margin: 1.75rem 0 1.5rem;
        }
        .doc-cover .cover-docket {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1.25rem;
        }
        .doc-cover .cover-docket .label {
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-size: 0.6rem;
          font-weight: 500;
          color: rgba(255,255,255,0.6);
          margin-bottom: 0.25rem;
        }
        .doc-cover .cover-docket .value {
          font-family: 'Inter', sans-serif;
          font-size: 0.9rem;
          font-weight: 500;
          color: #fff;
        }

        /* ========== SECTION HEADERS ========== */
        .doc-h2 {
          font-family: 'Inter', sans-serif;
          font-size: 1.0625rem;
          font-weight: 600;
          color: var(--doc-navy);
          letter-spacing: -0.005em;
          margin: 0 0 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 2px solid var(--doc-navy);
        }
        .doc-subsection-label {
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.11em;
          font-size: 0.88rem;
          font-weight: 700;
          color: var(--doc-navy);
          padding: 0.5rem 0 0.5rem 0.75rem;
          border-left: 3px solid var(--doc-navy-mid);
          margin-bottom: 0.85rem;
          background: linear-gradient(90deg, rgba(30, 91, 148, 0.06) 0%, transparent 60%);
        }

        /* ========== CASE TREATMENT ========== */
        .doc-case-wrap {
          margin-top: 3rem;
        }
        .doc-case-banner {
          background: linear-gradient(135deg, var(--doc-navy) 0%, #1a3d5c 100%);
          color: white;
          padding: 1.25rem 1.5rem;
          margin: 0 -1.5rem 1.75rem;
          border-radius: 2px;
          box-shadow: 0 1px 3px rgba(15, 42, 68, 0.15);
        }
        .doc-case-banner .doc-case-numeral {
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: 0.65rem;
          letter-spacing: 0.28em;
          color: rgba(255, 255, 255, 0.7);
          text-transform: uppercase;
          margin-bottom: 0.35rem;
        }
        .doc-case-banner .doc-case-title {
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: 1.5rem;
          line-height: 1.2;
          color: white;
          letter-spacing: -0.015em;
          margin: 0;
        }

        /* ========== TABLES ========== */
        .doc-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
          border-top: 2px solid var(--doc-navy);
          border-bottom: 2px solid var(--doc-navy);
        }
        .doc-table thead th {
          font-family: 'Inter', sans-serif;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-size: 0.62rem;
          font-weight: 600;
          color: var(--doc-warm-gray);
          text-align: left;
          padding: 0.55rem 0.75rem;
          border-bottom: 1px solid var(--doc-navy);
          background: transparent;
        }

        .doc-table tbody td {
          padding: 0.65rem 0.75rem;
          border-bottom: 1px solid var(--doc-hairline);
          vertical-align: top;
          color: #1a1a1a;
        }
        .doc-table tbody tr:last-child td {
          border-bottom: none;
        }
        .doc-table .row-label {
          font-weight: 500;
          color: var(--doc-navy);
          width: 30%;
          padding-right: 1rem;
        }

        /* ========== CALLOUTS ========== */
        .doc-callout-pearl {
          background: linear-gradient(90deg, rgba(184, 92, 46, 0.09) 0%, rgba(184, 92, 46, 0.03) 100%);
          border-left: 3px solid var(--doc-terracotta);
          padding: 1rem 1.25rem;
          margin: 1.25rem 0;
        }

        .doc-callout-pearl .label {
          font-family: 'Inter', sans-serif;
          font-size: 0.7rem;
          color: var(--doc-terracotta);
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-weight: 700;
          margin-bottom: 0.4rem;
        }
        .doc-callout-quote {
          background: linear-gradient(90deg, rgba(30, 91, 148, 0.09) 0%, rgba(30, 91, 148, 0.03) 100%);
          border-left: 3px solid var(--doc-navy);
          padding: 1rem 1.25rem 1rem 2.5rem;
          margin: 1.25rem 0;
          position: relative;
        }

        .doc-callout-quote::before {
          content: '"';
          position: absolute;
          left: 0.75rem;
          top: 0.35rem;
          font-family: 'Source Serif 4', serif;
          font-size: 2.75rem;
          font-weight: 400;
          color: var(--doc-navy);
          line-height: 1;
          opacity: 0.5;
        }
        .doc-callout-quote .quote-text {
          font-family: 'Source Serif 4', serif;
          font-style: italic;
          font-size: 0.95rem;
          line-height: 1.55;
          color: #1a1a1a;
        }
        .doc-callout-quote .label {
          font-family: 'Inter', sans-serif;
          font-size: 0.7rem;
          color: var(--doc-navy);
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-weight: 700;
          margin-bottom: 0.4rem;
        }
        .doc-callout-goal {
          background: linear-gradient(180deg, var(--doc-paper) 0%, #fff 100%);
          border-left: 3px solid var(--doc-navy-mid);
          padding: 1rem 1.25rem;
        }

        /* ========== STRENGTH BADGES ========== */
        .doc-strength {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          font-family: 'Inter', sans-serif;
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-weight: 600;
          color: var(--doc-warm-gray);
        }
        .doc-strength .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .doc-strength.consensus .dot { background: var(--doc-consensus); }
        .doc-strength.majority .dot { background: var(--doc-majority); }
        .doc-strength.single-source .dot { background: var(--doc-single); }
        .doc-strength.conflict .dot { background: var(--doc-conflict); }
        .doc-strength.consensus { color: var(--doc-consensus); }
        .doc-strength.majority { color: var(--doc-majority); }
        .doc-strength.single-source { color: var(--doc-single); }
        .doc-strength.conflict { color: var(--doc-conflict); }

        /* ========== SHELF QUESTIONS ========== */
        .doc-shelf-q {
          border-top: 1px solid var(--doc-hairline);
          padding: 1rem 0;
        }
        .doc-shelf-q:first-child { border-top: none; padding-top: 0.25rem; }
        .doc-shelf-answer {
          margin-top: 0.75rem;
          padding: 0.75rem 1rem;
          background: var(--doc-paper);
          border-left: 2px solid var(--doc-consensus);
        }
        .doc-shelf-answer .label {
          font-family: 'Inter', sans-serif;
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          font-weight: 600;
          color: var(--doc-consensus);
          margin-bottom: 0.3rem;
        }

        /* ========== DOCUMENT FOOTER ========== */
        .doc-footer {
          margin-top: 3rem;
          padding-top: 1.25rem;
          border-top: 2px solid var(--doc-navy);
          text-align: center;
          font-family: 'Inter', sans-serif;
          font-size: 0.7rem;
          color: var(--doc-warm-gray);
          letter-spacing: 0.02em;
        }

        /* ========== PRINT ========== */
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white; }
          .doc-body { background: white; }
          .print-doc { box-shadow: none !important; border: none !important; border-radius: 0 !important; }
          .doc-cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .doc-callout-pearl, .doc-callout-quote, .doc-callout-goal, .doc-shelf-answer {
            -webkit-print-color-adjust: exact; print-color-adjust: exact;
          }

          p, li, div { orphans: 3; widows: 3; }
          h1, h2, h3, h4, h5, h6 { page-break-after: avoid; break-after: avoid; }
          h2 + *, h3 + *, h4 + * { page-break-before: avoid; break-before: avoid; }

          .keep-together { page-break-inside: avoid; break-inside: avoid; }
          li { page-break-inside: avoid; break-inside: avoid; }
          tr { page-break-inside: avoid; break-inside: avoid; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          figure { page-break-inside: avoid; break-inside: avoid; }
          table { page-break-inside: auto; break-inside: auto; }

          .doc-callout-pearl, .doc-callout-quote, .doc-callout-goal { page-break-inside: avoid; break-inside: avoid; }
          .doc-case-wrap { page-break-inside: auto; }
          .doc-case-title, .doc-case-numeral { page-break-after: avoid; break-after: avoid; }
          .doc-subsection-label { page-break-after: avoid; break-after: avoid; }

          section { margin-top: 0.35in; }
          section:first-child { margin-top: 0; }
          .doc-cover { page-break-after: always; break-after: always; }
        }
          /* Preview editor: stack vertically on narrow screens */
        /* Preview editor: stack vertically on narrow screens */
        @media (max-width: 1200px) {
          .preview-split-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .preview-split-grid > div:last-child .sticky {
            position: static !important;
          }
        }

        /* ========== MOBILE DOCUMENT STYLES ========== */
        /* The final document is what students actually read on their phones,
           so we scale down chrome (padding, cover, case banner) but keep
           everything else legible. Tables get horizontal scroll wrappers. */
        @media (max-width: 640px) {
          .doc-body-mobile-padded {
            padding: 1.25rem 1rem 1.5rem !important;
          }
          .doc-cover {
            padding: 1.75rem 1.25rem 1.5rem !important;
          }
          .doc-cover .cover-title {
            font-size: 1.5rem !important;
            line-height: 1.2 !important;
          }
          .doc-cover .cover-eyebrow {
            font-size: 0.6rem !important;
            letter-spacing: 0.18em !important;
          }
          .doc-cover .cover-docket {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 0.85rem !important;
          }
          .doc-cover .cover-rule {
            margin: 1.25rem 0 1rem !important;
          }
          .doc-case-banner {
            margin: 0 -1rem 1.25rem !important;
            padding: 1rem 1.25rem !important;
          }
          .doc-case-banner .doc-case-title {
            font-size: 1.2rem !important;
          }
          .doc-h2 {
            font-size: 1rem !important;
          }
          /* Tables would squish miserably on 375px screens with 3-4 cols.
             Wrap them in a scroll container and hint that they're scrollable. */
          .doc-table-scroll {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin: 0 -0.5rem;
            padding: 0 0.5rem;
            /* Subtle right-edge fade so users know there's more content */
            mask-image: linear-gradient(to right, black calc(100% - 20px), transparent);
            -webkit-mask-image: linear-gradient(to right, black calc(100% - 20px), transparent);
          }
          .doc-table {
            font-size: 0.82rem !important;
            min-width: 500px; /* forces scroll instead of squish */
          }
          .doc-table thead th,
          .doc-table tbody td {
            padding: 0.5rem 0.6rem !important;
          }
          /* Callouts: reduce padding but keep the visual weight */
          .doc-callout-pearl,
          .doc-callout-quote,
          .doc-callout-goal {
            padding: 0.85rem 1rem !important;
          }
          .doc-callout-quote {
            padding-left: 2rem !important;
          }
          /* Reference figures grid: force single column on mobile */
          .doc-figures-grid {
            grid-template-columns: 1fr !important;
          }
        }

        @page { margin: 0.55in; }
        @page :first { margin: 0; }
      `}</style>

      <header className="no-print bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                <Stethoscope className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                {/* Full title on desktop, shorter title on mobile */}
                <h1 className="text-base sm:text-xl font-semibold text-slate-900 truncate">
                  <span className="hidden sm:inline">LIC Teaching Document Generator</span>
                  <span className="sm:hidden">LIC Teaching</span>
                </h1>
                <p className="text-xs text-slate-500 hidden sm:block">Phase-aware teaching {aiEnabled && <span className="text-indigo-600">· AI enabled</span>}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Theme toggle — cycles system → light → dark → system.
                  Icon matches the CURRENT resolved theme; tooltip explains the mode. */}
              <button
                onClick={cycleTheme}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition flex-shrink-0"
                title={
                  theme === "system"
                    ? `Auto (currently ${resolvedTheme}) — click for light mode`
                    : theme === "light"
                    ? "Light mode — click for dark mode"
                    : "Dark mode — click for auto"
                }
                aria-label="Toggle theme"
              >
                {theme === "system" ? (
                  // Half-and-half icon indicates "auto"
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3a9 9 0 100 18 9 9 0 000-18zm0 2v14a7 7 0 000-14z"/>
                  </svg>
                ) : resolvedTheme === "dark" ? (
                  // Moon
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                  </svg>
                ) : (
                  // Sun
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
                  </svg>
                )}
              </button>
              <button
                onClick={clearEditor}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition flex-shrink-0"
                title="Clear all fields and start a new case. Long-term goals and your name are preserved."
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-3 sm:px-6">
          <div className="flex gap-0.5 sm:gap-1 overflow-x-auto">
            {tabs.map((t, idx) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium border-b-2 whitespace-nowrap transition ${isActive ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                  title={t.label}
                >
                  {/* Mobile: show step number + icon; Desktop: show icon + full label */}
                  <span className="sm:hidden inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0"
                    style={{
                      background: isActive ? "#4f46e5" : "#e2e8f0",
                      color: isActive ? "white" : "#64748b",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <Icon className="w-4 h-4 hidden sm:inline flex-shrink-0" />
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 relative">
{/* Floating "food for thought" phase sidebar — only on wide screens */}
        <aside
          className="no-print hidden xl:block fixed"
          style={{
            top: "180px",
            right: "1rem",
            width: "260px",
            zIndex: 5,
          }}
        >
          <div
            className="food-for-thought-card"
            style={{
              background: "var(--fft-bg)",
              border: "1px solid var(--fft-border)",
              borderRadius: "10px",
              padding: "0.875rem 1rem",
              boxShadow: "var(--fft-shadow)",
              fontSize: "0.75rem",
              color: "var(--fft-body)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1rem" }}>💡</span>
              <span style={{ fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.11em", fontSize: "0.62rem", fontWeight: 600, color: "var(--fft-accent)" }}>
                Food for thought
              </span>
            </div>
            <div style={{ fontWeight: 600, color: "var(--fft-title)", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
              {phase.name}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--fft-muted)", marginBottom: "0.5rem" }}>
              Month {phase.monthsIn + 1} of Foothills LIC
            </div>
            <div style={{ fontSize: "0.75rem", lineHeight: 1.5, color: "var(--fft-body)", marginBottom: "0.5rem" }}>
              {phase.focus}
            </div>
            <div style={{ fontSize: "0.7rem", fontStyle: "italic", color: "var(--fft-muted)", marginBottom: "0.5rem" }}>
              {phase.pace}
            </div>
            {phase.workingToward && (
              <details style={{ fontSize: "0.7rem", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid var(--fft-divider)" }}>
                <summary style={{ cursor: "pointer", fontWeight: 500, color: "var(--fft-accent)" }}>Working toward →</summary>
                <div style={{ marginTop: "0.4rem", color: "var(--fft-body)", lineHeight: 1.5 }}>{phase.workingToward}</div>
                {phase.supervisionExpectation && (
                  <div style={{ marginTop: "0.4rem", color: "var(--fft-muted)", fontStyle: "italic" }}>
                    <strong style={{ fontStyle: "normal", color: "var(--fft-body)" }}>Supervision: </strong>
                    {phase.supervisionExpectation}
                  </div>
                )}
              </details>
            )}
          </div>
        </aside>

        {/* Narrow-screen fallback: small collapsible chip at the top */}
        <details className="no-print xl:hidden mb-4">
          <summary className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-900">
            <span>💡</span>
            <span className="font-medium">{phase.name}</span>
            <span className="opacity-70">· Month {phase.monthsIn + 1}</span>
          </summary>
          <div className="mt-2 p-3 bg-amber-50 border border-amber-100 rounded text-xs text-slate-700">
            <div>{phase.focus}</div>
            <div className="mt-1 italic opacity-80">{phase.pace}</div>
            {phase.workingToward && (
              <div className="mt-2 pt-2 border-t border-amber-100">
                <div className="font-semibold text-amber-900 mb-0.5">Working toward:</div>
                <div>{phase.workingToward}</div>
              </div>
            )}
          </div>
        </details>
        
        {aiStatus.progress && (
          <div className="no-print mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-800 flex items-center gap-2">
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-indigo-600" />
            <div className="flex-1">{aiStatus.progress}</div>
          </div>
        )}
        {aiStatus.error && (
          <div className="no-print mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{aiStatus.error}</div>
            <button onClick={() => setAiStatus({ ...aiStatus, error: null })} className="text-red-600 hover:text-red-800"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* SETUP TAB */}
        {activeTab === "setup" && (
          <div className="space-y-6">
            {/* Session mode toggle — pre-visit prep vs. post-visit teaching.
                Placed at the very top because it changes the meaning of every
                subsequent step. Once problems have been selected or a note pasted,
                switching modes mid-session would be confusing, but we allow it
                (with the understanding that the attending starts over). */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="mb-3">
                <h2 className="text-lg font-semibold text-slate-900">Session type</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  When are you creating this document — before you see the patient, or after?
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => setSessionMode("post")}
                  className={`text-left p-4 rounded-lg border-2 transition ${
                    sessionMode === "post"
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sessionMode === "post" ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"}`}>
                      {sessionMode === "post" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div className={`font-semibold text-sm ${sessionMode === "post" ? "text-indigo-900" : "text-slate-900"}`}>
                      Post-visit teaching
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 ml-6">
                    Paste the clinical note from an encounter you already saw. Generates a debrief teaching document anchored to what happened.
                  </div>
                </button>
                <button
                  onClick={() => setSessionMode("pre")}
                  className={`text-left p-4 rounded-lg border-2 transition ${
                    sessionMode === "pre"
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${sessionMode === "pre" ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white"}`}>
                      {sessionMode === "pre" && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div className={`font-semibold text-sm ${sessionMode === "pre" ? "text-indigo-900" : "text-slate-900"}`}>
                      Pre-visit prep
                    </div>
                    <span className="text-[10px] uppercase tracking-wider bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">
                      New
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 ml-6">
                    Paste a prenote before the visit. Generates an in-room reference doc for the student + anticipatory teaching prep.
                  </div>
                </button>
              </div>
              {sessionMode === "pre" && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>PHI-safe workflow:</strong> When you paste the prenote in Step 2, you'll first review a de-identified version. Only the de-identified text is stored and sent to the AI. Your original paste is never saved.
                  </div>
                </div>
              )}
            </div>

                    {/* AI toggle - clean, single toggle only */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold text-slate-900">AI-Powered Features</h2>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">Auto-analyzes notes and generates case-specific teaching content.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={aiEnabled} onChange={e => setAiEnabled(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
              {aiEnabled && (
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <strong>Privacy note:</strong> De-identified clinical text is sent to a secure Cloudflare Worker for AI processing. Ensure notes are fully de-identified per HIPAA before analysis.
                </div>
              )}
            </div>

            {/* Session config */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Session Setup</h2>
                <p className="text-sm text-slate-500">Basic session info. Use initials only — avoid PHI.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Student initials or first name</label>
                  <input type="text" value={session.studentName} onChange={e => setSession({...session, studentName: e.target.value})} placeholder="e.g., JD or Jamie" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Session date</label>
                  <input type="date" value={session.sessionDate} onChange={e => setSession({...session, sessionDate: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">LIC start month</label>
                  <select value={session.licStartMonth} onChange={e => setSession({...session, licStartMonth: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                    {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Current month</label>
                  <select value={session.month} onChange={e => setSession({...session, month: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                    {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Encounter type</label>
                  <select value={session.encounterType} onChange={e => setSession({...session, encounterType: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                    <option value="telemedicine">Telemedicine</option>
                    <option value="outpatient">Outpatient / Clinic</option>
                    <option value="inpatient">Inpatient</option>
                    <option value="ed">Emergency</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Patient complexity</label>
                  <select value={session.complexity} onChange={e => setSession({...session, complexity: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none">
                    <option value="common">Common (straightforward)</option>
                    <option value="complex">Complex</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t">
                <button onClick={() => setActiveTab("note")} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Continue to clinical note →</button>
              </div>
            </div>
          </div>
        )}

        {/* NOTE TAB */}
        {activeTab === "note" && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-1">
                {sessionMode === "pre" ? "Prenote / Chart Summary" : "Clinical Note & Encounter"}
              </h2>
              <p className="text-sm text-slate-500">
                {sessionMode === "pre"
                  ? "Paste the prenote or chart summary for the upcoming visit. You'll review an automatically de-identified version before it's saved."
                  : `Paste your clinical note. ${aiEnabled ? "AI will extract chief concern, working diagnosis, active problems, quotes, and lab trends automatically." : ""}`
                }
              </p>
            </div>

            {sessionMode === "pre" ? (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex gap-2 text-sm text-indigo-900">
                <Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>PHI-safe workflow.</strong> Paste your raw prenote below (with real names, dates, MRNs — that's fine). Click "Review de-identified version" and confirm what will be saved. Your original paste is never stored.
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-sm text-amber-900">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>De-identify before pasting — no names, DOB, MRN, addresses, exact dates. Use ages in ranges (e.g., "80s").</div>
              </div>
            )}

            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label className="text-sm font-semibold text-slate-800">Teaching lens</label>
                <span className="text-xs text-slate-500">Shapes how the AI teaches this case</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "general_im", label: "General IM", desc: "Standard internal medicine framing" },
                  { key: "geriatrics", label: "Geriatrics", desc: "Beers, STOPP/START, 4Ms, deprescribing" },
                  { key: "primary_care", label: "Primary Care", desc: "USPSTF, prevention, chronic disease" },
                  { key: "complex_multimorbidity", label: "Complex Multimorbidity", desc: "Competing goals, care prioritization" },
                ].map(lens => (
                  <button
                    key={lens.key}
                    onClick={() => setTeachingLens(lens.key)}
                    className={`text-left p-3 rounded-lg border-2 transition ${
                      teachingLens === lens.key
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className={`text-sm font-semibold ${teachingLens === lens.key ? "text-indigo-900" : "text-slate-900"}`}>
                      {lens.label}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{lens.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {sessionMode === "pre" ? (
              /* PRE-VISIT: two-stage flow. Attending pastes raw into rawPrenote,
                 then clicks Review to open the de-identification modal.
                 On confirm, the reviewed version becomes clinicalNote.
                 If clinicalNote already exists (already reviewed), show that with a re-review option. */
              <>
                {!clinicalNote ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Raw prenote (will be de-identified before saving)</label>
                    <textarea
                      value={rawPrenote}
                      onChange={e => setRawPrenote(e.target.value)}
                      rows={14}
                      placeholder="Paste the raw prenote here — names, dates, MRNs are OK. You'll review the de-identified version in the next step."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                    />
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-xs text-slate-500">
                        {rawPrenote.length} characters
                        {rawPrenote.length > 0 && <span className="ml-2 text-amber-700">· not yet saved</span>}
                      </div>
                                            <button
                        type="button"
                        onClick={() =>
                          void openDeidentificationReview(
                            rawPrenote
                          )
                        }
                        disabled={
                          !rawPrenote.trim() ||
                          deidStatus.running
                        }
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-medium disabled:opacity-50"
                      >
                        {deidStatus.running ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Anonymizing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Review anonymized version →
                          </>
                        )}
                      </button>
                    </div>
                    {deidStatus.error && (
                      <div
                        role="alert"
                        className="mt-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                      >
                        {deidStatus.error}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                                        <div className="flex items-center justify-between mb-1">
                      <label className="text-sm font-medium text-slate-700">
                        De-identified prenote{" "}
                        <span className="text-xs text-emerald-700 font-normal">
                          · ready for AI processing
                        </span>
                      </label>

                      <button
                        type="button"
                        onClick={() =>
                          void openDeidentificationReview(clinicalNote)
                        }
                        disabled={deidStatus.running}
                        className="text-xs text-indigo-700 hover:text-indigo-900 underline disabled:opacity-50"
                      >
                        {deidStatus.running
                          ? "Preparing review..."
                          : "Review / re-edit"}
                      </button>
                    </div>

                    {deidStatus.error && (
                      <div
                        role="alert"
                        className="mb-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                      >
                        {deidStatus.error}
                      </div>
                    )}

                    <textarea
                      value={clinicalNote}
                      onChange={e => setClinicalNote(e.target.value)}
                      rows={14}
                      className="w-full px-3 py-2 border border-emerald-300 bg-emerald-50/30 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm"
                    />
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-xs text-slate-500">{clinicalNote.length} characters</div>
                      {aiEnabled && (
                        <button
                          onClick={analyzeNote}
                          disabled={!clinicalNote.trim() || aiStatus.analyzing}
                          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-medium disabled:opacity-50"
                        >
                          {aiStatus.analyzing ? <><Loader2 className="w-4 h-4 animate-spin" />Analyzing...</> : <><Wand2 className="w-4 h-4" />Analyze prenote & auto-fill</>}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* POST-VISIT: unchanged behavior — attending pastes an already-deidentified note directly */
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">De-identified clinical note</label>
                <textarea value={clinicalNote} onChange={e => setClinicalNote(e.target.value)} rows={14} placeholder="Paste the SOAP note or H&P here (de-identified)..." className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm" />
                <div className="flex items-center justify-between mt-1">
                  <div className="text-xs text-slate-500">{clinicalNote.length} characters</div>
                  {aiEnabled && (
                    <button
                      onClick={analyzeNote}
                      disabled={!clinicalNote.trim() || aiStatus.analyzing}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-medium disabled:opacity-50"
                    >
                      {aiStatus.analyzing ? <><Loader2 className="w-4 h-4 animate-spin" />Analyzing...</> : <><Wand2 className="w-4 h-4" />Analyze note & auto-fill</>}
                    </button>
                  )}
                </div>
              </div>
            )}

            {noteAnalysis && (
              <div className="p-4 bg-white border-2 border-indigo-300 rounded-lg space-y-4">
                {/* PROBLEMS TO SELECT — the star of this panel */}
                {activeProblems.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold">
                          1
                        </div>
                        <h3 className="text-base font-bold text-slate-900">Select problems to teach on</h3>
                      </div>
                      <span className="text-xs text-slate-500 ml-auto">
                        {selectedProblems.length} of {activeProblems.length} selected
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mb-3 ml-9">Each selected problem generates its own teaching case in the final document.</p>
                    <div className="space-y-2 ml-9">
                      {activeProblems.map((p, i) => {
                        const selected = selectedProblems.includes(p.problem);
                        const isCustom = p.source === "attending-added";
                        return (
                          <div key={i} className="relative group">
                            <button
                              onClick={() => {
                                if (selected) setSelectedProblems(selectedProblems.filter(sp => sp !== p.problem));
                                else setSelectedProblems([...selectedProblems, p.problem]);
                              }}
                              className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition ${selected ? "bg-indigo-50 border-2 border-indigo-400 shadow-sm" : "bg-slate-50 border-2 border-slate-200 hover:border-indigo-300 hover:bg-white"}`}
                            >
                              <div className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 flex items-center justify-center transition ${selected ? "bg-indigo-600" : "bg-white border-2 border-slate-300"}`}>
                                {selected && <Check className="w-3.5 h-3.5 text-white" />}
                              </div>
                              <div className="flex-1 min-w-0 pr-6">
                                <div className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                                  {p.problem}
                                  {isCustom && <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">You added</span>}
                                </div>
                                {p.keyIssue && <div className="text-xs text-slate-600 mt-1">{p.keyIssue}</div>}
                                {p.teachingValue && <div className="text-xs text-indigo-700 mt-1 italic"><span className="font-medium not-italic">Teaching value: </span>{p.teachingValue}</div>}
                              </div>
                            </button>
                            {/* Remove button — always visible for attending-added, hover-only for AI-extracted */}
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setActiveProblems(activeProblems.filter((_, idx) => idx !== i));
                                setSelectedProblems(selectedProblems.filter(sp => sp !== p.problem));
                              }}
                              className={`absolute top-2.5 right-2.5 p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition ${isCustom ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                              title={isCustom ? "Remove this problem" : "Remove — AI added this but you don't need to teach on it"}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}

                      {/* Inline "add another problem" input */}
                      <div className="flex gap-2 pt-2">
                        <input
                          type="text"
                          value={newActiveProblem}
                          onChange={e => setNewActiveProblem(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && newActiveProblem.trim()) {
                              const problem = newActiveProblem.trim();
                              // Skip if this exact problem already exists
                              if (!activeProblems.some(p => p.problem.toLowerCase() === problem.toLowerCase())) {
                                setActiveProblems([...activeProblems, {
                                  problem,
                                  source: "attending-added",
                                  keyIssue: "",
                                  teachingValue: "",
                                }]);
                                setSelectedProblems([...selectedProblems, problem]);
                              }
                              setNewActiveProblem("");
                            }
                          }}
                          placeholder="Add another problem the AI missed (e.g., 'medication adherence barriers')..."
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        />
                        <button
                          onClick={() => {
                            if (!newActiveProblem.trim()) return;
                            const problem = newActiveProblem.trim();
                            if (!activeProblems.some(p => p.problem.toLowerCase() === problem.toLowerCase())) {
                              setActiveProblems([...activeProblems, {
                                problem,
                                source: "attending-added",
                                keyIssue: "",
                                teachingValue: "",
                              }]);
                              setSelectedProblems([...selectedProblems, problem]);
                            }
                            setNewActiveProblem("");
                          }}
                          disabled={!newActiveProblem.trim()}
                          className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-4 h-4" />Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Supporting AI details — collapsed by default */}
                <details className="border-t border-slate-200 pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    Show what else the AI extracted
                  </summary>
                  <div className="mt-3 space-y-3 pl-6">
                    {noteAnalysis.reasoning && (
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">AI's Reasoning</div>
                        <div className="text-sm text-slate-700 italic">{noteAnalysis.reasoning}</div>
                      </div>
                    )}
                    {noteAnalysis.redFlags?.length > 0 && (
                      <div className="p-2 bg-red-50 border border-red-200 rounded">
                        <div className="text-xs font-semibold text-red-900 uppercase tracking-wide mb-1">⚠ Red Flags / Can't-Miss</div>
                        <div className="text-sm text-red-900">{noteAnalysis.redFlags.join("; ")}</div>
                      </div>
                    )}
                    {noteAnalysis.keyTopics?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Key Teaching Topics</div>
                        <div className="flex flex-wrap gap-1">
                          {noteAnalysis.keyTopics.map((t, i) => <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-800 rounded-full text-xs border border-indigo-200">{t}</span>)}
                        </div>
                      </div>
                    )}
                    {patientQuotes.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Patient Quotes ({patientQuotes.length})</div>
                        <div className="space-y-1">
                          {patientQuotes.slice(0, 3).map((q, i) => <div key={i} className="text-xs italic text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">"{q}"</div>)}
                          {patientQuotes.length > 3 && <div className="text-xs text-slate-500 italic">+ {patientQuotes.length - 3} more</div>}
                        </div>
                      </div>
                    )}
                    {labTrends.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Lab & Vital Trends ({labTrends.length})</div>
                        <div className="space-y-1">
                          {labTrends.slice(0, 3).map((t, i) => (
                            <div key={i} className="text-xs bg-slate-50 p-2 rounded border border-slate-200">
                              <span className="font-medium text-slate-800">{t.parameter}:</span> <span className="text-slate-600">{t.trend}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {noteAnalysis.suggestedFocus?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Suggested Focus Areas</div>
                        <div className="text-sm text-slate-700">{noteAnalysis.suggestedFocus.map(f => focusLabels[f] || f).join(", ")}</div>
                        <div className="text-xs text-slate-500 mt-1 italic">Auto-selected on the next tab. You can adjust.</div>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                  Chief concern
                  {noteAnalysis && <span className="text-xs text-indigo-600 font-normal">(auto-filled)</span>}
                </label>
                <input type="text" value={chiefConcern} onChange={e => setChiefConcern(e.target.value)} placeholder="Will auto-fill after AI analysis" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                  Primary working diagnosis
                  {noteAnalysis && <span className="text-xs text-indigo-600 font-normal">(auto-filled)</span>}
                </label>
                <input type="text" value={workingDx} onChange={e => setWorkingDx(e.target.value)} placeholder="Will auto-fill after AI analysis" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setActiveTab("setup")} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">← Back</button>
              <button onClick={() => setActiveTab("focus")} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Continue →</button>
            </div>
          </div>
        )}

        {/* FOCUS TAB */}
        {activeTab === "focus" && (
          <div className="space-y-6">
            {/* Session-specific learning goal — moved to top so it's not skipped */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Session-specific learning goal</h3>
                <p className="text-sm text-slate-500">One thing you want them to walk away with today. Anchors the whole document. Optional but recommended.</p>
              </div>
              <input type="text" value={sessionGoal} onChange={e => setSessionGoal(e.target.value)} placeholder="e.g., Build an illness script for iatrogenic bradycardia and defend a deprescribing plan" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
            </div>

            {/* Pre-visit only: learning content emphasis */}
            {sessionMode === "pre" && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1">Learning content emphasis</h3>
                  <p className="text-sm text-slate-500">
                    Shapes the AI-generated learning content about the patient's diagnoses. Auto matches the student's phase in the year; override if you want a different lens.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  {[
                    { key: "auto", label: "Auto (phase-recommended)", desc: `Recommends "${recommendedEmphasis}" based on month ${phase.monthsIn + 1} of LIC` },
                    { key: "diagnosis", label: "Diagnostic reasoning", desc: "Why is this the diagnosis? What pointed here?" },
                    { key: "workup", label: "Workup", desc: "Why these tests? What were they ruling in/out?" },
                    { key: "management", label: "Management", desc: "Why this treatment? Evidence? Alternatives?" },
                    { key: "mixed", label: "Mixed", desc: "Balanced across diagnosis, workup, and management" },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setPrevisitEmphasis(opt.key)}
                      className={`text-left p-3 rounded-lg border-2 transition ${
                        previsitEmphasis === opt.key
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className={`text-sm font-semibold ${previsitEmphasis === opt.key ? "text-indigo-900" : "text-slate-900"}`}>
                        {opt.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 leading-snug">{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {previsitEmphasis === "auto" && (
                  <div className="text-xs text-slate-500 italic bg-slate-50 border border-slate-200 rounded p-2">
                    Currently using <strong className="not-italic">{recommendedEmphasis}</strong> emphasis for this student (month {phase.monthsIn + 1} of LIC · {phase.name}).
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Teaching Focus Areas</h2>
                  <p className="text-sm text-slate-500">Select as many as you want to teach on — each generates its own section.</p>
                </div>
                {aiEnabled && clinicalNote && (
                  <button onClick={analyzeNote} disabled={aiStatus.analyzing} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-lg">
                    {aiStatus.analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    Re-analyze
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="text-sm text-slate-700">
                  <span className="font-semibold text-indigo-700">{activeFocusList.length}</span> of {Object.keys(focusAreas).length} focus areas selected
                  {aiSuggestedFocus && <span className="text-xs text-slate-500 ml-2">· AI pre-selected {aiSuggestedFocus.length}</span>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => {
                    const all = {}; Object.keys(focusAreas).forEach(k => all[k] = true); setFocusAreas(all);
                  }} className="text-xs px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100">Select all</button>
                  <button onClick={() => {
                    const none = {}; Object.keys(focusAreas).forEach(k => none[k] = false); setFocusAreas(none);
                  }} className="text-xs px-2 py-1 bg-white border border-slate-300 rounded hover:bg-slate-100">Clear</button>
                  {aiSuggestedFocus && (
                    <button onClick={() => {
                      const suggested = {};
                      Object.keys(focusAreas).forEach(k => { suggested[k] = aiSuggestedFocus.includes(k); });
                      setFocusAreas(suggested);
                    }} className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 border border-indigo-300 rounded hover:bg-indigo-200">Use AI suggestions</button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.keys(focusAreas).map(key => {
                  const Icon = focusIcons[key];
                  const active = focusAreas[key];
                  const suggested = aiSuggestedFocus?.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => setFocusAreas({...focusAreas, [key]: !focusAreas[key]})}
                      className={`flex items-start gap-3 p-4 rounded-lg border-2 text-left transition ${active ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${active ? "bg-indigo-600 border-indigo-600" : "border-slate-300 bg-white"}`}>
                        {active && <Check className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className={`font-medium text-sm ${active ? "text-indigo-900" : "text-slate-900"}`}>{focusLabels[key]}</div>
                          {suggested && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Sparkles className="w-2.5 h-2.5" />AI</span>}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 leading-snug">{mepoMap[key]}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
<div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Tangential teaching topics</h3>
                <p className="text-sm text-slate-500">
                  Topics you want to teach on that <em>aren't</em> diagnoses in this patient — background knowledge, teaching detours, or foundational concepts sparked by the encounter. Each becomes its own standalone teaching case, framed as "as an aside, here's how to think about X" rather than being tied to this patient's story.
                </p>
                <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                  <div className="font-semibold text-slate-700 mb-1">When to use which:</div>
                  <div className="space-y-1">
                    <div><span className="font-medium text-slate-800">Step 2 "Add another problem":</span> the patient actually has this problem (AI missed it or didn't extract it). Teaching will be framed around <em>this specific patient</em> — her presentation, her labs, her context.</div>
                    <div><span className="font-medium text-slate-800">Here (tangential topics):</span> the patient doesn't have this problem, but the encounter is a good excuse to teach it. E.g., patient has cholecystitis → tangential topic: "imaging findings in acute cholecystitis." Or patient is on semaglutide → tangential topic: "how to counsel about GLP-1 side effects."</div>
                  </div>
                </div>
                {(selectedProblems.length + customTopics.length) > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-800 rounded-full text-xs font-medium">
                    <Sparkles className="w-3 h-3" />
                    Will generate {selectedProblems.length + customTopics.length} teaching case{(selectedProblems.length + customTopics.length) !== 1 ? "s" : ""}
                    {customTopics.length > 0 && ` (${selectedProblems.length} from problems + ${customTopics.length} tangential)`}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCustomTopic}
                  onChange={e => setNewCustomTopic(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && newCustomTopic.trim()) {
                      setCustomTopics([...customTopics, newCustomTopic.trim()]);
                      setNewCustomTopic("");
                    }
                  }}
                  placeholder="e.g., Interpretation of thyroid function tests"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
                <button
                  onClick={() => {
                    if (newCustomTopic.trim()) {
                      setCustomTopics([...customTopics, newCustomTopic.trim()]);
                      setNewCustomTopic("");
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />Add
                </button>
              </div>
              {customTopics.length > 0 && (
                <div className="space-y-1.5">
                  {customTopics.map((topic, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-indigo-50 rounded-lg border border-indigo-200">
                      <div className="text-sm text-slate-800 flex-1">{topic}</div>
                      <button
                        onClick={() => setCustomTopics(customTopics.filter((_, idx) => idx !== i))}
                        className="text-slate-400 hover:text-red-600 p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="text-xs text-slate-500 mt-1">These will each become their own teaching case in the final document.</div>
                </div>
              )}
            </div>
            
            <div className="flex gap-2">
              <button onClick={() => setActiveTab("note")} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">← Back</button>
              <button onClick={() => setActiveTab("sources")} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Continue →</button>
            </div>
          </div>
        )}

        {/* SOURCES TAB */}
        {activeTab === "sources" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              {sessionImageBytes > 0 && (
                <div className="mb-3 flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-1.5">
                  <span>Session images: {(sessionImageBytes / 1024 / 1024).toFixed(2)} MB / 8 MB</span>
                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden max-w-xs">
                    <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (sessionImageBytes / IMG_SESSION_TOTAL_BYTES) * 100)}%` }}></div>
                  </div>
                </div>
              )}
              <div className="mb-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 mb-1">External Evidence Sources</h2>
                    <p className="text-sm text-slate-500">Prompts are customized with your selected teaching focus. Copy → paste into source → paste response back below.</p>
                  </div>
                  
                    <a href="#attachments-panel"
                    onClick={e => {
                      e.preventDefault();
                      document.getElementById("attachments-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium flex items-center gap-1 whitespace-nowrap"
                  >
                    <FileText className="w-3 h-3" />
                    or attach PDFs / images ↓
                  </a>
                </div>
                {(() => {
                  const filledExternalCount = activeSources.filter(s => s !== "pubmedai" && sourceResponses[s]?.html?.trim()).length + (Object.values(sourceResponses.pubmedai || {}).filter(v => v?.html?.trim()).length > 0 ? 1 : 0);
                  const pdfCount = pdfAttachments.filter(p => p.extractedText?.trim() && !p.error).length;
                  const totalCount = filledExternalCount + pdfCount;
                  if (totalCount < 2 || !aiEnabled) return null;
                  return (
                    <div className="source-detection-banner mt-2 p-2 rounded text-xs flex items-center gap-2">
                      <Sparkles className="w-3 h-3" />
                      <span>
                        {totalCount} sources detected ({filledExternalCount} pasted response{filledExternalCount !== 1 ? "s" : ""}{pdfCount > 0 ? ` + ${pdfCount} PDF${pdfCount !== 1 ? "s" : ""}` : ""}) — AI will synthesize them into a unified evidence summary, consolidating overlaps and flagging conflicts.
                      </span>
                    </div>
                  );
                })()}
                </div>
        

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                {Object.keys(sources).map(key => (
                  <button key={key} onClick={() => setSources({...sources, [key]: !sources[key]})} className={`p-3 rounded-lg border-2 text-sm font-medium transition ${sources[key] ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                    {sourceLabels[key]}{sources[key] && <Check className="w-4 h-4 inline ml-1" />}
                  </button>
                ))}
              </div>

              {activeSources.length === 0 && (
                <div className="text-center py-8 text-sm text-slate-500 bg-slate-50 rounded-lg">Select one or more sources above.</div>
              )}

              {popupBlocked && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <strong>Your browser blocked the new tab.</strong> Switched to separate "Copy Prompt" and "Open" buttons — click each one in turn. To restore the one-click flow, allow popups from this site in your browser settings, then reload.
                  </div>
                  <button onClick={() => setPopupBlocked(false)} className="text-amber-700 hover:text-amber-900 text-xs underline">Try combined button again</button>
                </div>
              )}

              {activeFocusList.length === 0 && activeSources.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                  Select at least one teaching focus area (Step 3) for prompts to be tailored.
                </div>
              )}

              <div className="space-y-4">
                {activeSources.map(src => (
                  <div key={src} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div
                      className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition cursor-pointer"
                      onClick={() => toggleSection(src)}
                    >
                      <div className="flex items-center gap-2 font-medium text-slate-900 flex-1 text-left min-w-0">
                        {expandedSections[src] ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                        <span className="truncate">{sourceLabels[src]}</span>
                        {src === "pubmedai" ? (
                          Object.values(sourceResponses.pubmedai || {}).filter(v => v?.html?.trim()).length > 0 &&
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex-shrink-0">{Object.values(sourceResponses.pubmedai || {}).filter(v => v?.html?.trim()).length} responses added</span>
                        ) : (
                          sourceResponses[src]?.html?.trim() && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex-shrink-0">Response added</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                        {src !== "pubmedai" && (
                          <button
                            onClick={e => { e.stopPropagation(); setPromptViewerFor(src); }}
                            className="text-xs px-3 py-1.5 bg-slate-600 text-white hover:bg-slate-700 rounded transition flex items-center gap-1"
                            title="Open prompt in a popup for review"
                          >
                            <FileText className="w-3 h-3" />View Prompt
                          </button>
                        )}
                        {/* Combined Copy + Open button — one click copies the prompt AND opens the site.
                            If the browser blocks window.open, we detect it and flip to the legacy
                            two-button layout so the user always has a working path. */}
                        {src !== "pubmedai" && !popupBlocked && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              copyPrompt(src);
                              if (sourceUrls[src]) {
                                const win = window.open(sourceUrls[src], "_blank", "noreferrer");
                                // Popup blocker returns null (or an unusable window). Flip to
                                // the legacy layout so the user can click "Open ↗" manually.
                                if (!win || win.closed || typeof win.closed === "undefined") {
                                  setPopupBlocked(true);
                                }
                              }
                            }}
                            className={`text-xs px-3 py-1.5 rounded transition flex items-center gap-1 ${copiedPrompt === src ? "bg-emerald-600 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}
                            title={sourceUrls[src] ? `Copy prompt and open ${sourceLabels[src]} in a new tab — then paste with Cmd/Ctrl+V` : "Copy prompt to clipboard"}
                          >
                            {copiedPrompt === src
                              ? <><Check className="w-3 h-3" />Copied — paste in new tab</>
                              : sourceUrls[src]
                                ? <><Copy className="w-3 h-3" />Copy & Open {sourceLabels[src].split(" ")[0]} ↗</>
                                : <><Copy className="w-3 h-3" />Copy Prompt</>
                            }
                          </button>
                        )}
                        {/* Legacy separate buttons — shown either when the combined button has been
                            disabled by a popup-blocker detection, OR permanently if you want to
                            force this layout (change the condition below to just `src !== "pubmedai"`). */}
                        {src !== "pubmedai" && popupBlocked && (
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); copyPrompt(src); }}
                              className={`text-xs px-3 py-1.5 rounded transition flex items-center gap-1 ${copiedPrompt === src ? "bg-emerald-600 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
                              title="Copy the prompt to clipboard"
                            >
                              {copiedPrompt === src ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy Prompt</>}
                            </button>
                            {sourceUrls[src] && (
                              <a href={sourceUrls[src]}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded transition flex items-center gap-1"
                                onClick={e => e.stopPropagation()}
                              >
                                Open {sourceLabels[src].split(" ")[0]} ↗
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {expandedSections[src] && src === "pubmedai" && (
                      <div className="p-4 space-y-4 bg-white">
                        <div className="text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded p-2">
                          PubMed AI uses one short prompt per topic. Review a prompt with "View Prompt," or use "Copy & Open PubMed AI" to copy it and open PubMed AI in a new tab. Paste each response into its matching topic box.
                        </div>
                        {[...(selectedProblems.length > 0 ? selectedProblems : (workingDx ? [workingDx] : [])), ...customTopics].map((topic, i) => {
                          const promptText = generatePubmedAiPrompt(topic);
                          const promptKey = `pubmedai-${i}`;
                          const copyPubmedPrompt = () => {
                            navigator.clipboard.writeText(promptText).then(() => {
                              setCopiedPrompt(promptKey);
                              setTimeout(() => setCopiedPrompt(null), 2000);
                            });
                          };

                          return (
                            <div key={`${topic}-${i}`} className="border border-slate-200 rounded p-3">
                              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                                <div className="text-sm font-semibold text-slate-800">Topic {i + 1}: {topic}</div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    onClick={() => setPromptViewerFor({
                                      key: promptKey,
                                      sourceName: `PubMed AI — Topic ${i + 1}`,
                                      prompt: promptText,
                                      compact: true,
                                    })}
                                    className="text-xs px-3 py-1.5 bg-slate-600 text-white hover:bg-slate-700 rounded transition flex items-center gap-1"
                                    title="Open this PubMed AI prompt for review"
                                  >
                                    <FileText className="w-3 h-3" />View Prompt
                                  </button>

                                  {!popupBlocked ? (
                                    <button
                                      onClick={() => {
                                        copyPubmedPrompt();
                                        const win = window.open(sourceUrls.pubmedai, "_blank", "noreferrer");
                                        if (!win || win.closed || typeof win.closed === "undefined") {
                                          setPopupBlocked(true);
                                        }
                                      }}
                                      className={`text-xs px-3 py-1.5 rounded transition flex items-center gap-1 ${copiedPrompt === promptKey ? "bg-emerald-600 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}
                                      title="Copy this one-line prompt and open PubMed AI in a new tab"
                                    >
                                      {copiedPrompt === promptKey
                                        ? <><Check className="w-3 h-3" />Copied — paste in new tab</>
                                        : <><Copy className="w-3 h-3" />Copy & Open PubMed AI ↗</>
                                      }
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        onClick={copyPubmedPrompt}
                                        className={`text-xs px-3 py-1.5 rounded transition flex items-center gap-1 ${copiedPrompt === promptKey ? "bg-emerald-600 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
                                        title="Copy this one-line PubMed AI prompt"
                                      >
                                        {copiedPrompt === promptKey
                                          ? <><Check className="w-3 h-3" />Copied</>
                                          : <><Copy className="w-3 h-3" />Copy Prompt</>
                                        }
                                      </button>
                                      <a
                                        href={sourceUrls.pubmedai}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded transition flex items-center gap-1"
                                      >
                                        Open PubMed AI ↗
                                      </a>
                                    </>
                                  )}
                                </div>
                              </div>

                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Paste PubMed AI response for this topic
                                <span className="font-normal text-slate-500"> (rich text + images supported)</span>
                              </label>
                              <RichPaste
                                value={sourceResponses.pubmedai?.[topic] || { html: "", images: [] }}
                                onChange={v => setSourceResponses({
                                  ...sourceResponses,
                                  pubmedai: { ...(sourceResponses.pubmedai || {}), [topic]: v }
                                })}
                                placeholder="Paste PubMed AI response..."
                                rows={5}
                                sessionImageBytes={sessionImageBytes}
                                onImageBytesChange={delta => setSessionImageBytes(b => b + delta)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {expandedSections[src] && src !== "pubmedai" && (
                      <div className="p-4 bg-white">
                        {src === "other" && (
                          <div className="mb-3 text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded p-2">
                            Use this for any AI tool not listed above (Perplexity, ChatGPT, Claude, Gemini, etc.) or for any other evidence source. Copy the prompt above and paste it into your tool of choice, then paste the response back here.
                          </div>
                        )}
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Paste response from {sourceLabels[src]}
                          <span className="text-xs font-normal text-slate-500 ml-1">(rich text + images supported)</span>
                        </label>
                        <RichPaste
                          value={sourceResponses[src]}
                          onChange={v => setSourceResponses({...sourceResponses, [src]: v})}
                          placeholder="Paste the response here — text, formatting, tables, and images will all carry through..."
                          rows={6}
                          sessionImageBytes={sessionImageBytes}
                          onImageBytesChange={delta => setSessionImageBytes(b => b + delta)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
{/* ATTACHMENTS PANEL — PDFs and images */}
            <div id="attachments-panel" className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Attachments</h2>
                <p className="text-sm text-slate-500">Add PDFs of articles or book chapters (their text will be extracted and fed to the AI), and reference images that will appear at the end of the final document.</p>
              </div>

              {/* PDFs */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">PDF articles & chapters</label>
                  <label className="cursor-pointer inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded transition">
                    <Plus className="w-3 h-3" />Add PDF(s)
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      onChange={e => { addPdfAttachments(Array.from(e.target.files || [])); e.target.value = ""; }}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-500 mb-2">Text-based PDFs work best. Scanned PDFs (image-only) may extract poorly — the system will warn you. Click the box below (or drag files onto it) to add.</p>

                {processingPdf && (
                  <div className="text-xs text-indigo-600 flex items-center gap-1 mb-2">
                    <Loader2 className="w-3 h-3 animate-spin" />Extracting PDF text...
                  </div>
                )}

                {pdfAttachments.length === 0 ? (
                  <label
                    className="block cursor-pointer text-center py-8 text-sm text-slate-500 bg-slate-50 hover:bg-indigo-50 rounded border-2 border-dashed border-slate-200 hover:border-indigo-300 transition"
                    onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("bg-indigo-50", "border-indigo-400"); }}
                    onDragLeave={e => { e.currentTarget.classList.remove("bg-indigo-50", "border-indigo-400"); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("bg-indigo-50", "border-indigo-400");
                      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
                      if (files.length > 0) addPdfAttachments(files);
                    }}
                  >
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      onChange={e => { addPdfAttachments(Array.from(e.target.files || [])); e.target.value = ""; }}
                      className="hidden"
                    />
                    <FileText className="w-6 h-6 mx-auto mb-1.5 text-slate-400" />
                    <div className="font-medium text-slate-600">Click to select PDFs</div>
                    <div className="text-xs text-slate-400 mt-0.5">or drag and drop them here</div>
                  </label>
                ) : (
                  <div className="space-y-2">
                    {pdfAttachments.map(pdf => (
                      <div key={pdf.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded border border-slate-200">
                        <FileText className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{pdf.filename}</div>

                          {/* Citation row: spinner while extracting, editable input once we have (or fail to get) a citation */}
                          {!pdf.error && (
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                              {pdf.citationExtracting ? (
                                <div className="text-xs text-indigo-600 flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />Extracting citation from PDF text...
                                </div>
                              ) : (
                                <>
                                  <label className="text-xs font-medium text-slate-600 whitespace-nowrap">Cited as:</label>
                                  <input
                                    type="text"
                                    value={pdf.citation || ""}
                                    onChange={e => setPdfAttachments(prev => prev.map(p =>
                                      p.id === pdf.id
                                        ? { ...p, citation: e.target.value, shortLabel: e.target.value ? (e.target.value.length > 30 ? e.target.value.slice(0, 30).trim() + "…" : e.target.value) : null }
                                        : p
                                    ))}
                                    placeholder={pdf.citationError ? `Extraction failed — enter manually` : "Author et al. Journal. Year."}
                                    className={`flex-1 min-w-0 px-2 py-1 border rounded text-xs ${pdf.citationError && !pdf.citation ? "border-amber-300 bg-amber-50" : "border-slate-300"}`}
                                  />
                                  {aiEnabled && !pdf.citationExtracting && (
                                    <button
                                      onClick={() => extractPdfCitation(pdf)}
                                      className="text-xs px-2 py-1 bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-700 rounded transition"
                                      title="Re-extract citation from PDF text"
                                    >
                                      <Wand2 className="w-3 h-3 inline" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          )}

                          <div className="text-xs text-slate-500 mt-1">
                            {pdf.error ? (
                              <span className="text-red-600">Extraction failed: {pdf.error}</span>
                            ) : (
                              <>
                                {pdf.pageCount} pages · {Math.round(pdf.extractedText.length / 1000)}k chars extracted
                                {pdf.isScannedLikely && (
                                  <span className="ml-2 text-amber-700 font-medium">⚠ Scanned PDF suspected — little text extracted</span>
                                )}
                                {pdf.citationError && !pdf.citation && (
                                  <span className="ml-2 text-amber-700 italic">Citation not auto-detected: {pdf.citationError}</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => removePdfAttachment(pdf.id)}
                          className="text-slate-400 hover:text-red-600 p-1 flex-shrink-0"
                          title="Remove"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Images */}
              <div
                className="pt-4 border-t border-slate-200"
                tabIndex={0}
                onPaste={e => {
                  const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
                  if (files.length > 0) {
                    e.preventDefault();
                    addImageAttachments(files);
                  }
                }}
                style={{ outline: "none" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Reference images</label>
                  <label className="cursor-pointer inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded transition">
                    <Plus className="w-3 h-3" />Add image(s)
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={e => { addImageAttachments(Array.from(e.target.files || [])); e.target.value = ""; }}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  Images appear at the end of the final document as reference figures. Not fed to the AI.
                </p>
                <div className="mb-2 flex items-center gap-2 text-xs bg-indigo-50 border border-indigo-200 rounded px-2.5 py-1.5 text-indigo-800">
                  <span>📋</span>
                  <span><strong>Tip:</strong> Screenshot something (Cmd+Shift+4 on Mac, Win+Shift+S on Windows), then click into the drop zone below and paste (Cmd/Ctrl+V) to add it instantly.</span>
                </div>
                {imageAttachments.length === 0 ? (
                  <div
                    className="text-center py-6 text-sm text-slate-500 bg-slate-50 rounded border-2 border-dashed border-slate-200 focus:border-indigo-400 focus:bg-indigo-50 transition cursor-text"
                    tabIndex={0}
                    onFocus={e => { e.target.textContent = "Ready — paste image now (Ctrl/Cmd+V)"; }}
                    onBlur={e => { e.target.textContent = "No images attached yet. Click here and paste to add from clipboard."; }}
                  >
                    No images attached yet. Click here and paste to add from clipboard.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {imageAttachments.map(img => (
                      <div key={img.id} className="p-2 bg-slate-50 rounded border border-slate-200">
                        <div className="relative group">
                          {/* Click thumbnail to open lightbox at full size */}
                          <button
                            onClick={() => setAttachmentLightbox({
                              dataUrl: img.dataUrl,
                              alt: img.caption || img.filename || "Attached image",
                            })}
                            className="block w-full cursor-zoom-in"
                            title="Click to view full size"
                          >
                            <img
                              src={img.dataUrl}
                              alt={img.caption || img.filename}
                              className="w-full h-32 object-contain bg-white rounded"
                            />
                            {/* Zoom hint overlay — appears on hover */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 rounded transition pointer-events-none">
                              <div className="opacity-0 group-hover:opacity-100 transition bg-white/95 text-slate-800 text-xs font-medium px-2 py-1 rounded shadow flex items-center gap-1">
                                🔍 View full size
                              </div>
                            </div>
                          </button>
                          <button
                            onClick={() => removeImageAttachment(img.id)}
                            className="absolute top-1 right-1 bg-white/95 hover:bg-red-100 text-slate-500 hover:text-red-600 rounded-full w-6 h-6 flex items-center justify-center shadow z-10"
                            title="Remove"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="text-xs text-slate-500 mt-1 truncate">{img.filename}</div>
                        <input
                          type="text"
                          value={img.caption}
                          onChange={e => updateImageCaption(img.id, e.target.value)}
                          placeholder="Add a caption (optional)..."
                          className="w-full mt-1 px-2 py-1 border border-slate-300 rounded text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setActiveTab("focus")} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">← Back</button>
              <button onClick={() => setActiveTab("goals")} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Continue →</button>
            </div>
          </div>
        )}

        {/* GOALS TAB */}
        {activeTab === "goals" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Long-Term Learning Goals</h2>
                <p className="text-sm text-slate-500">Goals persist across sessions.</p>
              </div>

              {/* AI-recommended goals panel — only shown when there's enough context */}
              {aiEnabled && (chiefConcern || workingDx || activeFocusList.length > 0) && (
                <div className="ai-recommendations-card">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "1.1rem" }}>💡</span>
                      <div>
                        <div className="ai-recommendations-eyebrow">
                          AI recommendations
                        </div>
                        <div className="ai-recommendations-subtitle text-xs mt-0.5">
                          Based on today's case and your phase-appropriate benchmarks
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={generateGoalRecommendations}
                      disabled={loadingGoalRecs}
                      className="ai-recommendations-button text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1 disabled:opacity-50 transition"
                    >
                      {loadingGoalRecs
                        ? <><Loader2 className="w-3 h-3 animate-spin" />Thinking...</>
                        : recommendedGoals.length > 0
                          ? <><Wand2 className="w-3 h-3" />Get new ideas</>
                          : <><Sparkles className="w-3 h-3" />Suggest goals</>
                      }
                    </button>
                  </div>

                  {goalRecError && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-2">
                      {goalRecError}
                    </div>
                  )}

                  {recommendedGoals.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {recommendedGoals.map((rec, i) => (
                        <div
                          key={i}
                          className="ai-recommendation-item group flex items-start gap-2 p-2.5 rounded-lg transition"
                        >
                          <button
                            onClick={() => acceptGoalRecommendation(rec)}
                            className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 hover:bg-emerald-600 text-emerald-700 hover:text-white flex items-center justify-center transition mt-0.5"
                            title="Add this goal"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="ai-recommendation-goal text-sm leading-snug">{rec.goal}</div>
                            {rec.rationale && (
                              <div className="ai-recommendation-rationale text-xs italic mt-1">
                                <span className="font-medium not-italic">Why: </span>{rec.rationale}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => dismissGoalRecommendation(rec)}
                            className="ai-recommendation-dismiss flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition"
                            title="Dismiss this suggestion"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {!loadingGoalRecs && recommendedGoals.length === 0 && !goalRecError && (
                    <div className="ai-recommendations-helper text-xs italic mt-2">
                      Click "Suggest goals" to see 3-4 phase-appropriate long-term learning goals based on today's case. You can add them to your goals list with one click.
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <input type="text" value={newGoal} onChange={e => setNewGoal(e.target.value)} onKeyDown={e => e.key === "Enter" && addGoal()} placeholder="e.g., Build systematic approach to ECG interpretation by month 6" className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
                <button onClick={addGoal} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1 text-sm font-medium"><Plus className="w-4 h-4" />Add</button>
              </div>
              {longTermGoals.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-500 bg-slate-50 rounded-lg">No long-term goals yet.</div>
              ) : (
                <div className="space-y-2">
                  {longTermGoals.map(g => (
                    <div key={g.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <Target className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm text-slate-900">{g.text}</div>
                        <div className="text-xs text-slate-500">Added {g.added}</div>
                      </div>
                      <button onClick={() => removeGoal(g.id)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <button onClick={() => setActiveTab("sources")} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">← Back</button>
              <button onClick={generateDocument} disabled={activeFocusList.length === 0 || aiStatus.generating} className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                {aiStatus.generating ? <><Loader2 className="w-4 h-4 animate-spin" />Generating...</> : <><Sparkles className="w-4 h-4" />Generate Teaching Document</>}
              </button>
              {activeFocusList.length === 0 && <span className="text-xs text-amber-700">Select at least one focus area</span>}
            </div>
          </div>
        )}

        {/* OUTPUT TAB - Preview/Edit Mode + Final Document */}
        {activeTab === "output" && (
          <>
            {aiStatus.generating && !previewData ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1.25rem", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "999px", color: "#4338ca", fontSize: "0.9rem", fontWeight: 500 }}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Preparing your teaching document...</span>
                </div>
                <div className="text-xs text-slate-500 mt-4 max-w-md mx-auto">
                  Synthesizing evidence · generating case teaching · calibrating shelf questions to phase · assembling document
                </div>
              </div>
            ) : !previewData && !generatedDoc ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <div className="text-slate-500 mb-4">No document generated yet.</div>
                <button onClick={generateDocument} disabled={activeFocusList.length === 0} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">Generate Preview</button>
              </div>
            ) : previewMode && previewData ? (
              // ============ PREVIEW/EDIT MODE ============
              <PreviewEditor
                previewData={previewData}
                setPreviewData={setPreviewData}
                togglePreviewSection={togglePreviewSection}
                toggleTeachingCase={toggleTeachingCase}
                updatePreviewField={updatePreviewField}
                updateTeachingCaseField={updateTeachingCaseField}
                commitPreviewToDocument={commitPreviewToDocument}
                onBack={() => setActiveTab("goals")}
                onRegenerate={generateDocument}
                onRetryFailed={() => generateDocument({ retryFailedOnly: true })}
                generationAttempts={generationAttempts}
                fetchingPubmed={fetchingPubmed}
                aiStatus={aiStatus}
                focusLabels={focusLabels}
                phase={phase}
                session={session}
              />
            ) : sessionMode === "pre" ? (
              // ============ IN-ROOM DOCUMENT (pre-visit) ============
              // The attending's preview is ephemeral — no state persistence.
              // The exported HTML has its own localStorage-backed persistence
              // for the STUDENT's use only.
              <InRoomDocument
                doc={generatedDoc || previewData}
                phase={phase}
                session={session}
                onEdit={() => { setPreviewMode(true); }}
                onPrint={printDoc}
              />
            ) : (
              // ============ FINAL DOCUMENT (post-visit) ============
              <FinalDocument
                doc={generatedDoc || previewData}
                phase={phase}
                session={session}
                onPrint={printDoc}
                onEdit={() => { setPreviewMode(true); }}
                onUpdate={(updater) => {
                  if (generatedDoc) setGeneratedDoc(prev => updater(JSON.parse(JSON.stringify(prev))));
                  else setPreviewData(prev => updater(JSON.parse(JSON.stringify(prev))));
                }}
              />
            )}
          </>
        )}
          {promptViewer && (
          <PromptViewer
            key={promptViewer.key}
            sourceName={promptViewer.sourceName}
            initialPrompt={promptViewer.prompt}
            compact={Boolean(promptViewer.compact)}
            onClose={() => setPromptViewerFor(null)}
          />
        )}
        {attachmentLightbox && (
          <ImageLightbox
            src={attachmentLightbox.dataUrl}
            alt={attachmentLightbox.alt}
            onClose={() => setAttachmentLightbox(null)}
          />
        )}
        {showDeidReviewer && deidPreview && (
                    <DeidentificationReviewer
            key={
              deidPreview.reviewId ||
              "deid-review"
            }
            rawText={rawPrenote || clinicalNote}
            initialResult={deidPreview}
            onCancel={() => {
              setShowDeidReviewer(false);
              // Keep rawPrenote around in case they want to try again
            }}
                        onConfirm={(finalText) => {
              const confirmedText =
                String(finalText || "").trim();

              if (!confirmedText) return;

              setClinicalNote(confirmedText);
              setRawPrenote("");
              setDeidPreview(null);
              setShowDeidReviewer(false);
              setDeidStatus({
                running: false,
                error: "",
              });
            }}
          />
        )}
      </main>
    </div>
  );
}

// ============ IMAGE UTILITIES ============
const IMG_MAX_BYTES = 1_000_000; // 1MB per image
const IMG_SESSION_TOTAL_BYTES = 8_000_000; // 8MB total
const IMG_COMPRESS_THRESHOLD = 500_000; // compress if over 500KB
const IMG_MAX_DIMENSION = 1200;

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const dataUrlByteSize = (dataUrl) => {
  // Approx: base64 is 4/3 of bytes; strip header
  const b64 = dataUrl.split(",")[1] || "";
  return Math.floor(b64.length * 0.75);
};

const compressDataUrl = (dataUrl) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > IMG_MAX_DIMENSION || height > IMG_MAX_DIMENSION) {
      const scale = IMG_MAX_DIMENSION / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // White background in case of transparency (JPEG can't do alpha)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    resolve(canvas.toDataURL("image/jpeg", 0.8));
  };
  img.onerror = () => resolve(dataUrl); // fall back to original
  img.src = dataUrl;
});

const fetchAsDataUrl = async (url) => {
  // Try direct fetch first
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Not an image");
      return await blobToDataUrl(blob);
    }
  } catch (e) {
    // fall through to proxy
  }
  // Proxy fallback via Worker
  const proxyUrl = WORKER_URL.replace(/\/$/, "") + "/proxy-image?url=" + encodeURIComponent(url);
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy failed: ${res.status}`);
  const blob = await res.blob();
  return await blobToDataUrl(blob);
};

const processImageSrc = async (src, currentTotalBytes) => {
  // Returns { dataUrl, bytes, warning }
  let dataUrl = src;
  if (!src.startsWith("data:")) {
    // External URL — fetch and inline
    dataUrl = await fetchAsDataUrl(src);
  }
  let bytes = dataUrlByteSize(dataUrl);
  if (bytes > IMG_COMPRESS_THRESHOLD) {
    dataUrl = await compressDataUrl(dataUrl);
    bytes = dataUrlByteSize(dataUrl);
  }
  if (bytes > IMG_MAX_BYTES) {
    return { dataUrl: null, bytes: 0, warning: `Image too large after compression (${Math.round(bytes / 1024)}KB, max ${IMG_MAX_BYTES / 1024}KB)` };
  }
  if (currentTotalBytes + bytes > IMG_SESSION_TOTAL_BYTES) {
    return { dataUrl: null, bytes: 0, warning: `Session image limit reached (${Math.round(IMG_SESSION_TOTAL_BYTES / 1024 / 1024)}MB total)` };
  }
  return { dataUrl, bytes, warning: null };
};

// ============ PDF UTILITIES ============
// Lazy-load PDF.js only when needed
let pdfJsPromise = null;
const loadPdfJs = () => {
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      } else {
        reject(new Error("PDF.js failed to load"));
      }
    };
    script.onerror = () => reject(new Error("PDF.js CDN unreachable"));
    document.head.appendChild(script);
  });
  return pdfJsPromise;
};

const extractPdfText = async (file) => {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ").replace(/\s+/g, " ").trim();
    if (pageText) pageTexts.push(pageText);
  }
  return {
    text: pageTexts.join("\n\n"),
    pageCount: pdf.numPages,
    extractedPageCount: pageTexts.length,
  };
};

// ============ RICH PASTE COMPONENT ============
function RichPaste({ value, onChange, placeholder, rows = 6, sessionImageBytes, onImageBytesChange }) {
  const ref = React.useRef(null);
  const [processing, setProcessing] = React.useState(0);
  const [warning, setWarning] = React.useState(null);
  const skipNextSync = React.useRef(false);

  // Initialize content on mount and when value changes externally
  React.useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    if (ref.current && ref.current.innerHTML !== (value?.html || "")) {
      ref.current.innerHTML = value?.html || "";
    }
  }, [value?.html]);

  const emitChange = () => {
    if (!ref.current) return;
    const html = ref.current.innerHTML;
    const imgs = Array.from(ref.current.querySelectorAll("img"));
    const images = imgs.map((img, i) => ({
      id: img.dataset.imgId || `img-${Date.now()}-${i}`,
      dataUrl: img.src,
      alt: img.alt || "",
    }));
    skipNextSync.current = true;
    onChange({ html, images });
  };

  const handlePaste = async (e) => {
    e.preventDefault();
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    // Collect image files from clipboard (screenshots)
    const files = Array.from(clipboard.files || []).filter(f => f.type.startsWith("image/"));

    // Collect HTML content
    const html = clipboard.getData("text/html");
    const text = clipboard.getData("text/plain");

    setWarning(null);
    let addedBytes = 0;

    if (html) {
      // Sanitize and process external images
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      // Remove scripts, styles, and dangerous elements
      tempDiv.querySelectorAll("script, style, link, meta, iframe, object, embed").forEach(el => el.remove());
      // Strip event handlers and inline styles that could break layout
      tempDiv.querySelectorAll("*").forEach(el => {
        [...el.attributes].forEach(attr => {
          if (attr.name.startsWith("on") || attr.name === "srcset") {
            el.removeAttribute(attr.name);
          }
        });
      });

      const imgs = Array.from(tempDiv.querySelectorAll("img"));
      if (imgs.length > 0) {
        setProcessing(imgs.length);
        for (const img of imgs) {
          const src = img.getAttribute("src");
          if (!src) { img.remove(); continue; }
          try {
            const result = await processImageSrc(src, sessionImageBytes + addedBytes);
            if (result.dataUrl) {
              img.src = result.dataUrl;
              img.style.maxWidth = "100%";
              img.style.height = "auto";
              img.dataset.imgId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              addedBytes += result.bytes;
            } else {
              img.remove();
              setWarning(result.warning);
            }
          } catch (err) {
            console.warn("Image processing failed:", err);
            img.remove();
            setWarning(`Some images couldn't be loaded (${err.message})`);
          }
          setProcessing(n => n - 1);
        }
      }

      // Insert sanitized HTML at cursor
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const frag = document.createDocumentFragment();
        while (tempDiv.firstChild) frag.appendChild(tempDiv.firstChild);
        range.insertNode(frag);
        range.collapse(false);
      } else if (ref.current) {
        ref.current.innerHTML += tempDiv.innerHTML;
      }
    } else if (text) {
      // Plain text fallback
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      } else if (ref.current) {
        ref.current.textContent += text;
      }
    }

    // Handle image files (screenshots) separately
    for (const file of files) {
      try {
        const dataUrl = await blobToDataUrl(file);
        const result = await processImageSrc(dataUrl, sessionImageBytes + addedBytes);
        if (result.dataUrl && ref.current) {
          const img = document.createElement("img");
          img.src = result.dataUrl;
          img.style.maxWidth = "100%";
          img.style.height = "auto";
          img.dataset.imgId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          ref.current.appendChild(img);
          addedBytes += result.bytes;
        } else if (!result.dataUrl) {
          setWarning(result.warning);
        }
      } catch (err) {
        console.warn("File image failed:", err);
      }
    }

    if (addedBytes > 0 && onImageBytesChange) onImageBytesChange(addedBytes);
    emitChange();
  };

  const imageCount = value?.images?.length || 0;

  return (
    <div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onPaste={handlePaste}
        onInput={emitChange}
        onBlur={emitChange}
        className="rich-paste-editor w-full px-3 py-2 bg-white text-slate-900 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm overflow-auto"
        style={{ minHeight: `${rows * 1.5}em`, maxHeight: "500px" }}
        data-placeholder={placeholder}
      />
      <style>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        [contenteditable] img {
          border-radius: 4px;
          margin: 4px 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
      `}</style>
      <div className="flex items-center justify-between mt-1 text-xs text-slate-500">
        <div className="flex items-center gap-3">
          {imageCount > 0 && <span>🖼 {imageCount} image{imageCount !== 1 ? "s" : ""}</span>}
          {processing > 0 && <span className="text-indigo-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Processing {processing} image{processing !== 1 ? "s" : ""}...</span>}
        </div>
        {warning && (
          <div className="text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />{warning}
            <button onClick={() => setWarning(null)} className="ml-1 hover:text-amber-900">×</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ INLINE EDITABLE TEXT COMPONENT ============
function Editable({ value, onSave, multiline = false, className = "", as: Tag = "span" }) {
  const [editing, setEditing] = React.useState(false);
  const [showToolbar, setShowToolbar] = React.useState(false);
  const ref = React.useRef(null);

  const startEdit = () => {
    setEditing(true);
    setShowToolbar(true);
    setTimeout(() => {
      if (ref.current) {
        ref.current.focus();
        // Move caret to end
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(ref.current);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }, 10);
  };

  const finish = () => {
    if (ref.current) onSave(ref.current.innerHTML);
    setEditing(false);
    setShowToolbar(false);
  };

  const cancel = () => {
    if (ref.current) ref.current.innerHTML = value || "";
    setEditing(false);
    setShowToolbar(false);
  };

  const applyFormat = (cmd) => {
    document.execCommand(cmd, false, null);
    if (ref.current) ref.current.focus();
  };

  const handleKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    if (!multiline && e.key === "Enter") { e.preventDefault(); finish(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); finish(); }
  };

  return (
    <span className="relative inline-block" style={{width: multiline ? "100%" : "auto"}}>
      {showToolbar && editing && (
        <div className="absolute -top-9 left-0 z-20 bg-slate-800 text-white rounded shadow-lg flex items-center gap-0.5 px-1 py-0.5 no-print">
          <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("bold"); }} className="px-2 py-1 hover:bg-slate-700 rounded text-xs font-bold">B</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("italic"); }} className="px-2 py-1 hover:bg-slate-700 rounded text-xs italic">I</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("underline"); }} className="px-2 py-1 hover:bg-slate-700 rounded text-xs underline">U</button>
          <div className="w-px h-4 bg-slate-600 mx-1"></div>
          <button type="button" onMouseDown={e => { e.preventDefault(); finish(); }} className="px-2 py-1 hover:bg-emerald-700 rounded text-xs">Done</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); cancel(); }} className="px-2 py-1 hover:bg-red-700 rounded text-xs">Cancel</button>
        </div>
      )}
      <Tag
        ref={ref}
        contentEditable={editing}
        suppressContentEditableWarning
        onClick={() => !editing && startEdit()}
        onBlur={editing ? finish : undefined}
        onKeyDown={handleKey}
        className={`${className} ${editing ? "bg-yellow-50 ring-2 ring-yellow-400 rounded px-1 outline-none" : "hover:bg-yellow-50 hover:outline-dashed hover:outline-1 hover:outline-yellow-400 cursor-text rounded px-0.5"} transition`}
        dangerouslySetInnerHTML={{ __html: value || "" }}
      />
    </span>
  );
}

// ============ PREVIEW EDITOR COMPONENT ============
function PreviewEditor({ previewData, togglePreviewSection, toggleTeachingCase, updatePreviewField, updateTeachingCaseField, commitPreviewToDocument, onBack, onRegenerate, onRetryFailed, generationAttempts, aiStatus, focusLabels, phase, session }) {
  const s = previewData.sections;
  const [previewScale, setPreviewScale] = React.useState(0.72);
  const SectionHeader = ({ label, enabled, onToggle, count }) => (
    <div className="flex items-center justify-between bg-slate-100 px-4 py-2 border-b border-slate-200">
      <div className="flex items-center gap-2">
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={onToggle} className="sr-only peer" />
          <div className="w-9 h-5 bg-slate-300 peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
        </label>
        <span className="font-semibold text-slate-900 text-sm">{label}</span>
        {count !== undefined && <span className="text-xs text-slate-500">({count})</span>}
      </div>
      <span className={`text-xs uppercase font-semibold ${enabled ? "text-emerald-700" : "text-slate-400"}`}>{enabled ? "Included" : "Hidden"}</span>
    </div>
  );

  // Derive summary counts from generationAttempts
  const attemptSummary = React.useMemo(() => {
    if (!generationAttempts?.lastRunAt) return null;
    const cases = Object.entries(generationAttempts.cases || {});
    const succeeded = cases.filter(([_, v]) => v.status === "success" || v.status === "cached").length;
    const failed = cases.filter(([_, v]) => v.status === "failed");
    return {
      synthesis: generationAttempts.synthesis,
      themes: generationAttempts.themes,
      casesSucceeded: succeeded,
      casesFailed: failed,
      casesTotal: cases.length,
      hasFailures: failed.length > 0 || generationAttempts.synthesis === "failed" || generationAttempts.themes === "failed",
    };
  }, [generationAttempts]);

  const StatusBadge = ({ status, label }) => {
    const colors = {
      success: "bg-emerald-100 text-emerald-800 border-emerald-200",
      cached: "bg-slate-100 text-slate-700 border-slate-200",
      failed: "bg-red-100 text-red-800 border-red-200",
      skipped: "bg-slate-50 text-slate-500 border-slate-200",
    };
    const icons = {
      success: <Check className="w-3 h-3" />,
      cached: <Check className="w-3 h-3" />,
      failed: <X className="w-3 h-3" />,
      skipped: null,
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${colors[status] || colors.skipped}`}>
        {icons[status]}
        {label}
      </span>
    );
  };

  return (
    <div>
      {/* Generation summary — only shown after a generation attempt */}
      {attemptSummary && (
        <div className={`rounded-lg border p-4 mb-4 ${attemptSummary.hasFailures ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {attemptSummary.hasFailures
                  ? <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0" />
                  : <Check className="w-4 h-4 text-emerald-700 flex-shrink-0" />
                }
                <h3 className={`text-sm font-bold ${attemptSummary.hasFailures ? "text-amber-900" : "text-emerald-900"}`}>
                  {attemptSummary.hasFailures ? "Generation partially succeeded" : "Generation complete"}
                </h3>
              </div>
              <div className="flex flex-wrap gap-1.5 items-center text-xs">
                {attemptSummary.synthesis && attemptSummary.synthesis !== "skipped" && (
                  <StatusBadge
                    status={attemptSummary.synthesis}
                    label={`Evidence synthesis: ${attemptSummary.synthesis}`}
                  />
                )}
                {attemptSummary.casesTotal > 0 && (
                  <StatusBadge
                    status={attemptSummary.casesFailed.length > 0 ? "failed" : "success"}
                    label={`Teaching cases: ${attemptSummary.casesSucceeded}/${attemptSummary.casesTotal} succeeded`}
                  />
                )}
                {attemptSummary.themes && attemptSummary.themes !== "skipped" && (
                  <StatusBadge
                    status={attemptSummary.themes}
                    label={`Cross-cutting themes: ${attemptSummary.themes}`}
                  />
                )}
              </div>
              {attemptSummary.casesFailed.length > 0 && (
                <div className="mt-2 text-xs text-amber-900">
                  <strong>Failed to generate:</strong>
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">
                    {attemptSummary.casesFailed.map(([problem, { error }], i) => (
                      <li key={i}>
                        <span className="font-medium">{problem}</span>
                        {error && <span className="text-amber-700 italic ml-1">— {error.slice(0, 120)}</span>}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 italic">These cases won't appear in the document. The successful cases and evidence are preserved — click "Retry failed" to try again with just the failed items.</div>
                </div>
              )}
            </div>
            {attemptSummary.hasFailures && (
              <button
                onClick={onRetryFailed}
                disabled={aiStatus.generating}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex-shrink-0"
              >
                {aiStatus.generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                Retry failed
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top action bar */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Preview & Edit</h2>
            <p className="text-sm text-slate-700 mt-1">Configure sections on the left, see the live document on the right. When you're happy, generate the final version.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="px-3 py-2 text-slate-600 hover:bg-white rounded-lg text-sm">← Back to Goals</button>
            <button onClick={onRegenerate} className="px-3 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm flex items-center gap-1">
              <Wand2 className="w-4 h-4" />Re-run AI
            </button>
            <button onClick={commitPreviewToDocument} className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4" />Generate Final Document
            </button>
          </div>
        </div>
      </div>

      {/* Split layout: controls left, live preview right */}
      <div className="grid gap-4 preview-split-grid" style={{ gridTemplateColumns: "minmax(0, 380px) minmax(0, 1fr)" }}>
        {/* LEFT: controls */}
        <div className="space-y-3" style={{ maxHeight: "calc(100vh - 200px)", overflowY: "auto", paddingRight: "0.5rem" }}>
          <div className="text-xs uppercase font-semibold text-slate-500 tracking-wider mb-1">Sections</div>

          {/* Session Goal */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <SectionHeader label="Session Goal" enabled={s.sessionGoal.enabled} onToggle={() => togglePreviewSection("sessionGoal")} />
            {s.sessionGoal.enabled && (
              <div className="p-3">
                <input type="text" value={s.sessionGoal.content} onChange={e => updatePreviewField("sections.sessionGoal.content", e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
              </div>
            )}
          </div>

          {/* Teaching Cases */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            {s.teachingCases.length === 0 ? (
              <div className="bg-slate-100 px-4 py-3 flex items-center justify-between">
                <div className="font-semibold text-sm text-slate-500">Teaching Cases</div>
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">No AI content — re-run</span>
              </div>
            ) : (
              <>
                <div className="bg-slate-800 text-white px-4 py-2">
                  <div className="font-semibold text-sm">Teaching Cases ({s.teachingCases.filter(tc => tc.enabled).length} of {s.teachingCases.length} on)</div>
                </div>
                {s.teachingCases.map((tc, idx) => (
                  <div key={idx} className="border-t border-slate-200">
                    <SectionHeader label={`Case ${idx+1}: ${tc.data.problem}`} enabled={tc.enabled} onToggle={() => toggleTeachingCase(idx)} />
                    {tc.enabled && (
                      <div className="p-3 space-y-2 bg-slate-50">
                        {tc.data.primaryDiagnosis?.name && (
                          <div>
                            <label className="text-xs font-semibold text-slate-600 uppercase">Primary Diagnosis</label>
                            <input type="text" value={tc.data.primaryDiagnosis.name} onChange={e => updateTeachingCaseField(idx, "primaryDiagnosis", {...tc.data.primaryDiagnosis, name: e.target.value})} className="w-full mt-1 px-2 py-1 border border-slate-300 rounded text-sm" />
                            <textarea value={tc.data.primaryDiagnosis.briefDefinition || ""} onChange={e => updateTeachingCaseField(idx, "primaryDiagnosis", {...tc.data.primaryDiagnosis, briefDefinition: e.target.value})} rows={2} className="w-full mt-1 px-2 py-1 border border-slate-300 rounded text-sm" placeholder="Brief definition" />
                          </div>
                        )}
                        {tc.data.clinicalPearl && (
                          <div>
                            <label className="text-xs font-semibold text-slate-600 uppercase">Clinical Pearl</label>
                            <textarea value={tc.data.clinicalPearl} onChange={e => updateTeachingCaseField(idx, "clinicalPearl", e.target.value)} rows={2} className="w-full mt-1 px-2 py-1 border border-slate-300 rounded text-sm" />
                          </div>
                        )}
                        {tc.data.shelfQuestions?.length > 0 && (
                          <details className="text-sm">
                            <summary className="cursor-pointer font-semibold text-slate-700">Shelf Questions ({tc.data.shelfQuestions.length})</summary>
                            <div className="mt-2 space-y-2">
                              {tc.data.shelfQuestions.map((q, qi) => (
                                <div key={qi} className="border border-slate-200 rounded p-2 bg-white">
                                  <textarea value={q.vignette} onChange={e => {
                                    const newQ = [...tc.data.shelfQuestions];
                                    newQ[qi] = {...q, vignette: e.target.value};
                                    updateTeachingCaseField(idx, "shelfQuestions", newQ);
                                  }} rows={3} className="w-full px-2 py-1 border border-slate-300 rounded text-xs" />
                                  <div className="text-xs text-slate-500 mt-1">Answer: {q.correctAnswer}</div>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        <details className="text-sm text-slate-600">
                          <summary className="cursor-pointer font-medium hover:text-slate-900">View all sections for this case</summary>
                          <div className="mt-2 space-y-2 text-xs bg-white p-3 rounded border border-slate-200 max-h-96 overflow-y-auto">
                            {tc.data.illnessScript && (tc.data.illnessScript.epidemiology || tc.data.illnessScript.timeCourse) && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Illness Script</div>
                                <div className="mt-0.5 text-slate-600">
                                  {tc.data.illnessScript.epidemiology && <div><span className="font-medium">Epidemiology:</span> {tc.data.illnessScript.epidemiology}</div>}
                                  {tc.data.illnessScript.timeCourse && <div className="mt-0.5"><span className="font-medium">Time course:</span> {tc.data.illnessScript.timeCourse}</div>}
                                  {tc.data.illnessScript.keySymptoms && <div className="mt-0.5"><span className="font-medium">Key symptoms:</span> {tc.data.illnessScript.keySymptoms}</div>}
                                </div>
                              </div>
                            )}
                            {tc.data.differentialDiagnosis?.length > 0 && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Differential ({tc.data.differentialDiagnosis.length})</div>
                                <ul className="mt-0.5 ml-3 list-disc text-slate-600">
                                  {tc.data.differentialDiagnosis.map((dd, i) => <li key={i}>{dd.diagnosis}</li>)}
                                </ul>
                              </div>
                            )}
                            {tc.data.keyLearningPoints?.length > 0 && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Learning Points ({tc.data.keyLearningPoints.length})</div>
                                <ol className="mt-0.5 ml-3 list-decimal text-slate-600">
                                  {tc.data.keyLearningPoints.map((lp, i) => <li key={i}>{lp.point}</li>)}
                                </ol>
                              </div>
                            )}
                            {tc.data.focusedHistoryQuestions?.length > 0 && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>History Questions ({tc.data.focusedHistoryQuestions.length})</div>
                                <ul className="mt-0.5 ml-3 list-disc text-slate-600">
                                  {tc.data.focusedHistoryQuestions.map((hq, i) => <li key={i}>{hq.question}</li>)}
                                </ul>
                              </div>
                            )}
                            {tc.data.physicalExam?.maneuver && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Physical Exam</div>
                                <div className="mt-0.5 text-slate-600">{tc.data.physicalExam.maneuver}</div>
                              </div>
                            )}
                            {tc.data.keyLabsAndImaging?.length > 0 && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Labs & Imaging ({tc.data.keyLabsAndImaging.length})</div>
                                <ul className="mt-0.5 ml-3 list-disc text-slate-600">
                                  {tc.data.keyLabsAndImaging.map((lab, i) => <li key={i}>{lab.study}</li>)}
                                </ul>
                              </div>
                            )}
                            {tc.data.treatmentApproach?.firstLine?.length > 0 && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Treatment ({tc.data.treatmentApproach.firstLine.length} first-line)</div>
                                <ul className="mt-0.5 ml-3 list-disc text-slate-600">
                                  {tc.data.treatmentApproach.firstLine.map((t, i) => <li key={i}>{t.treatment}</li>)}
                                </ul>
                              </div>
                            )}
                            {tc.data.communicationTeaching?.scenario && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Communication Teaching</div>
                                <div className="mt-0.5 text-slate-600 italic">{tc.data.communicationTeaching.scenario}</div>
                              </div>
                            )}
                            {tc.data.recommendedReading?.length > 0 && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Recommended Reading ({tc.data.recommendedReading.length})</div>
                                <ul className="mt-0.5 ml-3 list-disc text-slate-600">
                                  {tc.data.recommendedReading.map((r, i) => <li key={i}>{r.reference}</li>)}
                                </ul>
                              </div>
                            )}
                            {tc.data.quoteToDiscuss && (
                              <div>
                                <div className="font-semibold text-slate-700 uppercase tracking-wide" style={{fontSize: "0.65rem"}}>Patient's Voice</div>
                                <div className="mt-0.5 text-slate-600 italic">"{tc.data.quoteToDiscuss}"</div>
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Lab Trends */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <SectionHeader label="Lab & Vital Trends" enabled={s.labTrends.enabled} onToggle={() => togglePreviewSection("labTrends")} count={s.labTrends.content?.length} />
          </div>

          {/* Cross-Cutting Themes */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            {s.crossCuttingThemes.content.length > 0 ? (
              <SectionHeader label="Cross-Cutting Themes" enabled={s.crossCuttingThemes.enabled} onToggle={() => togglePreviewSection("crossCuttingThemes")} count={s.crossCuttingThemes.content.length} />
            ) : (
              <div className="bg-slate-100 px-4 py-2 flex items-center justify-between"><div className="font-semibold text-sm text-slate-500">Cross-Cutting Themes</div><span className="text-xs text-slate-500 italic">Not generated</span></div>
            )}
          </div>

          {/* Synthesized Evidence */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            {s.synthesizedEvidence.content ? (
              <>
                <SectionHeader label="Evidence Summary" enabled={s.synthesizedEvidence.enabled} onToggle={() => togglePreviewSection("synthesizedEvidence")} />
                {s.synthesizedEvidence.note && <div className="px-4 py-2 text-xs text-slate-600 italic bg-emerald-50 border-t border-emerald-100">{s.synthesizedEvidence.note}</div>}
              </>
            ) : (
              <div className="bg-slate-100 px-4 py-2 flex items-center justify-between"><div className="font-semibold text-sm text-slate-500">Evidence Summary</div><span className="text-xs text-slate-500 italic">No external sources added</span></div>
            )}
          </div>

          {/* Long-term goals */}
          {s.longTermGoals.content.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <SectionHeader label="Ongoing Learning Goals" enabled={s.longTermGoals.enabled} onToggle={() => togglePreviewSection("longTermGoals")} count={s.longTermGoals.content.length} />
            </div>
          )}

          {/* Next Session Prep */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <SectionHeader label="Prep for Next Session" enabled={s.nextSessionPrep.enabled} onToggle={() => togglePreviewSection("nextSessionPrep")} />
          </div>

          <div className="text-xs text-slate-500 italic pt-2 border-t border-slate-200">
            Preview updates live on the right as you toggle sections and edit fields.
          </div>
        </div>

        {/* RIGHT: live document preview */}
        <div className="relative">
          <div className="sticky top-24">
            <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap">
              <div className="text-xs uppercase font-semibold text-slate-500 tracking-wider">Live Preview</div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 bg-white border border-slate-300 rounded overflow-hidden">
                  {[
                    { val: 0.6, label: "60%" },
                    { val: 0.72, label: "72%" },
                    { val: 0.9, label: "90%" },
                    { val: 1.0, label: "100%" },
                  ].map(opt => (
                    <button
                      key={opt.val}
                      onClick={() => setPreviewScale(opt.val)}
                      className={`px-2 py-1 text-xs transition ${previewScale === opt.val ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-slate-400 italic">Read-only</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
              <div style={{ transform: `scale(${previewScale})`, transformOrigin: "top left", width: `${100 / previewScale}%`, pointerEvents: "none" }}>
                <DocumentContent doc={{...previewData, isPreview: true}} phase={phase} session={session} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom sticky commit bar */}
      <div className="sticky bottom-4 mt-4 bg-white border-2 border-indigo-600 rounded-lg p-4 shadow-lg flex items-center justify-between">
        <div className="text-sm text-slate-700">Ready when you are. {Object.values(s).filter(sec => Array.isArray(sec) ? sec.some(x => x.enabled) : sec.enabled).length} sections enabled.</div>
        <button onClick={commitPreviewToDocument} className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4" />Generate Final Document
        </button>
      </div>
    </div>
  );
}

// ============ IN-ROOM DOCUMENT COMPONENT (pre-visit mode) ============
// Renders the pre-visit reference doc for the student. Uses the shared
// buildInRoomHtml() template so the preview is byte-for-byte identical to
// what the export produces. The generated HTML is embedded via iframe so its
// styles, tabs, theme toggle, and interactive elements all work exactly as
// they will in the exported file — no drift, no double-maintenance.
function InRoomDocument({ doc, phase, session, onEdit, onPrint }) {
  const iframeRef = React.useRef(null);
  const [srcDoc, setSrcDoc] = React.useState("");

  // Build the HTML whenever the underlying doc data changes
  React.useEffect(() => {
    if (!doc) return;
    setSrcDoc(buildInRoomHtml(doc, session));
  }, [doc, session]);

  // Export uses the same shared template — guaranteed byte-identical to preview
  // Export the in-room doc as a standalone interactive HTML file. Uses the
  // shared buildInRoomHtml() template so the exported file is guaranteed to
  // match what the attending sees in the preview.
  const exportInRoomAsHtml = () => {
    const html = buildInRoomHtml(doc, session);

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const student = doc.student || "Student";
    const sessionDate = session?.sessionDate || new Date().toISOString().split("T")[0];
    const titleSlug = (doc.sessionTitle || "")
      .replace(/·/g, "-")
      .replace(/[^a-z0-9\s-]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);
    a.download = titleSlug
      ? `previsit-${titleSlug}.html`
      : `previsit-${student.replace(/[^a-z0-9]/gi, "_")}-${sessionDate}.html`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Print handler — sends the iframe (not the whole app) to print so we get
  // the pre-visit doc's own print CSS
  const printDoc = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.focus();
      iframeRef.current.contentWindow.print();
    } else {
      window.print();
    }
  };

  if (!doc) return null;

  return (
    <>
      <style>{`
        /* Iframe wrapper — takes full width, tall enough to feel like a real doc */
        .in-room-iframe-wrap {
          width: 100%;
          height: calc(100vh - 200px);
          min-height: 700px;
          border: 1px solid var(--app-border, #e2e8f0);
          border-radius: 12px;
          overflow: hidden;
          background: #0f1419;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
        }
        .in-room-iframe-wrap iframe {
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
        }
        /* Print — hide everything except the iframe content (the iframe prints itself) */
        @media print {
          .in-room-action-bar { display: none !important; }
          .in-room-iframe-wrap { border: none; height: auto; min-height: 0; }
        }
      `}</style>

      {/* Action bar */}
      <div className="in-room-action-bar no-print flex gap-2 mb-4 items-center flex-wrap">
        <button
          onClick={exportInRoomAsHtml}
          className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
          title="Download a standalone interactive HTML file to give to the student"
        >
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">Export as Interactive HTML</span>
          <span className="sm:hidden">Export HTML</span>
        </button>
        <button
          onClick={printDoc}
          className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
          title="Print or save as PDF"
        >
          <Printer className="w-4 h-4" />
          <span className="hidden sm:inline">Print / Save as PDF</span>
          <span className="sm:hidden">Print / PDF</span>
        </button>
        <button
          onClick={onEdit}
          className="px-3 sm:px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
        >
          <span className="hidden sm:inline">← Back to preview</span>
          <span className="sm:hidden">← Preview</span>
        </button>
        <div className="text-xs text-slate-500 italic ml-2 hidden lg:block">
          This is what the student will see. Use the toggle inside the doc to test dark/light mode.
        </div>
      </div>

      {/* The embedded document — identical to what the export produces */}
      <div className="in-room-iframe-wrap">
        <iframe
          ref={iframeRef}
          srcDoc={srcDoc}
          title="Pre-visit reference sheet"
          sandbox="allow-same-origin allow-scripts allow-popups"
        />
      </div>
    </>
  );
}

// ============ FINAL DOCUMENT COMPONENT ============
function FinalDocument({ doc, phase, session, onPrint, onEdit, onUpdate }) {
  const [savedHtml, setSavedHtml] = React.useState(null);
  const editableRef = React.useRef(null);

  if (!doc) return null;
  const s = doc.sections || {};
  const enabledCases = (s.teachingCases || []).filter(tc => tc.enabled);

  const applyFormat = (cmd) => {
    document.execCommand(cmd, false, null);
    if (editableRef.current) editableRef.current.focus();
  };

  const captureEdits = () => {
    if (editableRef.current) {
      setSavedHtml(editableRef.current.innerHTML);
    }
  };

  const printDoc = () => {
    // Ensure any pending edit is captured before print
    if (editableRef.current) {
      setSavedHtml(editableRef.current.innerHTML);
    }
    setTimeout(() => window.print(), 100);
  };
  // ============ HTML EXPORT ============
  // Serialize the rendered document to a standalone .html file with interactive shelf questions
  // and clickable navigation. Fully offline — no external dependencies.
  const exportAsHtml = () => {
    if (!editableRef.current) return;
    // Capture any in-progress edits into savedHtml before exporting
    setSavedHtml(editableRef.current.innerHTML);

    const docHtml = editableRef.current.innerHTML;
    const student = doc.student || "Student";
    const sessionDate = session.sessionDate || new Date().toISOString().split("T")[0];
    const title = `Teaching Document — ${student} — ${sessionDate}`;

    // Inline stylesheet: design tokens, doc styles, plus interactive-only additions
    const inlineStyles = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap');

      :root {
        --doc-navy: #0F2A44;
        --doc-navy-mid: #1E5B94;
        --doc-paper: #F5F1EA;
        --doc-surface: #FFFFFF;
        --doc-warm-gray: #5C6470;
        --doc-terracotta: #B85C2E;
        --doc-consensus: #0F7A5A;
        --doc-majority: #1E5B94;
        --doc-single: #8B7355;
        --doc-conflict: #B85C2E;
        --doc-hairline: #D8D3CA;
      }

      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; background: var(--doc-paper); }

      .doc-body {
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        font-size: 15px;
        line-height: 1.65;
        color: #1a1a1a;
        background: var(--doc-paper);
        max-width: 900px;
        margin: 0 auto;
        box-shadow: 0 0 40px rgba(0,0,0,0.08);
      }
      .doc-body h1, .doc-body h2, .doc-body h3, .doc-body h4 {
        font-family: 'Inter', system-ui, sans-serif;
        font-weight: 600;
        color: var(--doc-navy);
        line-height: 1.25;
      }
      .doc-serif { font-family: 'Source Serif 4', Georgia, serif; }
      .doc-meta-label {
        font-family: 'Inter', sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-weight: 500;
        font-size: 0.65rem;
        color: var(--doc-warm-gray);
      }
      .doc-cover {
        background: linear-gradient(135deg, #0F2A44 0%, #1a3d5c 50%, #0F2A44 100%);
        color: white;
        padding: 3rem 3rem 2.25rem;
      }
      .doc-cover .cover-eyebrow {
        font-family: 'Inter', sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.24em;
        font-size: 0.68rem;
        font-weight: 500;
        color: rgba(255,255,255,0.7);
        margin-bottom: 0.75rem;
      }
      .doc-cover .cover-title {
        font-family: 'Inter', sans-serif;
        font-weight: 500;
        font-size: 2.25rem;
        line-height: 1.15;
        letter-spacing: -0.02em;
        color: #fff;
      }
      .doc-cover .cover-rule { height: 1px; background: rgba(255,255,255,0.25); margin: 1.75rem 0 1.5rem; }
      .doc-cover .cover-docket { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; }
      .doc-cover .cover-docket .label {
        font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.16em;
        font-size: 0.6rem; font-weight: 500; color: rgba(255,255,255,0.6); margin-bottom: 0.25rem;
      }
      .doc-cover .cover-docket .value {
        font-family: 'Inter', sans-serif; font-size: 0.9rem; font-weight: 500; color: #fff;
      }
      .doc-h2 {
        font-family: 'Inter', sans-serif; font-size: 1.0625rem; font-weight: 600;
        color: var(--doc-navy); letter-spacing: -0.005em; margin: 0 0 1rem;
        padding-bottom: 0.5rem; border-bottom: 2px solid var(--doc-navy);
      }
      .doc-subsection-label {
        font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.11em;
        font-size: 0.88rem; font-weight: 700; color: var(--doc-navy);
        padding: 0.5rem 0 0.5rem 0.75rem; border-left: 3px solid var(--doc-navy-mid);
        margin-bottom: 0.85rem;
        background: linear-gradient(90deg, rgba(30, 91, 148, 0.06) 0%, transparent 60%);
      }
      .doc-case-wrap { margin-top: 3rem; scroll-margin-top: 20px; }
      .doc-case-banner {
        background: linear-gradient(135deg, var(--doc-navy) 0%, #1a3d5c 100%);
        color: white; padding: 1.25rem 1.5rem; margin: 0 -1.5rem 1.75rem;
        border-radius: 2px; box-shadow: 0 1px 3px rgba(15, 42, 68, 0.15);
      }
      .doc-case-banner .doc-case-numeral {
        font-family: 'Inter', sans-serif; font-weight: 600; font-size: 0.65rem;
        letter-spacing: 0.28em; color: rgba(255, 255, 255, 0.7);
        text-transform: uppercase; margin-bottom: 0.35rem;
      }
      .doc-case-banner .doc-case-title {
        font-family: 'Inter', sans-serif; font-weight: 600; font-size: 1.5rem;
        line-height: 1.2; color: white; letter-spacing: -0.015em; margin: 0;
      }
      .doc-table {
        width: 100%; border-collapse: collapse; font-size: 0.875rem;
        border-top: 2px solid var(--doc-navy); border-bottom: 2px solid var(--doc-navy);
      }
      .doc-table thead th {
        font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.12em;
        font-size: 0.62rem; font-weight: 600; color: var(--doc-warm-gray); text-align: left;
        padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--doc-navy); background: transparent;
      }
      .doc-table tbody td {
        padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--doc-hairline);
        vertical-align: top; color: #1a1a1a;
      }
      .doc-table tbody tr:last-child td { border-bottom: none; }
      .doc-table .row-label { font-weight: 500; color: var(--doc-navy); width: 30%; padding-right: 1rem; }
      .doc-callout-pearl {
        background: linear-gradient(90deg, rgba(184, 92, 46, 0.09) 0%, rgba(184, 92, 46, 0.03) 100%);
        border-left: 3px solid var(--doc-terracotta); padding: 1rem 1.25rem; margin: 1.25rem 0;
      }
      .doc-callout-pearl .label {
        font-family: 'Inter', sans-serif; font-size: 0.7rem; color: var(--doc-terracotta);
        text-transform: uppercase; letter-spacing: 0.16em; font-weight: 700; margin-bottom: 0.4rem;
      }
      .doc-callout-quote {
        background: linear-gradient(90deg, rgba(30, 91, 148, 0.09) 0%, rgba(30, 91, 148, 0.03) 100%);
        border-left: 3px solid var(--doc-navy); padding: 1rem 1.25rem 1rem 2.5rem;
        margin: 1.25rem 0; position: relative;
      }
      .doc-callout-quote::before {
        content: '"'; position: absolute; left: 0.75rem; top: 0.35rem;
        font-family: 'Source Serif 4', serif; font-size: 2.75rem; font-weight: 400;
        color: var(--doc-navy); line-height: 1; opacity: 0.5;
      }
      .doc-callout-quote .quote-text {
        font-family: 'Source Serif 4', serif; font-style: italic;
        font-size: 0.95rem; line-height: 1.55; color: #1a1a1a;
      }
      .doc-callout-quote .label {
        font-family: 'Inter', sans-serif; font-size: 0.7rem; color: var(--doc-navy);
        text-transform: uppercase; letter-spacing: 0.16em; font-weight: 700; margin-bottom: 0.4rem;
      }
      .doc-callout-goal {
        background: linear-gradient(180deg, var(--doc-paper) 0%, #fff 100%);
        border-left: 3px solid var(--doc-navy-mid); padding: 1rem 1.25rem;
      }
      .doc-strength {
        display: inline-flex; align-items: center; gap: 0.4rem;
        font-family: 'Inter', sans-serif; font-size: 0.65rem; text-transform: uppercase;
        letter-spacing: 0.12em; font-weight: 600; color: var(--doc-warm-gray);
      }
      .doc-strength .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .doc-strength.consensus .dot { background: var(--doc-consensus); }
      .doc-strength.majority .dot { background: var(--doc-majority); }
      .doc-strength.single-source .dot { background: var(--doc-single); }
      .doc-strength.conflict .dot { background: var(--doc-conflict); }
      .doc-strength.consensus { color: var(--doc-consensus); }
      .doc-strength.majority { color: var(--doc-majority); }
      .doc-strength.single-source { color: var(--doc-single); }
      .doc-strength.conflict { color: var(--doc-conflict); }
      .doc-shelf-q { border-top: 1px solid var(--doc-hairline); padding: 1rem 0; scroll-margin-top: 20px; }
      .doc-shelf-q:first-child { border-top: none; padding-top: 0.25rem; }
      .doc-shelf-answer {
        margin-top: 0.75rem; padding: 0.75rem 1rem; background: var(--doc-paper);
        border-left: 2px solid var(--doc-consensus);
      }
      .doc-shelf-answer .label {
        font-family: 'Inter', sans-serif; font-size: 0.65rem; text-transform: uppercase;
        letter-spacing: 0.14em; font-weight: 600; color: var(--doc-consensus); margin-bottom: 0.3rem;
      }
      .doc-footer {
        margin-top: 3rem; padding-top: 1.25rem; border-top: 2px solid var(--doc-navy);
        text-align: center; font-family: 'Inter', sans-serif; font-size: 0.7rem;
        color: var(--doc-warm-gray); letter-spacing: 0.02em;
      }

      /* Interactive-only additions */
      .interactive-banner {
        background: linear-gradient(90deg, #eef2ff 0%, #fefce8 100%);
        border-bottom: 1px solid #e0e7ff;
        padding: 0.75rem 1.25rem;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-family: 'Inter', sans-serif;
        font-size: 0.78rem;
        color: #4338ca;
      }
      .interactive-banner strong { color: #312e81; }

      /* Make "Problems in focus" list items look clickable and add anchor behavior */
      .doc-body td ul li a.problem-jump {
        color: var(--doc-navy-mid);
        text-decoration: none;
        border-bottom: 1px dotted var(--doc-navy-mid);
        cursor: pointer;
        transition: color 0.15s;
      }
      .doc-body td ul li a.problem-jump:hover {
        color: var(--doc-terracotta);
        border-bottom-color: var(--doc-terracotta);
      }
      .doc-body td ul li a.problem-jump::before {
        content: "↓ ";
        opacity: 0.5;
      }

      /* Interactive shelf question styles */
      .shelf-choices-interactive {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.5rem;
        padding-left: 2.2rem;
        margin-bottom: 0.5rem;
      }
      @media (min-width: 640px) {
        .shelf-choices-interactive {
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          column-gap: 1.5rem;
        }
      }
      .shelf-option-btn {
        text-align: left;
        padding: 0.6rem 0.85rem;
        background: white;
        border: 1.5px solid var(--doc-hairline);
        border-radius: 6px;
        font-family: 'Inter', sans-serif;
        font-size: 0.87rem;
        color: #1a1a1a;
        cursor: pointer;
        transition: all 0.15s;
        line-height: 1.45;
      }
      .shelf-option-btn:hover:not(:disabled) {
        border-color: var(--doc-navy-mid);
        background: #f8fafc;
      }
      .shelf-option-btn:disabled { cursor: default; }
      .shelf-option-btn .letter { font-weight: 600; margin-right: 0.4rem; }
      .shelf-option-btn.chosen-correct {
        background: #ecfdf5;
        border-color: var(--doc-consensus);
        color: #064e3b;
        font-weight: 500;
      }
      .shelf-option-btn.chosen-wrong {
        background: #fef2f2;
        border-color: #dc2626;
        color: #7f1d1d;
        font-weight: 500;
      }
      .shelf-option-btn.revealed-correct {
        background: #ecfdf5;
        border-color: var(--doc-consensus);
        color: #064e3b;
      }
      .shelf-option-btn.revealed-wrong {
        background: #fafafa;
        border-color: var(--doc-hairline);
        color: #737373;
        text-decoration: line-through;
      }
      .shelf-option-btn .indicator {
        display: none;
        font-size: 0.75rem;
        margin-left: 0.5rem;
        font-weight: 600;
      }
      .shelf-option-btn.chosen-correct .indicator,
      .shelf-option-btn.revealed-correct .indicator { display: inline; color: var(--doc-consensus); }
      .shelf-option-btn.chosen-wrong .indicator { display: inline; color: #dc2626; }

      .shelf-answer-interactive {
        margin-top: 0.75rem;
        margin-left: 2.2rem;
        padding: 0.75rem 1rem;
        background: var(--doc-paper);
        border-left: 2px solid var(--doc-consensus);
        opacity: 0;
        max-height: 0;
        overflow: hidden;
        transition: opacity 0.3s, max-height 0.3s;
      }
      .shelf-answer-interactive.revealed {
        opacity: 1;
        max-height: 1000px;
      }
      .shelf-answer-interactive .label {
        font-family: 'Inter', sans-serif;
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-weight: 600;
        color: var(--doc-consensus);
        margin-bottom: 0.3rem;
      }
      .shelf-reset-btn {
        display: inline-block;
        margin-top: 0.5rem;
        margin-left: 2.2rem;
        padding: 0.25rem 0.6rem;
        background: transparent;
        border: 1px solid var(--doc-hairline);
        border-radius: 4px;
        font-family: 'Inter', sans-serif;
        font-size: 0.7rem;
        color: var(--doc-warm-gray);
        cursor: pointer;
      }
      .shelf-reset-btn:hover { background: white; color: var(--doc-navy); border-color: var(--doc-navy-mid); }
      .shelf-reset-btn.hidden { display: none; }

      /* Sticky case-nav pill at the top of teaching cases */
      .case-nav-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--doc-paper);
        border-radius: 8px;
        margin-bottom: 1.5rem;
        border: 1px solid var(--doc-hairline);
      }
      .case-nav-pills .nav-label {
        font-family: 'Inter', sans-serif;
        text-transform: uppercase;
        letter-spacing: 0.11em;
        font-size: 0.62rem;
        font-weight: 600;
        color: var(--doc-warm-gray);
        align-self: center;
        margin-right: 0.5rem;
      }
      .case-nav-pills a.case-jump {
        display: inline-block;
        padding: 0.35rem 0.75rem;
        background: white;
        border: 1px solid var(--doc-hairline);
        border-radius: 999px;
        font-family: 'Inter', sans-serif;
        font-size: 0.78rem;
        font-weight: 500;
        color: var(--doc-navy);
        text-decoration: none;
        transition: all 0.15s;
      }
      .case-nav-pills a.case-jump:hover {
        background: var(--doc-navy);
        color: white;
        border-color: var(--doc-navy);
      }

      /* Print — restore printed doc feel from the HTML */
      @media print {
        body { background: white; }
        .doc-body { max-width: none; box-shadow: none; margin: 0; }
        .interactive-banner, .case-nav-pills, .shelf-reset-btn { display: none !important; }
        .shelf-answer-interactive { opacity: 1 !important; max-height: none !important; }
        .shelf-option-btn { border-color: var(--doc-hairline) !important; }
        .shelf-option-btn.correct-print { background: #ecfdf5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-cover { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-callout-pearl, .doc-callout-quote, .doc-callout-goal, .doc-shelf-answer {
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        p, li, div { orphans: 3; widows: 3; }
        h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
        .keep-together { page-break-inside: avoid; }
        .doc-cover { page-break-after: always; }
      }
      @page { margin: 0.55in; }
    `;

    // Process the DOM: give cases IDs, make problems clickable, transform shelf questions.
    // We do this on a temporary document so we don't mess with the live editable.
    const parser = new DOMParser();
    const tempDoc = parser.parseFromString(`<div>${docHtml}</div>`, "text/html");
    const root = tempDoc.body.firstChild;

    // 1. Assign IDs to case sections and build case-nav pill data
    const caseSections = root.querySelectorAll(".doc-case-wrap");
    const caseNav = [];
    caseSections.forEach((section, idx) => {
      const id = `case-${idx + 1}`;
      section.id = id;
      const title = section.querySelector(".doc-case-title")?.textContent?.trim() || `Case ${idx + 1}`;
      caseNav.push({ id, title });
    });

    // 2. Make "Problems in focus" list items clickable if we have cases
    if (caseNav.length > 0) {
      const problemRows = root.querySelectorAll("td");
      problemRows.forEach(td => {
        const ul = td.querySelector("ul");
        if (!ul) return;
        // Check if this is the "problems in focus" list (heuristic: preceded by row-label containing "focus")
        const row = td.closest("tr");
        const label = row?.querySelector(".row-label")?.textContent?.toLowerCase() || "";
        if (!label.includes("focus")) return;
        ul.querySelectorAll("li").forEach(li => {
          const text = li.textContent.trim();
          // Match this problem to a case title (fuzzy: any case whose title contains the problem text or vice versa)
          const match = caseNav.find(c =>
            c.title.toLowerCase().includes(text.toLowerCase()) ||
            text.toLowerCase().includes(c.title.toLowerCase())
          );
          if (match) {
            li.innerHTML = `<a class="problem-jump" href="#${match.id}">${text}</a>`;
          }
        });
      });
    }

    // 3. Insert case-nav pill list at the top of the first case
    if (caseNav.length > 1 && caseSections[0]) {
      const nav = tempDoc.createElement("div");
      nav.className = "case-nav-pills";
      nav.innerHTML = `<span class="nav-label">Jump to case</span>` +
        caseNav.map(c => `<a class="case-jump" href="#${c.id}">${c.title}</a>`).join("");
      caseSections[0].parentNode.insertBefore(nav, caseSections[0]);
    }

    // 4. Transform shelf questions into interactive versions
    const shelfQs = root.querySelectorAll(".doc-shelf-q");
    shelfQs.forEach((qDiv, qIdx) => {
      // Find the options grid and the answer block
      const optionsGrid = qDiv.querySelector('div[style*="grid-template-columns"]');
      const answerBlock = qDiv.querySelector(".doc-shelf-answer");
      if (!optionsGrid || !answerBlock) return;

      // Extract correct answer letter from the answer block label ("Answer · A")
      const labelText = answerBlock.querySelector(".label")?.textContent || "";
      const correctMatch = labelText.match(/Answer\s*·?\s*([A-E])/i);
      if (!correctMatch) return;
      const correctLetter = correctMatch[1].toUpperCase();

      // Build interactive replacement
      const qId = `q-${qIdx}`;
      const optionDivs = Array.from(optionsGrid.children);
      const options = optionDivs.map(div => {
        // Each option div contains: <span letter>A)</span>OptionText
        const html = div.innerHTML;
        // Extract letter and body
        const letterMatch = html.match(/<span[^>]*>([A-E])\)<\/span>(.*)/is);
        if (!letterMatch) return null;
        return { letter: letterMatch[1].toUpperCase(), body: letterMatch[2].trim() };
      }).filter(Boolean);

      // Replace options grid with interactive buttons
      const interactive = tempDoc.createElement("div");
      interactive.className = "shelf-choices-interactive";
      interactive.dataset.qid = qId;
      interactive.dataset.correct = correctLetter;
      interactive.innerHTML = options.map(opt => `
        <button type="button" class="shelf-option-btn" data-qid="${qId}" data-letter="${opt.letter}" data-correct-letter="${correctLetter}">
          <span class="letter">${opt.letter})</span>${opt.body}<span class="indicator"></span>
        </button>
      `).join("");
      optionsGrid.parentNode.replaceChild(interactive, optionsGrid);

      // Wrap answer block as revealed-on-click
      const wrappedAnswer = tempDoc.createElement("div");
      wrappedAnswer.className = "shelf-answer-interactive";
      wrappedAnswer.id = `answer-${qId}`;
      wrappedAnswer.innerHTML = answerBlock.innerHTML;
      answerBlock.parentNode.replaceChild(wrappedAnswer, answerBlock);

      // Add reset button
      const resetBtn = tempDoc.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "shelf-reset-btn hidden";
      resetBtn.id = `reset-${qId}`;
      resetBtn.textContent = "↺ Try again";
      resetBtn.dataset.qid = qId;
      wrappedAnswer.parentNode.insertBefore(resetBtn, wrappedAnswer.nextSibling);
    });

    // 5. Interactive script injected inline
    const script = `
      document.addEventListener("click", function(e) {
        // Shelf question option clicks
        if (e.target.closest(".shelf-option-btn") && !e.target.closest(".shelf-option-btn").disabled) {
          const btn = e.target.closest(".shelf-option-btn");
          const qid = btn.dataset.qid;
          const chosen = btn.dataset.letter;
          const correct = btn.dataset.correctLetter;
          const isCorrect = chosen === correct;

          // Disable all options in this question, mark states
          const allBtns = document.querySelectorAll(\`.shelf-option-btn[data-qid="\${qid}"]\`);
          allBtns.forEach(b => {
            b.disabled = true;
            const bLetter = b.dataset.letter;
            const indicator = b.querySelector(".indicator");
            if (b === btn) {
              b.classList.add(isCorrect ? "chosen-correct" : "chosen-wrong");
              indicator.textContent = isCorrect ? "✓ Your answer" : "✗ Your answer";
            } else if (bLetter === correct) {
              b.classList.add("revealed-correct", "correct-print");
              indicator.textContent = "✓ Correct";
            } else {
              b.classList.add("revealed-wrong");
            }
          });

          // Reveal answer explanation
          const answer = document.getElementById(\`answer-\${qid}\`);
          if (answer) answer.classList.add("revealed");
          const reset = document.getElementById(\`reset-\${qid}\`);
          if (reset) reset.classList.remove("hidden");
        }

        // Reset button
        if (e.target.classList && e.target.classList.contains("shelf-reset-btn")) {
          const qid = e.target.dataset.qid;
          const allBtns = document.querySelectorAll(\`.shelf-option-btn[data-qid="\${qid}"]\`);
          allBtns.forEach(b => {
            b.disabled = false;
            b.classList.remove("chosen-correct", "chosen-wrong", "revealed-correct", "revealed-wrong", "correct-print");
            const indicator = b.querySelector(".indicator");
            if (indicator) indicator.textContent = "";
          });
          const answer = document.getElementById(\`answer-\${qid}\`);
          if (answer) answer.classList.remove("revealed");
          e.target.classList.add("hidden");
        }
      });

      // Smooth scroll for anchor links (case-jump, problem-jump)
      document.addEventListener("click", function(e) {
        const link = e.target.closest("a[href^='#']");
        if (!link) return;
        const targetId = link.getAttribute("href").slice(1);
        const target = document.getElementById(targetId);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    `;

    // Assemble the full HTML file
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title.replace(/</g, "&lt;")}</title>
  <style>${inlineStyles}</style>
</head>
<body>
  <div class="interactive-banner">
    <span>🎓</span>
    <div>
      <strong>Interactive teaching document.</strong> Click any answer choice on practice questions to see if you got it right. Click problem names in "Case at a Glance" to jump to that case.
    </div>
  </div>
  ${root.innerHTML}
  <script>${script}<\/script>
  <!--
    LIC Teaching Document Generator
    Session ID: ${doc.sessionId || "unsaved"}
    Session title: ${doc.sessionTitle || "(untitled)"}
    Generated: ${doc.generatedIso || ""}
    Reopen in app: ${doc.appOrigin || ""}?session=${doc.sessionId || ""}
  -->
</body>
</html>`;

    // Trigger download
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Use the session title (sanitized) if we have one, otherwise fall back to student+date
    const titleSlug = (doc.sessionTitle || "")
      .replace(/·/g, "-")
      .replace(/[^a-z0-9\s-]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);
    const filename = titleSlug
      ? `teaching-${titleSlug}.html`
      : `teaching-document-${student.replace(/[^a-z0-9]/gi, "_")}-${sessionDate}.html`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Strips leading action verbs like "Continue", "Start", "Initiate", "Add",
// "Consider" that the AI sometimes prepends to medication names when framing
// treatment as ongoing management. Preserves the actual drug name.
const renderContent = () => {
    return <DocumentContent doc={doc} phase={phase} session={session} />;
  };

  // ============================================================================
// SHARED IN-ROOM DOCUMENT TEMPLATE
// ============================================================================
// Produces a complete standalone HTML document (CSS + body + JS) driven by
// the app's data model. Used by BOTH:
//   1. exportInRoomAsHtml() — writes to a .html file the attending downloads
//   2. InRoomDocument React component — embeds via iframe/dangerouslySetInnerHTML
//      for the in-app preview
// This guarantees the preview and export can never drift apart.
//
// Input: doc object containing everything the template needs
//   - doc.sessionTitle, doc.student, doc.phase, doc.selectedProblems
//   - doc.noteAnalysis (oneLiner, patientDescriptor, patientBadges, scPercentages,
//     activeProblems with category/status/shortSubtitle, labTrendsSummary,
//     diagnosticsSummary, visitPlan, perProblemRedFlags)
//   - doc.sections.teachingCases (with new suggestedQuestions + dontMiss fields)
//   - doc.medDescriptions, doc.lightweightTeaching, doc.rawPrenote
// ============================================================================
const buildInRoomHtml = (doc, session) => {
  if (!doc) return "<div>No document data</div>";

  const s = doc.sections || {};
  const na = doc.noteAnalysis || {};
  const enabledCases = (s.teachingCases || []).filter(tc => tc.enabled);
  const sessionDate = session?.sessionDate || new Date().toISOString().split("T")[0];
  const student = doc.student || "Student";
  const sessionId = doc.sessionId || "no-id";
  const title = doc.sessionTitle || `Pre-visit — ${student} — ${sessionDate}`;

  // Escape HTML for safe string interpolation
  const esc = (str) => String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  // Parse prenote sections (verbatim data source for labs, vitals, etc.)
  const prenoteSections = extractPrenoteSections(doc.rawPrenote || doc.clinicalNote || "");
  const getSec = (...names) => getSection(prenoteSections, ...names);

  const vitalsText = getSec("VITAL SIGNS TRENDS", "VITALS");
  const labsText = getSec("LABORATORY STUDIES", "LABS", "LABORATORY RESULTS");
  const imagingText = getSec("IMAGING AND DIAGNOSTIC PROCEDURES", "IMAGING", "DIAGNOSTIC PROCEDURES");
  const socialText = getSec("SOCIAL", "SOCIAL HISTORY");
  const familyText = getSec("FAMILY HISTORY");
  const surgicalText = getSec("SURGICAL HISTORY");
  const allergiesText = getSec("ALLERGIES");
  const militaryText = getSec("MILITARY HISTORY");
  const preventiveText = getSec("PREVENTIVE MEDICINE", "PREVENTION");
  const updatesText = getSec("UPDATES / RECENT VISITS", "UPDATES");
  const pmhText = getSec("PAST MEDICAL HISTORY", "PMH");
  const medRecText = getSec("MED REC", "MEDICATIONS", "MEDICATION LIST");

  const currentMedsText = extractCurrentMedsSubsection(medRecText);
  const discontinuedMedsText = extractMedSubsection(medRecText, /RECENTLY\s+DISCONTINUED/, [/SIGNIFICANT\s+HISTORICAL/, /HISTORICAL\s+MEDICATIONS?/]);
  const historicalMedsText = extractMedSubsection(medRecText, /(?:SIGNIFICANT\s+HISTORICAL|HISTORICAL\s+MEDICATIONS?)/, []);
  const currentMedNames = parseMedNames(currentMedsText);
  const medDesc = doc.medDescriptions || {};

  const problemBlocks = parseProblemBlocks(pmhText || "");

  // Fuzzy match a case problem to a PMH block
  const findBlockFor = (problemName) => {
    if (!problemName) return null;
    const target = problemName.toLowerCase().trim();
    if (problemBlocks[target]) return problemBlocks[target];
    for (const [k, v] of Object.entries(problemBlocks)) {
      if (k.includes(target) || target.includes(k)) return v;
      const cleanK = k.replace(/\([^)]*\)/g, "").replace(/\b(untreated|stable|chronic|active|history|of)\b/gi, "").trim();
      const cleanT = target.replace(/\([^)]*\)/g, "").replace(/\b(untreated|stable|chronic|active|history|of)\b/gi, "").trim();
      if (cleanK && cleanT && (cleanK.includes(cleanT) || cleanT.includes(cleanK))) return v;
    }
    return null;
  };

  // Category → icon class + FontAwesome icon
  const categoryIcon = {
    mental: { cls: "mental", icon: "fa-brain" },
    skin: { cls: "skin", icon: "fa-hand" },
    gi: { cls: "gi", icon: "fa-stomach" },
    pain: { cls: "pain", icon: "fa-bone" },
    ent: { cls: "ent", icon: "fa-tooth" },
    neuro: { cls: "neuro", icon: "fa-head-side-virus" },
    social: { cls: "social", icon: "fa-users" },
    lab: { cls: "lab", icon: "fa-flask-vial" },
    cardiac: { cls: "pain", icon: "fa-heart-pulse" },
    pulm: { cls: "neuro", icon: "fa-lungs" },
    endocrine: { cls: "ent", icon: "fa-droplet" },
    renal: { cls: "gi", icon: "fa-filter" },
    vascular: { cls: "pain", icon: "fa-heart-pulse" },
    other: { cls: "social", icon: "fa-notes-medical" },
  };

  // Status → badge class + label
  const statusBadge = {
    active: { cls: "sp-active", label: "Active" },
    stable: { cls: "sp-stable", label: "Stable" },
    remission: { cls: "sp-stable", label: "In Remission" },
    resolved: { cls: "sp-resolved", label: "Resolved" },
    registry: { cls: "sp-reg", label: "Registry Only" },
    controlled: { cls: "sp-stable", label: "Controlled" },
  };

  const badgeTypeCls = {
    info: "badge-v",
    warning: "badge-sc",
    alert: "badge-a",
  };

  // ─────────────────────────────────────────────────────────────
  // Formatter for prenote text blocks (bullets, key:value, paragraphs)
  // ─────────────────────────────────────────────────────────────
  const fmtHtml = (text, opts = {}) => {
    if (!text) return "";
    let working = text.trim();
    if (opts.stripHeader) {
      const lines = working.split(/\r?\n/);
      const first = lines.find(l => l.trim());
      if (first) {
        const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
        const nf = norm(first);
        const nt = norm(opts.stripHeader);
        if ((nf.includes(nt) && nf.length < nt.length * 2.5) || (nt.includes(nf) && nf.length > 5)) {
          working = lines.slice(lines.indexOf(first) + 1).join("\n").trim();
        }
      }
    }
    if (opts.dropTables) {
      const lines = working.split(/\r?\n/);
      const kept = [];
      let skip = false;
      for (const line of lines) {
        const pipes = (line.match(/\|/g) || []).length;
        if (pipes >= 3) { skip = true; while (kept.length && /labs?:?$/i.test(kept[kept.length-1].trim())) kept.pop(); continue; }
        if (skip && pipes === 0) skip = false;
        kept.push(line);
      }
      working = kept.join("\n");
    }
    if (!working.trim()) return "";

    const items = working.split(/\r?\n/).map(l => {
      const t = l.trim();
      if (!t) return { type: "blank" };
      const bullet = t.match(/^[\-\*•●○▪▫►◆·]\s+(.+)$/);
      if (bullet) return { type: "bullet", content: bullet[1] };
      const kv = t.match(/^([A-Z][A-Za-z0-9\s\/\-\(\)]{2,34}):\s+(.+)$/);
      if (kv) return { type: "kv", key: kv[1].trim(), value: kv[2].trim() };
      return { type: "plain", content: t };
    });

    const groups = [];
    let cur = null;
    for (const it of items) {
      if (it.type === "blank") { if (cur) { groups.push(cur); cur = null; } continue; }
      if (!cur) cur = { type: it.type, items: [it] };
      else if (cur.type === it.type || (cur.type !== "plain" && it.type !== "plain")) {
        cur.items.push(it);
        if (cur.type !== it.type) cur.type = "mixed";
      } else { groups.push(cur); cur = { type: it.type, items: [it] }; }
    }
    if (cur) groups.push(cur);

    let html = `<div class="fmt-block">`;
    for (const g of groups) {
      if (g.type === "plain") {
        html += g.items.map(it => `<p>${esc(it.content)}</p>`).join("");
      } else {
        html += `<ul>`;
        for (const it of g.items) {
          if (it.type === "kv") html += `<li><strong>${esc(it.key)}:</strong> ${esc(it.value)}</li>`;
          else html += `<li>${esc(it.content)}</li>`;
        }
        html += `</ul>`;
      }
    }
    html += `</div>`;
    return html;
  };

  const verbatim = (text) => text ? `<pre class="verbatim">${esc(text)}</pre>` : "";
  const infoBox = (title, content) => content ? `<div class="info-box"><div class="info-box-title">${esc(title)}</div>${content}</div>` : "";

  // ─────────────────────────────────────────────────────────────
  // BUILD HEADER
  // ─────────────────────────────────────────────────────────────
  let headerHtml = `<div class="patient-header">`;
  headerHtml += `<div class="header-top"><div>`;
  headerHtml += `<div class="patient-name">${esc(title)}`;
  if (na.patientDescriptor) headerHtml += ` <span>${esc(na.patientDescriptor)}</span>`;
  headerHtml += `</div>`;

  if (Array.isArray(na.patientBadges) && na.patientBadges.length > 0) {
    headerHtml += `<div class="badge-row">`;
    na.patientBadges.forEach(b => {
      const cls = badgeTypeCls[b.type] || "badge-v";
      headerHtml += `<span class="badge ${cls}">${esc(b.text)}</span>`;
    });
    headerHtml += `</div>`;
  }

  if (Array.isArray(na.scPercentages) && na.scPercentages.length > 0) {
    headerHtml += `<div class="sc-row">`;
    na.scPercentages.forEach(sc => {
      headerHtml += `<span class="sc-c">${esc(sc.condition)} ${esc(sc.percent)}%</span>`;
    });
    headerHtml += `</div>`;
  }

  headerHtml += `</div></div>`;
  headerHtml += `<div class="hgrid">`;
  headerHtml += `<div class="hs"><span class="hs-l">Session Date</span><span class="hs-v">${esc(sessionDate)}</span></div>`;
  if (doc.phase?.monthsIn !== undefined) headerHtml += `<div class="hs"><span class="hs-l">LIC Month</span><span class="hs-v">Month ${esc(doc.phase.monthsIn)}</span></div>`;
  if (doc.phase?.name) headerHtml += `<div class="hs"><span class="hs-l">Phase</span><span class="hs-v">${esc(doc.phase.name)}</span></div>`;
  if (student) headerHtml += `<div class="hs"><span class="hs-l">Student</span><span class="hs-v">${esc(student)}</span></div>`;
  headerHtml += `</div></div>`;

  // ─────────────────────────────────────────────────────────────
  // ONE-LINER
  // ─────────────────────────────────────────────────────────────
  const oneLinerHtml = na.oneLiner
    ? `<div class="oneliner">${esc(na.oneLiner)}</div>`
    : "";

  // ─────────────────────────────────────────────────────────────
  // QUICK REFERENCE PANELS
  // ─────────────────────────────────────────────────────────────
  let qrHtml = `<div class="qr-grid">`;

  // PMH list
  qrHtml += `<div class="qr-panel"><div class="qr-head"><i class="fa-solid fa-list-check"></i> Past Medical History</div><div class="qr-body"><ul class="pmh-list">`;
  const problemsForPMH = na.activeProblems?.length ? na.activeProblems : Object.values(problemBlocks).map(b => ({ problem: b.rawHeader, status: "active" }));
  problemsForPMH.forEach(p => {
    const dot = p.status === "resolved" ? "resolved" : "active";
    const scTag = p.scPercent ? `<span class="sc-tag">${esc(p.scPercent)}% SC</span>` : "";
    qrHtml += `<li><span class="pmh-dot ${dot}"></span>${esc(p.problem)}${scTag}</li>`;
  });
  qrHtml += `</ul></div></div>`;

  // Clinical Reference Data
  qrHtml += `<div class="qr-panel"><div class="qr-head"><i class="fa-solid fa-database"></i> Clinical Reference Data</div><div class="qr-body">`;
  if (surgicalText) qrHtml += `<div class="ref-item"><div class="ref-label"><i class="fa-solid fa-scalpel"></i> Surgical History</div><div class="ref-text">${esc(surgicalText.slice(0, 400))}</div></div>`;
  if (allergiesText) qrHtml += `<div class="ref-item"><div class="ref-label"><i class="fa-solid fa-shield-virus"></i> Allergies</div><div class="ref-text">${esc(allergiesText.slice(0, 200))}</div></div>`;
  if (familyText) qrHtml += `<div class="ref-item"><div class="ref-label"><i class="fa-solid fa-people-roof"></i> Family History</div><div class="ref-text">${esc(familyText.slice(0, 400))}</div></div>`;
  if (na.diagnosticsSummary) qrHtml += `<div class="ref-item"><div class="ref-label"><i class="fa-solid fa-microscope"></i> Diagnostics</div><div class="ref-text">${esc(na.diagnosticsSummary)}</div></div>`;
  if (na.labTrendsSummary) qrHtml += `<div class="ref-item"><div class="ref-label"><i class="fa-solid fa-chart-line"></i> Lab Trends</div><div class="ref-text">${esc(na.labTrendsSummary)}</div></div>`;
  qrHtml += `</div></div></div>`;

  // ─────────────────────────────────────────────────────────────
  // VITALS CARD
  // ─────────────────────────────────────────────────────────────
  let vitalsHtml = "";
  if (vitalsText) {
    // Try to parse individual vital values with simple regex
    const vitals = [];
    const bpMatch = vitalsText.match(/BP[:\s]+(\d{2,3}\/\d{2,3})/i);
    if (bpMatch) vitals.push({ l: "BP", v: bpMatch[1] });
    const hrMatch = vitalsText.match(/HR[:\s]+(\d{2,3})/i) || vitalsText.match(/Pulse[:\s]+(\d{2,3})/i);
    if (hrMatch) vitals.push({ l: "HR", v: hrMatch[1] });
    const tempMatch = vitalsText.match(/Temp[:\s]+([\d.]+\s*°?[FC]?)/i);
    if (tempMatch) vitals.push({ l: "Temp", v: tempMatch[1] });
    const spo2Match = vitalsText.match(/S[pP]O2[:\s]+(\d{1,3}%?)/i);
    if (spo2Match) vitals.push({ l: "SpO2", v: spo2Match[1] });
    const wtMatch = vitalsText.match(/W[Tt][:\s]+([\d.]+\s*(?:lb|kg))/i);
    if (wtMatch) vitals.push({ l: "Weight", v: wtMatch[1] });
    const bmiMatch = vitalsText.match(/BMI[:\s]+([\d.]+)/i);
    if (bmiMatch) vitals.push({ l: "BMI", v: bmiMatch[1] });

    vitalsHtml += `<div class="card open" style="margin-bottom:16px"><div class="ch" onclick="toggleCard(this)">`;
    vitalsHtml += `<div class="ch-l"><div class="ci lab"><i class="fa-solid fa-heart-pulse"></i></div><div><div class="ct">Vital Signs</div><div class="cs">From chart</div></div></div>`;
    vitalsHtml += `<div class="ch-r"><i class="fa-solid fa-chevron-down chev"></i></div></div>`;
    vitalsHtml += `<div class="cb"><div class="cbi">`;
    if (vitals.length > 0) {
      vitalsHtml += `<div class="vr">`;
      vitals.forEach(v => vitalsHtml += `<div class="vc"><div class="vc-l">${esc(v.l)}</div><div class="vc-v">${esc(v.v)}</div></div>`);
      vitalsHtml += `</div>`;
    } else {
      vitalsHtml += verbatim(vitalsText);
    }
    vitalsHtml += `</div></div></div>`;
  }

  // ─────────────────────────────────────────────────────────────
  // NAV TABS
  // ─────────────────────────────────────────────────────────────
  const navHtml = `<div class="nav-tabs" role="tablist">
  <button class="nav-tab active" onclick="switchTab('problems',this)"><i class="fa-solid fa-stethoscope"></i> Problems</button>
  <button class="nav-tab" onclick="switchTab('meds',this)"><i class="fa-solid fa-pills"></i> Meds</button>
  <button class="nav-tab" onclick="switchTab('labs',this)"><i class="fa-solid fa-flask"></i> Labs</button>
  <button class="nav-tab" onclick="switchTab('social',this)"><i class="fa-solid fa-users"></i> Social</button>
  <button class="nav-tab" onclick="switchTab('timeline',this)"><i class="fa-solid fa-clock-rotate-left"></i> Timeline</button>
  <button class="nav-tab" onclick="switchTab('preventive',this)"><i class="fa-solid fa-shield-heart"></i> Preventive</button>
  <button class="nav-tab" onclick="switchTab('checklist',this)"><i class="fa-solid fa-clipboard-check"></i> Visit Plan</button>
  <button class="nav-tab" onclick="switchTab('practice',this)"><i class="fa-solid fa-lightbulb"></i> Practice Q's</button>
</div>`;

  // ─────────────────────────────────────────────────────────────
  // PROBLEMS TAB — one card per selected teaching case + non-selected
  // ─────────────────────────────────────────────────────────────
  let problemsTab = `<div id="tab-problems" class="section active">`;
  problemsTab += `<div class="sec-row"><div class="sec-title">Active Problems — Full Detail &amp; Teaching</div><button class="toggle-all" onclick="toggleAll('tab-problems')">Expand All</button></div>`;

  const buildProblemCard = (tc, idx, isSelected) => {
    const c = tc.data || tc;
    const problemName = c.problem || c.rawHeader || "Problem";
    // Find category/status from noteAnalysis.activeProblems if not on the case itself
    const apMatch = (na.activeProblems || []).find(ap => ap.problem?.toLowerCase().trim() === problemName.toLowerCase().trim());
    const category = c.category || apMatch?.category || "other";
    const status = c.status || apMatch?.status || (isSelected ? "active" : "stable");
    const shortSub = c.shortSubtitle || apMatch?.shortSubtitle || c.primaryDiagnosis?.name || "";
    const icon = categoryIcon[category] || categoryIcon.other;
    const badge = statusBadge[status] || statusBadge.active;
    const chartBlock = findBlockFor(problemName) || findBlockFor(c.primaryDiagnosis?.name);
    const perProbRedFlags = na.perProblemRedFlags?.[problemName] || [];

    let html = `<div class="card${idx === 0 ? " open" : ""}"><div class="ch" onclick="toggleCard(this)">`;
    html += `<div class="ch-l"><div class="ci ${icon.cls}"><i class="fa-solid ${icon.icon}"></i></div>`;
    html += `<div><div class="ct">${esc(problemName)}</div>`;
    if (shortSub) html += `<div class="cs">${esc(shortSub)}</div>`;
    html += `</div></div><div class="ch-r"><span class="sp ${badge.cls}">${esc(badge.label)}</span><i class="fa-solid fa-chevron-down chev"></i></div></div>`;

    html += `<div class="cb"><div class="cbi">`;

    // Current status paragraph
    if (chartBlock?.currentStatus || c.primaryDiagnosis?.briefDefinition) {
      html += `<p>${esc(chartBlock?.currentStatus || c.primaryDiagnosis?.briefDefinition)}</p>`;
    }

    // Current management
    if (chartBlock?.currentMeds || chartBlock?.pastMeds || c.treatmentApproach?.firstLine?.length > 0) {
      html += `<div class="cond-sub"><div class="cond-sub-label"><i class="fa-solid fa-pills"></i> Medications</div>`;
      if (chartBlock?.currentMeds) html += `<p><strong>Current:</strong> ${esc(chartBlock.currentMeds)}</p>`;
      if (chartBlock?.pastMeds) html += `<p><strong>Past:</strong> ${esc(chartBlock.pastMeds)}</p>`;
      if (!chartBlock?.currentMeds && c.treatmentApproach?.firstLine?.length > 0) {
        html += `<ul style="padding-left:1.25rem;margin-top:4px;">`;
        c.treatmentApproach.firstLine.forEach(t => {
          const treatment = stripTreatmentVerb(t.treatment || "");
          html += `<li><strong>${esc(treatment)}</strong>${t.dosing ? ` — ${esc(t.dosing)}` : ""}</li>`;
        });
        html += `</ul>`;
      }
      html += `</div>`;
    }

    // Labs / trends
    if (chartBlock?.labTrends || chartBlock?.recentControl || c.keyLabsAndImaging?.length > 0) {
      html += `<div class="cond-sub"><div class="cond-sub-label"><i class="fa-solid fa-flask"></i> Labs &amp; Trends</div>`;
      if (chartBlock?.labTrends) html += `<p>${esc(chartBlock.labTrends)}</p>`;
      if (chartBlock?.recentControl) html += `<p><strong>Recent trend:</strong> ${esc(chartBlock.recentControl)}</p>`;
      if (c.keyLabsAndImaging?.length > 0) {
        html += `<ul style="padding-left:1.25rem;margin-top:4px;">`;
        c.keyLabsAndImaging.forEach(lab => {
          html += `<li><strong>${esc(lab.study)}</strong>${lab.purpose ? ` — ${esc(lab.purpose)}` : ""}`;
          if (lab.interpretation) html += `<div style="font-size:.8rem;color:var(--fg-d);margin-top:2px;font-style:italic;">${esc(lab.interpretation)}</div>`;
          html += `</li>`;
        });
        html += `</ul>`;
      }
      html += `</div>`;
    }

    // Imaging
    if (chartBlock?.imaging) {
      html += `<div class="cond-sub"><div class="cond-sub-label"><i class="fa-solid fa-x-ray"></i> Imaging / Procedures</div><p>${esc(chartBlock.imaging)}</p></div>`;
    }

    // Care team
    if (chartBlock?.careTeam) {
      html += `<div class="cond-sub"><div class="cond-sub-label"><i class="fa-solid fa-user-doctor"></i> Care Team</div><p>${esc(chartBlock.careTeam)}</p></div>`;
    }

    // Teaching content for selected problems
    if (isSelected) {
      // Suggested questions (ASK box)
      if (c.suggestedQuestions?.length > 0) {
        html += `<div class="tbox ask"><div class="tbox-l"><i class="fa-solid fa-comment-medical"></i> Suggested Questions</div><ul>`;
        c.suggestedQuestions.forEach(q => html += `<li>${esc(q)}</li>`);
        html += `</ul></div>`;
      }

      // Key learning points (TEACH box)
      if (c.keyLearningPoints?.length > 0) {
        html += `<div class="tbox teach"><div class="tbox-l"><i class="fa-solid fa-graduation-cap"></i> Teaching Points</div><ul>`;
        c.keyLearningPoints.forEach(lp => {
          html += `<li><strong>${esc(lp.point)}:</strong> ${esc(lp.explanation)}`;
          if (lp.citation) html += ` <em style="opacity:.75;">(${esc(lp.citation)})</em>`;
          html += `</li>`;
        });
        html += `</ul></div>`;
      }

      // Don't miss (WARN box)
      if (c.dontMiss?.trim()) {
        html += `<div class="tbox warn"><div class="tbox-l"><i class="fa-solid fa-triangle-exclamation"></i> Don't Miss</div><p>${esc(c.dontMiss)}</p></div>`;
      }

      // Per-problem red flags from analysis
      if (perProbRedFlags.length > 0) {
        html += `<div class="tbox warn"><div class="tbox-l"><i class="fa-solid fa-triangle-exclamation"></i> Screen For</div><ul>`;
        perProbRedFlags.forEach(rf => html += `<li>${esc(rf)}</li>`);
        html += `</ul></div>`;
      }

      // Clinical pearl (TEACH box)
      if (c.clinicalPearl) {
        html += `<div class="tbox teach"><div class="tbox-l"><i class="fa-solid fa-lightbulb"></i> Clinical Pearl</div><p>${esc(c.clinicalPearl)}</p></div>`;
      }
    } else {
      // Non-selected: lightweight teaching if available
      const lwtKey = problemName.toLowerCase().trim();
      let lwt = doc.lightweightTeaching?.[lwtKey];
      if (!lwt && doc.lightweightTeaching) {
        for (const [k, v] of Object.entries(doc.lightweightTeaching)) {
          if (lwtKey.includes(k) || k.includes(lwtKey)) { lwt = v; break; }
        }
      }
      if (lwt) {
        if (lwt.theClassicPicture) {
          html += `<div class="tbox teach"><div class="tbox-l"><i class="fa-solid fa-graduation-cap"></i> Quick Background</div><p>${esc(lwt.theClassicPicture)}</p></div>`;
        }
        if (lwt.oneKeyLearningPoint) {
          html += `<div class="tbox teach"><div class="tbox-l"><i class="fa-solid fa-lightbulb"></i> Key Point</div><p><strong>${esc(lwt.oneKeyLearningPoint.point)}:</strong> ${esc(lwt.oneKeyLearningPoint.explanation)}`;
          if (lwt.oneKeyLearningPoint.citation) html += ` <em style="opacity:.75;">(${esc(lwt.oneKeyLearningPoint.citation)})</em>`;
          html += `</p></div>`;
        }
        if (lwt.clinicalPearl) {
          html += `<div class="tbox teach"><div class="tbox-l"><i class="fa-solid fa-lightbulb"></i> Pearl</div><p>${esc(lwt.clinicalPearl)}</p></div>`;
        }
      }
    }

    html += `</div></div></div>`;
    return html;
  };

  // Render selected teaching cases
  enabledCases.forEach((tc, idx) => {
    problemsTab += buildProblemCard(tc, idx, true);
  });

  // Render non-selected problems from PMH
  const selectedNames = new Set(enabledCases.map(tc => (tc.data?.problem || tc.problem || "").toLowerCase().trim()));
  Object.entries(problemBlocks).forEach(([key, block], idx) => {
    const headerLower = block.rawHeader.toLowerCase().trim();
    let alreadyCovered = false;
    for (const sel of selectedNames) {
      if (headerLower.includes(sel) || sel.includes(headerLower)) { alreadyCovered = true; break; }
    }
    if (!alreadyCovered) {
      problemsTab += buildProblemCard({ data: { problem: block.rawHeader } }, enabledCases.length + idx, false);
    }
  });

  problemsTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // MEDS TAB
  // ─────────────────────────────────────────────────────────────
  let medsTab = `<div id="tab-meds" class="section">`;
  medsTab += `<div class="sec-title">Current Medications</div>`;
  if (currentMedNames.length > 0) {
    medsTab += `<div class="med-table-wrap" style="margin-bottom:20px;"><table class="med-table"><thead><tr><th>Medication</th><th>Treats</th><th>Mechanism</th></tr></thead><tbody>`;
    currentMedNames.forEach(name => {
      const desc = medDesc[name.toLowerCase().trim()] || {};
      const utdUrl = `https://www.uptodate.com/contents/search?search=${encodeURIComponent(name)}`;
      medsTab += `<tr><td class="drug-name"><a href="${esc(utdUrl)}" target="_blank" rel="noreferrer" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;">${esc(name)} ↗</a></td><td>${desc.treats ? esc(desc.treats) : "—"}</td><td>${desc.mechanism ? esc(desc.mechanism) : "—"}</td></tr>`;
    });
    medsTab += `</tbody></table></div>`;
  } else if (currentMedsText) {
    medsTab += infoBox("Current medications (verbatim)", verbatim(currentMedsText));
  } else {
    medsTab += `<p style="color:var(--fg-d);font-style:italic;">No current medications documented.</p>`;
  }

  if (discontinuedMedsText) {
    medsTab += `<div class="sec-title" style="margin-top:24px;">Recently Discontinued</div>`;
    medsTab += `<div class="med-table-wrap">${verbatim(discontinuedMedsText)}</div>`;
  }
  if (historicalMedsText) {
    medsTab += `<div class="sec-title" style="margin-top:24px;">Historical Medications</div>`;
    medsTab += `<div class="med-table-wrap">${verbatim(historicalMedsText)}</div>`;
  }
  medsTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // LABS TAB
  // ─────────────────────────────────────────────────────────────
  let labsTab = `<div id="tab-labs" class="section">`;
  labsTab += `<div class="sec-title">Laboratory Results</div>`;
  if (na.labTrendsSummary) labsTab += `<div class="oneliner" style="margin-bottom:14px;">${esc(na.labTrendsSummary)}</div>`;
  if (labsText) labsTab += `<div class="card open"><div class="ch" onclick="toggleCard(this)"><div class="ch-l"><div class="ci lab"><i class="fa-solid fa-flask-vial"></i></div><div><div class="ct">Full Lab Results</div><div class="cs">Verbatim from chart</div></div></div><div class="ch-r"><i class="fa-solid fa-chevron-down chev"></i></div></div><div class="cb"><div class="cbi">${verbatim(labsText)}</div></div></div>`;
  if (imagingText && !/no imaging/i.test(imagingText)) {
    labsTab += `<div class="card"><div class="ch" onclick="toggleCard(this)"><div class="ch-l"><div class="ci lab"><i class="fa-solid fa-x-ray"></i></div><div><div class="ct">Imaging &amp; Procedures</div></div></div><div class="ch-r"><i class="fa-solid fa-chevron-down chev"></i></div></div><div class="cb"><div class="cbi">${verbatim(imagingText)}</div></div></div>`;
  }
  labsTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // SOCIAL TAB
  // ─────────────────────────────────────────────────────────────
  let socialTab = `<div id="tab-social" class="section">`;
  socialTab += `<div class="sec-title">Social History &amp; Context</div>`;
  if (socialText) socialTab += infoBox("Social History", fmtHtml(socialText, { stripHeader: "Social History" }));
  if (familyText) socialTab += infoBox("Family History", fmtHtml(familyText, { stripHeader: "Family History" }));
  if (militaryText) socialTab += infoBox("Military History", fmtHtml(militaryText, { stripHeader: "Military History" }));
  if (!socialText && !familyText && !militaryText) socialTab += `<p style="color:var(--fg-d);font-style:italic;">No social history documented.</p>`;
  socialTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // TIMELINE TAB
  // ─────────────────────────────────────────────────────────────
  let timelineTab = `<div id="tab-timeline" class="section"><div class="sec-title">Recent Visit Timeline</div>`;
  if (updatesText) {
    timelineTab += `<div class="card open"><div class="cb" style="max-height:none;"><div class="cbi">${fmtHtml(updatesText, { stripHeader: "Updates", dropTables: true })}</div></div></div>`;
  } else {
    timelineTab += `<p style="color:var(--fg-d);font-style:italic;">No recent visit updates documented.</p>`;
  }
  timelineTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // PREVENTIVE TAB
  // ─────────────────────────────────────────────────────────────
  let preventiveTab = `<div id="tab-preventive" class="section"><div class="sec-title">Preventive Care Status</div>`;
  if (preventiveText) {
    preventiveTab += `<div class="card open"><div class="cb" style="max-height:none;"><div class="cbi">${fmtHtml(preventiveText, { stripHeader: "Preventive Medicine" })}</div></div></div>`;
  } else {
    preventiveTab += `<p style="color:var(--fg-d);font-style:italic;">No preventive care data documented.</p>`;
  }
  preventiveTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // VISIT PLAN TAB (checklist from na.visitPlan)
  // ─────────────────────────────────────────────────────────────
  let checklistTab = `<div id="tab-checklist" class="section"><div class="sec-title">Today's Visit Plan</div>`;
  if (Array.isArray(na.visitPlan) && na.visitPlan.length > 0) {
    checklistTab += `<div class="card open"><div class="cb" style="max-height:none;"><div class="cbi"><ul class="cl">`;
    na.visitPlan.forEach(item => {
      checklistTab += `<li onclick="toggleCK(this)"><div class="cbx"><i class="fa-solid fa-check"></i></div><span>${esc(item)}</span></li>`;
    });
    checklistTab += `</ul></div></div></div>`;
  } else {
    checklistTab += `<p style="color:var(--fg-d);font-style:italic;">No visit plan generated.</p>`;
  }
  if (na.redFlags?.length > 0) {
    checklistTab += `<div class="tbox warn"><div class="tbox-l"><i class="fa-solid fa-triangle-exclamation"></i> Red Flags — Actively Screen For</div><ul>`;
    na.redFlags.forEach(rf => checklistTab += `<li>${esc(rf)}</li>`);
    checklistTab += `</ul></div>`;
  }
  checklistTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // PRACTICE QUESTIONS TAB
  // ─────────────────────────────────────────────────────────────
  let practiceTab = `<div id="tab-practice" class="section"><div class="sec-title">Practice Questions</div>`;
  let qNum = 0;
  enabledCases.forEach(tc => {
    const c = tc.data || tc;
    if (!c.shelfQuestions?.length) return;
    practiceTab += `<div class="sec-title" style="margin-top:20px;">${esc(c.problem)}</div>`;
    c.shelfQuestions.forEach(q => {
      qNum++;
      practiceTab += `<div class="pq-card" onclick="togglePQ(this)"><div class="pq-q"><div class="pq-num">${qNum}</div><div class="pq-text">${esc(q.vignette)}</div><i class="fa-solid fa-chevron-down pq-chev"></i></div><div class="pq-a"><div class="pq-ai">`;
      if (q.options) {
        practiceTab += `<ul class="pq-opts">`;
        Object.entries(q.options).forEach(([letter, opt]) => {
          const cls = q.correctAnswer === letter ? "pq-correct" : "";
          practiceTab += `<li class="${cls}"><span class="pq-letter">${esc(letter)}.</span>${esc(opt)}</li>`;
        });
        practiceTab += `</ul>`;
      }
      practiceTab += `<p><strong>Answer: <span class="pq-correct">${esc(q.correctAnswer)}</span></strong></p><p>${esc(q.explanation)}</p>`;
      practiceTab += `</div></div></div>`;
    });
  });
  if (qNum === 0) practiceTab += `<p style="color:var(--fg-d);font-style:italic;">No practice questions generated.</p>`;
  practiceTab += `</div>`;

  // ─────────────────────────────────────────────────────────────
  // ASSEMBLE FULL HTML DOCUMENT
  // ─────────────────────────────────────────────────────────────
  const cssBlock = `
:root{--bg:#0f1419;--bg-el:#161c22;--card:#1c242c;--card-h:#212a34;--brd:#2a3542;--brd-l:#344155;--fg:#e8edf3;--fg-m:#8899aa;--fg-d:#5c7080;--acc:#38bdf8;--acc-d:rgba(56,189,248,.12);--tch:#f59e0b;--tch-bg:rgba(245,158,11,.08);--tch-br:rgba(245,158,11,.25);--wrn:#f87171;--wrn-bg:rgba(248,113,113,.08);--wrn-br:rgba(248,113,113,.25);--suc:#34d399;--suc-bg:rgba(52,211,153,.08);--suc-br:rgba(52,211,153,.25);--inf:#818cf8;--inf-bg:rgba(129,140,248,.08);--inf-br:rgba(129,140,248,.25);--rx:#c084fc;--rx-bg:rgba(192,132,252,.08);--rx-br:rgba(192,132,252,.25);--pq:#2dd4bf;--pq-bg:rgba(45,212,191,.08);--pq-br:rgba(45,212,191,.25);--shadow:0 1px 3px rgba(0,0,0,.3);--toggle-bg:#2a3542;--toggle-knob:#e8edf3;--toggle-icon:#8899aa}
body.light{--bg:#f3f4f8;--bg-el:#e9ebf0;--card:#fff;--card-h:#f7f8fa;--brd:#d8dce5;--brd-l:#c5cad6;--fg:#1a1f2e;--fg-m:#5a6275;--fg-d:#8b92a5;--acc:#0284c7;--acc-d:rgba(2,132,199,.08);--tch:#d97706;--tch-bg:rgba(217,119,6,.06);--tch-br:rgba(217,119,6,.2);--wrn:#dc2626;--wrn-bg:rgba(220,38,38,.05);--wrn-br:rgba(220,38,38,.18);--suc:#059669;--suc-bg:rgba(5,150,105,.06);--suc-br:rgba(5,150,105,.18);--inf:#6366f1;--inf-bg:rgba(99,102,241,.06);--inf-br:rgba(99,102,241,.18);--rx:#9333ea;--rx-bg:rgba(147,51,234,.06);--rx-br:rgba(147,51,234,.18);--pq:#0d9488;--pq-bg:rgba(13,148,136,.06);--pq-br:rgba(13,148,136,.18);--shadow:0 1px 3px rgba(0,0,0,.08);--toggle-bg:#cbd5e1;--toggle-knob:#fff;--toggle-icon:#64748b}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth;font-size:15px}
body{font-family:'DM Sans','Inter',system-ui,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6;min-height:100vh;transition:background .3s,color .3s}
.theme-toggle-wrap{position:fixed;top:16px;right:16px;z-index:1000;display:flex;align-items:center;gap:10px}
.theme-toggle{position:relative;width:56px;height:30px;cursor:pointer;display:flex;align-items:center}
.theme-toggle input{display:none}
.toggle-track{position:absolute;inset:0;background:var(--toggle-bg);border-radius:15px;transition:background .3s;border:1px solid var(--brd)}
.toggle-knob{position:absolute;left:3px;top:3px;width:24px;height:24px;background:var(--toggle-knob);border-radius:50%;transition:transform .3s,background .3s;box-shadow:0 1px 4px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center}
.toggle-knob i{font-size:12px;color:var(--toggle-icon)}
.theme-toggle input:checked~.toggle-knob{transform:translateX(26px)}
.theme-toggle input:checked~.toggle-knob i.fa-moon{display:none}
.theme-toggle input:not(:checked)~.toggle-knob i.fa-sun{display:none}
.toggle-label{font-size:.72rem;font-weight:600;color:var(--fg-d);text-transform:uppercase;letter-spacing:.06em}
@media(max-width:640px){.theme-toggle-wrap{top:10px;right:10px}.toggle-label{display:none}}
.container{max-width:960px;margin:0 auto;padding:24px 20px 80px}
.patient-header{background:var(--card);border:1px solid var(--brd);border-radius:14px;padding:28px 32px;margin-bottom:16px;position:relative;overflow:hidden;box-shadow:var(--shadow)}
.patient-header::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--acc),var(--tch),var(--suc))}
.header-top{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:14px}
.patient-name{font-size:1.6rem;font-weight:700;letter-spacing:-.02em}
.patient-name span{color:var(--fg-m);font-weight:400;font-size:.92rem;margin-left:10px}
.badge-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:.76rem;font-weight:600;white-space:nowrap}
.badge-v{background:var(--acc-d);color:var(--acc);border:1px solid rgba(56,189,248,.2)}
.badge-sc{background:var(--tch-bg);color:var(--tch);border:1px solid var(--tch-br)}
.badge-a{background:var(--wrn-bg);color:var(--wrn);border:1px solid var(--wrn-br)}
.sc-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.sc-c{font-size:.68rem;padding:2px 8px;border-radius:4px;background:var(--tch-bg);color:var(--tch);border:1px solid var(--tch-br);font-weight:500}
.hgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-top:14px}
.hs{display:flex;flex-direction:column;gap:2px}
.hs-l{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:var(--fg-d);font-weight:600}
.hs-v{font-size:.9rem;color:var(--fg);font-weight:500}
.oneliner{background:var(--acc-d);border:1px solid rgba(56,189,248,.15);border-radius:10px;padding:14px 20px;margin-bottom:16px;font-size:.9rem;line-height:1.65}
.qr-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
@media(max-width:700px){.qr-grid{grid-template-columns:1fr}}
.qr-panel{background:var(--card);border:1px solid var(--brd);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
.qr-head{padding:12px 18px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--fg-d);border-bottom:1px solid var(--brd);display:flex;align-items:center;gap:8px}
.qr-body{padding:14px 18px}
.pmh-list{list-style:none;padding:0}
.pmh-list li{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--brd);font-size:.84rem;color:var(--fg-m)}
.pmh-list li:last-child{border-bottom:none}
.pmh-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.pmh-dot.active{background:var(--suc)}
.pmh-dot.resolved{background:var(--fg-d)}
.pmh-list li .sc-tag{margin-left:auto;font-size:.65rem;padding:1px 7px;border-radius:4px;background:var(--tch-bg);color:var(--tch);border:1px solid var(--tch-br);font-weight:600}
.ref-item{margin-bottom:12px}.ref-item:last-child{margin-bottom:0}
.ref-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:var(--fg-d);font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:6px}
.ref-text{font-size:.84rem;color:var(--fg-m);line-height:1.6}
.nav-tabs{display:flex;gap:4px;padding:6px;background:var(--bg-el);border:1px solid var(--brd);border-radius:12px;margin-bottom:18px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.nav-tab{padding:9px 14px;border-radius:8px;border:none;background:transparent;color:var(--fg-m);font-family:inherit;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap;display:flex;align-items:center;gap:6px}
.nav-tab:hover{color:var(--fg);background:var(--card)}
.nav-tab.active{background:var(--card);color:var(--acc);box-shadow:var(--shadow)}
.section{display:none}.section.active{display:block}
.sec-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--fg-d);margin-bottom:14px;padding-left:4px}
.sec-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.toggle-all{background:none;border:1px solid var(--brd);color:var(--fg-m);font-family:inherit;font-size:.74rem;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;transition:all .2s}
.toggle-all:hover{color:var(--fg);border-color:var(--brd-l);background:var(--card)}
.card{background:var(--card);border:1px solid var(--brd);border-radius:12px;margin-bottom:14px;overflow:hidden;box-shadow:var(--shadow);transition:border-color .2s}
.card:hover{border-color:var(--brd-l)}
.ch{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;cursor:pointer;user-select:none;transition:background .15s;gap:12px}
.ch:hover{background:var(--card-h)}
.ch-l{display:flex;align-items:center;gap:11px;min-width:0}
.ci{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.82rem;flex-shrink:0}
.ci.mental{background:var(--inf-bg);color:var(--inf);border:1px solid var(--inf-br)}
.ci.skin{background:var(--rx-bg);color:var(--rx);border:1px solid var(--rx-br)}
.ci.gi{background:var(--suc-bg);color:var(--suc);border:1px solid var(--suc-br)}
.ci.pain{background:var(--wrn-bg);color:var(--wrn);border:1px solid var(--wrn-br)}
.ci.ent{background:var(--tch-bg);color:var(--tch);border:1px solid var(--tch-br)}
.ci.neuro{background:var(--inf-bg);color:var(--inf);border:1px solid var(--inf-br)}
.ci.social{background:var(--acc-d);color:var(--acc);border:1px solid rgba(56,189,248,.2)}
.ci.lab{background:var(--suc-bg);color:var(--suc);border:1px solid var(--suc-br)}
.ct{font-size:.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cs{font-size:.73rem;color:var(--fg-m);margin-top:1px}
.ch-r{display:flex;align-items:center;gap:10px;flex-shrink:0}
.sp{padding:3px 10px;border-radius:12px;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.sp-active{background:var(--suc-bg);color:var(--suc);border:1px solid var(--suc-br)}
.sp-resolved{background:rgba(136,153,170,.1);color:var(--fg-m);border:1px solid rgba(136,153,170,.2)}
.sp-stable{background:var(--acc-d);color:var(--acc);border:1px solid rgba(56,189,248,.2)}
.sp-reg{background:var(--tch-bg);color:var(--tch);border:1px solid var(--tch-br)}
.chev{color:var(--fg-d);font-size:.72rem;transition:transform .25s}
.card.open .chev{transform:rotate(180deg)}
.cb{max-height:0;overflow:hidden;transition:max-height .35s ease}
.card.open .cb{max-height:8000px}
.cbi{padding:0 18px 18px}
.cbi p{font-size:.86rem;color:var(--fg-m);line-height:1.65;margin-bottom:8px}
.cbi p:last-child{margin-bottom:0}
.cbi p strong{color:var(--fg);font-weight:600}
.cbi ul{padding-left:1.25rem;margin-bottom:8px}
.cbi ul li{font-size:.86rem;color:var(--fg-m);line-height:1.6;margin-bottom:4px}
.cond-sub{margin-top:14px;border-top:1px solid var(--brd);padding-top:12px}
.cond-sub:first-child{margin-top:0;border-top:none;padding-top:0}
.cond-sub-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--fg-d);margin-bottom:6px;display:flex;align-items:center;gap:6px}
.tbox{border-radius:10px;padding:14px 18px;margin-top:14px;position:relative}
.tbox::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0}
.tbox.teach{background:var(--tch-bg);border:1px solid var(--tch-br)}
.tbox.teach::before{background:var(--tch)}
.tbox.ask{background:var(--inf-bg);border:1px solid var(--inf-br)}
.tbox.ask::before{background:var(--inf)}
.tbox.warn{background:var(--wrn-bg);border:1px solid var(--wrn-br)}
.tbox.warn::before{background:var(--wrn)}
.tbox-l{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.tbox.teach .tbox-l{color:var(--tch)}
.tbox.ask .tbox-l{color:var(--inf)}
.tbox.warn .tbox-l{color:var(--wrn)}
.tbox ul{margin:0;padding-left:18px}
.tbox li{font-size:.81rem;color:var(--fg-m);line-height:1.65;margin-bottom:4px}
.tbox li strong{color:var(--fg);font-weight:600}
.tbox p{font-size:.81rem;color:var(--fg-m);line-height:1.65}
.med-table-wrap{overflow-x:auto;border-radius:10px;border:1px solid var(--brd);box-shadow:var(--shadow)}
.med-table{width:100%;border-collapse:collapse;font-size:.82rem}
.med-table th{background:var(--bg-el);color:var(--fg-d);font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding:10px 14px;text-align:left;border-bottom:1px solid var(--brd);white-space:nowrap}
.med-table td{padding:10px 14px;border-bottom:1px solid var(--brd);color:var(--fg-m);vertical-align:top;line-height:1.55}
.med-table tr:last-child td{border-bottom:none}
.med-table .drug-name{color:var(--rx);font-weight:600;white-space:nowrap}
.verbatim{font-family:inherit;font-size:.83rem;white-space:pre-wrap;color:var(--fg-m);line-height:1.55;padding:12px 16px;background:var(--bg-el);border-radius:6px;overflow-x:auto}
.fmt-block p{font-size:.86rem;color:var(--fg-m);line-height:1.65;margin-bottom:8px}
.fmt-block p:last-child{margin-bottom:0}
.fmt-block ul{padding-left:1.25rem;margin-bottom:8px}
.fmt-block ul:last-child{margin-bottom:0}
.fmt-block li{font-size:.85rem;color:var(--fg-m);line-height:1.6;margin-bottom:4px}
.fmt-block li strong{color:var(--fg);font-weight:600}
.vr{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:10px}
.vc{background:var(--bg-el);border:1px solid var(--brd);border-radius:8px;padding:10px 14px;text-align:center}
.vc-l{font-size:.64rem;text-transform:uppercase;letter-spacing:.08em;color:var(--fg-d);font-weight:600;margin-bottom:3px}
.vc-v{font-family:monospace;font-size:.95rem;font-weight:500;color:var(--fg)}
.info-box{background:var(--bg-el);border:1px solid var(--brd);border-radius:8px;padding:12px 16px;margin-bottom:12px}
.info-box:last-child{margin-bottom:0}
.info-box-title{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:var(--fg-d);font-weight:700;margin-bottom:6px}
.cl{list-style:none;padding:0}
.cl li{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--brd);font-size:.86rem;color:var(--fg-m);cursor:pointer;transition:color .15s}
.cl li:last-child{border-bottom:none}
.cl li:hover{color:var(--fg)}
.cbx{width:20px;height:20px;border-radius:5px;border:2px solid var(--brd-l);flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;transition:all .2s}
.cbx i{font-size:.62rem;color:transparent;transition:color .2s}
.cl li.ck .cbx{background:var(--suc);border-color:var(--suc)}
.cl li.ck .cbx i{color:#fff}
.cl li.ck{color:var(--fg-d);text-decoration:line-through}
.pq-card{background:var(--card);border:1px solid var(--brd);border-radius:12px;margin-bottom:14px;overflow:hidden;box-shadow:var(--shadow)}
.pq-q{padding:16px 18px;cursor:pointer;transition:background .15s;display:flex;align-items:flex-start;gap:14px}
.pq-q:hover{background:var(--card-h)}
.pq-num{background:var(--pq-bg);color:var(--pq);border:1px solid var(--pq-br);width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.78rem;font-weight:700;flex-shrink:0;font-family:monospace}
.pq-text{font-size:.87rem;color:var(--fg);line-height:1.6;flex:1}
.pq-chev{color:var(--fg-d);font-size:.72rem;transition:transform .25s;margin-top:4px;flex-shrink:0}
.pq-card.open .pq-chev{transform:rotate(180deg)}
.pq-a{max-height:0;overflow:hidden;transition:max-height .35s ease}
.pq-card.open .pq-a{max-height:3000px}
.pq-ai{padding:16px 18px;border-top:1px solid var(--brd)}
.pq-ai p{font-size:.84rem;color:var(--fg-m);line-height:1.65;margin-bottom:8px}
.pq-ai p:last-child{margin-bottom:0}
.pq-ai strong{color:var(--fg);font-weight:600}
.pq-ai .pq-correct{color:var(--suc);font-weight:700}
.pq-opts{list-style:none;padding:0;margin:8px 0}
.pq-opts li{padding:5px 0;font-size:.84rem;color:var(--fg-m)}
.pq-opts li.pq-correct{color:var(--suc);font-weight:600}
.pq-opts li .pq-letter{font-weight:700;margin-right:6px;color:var(--fg-d)}
.pq-opts li.pq-correct .pq-letter{color:var(--suc)}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--brd-l);border-radius:3px}
@media print{body{background:#fff!important;color:#111!important}.card,.qr-panel,.pq-card{border-color:#ddd!important;background:#fff!important}.nav-tabs{display:none}.section{display:block!important}.cb,.pq-a{max-height:none!important}.chev,.pq-chev{display:none}.tbox{break-inside:avoid}.theme-toggle-wrap{display:none!important}}
@media(max-width:640px){.container{padding:12px 10px 60px}.patient-header{padding:20px 16px}.patient-name{font-size:1.3rem}.hgrid{grid-template-columns:repeat(2,1fr)}.ch{padding:12px 14px}.cbi{padding:0 14px 14px}.vr{grid-template-columns:repeat(2,1fr)}.nav-tab{padding:8px 12px;font-size:.76rem}}
`;

  const jsBlock = `
(function(){
  var STORAGE_KEY='inroom-${sessionId}-theme';
  var CHECKLIST_KEY='inroom-${sessionId}-checks';
  var sw=document.getElementById('themeSwitch');
  if(sw){
    try{var saved=localStorage.getItem(STORAGE_KEY);if(saved==='light'){sw.checked=true;document.body.classList.add('light')}}catch(e){}
    sw.addEventListener('change',function(){
      if(this.checked){document.body.classList.add('light');try{localStorage.setItem(STORAGE_KEY,'light')}catch(e){}}
      else{document.body.classList.remove('light');try{localStorage.setItem(STORAGE_KEY,'dark')}catch(e){}}
    });
  }
  try{var savedChecks=JSON.parse(localStorage.getItem(CHECKLIST_KEY)||'{}');
    document.querySelectorAll('.cl li').forEach(function(li,i){if(savedChecks[i])li.classList.add('ck')});
  }catch(e){}
})();
function switchTab(id,btn){document.querySelectorAll('.nav-tab').forEach(function(t){t.classList.remove('active')});document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active')});btn.classList.add('active');document.getElementById('tab-'+id).classList.add('active');window.scrollTo({top:0,behavior:'smooth'})}
function toggleCard(h){h.parentElement.classList.toggle('open')}
function toggleAll(sid){var s=document.getElementById(sid);var cs=s.querySelectorAll('.card');var allO=Array.from(cs).every(function(c){return c.classList.contains('open')});cs.forEach(function(c){if(allO)c.classList.remove('open');else c.classList.add('open')});var b=s.querySelector('.toggle-all');if(b)b.textContent=allO?'Expand All':'Collapse All'}
function toggleCK(li){li.classList.toggle('ck');try{var lis=Array.from(document.querySelectorAll('.cl li'));var checks={};lis.forEach(function(l,i){if(l.classList.contains('ck'))checks[i]=true});localStorage.setItem('inroom-${sessionId}-checks',JSON.stringify(checks))}catch(e){}}
function togglePQ(card){card.classList.toggle('open')}
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>${cssBlock}</style>
</head>
<body>
<div class="theme-toggle-wrap">
  <span class="toggle-label">Theme</span>
  <label class="theme-toggle" aria-label="Toggle theme">
    <input type="checkbox" id="themeSwitch">
    <div class="toggle-track"></div>
    <div class="toggle-knob">
      <i class="fa-solid fa-moon"></i>
      <i class="fa-solid fa-sun"></i>
    </div>
  </label>
</div>
<div class="container">
${headerHtml}
${oneLinerHtml}
${qrHtml}
${vitalsHtml}
${navHtml}
${problemsTab}
${medsTab}
${labsTab}
${socialTab}
${timelineTab}
${preventiveTab}
${checklistTab}
${practiceTab}
</div>
<script>${jsBlock}<\/script>
</body>
</html>`;
};

  return (
    <>
      <div className="no-print flex gap-2 mb-4 items-center flex-wrap">
        <button onClick={printDoc} className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
          <Printer className="w-4 h-4" />
          <span className="hidden sm:inline">Print / Save as PDF</span>
          <span className="sm:hidden">Print / PDF</span>
        </button>
        <button onClick={exportAsHtml} className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium" title="Download as a standalone interactive HTML file to give to the student">
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">Export as Interactive HTML</span>
          <span className="sm:hidden">Export HTML</span>
        </button>
        <button onClick={onEdit} className="px-3 sm:px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">
          <span className="hidden sm:inline">← Back to Preview</span>
          <span className="sm:hidden">← Preview</span>
        </button>
        {/* Editing hint hidden on mobile — takes too much room and the yellow-tinted document already signals editability */}
        <div className="text-xs text-slate-500 italic ml-2 hidden sm:block">
          Click any text to edit — changes save automatically. Use the toolbar for bold/italic/underline.
        </div>
      </div>

      {/* Floating formatting toolbar — always visible in FinalDocument since it's always editable.
          Sticky position adjusts for mobile header height. Wraps to multiple rows if needed. */}
      <div
        className="formatting-toolbar no-print sticky z-20 mb-2 flex items-center gap-1 bg-slate-800 text-white rounded-lg shadow-lg px-2 py-1 flex-wrap"
        style={{ top: "140px" }}
      >
        <style>{`
          @media (max-width: 640px) {
            .formatting-toolbar {
              top: 96px !important;
              gap: 0.15rem !important;
              padding: 0.35rem 0.4rem !important;
              width: 100%;
            }
            .formatting-toolbar .toolbar-btn {
              padding: 0.4rem 0.6rem !important;
              font-size: 0.85rem !important;
            }
            .formatting-toolbar .toolbar-highlight-label {
              display: none;
            }
            .formatting-toolbar .toolbar-swatch {
              width: 1.75rem !important;
              height: 1.75rem !important;
            }
          }
        `}</style>
        <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("bold"); }} className="toolbar-btn px-3 py-1.5 hover:bg-slate-700 rounded font-bold text-sm" title="Bold">B</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("italic"); }} className="toolbar-btn px-3 py-1.5 hover:bg-slate-700 rounded italic text-sm" title="Italic">I</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("underline"); }} className="toolbar-btn px-3 py-1.5 hover:bg-slate-700 rounded underline text-sm" title="Underline">U</button>
        <div className="w-px h-5 bg-slate-600 mx-1"></div>
        <span className="toolbar-highlight-label text-xs px-1 opacity-70">Highlight:</span>
        {[
          { color: "#fef08a", label: "Yellow" },
          { color: "#bbf7d0", label: "Green" },
          { color: "#bfdbfe", label: "Blue" },
          { color: "#fbcfe8", label: "Pink" },
          { color: "#fed7aa", label: "Orange" },
        ].map(h => (
          <button
            key={h.color}
            type="button"
            onMouseDown={e => {
              e.preventDefault();
              document.execCommand("hiliteColor", false, h.color);
              if (editableRef.current) editableRef.current.focus();
            }}
            className="toolbar-swatch w-6 h-6 rounded border border-slate-500 hover:scale-110 transition"
            style={{ backgroundColor: h.color }}
            title={`Highlight ${h.label}`}
          />
        ))}
        <button
          type="button"
          onMouseDown={e => {
            e.preventDefault();
            document.execCommand("hiliteColor", false, "transparent");
            if (editableRef.current) editableRef.current.focus();
          }}
          className="toolbar-swatch w-6 h-6 rounded border border-slate-500 bg-white text-slate-700 flex items-center justify-center text-xs hover:scale-110 transition"
          title="Remove highlight"
        >
          <X className="w-3 h-3" />
        </button>
        <div className="w-px h-5 bg-slate-600 mx-1"></div>
        <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("removeFormat"); }} className="toolbar-btn px-2 py-1.5 hover:bg-slate-700 rounded text-xs" title="Clear all formatting">Clear</button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 print-doc" style={{fontFamily: "Georgia, 'Times New Roman', serif"}}>
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={captureEdits}
          className="outline-none focus:outline-none"
          style={{ boxShadow: "inset 0 0 0 2px rgba(251, 191, 36, 0.2)", borderRadius: "0.75rem" }}
        >
          {renderContent()}
        </div>
      </div>
    </>
  );
}

// ============ DE-IDENTIFICATION REVIEWER MODAL ============
// Full-screen modal for reviewing regex-de-identified prenote text before
// it becomes the working clinical note. Shows a side-by-side diff of the
// original vs. de-identified, category counts of what was changed, and an
// editable "final version" the attending can further refine by hand.
//
// The attending MUST explicitly click "Use this de-identified version"
// before the text is accepted — no accidental confirmations.
function DeidentificationReviewer({ rawText, initialResult, onConfirm, onCancel }) {
  // Working copy the attending can further edit before confirming
  const [editedText, setEditedText] = React.useState(initialResult.deidentified);
  const [showOriginal, setShowOriginal] = React.useState(false);

  React.useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onCancel]);

  // Group findings by category for the summary panel
  const grouped = React.useMemo(() => {
    const g = {};
    (initialResult.findings || []).forEach(f => {
      if (!g[f.category]) g[f.category] = [];
      g[f.category].push(f);
    });
    return g;
  }, [initialResult.findings]);

    const categoryLabels = {
    patient_name: {
      label: "Patient name occurrences",
      color: "bg-red-100 text-red-800 border-red-200",
    },
    patient_name_token: {
      label: "Standalone patient-name mentions",
      color: "bg-red-100 text-red-800 border-red-200",
    },
    patient_first_name: {
      label: "First name mentions",
      color: "bg-red-100 text-red-800 border-red-200",
    },
    patient_last_name: {
      label: "Last name mentions",
      color: "bg-red-100 text-red-800 border-red-200",
    },
    date: { label: "Dates reduced to MM/YYYY", color: "bg-amber-100 text-amber-800 border-amber-200" },
    address: { label: "Addresses removed", color: "bg-red-100 text-red-800 border-red-200" },
    phone: { label: "Phone numbers removed", color: "bg-red-100 text-red-800 border-red-200" },
    identifier: { label: "IDs / MRNs removed", color: "bg-red-100 text-red-800 border-red-200" },
    family_name: { label: "Family member names removed", color: "bg-red-100 text-red-800 border-red-200" },
    family_location: { label: "Family locations removed", color: "bg-red-100 text-red-800 border-red-200" },
    location: { label: "City/State references removed", color: "bg-red-100 text-red-800 border-red-200" },
  };

  const totalChanges = (initialResult.findings || []).length;
  const hasBeenEdited = editedText !== initialResult.deidentified;

  return (
    <div
      onClick={onCancel}
      className="no-print"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 42, 68, 0.75)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden w-full"
        style={{ maxWidth: "1100px", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-800 to-slate-900 text-white flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider opacity-70 mb-1">Step 1 of 2 · PHI review</div>
            <h2 className="text-lg font-semibold">Review de-identified prenote</h2>
            <p className="text-xs opacity-80 mt-1">
              {totalChanges} automatic {totalChanges === 1 ? "change" : "changes"} made. Review, edit if needed, then confirm to use this version. The original paste will be discarded.
            </p>
          </div>
                              <button
            type="button"
            onClick={onCancel}
            className="text-white/70 hover:text-white p-1"
            aria-label="Close de-identification reviewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary of what was changed */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          {totalChanges === 0 ? (
            <div className="text-sm text-amber-800 bg-amber-100 border border-amber-200 rounded p-2 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong>No PHI patterns detected.</strong> This is unusual — either the prenote was already de-identified, or the automatic detector missed something. Review the text carefully and edit manually if needed.
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(grouped).map(([cat, items]) => {
                const meta = categoryLabels[cat] || { label: cat, color: "bg-slate-100 text-slate-700 border-slate-200" };
                return (
                  <span
                    key={cat}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border ${meta.color}`}
                    title={items.map(i => `${i.original} → ${i.replacement}`).join("\n")}
                  >
                    {meta.label}
                    <span className="opacity-75">· {items.length}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Body: split view of original vs. editable de-identified */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
          {/* Left: original (collapsible on narrow screens) */}
          <div className={`${showOriginal ? "flex" : "hidden lg:flex"} flex-1 flex-col border-r border-slate-200 min-h-0`}>
            <div className="px-4 py-2 bg-red-50 border-b border-red-200 flex items-center justify-between">
              <div className="text-xs font-semibold text-red-900 uppercase tracking-wider">Original (contains PHI — will not be sent)</div>
                            <button
                type="button"
                onClick={() => setShowOriginal(false)}
                className="text-xs text-red-700 hover:text-red-900 lg:hidden"
              >
                Hide
              </button>
            </div>
            <textarea
              value={rawText}
              readOnly
              className="flex-1 p-3 font-mono text-xs bg-red-50/30 text-slate-700 resize-none outline-none min-h-0"
              style={{ minHeight: "200px" }}
            />
          </div>

          {/* Right: editable de-identified */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between">
              <div className="text-xs font-semibold text-emerald-900 uppercase tracking-wider flex items-center gap-2">
                De-identified (editable)
                {hasBeenEdited && <span className="text-[10px] normal-case tracking-normal text-emerald-700 italic">· manually edited</span>}
              </div>
              <div className="flex items-center gap-2">
                {!showOriginal && (
                                    <button
                    type="button"
                    onClick={() => setShowOriginal(true)}
                    className="text-xs text-emerald-700 hover:text-emerald-900 lg:hidden"
                  >
                    Show original
                  </button>
                )}
                {hasBeenEdited && (
                                    <button
                    type="button"
                    onClick={() => setEditedText(initialResult.deidentified)}
                    className="text-xs text-slate-600 hover:text-slate-900 underline"
                    title="Revert to the automatic de-identification result"
                  >
                    Reset to auto
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={editedText}
              onChange={e => setEditedText(e.target.value)}
              className="flex-1 p-3 font-mono text-xs bg-white text-slate-900 resize-none outline-none min-h-0"
              style={{ minHeight: "200px" }}
              placeholder="De-identified text will appear here..."
            />
          </div>
        </div>

        {/* Footer with actions */}
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-slate-600 flex-1 min-w-0">
            <strong className="text-slate-800">Reminder:</strong> Automatic de-identification catches most PHI but is not perfect. Review the right panel carefully. Anything you see there will be sent to the AI and stored in your browser.
          </div>
          <div className="flex gap-2 flex-shrink-0">
                        <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium"
            >
              Cancel
            </button>
                        <button
              type="button"
              onClick={() => onConfirm(editedText)}
              disabled={!editedText.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Use this de-identified version
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ DOCUMENT CONTENT (extracted for cleanliness) ============
function DocumentContent({ doc, phase, session }) {
  const s = doc.sections || {};
  const enabledCases = (s.teachingCases || []).filter(tc => tc.enabled);

  return (
    <div className="doc-body">
      {/* ========== COVER ========== */}
      <div className="doc-cover">
        <div>
          <div className="cover-eyebrow">Longitudinal Integrated Teaching Document</div>
          <h1 className="cover-title">Clinical Case Learning Document</h1>
        </div>
        <div className="cover-rule"></div>
        <div className="cover-docket">
          <div>
            <div className="label">Student</div>
            <div className="value">{doc.student}</div>
          </div>
          <div>
            <div className="label">Session Date</div>
            <div className="value">{session.sessionDate}</div>
          </div>
          <div>
            <div className="label">LIC Month</div>
            <div className="value">Month {doc.phase.monthsIn}</div>
          </div>
          <div>
            <div className="label">Phase</div>
            <div className="value">{doc.phase.name}</div>
          </div>
        </div>
      </div>

      {/* ========== BODY ========== */}
      <div className="doc-body-mobile-padded" style={{ padding: "2.5rem 3rem 2rem" }}>

        {/* Case at a Glance */}
        {s.caseAtGlance?.enabled && (doc.chiefConcern || doc.workingDx || doc.selectedProblems?.length > 0) && (
          <section className="keep-together" style={{ marginBottom: "2rem" }}>
            <h2 className="doc-h2">Case at a Glance</h2>
            <div className="doc-table-scroll">
            <table className="doc-table">
              <tbody>
                {doc.chiefConcern && (
                  <tr>
                    <td className="row-label">Chief concern</td>
                    <td>{doc.chiefConcern}</td>
                  </tr>
                )}
                {doc.workingDx && (
                  <tr>
                    <td className="row-label">Primary working diagnosis</td>
                    <td>{doc.workingDx}</td>
                  </tr>
                )}
                <tr>
                  <td className="row-label">Complexity</td>
                  <td>{doc.complexity === "common" ? "Common presentation" : "Complex presentation"}</td>
                </tr>
                {doc.selectedProblems?.length > 0 && (
                  <tr>
                    <td className="row-label">Problems in focus</td>
                    <td>
                      <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc" }}>
                        {doc.selectedProblems.map((p, i) => <li key={i} style={{ marginBottom: "0.15rem" }}>{p}</li>)}
                      </ul>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </section>
        )}

        {/* Session Goal */}
        {s.sessionGoal?.enabled && s.sessionGoal.content && (
          <section style={{ marginBottom: "2rem" }}>
            <div className="doc-callout-goal keep-together">
              <div className="doc-meta-label" style={{ marginBottom: "0.35rem" }}>Session Goal</div>
              <div style={{ fontSize: "0.95rem", fontWeight: 500, color: "#0F2A44" }}>{s.sessionGoal.content}</div>
            </div>
          </section>
        )}

        {/* Phase-Aligned Framing */}
        {s.phaseFraming?.enabled && (
          <section className="keep-together" style={{ marginBottom: "2rem" }}>
            <h2 className="doc-h2">Phase-Aligned Framing</h2>
            <p style={{ margin: 0, fontSize: "0.9rem", marginBottom: "0.5rem" }}>
              <span style={{ fontWeight: 600, color: "var(--doc-navy)" }}>Where you are. </span>
              {doc.phase.focus}
            </p>
            {doc.phase.pace && (
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--doc-warm-gray)", fontStyle: "italic", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>Pace: </span>{doc.phase.pace}
              </p>
            )}
            {doc.phase.workingToward && (
              <div style={{ marginTop: "0.75rem", padding: "0.75rem 1rem", background: "var(--doc-paper)", borderLeft: "2px solid var(--doc-navy-mid)", fontSize: "0.85rem" }}>
                <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--doc-navy)", display: "block", marginBottom: "0.35rem" }}>Working Toward</span>
                {doc.phase.workingToward}
              </div>
            )}
          </section>
        )}

        {/* Teaching Cases */}
        {enabledCases.map((tc, idx) => {
          const c = tc.data;
          return (
            <section key={idx} className="doc-case-wrap">
              <div className="doc-case-banner">
                <div className="doc-case-numeral">
                  {c.kind === "tangential" ? "Tangential Topic" : "Case"} {String(idx + 1).padStart(2, "0")} of {String(enabledCases.length).padStart(2, "0")}
                  {c.kind === "tangential" && <span style={{ marginLeft: "0.5rem", opacity: 0.75 }}>· sparked by today's encounter</span>}
                </div>
                <h2 className="doc-case-title">{c.problem}</h2>
                {doc.focusAreas?.length > 0 && (() => {
                  const focusReadable = {
                    history: "History & Documentation",
                    physicalExam: "Physical Exam",
                    differential: "Differential",
                    workup: "Workup",
                    management: "Management",
                    patientContext: "Patient Context",
                    ebm: "Evidence-Based Medicine",
                    communication: "Communication",
                  };
                  const labels = doc.focusAreas.map(f => focusReadable[f] || f);
                  return (
                    <div style={{ marginTop: "0.55rem", fontSize: "0.65rem", color: "rgba(255,255,255,0.65)", fontStyle: "italic", letterSpacing: "0.02em" }}>
                      Taught with focus on: {labels.join(" · ")}
                    </div>
                  );
                })()}
              </div>

              {c.primaryDiagnosis?.name && (
                <div className="keep-together" style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Primary Diagnosis</div>
                  <p style={{ margin: 0 }}>
                    <span style={{ fontWeight: 600, color: "var(--doc-navy)" }}>{c.primaryDiagnosis.name}. </span>
                    {c.primaryDiagnosis.briefDefinition}
                  </p>
                </div>
              )}

              {c.illnessScript && (c.illnessScript.epidemiology || c.illnessScript.timeCourse || c.illnessScript.keySymptoms) && (
                <div className="keep-together" style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Illness Script</div>
                  <p style={{ margin: "0 0 0.6rem", fontSize: "0.82rem", color: "var(--doc-warm-gray)", fontStyle: "italic" }}>
                    The classic pattern for this diagnosis — anchored to how our patient fits or diverges. Build this into your library for faster pattern recognition next time.
                  </p>
                  <div className="doc-table-scroll">
                  <table className="doc-table" style={{ fontSize: "0.85rem" }}>
                    <tbody>
                      {c.illnessScript.epidemiology && (
                        <tr>
                          <td className="row-label" style={{ width: "22%" }}>Epidemiology</td>
                          <td>{c.illnessScript.epidemiology}</td>
                        </tr>
                      )}
                      {c.illnessScript.timeCourse && (
                        <tr>
                          <td className="row-label">Time course</td>
                          <td>{c.illnessScript.timeCourse}</td>
                        </tr>
                      )}
                      {c.illnessScript.keySymptoms && (
                        <tr>
                          <td className="row-label">Key symptoms</td>
                          <td>{c.illnessScript.keySymptoms}</td>
                        </tr>
                      )}
                      {c.illnessScript.keySigns && (
                        <tr>
                          <td className="row-label">Key signs</td>
                          <td>{c.illnessScript.keySigns}</td>
                        </tr>
                      )}
                      {c.illnessScript.keyLabsImaging && (
                        <tr>
                          <td className="row-label">Key labs / imaging</td>
                          <td>{c.illnessScript.keyLabsImaging}</td>
                        </tr>
                      )}
                      {c.illnessScript.naturalHistory && (
                        <tr>
                          <td className="row-label">Natural history</td>
                          <td>{c.illnessScript.naturalHistory}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {c.differentialDiagnosis?.length > 0 && (    
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Differential Diagnosis</div>
                  <div className="doc-table-scroll">
                  <table className="doc-table">
                    <thead>
                      <tr>
                        <th style={{ width: "35%" }}>Alternative</th>
                        <th>Clinical Reasoning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.differentialDiagnosis.map((dd, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500, color: "var(--doc-navy)" }}>{dd.diagnosis}</td>
                          <td>{dd.reasoning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {c.keyLearningPoints?.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Key Learning Points</div>
                  <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", counterReset: "lp" }}>
                    {c.keyLearningPoints.map((lp, i) => (
                      <li key={i} className="keep-together" style={{ display: "flex", gap: "0.85rem", marginBottom: "0.85rem", counterIncrement: "lp" }}>
                        <span style={{ flexShrink: 0, fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: "0.9rem", color: "var(--doc-navy-mid)", minWidth: "1.5rem", textAlign: "right" }}>{i + 1}.</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600, color: "var(--doc-navy)" }}>{lp.point}. </span>
                          <span>{lp.explanation}</span>
                          {lp.citation && (
                            <span style={{ fontFamily: "'Source Serif 4', serif", fontStyle: "italic", fontSize: "0.85em", color: "var(--doc-warm-gray)", marginLeft: "0.3rem" }}>
                              ({lp.citation})
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {c.focusedHistoryQuestions?.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Focused History Questions</div>
                  <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                    {c.focusedHistoryQuestions.map((hq, i) => (
                      <li key={i} className="keep-together" style={{ marginBottom: "0.75rem", paddingLeft: "0.85rem", borderLeft: "1px solid var(--doc-hairline)" }}>
                        <div style={{ fontWeight: 500 }}>{hq.question}</div>
                        <div style={{ fontSize: "0.82rem", color: "var(--doc-warm-gray)", fontStyle: "italic", marginTop: "0.15rem" }}>{hq.rationale}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {c.physicalExam?.maneuver && (
                <div className="keep-together" style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Physical Examination</div>
                  <div style={{ fontWeight: 600, color: "var(--doc-navy)", marginBottom: "0.4rem" }}>{c.physicalExam.maneuver}</div>
                  {c.physicalExam.steps?.length > 0 && (
                    <ol style={{ margin: "0 0 0.5rem", paddingLeft: "1.3rem" }}>
                      {c.physicalExam.steps.map((st, i) => <li key={i} style={{ marginBottom: "0.2rem" }}>{st}</li>)}
                    </ol>
                  )}
                  {c.physicalExam.interpretation && (
                    <div style={{ fontSize: "0.85rem", color: "var(--doc-warm-gray)", fontStyle: "italic" }}>
                      Interpretation: {c.physicalExam.interpretation}
                    </div>
                  )}
                </div>
              )}

              {c.keyLabsAndImaging?.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Key Labs & Imaging</div>
                  <div className="doc-table-scroll">
                  <table className="doc-table" style={{ fontSize: "0.82rem" }}>
                    <thead>
                      <tr>
                        <th>Study</th>
                        <th>Purpose</th>
                        <th>Interpretation</th>
                        <th>Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.keyLabsAndImaging.map((lab, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 500, color: "var(--doc-navy)" }}>{lab.study}</td>
                          <td>{lab.purpose}</td>
                          <td>{lab.interpretation}</td>
                          <td>{lab.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {c.treatmentApproach && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Treatment Approach</div>
                  {c.treatmentApproach.firstLine?.length > 0 && (
                    <div className="keep-together" style={{ marginBottom: "1rem" }}>
                      <div className="doc-meta-label" style={{ marginBottom: "0.4rem" }}>First-Line Management</div>
                      <div className="doc-table-scroll">
                        <table className="doc-table">
                          <thead>
                            <tr>
                              <th>Treatment</th>
                              <th>Dosing</th>
                              <th>Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.treatmentApproach.firstLine.map((t, i) => (
  <tr key={i}>
    <td style={{ fontWeight: 500, color: "var(--doc-navy)" }}>{stripTreatmentVerb(t.treatment)}</td>
    <td>{t.dosing}</td>
    <td style={{ fontFamily: "'Source Serif 4', serif", fontStyle: "italic", color: "var(--doc-warm-gray)" }}>{t.evidence}</td>
  </tr>
))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {c.treatmentApproach.additional?.length > 0 && (
                    <div>
                      <div className="doc-meta-label" style={{ marginBottom: "0.4rem" }}>Additional Considerations</div>
                      <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                        {c.treatmentApproach.additional.map((a, i) => <li key={i} style={{ marginBottom: "0.3rem" }}>{a}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {c.patientContextConsiderations && (
                <div className="keep-together" style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Patient Context</div>
                  <p style={{ margin: 0 }}>{c.patientContextConsiderations}</p>
                </div>
              )}

              {c.communicationTeaching?.scenario && (
                <div className="keep-together" style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Communication Teaching</div>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <span style={{ fontWeight: 600, color: "var(--doc-navy)" }}>Scenario. </span>
                    {c.communicationTeaching.scenario}
                  </div>
                  {c.communicationTeaching.script && (
                    <div style={{
                      padding: "0.75rem 1rem",
                      background: "var(--doc-paper)",
                      borderLeft: "2px solid var(--doc-navy-mid)",
                      fontFamily: "'Source Serif 4', serif",
                      fontStyle: "italic",
                      fontSize: "0.92rem",
                      lineHeight: 1.55,
                    }}>
                      "{c.communicationTeaching.script}"
                    </div>
                  )}
                </div>
              )}

              {c.recommendedReading?.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Recommended Reading</div>
                  <ol style={{ margin: 0, paddingLeft: "1.3rem" }}>
                    {c.recommendedReading.map((r, i) => (
                      <li key={i} style={{ marginBottom: "0.5rem" }}>
                        <span style={{ fontWeight: 500, color: "var(--doc-navy)" }}>{r.reference}</span>
                        {r.relevance && <div style={{ fontSize: "0.82rem", color: "var(--doc-warm-gray)", fontStyle: "italic", marginTop: "0.1rem" }}>{r.relevance}</div>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {c.clinicalPearl && (
                <div className="doc-callout-pearl">
                  <div className="label">Clinical Pearl</div>
                  <div style={{ fontSize: "0.92rem", fontStyle: "italic", fontFamily: "'Source Serif 4', serif" }}>{c.clinicalPearl}</div>
                </div>
              )}

              {c.quoteToDiscuss && (
                <div className="doc-callout-quote">
                  <div className="label">Patient's Voice</div>
                  <div className="quote-text">{c.quoteToDiscuss}</div>
                </div>
              )}
            </section>
          );
        })}

        {/* Lab Trends */}
        {s.labTrends?.enabled && s.labTrends.content?.length > 0 && (
          <section style={{ marginTop: "2.5rem" }}>
            <h2 className="doc-h2">Lab & Vital Trends for Interpretation</h2>
            <div className="doc-table-scroll">
            <table className="doc-table">
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Parameter</th>
                  <th style={{ width: "33%" }}>Trend</th>
                  <th>Teaching Point</th>
                </tr>
              </thead>
              <tbody>
                {s.labTrends.content.map((t, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500, color: "var(--doc-navy)" }}>{t.parameter}</td>
                    <td>{t.trend}</td>
                    <td style={{ fontStyle: "italic", color: "var(--doc-warm-gray)" }}>{t.teachingPoint || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
        )}

        {/* Cross-Cutting Themes */}
        {s.crossCuttingThemes?.enabled && s.crossCuttingThemes.content?.length > 0 && (
          <section style={{ marginTop: "2.5rem" }}>
            <h2 className="doc-h2">Cross-Cutting Themes</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
              {s.crossCuttingThemes.content.map((t, i) => (
                <div key={i} className="keep-together" style={{
                  padding: "1rem 1.15rem",
                  background: "var(--doc-paper)",
                  borderTop: "2px solid var(--doc-navy-mid)",
                }}>
                  <div className="doc-meta-label" style={{ marginBottom: "0.35rem" }}>Theme {String(i + 1).padStart(2, "0")}</div>
                  <div style={{ fontSize: "0.9rem" }}>{t}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Evidence Deep-Dive */}
{s.synthesizedEvidence?.enabled && s.synthesizedEvidence.content && (
          <div style={{ marginTop: "2.5rem" }}>
            <EvidenceDeepDive content={s.synthesizedEvidence.content} allSourceImages={doc.allSourceImages} isPreview={doc.isPreview} />
          </div>
        )}

        {/* Practice Questions */}
        {enabledCases.some(tc => tc.data.shelfQuestions?.length > 0) && (
          <section style={{ marginTop: "2.5rem" }}>
            <h2 className="doc-h2">Practice Questions</h2>
            <p style={{ marginTop: "-0.5rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "var(--doc-warm-gray)", fontStyle: "italic" }}>
              Shelf-style questions covering the problems taught in this case.
            </p>
            {enabledCases.map((tc, caseIdx) => {
              if (!tc.data.shelfQuestions?.length) return null;
              return (
                <div key={caseIdx} style={{ marginBottom: "2rem" }}>
                  <div className="doc-subsection-label" style={{ marginBottom: "0.75rem" }}>{tc.data.problem}</div>
                  {tc.data.shelfQuestions.map((q, i) => (
                    <div key={i} className="doc-shelf-q keep-together">
                      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.6rem" }}>
                        <span className="doc-meta-label" style={{ flexShrink: 0 }}>Q{i + 1}</span>
                        <div style={{ flex: 1 }}>{q.vignette}</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.35rem 1.5rem", paddingLeft: "2.2rem", marginBottom: "0.5rem" }}>
                        {q.options && Object.entries(q.options).map(([letter, opt]) => (
                          <div key={letter} style={{
                            fontSize: "0.87rem",
                            fontWeight: q.correctAnswer === letter ? 600 : 400,
                            color: q.correctAnswer === letter ? "var(--doc-consensus)" : "inherit",
                          }}>
                            <span style={{ fontWeight: 600, marginRight: "0.35rem" }}>{letter})</span>{opt}
                          </div>
                        ))}
                      </div>
                      <div className="doc-shelf-answer" style={{ marginLeft: "2.2rem" }}>
                        <div className="label">Answer · {q.correctAnswer}</div>
                        <div style={{ fontSize: "0.87rem" }}>{q.explanation}</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        )}

        {/* Long-term Goals + Next Session Prep — side by side */}
        {(s.longTermGoals?.enabled || s.nextSessionPrep?.enabled) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "2rem", marginTop: "2.5rem" }}>
            {s.longTermGoals?.enabled && s.longTermGoals.content?.length > 0 && (() => {
              // Show 5 most recent goals; note if more exist. Assumes goals with numeric id (Date.now())
              // sort descending; fall back to array order if IDs aren't sortable.
              const goals = [...s.longTermGoals.content].sort((a, b) => (b.id || 0) - (a.id || 0));
              const shown = goals.slice(0, 5);
              const hidden = goals.length - shown.length;
              return (
                <section>
                  <h2 className="doc-h2">Ongoing Learning Goals</h2>
                  <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                    {shown.map(g => (
                      <li key={g.id} style={{ marginBottom: "0.75rem", paddingLeft: "0.85rem", borderLeft: "2px solid var(--doc-navy-mid)" }}>
                        <div>{g.text}</div>
                        <div className="doc-meta-label" style={{ marginTop: "0.2rem" }}>Added {g.added}</div>
                      </li>
                    ))}
                  </ul>
                  {hidden > 0 && (
                    <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "var(--doc-warm-gray)", fontStyle: "italic" }}>
                      + {hidden} additional long-term goal{hidden !== 1 ? "s" : ""} not shown here.
                    </div>
                  )}
                </section>
              );
            })()}
            {s.nextSessionPrep?.enabled && (
              <section>
                <h2 className="doc-h2">Prep for Next Session</h2>
                {s.nextSessionPrep.reflectionQuestions?.length > 0 && (
                  <div style={{ marginBottom: "1rem" }}>
                    <div className="doc-meta-label" style={{ marginBottom: "0.4rem" }}>Reflect On</div>
                    <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                      {s.nextSessionPrep.reflectionQuestions.map((q, i) => <li key={i} style={{ marginBottom: "0.3rem" }}>{q}</li>)}
                    </ul>
                  </div>
                )}
                {/* Case-specific action items derived from what's in the document */}
                <div className="doc-meta-label" style={{ marginBottom: "0.4rem" }}>Come Prepared To Discuss</div>
                <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  {(() => {
                    const items = [];
                    // 1. Diagnoses from teaching cases
                    const dxNames = enabledCases.map(tc => tc.data.primaryDiagnosis?.name).filter(Boolean);
                    if (dxNames.length > 0) {
                      items.push(<li key="dx" style={{ marginBottom: "0.3rem" }}>Your working understanding of <strong>{dxNames.join(", ")}</strong> — be ready to walk through the differential and reasoning.</li>);
                    }
                    // 2. Any recommended reading from any case
                    const readings = enabledCases.flatMap(tc => (tc.data.recommendedReading || []).map(r => r.reference)).filter(Boolean);
                    if (readings.length > 0) {
                      const first = readings.slice(0, 3);
                      items.push(<li key="reading" style={{ marginBottom: "0.3rem" }}>Have skimmed: {first.join("; ")}{readings.length > 3 ? `, and ${readings.length - 3} more` : ""}.</li>);
                    }
                    // 3. Reflection questions handled above; here add a general "bring questions"
                    if (s.nextSessionPrep.reflectionQuestions?.length > 0) {
                      items.push(<li key="reflect" style={{ marginBottom: "0.3rem" }}>Any thoughts on the reflection questions above.</li>);
                    }
                    // 4. Something you were unsure about
                    items.push(<li key="unsure" style={{ marginBottom: "0.3rem" }}>One thing from this case that still feels unclear — bring it as a question.</li>);
                    // 5. If patient had a specific quote, prompt discussion of communication
                    const hasQuote = enabledCases.some(tc => tc.data.quoteToDiscuss?.trim());
                    if (hasQuote) {
                      items.push(<li key="quote" style={{ marginBottom: "0.3rem" }}>How you'd respond to the patient's own words highlighted in this document.</li>);
                    }
                    return items;
                  })()}
                </ul>
              </section>
            )}
          </div>
        )}
{/* Reference Figures (user-attached images) */}
        {doc.imageAttachments && doc.imageAttachments.length > 0 && (
          <section style={{ marginTop: "2.5rem" }} className="keep-together">
            <h2 className="doc-h2">Reference Figures</h2>
            <p style={{ marginTop: "-0.5rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: "var(--doc-warm-gray)", fontStyle: "italic" }}>
              Figures your attending attached for you to review — clinical images, diagrams, or reference tables relevant to today's case.
            </p>
            <div className="doc-figures-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
              {doc.imageAttachments.map((img, i) => (
                <figure key={img.id || i} className="keep-together" style={{ margin: 0, border: "1px solid var(--doc-hairline)", background: "white", padding: "0.5rem" }}>
                  <img src={img.dataUrl} alt={img.caption || img.filename || `Figure ${i+1}`} style={{ width: "100%", height: "auto", maxHeight: "400px", objectFit: "contain", display: "block" }} />
                  <figcaption style={{ fontSize: "0.78rem", color: "var(--doc-warm-gray)", marginTop: "0.5rem", padding: "0 0.25rem" }}>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: "0.65rem", color: "var(--doc-navy)", marginRight: "0.4rem" }}>
                      Figure {i + 1}
                    </span>
                    {img.caption || img.filename || ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <div className="doc-footer">
          <div>Trek Foothills LIC Teaching Document · Aligned with the CU School of Medicine MEPO framework</div>
          <div style={{ marginTop: "0.35rem", fontStyle: "italic" }}>For educational purposes only. Verify citations, dosing, and current recommendations before clinical application.</div>
          <div style={{ marginTop: "0.5rem", fontSize: "0.65rem" }}>
            Generated {doc.generated} · Session {doc.sessionId || "unsaved"}
            {doc.sessionTitle && ` · "${doc.sessionTitle}"`}
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "0.6rem", opacity: 0.7 }}>
            Created with LIC Teaching Document Generator
            {doc.appOrigin && (
              <> · <a href={`${doc.appOrigin}?session=${doc.sessionId || ""}`} style={{ color: "inherit", textDecoration: "underline" }}>{doc.appOrigin}</a></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ EVIDENCE DEEP-DIVE (structured claims rendering) ============
function EvidenceDeepDive({ content, allSourceImages = [], isPreview = false }) {
  const [expandedClaims, setExpandedClaims] = React.useState({});
  const [showProvenance, setShowProvenance] = React.useState(false);
  const [lightboxImg, setLightboxImg] = React.useState(null);

  const figureMap = React.useMemo(() => {
    const map = {};
    (content.allFigures || []).forEach(f => { map[f.id] = f; });
    return map;
  }, [content.allFigures]);

  if (!content.synthesized && content.singleSource) {
    return (
      <section>
        <h2 className="doc-h2">Evidence Deep-Dive</h2>
        <div style={{ fontSize: "0.9rem" }} dangerouslySetInnerHTML={{ __html: content.singleSource.contentHtml || "" }} />
      </section>
    );
  }

  if (!content.synthesized || !content.topics?.length) return null;

  const toggleClaim = (key) => setExpandedClaims(prev => ({ ...prev, [key]: !prev[key] }));

  const categoryOrder = { diagnosis: 1, workup: 2, treatment: 3, monitoring: 4, special: 5, other: 6 };
  const orderedTopics = [...content.topics].sort((a, b) =>
    (categoryOrder[a.orderingCategory] || 99) - (categoryOrder[b.orderingCategory] || 99)
  );

  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", paddingBottom: "0.5rem", borderBottom: "2px solid var(--doc-navy)" }}>
        <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: "1.0625rem", fontWeight: 600, color: "var(--doc-navy)", margin: 0 }}>Evidence Deep-Dive</h2>
        <button
          onClick={() => setShowProvenance(!showProvenance)}
          className="no-print"
          style={{ fontSize: "0.7rem", color: "var(--doc-warm-gray)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
        >
          {showProvenance ? "Hide" : "Show"} AI-tool provenance
        </button>
      </div>
{isPreview && content.sourceContribution?.length > 0 && (
        <div style={{ marginBottom: "1.25rem", padding: "0.75rem 1rem", background: "var(--doc-paper)", border: "1px solid var(--doc-hairline)", borderRadius: "2px", position: "relative" }}>
          <div style={{ position: "absolute", top: "-0.6rem", left: "1rem", background: "#f59e0b", color: "white", fontSize: "0.6rem", fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: "3px" }}>
            Preview only · won't appear in final document
          </div>
          <div className="doc-meta-label" style={{ marginBottom: "0.5rem", marginTop: "0.25rem" }}>Sources Contributing to This Synthesis</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {content.sourceContribution.map((sc, i) => {
              const citingClaims = (content.topics || []).reduce((acc, topic) => {
                return acc + (topic.claims || []).filter(c =>
                  (c.provenance || c.sources || []).some(p => p === sc.source)
                ).length;
              }, 0);
              const totalClaims = (content.topics || []).reduce((acc, topic) => acc + (topic.claims?.length || 0), 0);
              const pct = totalClaims > 0 ? Math.round((citingClaims / totalClaims) * 100) : 0;
              const isPdf = !!sc.fullCitation || sc.source.startsWith("PDF:");
              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", fontSize: "0.82rem" }}>
                  <div style={{ minWidth: "180px", fontWeight: 500, color: isPdf ? "var(--doc-terracotta)" : "var(--doc-navy)" }}>
                    {isPdf && <span style={{ marginRight: "0.3rem" }}>📄</span>}
                    {sc.source}
                    {sc.fullCitation && (
                      <div style={{ fontSize: "0.7rem", fontWeight: 400, fontStyle: "italic", color: "var(--doc-warm-gray)", marginTop: "0.1rem" }}>
                        {sc.fullCitation}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, height: "6px", background: "#e5e0d5", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: isPdf ? "var(--doc-terracotta)" : "var(--doc-navy-mid)",
                      transition: "width 0.3s",
                    }}></div>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: citingClaims === 0 ? "var(--doc-terracotta)" : "var(--doc-warm-gray)", minWidth: "140px", textAlign: "right", fontWeight: citingClaims === 0 ? 600 : 400 }}>
                    {citingClaims} of {totalClaims} claims · {sc.wordCount.toLocaleString()} words
                    {citingClaims === 0 && <div style={{ fontSize: "0.65rem", fontWeight: 500, fontStyle: "italic", marginTop: "0.1rem" }}>not cited — content may overlap with other sources</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {content.sourceContribution.some(sc => sc.source.startsWith("PDF:")) &&
           content.sourceContribution.filter(sc => sc.source.startsWith("PDF:")).every(sc => {
             const citing = (content.topics || []).reduce((acc, topic) => acc + (topic.claims || []).filter(c => (c.provenance || c.sources || []).includes(sc.source)).length, 0);
             return citing === 0;
           }) && (
            <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "rgba(184, 92, 46, 0.08)", borderLeft: "2px solid var(--doc-terracotta)", fontSize: "0.75rem", color: "var(--doc-terracotta)" }}>
              ⚠ PDF content was provided but the AI did not attribute any claims to it. The content may have overlapped with other sources, or the AI may not have found unique claims to draw from it.
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {orderedTopics.map((topic, ti) => (
          <div key={ti} className="keep-together">
            <div className="doc-subsection-label" style={{ marginBottom: "0.75rem" }}>{topic.topic}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {topic.claims?.map((claim, ci) => {
                const claimKey = `${ti}-${ci}`;
                const hasDetail = claim.perSourceDetail?.length > 0;
                const refFigures = (claim.figureRefs || []).map(id => figureMap[id]).filter(Boolean);
                const realCitations = claim.citations || [];
                const provenanceTools = claim.provenance || claim.sources || [];
                const strength = claim.strength || "single-source";
                const strengthLabels = { consensus: "Consensus", majority: "Majority", "single-source": "Single source", conflict: "Conflict" };
                return (
                  <div key={ci} className="keep-together" style={{ paddingLeft: "0.85rem", borderLeft: "1px solid var(--doc-hairline)" }}>
                    <div style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
                      {claim.statement}
                      {realCitations.length > 0 && (
                        <span style={{ fontFamily: "'Source Serif 4', serif", fontStyle: "italic", fontSize: "0.85em", color: "var(--doc-warm-gray)", marginLeft: "0.35rem" }}>
                          ({realCitations.join("; ")})
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", marginTop: "0.4rem", flexWrap: "wrap" }} className="no-print">
                      <span className={`doc-strength ${strength}`}>
                        <span className="dot"></span>{strengthLabels[strength]}
                      </span>
                      {showProvenance && provenanceTools.length > 0 && (
                        <span style={{ fontSize: "0.7rem", color: "var(--doc-warm-gray)" }}>
                          via {provenanceTools.join(", ")}
                        </span>
                      )}
                      {hasDetail && showProvenance && (
                        <button
                          onClick={() => toggleClaim(claimKey)}
                          style={{ fontSize: "0.7rem", color: "var(--doc-navy-mid)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          {expandedClaims[claimKey] ? "Hide" : "Show"} per-tool detail
                        </button>
                      )}
                    </div>
                    {showProvenance && expandedClaims[claimKey] && hasDetail && (
                      <div style={{ marginTop: "0.5rem", padding: "0.6rem 0.85rem", background: "var(--doc-paper)", borderLeft: "2px solid var(--doc-navy-mid)" }} className="no-print">
                        {claim.perSourceDetail.map((psd, pi) => (
                          <div key={pi} style={{ fontSize: "0.78rem", marginBottom: pi < claim.perSourceDetail.length - 1 ? "0.35rem" : 0 }}>
                            <span style={{ fontWeight: 600, color: "var(--doc-navy)" }}>{psd.source}:</span>
                            <span style={{ color: "var(--doc-warm-gray)", marginLeft: "0.3rem" }}>{psd.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {refFigures.length > 0 && (
                      <div style={{ marginTop: "0.6rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.6rem" }}>
                        {refFigures.map((fig, fi) => (
                          <figure key={fi} style={{ margin: 0, border: "1px solid var(--doc-hairline)", background: "white" }}>
                            <button
                              onClick={() => setLightboxImg(fig)}
                              className="no-print"
                              style={{ display: "block", width: "100%", padding: 0, border: "none", background: "none", cursor: "zoom-in" }}
                              title="Click to enlarge"
                            >
                              <img src={fig.dataUrl} alt={fig.alt} style={{ width: "100%", height: "auto", maxHeight: "260px", objectFit: "contain", display: "block" }} />
                            </button>
                            <img className="print-only" src={fig.dataUrl} alt={fig.alt} style={{ width: "100%", height: "auto", maxHeight: "260px", objectFit: "contain", display: "none" }} />
                            <figcaption style={{ fontSize: "0.72rem", color: "var(--doc-warm-gray)", padding: "0.35rem 0.5rem", borderTop: "1px solid var(--doc-hairline)", fontStyle: "italic" }}>
                              {fig.alt}
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {content.keyTakeaways?.length > 0 && (
        <div style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", background: "var(--doc-paper)", borderLeft: "3px solid var(--doc-navy-mid)" }} className="keep-together">
          <div className="doc-meta-label" style={{ marginBottom: "0.5rem" }}>Key Takeaways</div>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {content.keyTakeaways.map((t, i) => <li key={i} style={{ fontSize: "0.9rem", marginBottom: "0.25rem" }}>{t}</li>)}
          </ul>
        </div>
      )}

      {content.crossReferenceMatrix?.length > 0 && (
        <div style={{ marginTop: "1.5rem" }} className="keep-together">
          <div className="doc-meta-label" style={{ marginBottom: "0.5rem" }}>Topic → Primary References</div>
          <div className="doc-table-scroll">
          <table className="doc-table" style={{ fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th>Topic</th>
                <th>Primary References</th>
                {showProvenance && <th className="no-print">AI Tools</th>}
              </tr>
            </thead>
            <tbody>
              {content.crossReferenceMatrix.map((row, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500, color: "var(--doc-navy)" }}>{row.topic}</td>
                  <td>{(row.primaryReferences || row.addressedBy || []).join("; ") || "—"}</td>
                  {showProvenance && <td className="no-print" style={{ fontStyle: "italic", color: "var(--doc-warm-gray)" }}>{(row.provenanceTools || []).join(", ") || "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {lightboxImg && <ImageLightbox src={lightboxImg.dataUrl} alt={lightboxImg.alt} onClose={() => setLightboxImg(null)} />}
    </section>
  );
}



// ============ IMAGE LIGHTBOX ============
function ImageLightbox({ src, alt, onClose }) {
  React.useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="no-print image-lightbox-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 42, 68, 0.92)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        cursor: "zoom-out",
      }}
    >
      <style>{`
        @media (max-width: 640px) {
          .image-lightbox-overlay {
            padding: 0.5rem !important;
          }
          .image-lightbox-close {
            width: 3rem !important;
            height: 3rem !important;
            font-size: 1.5rem !important;
            top: 0.5rem !important;
            right: 0.5rem !important;
          }
        }
      `}</style>
      <button
        onClick={onClose}
        className="image-lightbox-close"
        style={{
          position: "absolute",
          top: "1rem",
          right: "1rem",
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.3)",
          color: "white",
          borderRadius: "50%",
          width: "2.5rem",
          height: "2.5rem",
          fontSize: "1.25rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
        aria-label="Close"
      >
        ×
      </button>
      <img
        src={src}
        alt={alt}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: "95vw",
          maxHeight: "85vh",
          objectFit: "contain",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          borderRadius: "4px",
          cursor: "default",
        }}
      />
      {alt && (
        <div style={{
          marginTop: "1rem",
          color: "rgba(255,255,255,0.85)",
          fontFamily: "'Inter', sans-serif",
          fontSize: "0.85rem",
          fontStyle: "italic",
          maxWidth: "60ch",
          textAlign: "center",
        }}>
          {alt}
        </div>
      )}
      <div style={{
        marginTop: "0.75rem",
        color: "rgba(255,255,255,0.5)",
        fontFamily: "'Inter', sans-serif",
        fontSize: "0.7rem",
        textTransform: "uppercase",
        letterSpacing: "0.15em",
      }}>
        Click anywhere or press Esc to close
      </div>
    </div>
  );
}

// ============ PROMPT VIEWER MODAL ============
function PromptViewer({ sourceName, initialPrompt, compact = false, onCopy, onClose }) {
  const [editedPrompt, setEditedPrompt] = React.useState(initialPrompt);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(editedPrompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      onClick={onClose}
      className="no-print prompt-viewer-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 42, 68, 0.6)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <style>{`
        /* Full-screen modal on mobile — the desktop 2rem padding + centered card
           wastes space on phones. Below 640px we edge-to-edge the modal. */
        @media (max-width: 640px) {
          .prompt-viewer-overlay {
            padding: 0 !important;
            align-items: stretch !important;
          }
          .prompt-viewer-panel {
            max-width: none !important;
            max-height: none !important;
            height: 100vh !important;
            border-radius: 0 !important;
          }
          .prompt-viewer-header {
            padding: 0.75rem 1rem !important;
          }
          .prompt-viewer-header-title {
            font-size: 1rem !important;
          }
          .prompt-viewer-textarea {
            padding: 0.75rem 1rem !important;
            font-size: 0.9rem !important;
          }
          .prompt-viewer-footer {
            padding: 0.65rem 1rem !important;
            flex-wrap: wrap;
            gap: 0.5rem !important;
          }
        }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        className="prompt-viewer-panel"
        style={{
          background: "white",
          borderRadius: "8px",
          maxWidth: "800px",
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
      >
        <div className="prompt-viewer-header" style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0F2A44 0%, #1a3d5c 100%)",
          color: "white",
        }}>
          <div>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.7 }}>Prompt for</div>
            <div className="prompt-viewer-header-title" style={{ fontSize: "1.1rem", fontWeight: 600, marginTop: "0.15rem" }}>{sourceName}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.3)",
              color: "white",
              borderRadius: "50%",
              width: "2rem",
              height: "2rem",
              fontSize: "1.1rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: "0.75rem 1.25rem", background: "#fef3c7", borderBottom: "1px solid #fde68a", fontSize: "0.8rem", color: "#78350f", display: "flex", alignItems: "start", gap: "0.5rem" }}>
          <AlertCircle style={{ width: "1rem", height: "1rem", flexShrink: 0, marginTop: "0.1rem" }} />
          <div>You can edit this prompt before copying, but edits won't persist across sessions. The saved template will regenerate next time you view it.</div>
        </div>

        <textarea
          value={editedPrompt}
          onChange={e => setEditedPrompt(e.target.value)}
          spellCheck={false}
          className="prompt-viewer-textarea"
          style={{
            flex: 1,
            padding: "1rem 1.25rem",
            border: "none",
            outline: "none",
            resize: "none",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            fontSize: "0.85rem",
            lineHeight: 1.5,
            color: "#334155",
            minHeight: compact ? "120px" : "300px",
          }}
        />

        <div className="prompt-viewer-footer" style={{
          padding: "0.75rem 1.25rem",
          borderTop: "1px solid #e5e7eb",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
            {editedPrompt.length.toLocaleString()} characters · {editedPrompt.split(/\s+/).filter(Boolean).length.toLocaleString()} words
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={onClose}
              style={{
                padding: "0.5rem 1rem",
                background: "white",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                fontSize: "0.85rem",
                color: "#475569",
                cursor: "pointer",
              }}
            >
              Close
            </button>
            <button
              onClick={handleCopy}
              style={{
                padding: "0.5rem 1rem",
                background: copied ? "#059669" : "#4f46e5",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                transition: "background 0.15s",
              }}
            >
              {copied ? <><Check style={{width: "0.9rem", height: "0.9rem"}} />Copied to clipboard</> : <><Copy style={{width: "0.9rem", height: "0.9rem"}} />Copy Prompt</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}