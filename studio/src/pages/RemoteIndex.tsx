import { useState } from "react";
import { useNavigate } from "react-router-dom";

/** Landing page for remote control: type a room code (or open the link the extension gives you). */
export function RemoteIndex() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  const clean = code.toUpperCase().replace(/[^A-Z2-9]/g, "");
  const valid = clean.length >= 6 && clean.length <= 16;

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (valid) navigate(`/remote/${clean}`);
  };

  return (
    <div className="remote-index">
      <h1>Remote control</h1>
      <p className="lede">
        Drive the tools on another device from your phone. Enable remote control from the WebMCP Anywhere extension on the
        computer you want to control, then open the code it shows you here.
      </p>
      <form className="remote-index-form" onSubmit={go}>
        <label className="field">
          <span>Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. K7PQ2M"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            aria-label="Room code"
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={!valid}>
          Connect
        </button>
      </form>
      <p className="muted remote-index-hint">Codes are 6–16 characters, letters and digits (no 0, O, 1, or I).</p>
    </div>
  );
}
