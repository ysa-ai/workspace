# Landing Page — Working Context

## What the product is

**ysa platform** — multi-tenant SaaS that automates software development work from GitHub/GitLab issues. An AI agent runs inside hardened, sandboxed containers on the developer's machine (or their infra), picks up issues, writes code, and opens merge/pull requests.

Two editions:
- **ysa** (open source core, Apache 2.0) — standalone CLI + local web UI, task-based. Has its own landing at `landing/ysa/index.html`.
- **ysa platform** (this product) — SaaS layer on top of ysa, adds multi-tenancy, org management, GitLab/GitHub integration, customizable workflows, team features.

---

## Core product features

### Workflows — THE main differentiator
- The platform lets you build **custom multi-step workflows** — not just analyze→execute→finalize
- The default is a 3-step workflow (Analyze / Execute / Finalize) but users build their own
- **Workflow builder**: visual editor, custom steps, tool presets per step, conditional transitions between steps
- Each step has: prompt template, tool allowlist, container mode (read/write), network policy, modules
- **Tool presets**: reusable allowlists (built-in or org-defined) controlling what the agent can do
- **Modules per step**: plan, delivery (MR/PR info), unit_tests, manual_qa, issue_update — each surfaces specific data in the UI

### Issue automation
- Browse or manually enter GitHub/GitLab issue numbers
- Agent analyzes the issue, produces an implementation plan (you approve)
- Executes changes in a sandboxed container, opens MR/PR
- Finalizes: cleanup, test results, issue update
- **Dependency/blocker tracking**: issues can block each other, auto-unblock on completion
- Batch processing: multiple issues at once

### Integrations
- **GitHub** and **GitLab** (both supported)
- Issue browsing directly from the UI
- Automatic MR/PR creation after execution
- Blocker relationships: GitHub (parsed from issue body), GitLab (native links API)
- Issue auto-update on completion

### Security (built on ysa's security model)
- Rootless Podman containers per task — each issue gets its own isolated environment
- seccomp whitelist (~190 syscalls), `--cap-drop ALL`, read-only root fs
- **MITM network proxy** (L7): GET-only in strict mode, domain allowlist, Shannon entropy detection on URLs (catches base64/hex exfiltration attempts), rate limits
- **OCI network hook** (L3/L4): iptables in container netns, all traffic forced through proxy
- Two policies selectable per issue: Full internet / Restricted (proxy-enforced)
- Git sandbox wrapper: blocks dangerous git config (hooks, SSH, credentials)
- Keys encrypted at rest, injected only at container runtime — never logged

### LLM providers
- **Claude** (Anthropic) — multiple models
- **Mistral** — multiple models
- Per-project LLM config (provider, model, max turns, tool allowlist)

### Team & organizations
- Multi-tenant: organizations as top-level container
- Users can be in multiple orgs with different roles (owner / member)
- Email invite flow for onboarding teammates
- Projects belong to orgs
- Per-org tool presets and workflows

### Project configuration
- Git root path + worktree prefix
- Branch naming prefix (e.g. `fix/`)
- Container resource limits (memory, CPUs, PIDs, timeout)
- Build/test/install commands
- Dev servers (ports, env vars, auto-launch)
- MCP server config
- Private registry support (`.npmrc`)
- Language auto-detection for runtime setup

### Real-time feedback
- Live log streaming during agent runs (3s refresh)
- Split log view: agent logs (top) + network proxy logs (bottom, ALLOW/BLOCK per request)
- Resource metrics (CPU, RAM, PIDs)
- Build progress with step names and percentages
- Status badges: starting / running / step_done / failed / stopped / cleaned_up

### UX details
- Keyboard navigation: j/k (up/down), Enter (select), n (new issue input), Escape (back)
- Native terminal picker — open a shell inside the running container
- Phase/step jumping via dropdown
- Inline refine: send guidance to the running agent without stopping it
- Copy buttons everywhere (branch, commit, logs, plan)

---

## Artistic direction — LOCKED

