import { createContext, useContext, useReducer, useCallback, useEffect, useMemo } from "react";
import { api } from "./api";
import type { ConfigResponse } from "./api";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ConfigState {
  config: ConfigResponse | null;
  loading: boolean;
}

const initialState: ConfigState = {
  config: null,
  loading: true,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type ConfigAction =
  | { type: "SET_CONFIG"; config: ConfigResponse }
  | { type: "SET_LOADING" };

function configReducer(state: ConfigState, action: ConfigAction): ConfigState {
  switch (action.type) {
    case "SET_CONFIG":
      return { config: action.config, loading: false };
    case "SET_LOADING":
      return { ...state, loading: true };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ConfigContextValue {
  config: ConfigResponse | null;
  loading: boolean;
  updateConfig: (provider: string, model?: string) => Promise<ConfigResponse>;
  refreshConfig: () => void;
}

const ConfigCtx = createContext<ConfigContextValue | null>(null);

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigCtx);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(configReducer, initialState);

  const refreshConfig = useCallback(() => {
    api.getConfig()
      .then((config) => dispatch({ type: "SET_CONFIG", config }))
      .catch(() => {});
  }, []);

  // Fetch config on mount
  useEffect(() => { refreshConfig(); }, [refreshConfig]);

  const updateConfig = useCallback(async (provider: string, model?: string) => {
    const result = await api.setConfig(provider, model);
    dispatch({ type: "SET_CONFIG", config: result });
    return result;
  }, []);

  const value = useMemo<ConfigContextValue>(() => ({
    config: state.config,
    loading: state.loading,
    updateConfig,
    refreshConfig,
  }), [state, updateConfig, refreshConfig]);

  return <ConfigCtx.Provider value={value}>{children}</ConfigCtx.Provider>;
}
