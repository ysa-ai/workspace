export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-inset flex items-center justify-center px-4">
      <div className="w-full max-w-[380px] animate-[slide-up_0.25s_ease_both]">
        <div className="mb-10">
          <span className="font-mono text-[18px] font-semibold text-text-primary tracking-tight">ysa</span>
        </div>
        <div className="bg-bg-raised border border-border rounded-xl p-7">
          {children}
        </div>
      </div>
    </div>
  );
}
