// Original, optional local puzzles. Public keys are intentional: this is not a secure exam or a mastery assessment.
export const MYSTERY_CASES = [
  {
    "id": "observatory",
    "title": "The Silent Observatory",
    "passage": "At 8:40 p.m., Mara put the star map in a red sleeve and the calibration sheet in a blue sleeve. Both sleeves were sealed, and neither was reopened. At 8:44, Jun carried the red sleeve to the archive, while Ivo carried the blue sleeve to the dome. The transfer log is complete: no sleeve changed hands or rooms after those trips. The telescope team needs to find the star map.",
    "stages": [
      {
        "kind": "Evidence",
        "prompt": "Select the phrase that establishes the first link needed to track the star map.",
        "choices": [
          "“the calibration sheet in a blue sleeve”",
          "“Mara put the star map in a red sleeve”",
          "“Ivo carried the blue sleeve to the dome”",
          "“At 8:44”"
        ],
        "answerIndex": 1,
        "hint": "Start with the sentence connecting the object you want to find to a sleeve color.",
        "evidence": "Mara put the star map in a red sleeve.",
        "explanation": "The star map starts in the red sleeve. The blue sleeve holds a different document, so tracking that sleeve would not locate the map.",
        "feedback": [
          "This phrase identifies the calibration sheet, not the star map.",
          "This phrase directly links the star map to the red sleeve.",
          "This phrase follows the blue sleeve, which contains the calibration sheet.",
          "The time alone does not tell you which sleeve holds the map."
        ]
      },
      {
        "kind": "Inference",
        "prompt": "Select where the star map must be, according to the complete record.",
        "choices": [
          "In the dome, because Ivo carried a sleeve there.",
          "At the console, because Mara was the first person mentioned.",
          "In the archive, because the map stayed in the red sleeve that Jun delivered there.",
          "Its location cannot be determined from the stated record."
        ],
        "answerIndex": 2,
        "hint": "Follow the red sleeve. The record says it was never reopened and never moved again after delivery.",
        "evidence": "Jun carried the red sleeve to the archive; neither sleeve was reopened, and no sleeve changed rooms afterward.",
        "explanation": "The map remains inside the red sleeve. Jun takes that sleeve to the archive, and the stated complete record excludes a later transfer.",
        "feedback": [
          "The dome receives the blue sleeve and calibration sheet.",
          "Being mentioned first does not establish the object’s final location.",
          "This conclusion follows the map’s sleeve through the complete record.",
          "The sleeve color, destination and no-transfer facts together determine the location."
        ]
      },
      {
        "kind": "Grammar",
        "prompt": "Complete the report using a correct sentence boundary: “The red sleeve remained sealed _____ Jun delivered it to the archive.”",
        "choices": [
          ",",
          "because,",
          ";",
          "although,"
        ],
        "answerIndex": 2,
        "hint": "Read each side by itself. Each side can stand as a complete sentence.",
        "evidence": "The red sleeve remained sealed / Jun delivered it to the archive.",
        "explanation": "A semicolon can join these related independent clauses. A comma alone is a comma splice; the other choices incorrectly put a comma immediately after a subordinating conjunction.",
        "feedback": [
          "A comma alone cannot join these two independent clauses.",
          "The comma after because breaks the connection to its clause.",
          "The semicolon correctly joins the two independent clauses.",
          "The comma after although breaks the connection to its clause."
        ]
      }
    ]
  },
  {
    "id": "gallery-clock",
    "title": "The Gallery Clock",
    "passage": "A gallery camera records a visitor placing a silver parcel in a cabinet. The camera display reads 00:19, but a maintenance note says its clock is exactly seven minutes fast. The staffing log uses the correct time. Nila was the only person in the gallery from 00:10 through 00:14; Ren was the only person there from 00:16 through 00:20. The log includes every person who entered, and the person shown in the clip was in the gallery at the moment recorded.",
    "stages": [
      {
        "kind": "Evidence",
        "prompt": "Select the phrase that tells you how to translate the camera display into the staffing log’s time.",
        "choices": [
          "“a visitor placing a silver parcel in a cabinet”",
          "“The log includes every person who entered”",
          "“its clock is exactly seven minutes fast”",
          "“Ren was the only person there”"
        ],
        "answerIndex": 2,
        "hint": "Find the statement about the difference between displayed time and correct time.",
        "evidence": "Its clock is exactly seven minutes fast.",
        "explanation": "A fast clock displays a later time than the correct time. This phrase supplies both the direction and amount of the correction.",
        "feedback": [
          "The parcel’s appearance does not provide a clock correction.",
          "A complete log supports identification after you correct the time, but it does not provide the correction.",
          "This phrase gives the correction: subtract seven minutes.",
          "This phrase identifies a staffing interval, not the camera clock’s offset."
        ]
      },
      {
        "kind": "Inference",
        "prompt": "Identify who placed the parcel and the corrected time that supports that conclusion.",
        "choices": [
          "Ren, because 00:19 falls in Ren’s shift.",
          "Nila, because subtracting seven minutes gives 00:12.",
          "Ren, because adding seven minutes gives 00:26.",
          "No one can be identified, even with the complete log."
        ],
        "answerIndex": 1,
        "hint": "A fast clock is ahead. Subtract seven minutes from 00:19 before comparing shifts.",
        "evidence": "The camera clock is seven minutes fast; Nila alone was present from 00:10 through 00:14.",
        "explanation": "00:19 minus seven minutes is 00:12. That is inside Nila’s stated interval and outside Ren’s. The complete log rules out an unrecorded person.",
        "feedback": [
          "00:19 is the uncorrected camera display, not the time used by the staffing log.",
          "The correction gives 00:12, when only Nila was present.",
          "Adding minutes would move farther ahead even though the camera is already fast.",
          "The prompt gives the correction and an explicitly complete staffing log, which identify the person."
        ]
      },
      {
        "kind": "Grammar",
        "prompt": "Choose the punctuation that completes the report: “The corrected time identifies one person _____ Nila, the sole attendant present at 00:12.”",
        "choices": [
          ";",
          "no punctuation",
          ":",
          "."
        ],
        "answerIndex": 2,
        "hint": "The words before the blank form a complete clause. The words after it name the person rather than forming another complete clause.",
        "evidence": "The corrected time identifies one person / Nila, the sole attendant present at 00:12.",
        "explanation": "A colon can introduce an identifying explanation after a complete clause. The name and appositive after it lack a finite verb, so they cannot stand alone after a semicolon or period.",
        "feedback": [
          "A semicolon normally joins independent clauses; the name and appositive are not an independent clause.",
          "Without punctuation, the identifying phrase is not separated from the complete introductory clause.",
          "The colon introduces the identifying explanation.",
          "A period would leave the name and appositive as a sentence fragment."
        ]
      }
    ]
  },
  {
    "id": "encoded-label",
    "title": "The Encoded Exhibit",
    "passage": "A museum’s optional puzzle trail hides its final clue in one of four rooms: DOME, HALL, VAULT or STAGE. A note explains the code: “To encode a room name, replace each letter with the next letter of the alphabet; replace Z with A.” Mira finds a label reading EPNF. The note also says that decoding requires reversing the encoding rule, and that the label names one of the four rooms.",
    "stages": [
      {
        "kind": "Evidence",
        "prompt": "Select the phrase that gives the operation used to create the code.",
        "choices": [
          "“one of four rooms”",
          "“replace each letter with the next letter of the alphabet”",
          "“Mira finds a label reading EPNF”",
          "“the label names one of the four rooms”"
        ],
        "answerIndex": 1,
        "hint": "Find the instruction that tells you how one original letter becomes an encoded letter.",
        "evidence": "Replace each letter with the next letter of the alphabet.",
        "explanation": "This is the actual encoding operation. The list of rooms and the encoded label constrain the result but do not define how letters were transformed.",
        "feedback": [
          "The number of rooms does not define the letter operation.",
          "This phrase states the letter transformation.",
          "The label is an example of encoded output, not the operation.",
          "This statement tells you what the result represents, not how it was encoded."
        ]
      },
      {
        "kind": "Inference",
        "prompt": "Select the room Mira should inspect after reversing the stated rule.",
        "choices": [
          "DOME",
          "HALL",
          "FQOG",
          "DONE"
        ],
        "answerIndex": 0,
        "hint": "Reverse the forward shift: move each encoded letter one place backward.",
        "evidence": "Decoding requires reversing the next-letter encoding rule; the label is EPNF.",
        "explanation": "E becomes D, P becomes O, N becomes M and F becomes E. The decoded word is DOME, one of the listed rooms.",
        "feedback": [
          "Reversing the rule gives D-O-M-E.",
          "HALL does not result from shifting these encoded letters backward.",
          "FQOG shifts forward again instead of reversing the rule.",
          "N decodes to M; leaving it unchanged would produce the incorrect DONE."
        ]
      },
      {
        "kind": "Grammar",
        "prompt": "Select the completion that makes the introductory modifier describe its logical subject: “After decoding the label, _____”",
        "choices": [
          "the dome was checked by Mira.",
          "the label directed Mira toward the dome.",
          "there was a clue waiting in the dome.",
          "Mira checked the dome for the final clue."
        ],
        "answerIndex": 3,
        "hint": "The person named immediately after the introductory phrase must be the one who decoded the label.",
        "evidence": "After decoding the label / Mira checked the dome for the final clue.",
        "explanation": "Mira is the logical subject who can decode a label. The other completions make the introductory action attach to a dome, a label or the empty subject there.",
        "feedback": [
          "The grammatical subject is the dome, but the dome did not decode the label.",
          "The grammatical subject is the label, which did not decode itself.",
          "There does not identify the person who decoded the label.",
          "Mira is both the grammatical subject and the person who decoded the label."
        ]
      }
    ]
  }
];

