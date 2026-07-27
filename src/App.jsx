import React, { useState, useEffect } from "react";
import { FileText, Printer, Copy, Check, Plus, X, BookOpen, Target, Stethoscope, Brain, ClipboardList, Users, TrendingUp, Save, Trash2, Sparkles, ChevronDown, ChevronRight, Calendar, User, AlertCircle, Zap, Loader2, Wand2 } from "lucide-react";

// ===== Hardcoded config =====
const WORKER_URL = "https://medteachingtool.sweet-dream-0ed6.workers.dev/";
const DEFAULT_MODEL = "gpt-oss-120b";
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
  const [promptViewerFor, setPromptViewerFor] = useState(null); // source key when open
  const [expandedSections, setExpandedSections] = useState({});

  // AI is enabled by default; user only toggles on/off
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiStatus, setAiStatus] = useState({ analyzing: false, generating: false, error: null, progress: null });

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
  // ===== Auto-save / restore =====
  const [restoredSession, setRestoredSession] = useState(null);
  const [hasRestored, setHasRestored] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ state: "idle", lastSavedAt: null, error: null });
  const [nowTick, setNowTick] = useState(Date.now()); // forces "N seconds ago" to update

  // Tick every 15s so the "Saved · X ago" display stays current
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const saveTimers = React.useRef({});
  const pendingWrites = React.useRef(new Set()); // track in-flight writes across all keys
  const debouncedSave = React.useCallback((key, value) => {
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    // Immediately flip to "saving" so the pill reflects pending work
    setSaveStatus(prev => ({ ...prev, state: "saving", error: null }));
    saveTimers.current[key] = setTimeout(async () => {
      pendingWrites.current.add(key);
      try {
        await storage.set(key, JSON.stringify(value));
        pendingWrites.current.delete(key);
        // Only flip to "saved" when ALL pending writes have completed
        if (pendingWrites.current.size === 0) {
          setSaveStatus({ state: "saved", lastSavedAt: Date.now(), error: null });
        }
      } catch (e) {
        pendingWrites.current.delete(key);
        console.warn(`[autosave] Failed to save ${key}:`, e.message);
        setSaveStatus({ state: "error", lastSavedAt: saveStatus.lastSavedAt, error: e.message.slice(0, 80) });
      }
    }, 1000);
  }, []);

  // Helper: format "just now / N minutes ago / at HH:MM"
  const formatSaveTime = (ts) => {
    if (!ts) return "";
    const diff = Math.floor((nowTick - ts) / 1000);
    if (diff < 5) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Manual retry: kicks all state watchers to re-save
  const retrySave = () => {
    setSaveStatus({ state: "saving", lastSavedAt: saveStatus.lastSavedAt, error: null });
    // Force a re-save by touching the most important slice
    debouncedSave("inProgress", {
      timestamp: new Date().toISOString(),
      clinicalNote, chiefConcern, workingDx, extractedTopics, noteAnalysis,
      activeProblems, selectedProblems, patientQuotes, labTrends, teachingLens,
      focusAreas, aiSuggestedFocus, customTopics, sources, sessionGoal, aiEnabled,
    });
  };

  // Load persisted state
  // Load persisted state (both durable state and in-progress session)
  useEffect(() => {
    (async () => {
      const safeGet = async (key) => {
        try {
          const r = await storage.get(key);
          return r?.value ? JSON.parse(r.value) : null;
        } catch { return null; }
      };

      // Durable state (across all sessions)
      const g = await safeGet("longTermGoals");
      if (g) setLongTermGoals(g);
      const s = await safeGet("session");
      if (s) setSession(s);

      // In-progress session state
      const inProgress = await safeGet("inProgress");
      if (inProgress && inProgress.timestamp) {
        // Restore everything we saved
        if (inProgress.clinicalNote) setClinicalNote(inProgress.clinicalNote);
        if (inProgress.chiefConcern) setChiefConcern(inProgress.chiefConcern);
        if (inProgress.workingDx) setWorkingDx(inProgress.workingDx);
        if (inProgress.extractedTopics) setExtractedTopics(inProgress.extractedTopics);
        if (inProgress.noteAnalysis) setNoteAnalysis(inProgress.noteAnalysis);
        if (inProgress.activeProblems) setActiveProblems(inProgress.activeProblems);
        if (inProgress.selectedProblems) setSelectedProblems(inProgress.selectedProblems);
        if (inProgress.patientQuotes) setPatientQuotes(inProgress.patientQuotes);
        if (inProgress.labTrends) setLabTrends(inProgress.labTrends);
        if (inProgress.teachingLens) setTeachingLens(inProgress.teachingLens);
        if (inProgress.focusAreas) setFocusAreas(inProgress.focusAreas);
        if (inProgress.aiSuggestedFocus) setAiSuggestedFocus(inProgress.aiSuggestedFocus);
        if (inProgress.customTopics) setCustomTopics(inProgress.customTopics);
        if (inProgress.sources) setSources(inProgress.sources);
        if (inProgress.sessionGoal) setSessionGoal(inProgress.sessionGoal);
        if (inProgress.aiEnabled !== undefined) setAiEnabled(inProgress.aiEnabled);
        setRestoredSession({ timestamp: inProgress.timestamp });
      }
      // Load bulky items separately (each has its own storage key due to 5MB per-key cap)
      const sr = await safeGet("inProgress_sourceResponses");
      if (sr) setSourceResponses(sr);
      const pdfs = await safeGet("inProgress_pdfs");
      if (pdfs) setPdfAttachments(pdfs);
      const imgs = await safeGet("inProgress_images");
      if (imgs) setImageAttachments(imgs);
      const bytes = await safeGet("inProgress_imageBytes");
      if (bytes !== null) setSessionImageBytes(bytes);
      const gen = await safeGet("inProgress_generated");
      if (gen) {
        if (gen.aiTeachingContent) setAiTeachingContent(gen.aiTeachingContent);
        if (gen.synthesizedEvidence) setSynthesizedEvidence(gen.synthesizedEvidence);
        if (gen.generatedDoc) setGeneratedDoc(gen.generatedDoc);
        if (gen.previewData) setPreviewData(gen.previewData);
      }

      // Mark load complete — from now on, changes will trigger auto-save
      setHasRestored(true);
    })();
  }, []);

  // Auto-save watchers — each runs when the relevant piece of state changes
  useEffect(() => {
    if (!hasRestored) return;
    debouncedSave("inProgress", {
      timestamp: new Date().toISOString(),
      clinicalNote, chiefConcern, workingDx, extractedTopics, noteAnalysis,
      activeProblems, selectedProblems, patientQuotes, labTrends, teachingLens,
      focusAreas, aiSuggestedFocus, customTopics, sources, sessionGoal, aiEnabled,
    });
  }, [hasRestored, clinicalNote, chiefConcern, workingDx, extractedTopics, noteAnalysis,
      activeProblems, selectedProblems, patientQuotes, labTrends, teachingLens,
      focusAreas, aiSuggestedFocus, customTopics, sources, sessionGoal, aiEnabled, debouncedSave]);

  useEffect(() => {
    if (!hasRestored) return;
    debouncedSave("inProgress_sourceResponses", sourceResponses);
  }, [hasRestored, sourceResponses, debouncedSave]);

  useEffect(() => {
    if (!hasRestored) return;
    debouncedSave("inProgress_pdfs", pdfAttachments);
  }, [hasRestored, pdfAttachments, debouncedSave]);

  useEffect(() => {
    if (!hasRestored) return;
    debouncedSave("inProgress_images", imageAttachments);
  }, [hasRestored, imageAttachments, debouncedSave]);

  useEffect(() => {
    if (!hasRestored) return;
    debouncedSave("inProgress_imageBytes", sessionImageBytes);
  }, [hasRestored, sessionImageBytes, debouncedSave]);

  useEffect(() => {
    if (!hasRestored) return;
    debouncedSave("inProgress_generated", {
      aiTeachingContent, synthesizedEvidence, generatedDoc, previewData,
    });
  }, [hasRestored, aiTeachingContent, synthesizedEvidence, generatedDoc, previewData, debouncedSave]);

  const discardRestoredSession = async () => {
    if (!confirm("Discard all restored work and start fresh? This will clear the current clinical note, sources, attachments, and any generated content.")) return;
    try {
      await storage.delete("inProgress");
      await storage.delete("inProgress_sourceResponses");
      await storage.delete("inProgress_pdfs");
      await storage.delete("inProgress_images");
      await storage.delete("inProgress_imageBytes");
      await storage.delete("inProgress_generated");
    } catch {}
    // Reset all in-progress state
    setClinicalNote(""); setChiefConcern(""); setWorkingDx("");
    setExtractedTopics([]); setNoteAnalysis(null);
    setActiveProblems([]); setSelectedProblems([]);
    setPatientQuotes([]); setLabTrends([]);
    setTeachingLens("general_im");
    setFocusAreas({ history: false, physicalExam: false, differential: false, workup: false, management: false, patientContext: false, ebm: false, communication: false });
    setAiSuggestedFocus(null);
    setCustomTopics([]);
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
    setActiveTab("setup");
    setRestoredSession(null);
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
    uptodate: "https://www.uptodate.com/contents/search",
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

      const sys = `You are a medical education assistant analyzing a clinical note for a medical student in a longitudinal integrated clerkship.

${lensGuidance[teachingLens]}

${lensGuidance[teachingLens]}

CU DEFINITION OF PATIENT COMPLEXITY (for calibrating your teaching):
- Common presentation = single or a few uncomplicated concerns, routine problem, minimal intervention/orders/follow-up needed, or follow-up care of a stable chronic condition.
- Complex presentation = multiple problems that may interact and require extensive clinical decision-making, extensive test/referral/medication ordering, undifferentiated patient with unclear diagnosis, atypical presentation of a common diagnosis, patient needing urgent/emergent care, or decision-making heavily influenced by a complex social situation.

This patient is: ${session.complexity === "complex" ? "COMPLEX" : "COMMON"} per the attending's judgment. ${session.complexity === "complex" ? "Complexity means the student is not yet expected to manage this level independently — care of complex patients is an Alpine/Summit (M3/M4) expectation, not an LIC-year expectation. Your teaching should reflect that. Focus on helping the student recognize the features that MAKE this complex, and on the specific reasoning threads a preceptor uses to navigate the complexity. Do not expect Sub-I-level ownership of the plan." : "Common means the student SHOULD be building toward independent care of this type of presentation. Your teaching should reinforce the pattern recognition, workup, and management approach for this presentation type — this is the bread and butter they need to own by end of the LIC year."}

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
  const generateAiTeachingContent = async (synthesizedEvidenceParam = null) => {
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

    // Generate one teaching case per API call, with waits between
    for (let i = 0; i < problemsToTeach.length; i++) {
      const problem = problemsToTeach[i];
      setAiStatus(prev => ({ ...prev, progress: `Generating teaching case ${i+1} of ${problemsToTeach.length}: ${problem}` }));

const sys = `You are a warm, engaged teaching attending in internal medicine writing a personalized learning document for YOUR medical student about a patient you saw together today.

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
- Write directly TO the student in second person ("Notice how our patient...", "When you saw Ms. X today...", "This is a case where...")
- Reference the specific patient by their pronoun and clinical story throughout — not "the patient" abstractly, but "our patient today with her 45-lb weight loss on Zepbound and 6-month lapse in levothyroxine"
- Every learning point should START with what you observed together in this specific encounter, THEN pivot to the teaching principle
- Sound like a thoughtful attending debriefing a case over coffee, not a textbook chapter
- Include the WHY behind clinical decisions ("I held off on the GYN referral today because...")
- Reference the patient's own words, concerns, life context, and social situation when relevant
- When possible, tie teaching to what YOU as the attending noticed, decided, or would want the student to walk away thinking about

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

EXAMPLES OF GOOD vs. BAD VOICE AND CITATIONS:
- BAD (textbook + tool citation): "TSH >10 indicates severe hypothyroidism requiring treatment (per OpenEvidence)."
- GOOD (attending + real citation): "Our patient's TSH of 13.8 after six months off her levothyroxine tells us just how quickly the thyroid axis decompensates — she's essentially back to where she started at diagnosis. This is why I emphasized to her that adherence matters more than dose adjustments right now (ATA 2014 guidelines)."

- BAD: "Menorrhagia can be caused by hypothyroidism (OpenEvidence and DoxGPT)."
- GOOD: "You'll remember she described her periods as 'outrageously heavy' every two weeks. Before you jump to a GYN referral, consider: uncontrolled hypothyroidism is one of the most common reversible causes of menorrhagia we see. That's why I want to treat her thyroid first — if we fix that, we may fix her bleeding without a hysterectomy (ACOG Practice Bulletin 128; ATA 2014)."

- BAD: "The patient should be counseled on adherence (per OpenEvidence)."
- GOOD: "System-level barriers like a name mismatch on refill records — exactly what happened to our patient — are increasingly recognized as a driver of apparent 'non-adherence.' Asking 'have you been able to get your medications?' rather than 'are you taking them?' surfaces these barriers (VA/DoD Clinical Practice Guidelines 2022)."

Return ONLY valid JSON (no markdown fences, no commentary). CRITICAL JSON RULES: (1) Use straight quotes " and ' — NEVER smart/curly quotes. (2) When you need an apostrophe or quote inside a string value, use single quote ' — never backslash-escape (\\"). Example: "vignette": "The patient's mother says 'take a look'" — NOT "vignette": "The patient\\'s mother says \\"take a look\\"". (3) Never include line breaks inside string values.

{
  "problem": "${problem}",
  "primaryDiagnosis": {"name": "the diagnosis", "briefDefinition": "1-2 sentences framed around what makes it relevant for THIS patient"},
  "illnessScript": {
    "epidemiology": "1-2 sentences on who typically gets this (age, sex, risk factors, populations at higher prevalence). Reference our patient's demographics where they fit or contrast the pattern.",
    "timeCourse": "1-2 sentences on the classic tempo of the illness — acute, subacute, chronic, episodic, progressive — and where our patient's presentation fits on that spectrum.",
    "keySymptoms": "The classic symptom cluster (3-5 bullet-worthy items presented as a comma-separated list in a sentence). Note which of these our patient does and doesn't have.",
    "keySigns": "The classic physical exam findings (2-4 items). Note which of these are present or absent in our patient.",
    "keyLabsImaging": "The characteristic lab/imaging pattern (2-3 items). Note where our patient's findings fit or diverge.",
    "naturalHistory": "1-2 sentences on what happens if untreated, and typical response to first-line treatment. Anchor to what we expect for our patient specifically."
  },
  "differentialDiagnosis": [{"diagnosis": "alternative", "reasoning": "why you considered it for OUR patient — reference her actual features, meds, or context"}],
  "keyLearningPoints": [{"point": "concise title", "explanation": "2-3 sentences that START with something specific about our patient's presentation, THEN teach the concept — written TO the student. The real clinical citation appears in the 'citation' field below and will be shown inline in italics; do NOT also put it in the explanation prose in parentheses.", "citation": "real trial name / org+year / USPSTF grade — NEVER a tool name like OpenEvidence", "provenance": ["AI-tool names for internal tracking only — never displayed as citation"], "figureRef": "figure ID from FIGURES AVAILABLE if visualized, else empty"}],
  "shelfQuestions": [{"vignette": "clinical vignette calibrated to the SHELF DIFFICULTY level specified below — length and complexity should match that level, not a generic 'medium' difficulty. Can invent a new patient for the vignette if useful.", "options": {"A":"...","B":"...","C":"...","D":"..."}, "correctAnswer": "A/B/C/D", "explanation": "detailed teaching explanation of why the correct answer is right and why each distractor is wrong — calibrated depth to shelf difficulty level"}],
  "focusedHistoryQuestions": [{"question": "the question", "rationale": "what YOU as attending were listening for when I would have asked this in OUR patient's visit today"}],
  "physicalExam": {"maneuver": "exam maneuver relevant to OUR patient's presentation", "steps": ["step 1", "step 2"], "interpretation": "what a positive/negative finding would tell you about THIS patient specifically"},
  "keyLabsAndImaging": [{"study": "name", "purpose": "why I ordered/would order it for OUR patient", "interpretation": "what her actual result (or what a hypothetical result) would mean in her clinical context", "role": "how it changes management for HER"}],
  "treatmentApproach": {"firstLine": [{"treatment": "name", "dosing": "dose/route/frequency", "evidence": "real trial/guideline citation (e.g. 'ATA 2022', 'SPRINT trial') — NEVER a tool name — plus 1 sentence explaining WHY this fits our patient", "provenance": ["AI-tool names for internal tracking only"]}], "additional": ["patient-specific considerations, not generic bullet points"]},
  "patientContextConsiderations": "2-3 sentences about THIS patient's specific SDoH, values, goals, and life situation — reference her actual story (job, family, MST, name issue, whatever's relevant)",
  "recommendedReading": [{"reference": "landmark trial/guideline name", "relevance": "why I want you to read this after seeing OUR patient today"}],
  "communicationTeaching": {"scenario": "a specific conversation that came up (or could have come up) in OUR visit today", "script": "example language YOU could use with this patient — reference her actual concerns, quotes, or emotional state"},
  "clinicalPearl": "one memorable teaching point framed as something YOU as the attending want the student to walk away remembering from OUR encounter today",
  "quoteToDiscuss": "if the patient said something in the note that is teachable, quote it verbatim; else empty string"
}

ALWAYS include these core sections regardless of focus selection: primaryDiagnosis, illnessScript, differentialDiagnosis, keyLearningPoints, shelfQuestions (exactly 3), recommendedReading, clinicalPearl, quoteToDiscuss.

The illnessScript section is the anchor for the student's growing library of pattern recognition — this is the CU Trek curriculum's explicit expectation (MEPO Patient Care #8: "organize knowledge of clinical and basic medical science using illness scripts"). Even if this is a case with an obvious diagnosis, the illness script section formalizes the pattern so the student can retrieve it faster next time. Do NOT skip this section. Do NOT make it generic textbook material — always anchor each element to what our specific patient does or does not show.

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
        console.log(`[teachingCase] "${problem}" citations:`, parsed.keyLearningPoints?.map(lp => lp.citation).filter(Boolean));
        // Always inject the known problem name — never trust the AI to echo it correctly
        parsed.problem = problem;
        teachingCases.push(parsed);
      } catch (e) {
        console.error(`Failed to generate case for "${problem}":`, e);
        // Continue with remaining problems instead of failing entirely
      }

      if (i < problemsToTeach.length - 1) {
        setAiStatus(prev => ({ ...prev, progress: `Working on case ${i+2} of ${problemsToTeach.length}` }));
        await wait(8000);
      }
    }

    // Cross-cutting themes as a separate small call
    let crossCuttingThemes = [];
    let questionsForReflection = [];
    if (teachingCases.length > 1) {
      await wait(3000);
      setAiStatus(prev => ({ ...prev, progress: "Generating cross-cutting themes" }));
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
      case "other":
      default:
        // "Other" and unknown sources reuse the OpenEvidence-style prompt
        return base + `Provide evidence-based teaching content:\n1. For each focus area, current evidence base with landmark citations (author, year, journal)\n2. Current guideline recommendations by name and year\n3. Ongoing clinical equipoise or debate\n4. Evidence that changed practice in the last 2-3 years\n\nFormat as structured summary I can bring to a teaching session.`;
    }
  };

 // ===== Generate preview (was: generate document) =====
  const generateDocument = async () => {
    setAiStatus({ ...aiStatus, generating: true, error: null });
    let aiContent = null;
    let synthesized = null;

    const filledSources = activeSources.filter(s =>
      s === "pubmedai"
        ? Object.values(sourceResponses.pubmedai || {}).some(v => v?.html?.trim())
        : sourceResponses[s]?.html?.trim()
    );

    if (aiEnabled && activeFocusList.length > 0) {
      const errors = [];
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      // Call 1 (NEW ORDER): Synthesize sources first, so teaching cases can reference structured claims
      const hasPdfs = pdfAttachments.some(p => p.extractedText?.trim() && !p.error);
      if (filledSources.length >= 1 || hasPdfs) {
        setAiStatus({ analyzing: false, generating: true, error: null, progress: "Synthesizing evidence from all sources" });
        try {
          synthesized = await synthesizeSources();
          setSynthesizedEvidence(synthesized);
        } catch (e) {
          errors.push(`Source synthesis: ${e.message}`);
        }
        await wait(3000);
      }

      // Call 2: Teaching content — now has access to `synthesized` for grounded citations
      setAiStatus(prev => ({ ...prev, progress: "Generating teaching cases" }));
      try {
        aiContent = await generateAiTeachingContent(synthesized);
        setAiTeachingContent(aiContent);
      } catch (e) {
        errors.push(`Teaching content: ${e.message}`);
      }

      if (errors.length > 0) {
        console.error("Generation errors:", errors);
        setAiStatus({ analyzing: false, generating: false, error: errors.join(" · "), progress: null });
      } else {
        setAiStatus({ analyzing: false, generating: false, error: null, progress: null });
      }
    } else {
      // AI disabled or no focus areas selected — still handle sources
      const hasPdfs = pdfAttachments.some(p => p.extractedText?.trim() && !p.error);
      if (filledSources.length >= 1 || hasPdfs) {
        try {
          synthesized = await synthesizeSources();
        } catch (e) {
          console.error("Synthesis failed:", e);
        }
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
      imageAttachments,
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

    

  const saveState = async () => {
    try {
      await storage.set("session", JSON.stringify(session));
      await storage.set("longTermGoals", JSON.stringify(longTermGoals));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error(e); }
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
        }

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
        @media (max-width: 1200px) {
          .preview-split-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .preview-split-grid > div:last-child .sticky {
            position: static !important;
          }
        }
        @page { margin: 0.55in; }
        @page :first { margin: 0; }
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
            <div className="flex items-center gap-2">
              {hasRestored && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition ${
                    saveStatus.state === "error"
                      ? "bg-amber-50 border border-amber-200 text-amber-800"
                      : saveStatus.state === "saving"
                      ? "bg-indigo-50 border border-indigo-200 text-indigo-700"
                      : saveStatus.lastSavedAt
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                      : "bg-slate-50 border border-slate-200 text-slate-500"
                  }`}
                  title={saveStatus.error || (saveStatus.lastSavedAt ? `Last saved ${new Date(saveStatus.lastSavedAt).toLocaleString()}` : "Auto-save enabled")}
                >
                  {saveStatus.state === "saving" && (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  )}
                  {saveStatus.state === "saved" && (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Saved · {formatSaveTime(saveStatus.lastSavedAt)}</span>
                    </>
                  )}
                  {saveStatus.state === "error" && (
                    <>
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Save failed</span>
                      <button onClick={retrySave} className="underline hover:text-amber-900">Retry</button>
                    </>
                  )}
                  {saveStatus.state === "idle" && (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Auto-save on</span>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={() => {
                  if (confirm("Start a new session? Your current clinical note, sources, PDFs, and any generated content will be cleared. Long-term goals and session settings will be kept.")) {
                    discardRestoredSession();
                  }
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition"
                title="Clear the current case and start fresh (long-term goals are preserved)"
              >
                <Plus className="w-4 h-4" />
                New session
              </button>
            </div>
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
          <div style={{
            background: "linear-gradient(180deg, #fefce8 0%, #fff 100%)",
            border: "1px solid #fef3c7",
            borderRadius: "10px",
            padding: "0.875rem 1rem",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            fontSize: "0.75rem",
            color: "#4b5563",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1rem" }}>💡</span>
              <span style={{ fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.11em", fontSize: "0.62rem", fontWeight: 600, color: "#78350f" }}>
                Food for thought
              </span>
            </div>
            <div style={{ fontWeight: 600, color: "#1f2937", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
              {phase.name}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              Month {phase.monthsIn + 1} of Foothills LIC
            </div>
            <div style={{ fontSize: "0.75rem", lineHeight: 1.5, color: "#4b5563", marginBottom: "0.5rem" }}>
              {phase.focus}
            </div>
            <div style={{ fontSize: "0.7rem", fontStyle: "italic", color: "#6b7280", marginBottom: "0.5rem" }}>
              {phase.pace}
            </div>
            {phase.workingToward && (
              <details style={{ fontSize: "0.7rem", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid #fef3c7" }}>
                <summary style={{ cursor: "pointer", fontWeight: 500, color: "#78350f" }}>Working toward →</summary>
                <div style={{ marginTop: "0.4rem", color: "#4b5563", lineHeight: 1.5 }}>{phase.workingToward}</div>
                {phase.supervisionExpectation && (
                  <div style={{ marginTop: "0.4rem", color: "#6b7280", fontStyle: "italic" }}>
                    <strong style={{ fontStyle: "normal", color: "#4b5563" }}>Supervision: </strong>
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
        {restoredSession && (
          <div className="no-print mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-center gap-2">
            <Save className="w-4 h-4 flex-shrink-0 text-emerald-700" />
            <div className="flex-1">
              <strong>Session restored</strong> from {new Date(restoredSession.timestamp).toLocaleString()}. Your work will continue to save automatically.
            </div>
            <button
              onClick={discardRestoredSession}
              className="text-xs px-2 py-1 bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 rounded"
            >
              Discard & start fresh
            </button>
            <button
              onClick={() => setRestoredSession(null)}
              className="text-emerald-600 hover:text-emerald-900"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
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
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              if (selected) setSelectedProblems(selectedProblems.filter(sp => sp !== p.problem));
                              else setSelectedProblems([...selectedProblems, p.problem]);
                            }}
                            className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition ${selected ? "bg-indigo-50 border-2 border-indigo-400 shadow-sm" : "bg-slate-50 border-2 border-slate-200 hover:border-indigo-300 hover:bg-white"}`}
                          >
                            <div className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 flex items-center justify-center transition ${selected ? "bg-indigo-600" : "bg-white border-2 border-slate-300"}`}>
                              {selected && <Check className="w-3.5 h-3.5 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{p.problem}</div>
                              {p.keyIssue && <div className="text-xs text-slate-600 mt-1">{p.keyIssue}</div>}
                              {p.teachingValue && <div className="text-xs text-indigo-700 mt-1 italic"><span className="font-medium not-italic">Teaching value: </span>{p.teachingValue}</div>}
                            </div>
                          </button>
                        );
                      })}
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
                <h3 className="font-semibold text-slate-900 mb-1">Extra topics to teach as their own cases</h3>
                <p className="text-sm text-slate-500">Add topics beyond the case diagnoses — each becomes its own teaching case in the final document. E.g., "imaging findings in acute cholecystitis" or "how to counsel about weight-loss medication side effects".</p>
                {(selectedProblems.length + customTopics.length) > 0 && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-800 rounded-full text-xs font-medium">
                    <Sparkles className="w-3 h-3" />
                    Will generate {selectedProblems.length + customTopics.length} teaching case{(selectedProblems.length + customTopics.length) !== 1 ? "s" : ""}
                    {customTopics.length > 0 && ` (${selectedProblems.length} from problems + ${customTopics.length} extra)`}
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
                    <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded text-xs text-purple-900 flex items-center gap-2">
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
                          <>
                            <button
                              onClick={e => { e.stopPropagation(); setPromptViewerFor(src); }}
                              className="text-xs px-3 py-1.5 bg-slate-600 text-white hover:bg-slate-700 rounded transition flex items-center gap-1"
                              title="Open prompt in a popup for review"
                            >
                              <FileText className="w-3 h-3" />View Prompt
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); copyPrompt(src); }}
                              className={`text-xs px-3 py-1.5 rounded transition flex items-center gap-1 ${copiedPrompt === src ? "bg-emerald-600 text-white" : "bg-emerald-500 text-white hover:bg-emerald-600"}`}
                              title="Copy the prompt to clipboard"
                            >
                              {copiedPrompt === src ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy Prompt</>}
                            </button>
                          </>
                        )}
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
                      </div>
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
                        <div className="relative">
                          <img src={img.dataUrl} alt={img.caption || img.filename} className="w-full h-32 object-contain bg-white rounded" />
                          <button
                            onClick={() => removeImageAttachment(img.id)}
                            className="absolute top-1 right-1 bg-white/95 hover:bg-red-100 text-slate-500 hover:text-red-600 rounded-full w-6 h-6 flex items-center justify-center shadow"
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
                <div style={{ background: "linear-gradient(135deg, #fefce8 0%, #fff 100%)", border: "1px solid #fef3c7", borderRadius: "10px", padding: "1rem 1.25rem" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "1.1rem" }}>💡</span>
                      <div>
                        <div style={{ fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.11em", fontSize: "0.65rem", fontWeight: 600, color: "#78350f" }}>
                          AI recommendations
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          Based on today's case and your phase-appropriate benchmarks
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={generateGoalRecommendations}
                      disabled={loadingGoalRecs}
                      className="text-xs px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg font-medium flex items-center gap-1 disabled:opacity-50"
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
                          className="group flex items-start gap-2 p-2.5 bg-white/70 hover:bg-white border border-amber-100 hover:border-amber-300 rounded-lg transition"
                        >
                          <button
                            onClick={() => acceptGoalRecommendation(rec)}
                            className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 hover:bg-emerald-600 text-emerald-700 hover:text-white flex items-center justify-center transition mt-0.5"
                            title="Add this goal"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-slate-900 leading-snug">{rec.goal}</div>
                            {rec.rationale && (
                              <div className="text-xs text-slate-500 italic mt-1">
                                <span className="font-medium not-italic">Why: </span>{rec.rationale}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => dismissGoalRecommendation(rec)}
                            className="flex-shrink-0 text-slate-300 hover:text-slate-600 p-0.5 opacity-0 group-hover:opacity-100 transition"
                            title="Dismiss this suggestion"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {!loadingGoalRecs && recommendedGoals.length === 0 && !goalRecError && (
                    <div className="text-xs text-slate-500 italic mt-2">
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
                fetchingPubmed={fetchingPubmed}
                aiStatus={aiStatus}
                focusLabels={focusLabels}
                phase={phase}
                session={session}
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
          {promptViewerFor && (
          <PromptViewer
            sourceName={sourceLabels[promptViewerFor]}
            initialPrompt={generateSourcePrompt(promptViewerFor)}
            onClose={() => setPromptViewerFor(null)}
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
function PreviewEditor({ previewData, togglePreviewSection, toggleTeachingCase, updatePreviewField, updateTeachingCaseField, commitPreviewToDocument, onBack, onRegenerate, aiStatus, focusLabels, phase, session }) {
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
    <div>
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
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-xs uppercase font-semibold text-slate-500 tracking-wider">Live Preview</div>
              <div className="text-xs text-slate-400 italic">Read-only · edits happen in the left panel</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
              <div style={{ transform: "scale(0.72)", transformOrigin: "top left", width: "138.9%", pointerEvents: "none" }}>
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
  // ============ HTML EXPORT ============
  // Serialize the rendered document to a standalone .html file with interactive shelf questions
  // and clickable navigation. Fully offline — no external dependencies.
  const exportAsHtml = () => {
    if (!editableRef.current) return;

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
</body>
</html>`;

    // Trigger download
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `teaching-document-${student.replace(/[^a-z0-9]/gi, "_")}-${sessionDate}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        <button onClick={exportAsHtml} className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium" title="Download as a standalone interactive HTML file to give to the student">
          <FileText className="w-4 h-4" />Export as Interactive HTML
        </button>
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
      <div style={{ padding: "2.5rem 3rem 2rem" }}>

        {/* Case at a Glance */}
        {s.caseAtGlance?.enabled && (doc.chiefConcern || doc.workingDx || doc.selectedProblems?.length > 0) && (
          <section className="keep-together" style={{ marginBottom: "2rem" }}>
            <h2 className="doc-h2">Case at a Glance</h2>
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
                <div className="doc-case-numeral">Case {String(idx + 1).padStart(2, "0")} of {String(enabledCases.length).padStart(2, "0")}</div>
                <h2 className="doc-case-title">{c.problem}</h2>
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
              )}

              {c.differentialDiagnosis?.length > 0 && (    
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Differential Diagnosis</div>
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
              )}

              {c.treatmentApproach && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div className="doc-subsection-label">Treatment Approach</div>
                  {c.treatmentApproach.firstLine?.length > 0 && (
                    <div className="keep-together" style={{ marginBottom: "1rem" }}>
                      <div className="doc-meta-label" style={{ marginBottom: "0.4rem" }}>First-Line Management</div>
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
                              <td style={{ fontWeight: 500, color: "var(--doc-navy)" }}>{t.treatment}</td>
                              <td>{t.dosing}</td>
                              <td style={{ fontFamily: "'Source Serif 4', serif", fontStyle: "italic", color: "var(--doc-warm-gray)" }}>{t.evidence}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
            {s.longTermGoals?.enabled && s.longTermGoals.content?.length > 0 && (
              <section>
                <h2 className="doc-h2">Ongoing Learning Goals</h2>
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
                  {s.longTermGoals.content.map(g => (
                    <li key={g.id} style={{ marginBottom: "0.75rem", paddingLeft: "0.85rem", borderLeft: "2px solid var(--doc-navy-mid)" }}>
                      <div>{g.text}</div>
                      <div className="doc-meta-label" style={{ marginTop: "0.2rem" }}>Added {g.added}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
                <div className="doc-meta-label" style={{ marginBottom: "0.4rem" }}>Come Prepared To</div>
                <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  <li style={{ marginBottom: "0.3rem" }}>Discuss the questions above.</li>
                  <li style={{ marginBottom: "0.3rem" }}>Bring one question that came up while working through this material.</li>
                  <li>Identify one area where you felt unsure.</li>
                </ul>
              </section>
            )}
          </div>
        )}
{/* Reference Figures (user-attached images) */}
        {doc.imageAttachments && doc.imageAttachments.length > 0 && (
          <section style={{ marginTop: "2.5rem" }} className="keep-together">
            <h2 className="doc-h2">Reference Figures</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
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
          <div style={{ marginTop: "0.5rem", fontSize: "0.65rem" }}>Generated {doc.generated}</div>
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
      className="no-print"
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
      <button
        onClick={onClose}
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
function PromptViewer({ sourceName, initialPrompt, onCopy, onClose }) {
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
      className="no-print"
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
      <div
        onClick={e => e.stopPropagation()}
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
        <div style={{
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
            <div style={{ fontSize: "1.1rem", fontWeight: 600, marginTop: "0.15rem" }}>{sourceName}</div>
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
            minHeight: "300px",
          }}
        />

        <div style={{
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