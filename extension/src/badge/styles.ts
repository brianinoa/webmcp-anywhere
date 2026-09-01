/** Self-contained CSS for the in-page badge (lives inside a closed Shadow DOM). */
export const BADGE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #e8e8f0;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
}
.root.hidden { display: none; }
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: #1c1c2b; color: #e8e8f0; border: 1px solid #3a3a55;
  border-radius: 999px; padding: 6px 12px 6px 8px; cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,.35); user-select: none; font-weight: 600;
}
.pill:hover { border-color: #6c6cff; }
.pill.off { opacity: .7; }
.pill.busy .bolt { animation: pulse .8s infinite alternate; }
@keyframes pulse { from { opacity: .4 } to { opacity: 1 } }
.bolt { width: 14px; height: 14px; display: inline-block; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
.dot.off { background: #f87171; }
.dot.pending { background: #fbbf24; }
.panel {
  width: 340px; max-height: 60vh; overflow: auto;
  background: #14141f; border: 1px solid #3a3a55; border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.45); padding: 10px 12px;
}
.panel.closed { display: none; }
.hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.hdr b { font-size: 13px; }
.muted { color: #9a9ab5; }
.sec { margin-top: 10px; }
.sec h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #9a9ab5; }
.sec-hdr { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
button.build { background: #1e2a4a; color: #93c5fd; }
button.build:hover { background: #26356a; }
.draft { background: #14192b; border: 1px solid #2d3a5c; border-radius: 10px; padding: 8px 10px; margin: 6px 0 8px; }
.draft.err { border-color: #b45309; color: #fca5a5; }
.draft.saved { border-color: #16a34a; }
.draft-name { font-weight: 700; font-size: 12.5px; margin-bottom: 2px; word-break: break-word; }
.draft-tools { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.draft-chip { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; padding: 1px 6px;
  border-radius: 999px; background: #1c1c2b; color: #c5c5da; border: 1px solid #2d3a5c; }
.draft-status { color: #9a9ab5; font-size: 11px; margin: 4px 0; min-height: 0; }
.draft-link { display: inline-block; margin: 4px 0 6px; color: #93c5fd; text-decoration: underline; font-weight: 600; }
button:disabled { opacity: .5; cursor: default; }
.tool { display: flex; align-items: center; gap: 6px; padding: 3px 0; border-bottom: 1px solid #22223a; }
.tool .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip { font-size: 10px; padding: 1px 6px; border-radius: 999px; font-weight: 600; text-transform: uppercase; }
.chip.read { background: #173a2a; color: #6ee7a7; }
.chip.write { background: #3a2f17; color: #fcd34d; }
.chip.sensitive { background: #3a1717; color: #fca5a5; }
.chip.recipe { background: #1e2a4a; color: #93c5fd; }
.log { display: flex; flex-direction: column; gap: 4px; }
.entry { background: #1c1c2b; border-radius: 8px; padding: 5px 8px; }
.entry .top { display: flex; gap: 6px; align-items: center; }
.entry .name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; flex: 1; }
.entry .ms { color: #9a9ab5; font-size: 10.5px; }
.entry .body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: #c5c5da;
  white-space: pre-wrap; word-break: break-word; margin-top: 2px; max-height: 60px; overflow: hidden; }
.entry.ok .name::before { content: "✓ "; color: #4ade80; }
.entry.err .name::before { content: "✗ "; color: #f87171; }
.entry.err .body { color: #fca5a5; }
.entry.running .name::before { content: "… "; color: #fbbf24; }
.approval { background: #2a1f10; border: 1px solid #b45309; border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
.approval b { color: #fcd34d; }
.approval pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; background: #14141f;
  padding: 6px; border-radius: 6px; margin: 6px 0; white-space: pre-wrap; word-break: break-word; max-height: 140px; overflow: auto; color: #e8e8f0; }
.btns { display: flex; gap: 6px; justify-content: flex-end; }
button { font: inherit; font-weight: 600; border: 0; border-radius: 6px; padding: 5px 12px; cursor: pointer; }
button.approve { background: #16a34a; color: #fff; }
button.deny { background: #3a3a55; color: #e8e8f0; }
button.small { padding: 2px 8px; font-size: 11px; background: #2a2a40; color: #c5c5da; }
.empty { color: #6f6f8a; font-style: italic; }
`;
