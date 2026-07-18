import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersonaInput,
  RolePlayCatalog,
  ScenarioInput,
} from "../../shared/role-play-catalog";
import {
  createPersona,
  createScenario,
  deletePersona,
  deleteScenario,
  fetchRolePlayCatalog,
  updatePersona,
  updateScenario,
} from "./catalog-api";

const EMPTY_CATALOG: RolePlayCatalog = {
  personaPresets: [],
  personas: [],
  scenarios: [],
};

function readableCatalogError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "角色与场景数据加载失败，请重试。";
}

export function useRolePlayCatalog(
  onCatalogChange?: (catalog: RolePlayCatalog) => void,
) {
  const [catalog, setCatalog] = useState<RolePlayCatalog>(EMPTY_CATALOG);
  const catalogRef = useRef<RolePlayCatalog>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const commitCatalog = useCallback(
    (nextCatalog: RolePlayCatalog) => {
      catalogRef.current = nextCatalog;
      setCatalog(nextCatalog);
      onCatalogChange?.(nextCatalog);
    },
    [onCatalogChange],
  );

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const nextCatalog = await fetchRolePlayCatalog(signal);
      commitCatalog(nextCatalog);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setLoadError(readableCatalogError(cause));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [commitCatalog]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchRolePlayCatalog(controller.signal)
      .then((nextCatalog) => {
        commitCatalog(nextCatalog);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setLoadError(readableCatalogError(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [commitCatalog]);

  const mutate = useCallback(
    async <T,>(
      operation: () => Promise<T>,
      applyLocally: (current: RolePlayCatalog, result: T) => RolePlayCatalog,
    ) => {
      setBusy(true);
      setMutationError(null);
      try {
        let result: T;
        try {
          result = await operation();
        } catch (cause) {
          const message = readableCatalogError(cause);
          setMutationError(message);
          throw cause;
        }

        commitCatalog(applyLocally(catalogRef.current, result));
        try {
          const nextCatalog = await fetchRolePlayCatalog();
          commitCatalog(nextCatalog);
          setLoadError(null);
        } catch {
          setMutationError(
            "更改已保存，但列表未能从服务端重新同步；当前页面已使用本地结果更新。",
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [commitCatalog],
  );

  return {
    catalog,
    loading,
    busy,
    loadError,
    mutationError,
    reload: () => reload(),
    createPersona: (input: PersonaInput) =>
      mutate(
        () => createPersona(input),
        (current, persona) => ({
          ...current,
          personas: [...current.personas, persona],
        }),
      ),
    updatePersona: (id: string, input: PersonaInput) =>
      mutate(
        () => updatePersona(id, input),
        (current, persona) => ({
          ...current,
          personas: current.personas.map((candidate) =>
            candidate.id === id ? persona : candidate,
          ),
        }),
      ),
    deletePersona: (id: string) =>
      mutate(
        () => deletePersona(id),
        (current) => ({
          ...current,
          personas: current.personas.filter((persona) => persona.id !== id),
        }),
      ),
    createScenario: (input: ScenarioInput) =>
      mutate(
        () => createScenario(input),
        (current, scenario) => ({
          ...current,
          scenarios: [...current.scenarios, scenario],
        }),
      ),
    updateScenario: (id: string, input: ScenarioInput) =>
      mutate(
        () => updateScenario(id, input),
        (current, scenario) => ({
          ...current,
          scenarios: current.scenarios.map((candidate) =>
            candidate.id === id ? scenario : candidate,
          ),
        }),
      ),
    deleteScenario: (id: string) =>
      mutate(
        () => deleteScenario(id),
        (current) => ({
          ...current,
          scenarios: current.scenarios.filter((scenario) => scenario.id !== id),
        }),
      ),
  };
}
