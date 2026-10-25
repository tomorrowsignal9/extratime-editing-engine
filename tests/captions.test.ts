import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Captions } from "../src/engine/Captions";
import { Project } from "../src/engine/schema";
const p = Project.parse(
  JSON.parse(readFileSync("docs/episode-001.manifest.json", "utf8")),
);
// Synthetic timing fixture for component behavior, not an audio-alignment result.
p.captions = [
  {
    text: "Lev Yashin",
    start: 1,
    end: 2,
    words: [
      { text: "Lev", start: 1, end: 1.5 },
      { text: "Yashin", start: 1.5, end: 2 },
    ],
  },
];
const render = (frame: number) =>
  renderToStaticMarkup(React.createElement(Captions, { project: p, frame }));
test("all caption presets use actual words only after timing review", () => {
  for (const style of ["classic", "minimal", "highlight", "kinetic"] as const) {
    p.captionStyle = style;
    p.captionTiming = {
      method: "synthetic-test",
      reliable: true,
      reviewed: false,
    };
    assert.ok(!render(32).includes('data-spoken="true"'));
    p.captionTiming.reviewed = true;
    if (style === "highlight" || style === "kinetic") {
      assert.ok(render(32).includes('data-spoken="true"'));
      assert.match(render(47), /data-spoken="true"[^>]*>Yashin/);
    }
    assert.equal(render(29), "");
    assert.equal(render(60), "");
    p.captionTiming.reliable = false;
    assert.ok(!render(32).includes('data-spoken="true"'));
  }
});
