import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// OMP 18.12.6 public ExtensionAPI. State belongs to this factory/session.
export default function proposeDraft(pi: ExtensionAPI) {
  let active = false;
  let busy = false;
  let generation = 0;
  const reset = () => { active = false; busy = false; generation++; };
  pi.on("session_start", reset);
  pi.on("session_switch", reset);
  pi.on("session_branch", reset);
  pi.on("session_tree", reset);
  pi.on("input", event => {
    // Extension-generated input must never opt itself in.
    active = event.source !== "extension" && /^\s*draft(?=\s|$)/i.test(event.text);
    generation++;
  });
  pi.on("before_agent_start", event => {
    if (!active) return;
    return { systemPrompt: [...event.systemPrompt,
      "DRAFT PROPOSAL ACTIVE: Prepare only a draft. Call propose_draft with the full draft before answering. If exposed as an xd:// device, writing JSON to exactly xd://propose_draft is permitted. " +
      "On refine, revise the same draft using feedback and call propose_draft again. " +
      "On approved, return ONLY approvedDraft verbatim. On aborted/unavailable/error, stop without returning an approved draft. " +
      "Never publish, send, post, or execute mutations in this request, including after approval."] };
  });
  // Keep the guard until the next real user request, including after approval/abort.
  // Unknown tools are denied, since publishing is possible through shell/MCP/delegation.
  const readOnly = new Set(["read", "grep", "glob", "find", "ls", "web_search", "fetch"]);
  pi.on("tool_call", event => {
    // OMP exposes discoverable tools as writable xd:// devices. Permit only
    // this exact device, never arbitrary write targets or eval/shell bridges.
    const proposalDevice = event.toolName === "write" && event.input?.path === "xd://propose_draft";
    if (active && event.toolName !== "propose_draft" && !proposalDevice && !readOnly.has(event.toolName)) {
      return { block: true, reason: "Draft proposal permits only reading and propose_draft. Publishing/mutations require a separate user request." };
    }
  });
  const z = pi.zod;
  pi.registerTool({
    name: "propose_draft",
    label: "Draft proposal",
    loadMode: "essential",
    description: "Propose any communication draft (GitHub issues, discussions, comments, messages, etc.) ONLY for a user request starting with 'draft'. Never publishes. Refine requires another review; only approvedDraft may be returned after approved.",
    parameters: z.object({ draft: z.string().min(1) }),
    approval: "read",
    async execute(_id, { draft }, signal, _update, ctx) {
      const result = (status: string, extra: Record<string, unknown> = {}) => {
        const data = { status, published: false, ...extra };
        return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data };
      };
      if (!active) return result("unavailable", { reason: "No explicit draft-prefixed user request." });
      if (busy) return result("unavailable", { reason: "Another draft proposal is open." });
      if (!ctx.hasUI || ctx.mode !== "tui" || typeof ctx.annotations?.open !== "function") {
        return result("unavailable", { reason: "Native annotations require an interactive OMP TUI. No approval granted." });
      }
      if (!draft.trim()) return result("error", { reason: "Empty draft." });
      const token = generation;
      const cancelled = () => signal?.aborted || token !== generation || !active;
      busy = true;
      try {
        if (cancelled()) return result("aborted");
        const notes = await ctx.annotations.open({ source: { kind: "text", text: draft, label: "Draft proposal (no publishing)" }, deliver: "none" });
        if (cancelled()) return result("aborted");
        if (notes !== undefined) {
          if (notes.kind !== "text" || notes.delivered !== "none") return result("error", { reason: "Unexpected annotation result. No approval granted." });
          if (notes.annotations.length || notes.editedText !== undefined || notes.text?.trim()) {
            return result("refine", { feedback: notes.text ?? "Review the edited draft and resubmit.", annotations: notes.annotations,
              ...(notes.editedText !== undefined ? { editedDraft: notes.editedText } : {}) });
          }
        }
        // Dismissal is NOT approval. The native overlay cannot submit without notes.
        // This selector approves exactly the original input, never discarded overlay edits.
        const action = await ctx.ui.select("Draft proposal: overlay closed. Approve the ORIGINAL draft unchanged?", [
          "Abort", "Refine", "Approve original draft (return only; never publish)",
        ]);
        if (cancelled()) return result("aborted");
        if (action === "Approve original draft (return only; never publish)") return result("approved", { approvedDraft: draft });
        if (action === "Refine") {
          const feedback = await ctx.ui.input("Refine this draft", "Describe the changes; cancel aborts");
          if (cancelled() || !feedback?.trim()) return result("aborted");
          return result("refine", { feedback });
        }
        return result("aborted");
      } catch {
        return result(cancelled() ? "aborted" : "error", { reason: "Review did not complete. No approval granted; do not publish." });
      } finally { busy = false; }
    },
  });
}
