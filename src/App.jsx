import { useState, useEffect } from "react";
import { FileText, Printer, Copy, Check, Plus, X, BookOpen, Target, Stethoscope, Brain, ClipboardList, Users, TrendingUp, Save, Trash2, Sparkles, ChevronDown, ChevronRight, Calendar, User, AlertCircle, Zap, Loader2, Key, Wand2 } from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState("setup");
  const [saved, setSaved] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});

  // AI config
  const [aiConfig, setAiConfig] = useState({
    enabled: false,
    apiKey: "",
    model: "llama-3.3-70b-versatile",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    useProxy: false,
    proxyUrl: "",
  });
  const [showApiKey, setShowApiKey] = useState(false);
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

  // AI-generated content
  const [aiTeachingContent, setAiTeachingContent] = useState(null);
  const [generatedDoc, setGeneratedDoc] = useState(null);

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
      try {
        const a = await window.storage.get("aiConfig");
        if (a?.value) {
          const parsed = JSON.parse(a.value);
          setAiConfig(prev => ({ ...prev, ...parsed }));
        }
      } catch {}
    })();
  }, []);

  // Phase logic
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

  // ===== Teaching frameworks (template fallback if AI off) =====
  const teachingFrameworks = {
    history: {
      "Foundational (Early LIC)": { title: "History-Taking Framework", prompts: ["For the chief concern, what OPQRST elements would you elicit and why?","Which associated symptoms would help narrow the differential?","What red-flag symptoms should you always screen for with this presentation?","What social history elements might change your differential or management?"], skillTargets: "Building patient-centered communication skills. Organized data gathering." },
      "Developing (Mid LIC)": { title: "Hypothesis-Driven History", prompts: ["Start with your top 3 differentials — what history distinguishes them?","Which historical features have the highest likelihood ratio for your leading diagnosis?","What would you ask to rule OUT the most dangerous diagnosis on your list?","How does the patient's context (age, comorbidities, meds) change what you ask?"], skillTargets: "Illness scripts, targeted hypothesis-driven questioning, secondary data." },
      "Advancing (Late LIC)": { title: "Efficient Targeted History", prompts: ["How would you get the key history in 5 minutes for a busy clinic day?","What atypical features would make you broaden your differential?","How would you adapt for limited health literacy or a language barrier?","How does this history change your pretest probability?"], skillTargets: "Adapts communication to context, integrates secondary data." },
      "End-of-Year Transition": { title: "Sub-I Level History", prompts: ["Present the one-liner and HPI you'd give to an attending in under 90 seconds.","What historical features are most important for your assessment/plan?","How would your history change for inpatient vs. outpatient?"], skillTargets: "Comprehensive, accurate, efficient — ready for internship." },
    },
    physicalExam: {
      "Foundational (Early LIC)": { title: "Physical Exam Fundamentals", prompts: ["What are the core PE components for this chief concern?","What normal findings should you identify and describe?","How should you position and drape the patient?"], skillTargets: "Core PE with cooperative, stable patients." },
      "Developing (Mid LIC)": { title: "Targeted Physical Exam", prompts: ["Which special maneuvers are most useful and what do they tell you?","What are the test characteristics of the key PE findings?","Which abnormal findings would change your management?"], skillTargets: "PE guided by history and differential." },
      "Advancing (Late LIC)": { title: "Hypothesis-Driven PE", prompts: ["Defend or refute your top diagnosis using PE alone.","How does your PE change in different settings?","Which findings would prompt urgent escalation?"], skillTargets: "Astute targeted hypothesis-driven exam." },
      "End-of-Year Transition": { title: "Efficient Comprehensive PE", prompts: ["What's your streamlined 5-minute exam for this condition on follow-up?","How would you teach a junior student the highest-yield maneuvers?"], skillTargets: "Accurate, efficient, fluid PE." },
    },
    differential: {
      "Foundational (Early LIC)": { title: "Building a Differential", prompts: ["Generate a differential using an anatomic or systems-based framework.","For each diagnosis, what features support or refute it?","What is the 'can't miss' diagnosis and why?","Write a one-sentence summary statement."], skillTargets: "Basic problem list; summary statement." },
      "Developing (Mid LIC)": { title: "Illness Scripts & Prioritization", prompts: ["For your top 3 diagnoses, write brief illness scripts.","Rank by pretest probability AND by dangerousness — how do you reconcile?","What features DON'T fit your leading diagnosis?","How do demographics/comorbidities shift your priors?"], skillTargets: "Prioritized differential, illness scripts." },
      "Advancing (Late LIC)": { title: "Advanced Clinical Reasoning", prompts: ["Where are the diagnostic branch points where new data would change your differential?","What atypical presentations of your leading diagnosis are relevant here?","Any cognitive biases (anchoring, availability, premature closure) at play?","If your leading diagnosis is wrong, what's Plan B?"], skillTargets: "Neither too broad nor too narrow; atypical presentations." },
      "End-of-Year Transition": { title: "Diagnostic Mastery", prompts: ["Present your assessment as you would on rounds — problem-based, with reasoning.","How would you communicate diagnostic uncertainty to the patient?"], skillTargets: "Prioritized differential for any concern." },
    },
    workup: {
      "Foundational (Early LIC)": { title: "Basic Diagnostic Reasoning", prompts: ["For each test you'd order, what would abnormal results tell you?","What's the difference between a screening and a diagnostic test?","Why might you NOT order a test that seems relevant?"], skillTargets: "Basic interpretation of common labs." },
      "Developing (Mid LIC)": { title: "Targeted Workup", prompts: ["Which tests have the best characteristics for confirming/ruling out your leading diagnosis?","How do you correlate lab results back to your differential?","What guidelines exist for this workup? Do they apply here?","What would you do with an incidental finding?"], skillTargets: "Interprets in context; correlates with differential." },
      "Advancing (Late LIC)": { title: "Evidence-Based Workup", prompts: ["What is the pretest probability, and how does the test result change post-test probability?","What is the cost (financial and to the patient)?","How would you explain the test using shared decision-making?","Any Choosing Wisely recommendations relevant?"], skillTargets: "EBM and cost-effectiveness; shared decision-making." },
      "End-of-Year Transition": { title: "Independent Workup Planning", prompts: ["Write your orders as you would in the EMR — with reasoning for each.","What's your plan for following up on pending results and closing the loop?"], skillTargets: "Recommends and interprets across broad range." },
    },
    management: {
      "Foundational (Early LIC)": { title: "Introduction to Management", prompts: ["What are the components of a complete prescription?","What are the 1-2 first-line treatments for this diagnosis and why?","What patient education points are essential?"], skillTargets: "Familiarity with orders and prescribing basics." },
      "Developing (Mid LIC)": { title: "Developing a Plan", prompts: ["Structure a full plan: pharmacologic, non-pharmacologic, education, follow-up, safety-net.","What are key contraindications and drug-drug interactions?","How would you monitor treatment response?","When should the patient return or call?"], skillTargets: "Develops appropriate plan with faculty support." },
      "Advancing (Late LIC)": { title: "Independent Management", prompts: ["Develop the plan for this common condition independently.","How does the plan change for a patient with complicating factors?","Communicate the plan in plain language. Adherence barriers?","How would you coordinate with specialists or the inpatient team?"], skillTargets: "Independent for common conditions." },
      "End-of-Year Transition": { title: "Sub-I Level Management", prompts: ["Present your plan in problem-based format for attending rounds.","How would you hand off this patient? Anticipated overnight issues?"], skillTargets: "Ready for AI-level responsibility." },
    },
    patientContext: {
      "Foundational (Early LIC)": { title: "Social History & Context", prompts: ["What social determinants might be affecting this presentation?","What is the patient's own understanding of their condition?","What barriers to care might exist?"], skillTargets: "Basic structural differential." },
      "Developing (Mid LIC)": { title: "Structural Differential", prompts: ["Build a structural differential alongside your biomedical one.","How does insurance/access change what workup or treatment is realistic?","What community resources could you incorporate?","How do you adapt to values, culture, and health literacy?"], skillTargets: "Creates structural differential; adapts plan." },
      "Advancing (Late LIC)": { title: "Integrated Socio-Ecological Care", prompts: ["What system-level changes would help patients like this?","How would you activate interprofessional resources?","How do you balance evidence-based guidelines with individual circumstances?"], skillTargets: "Integrates all levels." },
      "End-of-Year Transition": { title: "Highly Personalized Care", prompts: ["How does the patient's life outside medicine shape your plan?","What system, family, and community resources should be activated?"], skillTargets: "Highly personalized planning." },
    },
    ebm: {
      "Foundational (Early LIC)": { title: "Introduction to EBM", prompts: ["Formulate a PICO question from this encounter.","Which point-of-care resource would you use and why?"], skillTargets: "Form basic clinical questions." },
      "Developing (Mid LIC)": { title: "Evidence Retrieval & Appraisal", prompts: ["Find the guideline that addresses this question. Who wrote it, when, strength of evidence?","What are the key trials underlying the recommendation?","How do you weigh guideline vs. individual patient factors?"], skillTargets: "Access literature and guidelines independently." },
      "Advancing (Late LIC)": { title: "Critical Appraisal", prompts: ["Appraise a key study — internal/external validity, applicability.","How do you handle ambiguity when evidence is mixed?","What's the NNT/NNH for the intervention?"], skillTargets: "Understands levels of evidence; manages ambiguity." },
      "End-of-Year Transition": { title: "EBM in Practice", prompts: ["Design a 30-second evidence-based answer for the attending on rounds."], skillTargets: "Reliably forms and answers clinical questions." },
    },
    communication: {
      "Foundational (Early LIC)": { title: "Patient-Centered Communication", prompts: ["How did you open and structure the visit?","What communication skills did you use to build rapport?","How would you use teach-back to confirm understanding?"], skillTargets: "Basic patient-centered communication." },
      "Developing (Mid LIC)": { title: "Advanced Communication", prompts: ["Practice a shared-decision-making conversation for treatment options.","How would you use motivational interviewing for the behavior change piece?","How would you deliver difficult news?"], skillTargets: "SDM, MI, difficult news." },
      "Advancing (Late LIC)": { title: "Adaptive Communication", prompts: ["Adapt for low health literacy, different primary language, or cognitive limitations.","How do you manage a difficult interaction while maintaining empathy?","How do you handle communication with families vs. patient alone?"], skillTargets: "Self-aware, adaptive; manages bias." },
      "End-of-Year Transition": { title: "Communication Mastery", prompts: ["How would you communicate this plan to the covering team at handoff?"], skillTargets: "Person-centered across contexts." },
    },
  };

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

  // ===== Groq API call =====
  const callGroq = async (systemPrompt, userPrompt, maxTokens = 2000) => {
    // Determine endpoint and auth
    const useProxy = aiConfig.useProxy && aiConfig.proxyUrl;
    const endpoint = useProxy ? aiConfig.proxyUrl : aiConfig.endpoint;

    if (!useProxy && !aiConfig.apiKey) throw new Error("No API key configured (and proxy not enabled)");

    const headers = { "Content-Type": "application/json" };
    // Only send Authorization header when calling Groq directly.
    // When using the proxy, the API key lives server-side.
    if (!useProxy) headers["Authorization"] = `Bearer ${aiConfig.apiKey}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: aiConfig.model,
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

  // ===== Analyze note with AI =====
  const analyzeNote = async () => {
    if (!clinicalNote.trim()) return;
    if (!aiConfig.enabled || !aiConfig.apiKey) {
      setAiStatus({ ...aiStatus, error: "Enable AI and add a Groq API key on the Setup tab to use auto-analysis." });
      return;
    }
    setAiStatus({ analyzing: true, generating: false, error: null });
    try {
      const lensGuidance = {
        general_im: "This is a general internal medicine encounter. Focus on standard IM teaching topics.",
        geriatrics: "This is a geriatrics-focused encounter. Emphasize teaching on: Beers criteria, anticholinergic burden, STOPP/START criteria, deprescribing, goals-of-care conversations, functional assessment, fall risk assessment, dementia care, polypharmacy.",
        primary_care: "This is a primary care / annual wellness encounter. Emphasize teaching on: preventive care, chronic disease management, USPSTF recommendations, shared decision-making, motivational interviewing.",
        complex_multimorbidity: "This is a complex multi-morbid patient. Emphasize teaching on: problem prioritization, medication reconciliation, care coordination, competing treatment goals, patient-centered care."
      };

      const sys = `You are a medical education assistant analyzing a clinical note to prepare teaching content for a second-year medical student in a longitudinal integrated clerkship.

${lensGuidance[teachingLens]}

The note likely has structured sections (Assessment, Plan, PMH, Meds, Labs, etc.) and may contain multiple active problems, direct patient/caregiver quotes, and trended lab/vital data. Extract all of this.

Available focus areas: history, physicalExam, differential, workup, management, patientContext, ebm, communication

Return ONLY valid JSON in this exact format (no markdown fences, no commentary):
{
  "chiefConcern": "brief chief concern or reason for visit",
  "workingDiagnosis": "primary/most teachable diagnosis, or 'multiple active problems' if truly multi-focal",
  "activeProblems": [
    {"problem": "problem name", "icdContext": "ICD if present in note", "teachingValue": "brief note on why this is teachable", "keyIssue": "the core clinical question or dilemma"}
  ],
  "otherDiagnoses": ["list", "of", "other", "active", "problems", "as", "strings"],
  "keyTopics": ["specific clinical topics worth teaching from this note - be specific like 'deprescribing anticholinergics in dementia' not just 'polypharmacy'"],
  "suggestedFocus": ["array of 3-5 focus area keys from the list above"],
  "reasoning": "2-3 sentence explanation of what makes this case teachable and why these focus areas fit",
  "complexity": "common" or "complex",
  "redFlags": ["any concerning features, can't-miss diagnoses, or iatrogenic risks"],
  "patientQuotes": ["direct quotes from patient/caregiver in the note that could be used for communication teaching - include quotes verbatim"],
  "labTrends": [
    {"parameter": "lab name", "trend": "brief description of trend", "teachingPoint": "what this teaches"}
  ]
}`;
      const user = `Clinical note (de-identified):\n\n${clinicalNote}\n\nStudent is in month ${phase.monthsIn} of LIC (${phase.name} phase). Focus on: ${phase.focus}`;
      const response = await callGroq(sys, user, 2500);
      let jsonStr = response.trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      setNoteAnalysis(parsed);
      if (parsed.chiefConcern && !chiefConcern) setChiefConcern(parsed.chiefConcern);
      if (parsed.workingDiagnosis && !workingDx) setWorkingDx(parsed.workingDiagnosis);
      if (parsed.complexity) setSession(prev => ({ ...prev, complexity: parsed.complexity }));
      if (parsed.keyTopics) setExtractedTopics(parsed.keyTopics);
      if (parsed.activeProblems) {
        setActiveProblems(parsed.activeProblems);
        // Auto-select first 2 problems for teaching focus by default
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

  // ===== Generate case-specific teaching content with AI =====
  const generateAiTeachingContent = async () => {
    const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
    if (activeFocus.length === 0) return null;
    if (!aiConfig.enabled || !aiConfig.apiKey) return null;

    const lensGuidance = {
      general_im: "",
      geriatrics: "\n\nThis is a GERIATRICS-focused case. For each problem, weave in relevant teaching on: Beers criteria (cite specific medications from the case), anticholinergic burden scoring, STOPP/START criteria, deprescribing algorithms, goals-of-care conversations, functional assessment (ADLs/IADLs), fall risk assessment (STEADI), and 4Ms framework (Medications, Mentation, Mobility, what Matters).",
      primary_care: "\n\nThis is a PRIMARY CARE case. For each problem, weave in: USPSTF grades and recommendations, shared decision-making frameworks, motivational interviewing techniques, chronic disease guideline application.",
      complex_multimorbidity: "\n\nThis is a COMPLEX MULTI-MORBID case. For each problem, weave in: problem prioritization frameworks, competing treatment goals, patient-centered outcomes over disease-centered metrics, care coordination."
    };

    // Determine which problems to build teaching cases for
    const problemsToTeach = selectedProblems.length > 0
      ? selectedProblems
      : (workingDx ? [workingDx] : ["primary clinical problem in this case"]);

    // Difficulty scaling based on phase
    const difficultyGuidance = phase.monthsIn <= 3
      ? "shelf questions should be Foundational level (basic pattern recognition, single-step reasoning, common presentations)"
      : phase.monthsIn <= 7
      ? "shelf questions should be Developing level (multi-step reasoning, illness scripts, requires prioritization)"
      : phase.monthsIn <= 10
      ? "shelf questions should be Advancing level (complex vignettes, subtle findings, management questions with multiple defensible options)"
      : "shelf questions should be Sub-I level (integrating multiple problems, judgment under uncertainty, atypical presentations)";

    // Focus area filtering guidance
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
      focusFilters.differential && "differentialDiagnosis (with 3 alternative diagnoses and reasoning)",
      focusFilters.history && "focusedHistoryQuestions (3-4 questions with rationale for each)",
      focusFilters.physicalExam && "physicalExam (specific maneuvers with step-by-step technique and interpretation)",
      focusFilters.workup && "keyLabsAndImaging (5 studies each with purpose/interpretation/role explained)",
      focusFilters.management && "treatmentApproach (first-line management with dosing details, plus additional considerations)",
      focusFilters.patientContext && "patientContextConsiderations (SDoH, goals-of-care, cultural/systems factors specific to this patient)",
      focusFilters.ebm && "recommendedReading (3 landmark trials or guidelines BY NAME ONLY - e.g. 'RATE-AF trial' or '2023 AHA/ACC Atrial Fibrillation Guideline' - no fabricated page numbers, no fabricated authors)",
      focusFilters.communication && "communicationTeaching (specific communication scenarios/scripts for this patient)",
    ].filter(Boolean).join(", ");

    const sys = `You are a medical education expert generating rigorous, study-quality teaching content for a medical student in a longitudinal integrated clerkship.

STUDENT LEVEL: Month ${phase.monthsIn} of LIC (${phase.name} phase).
DEVELOPMENTAL FOCUS: ${phase.focus}
DIFFICULTY CALIBRATION: ${difficultyGuidance}
${lensGuidance[teachingLens]}

Generate a separate "teaching case" for EACH selected problem. Each teaching case must be case-specific — reference actual medications, doses, lab values, patient quotes, and clinical decisions from the note.

CITATION RULES (CRITICAL):
- Cite landmark trials by NAME ONLY (e.g., "RATE-AF trial", "PROSPER trial", "SPRINT trial")
- Cite guidelines by ORGANIZATION and YEAR only (e.g., "2023 AHA/ACC Guideline", "2019 Beers Criteria", "USPSTF 2022")
- DO NOT fabricate journal names, page numbers, authors, or specific citations
- If you don't know a landmark trial for a topic, write "Landmark evidence exists; recommend searching PubMed for [specific topic]"

Return ONLY valid JSON in this exact format (no markdown fences, no commentary):
{
  "teachingCases": [
    {
      "problem": "problem name matching one of the selected problems",
      "primaryDiagnosis": {
        "name": "the primary diagnosis for this problem",
        "briefDefinition": "1-2 sentence clinical definition"
      },
      "differentialDiagnosis": [
        {"diagnosis": "alternative dx 1", "reasoning": "why include/exclude in THIS case, referencing specific features"},
        {"diagnosis": "alternative dx 2", "reasoning": "why include/exclude"},
        {"diagnosis": "alternative dx 3", "reasoning": "why include/exclude"}
      ],
      "keyLearningPoints": [
        {"point": "learning point title", "explanation": "detailed 2-3 sentence explanation calibrated to student phase", "citation": "landmark trial NAME or guideline org/year only"},
        {"point": "point 2", "explanation": "...", "citation": "..."},
        {"point": "point 3", "explanation": "...", "citation": "..."},
        {"point": "point 4", "explanation": "...", "citation": "..."},
        {"point": "point 5", "explanation": "...", "citation": "..."}
      ],
      "shelfQuestions": [
        {
          "vignette": "clinical vignette question about this problem, calibrated to student phase",
          "options": {"A": "option A", "B": "option B", "C": "option C", "D": "option D"},
          "correctAnswer": "A/B/C/D",
          "explanation": "detailed explanation of why this is correct and why others are wrong"
        }
      ],
      "focusedHistoryQuestions": [
        {"question": "specific history question", "rationale": "why this question matters clinically"}
      ],
      "physicalExam": {
        "maneuver": "specific exam maneuver relevant to this problem",
        "steps": ["step 1", "step 2", "step 3"],
        "interpretation": "what findings mean clinically"
      },
      "keyLabsAndImaging": [
        {"study": "lab/imaging name", "purpose": "why order it", "interpretation": "how to read results", "role": "how it changes management"}
      ],
      "treatmentApproach": {
        "firstLine": [
          {"treatment": "treatment name", "dosing": "specific dose/route/frequency", "evidence": "landmark trial or guideline NAME only"}
        ],
        "additional": ["supportive measure or lifestyle mod", "monitoring parameter", "follow-up recommendation"]
      },
      "patientContextConsiderations": "2-3 sentences on SDoH, goals-of-care, or systems factors for THIS patient",
      "recommendedReading": [
        {"reference": "landmark trial NAME or guideline org/year", "relevance": "why relevant to this case"}
      ],
      "communicationTeaching": {
        "scenario": "specific communication challenge in this case",
        "script": "example language to use with patient/family"
      },
      "clinicalPearl": "one high-yield teaching point for this problem",
      "quoteToDiscuss": "direct patient/caregiver quote from note if relevant, else empty string"
    }
  ],
  "crossCuttingThemes": ["2-3 themes that span multiple problems in this case"],
  "questionsForReflection": ["2-3 open-ended reflective questions for the student"]
}

Include ONLY these subsections in each teaching case: ${includedSections}

Number of shelf questions per problem: 3.

Every teaching case, question, and citation MUST reference specific details from the actual clinical note provided.`;

    const problemsContext = problemsToTeach.map((p, i) => `${i+1}. ${p}`).join("\n");
    const quotesContext = patientQuotes.length > 0 ? `\n\nAvailable patient/caregiver quotes:\n${patientQuotes.map(q => `- "${q}"`).join("\n")}` : "";
    const trendsContext = labTrends.length > 0 ? `\n\nLab/vital trends:\n${labTrends.map(t => `- ${t.parameter}: ${t.trend}`).join("\n")}` : "";

    const user = `Clinical note:\n${clinicalNote}\n\nChief concern: ${chiefConcern}\n\nGenerate a full teaching case for EACH of these problems:\n${problemsContext}${quotesContext}${trendsContext}\n\nFor a ${phase.name} learner, ${
      phase.monthsIn <= 3 ? "focus on structured basics and pattern recognition" :
      phase.monthsIn <= 7 ? "focus on hypothesis-driven reasoning and illness scripts" :
      "focus on independence, efficiency, and complexity"
    }.`;

    const response = await callGroq(sys, user, 8000);
    let jsonStr = response.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    return JSON.parse(jsonStr);
  };

  // ===== Source prompt generator (now includes focus framework questions) =====
  const generateSourcePrompt = (source) => {
    const activeFocus = Object.keys(focusAreas).filter(k => focusAreas[k]);
    const focusText = activeFocus.map(f => focusLabels[f]).join(", ");
    const dxLine = workingDx ? `Working diagnosis: ${workingDx}. ` : "";
    const ccLine = chiefConcern ? `Chief concern: ${chiefConcern}. ` : "";
    const problemsLine = selectedProblems.length > 0 ? `\nSpecific problems to focus on: ${selectedProblems.join("; ")}.` : "";
    const topicsLine = extractedTopics.length > 0 ? `\nKey clinical topics from this encounter: ${extractedTopics.join(", ")}.` : "";
    const lensLine = teachingLens !== "general_im" ? `\nTeaching lens: ${{geriatrics: "Geriatrics/deprescribing", primary_care: "Primary care/preventive", complex_multimorbidity: "Complex multimorbidity"}[teachingLens]}` : "";
    const contextLine = clinicalNote ? `\n\nDe-identified clinical context:\n${clinicalNote}` : "";

    // Include the actual teaching framework questions for each focus area
    const frameworkQuestions = activeFocus.map(f => {
      const fw = teachingFrameworks[f]?.[phase.name] || teachingFrameworks[f]?.["Developing (Mid LIC)"];
      if (!fw) return null;
      return `${focusLabels[f]} — I want to teach the student:\n${fw.prompts.slice(0, 4).map((p, i) => `  ${i+1}. ${p}`).join("\n")}`;
    }).filter(Boolean).join("\n\n");

    const base = `Context: I am a teaching attending in internal medicine. My student is a second-year medical student in month ${phase.monthsIn} of a longitudinal integrated clerkship (${phase.name} phase). Their developmental focus at this stage: ${phase.focus}.

${ccLine}${dxLine}${problemsLine}${topicsLine}${lensLine}${contextLine}

I want to focus today's teaching on: ${focusText}.

Here are the specific questions I plan to discuss with the student:

${frameworkQuestions}

`;

    switch (source) {
      case "openevidence":
        return base + `Please provide evidence to support this teaching session:

1. For each focus area above, provide the current evidence base with landmark citations (author, year, journal)
2. Answer the specific questions I listed with references
3. Note current guideline recommendations by name and year
4. Flag areas of ongoing clinical equipoise
5. Highlight any evidence that has changed practice in the last 2-3 years

Format as a structured summary I can bring into a teaching session.`;

      case "uptodate":
        return base + `Provide UpToDate-style content organized around these teaching questions:

1. For each focus area, give the current UpToDate approach
2. For each specific question I listed above, provide the evidence-based answer
3. Include Grade of Recommendation where UpToDate provides one
4. Note when to escalate or refer
5. Include patient-centered talking points

Structure your response to map directly to my teaching questions.`;

      case "dynamed":
        return base + `Give DynaMed-style summary organized around my teaching focus:

1. For each question I listed, provide the answer with LEVEL OF EVIDENCE
2. Include NNT/NNH where applicable
3. Note any practice-changing updates in the last 2 years
4. Highlight cost-conscious alternatives
5. Flag any Choosing Wisely recommendations relevant to this case`;

      case "doxgpt":
        return base + `Respond as a peer-consult with an experienced clinician colleague. For each question above:

1. Give practical, real-world guidance (what you'd actually do)
2. Share pearls and pitfalls from clinical experience
3. Suggest how to explain this to the patient
4. Flag common trainee errors on these topics
5. Note anything you'd worry about missing in a case like this`;

      case "pubmed":
        return base + `Provide a PubMed search strategy tailored to my teaching questions:

1. For each focus area, give 2-3 optimized search queries using MeSH terms
2. Suggest filters (article types, publication dates)
3. List 3-5 seminal or recent high-impact papers with PMIDs (if known) that address my teaching questions
4. Suggest 2-3 critical appraisal questions for the highest-quality paper
5. If any Cochrane reviews are relevant, list them`;
      default:
        return base;
    }
  };

  const activeSources = Object.keys(sources).filter(k => sources[k]);
  const activeFocusList = Object.keys(focusAreas).filter(k => focusAreas[k]);

  // ===== Generate final document =====
  const generateDocument = async () => {
    setAiStatus({ ...aiStatus, generating: true, error: null });
    let aiContent = null;
    if (aiConfig.enabled && aiConfig.apiKey && activeFocusList.length > 0) {
      try {
        aiContent = await generateAiTeachingContent();
        setAiTeachingContent(aiContent);
      } catch (e) {
        setAiStatus({ analyzing: false, generating: false, error: `AI generation failed: ${e.message}. Using template fallback.` });
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
      // Fallback: if no AI, generate basic template cases from selected problems
      fallbackCases: !aiContent && selectedProblems.length > 0
        ? selectedProblems.map(p => ({ problem: p, isFallback: true }))
        : (!aiContent && workingDx ? [{ problem: workingDx, isFallback: true }] : []),
      sourceContent: activeSources
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
      // Save AI config WITHOUT the API key for safety
      const { apiKey, ...safeConfig } = aiConfig;
      await window.storage.set("aiConfig", JSON.stringify(safeConfig));
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
                <p className="text-xs text-slate-500">Phase-aware teaching {aiConfig.enabled && aiConfig.apiKey && <span className="text-indigo-600">· AI enabled</span>}</p>
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
            {/* AI Config */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-lg font-semibold text-slate-900">AI-Powered Features</h2>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">Enable to auto-analyze notes and generate case-specific content via Groq (free tier).</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={aiConfig.enabled} onChange={e => setAiConfig({...aiConfig, enabled: e.target.checked})} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {aiConfig.enabled && (
                <div className="space-y-3 pt-3 border-t border-slate-100">

                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div>
                      <div className="text-sm font-medium text-slate-800">Use Cloudflare Worker proxy</div>
                      <div className="text-xs text-slate-500">Recommended for production — keeps API key server-side.</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={aiConfig.useProxy} onChange={e => setAiConfig({...aiConfig, useProxy: e.target.checked})} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-300 peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>

                  {aiConfig.useProxy ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Worker URL</label>
                      <input
                        type="url"
                        value={aiConfig.proxyUrl}
                        onChange={e => setAiConfig({...aiConfig, proxyUrl: e.target.value})}
                        placeholder="https://lic-teaching-groq-proxy.YOUR-SUBDOMAIN.workers.dev"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        API key is stored as a secret in your Worker — never in the browser.
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                        <Key className="w-3 h-3" />Groq API Key
                      </label>
                      <div className="flex gap-2">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={aiConfig.apiKey}
                          onChange={e => setAiConfig({...aiConfig, apiKey: e.target.value})}
                          placeholder="gsk_..."
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <button onClick={() => setShowApiKey(!showApiKey)} className="px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg">
                          {showApiKey ? "Hide" : "Show"}
                        </button>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Get a free key at <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="text-indigo-600 underline">console.groq.com</a>. Key is stored in browser only.
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Model</label>
                    <select
                      value={aiConfig.model}
                      onChange={e => setAiConfig({...aiConfig, model: e.target.value})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="llama-3.3-70b-versatile">Llama 3.3 70B (recommended)</option>
                      <option value="llama-3.1-8b-instant">Llama 3.1 8B (faster, less capable)</option>
                      <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                      <option value="gemma2-9b-it">Gemma 2 9B</option>
                    </select>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                    <strong>Privacy note:</strong> When AI is enabled, de-identified clinical text is sent to Groq's servers. Ensure your note is fully de-identified per HIPAA before analysis.
                  </div>
                </div>
              )}
            </div>

            {/* Session config */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Session Setup</h2>
                <p className="text-sm text-slate-500">Configure basic session info. Use initials only — avoid PHI.</p>
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
              <p className="text-sm text-slate-500">Paste your clinical note. {aiConfig.enabled && aiConfig.apiKey && "AI will extract diagnoses, quotes, trends, and suggest focus areas."}</p>
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
              <div className="text-xs text-slate-500 mt-1">Tailors AI teaching content to the appropriate clinical framework.</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">De-identified clinical note</label>
              <textarea value={clinicalNote} onChange={e => setClinicalNote(e.target.value)} rows={14} placeholder="Paste the SOAP note or H&P here (de-identified)..." className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm" />
              <div className="flex items-center justify-between mt-1">
                <div className="text-xs text-slate-500">{clinicalNote.length} characters</div>
                {aiConfig.enabled && aiConfig.apiKey && (
                  <button
                    onClick={analyzeNote}
                    disabled={!clinicalNote.trim() || aiStatus.analyzing}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:opacity-90 text-sm font-medium disabled:opacity-50"
                  >
                    {aiStatus.analyzing ? <><Loader2 className="w-4 h-4 animate-spin" />Analyzing...</> : <><Wand2 className="w-4 h-4" />Analyze note with AI</>}
                  </button>
                )}
              </div>
            </div>

            {/* AI analysis results */}
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
                    <div className="text-xs text-slate-500 mt-2">{selectedProblems.length} of {activeProblems.length} selected. AI teaching content will center on the selected problems.</div>
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
                      {patientQuotes.length > 3 && <div className="text-xs text-slate-500">+ {patientQuotes.length - 3} more (all will appear in output)</div>}
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
                    <div className="text-xs text-indigo-700 mt-1">✓ Auto-selected on the Focus tab. You can adjust.</div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Chief concern</label>
                <input type="text" value={chiefConcern} onChange={e => setChiefConcern(e.target.value)} placeholder="e.g., annual wellness visit" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Primary working diagnosis</label>
                <input type="text" value={workingDx} onChange={e => setWorkingDx(e.target.value)} placeholder="e.g., iatrogenic bradycardia from diltiazem" className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
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
                  <p className="text-sm text-slate-500">Select as many as you want to teach on today — each generates its own section in the document.</p>
                </div>
                {aiConfig.enabled && aiConfig.apiKey && clinicalNote && (
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
                <p className="text-sm text-slate-500">Prompts are customized with your selected teaching focus questions. Copy → paste into source → paste response back below.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                {Object.keys(sources).map(key => (
                  <button key={key} onClick={() => setSources({...sources, [key]: !sources[key]})} className={`p-3 rounded-lg border-2 text-sm font-medium transition ${sources[key] ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                    {sourceLabels[key]}{sources[key] && <Check className="w-4 h-4 inline ml-1" />}
                  </button>
                ))}
              </div>

              {activeSources.length === 0 && (
                <div className="text-center py-8 text-sm text-slate-500 bg-slate-50 rounded-lg">Select one or more sources above to generate tailored prompts.</div>
              )}

              {activeFocusList.length === 0 && activeSources.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                  Select at least one teaching focus area (Step 3) for prompts to be truly tailored.
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
                            <label className="text-sm font-medium text-slate-700">Prompt (includes your focus areas & questions)</label>
                            <button onClick={() => copyPrompt(src)} className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded transition">
                              {copiedPrompt === src ? <><Check className="w-3 h-3" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
                            </button>
                          </div>
                          <div className="p-3 bg-slate-50 rounded border border-slate-200 text-xs font-mono text-slate-700 whitespace-pre-wrap max-h-60 overflow-y-auto">{generateSourcePrompt(src)}</div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Paste response from {sourceLabels[src]}</label>
                          <textarea value={sourceResponses[src]} onChange={e => setSourceResponses({...sourceResponses, [src]: e.target.value})} rows={6} placeholder="Response will be included in the teaching document with attribution..." className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
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
                <p className="text-sm text-slate-500">Goals persist across sessions. These appear on every generated document.</p>
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
                {aiStatus.generating ? <><Loader2 className="w-4 h-4 animate-spin" />Generating with AI...</> : <><Sparkles className="w-4 h-4" />Generate Teaching Document</>}
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
                  {/* Cover header with band */}
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

                    {/* Case summary: two-column table */}
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

                    {/* Session goal - prominent callout */}
                    {generatedDoc.sessionGoal && (
                      <section>
                        <div className="border-l-4 border-indigo-600 bg-indigo-50 px-4 py-3">
                          <div className="text-xs uppercase tracking-widest text-indigo-700 font-bold mb-1">Session Goal</div>
                          <div className="text-slate-800 font-medium">{generatedDoc.sessionGoal}</div>
                        </div>
                      </section>
                    )}

                    {/* Phase framing */}
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

                    {/* Teaching Cases - one per selected problem */}
                    {generatedDoc.teachingCases?.length > 0 ? (
                      generatedDoc.teachingCases.map((tc, caseIdx) => (
                        <section key={caseIdx} className="section-block">
                          {/* Teaching case header */}
                          <div className="bg-slate-800 text-white px-4 py-3 rounded-t">
                            <div className="text-xs uppercase tracking-widest text-slate-300">Teaching Case {caseIdx + 1} of {generatedDoc.teachingCases.length}</div>
                            <h2 className="text-lg font-bold mt-0.5">{tc.problem}</h2>
                          </div>

                          <div className="border border-t-0 border-slate-300 rounded-b p-4 space-y-4">

                            {/* Primary diagnosis */}
                            {tc.primaryDiagnosis?.name && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-1">Primary Diagnosis</div>
                                <div className="text-sm text-slate-800">
                                  <span className="font-bold">{tc.primaryDiagnosis.name}.</span>
                                  {tc.primaryDiagnosis.briefDefinition && <span> {tc.primaryDiagnosis.briefDefinition}</span>}
                                </div>
                              </div>
                            )}

                            {/* Differential diagnosis - only if focus includes differential */}
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

                            {/* Key learning points */}
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

                            {/* Two-column: history questions + physical exam */}
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

                            {/* Key labs as a table */}
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

                            {/* Treatment approach */}
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

                            {/* Patient context */}
                            {generatedDoc.focusAreas.includes("patientContext") && tc.patientContextConsiderations && (
                              <div>
                                <div className="text-xs uppercase tracking-wide font-bold text-slate-700 mb-2 border-b border-slate-300 pb-1">Patient Context Considerations</div>
                                <div className="text-sm text-slate-800">{tc.patientContextConsiderations}</div>
                              </div>
                            )}

                            {/* Communication teaching */}
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

                            {/* Shelf questions - always shown */}
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

                            {/* Recommended reading */}
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

                            {/* Pearl + quote as bottom two-column callouts */}
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
                      /* Fallback when no AI content */
                      generatedDoc.fallbackCases?.length > 0 && (
                        <section>
                          <div className="border border-amber-300 bg-amber-50 rounded p-4 text-sm text-amber-900">
                            <strong>AI content not generated.</strong> Enable AI on the Setup tab and re-generate to see full teaching cases for: {generatedDoc.fallbackCases.map(c => c.problem).join(", ")}.
                          </div>
                        </section>
                      )
                    )}

                    {/* Lab trends as a proper table */}
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

                    {/* Cross-cutting themes */}
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

                    {/* Evidence Summary from external sources */}
                    {generatedDoc.sourceContent.length > 0 && (
                      <section>
                        <h2 className="text-base font-bold text-slate-900 mb-3 pb-2 border-b-2 border-slate-800 uppercase tracking-wide">Evidence Summary</h2>
                        {generatedDoc.sourceContent.map((s, i) => (
                          <div key={i} className="mb-4 border border-slate-300 rounded overflow-hidden">
                            <div className="bg-slate-100 px-3 py-1.5 text-xs uppercase tracking-wide font-bold text-slate-700 border-b border-slate-300">From {s.source}</div>
                            <div className="px-3 py-2 text-sm text-slate-800 whitespace-pre-wrap bg-white">{s.content}</div>
                          </div>
                        ))}
                      </section>
                    )}

                    {/* Ongoing goals + next session prep in two-column layout */}
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

                    {/* Footer */}
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