import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { CreateSkillEngineUi, EngineDetectionState } from "./useCreateSkill";

export function useAuthoringEngine() {
  const [engineDetection, setDetection] = useState<EngineDetectionState | null>(null);
  const [engine, updateEngine] = useState<CreateSkillEngineUi>("vskill");
  const explicit = useRef(false);
  const initialized = useRef(false);
  const setEngine = useCallback((next: CreateSkillEngineUi) => {
    explicit.current = true;
    updateEngine(next);
  }, []);
  const refreshEngineDetection = useCallback(async () => {
    let detection: EngineDetectionState;
    try { detection = await api.detectEngines(); }
    catch { detection = { vskillSkillBuilder: false, anthropicSkillCreator: false, vskillVersion: null, anthropicPath: null }; }
    setDetection(detection);
    if (!initialized.current && !explicit.current) {
      updateEngine(detection.vskillSkillBuilder ? "vskill" : detection.anthropicSkillCreator ? "anthropic-skill-creator" : "none");
    }
    initialized.current = true;
  }, []);
  useEffect(() => { void refreshEngineDetection(); }, [refreshEngineDetection]);
  const engineAvailable = engine === "none" || !!(engine === "vskill" ? engineDetection?.vskillSkillBuilder : engineDetection?.anthropicSkillCreator);
  return { engineDetection, engine, setEngine, refreshEngineDetection, engineAvailable };
}