const findCase = (id) => MYSTERY_CASES.find((item) => item.id === id);
export function createMysteryState(caseId = MYSTERY_CASES[0].id) {
  if (!findCase(caseId)) throw new TypeError('Unknown mystery case.');
  return { caseId, stageIndex: 0, selectedIndex: null, solved: false, helped: false,
    showHint: false, showSolution: false, feedback: null, completed: [], done: false };
}

export function checkMysteryAnswer(caseId, stageIndex, selectedIndex) {
  const stage = findCase(caseId)?.stages[stageIndex];
  if (!stage || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= stage.choices.length) return null;
  return { correct: selectedIndex === stage.answerIndex, message: stage.feedback[selectedIndex],
    evidence: stage.evidence, explanation: stage.explanation };
}

/** Only an explicit next action can advance a correctly checked stage.
 * Help reveals explanations but never grants a pass on its own. */
export function transitionMystery(state, action = {}) {
  const current = findCase(state?.caseId);
  if (!current || !Number.isInteger(state.stageIndex) || !current.stages[state.stageIndex]) throw new TypeError('Invalid mystery state.');
  if (action.type === 'restart') return createMysteryState(state.caseId);
  if (state.done) return state;
  const stage = current.stages[state.stageIndex];
  if (action.type === 'select' && !state.solved && Number.isInteger(action.index) && action.index >= 0 && action.index < stage.choices.length) {
    return { ...state, selectedIndex: action.index, feedback: null };
  }
  if (action.type === 'hint') return { ...state, helped: true, showHint: true };
  if (action.type === 'solution') return { ...state, helped: true, showSolution: true };
  if (action.type === 'check' && !state.solved) {
    const feedback = checkMysteryAnswer(state.caseId, state.stageIndex, state.selectedIndex);
    return feedback ? { ...state, solved: feedback.correct, feedback } : state;
  }
  if (action.type === 'next' && state.solved) {
    const completed = [...state.completed, { stageIndex: state.stageIndex, helped: state.helped }];
    if (state.stageIndex === current.stages.length - 1) return { ...state, completed, done: true };
    return { ...createMysteryState(state.caseId), stageIndex: state.stageIndex + 1, completed };
  }
  return state;
}

