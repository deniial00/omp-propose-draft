# omp-propose-draft

Experimental [Oh My Pi](https://github.com/can1357/oh-my-pi) extension for proposing communication drafts: GitHub issues, discussions, PR descriptions, comments, and other messages.

**Work in progress. The current workflow still does not behave as intended in real use.** Published as a development snapshot, not a finished release.

## Install

```sh
omp plugin install github:deniial00/omp-propose-draft
```

Merge the contents of `RULES.example.md` into `~/.omp/agent/RULES.md`, preserving your existing rules. The plugin does not modify that file automatically. Restart OMP.

If you already installed this extension manually, remove the old `~/.omp/agent/extensions/propose-draft.ts` before loading the plugin to avoid duplicate registration. Keep a backup if needed.

Alternatively, copy `propose-draft.ts` into `~/.omp/agent/extensions/` and merge the example rules.

## Current workflow

Begin the user request with the standalone word `draft` (case-insensitive; leading whitespace allowed):

```text
draft an issue describing this bug
```

The agent calls `propose_draft` with the full draft. It opens native `ctx.annotations.open()` with `deliver: "none"`.

- Submitted annotations or edits return `refine`; the agent revises and resubmits.
- For approval without annotations, close the overlay and explicitly choose **Approve original draft (return only; never publish)** in the separate selector. **Abort** is the first option.
- Approve returns the exact submitted draft. It does not send, post, or publish anything.
- Escape, missing UI, cancellation, errors, and empty refinement input never grant approval.

While active, the extension blocks tools except selected reading tools, `propose_draft`, and the exact native `write` bridge targeting `xd://propose_draft`. This restriction remains after approval/abort until a new user request.

## Known limitations

- Real-session behavior still needs investigation and manual end-to-end validation. Mock tests and successful loading do not prove the complete TUI workflow works as desired.
- Requires native interactive TUI mode. RPC, embedded, or headless sessions may not provide the native annotation overlay; the tool then returns `unavailable`.
- Only a leading `draft` activates the workflow. A sentence such as “let’s draft an issue” does not.
- Refinements within the tool loop stay active. A separate user message is evaluated anew and needs the prefix to start another draft review.
- Final response fidelity and calling the tool depend on agent instructions. There is no final-answer enforcement filter.
- The tool guard is not a security boundary against other independently acting extensions, manual actions, or replaced reading tools.
- Discarded overlay edits cannot be approved by the separate selector. Submit edits/annotations and review the revised draft again.
- An earlier version blocked its own `xd://` invocation. The current snapshot permits that exact target and declares the tool essential; the user still reports the overall workflow is not yet satisfactory.

## Validation

Developed against OMP **18.12.6** public types. Strict TypeScript checking against that source tree passed. OMP loaded and registered the tool without extension errors.

```sh
bun test
```

Eight mock behavior tests (71 assertions) cover activation, refinement, approval, cancellation, missing UI, errors, session changes, concurrency, mutation guards, and the exact `xd://` bridge. No GitHub publishing functionality is implemented by this extension.
