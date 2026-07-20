import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

const ASSISTANT_SETTLEMENT_TIMEOUT_MS = 32_000;
const USER_COMMIT_SETTLEMENT_TIMEOUT_MS = 32_000;

export type SettlementResult =
  | { ok: true }
  | { ok: false; error: Error };

export interface SettlementWaiter {
  promise: Promise<SettlementResult>;
  complete: (result: SettlementResult) => void;
  timeoutId: number;
}

export interface AssistantSettlementWaiter extends SettlementWaiter {
  responseId: string;
}

export const SETTLEMENT_SUCCEEDED = {
  ok: true,
} as const satisfies SettlementResult;

export function requireSuccessfulSettlement(result: SettlementResult): void {
  if (!result.ok) throw result.error;
}

/**
 * Owns the two persistence barriers used by navigation and runtime recovery:
 * one committed learner turn and one generated assistant response.
 */
export function useRealtimeSettlement(
  setIsUserCommitPending: Dispatch<SetStateAction<boolean>>,
) {
  const assistantSettlementWaiterRef = useRef<
    AssistantSettlementWaiter | undefined
  >(undefined);
  const pendingAssistantResponseIdRef = useRef<string | undefined>(undefined);
  const userCommitSettlementWaiterRef = useRef<SettlementWaiter | undefined>(
    undefined,
  );
  const userCommitPendingRef = useRef(false);

  const completeAssistantSettlement = useCallback(
    (
      result: SettlementResult,
      responseId?: string,
      clearPendingResponse = result.ok,
    ) => {
      const waiter = assistantSettlementWaiterRef.current;
      if (
        waiter &&
        (responseId === undefined || waiter.responseId === responseId)
      ) {
        window.clearTimeout(waiter.timeoutId);
        assistantSettlementWaiterRef.current = undefined;
        waiter.complete(result);
      }
      if (
        clearPendingResponse &&
        (responseId === undefined ||
          pendingAssistantResponseIdRef.current === responseId)
      ) {
        pendingAssistantResponseIdRef.current = undefined;
      }
    },
    [],
  );

  const waitForAssistantSettlement = useCallback(
    (responseId: string): Promise<SettlementResult> => {
      const existing = assistantSettlementWaiterRef.current;
      if (existing?.responseId === responseId) return existing.promise;

      if (existing) {
        window.clearTimeout(existing.timeoutId);
        existing.complete({
          ok: false,
          error: new Error(
            "A newer assistant response replaced an unsettled response.",
          ),
        });
      }

      pendingAssistantResponseIdRef.current = responseId;
      let completePromise: (result: SettlementResult) => void = () => undefined;
      const promise = new Promise<SettlementResult>((resolve) => {
        completePromise = resolve;
      });
      const timeoutId = window.setTimeout(() => {
        const current = assistantSettlementWaiterRef.current;
        if (current?.promise !== promise) return;
        assistantSettlementWaiterRef.current = undefined;
        completePromise({
          ok: false,
          error: new Error("Timed out while saving the assistant response."),
        });
      }, ASSISTANT_SETTLEMENT_TIMEOUT_MS);

      assistantSettlementWaiterRef.current = {
        responseId,
        promise,
        complete: completePromise,
        timeoutId,
      };
      return promise;
    },
    [],
  );

  const createUserCommitSettlement = useCallback(
    (): Promise<SettlementResult> => {
      const existing = userCommitSettlementWaiterRef.current;
      if (existing) return existing.promise;

      userCommitPendingRef.current = true;
      setIsUserCommitPending(true);
      let completePromise: (result: SettlementResult) => void = () => undefined;
      const promise = new Promise<SettlementResult>((resolve) => {
        completePromise = resolve;
      });
      const timeoutId = window.setTimeout(() => {
        const current = userCommitSettlementWaiterRef.current;
        if (current?.promise !== promise) return;
        userCommitSettlementWaiterRef.current = undefined;
        completePromise({
          ok: false,
          error: new Error("Timed out while saving the user transcript."),
        });
      }, USER_COMMIT_SETTLEMENT_TIMEOUT_MS);
      userCommitSettlementWaiterRef.current = {
        promise,
        complete: completePromise,
        timeoutId,
      };
      return promise;
    },
    [setIsUserCommitPending],
  );

  const completeUserCommitSettlement = useCallback(
    (result: SettlementResult, clearPending = true) => {
      const waiter = userCommitSettlementWaiterRef.current;
      if (waiter) {
        window.clearTimeout(waiter.timeoutId);
        userCommitSettlementWaiterRef.current = undefined;
        waiter.complete(result);
      }
      if (clearPending) {
        userCommitPendingRef.current = false;
        setIsUserCommitPending(false);
      }
    },
    [setIsUserCommitPending],
  );

  const waitForUserCommitSettlement = useCallback(() => {
    if (!userCommitPendingRef.current) {
      return Promise.resolve<SettlementResult>(SETTLEMENT_SUCCEEDED);
    }
    return createUserCommitSettlement();
  }, [createUserCommitSettlement]);

  return {
    assistantSettlementWaiterRef,
    pendingAssistantResponseIdRef,
    userCommitPendingRef,
    completeAssistantSettlement,
    waitForAssistantSettlement,
    createUserCommitSettlement,
    completeUserCommitSettlement,
    waitForUserCommitSettlement,
  };
}
