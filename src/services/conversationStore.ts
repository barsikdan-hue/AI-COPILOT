import { CallStage, ConfirmedFact, ConversationState, CriterionItem, SpinState, TranscriptTurn, UnconfirmedHypothesis } from '../types';
import { validateEvidenceQuote, hasAnyPhrase } from './textUtils';

export function createInitialState(): ConversationState {
  return {
    stage: 'contact',
    revision: 0,
    goal: { value: null, evidenceTurnIds: [] },
    primaryGoal: { value: null, evidenceTurnIds: [] },
    secondaryUse: { value: null, evidenceTurnIds: [] },
    financialPriority: { value: null, evidenceTurnIds: [] },
    location: { value: null, evidenceTurnIds: [] },
    budget: { value: null, evidenceTurnIds: [] },
    paymentMethod: { value: null, evidenceTurnIds: [] },
    purchaseTimeline: { value: null, evidenceTurnIds: [] },
    moveInTimeline: { value: null, evidenceTurnIds: [] },
    possibleExitHorizon: { value: null, evidenceTurnIds: [] },
    timeline: { value: null, evidenceTurnIds: [] },
    decisionMakers: { value: null, evidenceTurnIds: [] },
    criteria: { value: null, items: [], evidenceTurnIds: [] },
    concerns: { value: null, items: [], evidenceTurnIds: [] },
    objections: { value: null, items: [], evidenceTurnIds: [] },
    confirmedFacts: [],
    spin: {
      situation: [],
      problem: [],
      implication: [],
      needPayoff: [],
      currentStage: 'SITUATION',
      completedStages: [],
      missingStage: 'SITUATION',
      lastClientEvidence: '',
      confidence: 0,
    },
    hpbPresentation: null,
    lastAgentAction: 'none',
    suggestionMode: 'WAIT',
    unconfirmedHypotheses: [],
    askedQuestions: [],
    agreedNextStep: { value: null, evidenceTurnIds: [] },
  };
}

/**
 * Sanitize strings to avoid AI hallucinating small children or school needs
 * when client only stated "for family" or "living".
 */
function sanitizeFactValue(field: string, val: string, turnText?: string): string {
  let cleaned = val.trim();

  // If evidence text does not mention children/school/kindergarten, strip hallucinated inferences
  if (turnText) {
    const lowerTurn = turnText.toLowerCase();
    const mentionsKids =
      lowerTurn.includes('дет') ||
      lowerTurn.includes('ребен') ||
      lowerTurn.includes('школ') ||
      lowerTurn.includes('сад') ||
      lowerTurn.includes('малыш') ||
      lowerTurn.includes('сын') ||
      lowerTurn.includes('дочь');

    if (!mentionsKids) {
      if (
        cleaned.toLowerCase().includes('маленькие дети') ||
        cleaned.toLowerCase().includes('дети') ||
        cleaned.toLowerCase().includes('школ') ||
        cleaned.toLowerCase().includes('детский сад')
      ) {
        // Strip out fabricated children/school mention, keep base family/living fact
        cleaned = cleaned
          .replace(/с маленькими детьми/gi, '')
          .replace(/с детьми/gi, '')
          .replace(/маленькие дети/gi, '')
          .replace(/наличие школы и сада/gi, '')
          .replace(/школа рядом/gi, '')
          .trim();
        if (!cleaned || cleaned === 'для') {
          cleaned = 'Для семьи';
        }
      }
    }
  }

  return cleaned;
}

