function isRunningInCI() {
    return !!(process.env.CI === 'true' ||
        process.env.GITHUB_ACTIONS === 'true' ||
        process.env.GITLAB_CI === 'true' ||
        process.env.JENKINS_URL);
}
export function getCiDefaults(options) {
    const isCI = isRunningInCI();
    return {
        isCI,
        headed: isCI ? false : (options?.headed ?? false),
        outputDir: options?.outputDir ?? '.playwright-cli',
    };
}
