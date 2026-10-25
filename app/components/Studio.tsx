"use client";
/* Local editor: one manifest is passed to both the Remotion Player and render snapshots. */
/* eslint-disable @next/next/no-img-element */
import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { StudioProject, Job } from "../../src/studio/types";
import { Project, type ProjectData } from "../../src/engine/schema";
import { resizeScene, preset } from "../../src/studio/timeline";
const Preview = dynamic(() => import("./Preview"), {
  ssr: false,
  loading: () => <p>Loading preview…</p>,
});
async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api/studio/" + url, {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : body
          ? { "Content-Type": "application/json" }
          : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const result = await res.json();
  if (!res.ok) throw Error(result.error || "Request failed");
  return result;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function Studio() {
  const [projects, setProjects] = useState<StudioProject[]>([]),
    [sample, setSample] = useState(false),
    [doc, setDoc] = useState<StudioProject | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [title, setTitle] = useState(""),
    [selected, setSelected] = useState(0),
    [renderJobs, setJobs] = useState<Job[]>([]),
    [approved, setApproved] = useState(false),
    [showTrash, setShowTrash] = useState(false),
    [diagnostics, setDiagnostics] = useState("");
  const drag = useRef<number | null>(null);
  const p = doc?.manifest;
  const refresh = useCallback(async () => {
    const result = await request<{
      projects: StudioProject[];
      sampleAvailable: boolean;
    }>("projects");
    setProjects(result.projects);
    setSample(result.sampleAvailable);
  }, []);
  useEffect(() => {
    void request<{ projects: StudioProject[]; sampleAvailable: boolean }>(
      "projects",
    )
      .then((result) => {
        setProjects(result.projects);
        setSample(result.sampleAvailable);
      })
      .catch((e) => setError(message(e)));
    let stopped = false;
    const poll = async () => {
      try {
        const jobs = await request<Job[]>("jobs");
        if (!stopped) setJobs(jobs);
      } catch (e) {
        if (!stopped) setError(message(e));
      }
    };
    void poll();
    const timer = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  const operate = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const accept = (next: StudioProject) => {
    setDoc(next);
    setDirty(false);
    setApproved(false);
    setSelected(0);
    localStorage.removeItem("extratime-draft-" + next.id);
  };
  const change = (next: StudioProject) => {
    setDoc(next);
    setDirty(true);
    setApproved(false);
    localStorage.setItem("extratime-draft-" + next.id, JSON.stringify(next));
  };
  const changeManifest = (next: ProjectData) => {
    if (doc) change({ ...doc, manifest: { ...next, approved: false } });
  };
  const leave = () =>
    !dirty ||
    confirm(
      "You have unsaved changes. Leave this project? Your draft can be recovered when reopening.",
    );
  const openProject = (key: string) => {
    if (!leave()) return;
    void operate(async () => {
      const next = await request<StudioProject>("projects/" + key);
      setDoc(next);
      setSelected(0);
      setApproved(false);
      setDirty(false);
      const cached = localStorage.getItem("extratime-draft-" + key);
      if (cached) {
        const draft = JSON.parse(cached) as StudioProject;
        if (
          draft.revision === next.revision &&
          confirm("Recover unsaved edits for this project?")
        ) {
          setDoc(draft);
          setDirty(true);
        } else if (draft.revision !== next.revision)
          setNotice(
            "An older local draft was not applied because this project changed in another tab.",
          );
      }
    });
  };
  const save = async () => {
    if (!doc) return;
    const next = await request<StudioProject>("projects/" + doc.id, "PUT", {
      revision: doc.revision,
      title: doc.title,
      manifest: doc.manifest,
    });
    accept(next);
    await refresh();
    setNotice("Project saved locally.");
    return next;
  };
  const upload = (files: FileList | null, replace?: string) => {
    if (!doc || !files?.length) return;
    void operate(async () => {
      let current = doc;
      if (dirty) current = (await save())!;
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("files", file));
      form.set("revision", String(current.revision));
      if (replace) form.set("replace", replace);
      accept(
        await request<StudioProject>(`projects/${doc.id}/upload`, "POST", form),
      );
      await refresh();
      setNotice("Assets imported. Timeline matches the full voiceover.");
    });
  };
  const reorder = (from: number, to: number) => {
    if (!p || to < 0 || to >= p.scenes.length) return;
    const scenes = [...p.scenes];
    const [item] = scenes.splice(from, 1);
    scenes.splice(to, 0, item);
    changeManifest({ ...p, scenes });
    setSelected(to);
  };
  const updateScene = (patch: Partial<ProjectData["scenes"][number]>) => {
    if (p)
      changeManifest({
        ...p,
        scenes: p.scenes.map((s, i) =>
          i === selected ? { ...s, ...patch } : s,
        ),
      });
  };
  const active = renderJobs.find((j) =>
    ["queued", "running", "verifying"].includes(j.status),
  );
  const currentScene = p?.scenes[selected];
  const validation = p ? Project.safeParse({ ...p, title: doc?.title }) : null;
  return (
    <div className="studio">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            if (leave()) {
              setDoc(null);
              setDirty(false);
            }
          }}
        >
          <span className="brand-icon">ET</span>
          <span>
            EXTRATIME<small>STUDIO</small>
          </span>
        </button>
        <div className="workspace-label">
          LOCAL WORKSPACE <span className="status-dot" />
        </div>
        <button
          className="nav active"
          onClick={() => {
            if (leave()) {
              setDoc(null);
              setDirty(false);
            }
          }}
        >
          ▦ &nbsp; Projects{" "}
          <span>{projects.filter((p) => !p.deletedAt).length}</span>
        </button>
        <button
          className="nav"
          onClick={() =>
            document
              .getElementById("exports")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          ↗ &nbsp; Exports <span>{renderJobs.length}</span>
        </button>
        <div className="sidebar-heading">YOUR PROJECTS</div>
        <div className="project-nav">
          {projects
            .filter((p) => !p.deletedAt)
            .map((project) => (
              <button
                key={project.id}
                className={doc?.id === project.id ? "selected" : ""}
                onClick={() => openProject(project.id)}
              >
                {project.title}
                <small>
                  {project.manifest?.duration.toFixed(1) || "—"}s ·{" "}
                  {project.assets.filter((a) => a.kind === "image").length}{" "}
                  images
                </small>
              </button>
            ))}
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Local-first. Yours to keep.
          <p>Media and renders stay on this machine.</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            WORKSPACE <b>/ {doc ? "Editor" : "Projects"}</b>
          </span>
          <span className="badge">1080 × 1920 · 30 FPS</span>
        </header>
        {error && (
          <div role="alert" className="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {!doc ? (
          <>
            <section className="page-heading">
              <div className="eyebrow">THE NEXT STORY STARTS HERE</div>
              <h1>Your editing room.</h1>
              <p>Turn football stories into shorts worth watching.</p>
            </section>
            <section className="create-panel">
              <div>
                <h2>Create a project</h2>
                <p>Start with your images, voiceover and subtitles.</p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void operate(async () => {
                    const next = await request<StudioProject>(
                      "projects",
                      "POST",
                      { title },
                    );
                    accept(next);
                    setTitle("");
                    await refresh();
                  });
                }}
              >
                <input
                  aria-label="New project title"
                  placeholder="Give your next story a title"
                  required
                  maxLength={150}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <button className="primary" disabled={busy || !title.trim()}>
                  ＋ New project
                </button>
              </form>
            </section>
            <div className="section-title">
              <h2>
                {showTrash ? "Recently deleted" : "Projects"}{" "}
                <span>
                  {
                    projects.filter((p) => Boolean(p.deletedAt) === showTrash)
                      .length
                  }
                </span>
              </h2>
              <div className="actions">
                {sample && !showTrash && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void operate(async () => {
                        accept(
                          await request<StudioProject>("sample", "POST", {}),
                        );
                        await refresh();
                      })
                    }
                  >
                    Import Episode 001
                  </button>
                )}
                <button onClick={() => setShowTrash(!showTrash)}>
                  {showTrash ? "Back to projects" : "Trash"}
                </button>
              </div>
            </div>
            <div className="project-grid">
              {projects
                .filter((p) => Boolean(p.deletedAt) === showTrash)
                .map((project) => (
                  <article key={project.id} className="project-card">
                    {project.assets.find((a) => a.kind === "image") ? (
                      <img
                        alt=""
                        src={
                          "/" +
                          (project.assets.find((a) => a.kind === "image")!
                            .thumbnail ||
                            project.assets.find((a) => a.kind === "image")!
                              .path)
                        }
                      />
                    ) : (
                      <div className="empty-thumb">
                        ET<span>YOUR NEXT STORY</span>
                      </div>
                    )}
                    <div className="project-card-body">
                      <span className="eyebrow">
                        {project.manifest ? "READY TO EDIT" : "ADD YOUR ASSETS"}
                      </span>
                      <h3>{project.title}</h3>
                      <p>
                        {project.manifest?.duration.toFixed(2) || "0.00"}s ·{" "}
                        {
                          project.assets.filter((a) => a.kind === "image")
                            .length
                        }{" "}
                        scenes
                      </p>
                      <button
                        className="wide"
                        onClick={() =>
                          showTrash
                            ? void operate(async () => {
                                await request(
                                  `projects/${project.id}/restore`,
                                  "POST",
                                  {},
                                );
                                await refresh();
                              })
                            : openProject(project.id)
                        }
                      >
                        {showTrash ? "Restore project" : "Open editor →"}
                      </button>
                    </div>
                  </article>
                ))}
            </div>
            {!projects.filter((p) => Boolean(p.deletedAt) === showTrash)
              .length && (
              <div className="empty-state">
                {showTrash
                  ? "Trash is empty."
                  : "Your first story belongs here. Create a project to get started."}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="editor-heading">
              <div>
                <div className="eyebrow">PROJECT / EDITOR</div>
                <input
                  className="title-input"
                  aria-label="Project title"
                  maxLength={150}
                  value={doc.title}
                  onChange={(e) =>
                    change({
                      ...doc,
                      title: e.target.value,
                      manifest: p ? { ...p, title: e.target.value } : null,
                    })
                  }
                />
                <span className={dirty ? "unsaved" : "muted"}>
                  {dirty ? "● Unsaved changes" : "✓ Saved locally"} · revision{" "}
                  {doc.revision}
                </span>
              </div>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void operate(async () => {
                      if (
                        !confirm(
                          "Move this project to Trash? Media is kept locally and can be restored.",
                        )
                      )
                        return;
                      await request("projects/" + doc.id, "DELETE");
                      localStorage.removeItem("extratime-draft-" + doc.id);
                      setDoc(null);
                      setDirty(false);
                      await refresh();
                    })
                  }
                >
                  Move to trash
                </button>
                <button
                  className="primary"
                  disabled={
                    busy || !dirty || Boolean(validation && !validation.success)
                  }
                  onClick={() =>
                    void operate(async () => {
                      await save();
                    })
                  }
                >
                  {busy ? "Working…" : "Save project"}
                </button>
              </div>
            </div>
            <div className="editor-grid">
              <section className="panel asset-panel">
                <div className="panel-heading">
                  <h2>Media library</h2>
                  <span>{doc.assets.length}</span>
                </div>
                <label className="upload-zone">
                  ＋ Import media
                  <input
                    aria-label="Upload media"
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.mp3,.wav,.srt"
                    disabled={busy}
                    onChange={(e) => {
                      upload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <small>
                    Images · Voiceover · SRT
                    <br />
                    20 MB / image · 80 MB / audio · 1 MB / SRT
                  </small>
                </label>
                <div className="asset-list">
                  {doc.assets.map((a) => (
                    <div className="asset" key={a.id}>
                      {a.kind === "image" ? (
                        <img src={"/" + (a.thumbnail || a.path)} alt={a.name} />
                      ) : (
                        <span className="asset-icon">
                          {a.kind === "audio" ? "♫" : "CC"}
                        </span>
                      )}
                      <div>
                        <b title={a.name}>{a.name}</b>
                        <small>
                          {a.kind === "image"
                            ? `${a.width} × ${a.height}`
                            : a.duration
                              ? `${a.duration.toFixed(3)}s`
                              : "Subtitle file"}
                        </small>
                        {a.kind === "image" && (
                          <label className="text-action">
                            Replace
                            <input
                              type="file"
                              aria-label={"Replace " + a.name}
                              accept=".jpg,.jpeg,.png,.webp"
                              disabled={busy}
                              onChange={(e) => upload(e.target.files, a.id)}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!doc.assets.length && (
                  <p className="muted">
                    Import images and a voiceover to create your timeline. Then
                    add an SRT.
                  </p>
                )}
              </section>
              <section className="panel preview-panel">
                <div className="panel-heading">
                  <h2>Program preview</h2>
                  <span className="badge">9:16</span>
                </div>
                {p ? (
                  <Preview key={doc.id} project={p} />
                ) : (
                  <div className="preview-empty">
                    <span>↗</span>
                    <h3>Your story, in motion.</h3>
                    <p>Add at least one image and a voiceover to preview.</p>
                  </div>
                )}
                <p className="preview-note">
                  Same composition. Same timing. Preview pauses when hidden.
                </p>
              </section>
              <section className="panel inspector">
                <div className="panel-heading">
                  <h2>Inspector</h2>
                  <span>
                    {p ? `SHOT ${String(selected + 1).padStart(2, "0")}` : "—"}
                  </span>
                </div>
                {p && currentScene ? (
                  <>
                    <label>
                      Editing preset
                      <select
                        aria-label="Editing preset"
                        value={p.preset}
                        onChange={(e) =>
                          changeManifest(
                            preset(p, e.target.value as ProjectData["preset"]),
                          )
                        }
                      >
                        <option value="Documentary">
                          Football Documentary
                        </option>
                        <option>Fast Viral</option>
                        <option>Legendary Stories</option>
                      </select>
                    </label>
                    <hr />
                    <h3>Camera</h3>
                    <label>
                      Movement
                      <select
                        aria-label="Camera movement"
                        value={currentScene.motion}
                        onChange={(e) =>
                          updateScene({
                            motion: e.target
                              .value as typeof currentScene.motion,
                          })
                        }
                      >
                        <option value="push">Slow push</option>
                        <option value="pull">Pull back</option>
                        <option value="pan">Pan</option>
                        <option value="punch">Punch in</option>
                      </select>
                    </label>
                    <label>
                      Zoom intensity{" "}
                      <output>
                        {Math.round(currentScene.strength * 100)}%
                      </output>
                      <input
                        aria-label="Zoom intensity"
                        type="range"
                        min={0}
                        max={0.4}
                        step={0.01}
                        value={currentScene.strength}
                        onChange={(e) =>
                          updateScene({ strength: Number(e.target.value) })
                        }
                      />
                    </label>
                    {currentScene.motion === "pan" && (
                      <label>
                        Pan direction
                        <select
                          aria-label="Pan direction"
                          value={currentScene.panDirection || "right"}
                          onChange={(e) =>
                            updateScene({
                              panDirection: e.target.value as "left" | "right",
                            })
                          }
                        >
                          <option value="right">Left to right</option>
                          <option value="left">Right to left</option>
                        </select>
                      </label>
                    )}
                    <div className="two-cols">
                      <label>
                        Focus X
                        <input
                          aria-label="Focus X"
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={currentScene.focalX}
                          onChange={(e) =>
                            updateScene({ focalX: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label>
                        Focus Y
                        <input
                          aria-label="Focus Y"
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={currentScene.focalY}
                          onChange={(e) =>
                            updateScene({ focalY: Number(e.target.value) })
                          }
                        />
                      </label>
                    </div>
                    <hr />
                    <h3>Transition</h3>
                    <label>
                      Type
                      <select
                        aria-label="Transition type"
                        value={currentScene.transition}
                        onChange={(e) =>
                          updateScene({
                            transition: e.target
                              .value as typeof currentScene.transition,
                          })
                        }
                      >
                        <option value="cut">Cut</option>
                        <option value="fade">Crossfade</option>
                        <option value="slide">Slide</option>
                      </select>
                    </label>
                    {currentScene.transition !== "cut" && (
                      <label>
                        Duration (seconds)
                        <input
                          aria-label="Transition duration"
                          type="number"
                          min={0}
                          max={0.8}
                          step={0.033}
                          value={
                            currentScene.transitionDuration ??
                            (currentScene.transition === "fade"
                              ? 7 / 30
                              : 8 / 30)
                          }
                          onChange={(e) =>
                            updateScene({
                              transitionDuration: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    )}
                    <hr />
                    <h3>Subtitles</h3>
                    <label>
                      Vertical position <output>{p.captionY}%</output>
                      <input
                        aria-label="Caption position"
                        type="range"
                        min={30}
                        max={80}
                        value={p.captionY}
                        onChange={(e) =>
                          changeManifest({
                            ...p,
                            captionY: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <div className="two-cols">
                      <label>
                        Text color
                        <input
                          aria-label="Caption color"
                          type="color"
                          value={p.captionColor}
                          onChange={(e) =>
                            changeManifest({
                              ...p,
                              captionColor: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Font size
                        <input
                          aria-label="Caption font size"
                          type="number"
                          min={28}
                          max={64}
                          value={p.captionFontSize ?? 42}
                          onChange={(e) =>
                            changeManifest({
                              ...p,
                              captionFontSize: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    Your scene controls appear when the timeline is ready.
                  </p>
                )}
              </section>
            </div>
            {p && (
              <section className="panel timeline">
                <div className="panel-heading">
                  <h2>Timeline</h2>
                  <span>
                    {p.scenes.length} scenes · {p.duration.toFixed(2)} seconds
                  </span>
                </div>
                <p className="muted">
                  Drag scenes to reorder. Duration changes borrow from the next
                  scene (the previous scene for the last shot), keeping the full
                  narration.
                </p>
                <div className="scene-track">
                  {p.scenes.map((s, i) => (
                    <div
                      draggable
                      key={i}
                      data-testid={"scene-" + i}
                      onDragStart={() => {
                        drag.current = i;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (drag.current !== null) reorder(drag.current, i);
                        drag.current = null;
                      }}
                      className={
                        "scene-card " + (selected === i ? "selected" : "")
                      }
                      onClick={() => setSelected(i)}
                    >
                      <img
                        src={
                          "/" +
                          (doc.assets.find((a) => a.path === s.asset)
                            ?.thumbnail || s.asset)
                        }
                        alt={"Scene " + (i + 1)}
                      />
                      <b>
                        {String(i + 1).padStart(2, "0")} · {s.motion}
                      </b>
                      <label>
                        Seconds
                        <input
                          aria-label={"Scene " + (i + 1) + " duration"}
                          type="number"
                          min={0.2}
                          step={1 / 30}
                          value={Number(s.duration.toFixed(3))}
                          onChange={(e) => {
                            try {
                              changeManifest(
                                resizeScene(p, i, Number(e.target.value)),
                              );
                              setError("");
                            } catch (error) {
                              setError(message(error));
                            }
                          }}
                        />
                      </label>
                      <div className="actions">
                        <button
                          aria-label={"Move scene " + (i + 1) + " earlier"}
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            reorder(i, i - 1);
                          }}
                        >
                          ←
                        </button>
                        <button
                          aria-label={"Move scene " + (i + 1) + " later"}
                          disabled={i === p.scenes.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            reorder(i, i + 1);
                          }}
                        >
                          →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="audio-track">
                  <b>♫ VOICEOVER</b>
                  <span>
                    {doc.assets.find((a) => a.path === p.audio)?.name}
                  </span>
                  <span>{p.duration.toFixed(2)}s · full audio</span>
                </div>
                <audio
                  controls
                  preload="metadata"
                  src={"/" + p.audio}
                  aria-label="Original voiceover"
                />
                <div className="caption-track">
                  {p.captions.map((c, i) => (
                    <span
                      title={c.text}
                      key={i}
                      style={{
                        left: `${(c.start / p.duration) * 100}%`,
                        width: `${((c.end - c.start) / p.duration) * 100}%`,
                      }}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
                <details>
                  <summary>Edit subtitles ({p.captions.length} cues)</summary>
                  {!p.captions.length && (
                    <p>Import an SRT using the media library before export.</p>
                  )}
                  {p.captions.map((c, i) => (
                    <div className="caption-row" key={i}>
                      <b>{i + 1}</b>
                      <label>
                        Start
                        <input
                          aria-label={"Caption " + (i + 1) + " start"}
                          type="number"
                          step={0.001}
                          min={0}
                          value={c.start}
                          onChange={(e) =>
                            changeManifest({
                              ...p,
                              captions: p.captions.map((v, j) =>
                                i === j
                                  ? { ...v, start: Number(e.target.value) }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        End
                        <input
                          aria-label={"Caption " + (i + 1) + " end"}
                          type="number"
                          step={0.001}
                          value={c.end}
                          onChange={(e) =>
                            changeManifest({
                              ...p,
                              captions: p.captions.map((v, j) =>
                                i === j
                                  ? { ...v, end: Number(e.target.value) }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                      <textarea
                        aria-label={"Caption " + (i + 1) + " text"}
                        value={c.text}
                        onChange={(e) =>
                          changeManifest({
                            ...p,
                            captions: p.captions.map((v, j) =>
                              i === j ? { ...v, text: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </details>
                {validation && !validation.success && (
                  <p role="alert" className="alert">
                    {validation.error.issues.map((i) => i.message).join("; ")}
                  </p>
                )}
              </section>
            )}
            <section className="export-panel">
              <div>
                <div className="eyebrow">READY FOR THE FINAL CUT?</div>
                <h2>Export your story.</h2>
                <p>H.264 MP4 · 1080 × 1920 · 30 FPS · AAC audio</p>
              </div>
              <div>
                <label className="approval">
                  <input
                    type="checkbox"
                    aria-label="Approve export"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />{" "}
                  I reviewed the preview, captions, timing and rights to this
                  media.
                </label>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !!active ||
                    !p ||
                    dirty ||
                    !approved ||
                    !p?.captions.length ||
                    Boolean(validation && !validation.success)
                  }
                  onClick={() =>
                    void operate(async () => {
                      const job = await request<Job>("jobs", "POST", {
                        projectId: doc.id,
                        revision: doc.revision,
                        approved,
                      });
                      setJobs([job, ...renderJobs]);
                      setApproved(false);
                      setNotice(
                        "Rendering started. You can keep editing; this export uses the saved snapshot.",
                      );
                      document
                        .getElementById("exports")
                        ?.scrollIntoView({ behavior: "smooth" });
                    })
                  }
                >
                  {active
                    ? "Render in progress…"
                    : dirty
                      ? "Save changes before exporting"
                      : "↗ Export MP4"}
                </button>
              </div>
            </section>
          </>
        )}
        <section id="exports" className="exports">
          <div className="section-title">
            <h2>Exports</h2>
            <span className="muted">One local render at a time</span>
          </div>
          {!renderJobs.length && (
            <p className="muted">Your completed videos will appear here.</p>
          )}
          {renderJobs.map((job) => (
            <article className="job" key={job.id}>
              <div>
                <b>{job.title}</b>
                <small>
                  Revision {job.revision} ·{" "}
                  {new Date(job.createdAt).toLocaleString()} · {job.status}{" "}
                  {["running", "verifying"].includes(job.status)
                    ? `· ${job.progress}%`
                    : ""}
                </small>
                {["queued", "running", "verifying"].includes(job.status) && (
                  <progress max={100} value={job.progress} />
                )}{" "}
                {job.error && <p role="alert">{job.error}</p>}
              </div>
              <div className="actions">
                {job.status === "succeeded" && (
                  <a
                    className="button primary"
                    href={`/api/studio/jobs/${job.id}/download`}
                    download
                  >
                    Download MP4
                  </a>
                )}
                {["queued", "running", "verifying"].includes(job.status) && (
                  <button
                    onClick={() =>
                      void operate(async () => {
                        await request(`jobs/${job.id}/cancel`, "POST", {});
                      })
                    }
                  >
                    Cancel render
                  </button>
                )}
                <button
                  onClick={() =>
                    void operate(async () =>
                      setDiagnostics(
                        (await request<{ log: string }>(`jobs/${job.id}/log`))
                          .log,
                      ),
                    )
                  }
                >
                  Diagnostics
                </button>
              </div>
            </article>
          ))}
          {diagnostics && (
            <div className="diagnostics">
              <button onClick={() => setDiagnostics("")}>
                Close diagnostics
              </button>
              <pre>{diagnostics}</pre>
            </div>
          )}
        </section>
        <footer>
          EXTRATIME STUDIO <span>Built for the stories behind the game.</span>
        </footer>
      </main>
    </div>
  );
}
