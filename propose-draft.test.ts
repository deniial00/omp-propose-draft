import { test, expect } from 'bun:test';
import install from './propose-draft';
function harness() {
  const events: Record<string, Function> = {}; let tool: any;
  const schema: any = { min: () => schema };
  install({ zod: { object: () => schema, string: () => schema }, on: (n: string, f: Function) => events[n] = f, registerTool: (t: any) => tool = t } as any);
  const calls: any[] = [];
  const ctx: any = { hasUI: true, mode: 'tui', annotations: { open: async (req: any) => { calls.push(req); return undefined; } }, ui: { select: async () => undefined, input: async () => undefined } };
  const input = (text: string, source = 'interactive') => events.input({ text, source });
  const run = async (draft = 'Exact draft\n', signal?: AbortSignal) => (await tool.execute('id', { draft }, signal, undefined, ctx)).details;
  return { events, ctx, calls, input, run };
}
test('only standalone draft at start opts in; no synthetic opt-in', async () => {
  for (const text of ['write a reply', 'please draft this', 'drafting x', '"draft x"', '> draft x', 'draft: x']) {
    const h = harness(); h.input(text); expect((await h.run()).status).toBe('unavailable'); expect(h.calls).toHaveLength(0);
  }
  for (const text of ['draft x', 'DRAFT x', ' \nDraft x', 'draft']) {
    const h = harness(); h.input(text); expect((await h.run()).status).toBe('aborted'); expect(h.calls).toHaveLength(1);
  }
  const h = harness(); h.input('draft x', 'extension'); expect((await h.run()).status).toBe('unavailable');
});
test('native notes refine and subsequent review remains active', async () => {
  const h = harness(); h.input('draft x');
  h.ctx.annotations.open = async () => ({kind:'text', delivered:'none', annotations:[{note:'shorter'}], text:'shorter', editedText:'Edited'});
  const r = await h.run(); expect(r.status).toBe('refine'); expect(r.editedDraft).toBe('Edited'); expect(r.published).toBe(false);
  h.ctx.annotations.open = async () => undefined;
  h.ctx.ui.select = async () => 'Approve original draft (return only; never publish)';
  expect(await h.run('Edited')).toEqual({ status:'approved', published:false, approvedDraft:'Edited' });
});
test('dismissal never approves; only exact explicit selection does', async () => {
  for (const choice of [undefined, 'Abort', 'approve', 'Approve']) {
    const h = harness(); h.input('draft x'); h.ctx.ui.select = async () => choice;
    const r = await h.run(); expect(r.status).toBe('aborted'); expect(r.approvedDraft).toBeUndefined();
    expect(h.calls[0].deliver).toBe('none');
  }
  const h = harness(); h.input('draft x'); h.ctx.ui.select = async (_: string, options: string[]) => { expect(options[0]).toBe('Abort'); return options[2]; };
  expect((await h.run()).approvedDraft).toBe('Exact draft\n');
});
test('manual refine, empty input, cancellation, exceptions, no UI fail closed', async () => {
  const h = harness(); h.input('draft x'); h.ctx.ui.select = async () => 'Refine';
  expect((await h.run()).status).toBe('aborted');
  h.ctx.ui.input = async () => 'shorter'; expect((await h.run()).status).toBe('refine');
  h.ctx.annotations.open = async () => {throw Error('failure');}; expect((await h.run()).status).toBe('error');
  h.ctx.hasUI = false; expect((await h.run()).status).toBe('unavailable');
  h.ctx.hasUI = true; const controller = new AbortController(); controller.abort(); expect((await h.run('x', controller.signal)).status).toBe('aborted');
});
test('mutation guard remains after approve and abort; next ordinary input clears', async () => {
  const h = harness(); h.input('draft x');
  for (const toolName of ['bash','python','task','mcp_post','write','browser']) expect(h.events.tool_call({toolName}).block).toBe(true);
  expect(h.events.tool_call({toolName:'read'})).toBeUndefined();
  await h.run(); expect(h.events.tool_call({toolName:'bash'}).block).toBe(true);
  h.ctx.ui.select = async () => 'Approve original draft (return only; never publish)'; await h.run();
  expect(h.events.tool_call({toolName:'mcp_post'}).block).toBe(true);
  h.input('post this'); expect(h.events.tool_call({toolName:'mcp_post'})).toBeUndefined(); expect((await h.run()).status).toBe('unavailable');
});
test('session changes and new input during UI invalidate approval', async () => {
  for (const event of ['session_start','session_switch','session_branch','session_tree']) {
    const h = harness(); h.input('draft x'); h.events[event](); expect((await h.run()).status).toBe('unavailable');
  }
  const h = harness(); h.input('draft x'); h.ctx.ui.select = async () => {h.input('something else'); return 'Approve original draft (return only; never publish)';};
  expect((await h.run()).status).toBe('aborted');
});
test('concurrent calls cannot obtain a second review', async () => {
  const h = harness(); h.input('draft x'); let resolve: any;
  h.ctx.annotations.open = () => new Promise(r => resolve = r);
  const pending = h.run(); expect((await h.run()).status).toBe('unavailable'); resolve(undefined); expect((await pending).status).toBe('aborted');
});

 test('OMP xd device bridge permits only the exact proposal target', async () => {
   const h = harness(); h.input('draft an issue');
   expect(h.events.tool_call({toolName:'write',input:{path:'xd://propose_draft',content:'{"draft":"text"}'}})).toBeUndefined();
   for (const path of ['issue://748', 'xd://other_tool', 'xd://propose_draft/extra', '/tmp/draft', 'XD://propose_draft']) {
     expect(h.events.tool_call({toolName:'write',input:{path}}).block).toBe(true);
   }
   expect(h.events.tool_call({toolName:'glob',input:{path:'*.md'}})).toBeUndefined();
   h.ctx.ui.select = async () => 'Approve original draft (return only; never publish)';
   expect((await h.run()).status).toBe('approved');
   expect(h.events.tool_call({toolName:'write',input:{path:'issue://748'}}).block).toBe(true);
 });
