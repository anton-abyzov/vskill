# Plan

1. Wire App's `activeAgentId` into `SkillDetailPanel` and the nested `InstallTargetsModal`.
2. Normalize provider ids to install-target ids and fall back to the first detected filesystem target.
3. Close App-level install target modal after clean filesystem success while preserving error/export flows.
4. Add focused unit tests, then run install/UI regressions.
5. Verify with a local project and record the end-to-end install proof before release.
