import type { WizardMode, DetectedConfig } from "./index";

export function CompletionScreen({
  projectId,
  detected,
  mode,
  buildTriggered,
  onClose,
}: {
  projectId: string;
  detected: DetectedConfig | null;
  mode: WizardMode;
  buildTriggered?: boolean;
  onClose: () => void;
}) {
  const detectedFields = detected ? [
    detected.repositoryUrl && "Source repository",
    detected.installCommand && "Install command",
    detected.buildCommand && "Build command",
    detected.testCommand && "Test command",
    (detected.languageRuntimes?.length ?? 0) > 0 && "Language runtimes",
    (detected.devServers?.length ?? 0) > 0 && "Dev servers",
    (detected.envFiles?.length ?? 0) > 0 && "Env files",
    detected.mcpConfigPath && "MCP config",
  ].filter(Boolean) : [];

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-raised">
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        <div className="w-12 h-12 rounded-full bg-ok/10 border border-ok/30 flex items-center justify-center">
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="text-ok">
            <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="text-center space-y-1.5">
          <p className="text-[16px] font-semibold text-text-primary">Project ready</p>
          <p className="text-[13px] text-text-muted">
            {mode === "autodetect" && detectedFields.length > 0
              ? `Auto-detected ${detectedFields.length} settings from your project`
              : "Your project has been created and configured"}
          </p>
          {buildTriggered && (
            <p className="text-[12px] text-text-faint">Runtime image is building in the background</p>
          )}
        </div>

        {detectedFields.length > 0 && (
          <div className="w-full max-w-xs space-y-1.5">
            {(detectedFields as string[]).map((label) => (
              <div key={label} className="flex items-center gap-2 text-[12px] text-text-muted">
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" className="text-ok shrink-0">
                  <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {label}
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2.5 rounded-lg text-[13px] font-medium bg-primary text-white hover:brightness-110 transition-colors cursor-pointer"
        >
          Go to project
        </button>
      </div>
    </div>
  );
}