**Design: "Control Room" (Direction A)**
- Font: `Manrope` (headlines 800, body 400/500) + `DM Mono` (labels, code snippets)
- Colors:
  - `#0D1117` bg
  - `#161B22` surface
  - `#1C2128` surface2
  - `#E6EDF3` text
  - `#7D8590` dim
  - `#21262D` border
  - `#3B82F6` blue accent
  - `rgba(59,130,246,0.15)` accent-dim
  - `#3FB950` green (YES / success)
  - `#F85149` red (NO / block)
- Hero: left-aligned headline + sub + CTA, right side: CSS-drawn dashboard mockup
- Feature sections: alternating rows (copy left / visual panel right, then reversed)
- Visual panels: CSS-built UI snippets (proxy log, phase steps, org grid) — no screenshots
- Beta badge: `● beta` blue-tinted pill

**ysa landing** (`landing/ysa/index.html`) uses a completely different direction (terminal brutalism, green accent, JetBrains Mono) — never mix the two.

---

## Routing architecture — DECIDED, NOT YET IMPLEMENTED

```
/               → landing (static HTML, served by Hono directly)
/signin         → React app (public, was /login)
/signup         → React app (public, was /register)
/invite/:token  → React app (public)
/app/*          → React app (protected, RequireAuth → /signin)
```

Implementation plan:
- `main.tsx`: `<BrowserRouter basename="/app">` + update expired token redirect to `/app/signin`
- `App.tsx`: rename /login→/signin, /register→/signup, RequireAuth redirects to `/signin`
- `LoginPage.tsx`: Link to `/signup`
- `RegisterPage.tsx`: Link to `/signin`
- `SidebarMenu.tsx`: `navigate("/login")` → `navigate("/signin")`
- `server/index.ts`: `app.get("/", ...)` serving `landing/platform/index.html` BEFORE serveStatic

---

## Roadmap / coming soon (beta context)

- **Self-hosted LLM support** — run against local models, not just cloud providers
- **More integrations** — Linear, Notion, Figma, and others beyond GitHub/GitLab
- **Team collaboration features** — real-time visibility, shared workflows, comments, approvals
- **QoL improvements** — many planned, product is early

The landing must reflect that this is a **beta**. Don't overpromise. Position the current feature set as a strong foundation, not a complete product. The roadmap gives context that this is a growing platform.

---

## Core value proposition — THE NORTH STAR

**"Clés en main" (turnkey) platform for developers who want to orchestrate AI agents in total security, with data sovereignty.**

The pain it solves: developers want to use AI agents on real work but can't trust existing tools — credentials leak, code leaves the machine, no control over what the agent does or where data goes. Every existing solution either requires trusting a cloud platform with your codebase or building the security layer yourself.

ysa platform gives you the full orchestration stack out of the box — hardened containers, network enforcement, customizable workflows, GitHub/GitLab integration, team management — without having to build any of it. You own your data, your keys, your infra. The agent runs where your code lives.

**Hero framing should lead with**: security + sovereignty + turnkey — NOT just "AI does your issues"

---

## Landing content priorities

1. **Customizable workflows** — main differentiator, lead with this
2. **GitHub + GitLab** — works where your issues already live
3. **Hardened by default** — security is a trust signal, not the headline
4. **Team ready** — orgs, roles, invites
5. **Built on ysa** — the container security layer IS ysa. Seccomp, network proxy, hardened containers — all ysa, all open source. Platform = orchestration on top. Promote ysa explicitly, link to repo.

The 3-phase workflow (analyze/execute/finalize) is the DEFAULT, not the product. Don't make it the hero.

## Security framing — IMPORTANT

The platform itself does NOT handle container security. That's entirely ysa's responsibility.
- **ysa** = container hardening, seccomp (~190 syscalls), MITM network proxy, OCI hooks, git sandbox wrapper
- **Platform** = orchestration, workflows, GitHub/GitLab integration, team management, encrypted key storage

Security pitch on the landing must be: "We built on ysa — open source, auditable security — rather than rolling our own."
This is a trust signal, not a feature list. Point people to the ysa repo to verify.
Never claim platform-level container security as a platform feature.

---

## Sections planned for full landing

- Nav
- Hero (headline + CTA + dashboard mockup)
- Selling points / features (alternating rows)
- FAQ
- Docs link
- OSS link (github.com/ysa-ai/ysa)
- Signup/signin CTA
- Beta indicator throughout

Currently built: nav + hero + 3 feature rows (security, workflow, team).
