"use client";
import { useEffect, useState } from "react";
import type { StudioProject } from "../../src/studio/types";
import type { ProjectData } from "../../src/engine/schema";
type Speech = {
  id: string;
  revision: number;
  captions: ProjectData["captions"];
  reliable: boolean;
  warnings: string[];
  provenance: { method: string };
};
type Suggestion = {
  revision: number;
  method: string;
  reasons: string[];
  changes: { scene: number; before: number; after: number; motion: string }[];
};
async function api<T>(url: string, body?: unknown) {
  const r = await fetch("/api/studio/" + url, {
    method: body ? "POST" : "GET",
    headers:
      body instanceof FormData
        ? undefined
        : body
          ? { "Content-Type": "application/json" }
          : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Smart editing request failed");
  return data as T;
}
export default function SmartPanel({
  doc,
  dirty,
  onApplied,
  onEdit,
  onBusyChange,
}: {
  doc: StudioProject;
  dirty: boolean;
  onApplied: (p: StudioProject) => void;
  onEdit: (p: ProjectData) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const [models, setModels] = useState<{
    alignment: { id: string; label: string }[];
    transcription: { id: string; label: string }[];
  }>({ alignment: [], transcription: [] });
  const [mode, setMode] = useState<"align" | "transcribe">("align"),
    [model, setModel] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [speech, setSpeech] = useState<Speech | null>(null),
    [suggestion, setSuggestion] = useState<Suggestion | null>(null),
    [reviewed, setReviewed] = useState(false),
    [category, setCategory] = useState("whoosh"),
    [license, setLicense] = useState("Original"),
    [attribution, setAttribution] = useState("");
  const p = doc.manifest;
  const script = p?.narrationScript || "";
  useEffect(() => {
    void api<typeof models>("speech-models")
      .then(setModels)
      .catch((e) => setError(String(e)));
  }, []);
  const operate = async (action: () => Promise<void>) => {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  if (!p) return null;
  const available = mode === "align" ? models.alignment : models.transcription;
  const chosen = available.some((m) => m.id === model)
    ? model
    : available[0]?.id;
  function editWord(
    cue: number,
    index: number,
    field: "text" | "start" | "end",
    value: string,
  ) {
    if (!p) return;
    const captions = p.captions.map((c, i) => {
      if (i !== cue) return c;
      const words = c.words!.map((w, j) =>
        j === index
          ? { ...w, [field]: field === "text" ? value : Number(value) }
          : w,
      );
      return {
        ...c,
        words,
        text: words.map((w) => w.text).join(" "),
        start: Math.min(c.start, words[0].start),
        end: Math.max(c.end, words.at(-1)!.end),
      };
    });
    onEdit({
      ...p,
      captions,
      captionTiming: {
        method: p.captionTiming?.method || "manual",
        reliable: p.captionTiming?.reliable || false,
        reviewed: false,
      },
    });
  }
  return (
    <section className="panel smart-panel">
      <div className="panel-heading">
        <h2>Smart editing</h2>
        <span>LOCAL · REVIEW BEFORE APPLYING</span>
      </div>
      {dirty && (
        <p className="notice">
          Save your edits before generating or accepting suggestions.
        </p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="smart-columns">
        <section>
          <h3>1. Script & captions</h3>
          <label>
            Caption source
            <select
              aria-label="Automatic caption method"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setModel("");
                setSpeech(null);
              }}
            >
              <option value="align">Align exact English script to audio</option>
              <option value="transcribe">
                Transcribe with offline Whisper
              </option>
            </select>
          </label>
          {mode === "align" && (
            <>
              <textarea
                aria-label="Narration script"
                placeholder="Paste the exact words spoken in the voiceover…"
                rows={5}
                maxLength={20000}
                value={script}
                onChange={(e) =>
                  onEdit({ ...p, narrationScript: e.target.value })
                }
              />
              <div className="actions">
                <button
                  onClick={() =>
                    onEdit({
                      ...p,
                      narrationScript: p.captions
                        .map((c) => c.text.replace(/\n/g, " "))
                        .join(" "),
                    })
                  }
                >
                  Use caption text
                </button>
                <label className="text-action">
                  Import script TXT
                  <input
                    aria-label="Import narration script"
                    type="file"
                    accept=".txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        void operate(async () => {
                          if (f.size > 20000)
                            throw Error("Script limit: 20 KB");
                          onEdit({ ...p, narrationScript: await f.text() });
                        });
                    }}
                  />
                </label>
              </div>
            </>
          )}
          {available.length ? (
            <label>
              Local model
              <select
                aria-label="Local speech model"
                value={chosen}
                onChange={(e) => setModel(e.target.value)}
              >
                {available.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted" role="status">
              No local {mode === "align" ? "alignment" : "Whisper"} model is
              installed. Manual SRT import still works. No model will be
              downloaded by this action.
            </p>
          )}
          <button
            disabled={
              busy || dirty || !chosen || (mode === "align" && !script.trim())
            }
            onClick={() =>
              void operate(async () => {
                setReviewed(false);
                setSpeech(
                  await api<Speech>(`projects/${doc.id}/speech`, {
                    revision: doc.revision,
                    mode,
                    script,
                    model: chosen,
                  }),
                );
              })
            }
          >
            {busy ? "Analyzing locally…" : "Generate caption suggestion"}
          </button>
          <details>
            <summary>Local model setup</summary>
            <p>
              Explicit small-model setup:{" "}
              <code>bash scripts/setup-alignment.sh</code>. For offline weights,
              use <code>python scripts/import-speech-model.py</code> as
              documented in README. Rendering never downloads speech models.
            </p>
            <button
              onClick={() =>
                void operate(async () => setModels(await api("speech-models")))
              }
            >
              Refresh model availability
            </button>
          </details>
          {speech && (
            <div className="suggestion">
              <b>{speech.captions.length} proposed captions</b>
              <p>
                {speech.provenance.method} ·{" "}
                {speech.reliable
                  ? "Timing structure passed checks"
                  : "Timing needs extra review"}
              </p>
              {speech.warnings.map((w) => (
                <p key={w} className="muted">
                  {w}
                </p>
              ))}
              <div className="speech-results">
                {speech.captions.map((c, i) => (
                  <p key={i}>
                    <time>
                      {c.start.toFixed(2)}–{c.end.toFixed(2)}
                    </time>{" "}
                    {c.text}
                  </p>
                ))}
              </div>
              <label className="approval">
                <input
                  type="checkbox"
                  aria-label="Reviewed generated word timing"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed the proposed text and word timings against the
                voiceover.
              </label>
              <button
                className="primary"
                disabled={busy || dirty || speech.revision !== doc.revision}
                onClick={() =>
                  void operate(async () => {
                    onApplied(
                      await api(`projects/${doc.id}/accept-speech`, {
                        revision: doc.revision,
                        suggestionId: speech.id,
                        reviewed,
                      }),
                    );
                    setSpeech(null);
                  })
                }
              >
                Apply caption suggestion
              </button>
            </div>
          )}
          <label>
            Caption preset
            <select
              aria-label="Caption preset"
              value={p.captionStyle || "classic"}
              onChange={(e) =>
                onEdit({
                  ...p,
                  captionStyle: e.target.value as ProjectData["captionStyle"],
                })
              }
            >
              <option value="classic">Documentary box</option>
              <option value="highlight">Spoken word underline</option>
              <option value="kinetic">Kinetic word emphasis</option>
              <option value="minimal">Minimal text</option>
            </select>
          </label>
          <p className="muted">
            Word effects require real word timestamps and reviewed timing.
            Otherwise the whole phrase is displayed.
          </p>
          {p.captions.some((c) => c.words?.length) && (
            <details>
              <summary>Edit every word and timestamp</summary>
              <label className="approval">
                <input
                  aria-label="Confirm manually verified words"
                  type="checkbox"
                  checked={Boolean(
                    p.captionTiming?.reviewed && p.captionTiming.reliable,
                  )}
                  onChange={(e) =>
                    onEdit({
                      ...p,
                      captionTiming: {
                        method: p.captionTiming?.method || "manual",
                        reliable: e.target.checked,
                        reviewed: e.target.checked,
                      },
                    })
                  }
                />{" "}
                I listened to and verified these word timings.
              </label>
              {p.captions.map((c, i) =>
                c.words?.map((w, j) => (
                  <div className="word-row" key={`${i}-${j}`}>
                    <input
                      aria-label={`Word ${i + 1}-${j + 1} text`}
                      value={w.text}
                      onChange={(e) => editWord(i, j, "text", e.target.value)}
                    />
                    <input
                      aria-label={`Word ${i + 1}-${j + 1} start`}
                      type="number"
                      step={0.01}
                      value={w.start}
                      onChange={(e) => editWord(i, j, "start", e.target.value)}
                    />
                    <input
                      aria-label={`Word ${i + 1}-${j + 1} end`}
                      type="number"
                      step={0.01}
                      value={w.end}
                      onChange={(e) => editWord(i, j, "end", e.target.value)}
                    />
                  </div>
                )),
              )}
            </details>
          )}
        </section>
        <section>
          <h3>2. Story rhythm & camera</h3>
          <p className="muted">
            Suggest cuts at sentence/phrase boundaries and narration pauses.
            Motion varies across scenes using narrative keywords, not image
            recognition.
          </p>
          <button
            disabled={dirty || busy}
            onClick={() =>
              void operate(async () =>
                setSuggestion(
                  await api(`projects/${doc.id}/suggest-edit`, {
                    revision: doc.revision,
                  }),
                ),
              )
            }
          >
            Suggest scene timing & motion
          </button>
          {suggestion && (
            <div className="suggestion">
              <table>
                <thead>
                  <tr>
                    <th>Shot</th>
                    <th>Current</th>
                    <th>Proposed</th>
                    <th>Motion</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestion.changes.map((c) => (
                    <tr key={c.scene}>
                      <td>{c.scene}</td>
                      <td>{c.before.toFixed(2)}s</td>
                      <td>{c.after.toFixed(2)}s</td>
                      <td>{c.motion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul>
                {suggestion.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <button
                className="primary"
                disabled={dirty || busy || suggestion.revision !== doc.revision}
                onClick={() =>
                  void operate(async () => {
                    onApplied(
                      await api(`projects/${doc.id}/accept-edit`, {
                        revision: doc.revision,
                      }),
                    );
                    setSuggestion(null);
                  })
                }
              >
                Accept suggested timing & motion
              </button>
            </div>
          )}
          <h3>3. Sound design</h3>
          <p className="muted">
            Use audio you own or have licensed. Each layer is level-limited from
            measured audio peaks and ducked under narration. Effects are off
            until enabled.
          </p>
          <div className="two-cols">
            <label>
              Category
              <select
                aria-label="Sound category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {["whoosh", "impact", "riser", "stadium", "music"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              License
              <select
                aria-label="Sound license"
                value={license}
                onChange={(e) => setLicense(e.target.value)}
              >
                {["Original", "CC0", "CC BY 4.0", "Licensed"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Attribution / source
            <input
              aria-label="Sound attribution"
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
            />
          </label>
          <label className="upload-zone">
            Import licensed sound
            <input
              aria-label="Upload sound layer"
              type="file"
              accept=".mp3,.wav"
              disabled={busy || dirty}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void operate(async () => {
                    const form = new FormData();
                    form.set("files", file);
                    form.set("revision", String(doc.revision));
                    form.set("soundCategory", category);
                    form.set("license", license);
                    form.set("attribution", attribution);
                    onApplied(await api(`projects/${doc.id}/upload`, form));
                  });
                e.target.value = "";
              }}
            />
          </label>
          {doc.assets
            .filter((a) => a.kind === "sound")
            .map((a) => (
              <div className="sound-asset" key={a.id}>
                <b>{a.name}</b>
                <small>
                  {a.category} · {a.license}
                </small>
                <audio controls preload="none" src={"/" + a.path} />
                <button
                  disabled={(p.soundLayers?.length || 0) >= 8}
                  onClick={() =>
                    onEdit({
                      ...p,
                      soundLayers: [
                        ...(p.soundLayers || []),
                        {
                          id: crypto.randomUUID(),
                          asset: a.path,
                          category: a.category!,
                          license: a.license!,
                          attribution: a.attribution,
                          start: 0,
                          duration: Math.min(a.duration!, p.duration),
                          enabled: false,
                          loop: false,
                          volume: 0.1,
                          sourceDuration: a.duration!,
                          sourcePeak: a.peak!,
                          narrationRms:
                            doc.assets.find((x) => x.path === p.audio)?.rms ||
                            0.001,
                        },
                      ],
                    })
                  }
                >
                  Add to timeline (disabled)
                </button>
              </div>
            ))}
          {(p.soundLayers || []).map((l, i) => {
            const patch = (value: Partial<typeof l>) =>
              onEdit({
                ...p,
                soundLayers: p.soundLayers!.map((v, j) =>
                  i === j ? { ...v, ...value } : v,
                ),
              });
            return (
              <div className="sound-edit" key={l.id}>
                <label className="approval">
                  <input
                    type="checkbox"
                    aria-label={`Enable sound ${i + 1}`}
                    checked={l.enabled}
                    onChange={(e) => patch({ enabled: e.target.checked })}
                  />
                  {l.category} · {l.license}
                </label>
                <div className="two-cols">
                  <label>
                    Start
                    <input
                      aria-label={`Sound ${i + 1} start`}
                      type="number"
                      min={0}
                      step={0.1}
                      value={l.start}
                      onChange={(e) => patch({ start: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Duration
                    <input
                      aria-label={`Sound ${i + 1} duration`}
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={l.duration}
                      onChange={(e) =>
                        patch({ duration: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
                <label>
                  Level (safety cap still applies)
                  <input
                    aria-label={`Sound ${i + 1} volume`}
                    type="range"
                    min={0}
                    max={0.18}
                    step={0.01}
                    value={l.volume}
                    onChange={(e) => patch({ volume: Number(e.target.value) })}
                  />
                </label>
                <label className="approval">
                  <input
                    type="checkbox"
                    aria-label={`Loop sound ${i + 1}`}
                    checked={l.loop}
                    onChange={(e) => patch({ loop: e.target.checked })}
                  />
                  Loop source
                </label>
                <button
                  onClick={() =>
                    onEdit({
                      ...p,
                      soundLayers: p.soundLayers!.filter((_, j) => i !== j),
                    })
                  }
                >
                  Remove layer
                </button>
              </div>
            );
          })}
        </section>
      </div>
    </section>
  );
}
