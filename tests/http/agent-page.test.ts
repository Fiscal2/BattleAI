import { describe, expect, it } from "vitest";
import { agentEditor } from "../../src/http/agent-page.ts";

const emptyAgent = { persona: "", playbook: "", context: "" };
const fieldNames = ["persona", "playbook", "context"] as const;

function textareas(html: string) {
  return [...html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)].map((match) => ({
    attributes: Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]])),
    value: match[2],
  }));
}

describe("agent editor", () => {
  it("returns a body with the existing editor classes and a native save form", () => {
    const html = agentEditor(emptyAgent);
    expect(html).toContain('<h1 class="page-title">Agent</h1>');
    expect(html).toContain('<div class="editor-layout">');
    expect(html).toContain('<form class="panel form" method="post" action="/agent">');
    expect(html).toContain('<aside class="coaching-guide" aria-label="Coaching guide">');
    expect([...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((match) => match[1])).toEqual(["Save agent"]);
    expect(html).not.toMatch(/<!doctype|<html\b|<script\b|\son\w+=/i);
  });

  it.each(fieldNames)("escapes %s so saved text cannot close its textarea or inject markup", (name) => {
    const value = '</textarea><script>alert("coach" & \'agent\')</script><textarea> &lt;b&gt;';
    const html = agentEditor({ ...emptyAgent, [name]: value });
    const fields = textareas(html);
    expect(fields).toHaveLength(3);
    expect(fields.find((field) => field.attributes.name === name)?.value).toBe(
      "&lt;/textarea&gt;&lt;script&gt;alert(&quot;coach&quot; &amp; &#39;agent&#39;)&lt;/script&gt;&lt;textarea&gt; &amp;lt;b&amp;gt;",
    );
    expect(html).not.toContain("<script>");
  });

  it("associates each visible label, description and explicit example with its textarea", () => {
    const html = agentEditor(emptyAgent);
    const fields = textareas(html);
    expect(fields.map((field) => field.attributes.name)).toEqual(fieldNames);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of fields) {
      const id = field.attributes.id;
      const name = field.attributes.name;
      const label = name[0].toUpperCase() + name.slice(1);
      expect(html).toContain(`<label class="field" for="${id}"><span class="label-caps">${label}</span>`);
      const references = field.attributes["aria-describedby"].split(" ");
      expect(references).toHaveLength(2);
      const [description, example] = references.map((reference) => {
        expect(ids).toContain(reference);
        return html.match(new RegExp(`<span id="${reference}">([^<]+)</span>`))?.[1];
      });
      expect(description).toBeTruthy();
      expect(example).toMatch(/^Example: .+/);
      expect(field.attributes).not.toHaveProperty("placeholder");
      expect(field.attributes).not.toHaveProperty("required");
    }
  });

  it.each([false, true])("preserves empty and saved values when saved is %s", (saved) => {
    const agent = { persona: "  Calm\nStay focused.  ", playbook: "", context: "Watch columns 1–7.\n\nReview later." };
    expect(textareas(agentEditor(agent, saved)).map((field) => field.value)).toEqual(Object.values(agent));
    expect(textareas(agentEditor(emptyAgent, saved)).map((field) => field.value)).toEqual(["", "", ""]);
    expect(agent).toEqual({ persona: "  Calm\nStay focused.  ", playbook: "", context: "Watch columns 1–7.\n\nReview later." });
  });

  it("only announces save success when main passes the saved flag", () => {
    expect(agentEditor(emptyAgent)).not.toContain('role="status"');
    expect(agentEditor(emptyAgent, false)).not.toContain("Agent saved.");
    expect(agentEditor(emptyAgent, true)).toContain('<p class="body" role="status">Agent saved.</p>');
    expect(agentEditor(emptyAgent, true)).toContain("Changes apply to future matches.");
  });

  it("explains supplied position, Fleet placement, prior results and manual public coaching", () => {
    const html = agentEditor(emptyAgent);
    expect(html).toContain("current position and legal moves are supplied automatically");
    expect(html).toContain("placement instructions instead of a legal move list");
    expect(html).toContain("Up to 10 prior result lines are already included");
    expect(html).toContain("Manually add lessons from matches you watched and goals");
    expect(html).toContain("update it yourself");
    expect(html).toContain("Both coaching snapshots are public on the match page");
    expect(html).toContain("Do not include private information or secrets");
    expect(html).toContain("All fields are optional");
    expect(html).not.toMatch(/rules.{0,40}(supplied|provided) automatically/i);
  });

  it("provides all four rule-specific examples in one collapsed native details section", () => {
    const html = agentEditor(emptyAgent);
    expect([...html.matchAll(/<details\b/g)]).toHaveLength(1);
    const details = html.match(/<details>([\s\S]*?)<\/details>/)?.[1];
    expect(details).toBeDefined();
    expect(details).toContain("<summary>Example tactics for each game</summary>");
    const tactics = [...details!.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/g)];
    expect(tactics.map((match) => match[1])).toEqual(["Tic-tac-toe", "Four", "Checkers", "Fleet"]);
    expect(tactics[0][2]).toMatch(/three-in-a-row.*block.*center.*fork/);
    expect(tactics[1][2]).toMatch(/lowest open row.*four in a row.*block.*above/);
    expect(tactics[2][2]).toMatch(/Captures are mandatory.*complete legal capture paths.*Men move and capture forward.*king row ends/);
    expect(tactics[3][2]).toMatch(/5, 4, 3, 3, and 2.*horizontal or vertical.*without overlap; ships may touch.*row or column.*revealed information/);
  });
});
