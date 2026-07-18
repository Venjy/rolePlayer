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
import { useI18n } from "../i18n";
import type {
  LocalizedText,
  TranslationParameters,
} from "../i18n/locale";

const EMPTY_CATALOG: RolePlayCatalog = {
  personaPresets: [],
  personas: [],
  scenarios: [],
};

type Translate = (
  text: LocalizedText,
  parameters?: TranslationParameters,
) => string;

type CatalogErrorState =
  | { kind: "cause"; cause: unknown }
  | { kind: "synchronization" };

function readableCatalogError(
  error: unknown,
  t: Translate,
  fallback: LocalizedText,
): string {
  if (!(error instanceof Error)) return t(fallback);

  const duplicateName = error.message.match(
    /^A (persona|scenario) named "(.+)" already exists\.$/,
  );
  if (duplicateName) {
    return t(
      {
        en: "A {entity} named “{name}” already exists.",
        zh: "名为“{name}”的{entity}已存在。",
      },
      {
        entity: t(
          duplicateName[1] === "persona"
            ? { en: "persona", zh: "角色" }
            : { en: "scenario", zh: "场景" },
        ),
        name: duplicateName[2] ?? "",
      },
    );
  }

  const notFound = error.message.match(
    /^No (persona|scenario) exists with ID "(.+)"\.$/,
  );
  if (notFound) {
    return t(
      {
        en: "No {entity} exists with ID “{id}”. Refresh the catalog and try again.",
        zh: "ID 为“{id}”的{entity}不存在。请刷新目录后重试。",
      },
      {
        entity: t(
          notFound[1] === "persona"
            ? { en: "persona", zh: "角色" }
            : { en: "scenario", zh: "场景" },
        ),
        id: notFound[2] ?? "",
      },
    );
  }

  const unknownPersonas = error.message.match(
    /^Unknown compatible persona IDs: (.+)\.$/,
  );
  if (unknownPersonas) {
    return t(
      {
        en: "Some compatible personas no longer exist: {ids}. Refresh the catalog and try again.",
        zh: "部分兼容角色已不存在：{ids}。请刷新目录后重试。",
      },
      { ids: unknownPersonas[1] ?? "" },
    );
  }

  const personaInUse = error.message.match(
    /^Persona "(.+)" is still referenced by scenarios: (.+)\.$/,
  );
  if (personaInUse) {
    return t(
      {
        en: "Persona “{id}” is still used by these scenarios: {scenarios}. Remove those links before deleting it.",
        zh: "角色“{id}”仍被以下场景使用：{scenarios}。请先移除关联再删除。",
      },
      { id: personaInUse[1] ?? "", scenarios: personaInUse[2] ?? "" },
    );
  }

  const instructionsTooLong = error.message.match(
    /^The Instructions for persona "(.+)" and scenario "(.+)" are too long \((\d+)\/(\d+) characters\)\.$/,
  );
  if (instructionsTooLong) {
    return t(
      {
        en: "The Instructions for persona “{persona}” and scenario “{scenario}” are too long ({actual}/{maximum} characters).",
        zh: "角色“{persona}”与场景“{scenario}”生成的 Instructions 过长（{actual}/{maximum} 字符）。",
      },
      {
        persona: instructionsTooLong[1] ?? "",
        scenario: instructionsTooLong[2] ?? "",
        actual: instructionsTooLong[3] ?? "",
        maximum: instructionsTooLong[4] ?? "",
      },
    );
  }

  if (
    error.message === "The request body or path parameters are invalid."
  ) {
    return t({
      en: "Some submitted fields are invalid. Review the form and try again.",
      zh: "部分提交字段无效，请检查表单后重试。",
    });
  }

  return t(fallback);
}

export function useRolePlayCatalog(
  onCatalogChange?: (catalog: RolePlayCatalog) => void,
) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<RolePlayCatalog>(EMPTY_CATALOG);
  const catalogRef = useRef<RolePlayCatalog>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadErrorCause, setLoadErrorCause] = useState<unknown | null>(null);
  const [mutationErrorState, setMutationErrorState] =
    useState<CatalogErrorState | null>(null);
  const loadError = loadErrorCause
    ? readableCatalogError(loadErrorCause, t, {
        en: "Could not load persona and scenario data. Try again.",
        zh: "角色与场景数据加载失败，请重试。",
      })
    : null;
  const mutationError = mutationErrorState
    ? mutationErrorState.kind === "synchronization"
      ? t({
          en: "The change was saved, but the list could not be resynchronized with the server. This page has been updated with the local result.",
          zh: "更改已保存，但列表未能从服务端重新同步；当前页面已使用本地结果更新。",
        })
      : readableCatalogError(mutationErrorState.cause, t, {
          en: "Could not update the persona and scenario catalog. Try again.",
          zh: "角色与场景目录更新失败，请重试。",
        })
    : null;

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
    setLoadErrorCause(null);
    try {
      const nextCatalog = await fetchRolePlayCatalog(signal);
      commitCatalog(nextCatalog);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setLoadErrorCause(cause);
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
          setLoadErrorCause(cause);
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
      setMutationErrorState(null);
      try {
        let result: T;
        try {
          result = await operation();
        } catch (cause) {
          setMutationErrorState({ kind: "cause", cause });
          throw new Error(
            readableCatalogError(cause, t, {
              en: "Could not update the persona and scenario catalog. Try again.",
              zh: "角色与场景目录更新失败，请重试。",
            }),
            { cause },
          );
        }

        commitCatalog(applyLocally(catalogRef.current, result));
        try {
          const nextCatalog = await fetchRolePlayCatalog();
          commitCatalog(nextCatalog);
          setLoadErrorCause(null);
        } catch {
          setMutationErrorState({ kind: "synchronization" });
        }
      } finally {
        setBusy(false);
      }
    },
    [commitCatalog, t],
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
