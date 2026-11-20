#!/usr/bin/env node
/**
 * CSP-Prüfung gegen den Produktions-Build (rsg-shared ≥ v0.5.1).
 *
 * Die e2e laufen unter `next dev`. Dort erlaubt die CSP 'unsafe-eval', Verstöße wie eval im Client-Bundle
 * (z.B. zod v4: Function("")) fallen deshalb nur in Produktion auf. Dieses Skript prüft genau das:
 *
 *  1. --dir .next    Client-Chunks enthalten kein eval / new Function / Function("")
 *  2. --url …        die laufende App (next start mit CSP_MODE=enforce) liefert auf jedem Pfad den CSP-Header,
 *                    und jedes <script> auf HTML-Seiten trägt die Nonce aus diesem Header
 *
 *   npx rsg-csp-check --dir .next
 *   npx rsg-csp-check --url http://localhost:3900 --paths /,/login --wait 60
 *   npx rsg-csp-check --url http://localhost:8088 --paths /anwesenheit,/anwesenheit/login --expect any
 *
 * --expect enforce (Standard) | report | any   welcher Header erwartet wird
 * Ausgang 1 bei jedem Befund. Keine Abhängigkeiten.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []),
);
const problems = [];

// eval im Client – mit Rand, damit z.B. "evaluate(" oder "x.eval(" nicht zählen
const EVAL = /(?<![\w$.])eval\(|new Function\(|(?<![\w$.])Function\(""\)/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".js")) yield p;
  }
}

if (args.dir) {
  const chunks = join(args.dir, "static", "chunks");
  let n = 0;
  const before = problems.length;
  for (const file of walk(chunks)) {
    n++;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(EVAL)) {
      problems.push(`eval im Client-Bundle: ${file}: …${src.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ")}…`);
    }
  }
  if (n === 0) problems.push(`keine Client-Chunks unter ${chunks} – falscher --dir?`);
  else if (problems.length === before) console.log(`✓ ${n} Client-Chunks ohne eval geprüft`);
}

async function fetchRetry(url, waitSeconds) {
  const until = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      return await fetch(url, { redirect: "manual" });
    } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

if (args.url) {
  const expect = args.expect || "enforce";
  const names = {
    enforce: ["content-security-policy"],
    report: ["content-security-policy-report-only"],
    any: ["content-security-policy", "content-security-policy-report-only"],
  }[expect];
  if (!names) throw new Error(`--expect ${expect} unbekannt (enforce, report, any)`);
  const paths = (args.paths || "/login").split(",").map((p) => p.trim()).filter(Boolean);
  let first = true;
  for (const path of paths) {
    const url = args.url.replace(/\/$/, "") + path;
    const res = await fetchRetry(url, first ? Number(args.wait || 0) : 0);
    first = false;
    const header = names.map((n) => res.headers.get(n)).find(Boolean);
    if (!header) {
      problems.push(`${path}: kein CSP-Header (${names.join(" oder ")}), Status ${res.status}`);
      continue;
    }
    const nonce = header.match(/'nonce-([^']+)'/)?.[1];
    if (!nonce) problems.push(`${path}: CSP ohne Nonce`);
    const type = res.headers.get("content-type") ?? "";
    if (res.status === 200 && type.includes("text/html")) {
      const html = await res.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      const without = scripts.filter((s) => !s.includes(`nonce="${nonce}"`));
      if (without.length) problems.push(`${path}: ${without.length} von ${scripts.length} <script> ohne passende Nonce, z.B. ${without[0].slice(0, 100)}`);
      else console.log(`✓ ${path}: ${res.status}, ${scripts.length} <script> mit Nonce`);
    } else {
      console.log(`✓ ${path}: ${res.status} mit CSP`);
    }
  }
}

if (!args.dir && !args.url) {
  console.error("Aufruf: rsg-csp-check --dir .next | --url http://… [--paths /,/login] [--expect enforce|report|any] [--wait 60]");
  process.exit(2);
}
if (problems.length) {
  console.error("✗ CSP-Prüfung fehlgeschlagen:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("✓ CSP-Prüfung bestanden");
