import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { SkillFileEntry, SkillFileContent } from "../../types";

export interface UseSkillFilesResult {
  files: SkillFileEntry[];
  activeFile: string;
  secondaryContent: SkillFileContent | null;
  loading: boolean;
  error: string | null;
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

  const fetchFileList = useCallback(async () => {
    try {
      const data = await api.getSkillFiles(plugin, skill);
      setFiles(data.files);
    } catch (err) {
      // Non-fatal — file tree just stays empty
      setFiles([]);
    }
  }, [plugin, skill]);

  // Reset to SKILL.md and reload file list when skill changes
  useEffect(() => {
    setActiveFile("SKILL.md");
    setSecondaryContent(null);
    setError(null);
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
    selectFile,
    refresh,
    isSkillMd: activeFile === "SKILL.md",
  };
}
