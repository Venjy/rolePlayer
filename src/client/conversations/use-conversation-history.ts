import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConversationDetail,
  ConversationSummary,
  CreateConversationInput,
} from "../../shared/conversation-history";
import {
  createConversation as createConversationRequest,
  deleteConversation as deleteConversationRequest,
  fetchConversation,
  fetchConversations,
} from "./conversation-api";

function toSummary(conversation: ConversationDetail): ConversationSummary {
  return {
    id: conversation.id,
    personaName: conversation.persona.name,
    scenarioName: conversation.scenario.name,
    difficulty: conversation.difficulty,
    locale: conversation.locale,
    status: conversation.status,
    endedAt: conversation.endedAt,
    feedbackStatus: conversation.feedbackStatus,
    messageCount: conversation.messageCount,
    audioMessageCount: conversation.audioMessageCount,
    audioAvailable: conversation.audioAvailable,
    lastMessagePreview: conversation.lastMessagePreview,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function newestFirst(
  conversations: readonly ConversationSummary[],
): ConversationSummary[] {
  return [...conversations].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.id - left.id,
  );
}

export function useConversationHistory() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequestGenerationRef = useRef(0);
  const visibleRequestGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const generation = ++listRequestGenerationRef.current;
    const visibleGeneration = ++visibleRequestGenerationRef.current;
    if (mountedRef.current) setLoading(true);
    try {
      const result = await fetchConversations(signal);
      if (
        !mountedRef.current ||
        generation !== listRequestGenerationRef.current
      ) {
        return;
      }
      setConversations(result.conversations);
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (
        !mountedRef.current ||
        generation !== listRequestGenerationRef.current
      ) {
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Conversation history could not be loaded.",
      );
    } finally {
      if (
        mountedRef.current &&
        visibleGeneration === visibleRequestGenerationRef.current
      ) {
        setLoading(false);
      }
    }
  }, []);

  const refreshSilently = useCallback(async (): Promise<void> => {
    const generation = ++listRequestGenerationRef.current;
    try {
      const result = await fetchConversations();
      if (
        !mountedRef.current ||
        generation !== listRequestGenerationRef.current
      ) {
        return;
      }
      setConversations(result.conversations);
      setError(null);
    } catch (caught) {
      if (
        !mountedRef.current ||
        generation !== listRequestGenerationRef.current
      ) {
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Conversation history could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    const generation = ++listRequestGenerationRef.current;
    const visibleGeneration = ++visibleRequestGenerationRef.current;
    void fetchConversations(controller.signal)
      .then((result) => {
        if (
          !mountedRef.current ||
          generation !== listRequestGenerationRef.current
        ) {
          return;
        }
        setConversations(result.conversations);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (
          !mountedRef.current ||
          generation !== listRequestGenerationRef.current
        ) {
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "Conversation history could not be loaded.",
        );
      })
      .finally(() => {
        if (
          mountedRef.current &&
          visibleGeneration === visibleRequestGenerationRef.current
        ) {
          setLoading(false);
        }
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      listRequestGenerationRef.current += 1;
      visibleRequestGenerationRef.current += 1;
    };
  }, []);

  const create = useCallback(
    async (input: CreateConversationInput): Promise<ConversationDetail> => {
      if (mountedRef.current) setBusy(true);
      try {
        const conversation = await createConversationRequest(input);
        if (!mountedRef.current) return conversation;
        // The create result is newer than every list request that started
        // before it completed, including refreshes launched while POST was in
        // flight.
        listRequestGenerationRef.current += 1;
        visibleRequestGenerationRef.current += 1;
        setLoading(false);
        const summary = toSummary(conversation);
        setConversations((current) =>
          newestFirst([
            summary,
            ...current.filter(({ id }) => id !== summary.id),
          ]),
        );
        setError(null);
        return conversation;
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [],
  );

  const load = useCallback(async (id: number): Promise<ConversationDetail> => {
    if (mountedRef.current) setBusy(true);
    try {
      const conversation = await fetchConversation(id);
      if (mountedRef.current) setError(null);
      return conversation;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const remove = useCallback(async (id: number): Promise<void> => {
    if (mountedRef.current) setBusy(true);
    try {
      await deleteConversationRequest(id);
      if (!mountedRef.current) return;
      listRequestGenerationRef.current += 1;
      visibleRequestGenerationRef.current += 1;
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== id),
      );
      setError(null);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  return {
    conversations,
    loading,
    busy,
    error,
    refresh,
    refreshSilently,
    create,
    load,
    remove,
  };
}