export function mergeFactsDelta(
  current: ConversationState,
  delta: Array<{
    category?: string;
    field: string;
    value: string;
    evidenceQuote?: string;
    evidenceTurnId: string;
    confidence?: number;
    status?: any;
    semanticReason?: string;
    needsClarification?: boolean;
    isFlexible?: boolean;
    comment?: string;
  }>,
  newStage?: CallStage,
  objection?: string | null,
  newRevision?: number,
  turnTextLookup?: Record<string, string>,
  additionalAskedQuestions?: string[],
  spinDelta?: {
    situation?: Array<any>;
    problem?: Array<any>;
    implication?: Array<any>;
    needPayoff?: Array<any>;
    currentStage?: any;
    completedStages?: any[];
    missingStage?: string;
    lastClientEvidence?: string;
    confidence?: number;
  },
  unconfirmedHypotheses?: Array<{
    category: string;
    text: string;
    reason: string;
  }>,
  scriptProgress?: any,
  qualityResult?: any,
  indicatorUpdates?: Record<
    string,
    {
      status: any;
      value?: string | null;
      evidenceQuote?: string | null;
      evidenceTurnId?: string | null;
      semanticReason?: string | null;
    }
  >,
  signals?: Array<{
    type: string;
    text: string;
    evidenceQuote: string;
    turnId: string;
  }>
): ConversationState {
  const next: ConversationState = JSON.parse(JSON.stringify(current));

  if (scriptProgress) {
    next.scriptProgress = scriptProgress;
    if (scriptProgress.trust) {
      next.trustEvaluation = scriptProgress.trust;
    }
  }
  if (qualityResult) {
    next.qualityResult = qualityResult;
  }

  // Support signals collection
  if (signals && Array.isArray(signals)) {
    if (!next.signals) {
      next.signals = [];
    }
    for (const sig of signals) {
      if (sig && sig.text && !next.signals.some((s) => s.text === sig.text && s.turnId === sig.turnId)) {
        next.signals.push(sig);
      }
    }
  }

  // Support indicator updates directly onto scriptProgress metrics
  if (indicatorUpdates && typeof indicatorUpdates === 'object' && next.scriptProgress?.metrics) {
    for (const [metricId, update] of Object.entries(indicatorUpdates)) {
      if (next.scriptProgress.metrics[metricId]) {
        const m = next.scriptProgress.metrics[metricId];
        if (update.status) m.status = update.status;
        if (update.value) m.value = update.value;
        if (update.evidenceQuote) m.evidenceQuote = update.evidenceQuote;
        if (update.evidenceTurnId) m.evidenceTurnId = update.evidenceTurnId;
        if (update.semanticReason) m.semanticReason = update.semanticReason;
      }
    }
  }

  if (!next.confirmedFacts) {
    next.confirmedFacts = [];
  }
  if (!next.spin) {
    next.spin = {
      situation: [],
      problem: [],
      implication: [],
      needPayoff: [],
      currentStage: 'SITUATION',
      completedStages: [],
      missingStage: 'SITUATION',
      lastClientEvidence: '',
      confidence: 0,
    };
  }
  if (!next.unconfirmedHypotheses) {
    next.unconfirmedHypotheses = [];
  }

  if (typeof newRevision === 'number') {
    next.revision = newRevision;
  }

  if (newStage) {
    next.stage = newStage;
  }

  if (objection && !next.objections.items.includes(objection)) {
    next.objections.items.push(objection);
    next.objections.value = next.objections.items.join(', ');
  }

  if (additionalAskedQuestions && additionalAskedQuestions.length > 0) {
    for (const q of additionalAskedQuestions) {
      const trimmed = q.trim();
      if (trimmed && !next.askedQuestions.includes(trimmed)) {
        next.askedQuestions.push(trimmed);
      }
    }
  }

  for (const item of delta) {
    const { field, value, evidenceQuote, evidenceTurnId, confidence, needsClarification, isFlexible, comment } = item;
    if (!field || !value) continue;

    const turnText = turnTextLookup ? turnTextLookup[evidenceTurnId] : undefined;
    const sanitizedVal = sanitizeFactValue(field, value, turnText);
    if (!sanitizedVal) continue;

    // Requirement 6: EVIDENCE INVARIANT
    // A confirmed fact MUST have a valid quote found in the client turn text
    if (turnText && evidenceQuote) {
      if (!validateEvidenceQuote(turnText, evidenceQuote)) {
        console.warn(
          `[Evidence Invariant] Rejected fact "${field}" with fabricated quote "${evidenceQuote}" against turn: "${turnText}"`
        );
        next.unconfirmedHypotheses.push({
          category: item.category || field,
          text: sanitizedVal,
          reason: `Evidence quote "${evidenceQuote}" not found in turn text`,
        });
        continue;
      }
    }

    // Specific hallucination guard for decision makers (e.g. "важен" / "предложений" matching "жен")
    if ((field === 'decisionMakers' || field === 'decision_makers') && turnText) {
      const mentionsSpouse = hasAnyPhrase(turnText, [
        'с женой',
        'с мужем',
        'с супругой',
        'с супругом',
        'с семьей',
        'с семьёй',
        'решаем вместе',
        'обсудим с женой',
        'обсудим с мужем',
        'советуюсь с семьей',
      ]);
      const mentionsSolo = hasAnyPhrase(turnText, [
        'сам решаю',
        'сама решаю',
        'один выбираю',
        'одна выбираю',
        'самостоятельно',
      ]);
      if (!mentionsSpouse && !mentionsSolo) {
        console.warn(
          `[DecisionMaker Invariant] Rejected decision maker "${sanitizedVal}" without explicit client evidence in turn: "${turnText}"`
        );
        continue;
      }
    }

    // Record to confirmedFacts collection if we have turnId and a quote
    const quote = (evidenceQuote && evidenceQuote.trim()) || (turnText ? turnText.trim() : '');
    if (quote && evidenceTurnId) {
      const cat = item.category || field;
      const existingIdx = next.confirmedFacts.findIndex(
        (f) => f.turnId === evidenceTurnId && f.category === cat
      );
      const factRecord: ConfirmedFact = {
        id: `fact_${evidenceTurnId}_${field}`,
        category: cat,
        value: sanitizedVal,
        evidenceQuote: quote,
        turnId: evidenceTurnId,
        confidence: typeof confidence === 'number' ? confidence : 0.9,
        isFlexible,
        comment,
        timestamp: Date.now(),
      };
      if (existingIdx >= 0) {
        next.confirmedFacts[existingIdx] = factRecord;
      } else {
        next.confirmedFacts.push(factRecord);
      }
    }

    switch (field) {
      case 'primaryGoal':
        next.primaryGoal = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...(next.primaryGoal?.evidenceTurnIds || []), evidenceTurnId])),
          needsClarification,
        };
        next.goal = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...(next.goal?.evidenceTurnIds || []), evidenceTurnId])),
          needsClarification,
        };
        break;

      case 'secondaryUse':
        next.secondaryUse = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...(next.secondaryUse?.evidenceTurnIds || []), evidenceTurnId])),
          needsClarification,
        };
        break;

      case 'financialPriority':
      case 'financial_priority':
        next.financialPriority = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...(next.financialPriority?.evidenceTurnIds || []), evidenceTurnId])),
          needsClarification,
        };
        break;

      case 'goal':
        // Requirement 7: Goal model refinement (primaryGoal vs secondaryUse)
        if (
          sanitizedVal.toLowerCase().includes('жизн') ||
          sanitizedVal.toLowerCase().includes('проживан') ||
          sanitizedVal.toLowerCase().includes('пмж') ||
          sanitizedVal.toLowerCase().includes('переезд')
        ) {
          next.primaryGoal = {
            value: sanitizedVal,
            evidenceTurnIds: Array.from(new Set([...(next.primaryGoal?.evidenceTurnIds || []), evidenceTurnId])),
            needsClarification,
          };
          next.goal = {
            value: sanitizedVal,
            evidenceTurnIds: Array.from(new Set([...(next.goal?.evidenceTurnIds || []), evidenceTurnId])),
            needsClarification,
          };
        } else if (
          sanitizedVal.toLowerCase().includes('сдавать') ||
          sanitizedVal.toLowerCase().includes('аренд')
        ) {
          // If client already stated living is primary, treat rental as secondary
          if (next.primaryGoal?.value && next.primaryGoal.value.toLowerCase().includes('жизн')) {
            next.secondaryUse = {
              value: 'Периодическая сдача во время отсутствия',
              evidenceTurnIds: Array.from(new Set([...(next.secondaryUse?.evidenceTurnIds || []), evidenceTurnId])),
              needsClarification,
            };
          } else {
            next.goal = {
              value: sanitizedVal,
              evidenceTurnIds: Array.from(new Set([...(next.goal?.evidenceTurnIds || []), evidenceTurnId])),
              needsClarification,
            };
          }
        } else {
          next.goal = {
            value: sanitizedVal,
            evidenceTurnIds: Array.from(new Set([...(next.goal?.evidenceTurnIds || []), evidenceTurnId])),
            needsClarification,
          };
        }
        break;

      case 'location':
        next.location = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...(next.location?.evidenceTurnIds || []), evidenceTurnId])),
          needsClarification,
        };
        break;

      case 'budget': {
        const lowerVal = sanitizedVal.toLowerCase();
        const isFlex =
          isFlexible ||
          lowerVal.includes('гибк') ||
          lowerVal.includes('посмотрим') ||
          lowerVal.includes('по вариантам') ||
          lowerVal.includes('не определен') ||
          lowerVal.includes('в зависимости');

        next.budget = {
          value: isFlex ? 'Гибкий (зависит от объекта)' : sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...(next.budget?.evidenceTurnIds || []), evidenceTurnId])),
          needsClarification,
          isFlexible: isFlex,
          comment: isFlex ? sanitizedVal : comment,
        };
        break;
      }

      case 'paymentMethod':
      case 'payment_method':
        next.paymentMethod = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...(next.paymentMethod?.evidenceTurnIds || []), evidenceTurnId])),
          needsClarification,
        };
        break;

      case 'purchaseTimeline':
      case 'purchase_timeline':
        next.purchaseTimeline = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.purchaseTimeline?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        if (next.timeline) {
          next.timeline.value = sanitizedVal;
        }
        break;

      case 'moveInTimeline':
      case 'move_in_timeline':
        next.moveInTimeline = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.moveInTimeline?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'possibleExitHorizon':
      case 'possible_exit_horizon':
      case 'exit_horizon':
        next.possibleExitHorizon = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.possibleExitHorizon?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'timeline': {
        // Classify generic timeline into purchaseTimeline or moveInTimeline
        const lowerT = sanitizedVal.toLowerCase();
        if (lowerT.includes('засел') || lowerT.includes('переезд') || lowerT.includes('сдач')) {
          next.moveInTimeline = {
            value: sanitizedVal,
            evidenceTurnIds: Array.from(
              new Set([...(next.moveInTimeline?.evidenceTurnIds || []), evidenceTurnId])
            ),
            needsClarification,
          };
        } else {
          next.purchaseTimeline = {
            value: sanitizedVal,
            evidenceTurnIds: Array.from(
              new Set([...(next.purchaseTimeline?.evidenceTurnIds || []), evidenceTurnId])
            ),
            needsClarification,
          };
        }
        next.timeline = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.timeline?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;
      }

      case 'decisionMakers':
      case 'decision_makers':
        next.decisionMakers = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(new Set([...next.decisionMakers.evidenceTurnIds, evidenceTurnId])),
          needsClarification,
        };
        break;

      case 'criteria':
      case 'clientCriteria':
      case 'client_criteria': {
        // Split comma-separated criteria items if multiple returned
        const rawItems = sanitizedVal
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 2);

        for (const itemStr of rawItems) {
          // Check for duplicate text
          const exists = next.criteria.items.some(
            (c) => c.text.toLowerCase() === itemStr.toLowerCase()
          );
          if (!exists) {
            next.criteria.items.push({
              text: itemStr,
              evidenceTurnId,
            });
          }
        }

        next.criteria.value = next.criteria.items.map((i) => i.text).join(', ');
        next.criteria.evidenceTurnIds = Array.from(
          new Set([...next.criteria.evidenceTurnIds, evidenceTurnId])
        );
        break;
      }

      case 'concerns':
        if (!next.concerns.items.includes(sanitizedVal)) {
          next.concerns.items.push(sanitizedVal);
        }
        next.concerns.value = next.concerns.items.join(', ');
        next.concerns.evidenceTurnIds = Array.from(
          new Set([...next.concerns.evidenceTurnIds, evidenceTurnId])
        );
        break;

      case 'objections':
        if (!next.objections.items.includes(sanitizedVal)) {
          next.objections.items.push(sanitizedVal);
        }
        next.objections.value = next.objections.items.join(', ');
        next.objections.evidenceTurnIds = Array.from(
          new Set([...next.objections.evidenceTurnIds, evidenceTurnId])
        );
        break;

      case 'agreedNextStep':
      case 'agreed_next_step':
        next.agreedNextStep = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...next.agreedNextStep.evidenceTurnIds, evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'downPaymentSource':
      case 'down_payment_source':
        next.downPaymentSource = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.downPaymentSource?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'familyMortgage':
      case 'family_mortgage':
        next.familyMortgage = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.familyMortgage?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'propertyType':
      case 'property_type':
        next.propertyType = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.propertyType?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'infrastructure':
        next.infrastructure = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.infrastructure?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'searchExperience':
      case 'search_experience':
        next.searchExperience = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.searchExperience?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'urgency':
        next.urgency = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.urgency?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'employment':
      case 'income':
        next.employment = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.employment?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'ppi':
        next.ppi = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.ppi?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;

      case 'ppv':
        next.ppv = {
          value: sanitizedVal,
          evidenceTurnIds: Array.from(
            new Set([...(next.ppv?.evidenceTurnIds || []), evidenceTurnId])
          ),
          needsClarification,
        };
        break;
    }
  }

  // Update SPIN state
  if (spinDelta) {
    if (!next.spin) {
      next.spin = {
        situation: [],
        problem: [],
        implication: [],
        needPayoff: [],
        currentStage: 'SITUATION',
        completedStages: [],
        missingStage: 'SITUATION',
        lastClientEvidence: '',
        confidence: 0,
      };
    }
    const appendSpin = (key: 'situation' | 'problem' | 'implication' | 'needPayoff', items?: any[]) => {
      if (!items || !Array.isArray(items)) return;
      for (const it of items) {
        if (!it) continue;
        const textVal = typeof it === 'string' ? it.trim() : String(it.text || '').trim();
        const quoteVal = typeof it === 'object' && it.evidenceQuote ? String(it.evidenceQuote).trim() : textVal;
        const turnIdVal = typeof it === 'object' && it.evidenceTurnId ? String(it.evidenceTurnId) : '';
        const confVal = typeof it === 'object' && typeof it.confidence === 'number' ? it.confidence : 0.9;

        if (textVal && !next.spin[key].some((existing) => existing.text.toLowerCase() === textVal.toLowerCase())) {
          next.spin[key].push({
            text: textVal,
            evidenceQuote: quoteVal,
            evidenceTurnId: turnIdVal,
            source: 'client',
            confidence: confVal,
          });
        }
      }
    };
    appendSpin('situation', spinDelta.situation);
    appendSpin('problem', spinDelta.problem);
    appendSpin('implication', spinDelta.implication);
    appendSpin('needPayoff', spinDelta.needPayoff);

    if (spinDelta.currentStage) next.spin.currentStage = spinDelta.currentStage;
    if (spinDelta.completedStages && Array.isArray(spinDelta.completedStages)) {
      next.spin.completedStages = Array.from(new Set([...next.spin.completedStages, ...spinDelta.completedStages]));
    }
    if (spinDelta.missingStage) next.spin.missingStage = spinDelta.missingStage;
    if (spinDelta.lastClientEvidence) next.spin.lastClientEvidence = spinDelta.lastClientEvidence;
    if (typeof spinDelta.confidence === 'number') next.spin.confidence = spinDelta.confidence;
  }

  // Update unconfirmed hypotheses
  if (unconfirmedHypotheses && Array.isArray(unconfirmedHypotheses)) {
    if (!next.unconfirmedHypotheses) {
      next.unconfirmedHypotheses = [];
    }
    for (const h of unconfirmedHypotheses) {
      if (h && h.text && !next.unconfirmedHypotheses.some((existing) => existing.text.toLowerCase() === h.text.toLowerCase())) {
        next.unconfirmedHypotheses.push(h);
      }
    }
  }

  return next;
}
