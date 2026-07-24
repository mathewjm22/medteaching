import { useState, useEffect } from "react";
import { FileText, Printer, Copy, Check, Plus, X, BookOpen, Target, Stethoscope, Brain, ClipboardList, Users, TrendingUp, Save, Trash2, Sparkles, ChevronDown, ChevronRight, Calendar, User, AlertCircle, Zap, Loader2, Wand2 } from "lucide-react";

// ===== Hardcoded config =====
const WORKER_URL = "https://medteachingtool.sweet-dream-0ed6.workers.dev/";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

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

  // Sources
  const [sources, setSources] = useState({
    openevidence: false, uptodate: false, dynamed: false, doxgpt: false, pubmed: false,
  });
  const [sourceResponses, setSourceResponses] = useState({
    openevidence: "", uptodate: "", dynamed: "", doxgpt: "", pubmed: "",
  });

  // Goals
  const [longTermGoals, setLongTermGoals] = useState([]);
  const [newGoal, setNewGoal] = useState("");
  const [sessionGoal, setSessionGoal] = useState("");

  // Generated content
  const [aiTeachingContent, setAiTeachingContent] = useState(null);
  const [generatedDoc, setGeneratedDoc] = useState(null);
  const [synthesizedEvidence, setSynthesizedEvidence] = useState(null);

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
  const sourceLabels = { openevidence: "OpenEvidence", uptodate: "UpToDate", dynamed: "DynaMed", doxgpt: "DoxGPT (Doximity GPT)", pubmed: "PubMed" };

  const activeSources = Object.keys(sources).filter(k => sources[k]);
  const activeFocusList = Object.keys(focusAreas).filter(k => focusAreas[k]);

  // ===== Worker API call =====
  const callAi = async (systemPrompt, userPrompt, maxTokens = 2000) => {
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
      throw new Error(`API error (${res.status}): ${err}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  };

  const extractJson = (text) => {
    let s = text.trim();
    const m = s.match(/\{[\s\S]*\}/);
    if (m) s = m[0];
    return JSON.parse(s);
  };

  // ===== Analyze note with AI =====
  const analyzeNote = async () => {
    if (!clinicalNote.trim()) return;
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
      const user = `Clinical note (de-identified):\n\n${clinicalNote}\n\nStudent is in month ${phase.monthsIn} of LIC (${phase.name} phase). Focus on: ${phase.focus}`;
      const response = await callAi(sys, user, 2500);
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
  const synthesizeSources = async () => {
    const filledSources = activeSources.filter(s => sourceResponses[s]?.trim());
    if (filledSources.length === 0) return null;
    if (filledSources.length === 1) {
      // No synthesis needed for a single source; return as-is
      const src = filledSources[0];
      return { synthesized: false, byPoint: null, singleSource: { source: sourceLabels[src], content: sourceResponses[src] } };
    }
    if (!aiEnabled) return null;

    const sys = `You are synthesizing evidence from multiple medical reference sources into a unified summary.

Your job:
1. Identify overlapping/duplicate information across sources and consolidate it
2. Preserve source-specific unique insights
3. Flag any conflicts or disagreements between sources
4. Organize output by clinical topic, not by source
5. Attribute each point to its source(s) using source names in parentheses

Return ONLY valid JSON (no markdown fences):
{
  "unifiedSummary": "2-3 sentence overview of what all sources agree on",
  "consolidatedPoints": [
    {"topic": "topic or claim", "detail": "the consolidated content", "sources": ["Source name 1", "Source name 2"], "conflictNote": "if sources disagree, describe the conflict; else empty string"}
  ],
  "uniqueInsights": [
    {"source": "source name", "insight": "content only this source provided"}
  ],
  "conflicts": [
    {"topic": "topic where sources disagree", "positions": [{"source": "name", "position": "what they said"}]}
  ]
}`;

    const sourceText = filledSources.map(s => `=== ${sourceLabels[s]} ===\n${sourceResponses[s]}`).join("\n\n");
    const user = `Synthesize these ${filledSources.length} evidence sources into a unified summary. Consolidate duplicates, preserve unique content, flag conflicts.\n\n${sourceText}`;

    const response = await callAi(sys, user, 3000);
    const parsed = extractJson(response);
    return { synthesized: true, ...parsed, sourcesUsed: filledSources.map(s => sourceLabels[s]) };
  };

  // ===== Generate case-specific teaching content =====
  const generateAiTeachingContent = async () => {
    const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
    if (activeFocus.length === 0) return null;
    if (!aiEnabled) return null;

    const lensGuidance = {
      general_im: "",
      geriatrics: "\n\nGERIATRICS lens. For each problem, weave in: Beers criteria (cite specific medications from case), anticholinergic burden scoring, STOPP/START criteria, deprescribing algorithms, goals-of-care, functional assessment (ADLs/IADLs), fall risk (STEADI), 4Ms framework.",
      primary_care: "\n\nPRIMARY CARE lens. Weave in: USPSTF grades and recommendations, shared decision-making, motivational interviewing, chronic disease guideline application.",
      complex_multimorbidity: "\n\nCOMPLEX MULTIMORBIDITY lens. Weave in: problem prioritization, competing treatment goals, patient-centered outcomes, care coordination."
    };

    const problemsToTeach = selectedProblems.length > 0
      ? selectedProblems
      : (workingDx ? [workingDx] : ["primary clinical problem in this case"]);

    const difficultyGuidance = phase.monthsIn <= 3
      ? "shelf questions should be Foundational level (basic pattern recognition, single-step reasoning)"
      : phase.monthsIn <= 7
      ? "shelf questions should be Developing level (multi-step reasoning, illness scripts, requires prioritization)"
      : phase.monthsIn <= 10
      ? "shelf questions should be Advancing level (complex vignettes, subtle findings, management with multiple defensible options)"
      : "shelf questions should be Sub-I level (multi-problem integration, judgment under uncertainty, atypical presentations)";

    const focusFilters = {
      history: activeFocus.includes("history"),
      physicalExam: activeFocus.includes("physicalExam"),
      differential: activeFocus.includes("differential"),
      workup: activeFocus.includes("workup"),
      management: activeFocus.includes("management"),
      patientContext: activeFocus.includes("patientContext"),
      ebm: activeFocus.includes("ebm"),
      communication: activeFocus.includes("communication"),
    };

    const includedSections = [
      focusFilters.differential && "differentialDiagnosis (3 alternatives with reasoning)",
      focusFilters.history && "focusedHistoryQuestions (3-4 questions with rationale)",
      focusFilters.physicalExam && "physicalExam (specific maneuvers with step-by-step technique)",
      focusFilters.workup && "keyLabsAndImaging (5 studies each with purpose/interpretation/role)",
      focusFilters.management && "treatmentApproach (first-line with dosing, plus additional considerations)",
      focusFilters.patientContext && "patientContextConsiderations",
      focusFilters.ebm && "recommendedReading (3 landmark trials/guidelines BY NAME ONLY)",
      focusFilters.communication && "communicationTeaching (scenarios/scripts)",
    ].filter(Boolean).join(", ");

    const sys = `You are a medical education expert generating rigorous teaching content for a medical student in a longitudinal integrated clerkship.

STUDENT LEVEL: Month ${phase.monthsIn} of LIC (${phase.name} phase).
DEVELOPMENTAL FOCUS: ${phase.focus}
DIFFICULTY: ${difficultyGuidance}
${lensGuidance[teachingLens]}

Generate a separate teaching case for EACH selected problem. Reference actual medications, doses, lab values, quotes, and clinical decisions from the note.

CITATION RULES (CRITICAL):
- Cite landmark trials by NAME ONLY (e.g., "RATE-AF trial", "SPRINT trial")
- Cite guidelines by ORGANIZATION and YEAR only (e.g., "2023 AHA/ACC Guideline", "2019 Beers Criteria")
- DO NOT fabricate journal names, page numbers, or authors
- If unsure, write "Landmark evidence exists; recommend PubMed search for [topic]"

Return ONLY valid JSON (no markdown fences):
{
  "teachingCases": [
    {
      "problem": "problem name matching selected problem",
      "primaryDiagnosis": {"name": "primary dx", "briefDefinition": "1-2 sentence definition"},
      "differentialDiagnosis": [
        {"diagnosis": "alt dx 1", "reasoning": "why include/exclude referencing case features"}
      ],
      "keyLearningPoints": [
        {"point": "learning point title", "explanation": "detailed 2-3 sentence explanation", "citation": "landmark trial NAME or guideline org/year"}
      ],
      "shelfQuestions": [
        {"vignette": "clinical vignette", "options": {"A":"...","B":"...","C":"...","D":"..."}, "correctAnswer": "A/B/C/D", "explanation": "detailed explanation"}
      ],
      "focusedHistoryQuestions": [{"question": "history question", "rationale": "why clinically"}],
      "physicalExam": {"maneuver": "exam maneuver", "steps": ["step 1", "step 2"], "interpretation": "what findings mean"},
      "keyLabsAndImaging": [
        {"study": "name", "purpose": "why order", "interpretation": "how to read", "role": "impact on management"}
      ],
      "treatmentApproach": {
        "firstLine": [{"treatment": "name", "dosing": "dose/route/frequency", "evidence": "trial/guideline NAME"}],
        "additional": ["supportive measures", "monitoring", "follow-up"]
      },
      "patientContextConsiderations": "2-3 sentences on SDoH/goals/systems for THIS patient",
      "recommendedReading": [{"reference": "landmark trial/guideline NAME", "relevance": "why relevant"}],
      "communicationTeaching": {"scenario": "communication challenge", "script": "example language"},
      "clinicalPearl": "one high-yield teaching point",
      "quoteToDiscuss": "direct quote from note if relevant, else empty string"
    }
  ],
  "crossCuttingThemes": ["2-3 themes spanning problems"],
  "questionsForReflection": ["2-3 open-ended reflective questions"]
}

Include ONLY these subsections in each teaching case: ${includedSections}

Number of shelf questions per problem: 3.`;

    const problemsContext = problemsToTeach.map((p, i) => `${i+1}. ${p}`).join("\n");
    const quotesContext = patientQuotes.length > 0 ? `\n\nAvailable quotes:\n${patientQuotes.map(q => `- "${q}"`).join("\n")}` : "";
    const trendsContext = labTrends.length > 0 ? `\n\nLab/vital trends:\n${labTrends.map(t => `- ${t.parameter}: ${t.trend}`).join("\n")}` : "";

    const user = `Clinical note:\n${clinicalNote}\n\nChief concern: ${chiefConcern}\n\nGenerate teaching case for EACH:\n${problemsContext}${quotesContext}${trendsContext}\n\nEvery item must reference specific details from THIS case.`;

    const response = await callAi(sys, user, 8000);
    return extractJson(response);
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
      case "pubmed":
        return base + `PubMed search strategy:\n1. 2-3 optimized queries with MeSH terms per focus area\n2. Filters (article types, publication dates)\n3. 3-5 seminal or recent high-impact papers with PMIDs if known\n4. 2-3 critical appraisal questions for the highest-quality paper\n5. Relevant Cochrane reviews`;
      default:
        return base;
    }
  };

  // ===== Generate final document =====
  const generateDocument = async () => {
    setAiStatus({ ...aiStatus, generating: true, error: null });
    let aiContent = null;
    let synthesized = null;

    if (aiEnabled && activeFocusList.length > 0) {
      try {
        // Run teaching content and source synthesis in parallel
        const [tc, syn] = await Promise.all([
          generateAiTeachingContent(),
          synthesizeSources(),
        ]);
        aiContent = tc;
        synthesized = syn;
        setAiTeachingContent(aiContent);
        setSynthesizedEvidence(synthesized);
      } catch (e) {
        setAiStatus({ analyzing: false, generating: false, error: `AI generation failed: ${e.message}` });
      }
    } else {
      // If AI is off, still handle single-source case for evidence display
      const filledSources = activeSources.filter(s => sourceResponses[s]?.trim());
      if (filledSources.length === 1) {
        synthesized = { synthesized: false, singleSource: { source: sourceLabels[filledSources[0]], content: sourceResponses[filledSources[0]] } };
        setSynthesizedEvidence(synthesized);
      }
    }

    const doc = {
      generated: new Date().toLocaleString(),
      student: session.studentName || "Student",
      phase, chiefConcern, workingDx,
      complexity: session.complexity, sessionGoal, extractedTopics,
      focusAreas: activeFocusList,
      teachingLens,
      activeProblems, selectedProblems, patientQuotes, labTrends,
      crossCuttingThemes: aiContent?.crossCuttingThemes || [],
      questionsForReflection: aiContent?.questionsForReflection || [],
      teachingCases: aiContent?.teachingCases || [],
      fallbackCases: !aiContent && selectedProblems.length > 0
        ? selectedProblems.map(p => ({ problem: p, isFallback: true }))
        : (!aiContent && workingDx ? [{ problem: workingDx, isFallback: true }] : []),
      synthesizedEvidence: synthesized,
      rawSourceContent: activeSources
        .filter(s => sourceResponses[s]?.trim())
        .map(s => ({ source: sourceLabels[s], content: sourceResponses[s] })),
      longTermGoals,
      noteAnalysis,
    };
    setGeneratedDoc(doc);
    setActiveTab("output");
    setAiStatus({ analyzing: false, generating: false, error: aiStatus.error });
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
    { id: "output", label: "6. Document", icon: Sparkles },
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
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">External Evidence Sources</h2>
                <p className="text-sm text-slate-500">Prompts are customized with your selected teaching focus. Copy → paste into source → paste response back below.</p>
                {activeSources.filter(s => sourceResponses[s]?.trim()).length > 1 && aiEnabled && (
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
                    <button onClick={() => toggleSection(src)} className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        {expandedSections[src] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        {sourceLabels[src]}
                        {sourceResponses[src]?.trim() && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Response added</span>}
                      </div>
                    </button>
                    {expandedSections[src] && (
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
                          <label className="block text-sm font-medium text-slate-700 mb-1">Paste response from {sourceLabels[src]}</label>
                          <textarea value={sourceResponses[src]} onChange={e => setSourceResponses({...sourceResponses, [src]: e.target.value})} rows={6} placeholder="Response will be synthesized with other sources in the final document..." className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
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

        {/* OUTPUT TAB */}
        {activeTab === "output" && (
          <>
            {!generatedDoc ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <div className="text-slate-500 mb-4">No document generated yet.</div>
                <button onClick={generateDocument} disabled={activeFocusList.length === 0} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">Generate Document</button>
              </div>
            ) : (
              <>
                <div className="no-print flex gap-2 mb-4">
                  <button onClick={printDoc} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"><Printer className="w-4 h-4" />Print / Save as PDF</button>
                  <button onClick={() => setActiveTab("goals")} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">← Edit</button>
                  <button onClick={generateDocument} disabled={aiStatus.generating} className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm flex items-center gap-1">
                    {aiStatus.generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}Regenerate
                  </button>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 print-doc" style={{fontFamily: "Georgia, 'Times New Roman', serif"}}>
                  <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-8 py-6 print-header">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-widest text-slate-300 mb-1">Teaching Session</div>
                        <h1 className="text-2xl font-bold">Clinical Case Learning Document</h1>
                        <div className="text-sm text-slate-200 mt-2">
                          Prepared for <span className="font-semibold text-white">{generatedDoc.student}</span> · {session.sessionDate}
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-300">
                        <div>Generated {generatedDoc.generated}</div>
                        <div className="mt-1 inline-block px-2 py-1 bg-white/10 rounded font-sans">
                          Month {generatedDoc.phase.monthsIn} · {generatedDoc.phase.name}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-8 py-6 space-y-6">
                    {(generatedDoc.chiefConcern || generatedDoc.workingDx || generatedDoc.selectedProblems?.length > 0) && (
                      <section>
                        <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Case at a Glance</h2>
                        <table className="w-full text-sm border border-slate-300">
                          <tbody>
                            {generatedDoc.chiefConcern && (
                              <tr className="border-b border-slate-200">
                                <td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 w-40 align-top">Chief concern</td>
                                <td className="px-3 py-2 text-slate-800">{generatedDoc.chiefConcern}</td>
                              </tr>
                            )}
                            {generatedDoc.workingDx && (
                              <tr className="border-b border-slate-200">
                                <td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Primary working diagnosis</td>
                                <td className="px-3 py-2 text-slate-800">{generatedDoc.workingDx}</td>
                              </tr>
                            )}
                            <tr className="border-b border-slate-200">
                              <td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Complexity</td>
                              <td className="px-3 py-2 text-slate-800">{generatedDoc.complexity === "common" ? "Common presentation" : "Complex presentation"}</td>
                            </tr>
                            {generatedDoc.teachingLens && generatedDoc.teachingLens !== "general_im" && (
                              <tr className="border-b border-slate-200">
                                <td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Teaching lens</td>
                                <td className="px-3 py-2 text-slate-800">{{geriatrics: "Geriatrics / Deprescribing", primary_care: "Primary Care / Preventive", complex_multimorbidity: "Complex Multimorbidity"}[generatedDoc.teachingLens]}</td>
                              </tr>
                            )}
                            {generatedDoc.selectedProblems?.length > 0 && (
                              <tr className="border-b border-slate-200">
                                <td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Problems in focus</td>
                                <td className="px-3 py-2 text-slate-800">
                                  <ul className="list-disc ml-4 space-y-0.5">
                                    {generatedDoc.selectedProblems.map((p, i) => <li key={i}>{p}</li>)}
                                  </ul>
                                </td>
                              </tr>
                            )}
                            {generatedDoc.extractedTopics?.length > 0 && (
                              <tr>
                                <td className="bg-slate-100 px-3 py-2 font-semibold text-slate-700 align-top">Key teaching topics</td>
                                <td className="px-3 py-2 text-slate-800">{generatedDoc.extractedTopics.join(" · ")}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </section>
                    )}

                    {generatedDoc.sessionGoal && (
                      <section>
                        <div className="border-l-4 border-indigo-600 bg-indigo-50 px-4 py-3">
                          <div className="text-xs uppercase tracking-widest text-indigo-700 font-bold mb-1">Session Goal</div>
                          <div className="text-slate-800 font-medium">{generatedDoc.sessionGoal}</div>
                        </div>
                      </section>
                    )}

                    <section>
                      <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Phase-Aligned Framing</h2>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div className="border border-slate-300 p-3 rounded">
                          <div className="text-xs uppercase text-slate-500 font-semibold mb-1">Current Phase</div>
                          <div className="font-semibold text-slate-900">{generatedDoc.phase.name}</div>
                        </div>
                        <div className="border border-slate-300 p-3 rounded">
                          <div className="text-xs uppercase text-slate-500 font-semibold mb-1">Month in LIC</div>
                          <div className="font-semibold text-slate-900">Month {generatedDoc.phase.monthsIn}</div>
                        </div>
                        <div className="border border-slate-300 p-3 rounded">
                          <div className="text-xs uppercase text-slate-500 font-semibold mb-1">Expected Pace</div>
                          <div className="text-slate-800 text-xs">{generatedDoc.phase.pace}</div>
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-slate-700 leading-relaxed">
                        <strong>Developmental focus:</strong> {generatedDoc.phase.focus}. The exercises below are calibrated to this stage per the CU School of Medicine MEPO framework.
                      </div>
                    </section>

                    {/* Teaching Cases */}
                    {generatedDoc.teachingCases?.length > 0 ? (
                      generatedDoc.teachingCases.map((tc, caseIdx) => (
                        <section key={caseIdx} className="section-block">
                          <div className="bg-slate-800 text-white px-4 py-3 rounded-t">
                            <div className="text-xs uppercase tracking-widest text-slate-300">Teaching Case {caseIdx + 1} of {generatedDoc.teachingCases.length}</div>
                            <h2 className="text-lg font-bold mt-0.5">{tc.problem}</h2>
                          </div>

                          <div className="border border-t-0 border-slate-300 rounded-b p-4 space-y-4">
                            {tc.primaryDiagnosis?.name && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-1">Primary Diagnosis</div>
                                <div className="text-sm text-slate-800">
                                  <span className="font-bold">{tc.primaryDiagnosis.name}.</span>
                                  {tc.primaryDiagnosis.briefDefinition && <span> {tc.primaryDiagnosis.briefDefinition}</span>}
                                </div>
                              </div>
                            )}

                            {generatedDoc.focusAreas.includes("differential") && tc.differentialDiagnosis?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Differential Diagnosis & Clinical Reasoning</div>
                                <table className="w-full text-sm border border-slate-200">
                                  <thead>
                                    <tr className="bg-slate-100">
                                      <th className="px-3 py-1.5 text-left font-semibold text-slate-700 w-1/3">Alternative Diagnosis</th>
                                      <th className="px-3 py-1.5 text-left font-semibold text-slate-700">Clinical Reasoning</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {tc.differentialDiagnosis.map((dd, i) => (
                                      <tr key={i} className="border-t border-slate-200">
                                        <td className="px-3 py-2 font-semibold text-slate-900 align-top">{dd.diagnosis}</td>
                                        <td className="px-3 py-2 text-slate-700">{dd.reasoning}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {tc.keyLearningPoints?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">
                                  Key Learning Points
                                  <span className="ml-2 text-slate-500 normal-case tracking-normal font-normal italic">Calibrated to {generatedDoc.phase.name}</span>
                                </div>
                                <ol className="space-y-2">
                                  {tc.keyLearningPoints.map((lp, i) => (
                                    <li key={i} className="text-sm text-slate-800 flex gap-2">
                                      <span className="font-bold text-slate-500 flex-shrink-0 min-w-[1.5rem]">{i+1}.</span>
                                      <div>
                                        <span className="font-semibold text-slate-900">{lp.point}.</span>
                                        <span className="text-slate-700"> {lp.explanation}</span>
                                        {lp.citation && <span className="text-xs text-slate-500 italic ml-1">({lp.citation})</span>}
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            )}

                            {(generatedDoc.focusAreas.includes("history") && tc.focusedHistoryQuestions?.length > 0) ||
                             (generatedDoc.focusAreas.includes("physicalExam") && tc.physicalExam?.maneuver) ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {generatedDoc.focusAreas.includes("history") && tc.focusedHistoryQuestions?.length > 0 && (
                                  <div>
                                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Focused History Questions</div>
                                    <ul className="space-y-2">
                                      {tc.focusedHistoryQuestions.map((hq, i) => (
                                        <li key={i} className="text-sm text-slate-800">
                                          <div className="font-semibold">{hq.question}</div>
                                          <div className="text-xs text-slate-600 italic mt-0.5">Rationale: {hq.rationale}</div>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {generatedDoc.focusAreas.includes("physicalExam") && tc.physicalExam?.maneuver && (
                                  <div>
                                    <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Physical Examination</div>
                                    <div className="text-sm text-slate-800">
                                      <div className="font-semibold mb-1">{tc.physicalExam.maneuver}</div>
                                      {tc.physicalExam.steps?.length > 0 && (
                                        <ol className="ml-4 list-decimal space-y-1 mb-2">
                                          {tc.physicalExam.steps.map((s, i) => <li key={i}>{s}</li>)}
                                        </ol>
                                      )}
                                      {tc.physicalExam.interpretation && (
                                        <div className="text-xs text-slate-600 italic">Interpretation: {tc.physicalExam.interpretation}</div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : null}

                            {generatedDoc.focusAreas.includes("workup") && tc.keyLabsAndImaging?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Key Labs & Imaging</div>
                                <table className="w-full text-xs border border-slate-200">
                                  <thead>
                                    <tr className="bg-slate-100">
                                      <th className="px-2 py-1.5 text-left font-semibold text-slate-700 w-1/4">Study</th>
                                      <th className="px-2 py-1.5 text-left font-semibold text-slate-700 w-1/4">Purpose</th>
                                      <th className="px-2 py-1.5 text-left font-semibold text-slate-700 w-1/4">Interpretation</th>
                                      <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Role in Management</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {tc.keyLabsAndImaging.map((lab, i) => (
                                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                        <td className="px-2 py-1.5 font-semibold text-slate-900 border-t border-slate-200 align-top">{lab.study}</td>
                                        <td className="px-2 py-1.5 text-slate-700 border-t border-slate-200 align-top">{lab.purpose}</td>
                                        <td className="px-2 py-1.5 text-slate-700 border-t border-slate-200 align-top">{lab.interpretation}</td>
                                        <td className="px-2 py-1.5 text-slate-700 border-t border-slate-200 align-top">{lab.role}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {generatedDoc.focusAreas.includes("management") && tc.treatmentApproach && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Treatment Approach</div>
                                {tc.treatmentApproach.firstLine?.length > 0 && (
                                  <div className="mb-3">
                                    <div className="text-xs font-semibold text-slate-600 mb-1">First-Line Management</div>
                                    <table className="w-full text-sm border border-slate-200">
                                      <thead>
                                        <tr className="bg-slate-100">
                                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700 w-1/3">Treatment</th>
                                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700 w-1/3">Dosing</th>
                                          <th className="px-2 py-1.5 text-left font-semibold text-slate-700">Evidence</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {tc.treatmentApproach.firstLine.map((t, i) => (
                                          <tr key={i} className="border-t border-slate-200">
                                            <td className="px-2 py-2 font-semibold text-slate-900 align-top">{t.treatment}</td>
                                            <td className="px-2 py-2 text-slate-700 align-top">{t.dosing}</td>
                                            <td className="px-2 py-2 text-slate-600 italic align-top">{t.evidence}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                {tc.treatmentApproach.additional?.length > 0 && (
                                  <div>
                                    <div className="text-xs font-semibold text-slate-600 mb-1">Additional Considerations</div>
                                    <ul className="text-sm text-slate-800 space-y-1 ml-4 list-disc">
                                      {tc.treatmentApproach.additional.map((a, i) => <li key={i}>{a}</li>)}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}

                            {generatedDoc.focusAreas.includes("patientContext") && tc.patientContextConsiderations && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Patient Context Considerations</div>
                                <div className="text-sm text-slate-800">{tc.patientContextConsiderations}</div>
                              </div>
                            )}

                            {generatedDoc.focusAreas.includes("communication") && tc.communicationTeaching?.scenario && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Communication Teaching</div>
                                <div className="text-sm text-slate-800">
                                  <div className="mb-2"><span className="font-semibold">Scenario:</span> {tc.communicationTeaching.scenario}</div>
                                  {tc.communicationTeaching.script && (
                                    <div className="p-2 bg-slate-50 border-l-4 border-slate-400 italic">
                                      "{tc.communicationTeaching.script}"
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {tc.shelfQuestions?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">
                                  Shelf-Style Questions
                                  <span className="ml-2 text-slate-500 normal-case tracking-normal font-normal italic">{generatedDoc.phase.name} difficulty</span>
                                </div>
                                <div className="space-y-4">
                                  {tc.shelfQuestions.map((q, i) => (
                                    <div key={i} className="border border-slate-300 rounded overflow-hidden">
                                      <div className="bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 uppercase tracking-wide">Question {i+1}</div>
                                      <div className="px-3 py-2 text-sm text-slate-800 border-b border-slate-200">{q.vignette}</div>
                                      <div className="px-3 py-2 text-sm text-slate-800 border-b border-slate-200">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                          {q.options && Object.entries(q.options).map(([letter, opt]) => (
                                            <div key={letter} className={q.correctAnswer === letter ? "font-semibold" : ""}>
                                              <span className="font-bold mr-1">{letter})</span>{opt}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="px-3 py-2 bg-emerald-50 text-sm">
                                        <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide mb-1">Answer: {q.correctAnswer}</div>
                                        <div className="text-slate-800">{q.explanation}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {generatedDoc.focusAreas.includes("ebm") && tc.recommendedReading?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Recommended Reading</div>
                                <ol className="space-y-1.5 ml-4 list-decimal text-sm">
                                  {tc.recommendedReading.map((r, i) => (
                                    <li key={i} className="text-slate-800">
                                      <span className="font-semibold">{r.reference}</span>
                                      {r.relevance && <div className="text-xs text-slate-600 italic">{r.relevance}</div>}
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            )}

                            {(tc.clinicalPearl || tc.quoteToDiscuss) && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {tc.clinicalPearl && (
                                  <div className="border-l-4 border-purple-600 bg-purple-50 px-3 py-2">
                                    <div className="text-xs font-bold text-purple-900 mb-1 uppercase tracking-wide">Clinical Pearl</div>
                                    <div className="text-sm text-slate-800">{tc.clinicalPearl}</div>
                                  </div>
                                )}
                                {tc.quoteToDiscuss && (
                                  <div className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
                                    <div className="text-xs font-bold text-amber-900 mb-1 uppercase tracking-wide">Quote to Discuss</div>
                                    <div className="italic text-sm text-slate-800">"{tc.quoteToDiscuss}"</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </section>
                      ))
                    ) : (
                      generatedDoc.fallbackCases?.length > 0 && (
                        <section>
                          <div className="border border-amber-300 bg-amber-50 rounded p-4 text-sm text-amber-900">
                            <strong>AI content not generated.</strong> Enable AI on the Setup tab and re-generate.
                          </div>
                        </section>
                      )
                    )}

                    {generatedDoc.labTrends?.length > 0 && (
                      <section>
                        <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Lab & Vital Trends for Interpretation</h2>
                        <table className="w-full text-sm border border-slate-300">
                          <thead>
                            <tr className="bg-slate-800 text-white">
                              <th className="px-3 py-2 text-left font-semibold w-1/4">Parameter</th>
                              <th className="px-3 py-2 text-left font-semibold w-1/3">Trend</th>
                              <th className="px-3 py-2 text-left font-semibold">Teaching Point</th>
                            </tr>
                          </thead>
                          <tbody>
                            {generatedDoc.labTrends.map((t, i) => (
                              <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                <td className="px-3 py-2 font-semibold text-slate-900 border-t border-slate-200">{t.parameter}</td>
                                <td className="px-3 py-2 text-slate-700 border-t border-slate-200">{t.trend}</td>
                                <td className="px-3 py-2 text-slate-700 border-t border-slate-200 italic">{t.teachingPoint || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </section>
                    )}

                    {generatedDoc.crossCuttingThemes?.length > 0 && (
                      <section>
                        <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Cross-Cutting Themes</h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {generatedDoc.crossCuttingThemes.map((t, i) => (
                            <div key={i} className="border border-slate-300 p-3 rounded bg-slate-50">
                              <div className="text-xs uppercase font-bold text-slate-500 mb-1">Theme {i+1}</div>
                              <div className="text-sm text-slate-800">{t}</div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Synthesized Evidence - either merged or single-source */}
                    {generatedDoc.synthesizedEvidence && (
                      <section>
                        <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">
                          Evidence Summary
                          {generatedDoc.synthesizedEvidence.synthesized && (
                            <span className="ml-2 text-slate-500 normal-case tracking-normal font-normal italic text-xs">Synthesized from {generatedDoc.synthesizedEvidence.sourcesUsed?.join(", ")}</span>
                          )}
                        </h2>

                        {generatedDoc.synthesizedEvidence.synthesized ? (
                          <div className="space-y-4">
                            {generatedDoc.synthesizedEvidence.unifiedSummary && (
                              <div className="border-l-4 border-indigo-500 bg-indigo-50 p-3">
                                <div className="text-xs uppercase font-bold text-indigo-900 mb-1">Consensus Summary</div>
                                <div className="text-sm text-slate-800">{generatedDoc.synthesizedEvidence.unifiedSummary}</div>
                              </div>
                            )}

                            {generatedDoc.synthesizedEvidence.consolidatedPoints?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase font-bold text-slate-700 mb-2">Consolidated Points</div>
                                <table className="w-full text-sm border border-slate-200">
                                  <thead>
                                    <tr className="bg-slate-100">
                                      <th className="px-3 py-1.5 text-left font-semibold text-slate-700 w-1/4">Topic</th>
                                      <th className="px-3 py-1.5 text-left font-semibold text-slate-700">Content</th>
                                      <th className="px-3 py-1.5 text-left font-semibold text-slate-700 w-1/5">Sources</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {generatedDoc.synthesizedEvidence.consolidatedPoints.map((p, i) => (
                                      <tr key={i} className="border-t border-slate-200">
                                        <td className="px-3 py-2 font-semibold text-slate-900 align-top">{p.topic}</td>
                                        <td className="px-3 py-2 text-slate-700">
                                          {p.detail}
                                          {p.conflictNote && <div className="mt-1 text-xs text-amber-700 italic">Conflict: {p.conflictNote}</div>}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-slate-600 align-top">{Array.isArray(p.sources) ? p.sources.join(", ") : p.sources}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {generatedDoc.synthesizedEvidence.uniqueInsights?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase font-bold text-slate-700 mb-2">Unique Insights by Source</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {generatedDoc.synthesizedEvidence.uniqueInsights.map((u, i) => (
                                    <div key={i} className="border border-slate-200 p-3 rounded bg-white text-sm">
                                      <div className="text-xs font-semibold text-slate-500 uppercase mb-1">{u.source}</div>
                                      <div className="text-slate-800">{u.insight}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {generatedDoc.synthesizedEvidence.conflicts?.length > 0 && (
                              <div>
                                <div className="text-xs uppercase font-bold text-amber-800 mb-2">Notable Disagreements</div>
                                {generatedDoc.synthesizedEvidence.conflicts.map((c, i) => (
                                  <div key={i} className="border-l-4 border-amber-500 bg-amber-50 p-3 mb-2">
                                    <div className="text-sm font-semibold text-slate-900 mb-1">{c.topic}</div>
                                    <ul className="text-sm text-slate-800 space-y-0.5">
                                      {c.positions?.map((pos, j) => (
                                        <li key={j}><span className="font-semibold">{pos.source}:</span> {pos.position}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : generatedDoc.synthesizedEvidence.singleSource ? (
                          <div className="border border-slate-300 rounded overflow-hidden">
                            <div className="bg-slate-100 px-3 py-1.5 text-xs uppercase tracking-wide font-bold text-slate-700 border-b border-slate-300">From {generatedDoc.synthesizedEvidence.singleSource.source}</div>
                            <div className="px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap bg-white">{generatedDoc.synthesizedEvidence.singleSource.content}</div>
                          </div>
                        ) : null}
                      </section>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {generatedDoc.longTermGoals.length > 0 && (
                        <section>
                          <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Ongoing Learning Goals</h2>
                          <ul className="space-y-2">
                            {generatedDoc.longTermGoals.map(g => (
                              <li key={g.id} className="text-sm text-slate-800 flex gap-2">
                                <span className="text-indigo-700 font-bold flex-shrink-0">›</span>
                                <div>
                                  <div>{g.text}</div>
                                  <div className="text-xs text-slate-500">Added {g.added}</div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      <section>
                        <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Prep for Next Session</h2>
                        {generatedDoc.questionsForReflection?.length > 0 && (
                          <div className="mb-3">
                            <div className="text-xs uppercase font-bold text-slate-600 mb-1">Reflect on</div>
                            <ul className="space-y-1 ml-4 list-disc text-sm text-slate-800">
                              {generatedDoc.questionsForReflection.map((q, i) => <li key={i}>{q}</li>)}
                            </ul>
                          </div>
                        )}
                        <div className="text-xs uppercase font-bold text-slate-600 mb-1">Come prepared to</div>
                        <ul className="space-y-1 text-sm text-slate-800 ml-4 list-disc">
                          <li>Discuss the questions above.</li>
                          <li>Bring 1 question that came up while working through this material.</li>
                          <li>Identify 1 area where you felt unsure.</li>
                          {generatedDoc.phase.monthsIn >= 4 && <li>Review your patient log — any cases you want to revisit?</li>}
                        </ul>
                      </section>
                    </div>

                    <div className="border-t-2 border-slate-800 pt-3 mt-6 text-xs text-slate-500 space-y-1">
                      <div className="text-center">Generated by LIC Teaching Document Generator · Aligned with the CU School of Medicine MEPO framework and Foothills clerkship benchmarks.</div>
                      <div className="text-center italic">For educational purposes only. Cited trials and guidelines are named for reference; verify specific details, dosing, and current recommendations before clinical application.</div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
