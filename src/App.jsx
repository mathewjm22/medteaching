import React, { useState, useEffect } from "react";
import { FileText, Printer, Copy, Check, Plus, X, BookOpen, Target, Stethoscope, Brain, ClipboardList, Users, TrendingUp, Save, Trash2, Sparkles, ChevronDown, ChevronRight, Calendar, User, AlertCircle, Zap, Loader2, Wand2 } from "lucide-react";

// ===== Hardcoded config =====
const WORKER_URL = "https://medteachingtool.sweet-dream-0ed6.workers.dev/";
const DEFAULT_MODEL = "gpt-oss-120b";

export default function App() {
  const [activeTab, setActiveTab] = useState("setup");
  const [saved, setSaved] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});

  // AI is enabled by default; user only toggles on/off
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiStatus, setAiStatus] = useState({ analyzing: false, generating: false, error: null });

  // Session metadata
  const [session, setSession] = useState({
    studentName: "",
    month: new Date().toLocaleString('default', { month: 'long' }),
    licStartMonth: "August",
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
  const [patientQuotes, setPatientQuotes] = useState([]);
  const [labTrends, setLabTrends] = useState([]);
  const [teachingLens, setTeachingLens] = useState("general_im");

  // Focus areas
  const [focusAreas, setFocusAreas] = useState({
    history: false, physicalExam: false, differential: false, workup: false,
    management: false, patientContext: false, ebm: false, communication: false,
  });
  const [aiSuggestedFocus, setAiSuggestedFocus] = useState(null);
const [customTopics, setCustomTopics] = useState([]);
  const [newCustomTopic, setNewCustomTopic] = useState("");
  // Sources
  const [sources, setSources] = useState({
    openevidence: false, uptodate: false, dynamed: false, doxgpt: false, pubmedai: false,
  });
  const [sourceResponses, setSourceResponses] = useState({
    openevidence: { html: "", images: [] },
    uptodate: { html: "", images: [] },
    dynamed: { html: "", images: [] },
    doxgpt: { html: "", images: [] },
    // pubmedai stores an object keyed by diagnosis: {"Diagnosis 1": {html, images}, ...}
    pubmedai: {},
  });
  const [sessionImageBytes, setSessionImageBytes] = useState(0);

  // Goals
  const [longTermGoals, setLongTermGoals] = useState([]);
  const [newGoal, setNewGoal] = useState("");
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

  // Load persisted state
  useEffect(() => {
    (async () => {
      try {
        const g = await window.storage.get("longTermGoals");
        if (g?.value) setLongTermGoals(JSON.parse(g.value));
      } catch {}
      try {
        const s = await window.storage.get("session");
        if (s?.value) setSession(JSON.parse(s.value));
      } catch {}
    })();
  }, []);

  // ===== Phase logic =====
  const getPhase = () => {
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const startIdx = months.indexOf(session.licStartMonth);
    const currentIdx = months.indexOf(session.month);
    let monthsIn = currentIdx - startIdx;
    if (monthsIn < 0) monthsIn += 12;
    if (monthsIn <= 3) return { name: "Foundational (Early LIC)", monthsIn, focus: "History-taking, physical exam basics, orientation to workflow", color: "bg-blue-50 border-blue-200 text-blue-900", pace: "1-2 patients per half-day is normal" };
    if (monthsIn <= 7) return { name: "Developing (Mid LIC)", monthsIn, focus: "Differential diagnosis, illness scripts, targeted workup, beginning management", color: "bg-purple-50 border-purple-200 text-purple-900", pace: "2-3 patients per half-day expected" };
    if (monthsIn <= 10) return { name: "Advancing (Late LIC)", monthsIn, focus: "Independent management, complex patients, pending orders, cross-specialty synthesis", color: "bg-emerald-50 border-emerald-200 text-emerald-900", pace: "3-4 patients per half-day; ready for advanced rotations" };
    return { name: "End-of-Year Transition", monthsIn, focus: "Sub-I readiness, autonomous care of common conditions", color: "bg-amber-50 border-amber-200 text-amber-900", pace: "4+ patients per session" };
  };
  const phase = getPhase();

  const mepoMap = {
    history: "Patient Care #6 (History)",
    physicalExam: "Patient Care #7 (Physical Exam)",
    differential: "Patient Care #8 (Differential Diagnosis)",
    workup: "Patient Care #9 (Diagnostic Tests)",
    management: "Patient Care #10 (Management Plan)",
    patientContext: "Patient Care #13 (Socio-ecological Model)",
    ebm: "Curiosity #24 (Evidence-Based Medicine)",
    communication: "Interpersonal & Communication Skills #15",
  };

  const focusIcons = { history: Stethoscope, physicalExam: Users, differential: Brain, workup: ClipboardList, management: Target, patientContext: Users, ebm: BookOpen, communication: Users };
  const focusLabels = { history: "History Taking", physicalExam: "Physical Exam", differential: "Differential Diagnosis", workup: "Diagnostic Workup", management: "Management Plan", patientContext: "Patient Context / SDoH", ebm: "Evidence-Based Medicine", communication: "Communication" };
  const sourceLabels = { openevidence: "OpenEvidence", uptodate: "UpToDate", dynamed: "DynaMed", doxgpt: "DoxGPT (Doximity GPT)", pubmedai: "PubMed AI" };
  const sourceUrls = {
    openevidence: "https://www.openevidence.com/",
    uptodate: "https://www.uptodate.com/contents/search",
    dynamed: "https://www.dynamed.com/",
    doxgpt: "https://www.doximity.com/gpt",
    pubmedai: "https://www.pubmed.ai/home",
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
        setAiStatus(prev => ({ ...prev, error: `Rate limited — waiting ${waitSec}s then retrying (${retryCount + 1}/${MAX_RETRIES})...` }));
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
    try {
      return JSON.parse(s);
    } catch (e) {
      // Attempt to repair truncated JSON
      let repaired = s;
      const lastComma = repaired.lastIndexOf(",");
      const lastQuote = repaired.lastIndexOf('"');
      if (lastQuote > lastComma) {
        repaired = repaired.slice(0, lastComma);
      }
      const opens = (repaired.match(/\{/g) || []).length;
      const closes = (repaired.match(/\}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;
      for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
      for (let i = 0; i < opens - closes; i++) repaired += "}";
      try {
        console.warn("[extractJson] Repaired truncated JSON");
        return JSON.parse(repaired);
      } catch (e2) {
        console.error("[extractJson] Raw response:", s.slice(0, 500));
        throw new Error(`JSON parse failed (response likely truncated): ${e.message}`);
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

  // ===== Analyze note with AI =====
const analyzeNote = async () => {
    if (!clinicalNote.trim()) return;
    if (aiStatus.analyzing || aiStatus.generating) return;
    if (!aiEnabled) {
      setAiStatus({ ...aiStatus, error: "Enable AI on the Setup tab first." });
      return;
    }
    setAiStatus({ analyzing: true, generating: false, error: null });
    try {
      const lensGuidance = {
        general_im: "This is a general internal medicine encounter.",
        geriatrics: "This is a geriatrics-focused encounter. Emphasize teaching on: Beers criteria, anticholinergic burden, STOPP/START criteria, deprescribing, goals-of-care, functional assessment, fall risk, dementia care, polypharmacy.",
        primary_care: "This is a primary care / annual wellness encounter. Emphasize: preventive care, chronic disease management, USPSTF recommendations, shared decision-making, motivational interviewing.",
        complex_multimorbidity: "This is a complex multi-morbid patient. Emphasize: problem prioritization, medication reconciliation, care coordination, competing treatment goals."
      };

      const sys = `You are a medical education assistant analyzing a clinical note for a medical student in a longitudinal integrated clerkship.

${lensGuidance[teachingLens]}

The note may have structured sections (Assessment, Plan, PMH, Meds, Labs, etc.), multiple active problems, direct patient/caregiver quotes, and trended lab/vital data. Extract all of this.

Available focus areas: history, physicalExam, differential, workup, management, patientContext, ebm, communication

Return ONLY valid JSON (no markdown fences):
{
  "chiefConcern": "brief chief concern or reason for visit",
  "workingDiagnosis": "primary/most teachable diagnosis, or 'multiple active problems' if truly multi-focal",
  "activeProblems": [
    {"problem": "problem name", "icdContext": "ICD if in note", "teachingValue": "brief note on why teachable", "keyIssue": "the core clinical question or dilemma"}
  ],
  "otherDiagnoses": ["list of other active problems as strings"],
  "keyTopics": ["specific clinical topics worth teaching - be specific"],
  "suggestedFocus": ["3-5 focus area keys from the list above"],
  "reasoning": "2-3 sentence explanation",
  "complexity": "common" or "complex",
  "redFlags": ["concerning features, can't-miss diagnoses, iatrogenic risks"],
  "patientQuotes": ["direct quotes verbatim from the note"],
  "labTrends": [
    {"parameter": "lab name", "trend": "brief description", "teachingPoint": "what this teaches"}
  ]
}`;
      const extractedForAnalysis = extractEssentialNote(clinicalNote);
      console.log(`[analyzeNote] Note: ${clinicalNote.length} chars → ${extractedForAnalysis.length} chars`);
      const user = `Clinical note (de-identified):\n\n${extractedForAnalysis}\n\nStudent is in month ${phase.monthsIn} of LIC (${phase.name} phase). Focus on: ${phase.focus}`;
      const response = await callAi(sys, user, 4000);
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
      if (parsed.suggestedFocus) {
        setAiSuggestedFocus(parsed.suggestedFocus);
        const newFocus = { ...focusAreas };
        Object.keys(newFocus).forEach(k => { newFocus[k] = false; });
        parsed.suggestedFocus.forEach(k => { if (k in newFocus) newFocus[k] = true; });
        setFocusAreas(newFocus);
      }
      setAiStatus({ analyzing: false, generating: false, error: null });
    } catch (e) {
      setAiStatus({ analyzing: false, generating: false, error: e.message });
    }
  };

  // ===== Synthesize multiple external source responses =====
  // ===== Integrate external source responses into the document's voice =====
  const synthesizeSources = async () => {
    const filledSources = activeSources.filter(s => {
      if (s === "pubmedai") {
        return Object.values(sourceResponses.pubmedai || {}).some(v => v?.html?.trim());
      }
      return sourceResponses[s]?.html?.trim();
    });
    if (filledSources.length === 0) return null;
    if (!aiEnabled) {
      // Fallback: just show raw content
      if (filledSources.length === 1) {
        const src = filledSources[0];
        return { synthesized: false, singleSource: { source: sourceLabels[src], content: sourceResponses[src] } };
      }
      return null;
    }

    const sys = `You are a teaching attending integrating evidence from ${filledSources.length === 1 ? 'a trusted source' : 'multiple trusted sources'} into a cohesive teaching narrative for your medical student. 

Do NOT paste content verbatim. Instead, REWRITE the key findings in your own attending voice — conversational, direct, teaching-focused. Attribute inline naturally (e.g., "According to OpenEvidence, the current recommendation is..." or "UpToDate frames this as...").

Structure your integration around clinical themes that emerged, not around which source said what. When sources agree, present the consensus. When they differ, present both positions and explain what the disagreement is about.

Return ONLY valid JSON (no markdown fences):
{
  "integratedNarrative": [
    {"topic": "clinical topic or question this addresses", "attendingCommentary": "2-4 paragraphs written in your attending voice that weave the source content into teaching prose — reference the sources by name where appropriate but do NOT paste their content verbatim", "sources": ["source names contributing to this section"]}
  ],
  "keyTakeaways": ["3-5 bullet takeaways for the student, phrased as things to remember"],
  "conflicts": [
    {"topic": "topic where sources disagreed", "explanation": "attending-voice explanation of the disagreement and how you'd approach it clinically"}
  ]
}`;

    // Strip HTML tags and replace images with placeholders for AI consumption
    const htmlToAiText = (html) => {
      const div = document.createElement("div");
      div.innerHTML = html || "";
      let figIdx = 0;
      div.querySelectorAll("img").forEach(img => {
        figIdx++;
        const alt = img.alt || "figure";
        const placeholder = document.createTextNode(` [Figure ${figIdx}: ${alt}] `);
        img.replaceWith(placeholder);
      });
      return div.textContent.replace(/\s+/g, " ").trim();
    };

    const sourceText = filledSources.map(s => {
      if (s === "pubmedai") {
        const perTopic = Object.entries(sourceResponses.pubmedai || {})
          .filter(([_, v]) => v?.html?.trim())
          .map(([topic, content]) => `--- PubMed AI on "${topic}" ---\n${htmlToAiText(content.html)}`)
          .join("\n\n");
        return `=== FROM PUBMED AI (per topic) ===\n${perTopic}`;
      }
      return `=== FROM ${sourceLabels[s].toUpperCase()} ===\n${htmlToAiText(sourceResponses[s].html)}`;
    }).join("\n\n");
    const user = `Chief concern: ${chiefConcern}\nProblems being taught: ${selectedProblems.join("; ") || workingDx}\n\nSource content to integrate into a cohesive teaching narrative:\n\n${sourceText}\n\nRewrite this in your attending voice. Do NOT quote source text verbatim. Organize by clinical themes, not by source.`;

    const response = await callAi(sys, user, 4000);
    const parsed = extractJson(response);
    return { synthesized: true, ...parsed, sourcesUsed: filledSources.map(s => sourceLabels[s]) };
  };

  // ===== Generate case-specific teaching content =====
  // Generates ONE teaching case per API call with waits between,
  // to stay under Groq's tokens-per-minute rate limit.
  const generateAiTeachingContent = async () => {
    const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
    if (activeFocus.length === 0) return null;
    if (!aiEnabled) return null;

    const lensGuidance = {
      general_im: "",
      geriatrics: " Weave in Beers criteria, anticholinergic burden, STOPP/START, deprescribing, 4Ms framework where relevant.",
      primary_care: " Weave in USPSTF grades, shared decision-making, chronic disease guidelines.",
      complex_multimorbidity: " Weave in problem prioritization, competing goals, care coordination."
    };

    const problemsToTeach = [
      ...(selectedProblems.length > 0 ? selectedProblems : (workingDx ? [workingDx] : [])),
      ...customTopics,
    ];
    if (problemsToTeach.length === 0) problemsToTeach.push("primary clinical problem");

    const difficulty = phase.monthsIn <= 3 ? "Foundational (basic pattern recognition, single-step)"
      : phase.monthsIn <= 7 ? "Developing (illness scripts, multi-step reasoning)"
      : phase.monthsIn <= 10 ? "Advancing (complex vignettes, management judgment)"
      : "Sub-I (multi-problem integration, judgment under uncertainty)";

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
    const notePayload = extracted.length > MAX_NOTE
      ? extracted.slice(0, MAX_NOTE) + "\n[truncated]"
      : extracted;

// Strip HTML/images to plain text with figure placeholders for AI
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

    const filledSources = activeSources.filter(s => sourceResponses[s]?.html?.trim());
    const MAX_EVIDENCE_TOTAL = 8000;
    const evidencePerSource = filledSources.length > 0 ? Math.floor(MAX_EVIDENCE_TOTAL / filledSources.length) : 0;
    const evidenceContext = filledSources.length > 0
      ? "\n\nCurated evidence from clinician-selected sources (attribute inline like '(per OpenEvidence)'; do NOT invent facts beyond this evidence and the note):\n" + filledSources.map(s => {
          const t = htmlToAiText(sourceResponses[s].html);
          return `[${sourceLabels[s]}]: ${t.length > evidencePerSource ? t.slice(0, evidencePerSource) + "[truncated]" : t}`;
        }).join("\n\n")
      : "";

    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const teachingCases = [];

    // Generate one teaching case per API call, with waits between
    for (let i = 0; i < problemsToTeach.length; i++) {
      const problem = problemsToTeach[i];
      setAiStatus(prev => ({ ...prev, error: `Generating teaching case ${i+1} of ${problemsToTeach.length}: ${problem}...` }));

      const sys = `You are a warm, engaged teaching attending in internal medicine writing a personalized learning document for YOUR medical student about a patient you saw together today. Student level: ${phase.name}. Difficulty: ${difficulty}.${lensGuidance[teachingLens]}

VOICE AND TONE (CRITICAL):
- Write directly TO the student in second person ("Notice how our patient...", "When you saw Ms. X today...", "This is a case where...")
- Reference the specific patient by their pronoun and clinical story throughout — not "the patient" abstractly, but "our patient today with her 45-lb weight loss on Zepbound and 6-month lapse in levothyroxine"
- Every learning point should START with what you observed together in this specific encounter, THEN pivot to the teaching principle
- Sound like a thoughtful attending debriefing a case over coffee, not a textbook chapter
- Include the WHY behind clinical decisions ("I held off on the GYN referral today because...")
- Reference the patient's own words, concerns, life context, and social situation when relevant
- When possible, tie teaching to what YOU as the attending noticed, decided, or would want the student to walk away thinking about

CITATION RULES: Cite landmark trials by NAME only (e.g., "SPRINT trial"). Cite guidelines by ORG + YEAR (e.g., "2023 AHA/ACC"). NEVER fabricate journal names, page numbers, or authors.

EXAMPLES OF GOOD vs. BAD VOICE:
- BAD (textbook): "TSH >10 indicates severe hypothyroidism requiring treatment."
- GOOD (attending): "Our patient's TSH of 13.8 after six months off her levothyroxine tells us just how quickly the thyroid axis decompensates — she's essentially back to where she started at diagnosis. This is why I emphasized to her that adherence matters more than dose adjustments right now."

- BAD (textbook): "Menorrhagia can be caused by hypothyroidism via estrogen excess."
- GOOD (attending): "You'll remember she described her periods as 'outrageously heavy' every two weeks. Before you jump to a GYN referral, consider: uncontrolled hypothyroidism is one of the most common reversible causes of menorrhagia we see. That's why I want to treat her thyroid first — if we fix that, we may fix her bleeding without a hysterectomy."

Return ONLY valid JSON (no markdown fences, no commentary):
{
  "problem": "${problem}",
  "primaryDiagnosis": {"name": "the diagnosis", "briefDefinition": "1-2 sentences framed around what makes it relevant for THIS patient"},
  "differentialDiagnosis": [{"diagnosis": "alternative", "reasoning": "why you considered it for OUR patient — reference her actual features, meds, or context"}],
  "keyLearningPoints": [{"point": "concise title", "explanation": "2-3 sentences that START with something specific about our patient's presentation, THEN teach the concept — written TO the student", "citation": "landmark trial name or org/year"}],
  "shelfQuestions": [{"vignette": "detailed clinical vignette 3-5 sentences (can invent a new patient for the shelf-style question)", "options": {"A":"...","B":"...","C":"...","D":"..."}, "correctAnswer": "A/B/C/D", "explanation": "detailed teaching explanation of why the correct answer is right and why each distractor is wrong"}],
  "focusedHistoryQuestions": [{"question": "the question", "rationale": "what YOU as attending were listening for when I would have asked this in OUR patient's visit today"}],
  "physicalExam": {"maneuver": "exam maneuver relevant to OUR patient's presentation", "steps": ["step 1", "step 2"], "interpretation": "what a positive/negative finding would tell you about THIS patient specifically"},
  "keyLabsAndImaging": [{"study": "name", "purpose": "why I ordered/would order it for OUR patient", "interpretation": "what her actual result (or what a hypothetical result) would mean in her clinical context", "role": "how it changes management for HER"}],
  "treatmentApproach": {"firstLine": [{"treatment": "name", "dosing": "dose/route/frequency", "evidence": "trial or guideline name — but explain WHY this fits our patient"}], "additional": ["patient-specific considerations, not generic bullet points"]},
  "patientContextConsiderations": "2-3 sentences about THIS patient's specific SDoH, values, goals, and life situation — reference her actual story (job, family, MST, name issue, whatever's relevant)",
  "recommendedReading": [{"reference": "landmark trial/guideline name", "relevance": "why I want you to read this after seeing OUR patient today"}],
  "communicationTeaching": {"scenario": "a specific conversation that came up (or could have come up) in OUR visit today", "script": "example language YOU could use with this patient — reference her actual concerns, quotes, or emotional state"},
  "clinicalPearl": "one memorable teaching point framed as something YOU as the attending want the student to walk away remembering from OUR encounter today",
  "quoteToDiscuss": "if the patient said something in the note that is teachable, quote it verbatim; else empty string"
}

ALWAYS include these core sections regardless of focus selection: primaryDiagnosis, differentialDiagnosis, keyLearningPoints, shelfQuestions (exactly 3), recommendedReading, clinicalPearl, quoteToDiscuss.

Additionally include ONLY these focus-driven optional subsections based on what the attending selected: ${includedSections || "(none — core sections only)"}. Map focus keys to subsections as follows: history → focusedHistoryQuestions, physicalExam → physicalExam, workup → keyLabsAndImaging, management → treatmentApproach, patientContext → patientContextConsiderations, communication → communicationTeaching. If a focus key isn't in the selected list above, OMIT that subsection entirely (return null or empty).

Provide substantive teaching content — 2-3 sentences per learning point, thorough differential reasoning tied to case features, complete treatment rationale, and detailed shelf question explanations.

REMEMBER: This student was IN the room with you for this encounter. Write like you're reflecting on the visit with them afterward, not writing a UWorld question. Reference specifics from the note — the patient's history, quotes, labs, medications, decisions you made — as much as possible.`;
      const user = `Focus problem for this teaching case: ${problem}

Chief concern: ${chiefConcern}

Full clinical note from today's encounter:
${notePayload}${evidenceContext}

Write your teaching case as if you and the student just walked out of this patient's room together. Ground every teaching point in what you both observed in this specific patient. Use her actual clinical features, medications, quotes, and story — not abstract examples.`;
      try {
        const response = await callAi(sys, user, 8000);
        const parsed = extractJson(response);
        // Always inject the known problem name — never trust the AI to echo it correctly
        parsed.problem = problem;
        teachingCases.push(parsed);
      } catch (e) {
        console.error(`Failed to generate case for "${problem}":`, e);
        // Continue with remaining problems instead of failing entirely
      }

      if (i < problemsToTeach.length - 1) {
        setAiStatus(prev => ({ ...prev, error: `Working on case ${i+2}/${problemsToTeach.length}...` }));
        await wait(500);
      }
    }

    // Cross-cutting themes as a separate small call
    let crossCuttingThemes = [];
    let questionsForReflection = [];
    if (teachingCases.length > 1) {
      await wait(3000);
      setAiStatus(prev => ({ ...prev, error: "Generating cross-cutting themes..." }));
      try {
        const themesSys = `You are the attending debriefing a case with your medical student. Identify the CONCEPTUAL threads that connect this patient's multiple problems — not restating what the problems are, but revealing the underlying clinical reasoning threads that a student should see.

Good themes are things like: "how untreated hypothyroidism creates a cascade of downstream symptoms that mimic separate diseases" or "when to prioritize adherence over titration in complex regimens" or "the challenge of sequencing referrals when multiple specialists could be involved."

Bad themes are things like: "interrelated physical conditions" or "hormonal dysregulation affecting musculoskeletal health" — these are just categories, not insights.

Return ONLY valid JSON (no markdown fences):
{
  "crossCuttingThemes": ["2-3 specific clinical reasoning insights that thread through this patient's problems — written as full sentences from the attending's perspective"],
  "questionsForReflection": ["2-3 thought-provoking open-ended questions for the student to sit with after this encounter"]
}`;
        const problemSummaries = teachingCases.map(tc => 
          `- ${tc.problem}: ${tc.primaryDiagnosis?.name || ""} — ${tc.clinicalPearl || tc.primaryDiagnosis?.briefDefinition || ""}`
        ).join("\n");
        const themesUser = `Patient chief concern: ${chiefConcern || "internal medicine encounter"}\n\nTeaching cases generated for this patient:\n${problemSummaries}\n\nWhat are the deeper clinical reasoning threads that connect these problems in THIS patient?`;
        const themesResp = await callAi(themesSys, themesUser, 1500);
        const themesParsed = extractJson(themesResp);
        crossCuttingThemes = themesParsed.crossCuttingThemes || [];
        questionsForReflection = themesParsed.questionsForReflection || [];
      } catch (e) {
        console.warn("Themes generation failed:", e);
      }
    }

    return { teachingCases, crossCuttingThemes, questionsForReflection };
  };

  // ===== Source prompt generator =====
  const generateSourcePrompt = (source) => {
    const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
    const focusText = activeFocus.map(f => focusLabels[f]).join(", ");
    const dxLine = workingDx ? `Working diagnosis: ${workingDx}. ` : "";
    const ccLine = chiefConcern ? `Chief concern: ${chiefConcern}. ` : "";
    const problemsLine = selectedProblems.length > 0 ? `\nSpecific problems to focus on: ${selectedProblems.join("; ")}.` : "";
    const topicsLine = extractedTopics.length > 0 ? `\nKey clinical topics: ${extractedTopics.join(", ")}.` : "";
    const lensLine = teachingLens !== "general_im" ? `\nTeaching lens: ${{geriatrics: "Geriatrics/deprescribing", primary_care: "Primary care/preventive", complex_multimorbidity: "Complex multimorbidity"}[teachingLens]}` : "";
    const contextLine = clinicalNote ? `\n\nDe-identified clinical context:\n${clinicalNote}` : "";

    const base = `Context: I am a teaching attending in internal medicine. My student is a medical student in month ${phase.monthsIn} of a longitudinal integrated clerkship (${phase.name} phase). Their developmental focus: ${phase.focus}.

${ccLine}${dxLine}${problemsLine}${topicsLine}${lensLine}${contextLine}

I want to focus today's teaching on: ${focusText}.

`;

    switch (source) {
      case "openevidence":
        return base + `Provide evidence-based teaching content:\n1. For each focus area, current evidence base with landmark citations (author, year, journal)\n2. Current guideline recommendations by name and year\n3. Ongoing clinical equipoise or debate\n4. Evidence that changed practice in the last 2-3 years\n\nFormat as structured summary I can bring to a teaching session.`;
      case "uptodate":
        return base + `Provide UpToDate-style content:\n1. Current approach for each focus area\n2. Grade of Recommendation where UpToDate provides one\n3. When to escalate or refer\n4. Patient-centered talking points`;
      case "dynamed":
        return base + `Give DynaMed-style summary:\n1. Level of Evidence for each recommendation\n2. NNT/NNH where applicable\n3. Practice-changing updates in last 2 years\n4. Cost-conscious alternatives\n5. Choosing Wisely recommendations relevant to this case`;
      case "doxgpt":
        return base + `Peer-consult response as an experienced clinician colleague:\n1. Practical real-world guidance\n2. Pearls and pitfalls from experience\n3. How to explain to the patient\n4. Common trainee errors\n5. What you'd worry about missing`;
      default:
        return base;
    }
  };

 // ===== Generate preview (was: generate document) =====
  const generateDocument = async () => {
    setAiStatus({ ...aiStatus, generating: true, error: null });
    let aiContent = null;
    let synthesized = null;

    if (aiEnabled && activeFocusList.length > 0) {
      const errors = [];
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Call 1: Teaching content (handles its own internal rate-limiting waits)
      try {
        aiContent = await generateAiTeachingContent();
        setAiTeachingContent(aiContent);
      } catch (e) {
        errors.push(`Teaching content: ${e.message}`);
      }

      // Extra wait before source synthesis
      await wait(3000);

      // Call 2: Source synthesis (only if 2+ sources)
      const filledSources = activeSources.filter(s => sourceResponses[s]?.html?.trim());
      if (filledSources.length >= 2) {
        setAiStatus({ analyzing: false, generating: true, error: "Synthesizing sources..." });
        try {
          synthesized = await synthesizeSources();
          setSynthesizedEvidence(synthesized);
        } catch (e) {
          errors.push(`Source synthesis: ${e.message}`);
        }
        await wait(3000);
      } else if (filledSources.length === 1) {
        const s = filledSources[0];
        const content = s === "pubmedai"
          ? Object.entries(sourceResponses.pubmedai || {}).filter(([_, v]) => v?.html?.trim()).map(([topic, v]) => `<h4>${topic}</h4>${v.html}`).join("")
          : sourceResponses[s].html;
        synthesized = { synthesized: false, singleSource: { source: sourceLabels[s], contentHtml: content } };
        setSynthesizedEvidence(synthesized);
      }

      if (errors.length > 0) {
        console.error("Generation errors:", errors);
        setAiStatus({ analyzing: false, generating: false, error: errors.join(" · ") });
      } else {
        setAiStatus({ analyzing: false, generating: false, error: null });
      }
    } else {
      const filledSources = activeSources.filter(s => sourceResponses[s]?.html?.trim());
      if (filledSources.length === 1) {
        const s = filledSources[0];
        const content = s === "pubmedai"
          ? Object.entries(sourceResponses.pubmedai || {}).filter(([_, v]) => v?.html?.trim()).map(([topic, v]) => `<h4>${topic}</h4>${v.html}`).join("")
          : sourceResponses[s].html;
        synthesized = { synthesized: false, singleSource: { source: sourceLabels[s], contentHtml: content } };
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
      student: session.studentName || "Student",
      phase, chiefConcern, workingDx,
      complexity: session.complexity, sessionGoal, extractedTopics,
      focusAreas: activeFocusList,
      teachingLens,
      activeProblems, selectedProblems, patientQuotes, labTrends,
      longTermGoals,
      noteAnalysis,
      allSourceImages,
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
          enabled: !!synthesized && !(activeFocusList.length > 0 && aiContent),
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

    setPreviewData(preview);
    setPreviewMode(true);
    setActiveTab("output");
    setAiStatus({ analyzing: false, generating: false, error: aiStatus.error });
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

    

  const saveState = async () => {
    try {
      await window.storage.set("session", JSON.stringify(session));
      await window.storage.set("longTermGoals", JSON.stringify(longTermGoals));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error(e); }
  };

  const addGoal = () => {
    if (!newGoal.trim()) return;
    const updated = [...longTermGoals, { id: Date.now(), text: newGoal, added: new Date().toLocaleDateString(), status: "active" }];
    setLongTermGoals(updated); setNewGoal("");
    window.storage.set("longTermGoals", JSON.stringify(updated)).catch(() => {});
  };
  const removeGoal = (id) => {
    const updated = longTermGoals.filter(g => g.id !== id);
    setLongTermGoals(updated);
    window.storage.set("longTermGoals", JSON.stringify(updated)).catch(() => {});
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
    { id: "setup", label: "1. Setup", icon: User },
    { id: "note", label: "2. Clinical Note", icon: FileText },
    { id: "focus", label: "3. Teaching Focus", icon: Target },
    { id: "sources", label: "4. Sources", icon: BookOpen },
    { id: "goals", label: "5. Goals", icon: TrendingUp },
    { id: "output", label: "6. Review & Generate", icon: Sparkles },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .print-doc { box-shadow: none !important; border: none !important; }
          .print-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .section-block { page-break-inside: avoid; }
          table { page-break-inside: avoid; }
          h2 { page-break-after: avoid; }
        }
        @page { margin: 0.5in; }
      `}</style>

      <header className="no-print bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Stethoscope className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">LIC Teaching Document Generator</h1>
                <p className="text-xs text-slate-500">Phase-aware teaching {aiEnabled && <span className="text-indigo-600">· AI enabled</span>}</p>
              </div>
            </div>
            <button onClick={saveState} className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg transition">
              {saved ? <Check className="w-4 h-4 text-emerald-600" /> : <Save className="w-4 h-4" />}
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition ${activeTab === t.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  <Icon className="w-4 h-4" />{t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className={`no-print mb-6 p-4 rounded-lg border ${phase.color}`}>
          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{phase.name}</span>
                <span className="text-xs opacity-75">Month {phase.monthsIn} of LIC</span>
              </div>
              <p className="text-sm mt-1 opacity-90">{phase.focus}</p>
              <p className="text-xs mt-1 opacity-75 italic">{phase.pace}</p>
            </div>
          </div>
        </div>

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
              <h2 className="text-lg font-semibold text-slate-900 mb-1">Clinical Note & Encounter</h2>
              <p className="text-sm text-slate-500">Paste your clinical note. {aiEnabled && "AI will extract chief concern, working diagnosis, active problems, quotes, and lab trends automatically."}</p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-sm text-amber-900">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>De-identify before pasting — no names, DOB, MRN, addresses, exact dates. Use ages in ranges (e.g., "80s").</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Teaching lens</label>
              <select value={teachingLens} onChange={e => setTeachingLens(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm">
                <option value="general_im">General Internal Medicine</option>
                <option value="geriatrics">Geriatrics / Deprescribing (Beers, STOPP/START, 4Ms)</option>
                <option value="primary_care">Primary Care / Preventive (USPSTF, chronic disease)</option>
                <option value="complex_multimorbidity">Complex Multimorbidity (competing goals, prioritization)</option>
              </select>
            </div>

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

            {noteAnalysis && (
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
                  <Sparkles className="w-4 h-4" />AI Analysis
                </div>
                {noteAnalysis.reasoning && <div className="text-sm text-indigo-800 italic">{noteAnalysis.reasoning}</div>}

                {activeProblems.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold text-indigo-900 mb-2">Active problems — select which to focus teaching on:</div>
                    <div className="space-y-1.5">
                      {activeProblems.map((p, i) => {
                        const selected = selectedProblems.includes(p.problem);
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              if (selected) setSelectedProblems(selectedProblems.filter(sp => sp !== p.problem));
                              else setSelectedProblems([...selectedProblems, p.problem]);
                            }}
                            className={`w-full flex items-start gap-2 p-2 rounded-lg text-left transition ${selected ? "bg-indigo-100 border border-indigo-300" : "bg-white border border-slate-200 hover:border-indigo-200"}`}
                          >
                            <div className={`w-4 h-4 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${selected ? "bg-indigo-600 border-indigo-600" : "border-slate-300"}`}>
                              {selected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-900">{p.problem}</div>
                              {p.keyIssue && <div className="text-xs text-slate-600 mt-0.5">{p.keyIssue}</div>}
                              {p.teachingValue && <div className="text-xs text-indigo-700 mt-0.5 italic">Teaching value: {p.teachingValue}</div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-xs text-slate-500 mt-2">{selectedProblems.length} of {activeProblems.length} selected.</div>
                  </div>
                )}

                {noteAnalysis.keyTopics?.length > 0 && (
                  <div className="text-sm text-indigo-900">
                    <strong>Key teaching topics:</strong>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {noteAnalysis.keyTopics.map((t, i) => <span key={i} className="px-2 py-0.5 bg-white rounded-full text-xs border border-indigo-200">{t}</span>)}
                    </div>
                  </div>
                )}

                {patientQuotes.length > 0 && (
                  <div className="text-sm text-indigo-900">
                    <strong>Patient/caregiver quotes extracted ({patientQuotes.length}):</strong>
                    <div className="mt-1 space-y-1">
                      {patientQuotes.slice(0, 3).map((q, i) => <div key={i} className="text-xs italic text-slate-700 bg-white p-2 rounded border border-slate-200">"{q}"</div>)}
                      {patientQuotes.length > 3 && <div className="text-xs text-slate-500">+ {patientQuotes.length - 3} more</div>}
                    </div>
                  </div>
                )}

                {labTrends.length > 0 && (
                  <div className="text-sm text-indigo-900">
                    <strong>Lab/vital trends identified ({labTrends.length}):</strong>
                    <div className="mt-1 space-y-1">
                      {labTrends.slice(0, 3).map((t, i) => (
                        <div key={i} className="text-xs bg-white p-2 rounded border border-slate-200">
                          <span className="font-medium text-slate-800">{t.parameter}:</span> <span className="text-slate-600">{t.trend}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {noteAnalysis.redFlags?.length > 0 && (
                  <div className="text-sm text-red-900 bg-red-50 border border-red-200 rounded p-2">
                    <strong>Red flags / can't-miss:</strong> {noteAnalysis.redFlags.join("; ")}
                  </div>
                )}

                {noteAnalysis.suggestedFocus?.length > 0 && (
                  <div className="text-sm text-indigo-900">
                    <strong>Suggested focus areas:</strong> {noteAnalysis.suggestedFocus.map(f => focusLabels[f] || f).join(", ")}
                    <div className="text-xs text-indigo-700 mt-1">Auto-selected on the Focus tab. You can adjust.</div>
                  </div>
                )}
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
                        <div className="text-xs text-slate-500 mt-0.5">{mepoMap[key]}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
<div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Additional teaching topics</h3>
                <p className="text-sm text-slate-500">Add extra topics beyond the case diagnoses — e.g., "imaging findings in acute cholecystitis" or "how to counsel about weight-loss medication side effects".</p>
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
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
              <div>
                <h3 className="font-semibold text-slate-900 mb-1">Session-specific learning goal</h3>
                <p className="text-sm text-slate-500">One thing you want them to walk away with today.</p>
              </div>
              <input type="text" value={sessionGoal} onChange={e => setSessionGoal(e.target.value)} placeholder="e.g., Build an illness script for iatrogenic bradycardia and defend a deprescribing plan" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
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
                <h2 className="text-lg font-semibold text-slate-900 mb-1">External Evidence Sources</h2>
                <p className="text-sm text-slate-500">Prompts are customized with your selected teaching focus. Copy → paste into source → paste response back below.</p>
                {activeSources.filter(s => s !== "pubmedai" && sourceResponses[s]?.html?.trim()).length + (Object.values(sourceResponses.pubmedai || {}).filter(v => v?.html?.trim()).length > 0 ? 1 : 0) > 1 && aiEnabled && (
                  <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-900 flex items-center gap-2">
                    <Sparkles className="w-3 h-3" />
                    Multiple sources detected — AI will synthesize them into a unified evidence summary, consolidating overlaps and flagging conflicts.
                  </div>
                )}
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

              {activeFocusList.length === 0 && activeSources.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                  Select at least one teaching focus area (Step 3) for prompts to be tailored.
                </div>
              )}

              <div className="space-y-4">
                {activeSources.map(src => (
                  <div key={src} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition">
                      <button onClick={() => toggleSection(src)} className="flex items-center gap-2 font-medium text-slate-900 flex-1 text-left">
                        {expandedSections[src] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        {sourceLabels[src]}
                        {src === "pubmedai" ? (
                          Object.values(sourceResponses.pubmedai || {}).filter(v => v?.html?.trim()).length > 0 &&
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{Object.values(sourceResponses.pubmedai || {}).filter(v => v?.html?.trim()).length} responses added</span>
                        ) : (
                          sourceResponses[src]?.html?.trim() && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Response added</span>
                        )}
                      </button>
                      <a href={sourceUrls[src]} target="_blank" rel="noreferrer" className="ml-2 text-xs px-2 py-1 bg-indigo-600 text-white hover:bg-indigo-700 rounded transition flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        Open {sourceLabels[src].split(" ")[0]} ↗
                      </a>
                    </div>
                    {expandedSections[src] && src === "pubmedai" && (
                      <div className="p-4 space-y-4 bg-white">
                        <div className="text-xs text-slate-600 bg-blue-50 border border-blue-200 rounded p-2">
                          PubMed AI handles one topic at a time. Below is a separate prompt for each of your selected problems and custom topics. Copy each, paste into PubMed AI, paste the response back in the matching box.
                        </div>
                        {[...(selectedProblems.length > 0 ? selectedProblems : (workingDx ? [workingDx] : [])), ...customTopics].map((topic, i) => {
                          const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
                          const focusText = activeFocus.map(f => focusLabels[f]).join(", ");
                          const promptText = `Detailed review of the following topic for medical student teaching: ${topic}\n\nFocus specifically on: ${focusText || "diagnosis and management"}.\n\nPatient context (for relevance): ${chiefConcern || "internal medicine encounter"}.`;
                          return (
                            <div key={i} className="border border-slate-200 rounded p-3">
                              <div className="text-sm font-semibold text-slate-800 mb-2">Topic {i+1}: {topic}</div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-xs font-medium text-slate-600">Prompt for PubMed AI</label>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(promptText).then(() => {
                                      setCopiedPrompt(`pubmedai-${i}`);
                                      setTimeout(() => setCopiedPrompt(null), 2000);
                                    });
                                  }}
                                  className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded transition"
                                >
                                  {copiedPrompt === `pubmedai-${i}` ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
                                </button>
                              </div>
                              <div className="p-2 bg-slate-50 rounded border border-slate-200 text-xs font-mono text-slate-700 whitespace-pre-wrap mb-2">{promptText}</div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Paste PubMed AI response for this topic <span className="font-normal text-slate-500">(rich text + images supported)</span></label>
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
                      <div className="p-4 space-y-4 bg-white">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-slate-700">Prompt for {sourceLabels[src]}</label>
                            <button onClick={() => copyPrompt(src)} className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded transition">
                              {copiedPrompt === src ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
                            </button>
                          </div>
                          <div className="p-3 bg-slate-50 rounded border border-slate-200 text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-60 overflow-y-auto">{generateSourcePrompt(src)}</div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Paste response from {sourceLabels[src]} <span className="text-xs font-normal text-slate-500">(rich text + images supported)</span></label>
                          <RichPaste
                            value={sourceResponses[src]}
                            onChange={v => setSourceResponses({...sourceResponses, [src]: v})}
                            placeholder="Paste the response here — text, formatting, tables, and images will all carry through..."
                            rows={6}
                            sessionImageBytes={sessionImageBytes}
                            onImageBytesChange={delta => setSessionImageBytes(b => b + delta)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
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
            {!previewData && !generatedDoc ? (
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
                fetchingPubmed={fetchingPubmed}
                aiStatus={aiStatus}
                focusLabels={focusLabels}
              />
            ) : (
              // ============ FINAL DOCUMENT ============
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
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm overflow-auto"
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
function PreviewEditor({ previewData, togglePreviewSection, toggleTeachingCase, updatePreviewField, updateTeachingCaseField, commitPreviewToDocument, onBack, onRegenerate, aiStatus, focusLabels }) {
  const s = previewData.sections;

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

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Preview & Edit</h2>
            <p className="text-sm text-slate-700 mt-1">Toggle sections on/off, edit content, then generate the final document.</p>
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

      {/* Session Goal */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <SectionHeader label="Session Goal" enabled={s.sessionGoal.enabled} onToggle={() => togglePreviewSection("sessionGoal")} />
        {s.sessionGoal.enabled && (
          <div className="p-3">
            <input type="text" value={s.sessionGoal.content} onChange={e => updatePreviewField("sections.sessionGoal.content", e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
          </div>
        )}
      </div>

      {/* Teaching Cases - individually toggleable */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {s.teachingCases.length === 0 ? (
          <div className="bg-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="font-semibold text-sm text-slate-500">Teaching Cases</div>
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">No AI content — check errors above or re-run</span>
          </div>
        ) : (
          <>
          <div className="bg-slate-800 text-white px-4 py-2">
            <div className="font-semibold text-sm">Teaching Cases ({s.teachingCases.filter(tc => tc.enabled).length} of {s.teachingCases.length} enabled)</div>
          </div>
          {s.teachingCases.map((tc, idx) => (
            <div key={idx} className="border-t border-slate-200">
              <SectionHeader label={`Case ${idx+1}: ${tc.data.problem}`} enabled={tc.enabled} onToggle={() => toggleTeachingCase(idx)} />
              {tc.enabled && (
                <div className="p-4 space-y-3 bg-slate-50">
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
                    <summary className="cursor-pointer">View all content for this case</summary>
                    <pre className="text-xs bg-white p-2 mt-1 rounded overflow-x-auto max-h-64">{JSON.stringify(tc.data, null, 2)}</pre>
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
            <SectionHeader label="Evidence Summary (from external sources)" enabled={s.synthesizedEvidence.enabled} onToggle={() => togglePreviewSection("synthesizedEvidence")} />
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

      <div className="sticky bottom-4 bg-white border-2 border-indigo-600 rounded-lg p-4 shadow-lg flex items-center justify-between">
        <div className="text-sm text-slate-700">Ready when you are. {Object.values(s).filter(sec => Array.isArray(sec) ? sec.some(x => x.enabled) : sec.enabled).length} sections enabled.</div>
        <button onClick={commitPreviewToDocument} className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4" />Generate Final Document
        </button>
      </div>
    </div>
  );
}

// ============ FINAL DOCUMENT COMPONENT ============
function FinalDocument({ doc, phase, session, onPrint, onEdit, onUpdate }) {
  const [editMode, setEditMode] = React.useState(true);
  const [savedHtml, setSavedHtml] = React.useState(null);
  const editableRef = React.useRef(null);

  if (!doc) return null;
  const s = doc.sections || {};
  const enabledCases = (s.teachingCases || []).filter(tc => tc.enabled);

  const applyFormat = (cmd) => {
    document.execCommand(cmd, false, null);
    if (editableRef.current) editableRef.current.focus();
  };

  const saveChanges = () => {
    if (editableRef.current) {
      setSavedHtml(editableRef.current.innerHTML);
    }
    setEditMode(false);
  };

  const printDoc = () => {
    // Ensure any pending edit is captured before print
    if (editMode && editableRef.current) {
      setSavedHtml(editableRef.current.innerHTML);
    }
    setTimeout(() => window.print(), 100);
  };

  // If we've saved HTML edits, render those. Otherwise render the fresh doc.
  const renderContent = () => {
    if (savedHtml && !editMode) {
      return <div dangerouslySetInnerHTML={{ __html: savedHtml }} />;
    }
    return <DocumentContent doc={doc} phase={phase} session={session} />;
  };

  return (
    <>
      <div className="no-print flex gap-2 mb-4 items-center flex-wrap">
        <button onClick={printDoc} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"><Printer className="w-4 h-4" />Print / Save as PDF</button>
        <button onClick={onEdit} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">← Back to Preview</button>
        {editMode ? (
          <button onClick={saveChanges} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium">Lock Edits</button>
        ) : (
          <button onClick={() => setEditMode(true)} className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium">Resume Editing</button>
        )}
        <div className="text-xs text-slate-500 italic ml-2">
          {editMode ? "Click any text to edit. Use toolbar for bold/italic/underline." : "Editing locked — click Resume Editing to make more changes."}
        </div>
      </div>

      {/* Floating formatting toolbar */}
      {editMode && (
        <div className="no-print sticky top-32 z-20 mb-2 flex items-center gap-1 bg-slate-800 text-white rounded-lg shadow-lg px-2 py-1 w-fit flex-wrap">
          <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("bold"); }} className="px-3 py-1.5 hover:bg-slate-700 rounded font-bold text-sm" title="Bold">B</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("italic"); }} className="px-3 py-1.5 hover:bg-slate-700 rounded italic text-sm" title="Italic">I</button>
          <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("underline"); }} className="px-3 py-1.5 hover:bg-slate-700 rounded underline text-sm" title="Underline">U</button>
          <div className="w-px h-5 bg-slate-600 mx-1"></div>
          <span className="text-xs px-1 opacity-70">Highlight:</span>
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
              className="w-6 h-6 rounded border border-slate-500 hover:scale-110 transition"
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
            className="w-6 h-6 rounded border border-slate-500 bg-white text-slate-700 flex items-center justify-center text-xs hover:scale-110 transition"
            title="Remove highlight"
          >
            <X className="w-3 h-3" />
          </button>
          <div className="w-px h-5 bg-slate-600 mx-1"></div>
          <button type="button" onMouseDown={e => { e.preventDefault(); applyFormat("removeFormat"); }} className="px-2 py-1.5 hover:bg-slate-700 rounded text-xs" title="Clear all formatting">Clear</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 print-doc" style={{fontFamily: "Georgia, 'Times New Roman', serif"}}>
        <div
          ref={editableRef}
          contentEditable={editMode}
          suppressContentEditableWarning
          spellCheck={false}
          className={editMode ? "outline-none focus:outline-none" : ""}
          style={editMode ? { boxShadow: "inset 0 0 0 2px rgba(251, 191, 36, 0.3)", borderRadius: "0.75rem" } : {}}
        >
          {renderContent()}
        </div>
      </div>
    </>
  );
}

// ============ DOCUMENT CONTENT (extracted for cleanliness) ============
function DocumentContent({ doc, phase, session }) {
  const s = doc.sections || {};
  const enabledCases = (s.teachingCases || []).filter(tc => tc.enabled);

  return (
    <>
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-8 py-6 print-header rounded-t-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-300 mb-1">Teaching Session</div>
            <h1 className="text-2xl font-bold">Clinical Case Learning Document</h1>
            <div className="text-sm text-slate-200 mt-2">
              Prepared for <span className="font-semibold text-white">{doc.student}</span> · {session.sessionDate}
            </div>
          </div>
          <div className="text-right text-xs text-slate-300">
            <div>Generated {doc.generated}</div>
            <div className="mt-1 inline-block px-2 py-1 bg-white/10 rounded font-sans">
              Month {doc.phase.monthsIn} · {doc.phase.name}
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {s.caseAtGlance?.enabled && (doc.chiefConcern || doc.workingDx || doc.selectedProblems?.length > 0) && (
          <section>
            <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Case at a Glance</h2>
            <table className="w-full text-sm border border-slate-300">
              <tbody>
                {doc.chiefConcern && <tr className="border-b border-slate-200"><td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 w-40 align-top">Chief concern</td><td className="px-3 py-2 text-slate-800">{doc.chiefConcern}</td></tr>}
                {doc.workingDx && <tr className="border-b border-slate-200"><td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Primary working diagnosis</td><td className="px-3 py-2 text-slate-800">{doc.workingDx}</td></tr>}
                <tr className="border-b border-slate-200"><td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Complexity</td><td className="px-3 py-2 text-slate-800">{doc.complexity === "common" ? "Common presentation" : "Complex presentation"}</td></tr>
                {doc.selectedProblems?.length > 0 && <tr><td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Problems in focus</td><td className="px-3 py-2 text-slate-800"><ul className="list-disc ml-4">{doc.selectedProblems.map((p, i) => <li key={i}>{p}</li>)}</ul></td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {s.sessionGoal?.enabled && s.sessionGoal.content && (
          <section>
            <div className="border-l-4 border-indigo-600 bg-indigo-50 px-4 py-3">
              <div className="text-xs uppercase tracking-widest text-indigo-700 font-bold mb-1">Session Goal</div>
              <div className="text-slate-800 font-medium">{s.sessionGoal.content}</div>
            </div>
          </section>
        )}

        {s.phaseFraming?.enabled && (
          <section>
            <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Phase-Aligned Framing</h2>
            <div className="text-sm text-slate-700 leading-relaxed">
              <strong>Developmental focus:</strong> {doc.phase.focus}
            </div>
          </section>
        )}

        {enabledCases.map((tc, idx) => {
          const c = tc.data;
          return (
            <section key={idx} className="section-block">
              <div className="bg-slate-800 text-white px-4 py-3 rounded-t">
                <div className="text-xs uppercase tracking-widest text-slate-300">Teaching Case {idx + 1} of {enabledCases.length}</div>
                <h2 className="text-lg font-bold mt-0.5">{c.problem}</h2>
              </div>
              <div className="border border-t-0 border-slate-300 rounded-b p-4 space-y-4">
                {c.primaryDiagnosis?.name && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-1">Primary Diagnosis</div>
                    <div className="text-sm text-slate-800"><span className="font-bold">{c.primaryDiagnosis.name}.</span> {c.primaryDiagnosis.briefDefinition}</div>
                  </div>
                )}
                {c.differentialDiagnosis?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Differential Diagnosis</div>
                    <table className="w-full text-sm border border-slate-200">
                      <thead><tr className="bg-slate-100"><th className="px-3 py-1.5 text-left font-semibold text-slate-700 w-1/3">Alternative Diagnosis</th><th className="px-3 py-1.5 text-left font-semibold text-slate-700">Clinical Reasoning</th></tr></thead>
                      <tbody>{c.differentialDiagnosis.map((dd, i) => (
                        <tr key={i} className="border-t border-slate-200"><td className="px-3 py-2 font-semibold text-slate-900 align-top">{dd.diagnosis}</td><td className="px-3 py-2 text-slate-700">{dd.reasoning}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {c.keyLearningPoints?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Key Learning Points</div>
                    <ol className="space-y-2">{c.keyLearningPoints.map((lp, i) => (
                      <li key={i} className="text-sm text-slate-800 flex gap-2">
                        <span className="font-bold text-slate-500 flex-shrink-0 min-w-[1.5rem]">{i+1}.</span>
                        <div><span className="font-semibold text-slate-900">{lp.point}.</span> <span className="text-slate-700">{lp.explanation}</span>{lp.citation && <span className="text-xs text-slate-500 italic ml-1">({lp.citation})</span>}</div>
                      </li>
                    ))}</ol>
                  </div>
                )}
                {c.focusedHistoryQuestions?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Focused History Questions</div>
                    <ul className="space-y-2">{c.focusedHistoryQuestions.map((hq, i) => (
                      <li key={i} className="text-sm text-slate-800"><div className="font-semibold">{hq.question}</div><div className="text-xs text-slate-600 italic">Rationale: {hq.rationale}</div></li>
                    ))}</ul>
                  </div>
                )}
                {c.physicalExam?.maneuver && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Physical Examination</div>
                    <div className="text-sm text-slate-800">
                      <div className="font-semibold mb-1">{c.physicalExam.maneuver}</div>
                      {c.physicalExam.steps?.length > 0 && <ol className="ml-4 list-decimal space-y-1 mb-2">{c.physicalExam.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>}
                      {c.physicalExam.interpretation && <div className="text-xs text-slate-600 italic">Interpretation: {c.physicalExam.interpretation}</div>}
                    </div>
                  </div>
                )}
                {c.keyLabsAndImaging?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Key Labs & Imaging</div>
                    <table className="w-full text-xs border border-slate-200">
                      <thead><tr className="bg-slate-100"><th className="px-2 py-1.5 text-left">Study</th><th className="px-2 py-1.5 text-left">Purpose</th><th className="px-2 py-1.5 text-left">Interpretation</th><th className="px-2 py-1.5 text-left">Role</th></tr></thead>
                      <tbody>{c.keyLabsAndImaging.map((lab, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                          <td className="px-2 py-1.5 font-semibold text-slate-900 border-t align-top">{lab.study}</td>
                          <td className="px-2 py-1.5 text-slate-700 border-t align-top">{lab.purpose}</td>
                          <td className="px-2 py-1.5 text-slate-700 border-t align-top">{lab.interpretation}</td>
                          <td className="px-2 py-1.5 text-slate-700 border-t align-top">{lab.role}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                {c.treatmentApproach && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Treatment Approach</div>
                    {c.treatmentApproach.firstLine?.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-slate-600 mb-1">First-Line Management</div>
                        <table className="w-full text-sm border border-slate-200">
                          <thead><tr className="bg-slate-100"><th className="px-2 py-1.5 text-left">Treatment</th><th className="px-2 py-1.5 text-left">Dosing</th><th className="px-2 py-1.5 text-left">Evidence</th></tr></thead>
                          <tbody>{c.treatmentApproach.firstLine.map((t, i) => (
                            <tr key={i} className="border-t"><td className="px-2 py-2 font-semibold align-top">{t.treatment}</td><td className="px-2 py-2 text-slate-700 align-top">{t.dosing}</td><td className="px-2 py-2 text-slate-600 italic align-top">{t.evidence}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                    {c.treatmentApproach.additional?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-600 mb-1">Additional Considerations</div>
                        <ul className="text-sm text-slate-800 space-y-1 ml-4 list-disc">{c.treatmentApproach.additional.map((a, i) => <li key={i}>{a}</li>)}</ul>
                      </div>
                    )}
                  </div>
                )}
                {c.patientContextConsiderations && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Patient Context</div>
                    <div className="text-sm text-slate-800">{c.patientContextConsiderations}</div>
                  </div>
                )}
                {c.communicationTeaching?.scenario && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Communication Teaching</div>
                    <div className="text-sm text-slate-800">
                      <div className="mb-2"><span className="font-semibold">Scenario:</span> {c.communicationTeaching.scenario}</div>
                      {c.communicationTeaching.script && <div className="p-2 bg-slate-50 border-l-4 border-slate-400 italic">"{c.communicationTeaching.script}"</div>}
                    </div>
                  </div>
                )}
                {c.recommendedReading?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Recommended Reading</div>
                    <ol className="space-y-1.5 ml-4 list-decimal text-sm">{c.recommendedReading.map((r, i) => (
                      <li key={i} className="text-slate-800"><span className="font-semibold">{r.reference}</span>{r.relevance && <div className="text-xs text-slate-600 italic">{r.relevance}</div>}</li>
                    ))}</ol>
                  </div>
                )}
                {c.clinicalPearl && (
                  <div className="border-l-4 border-purple-600 bg-purple-50 px-3 py-2">
                    <div className="text-xs font-bold text-purple-900 mb-1 uppercase">Clinical Pearl</div>
                    <div className="text-sm text-slate-800">{c.clinicalPearl}</div>
                  </div>
                )}
                {c.quoteToDiscuss && (
                  <div className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
                    <div className="text-xs font-bold text-amber-900 mb-1 uppercase">Quote to Discuss</div>
                    <div className="italic text-sm text-slate-800">"{c.quoteToDiscuss}"</div>
                  </div>
                )}
              </div>
            </section>
          );
        })}

        {s.labTrends?.enabled && s.labTrends.content?.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Lab & Vital Trends for Interpretation</h2>
            <table className="w-full text-sm border border-slate-300">
              <thead><tr className="bg-slate-800 text-white"><th className="px-3 py-2 text-left font-semibold w-1/4">Parameter</th><th className="px-3 py-2 text-left font-semibold w-1/3">Trend</th><th className="px-3 py-2 text-left font-semibold">Teaching Point</th></tr></thead>
              <tbody>{s.labTrends.content.map((t, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-3 py-2 font-semibold text-slate-900 border-t border-slate-200">{t.parameter}</td>
                  <td className="px-3 py-2 text-slate-700 border-t border-slate-200">{t.trend}</td>
                  <td className="px-3 py-2 text-slate-700 border-t border-slate-200 italic">{t.teachingPoint || "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}

        {s.crossCuttingThemes?.enabled && s.crossCuttingThemes.content?.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Cross-Cutting Themes</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{s.crossCuttingThemes.content.map((t, i) => (
              <div key={i} className="border border-slate-300 p-3 rounded bg-slate-50"><div className="text-xs uppercase font-bold text-slate-500 mb-1">Theme {i+1}</div><div className="text-sm text-slate-800">{t}</div></div>
            ))}</div>
          </section>
        )}

        {s.synthesizedEvidence?.enabled && s.synthesizedEvidence.content && (
          <section>
            <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Evidence Deep-Dive</h2>
            {s.synthesizedEvidence.content.synthesized && s.synthesizedEvidence.content.integratedNarrative?.length > 0 ? (
              <div className="space-y-5">
                {s.synthesizedEvidence.content.integratedNarrative.map((topic, i) => (
                  <div key={i}>
                    <h3 className="text-sm font-bold text-slate-900 mb-2">{topic.topic}</h3>
                    <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{topic.attendingCommentary}</div>
                    {topic.sources && topic.sources.length > 0 && (
                      <div className="text-xs text-slate-500 italic mt-1">Sources: {Array.isArray(topic.sources) ? topic.sources.join(", ") : topic.sources}</div>
                    )}
                  </div>
                ))}
                {s.synthesizedEvidence.content.keyTakeaways?.length > 0 && (
                  <div className="mt-4 border-l-4 border-indigo-500 bg-indigo-50 p-3">
                    <div className="text-xs uppercase font-bold text-indigo-900 mb-2">Key Takeaways</div>
                    <ul className="space-y-1 ml-4 list-disc text-sm text-slate-800">
                      {s.synthesizedEvidence.content.keyTakeaways.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {s.synthesizedEvidence.content.conflicts?.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs uppercase font-bold text-amber-800 mb-2">Where Sources Disagreed</div>
                    {s.synthesizedEvidence.content.conflicts.map((c, i) => (
                      <div key={i} className="border-l-4 border-amber-500 bg-amber-50 p-3 mb-2">
                        <div className="text-sm font-semibold text-slate-900 mb-1">{c.topic}</div>
                        <div className="text-sm text-slate-800">{c.explanation}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : s.synthesizedEvidence.content.singleSource ? (
              <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                <div className="text-xs italic text-slate-500 mb-2">Note: This content is displayed as-provided because AI synthesis was unavailable. Enable AI for integrated narrative.</div>
                {s.synthesizedEvidence.content.singleSource.content}
              </div>
            ) : null}
          </section>
        )}

        
{/* All shelf questions consolidated at the end */}
        {enabledCases.some(tc => tc.data.shelfQuestions?.length > 0) && (
          <section>
            <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Practice Questions</h2>
            <p className="text-sm text-slate-600 italic mb-4">Shelf-style questions covering the problems taught in this case.</p>
            {enabledCases.map((tc, caseIdx) => {
              if (!tc.data.shelfQuestions?.length) return null;
              return (
                <div key={caseIdx} className="mb-6">
                  <h3 className="text-sm font-bold text-slate-800 mb-2 pb-1 border-b border-slate-200">{tc.data.problem}</h3>
                  <div className="space-y-4">
                    {tc.data.shelfQuestions.map((q, i) => (
                      <div key={i} className="border border-slate-300 rounded overflow-hidden">
                        <div className="bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 uppercase">Question {i+1}</div>
                        <div className="px-3 py-2 text-sm text-slate-800 border-b border-slate-200">{q.vignette}</div>
                        <div className="px-3 py-2 text-sm text-slate-800 border-b border-slate-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                            {q.options && Object.entries(q.options).map(([letter, opt]) => (
                              <div key={letter} className={q.correctAnswer === letter ? "font-semibold" : ""}><span className="font-bold mr-1">{letter})</span>{opt}</div>
                            ))}
                          </div>
                        </div>
                        <div className="px-3 py-2 bg-emerald-50 text-sm">
                          <div className="text-xs font-bold text-emerald-800 uppercase mb-1">Answer: {q.correctAnswer}</div>
                          <div className="text-slate-800">{q.explanation}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {s.longTermGoals?.enabled && s.longTermGoals.content?.length > 0 && (
            <section>
              <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Ongoing Learning Goals</h2>
              <ul className="space-y-2">{s.longTermGoals.content.map(g => (
                <li key={g.id} className="text-sm text-slate-800 flex gap-2"><span className="text-indigo-700 font-bold flex-shrink-0">›</span><div><div>{g.text}</div><div className="text-xs text-slate-500">Added {g.added}</div></div></li>
              ))}</ul>
            </section>
          )}
          {s.nextSessionPrep?.enabled && (
            <section>
              <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Prep for Next Session</h2>
              {s.nextSessionPrep.reflectionQuestions?.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs uppercase font-bold text-slate-600 mb-1">Reflect on</div>
                  <ul className="space-y-1 ml-4 list-disc text-sm text-slate-800">{s.nextSessionPrep.reflectionQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                </div>
              )}
              <div className="text-xs uppercase font-bold text-slate-600 mb-1">Come prepared to</div>
              <ul className="space-y-1 text-sm text-slate-800 ml-4 list-disc">
                <li>Discuss the questions above.</li>
                <li>Bring 1 question that came up while working through this material.</li>
                <li>Identify 1 area where you felt unsure.</li>
              </ul>
            </section>
          )}
        </div>

        <div className="border-t-2 border-slate-800 pt-3 mt-6 text-xs text-slate-500 text-center space-y-1">
          <div>Generated by LIC Teaching Document Generator · Aligned with the CU School of Medicine MEPO framework.</div>
          <div className="italic">For educational purposes only. Verify citations, dosing, and current recommendations before clinical application.</div>
        </div>
      </div>
    </>
  );
}