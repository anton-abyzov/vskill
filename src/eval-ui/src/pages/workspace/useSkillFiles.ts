import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { SkillFileEntry, SkillFileContent } from "../../types";

export interface UseSkillFilesResult {
  files: SkillFileEntry[];
  activeFile: string;
  secondaryContent: SkillFileContent | null;
  loading: boolean;
  error: string | null;
  /**
   * 0769 T-011: distinct from `error` (which covers per-file open failures).
   * `loadError` is non-null when the FILE LIST fetch itself failed, so the
   * file-tree UI can render "Skill files not accessible" instead of the
   * misleading "No files found" empty state.
   */
  loadError: string | null;
  selectFile: (path: string) => void;
  refresh: () => void;
  isSkillMd: boolean;
}

export function useSkillFiles(plugin: string, skill: string): UseSkillFilesResult {
  const [files, setFiles] = useState<SkillFileEntry[]>([]);
  const [activeFile, setActiveFile] = useState("SKILL.md");
  const [secondaryContent, setSecondaryContent] = useState<SkillFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchFileList = useCallback(async () => {
    try {
      const data = await api.getSkillFiles(plugin, skill);
      setFiles(data.files);
      setLoadError(null);
    } catch (err) {
      // 0769 T-011: surface fetch failures so the UI can distinguish "empty
      // skill" (legitimate) from "cannot reach the skill files" (error).
      setFiles([]);
      setLoadError((err as Error).message ?? "Unable to load skill files");
    }
  }, [plugin, skill]);

  // Reset to SKILL.md and reload file list when skill changes
  useEffect(() => {
    setActiveFile("SKILL.md");
    setSecondaryContent(null);
    setError(null);
    setLoadError(null);
    fetchFileList();
  }, [plugin, skill, fetchFileList]);

  const selectFile = useCallback(async (path: string) => {
    setActiveFile(path);
    if (path === "SKILL.md") {
      setSecondaryContent(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSkillFile(plugin, skill, path);
      setSecondaryContent(data);
    } catch (err) {
      setError(`Unable to open file: ${(err as Error).message}`);
      setSecondaryContent(null);
    } finally {
      setLoading(false);
    }
  }, [plugin, skill]);

  const refresh = useCallback(() => {
    fetchFileList();
  }, [fetchFileList]);

  return {
    files,
    activeFile,
    secondaryContent,
    loading,
    error,
    loadError,
    selectFile,
    refresh,
    isSkillMd: activeFile === "SKILL.md",
  };
}
