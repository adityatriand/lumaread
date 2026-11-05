import { Laptop, RefreshCw, Smartphone, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { forgetPeer, listPeers, type PeerDevice } from "../../lib/db";
import { timeAgo } from "../../lib/format";
import { deviceName, errorText, nearby, pairWith, setDeviceName, startSync, stopSync, syncWith, type Nearby, type PairRequest } from "./sync";

const POLL_MS = 2000;
const deviceIcon = (name: string) => (/phone|android|tablet/i.test(name) ? Smartphone : Laptop);

// Pair and sync with LumaRead on your other devices on the same Wi-Fi. Visible to them only while this page is open.
export function SyncPage({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState(deviceName);
  const [status, setStatus] = useState<"starting" | "ready" | "failed">("starting");
  const [error, setError] = useState<string>();
  const [found, setFound] = useState<Nearby[]>([]);
  const [paired, setPaired] = useState<PeerDevice[]>([]);
  const [pairing, setPairing] = useState<PairRequest & { incoming: boolean }>();
  const [busy, setBusy] = useState<string>(); // device id being paired or synced
  const [step, setStep] = useState<string>();
  const [result, setResult] = useState<string>();
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const loadPaired = () => listPeers().then(setPaired, () => setPaired([]));

  useEffect(() => {
    let alive = true;
    loadPaired();
    startSync(
      () => changed.current(),
      (request) => alive && setPairing({ ...request, incoming: true }),
    ).then(
      () => alive && setStatus("ready"),
      (e) => alive && (setStatus("failed"), setError(errorText(e))),
    );
    const poll = setInterval(() => nearby().then((list) => alive && setFound(list), () => undefined), POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
      stopSync();
    };
  }, []);

  async function pair(peer: Nearby) {
    setBusy(peer.id);
    setResult(undefined);
    try {
      setPairing({ ...(await pairWith(peer)), incoming: false });
    } catch (e) {
      setResult(errorText(e));
    } finally {
      setBusy(undefined);
    }
  }

  async function confirmPair(match: boolean) {
    const p = pairing!;
    setPairing(undefined);
    if (!match) return setResult("Pairing cancelled.");
    await p.accept();
    await loadPaired();
    setResult(`Paired with ${p.name}. ${p.incoming ? "Sync from either device." : "Confirm on the other device too, then sync."}`);
  }

  async function sync(peer: PeerDevice, at: Nearby) {
    setBusy(peer.id);
    setResult(undefined);
    try {
      const s = await syncWith(peer, at, setStep);
      const parts = [
        s.booksReceived && `${s.booksReceived} book${s.booksReceived > 1 ? "s" : ""} received`,
        s.booksSent && `${s.booksSent} book${s.booksSent > 1 ? "s" : ""} sent`,
        `${s.received} update${s.received === 1 ? "" : "s"} here`,
        `${s.sent} on ${peer.name}`,
      ].filter(Boolean);
      setResult(`Synced with ${peer.name}: ${parts.join(", ")}.`);
      onChanged();
      loadPaired();
    } catch (e) {
      setResult(errorText(e));
    } finally {
      setBusy(undefined);
      setStep(undefined);
    }
  }

  async function forget(peer: PeerDevice) {
    await forgetPeer(peer.id);
    loadPaired();
  }

  const pairedIds = new Set(paired.map((p) => p.id));
  const unpairedNearby = found.filter((f) => !pairedIds.has(f.id));

  return (
    <div className="screen">
      <header className="page-header">
        <div>
          <h1>Sync</h1>
          <p className="muted">Books, reading progress, highlights, notes, bookmarks and reading stats, between your devices on the same Wi-Fi. Open this page on both.</p>
        </div>
      </header>

      <section className="card sync-device">
        <label className="field">
          <span className="muted small">This device's name</span>
          <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} onBlur={() => setDeviceName(name)} />
        </label>
        <p className={`sync-status ${status}`} role="status">
          {status === "starting" ? "Starting…" : status === "ready" ? <><Wifi size={16} aria-hidden="true" /> Visible to your devices on this Wi-Fi while this page is open</> : `Sync can't start: ${error}`}
        </p>
      </section>

      <section className="card">
        <h2>Your devices</h2>
        {paired.length === 0 ? (
          <p className="muted">No paired devices yet. Open Sync on your other device and pair it below.</p>
        ) : (
          <ul className="sync-list">
            {paired.map((p) => {
              const at = found.find((f) => f.id === p.id);
              const Icon = deviceIcon(p.name);
              return (
                <li key={p.id}>
                  <Icon size={20} aria-hidden="true" />
                  <span className="sync-name">
                    <strong>{p.name}</strong>
                    <span className="muted small">{at ? "Nearby" : "Not visible yet — leave Sync open on it"}{p.lastSync ? ` · Last synced ${timeAgo(p.lastSync)}` : " · Never synced"}</span>
                  </span>
                  <button className="button primary" disabled={!at || !!busy} onClick={() => at && sync(p, at)}>
                    <RefreshCw size={16} className={busy === p.id ? "spin" : undefined} aria-hidden="true" /> Sync now
                  </button>
                  <button className="link" disabled={!!busy} onClick={() => forget(p)}>Forget</button>
                </li>
              );
            })}
          </ul>
        )}
        {paired.some((p) => !found.some((f) => f.id === p.id)) && (
          <p className="muted small">Sync now turns on only while that device is visible. Same Wi-Fi and an existing pairing are not enough — leave the Sync page open there too. On a Mac, also allow LumaRead under System Settings → Privacy &amp; Security → Local Network.</p>
        )}
      </section>

      <section className="card">
        <h2>Nearby</h2>
        {unpairedNearby.length === 0 ? (
          <p className="muted">{status === "ready" ? "Looking for LumaRead on this Wi-Fi…" : "—"}</p>
        ) : (
          <ul className="sync-list">
            {unpairedNearby.map((f) => {
              const Icon = deviceIcon(f.name);
              return (
                <li key={f.id}>
                  <Icon size={20} aria-hidden="true" />
                  <span className="sync-name"><strong>{f.name}</strong><span className="muted small">Not paired</span></span>
                  <button className="button" disabled={!!busy} onClick={() => pair(f)}>{busy === f.id ? "Pairing…" : "Pair"}</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(step || result) && <p className="sync-result" role="status">{step ?? result}</p>}

      {pairing && (
        <div className="backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-label="Confirm pairing">
            <h2>{pairing.incoming ? `${pairing.name} wants to pair` : `Pair with ${pairing.name}`}</h2>
            <p className="muted">Check that both devices show the same code.</p>
            <p className="pair-code" aria-live="polite">{pairing.code}</p>
            <div className="confirm-actions">
              <button className="button" onClick={() => confirmPair(false)}>Cancel</button>
              <button className="button primary" onClick={() => confirmPair(true)}>They match</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