function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}

export function mountEvidenceMystery(container, { onExit, renderMath } = {}) {
  const root = node('section', 'evidence-mystery'); container.append(root);
  const listeners = new AbortController();
  let state = null, disposed = false;
  const status = node('p', 'mystery-status'); status.setAttribute('role', 'status');
  const region = node('div', 'mystery-region');
  root.append(node('h2', '', 'Evidence mysteries'),
    node('p', 'mystery-intro', 'Read a short original case. Find its key phrase, follow the evidence, then repair the final report. Each correct checked answer opens the next step when you select Next.'),
    node('p', 'mystery-rules', 'Optional and self-paced. All three cases are open. Hints and worked explanations are available; help is recorded only in this activity. There is no SAT score or mastery credit. Progress lasts while this page stays open. You can leave at any time.'),
    status, region);
  const exit = node('button', 'secondary', 'Return to course library'); exit.type = 'button';
  exit.addEventListener('click', () => { if (onExit) onExit(); else window.location.hash = '#/courses'; }, { signal: listeners.signal }); root.append(exit);

  const button = (text, action, secondary = true) => {
    const item = node('button', secondary ? 'secondary' : '', text); item.type = 'button';
    item.addEventListener('click', action, { signal: listeners.signal }); return item;
  };
  const focusHeading = () => queueMicrotask(() => { if (!disposed) region.querySelector('[tabindex="-1"]')?.focus(); });
  function chooseCase(id) { state = createMysteryState(id); status.textContent = 'Case opened. Read the passage and find the first clue.'; render(); focusHeading(); }
  function dispatch(action) {
    state = transitionMystery(state, action);
    if (action.type === 'check' && state.feedback) status.textContent = state.feedback.correct ? 'Correct. Select Next when you are ready.' : 'Not yet. Read the evidence feedback and try again.';
    else if (action.type === 'hint') status.textContent = 'Hint shown. This step is marked with help.';
    else if (action.type === 'solution') status.textContent = 'Worked explanation shown. Select and check the supported answer to continue.';
    else if (action.type === 'next') status.textContent = state.done ? 'Case complete.' : 'Next step opened.';
    render();
    if (action.type === 'next' || action.type === 'restart') focusHeading();
    else if (['check', 'hint', 'solution'].includes(action.type)) queueMicrotask(() => {
      if (disposed) return;
      const target = action.type === 'check' ? region.querySelector('.mystery-feedback') : region.querySelector('.mystery-help');
      if (target) { target.tabIndex = -1; target.focus(); }
    });
  }
  function renderChoices() {
    const heading = node('h3', '', 'Choose an open case'); heading.tabIndex = -1; region.append(heading);
    const list = node('div', 'mystery-case-list');
    for (const item of MYSTERY_CASES) {
      const card = node('article', 'mystery-case-card'); card.append(node('h4', '', item.title), node('p', '', 'Three steps: evidence, inference and grammar.'), button('Open ' + item.title, () => chooseCase(item.id), false)); list.append(card);
    }
    region.append(list);
  }
  function render() {
    region.replaceChildren();
    if (!state) { renderChoices(); return; }
    const current = findCase(state.caseId);
    const heading = node('h3', '', current.title); heading.tabIndex = -1; region.append(heading);
    region.append(button('Choose another case', () => { state = null; status.textContent = 'All cases remain available.'; render(); focusHeading(); }));
    if (state.done) {
      const helped = state.completed.filter((item) => item.helped).length;
      region.append(node('p', 'mystery-complete', 'Case complete. You checked all three clues. ' + helped + ' step' + (helped === 1 ? '' : 's') + ' used help.'),
        node('p', '', 'The record supports the conclusion because you identified its evidence, followed the stated rule and checked the grammar of the report.'),
        button('Restart this case', () => dispatch({ type: 'restart' })));
      return;
    }
    const stage = current.stages[state.stageIndex];
    region.append(node('p', 'mystery-progress', 'Step ' + (state.stageIndex + 1) + ' of 3 · ' + stage.kind));
    const passage = node('blockquote', 'mystery-passage', current.passage); region.append(passage);
    const prompt = node('p', 'mystery-prompt', stage.prompt); region.append(prompt);
    const choices = node('fieldset', 'mystery-choices'); choices.append(node('legend', 'visually-hidden', 'Choose the supported answer'));
    stage.choices.forEach((choice, index) => {
      const wrap = node('label', 'mystery-choice'), radio = node('input'); radio.type = 'radio'; radio.name = 'mystery-choice'; radio.value = index; radio.checked = state.selectedIndex === index; radio.disabled = state.solved;
      radio.addEventListener('change', () => { state = transitionMystery(state, { type: 'select', index }); check.disabled = false; region.querySelector('.mystery-feedback')?.remove(); status.textContent = 'Answer selected. Select Check clue when ready.'; }, { signal: listeners.signal });
      wrap.append(radio, node('span', '', choice)); choices.append(wrap);
    });
    region.append(choices);
    const actions = node('div', 'btn-row');
    const check = button('Check clue', () => dispatch({ type: 'check' }), false); check.disabled = state.selectedIndex === null || state.solved; actions.append(check);
    if (!state.solved) {
      if (!state.showHint) actions.append(button('Show a hint', () => dispatch({ type: 'hint' })));
      if (!state.showSolution) actions.append(button('Show worked explanation', () => dispatch({ type: 'solution' })));
    }
    region.append(actions);
    if (state.showHint) region.append(node('p', 'mystery-help', 'Hint: ' + stage.hint));
    if (state.feedback) {
      const feedback = node('section', 'mystery-feedback ' + (state.solved ? 'is-correct' : 'is-not-yet'));
      feedback.append(node('h4', '', state.solved ? 'Correct.' : 'Not yet.'), node('p', '', state.feedback.message));
      if (state.solved) feedback.append(node('p', '', 'Evidence: ' + stage.evidence), node('p', '', stage.explanation));
      region.append(feedback);
    }
    if (state.showSolution) {
      const solution = node('section', 'mystery-help');
      solution.append(node('h4', '', 'Worked explanation'), node('p', '', 'Supported answer: ' + stage.choices[stage.answerIndex]), node('p', '', 'Evidence: ' + stage.evidence), node('p', '', stage.explanation)); region.append(solution);
    }
    if (state.solved) region.append(button(state.stageIndex === 2 ? 'Finish case' : 'Next step', () => dispatch({ type: 'next' }), false));
    renderMath?.(region);
  }
  const cleanup = () => { if (disposed) return; disposed = true; listeners.abort(); observer.disconnect(); root.remove(); };
  const observer = new MutationObserver(() => { if (!root.isConnected) cleanup(); }); observer.observe(document.body, { childList: true, subtree: true });
  render();
  return cleanup;
}
