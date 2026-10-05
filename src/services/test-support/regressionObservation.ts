import type { ConversationState, TranscriptTurn } from '../../types';

export interface RegressionIdentity {
  readonly harness: 'original' | 'expanded';
  readonly caseId: string;
  readonly variation: number;
  readonly instance: 'primary' | 'isolation-a' | 'isolation-b';
  readonly turnCutoff: number;
}

export interface RegressionObservation {
  readonly identity: Readonly<RegressionIdentity>;
  readonly turns: readonly Readonly<Pick<TranscriptTurn, 'id' | 'speaker' | 'text'>>[];
  readonly core: {
    readonly rejectedBranches: readonly string[];
    readonly facts?: readonly Readonly<{
      category: string; value: string; turnId: string;
    }>[];
  };
}

export interface RegressionObservationOptions {
  observation?: {
    select(identity: Readonly<RegressionIdentity>): boolean;
    onObservation(value: Readonly<RegressionObservation>): void;
    onError?(identity: Readonly<RegressionIdentity>, code: string): void;
  };
}

// An accidental async callback must not create an unhandled rejection or make
// the synchronous Harness depend on completion of an export.
function discardAsyncResult(value: unknown): boolean {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(value).catch(() => {});
    return true;
  }
  return false;
}

export function emitRegressionObservation(
  identity: RegressionIdentity,
  result: { turns: TranscriptTurn[]; state: ConversationState },
  options: RegressionObservationOptions,
): void {
  const observer = options.observation;
  if (!observer) return;

  const detachedIdentity = Object.freeze({
    harness: identity.harness,
    caseId: identity.caseId,
    variation: identity.variation,
    instance: identity.instance,
    turnCutoff: identity.turnCutoff,
  });
  const onError = (code: string): void => {
    try {
      discardAsyncResult(observer.onError?.(detachedIdentity, code));
    } catch {
      // Error reporting is advisory too; it cannot affect Harness execution.
    }
  };

  try {
    const selected: unknown = observer.select(detachedIdentity);
    if (discardAsyncResult(selected)) {
      onError('ASYNC_SELECTOR');
      return;
    }
    if (selected !== true) return;
  } catch {
    onError('SELECTOR_ERROR');
    return;
  }

  try {
    // Only active explicit client facts matching the canonical field are exposed.
    // This detached DEV view has no state authority and contains no whole ledger.
    const categories = ['paymentMethod', 'budget', 'familyMortgage', 'downPayment'] as const;
    const facts = result.state.confirmedFacts.filter((fact) => {
      if (!categories.includes(fact.category as typeof categories[number])
        || fact.origin !== 'client_explicit' || fact.status !== 'confirmed'
        || ['superseded', 'rejected'].includes(fact.lifecycleStatus ?? '')) return false;
      const field = result.state[fact.category as typeof categories[number]];
      return field?.value === fact.value && field.evidenceTurnIds.includes(fact.turnId)
        && result.turns.some(turn => turn.id === fact.turnId && turn.speaker === 'client');
    }).map(({ category, value, turnId }) => Object.freeze({ category, value, turnId }));
    const observation: RegressionObservation = Object.freeze({
      identity: detachedIdentity,
      turns: Object.freeze(result.turns.map(({ id, speaker, text }) => Object.freeze({ id, speaker, text }))),
      core: Object.freeze({ rejectedBranches: Object.freeze([...(result.state.dialogueControl?.rejectedBranches ?? [])]), facts: Object.freeze(facts) }),
    });
    if (discardAsyncResult(observer.onObservation(observation))) onError('ASYNC_OBSERVER');
  } catch {
    onError('OBSERVATION_ERROR');
  }
}
