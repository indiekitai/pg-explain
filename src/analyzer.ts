import chalk from "chalk";
import type {
  PlanNode,
  ExplainResult,
  ExplainSummary,
  Recommendation,
  AnalysisResult,
  NodeSummary,
} from "./types.js";

const SEQ_SCAN_ROW_THRESHOLD = 1000;
const HIGH_MEMORY_MB_THRESHOLD = 64;

// ─── Tree rendering ────────────────────────────────────────────────────────────

function colorizeNodeType(nodeType: string, rows: number, analyzed: boolean): string {
  if (nodeType === "Seq Scan" && analyzed && rows >= SEQ_SCAN_ROW_THRESHOLD) {
    return chalk.red.bold(nodeType);
  }
  if (nodeType === "Seq Scan") {
    return chalk.red(nodeType);
  }
  if (nodeType.includes("Index")) {
    return chalk.green(nodeType);
  }
  if (nodeType === "Hash Join" || nodeType === "Hash") {
    return chalk.yellow(nodeType);
  }
  if (nodeType === "Sort") {
    return chalk.magenta(nodeType);
  }
  if (nodeType === "Nested Loop") {
    return chalk.cyan(nodeType);
  }
  return chalk.white(nodeType);
}

function formatCost(startup: number, total: number): string {
  return chalk.dim(`cost=${startup.toFixed(2)}..${total.toFixed(2)}`);
}

function formatTiming(actualTime?: number, loops?: number): string {
  if (actualTime === undefined) return "";
  const perLoop = loops && loops > 1 ? ` ×${loops}` : "";
  return chalk.cyan(` actual=${actualTime.toFixed(3)}ms${perLoop}`);
}

function formatRows(estimated: number, actual?: number): string {
  if (actual === undefined) {
    return chalk.dim(` rows=${estimated}`);
  }
  const diff = Math.abs(actual - estimated);
  const ratio = estimated > 0 ? actual / estimated : 1;
  const rowStr = `rows=${actual}/${estimated}`;
  if (ratio > 10 || ratio < 0.1) {
    return chalk.red(` ${rowStr}`) + chalk.red(" ⚠ bad estimate");
  }
  return chalk.dim(` ${rowStr}`);
}

export function renderTree(node: PlanNode, indent = 0, isLast = true): string {
  const lines: string[] = [];
  const prefix = indent === 0 ? "" : "  ".repeat(indent - 1) + (isLast ? "└─ " : "├─ ");
  const analyzed = node["Actual Total Time"] !== undefined;

  const nodeType = colorizeNodeType(
    node["Node Type"],
    node["Actual Rows"] ?? node["Plan Rows"],
    analyzed
  );

  const relation = node["Relation Name"]
    ? chalk.bold(` on ${node["Alias"] || node["Relation Name"]}`)
    : "";

  const cost = formatCost(node["Startup Cost"], node["Total Cost"]);
  const timing = formatTiming(node["Actual Total Time"], node["Actual Loops"]);
  const rows = formatRows(node["Plan Rows"], node["Actual Rows"]);

  let extra = "";
  if (node["Index Name"]) extra += chalk.dim(` idx=${node["Index Name"]}`);
  if (node["Filter"]) extra += chalk.dim(` filter=${node["Filter"].slice(0, 40)}`);
  if (node["Sort Key"]) extra += chalk.dim(` sort=[${node["Sort Key"].join(", ")}]`);
  if (node["Hash Batches"] && node["Hash Batches"] > 1) extra += chalk.yellow(` batches=${node["Hash Batches"]}`);
  if (node["Peak Memory Usage"]) {
    const mb = node["Peak Memory Usage"] / 1024;
    extra += mb >= HIGH_MEMORY_MB_THRESHOLD ? chalk.red(` mem=${mb.toFixed(0)}MB`) : chalk.dim(` mem=${mb.toFixed(0)}MB`);
  }

  lines.push(`${prefix}${nodeType}${relation} ${cost}${timing}${rows}${extra}`);

  if (node.Plans && node.Plans.length > 0) {
    for (let i = 0; i < node.Plans.length; i++) {
      const child = node.Plans[i];
      const childIsLast = i === node.Plans.length - 1;
      lines.push(renderTree(child, indent + 1, childIsLast));
    }
  }

  return lines.join("\n");
}

// ─── Summary extraction ────────────────────────────────────────────────────────

function collectNodes(node: PlanNode): PlanNode[] {
  const nodes: PlanNode[] = [node];
  if (node.Plans) {
    for (const child of node.Plans) {
      nodes.push(...collectNodes(child));
    }
  }
  return nodes;
}

export function buildSummary(result: ExplainResult): ExplainSummary {
  const allNodes = collectNodes(result.Plan);

  let slowestNode: NodeSummary | null = null;
  const seqScans: string[] = [];
  let bufferHits = 0;
  let bufferMisses = 0;

  for (const node of allNodes) {
    const actualTime = node["Actual Total Time"];
    if (actualTime !== undefined) {
      if (!slowestNode || actualTime > (slowestNode.actualTime ?? 0)) {
        slowestNode = {
          type: node["Node Type"],
          relation: node["Relation Name"] || node["Alias"],
          actualTime,
          estimatedCost: node["Total Cost"],
          rows: node["Actual Rows"] ?? node["Plan Rows"],
        };
      }
    }

    if (node["Node Type"] === "Seq Scan" && node["Relation Name"]) {
      seqScans.push(node["Relation Name"]);
    }

    bufferHits += node["Shared Hit Blocks"] ?? 0;
    bufferMisses += node["Shared Read Blocks"] ?? 0;
  }

  return {
    planningTime: result["Planning Time"],
    executionTime: result["Execution Time"],
    slowestNode,
    seqScans,
    bufferHits,
    bufferMisses,
    totalNodes: allNodes.length,
  };
}

// ─── Recommendations ───────────────────────────────────────────────────────────

export function buildRecommendations(result: ExplainResult): Recommendation[] {
  const recs: Recommendation[] = [];
  const allNodes = collectNodes(result.Plan);

  for (const node of allNodes) {
    const rows = node["Actual Rows"] ?? node["Plan Rows"];

    if (node["Node Type"] === "Seq Scan" && node["Relation Name"]) {
      if (rows >= SEQ_SCAN_ROW_THRESHOLD) {
        recs.push({
          severity: "warning",
          message: `Seq Scan on "${node["Relation Name"]}" (${rows} rows). Consider adding an index on the filter column.`,
        });
      } else if (rows > 0) {
        recs.push({
          severity: "info",
          message: `Seq Scan on "${node["Relation Name"]}" (${rows} rows). Small table — likely fine.`,
        });
      }
    }

    if (node["Node Type"] === "Sort") {
      recs.push({
        severity: "info",
        message: `Sort node detected (method: ${node["Sort Method"] ?? "unknown"}). An index on [${(node["Sort Key"] ?? []).join(", ")}] might eliminate this sort.`,
      });
    }

    if (node["Node Type"] === "Nested Loop") {
      const outerRows = node["Actual Rows"] ?? node["Plan Rows"];
      if (outerRows > 10000) {
        recs.push({
          severity: "warning",
          message: `Nested Loop on large dataset (${outerRows} rows). Consider rewriting as a Hash Join or adding appropriate indexes.`,
        });
      }
    }

    if (node["Hash Batches"] && node["Hash Batches"] > 1) {
      recs.push({
        severity: "warning",
        message: `Hash Join used ${node["Hash Batches"]} batches — not enough memory. Increase work_mem to avoid disk spilling.`,
      });
    }

    // Bad row estimate
    const estimated = node["Plan Rows"];
    const actual = node["Actual Rows"];
    if (actual !== undefined && estimated > 0) {
      const ratio = actual / estimated;
      if (ratio > 100 || ratio < 0.01) {
        recs.push({
          severity: "warning",
          message: `Row estimate wildly off for "${node["Node Type"]}" (estimated ${estimated}, got ${actual}). Run ANALYZE on the table to update statistics.`,
        });
      }
    }
  }

  return recs;
}

// ─── Parse raw PG EXPLAIN JSON ─────────────────────────────────────────────────

export function parseExplainJson(raw: unknown): ExplainResult {
  // PG returns an array with one element: [{ Plan: {...}, "Planning Time": ..., "Execution Time": ... }]
  if (Array.isArray(raw) && raw.length > 0) {
    return raw[0] as ExplainResult;
  }
  // Some clients unwrap it already
  if (raw && typeof raw === "object" && "Plan" in (raw as object)) {
    return raw as ExplainResult;
  }
  throw new Error("Unexpected EXPLAIN JSON format: expected array with Plan object");
}

// ─── Top-level analyze ─────────────────────────────────────────────────────────

export function analyze(rawJson: unknown, query?: string): AnalysisResult {
  const result = parseExplainJson(rawJson);
  const summary = buildSummary(result);
  const recommendations = buildRecommendations(result);
  const tree = renderTree(result.Plan);

  return {
    query,
    planningTime: result["Planning Time"],
    executionTime: result["Execution Time"],
    tree,
    summary,
    recommendations,
    raw: result,
  };
}

// ─── Text summary formatter ────────────────────────────────────────────────────

export function formatSummary(analysis: AnalysisResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold("─── Summary ─────────────────────────────────"));

  if (analysis.executionTime !== undefined) {
    lines.push(`  Execution time:  ${chalk.cyan(analysis.executionTime.toFixed(3) + "ms")}`);
  }
  if (analysis.planningTime !== undefined) {
    lines.push(`  Planning time:   ${chalk.dim(analysis.planningTime.toFixed(3) + "ms")}`);
  }

  if (analysis.summary.slowestNode) {
    const s = analysis.summary.slowestNode;
    const rel = s.relation ? ` on ${s.relation}` : "";
    lines.push(`  Slowest node:    ${chalk.red(s.type + rel)} (${s.actualTime?.toFixed(3)}ms)`);
  }

  if (analysis.summary.seqScans.length > 0) {
    lines.push(`  Seq Scans:       ${chalk.red(analysis.summary.seqScans.join(", "))}`);
  }

  if (analysis.summary.bufferHits > 0 || analysis.summary.bufferMisses > 0) {
    const hitRate =
      analysis.summary.bufferHits + analysis.summary.bufferMisses > 0
        ? ((analysis.summary.bufferHits / (analysis.summary.bufferHits + analysis.summary.bufferMisses)) * 100).toFixed(1)
        : "N/A";
    lines.push(`  Buffer cache:    ${chalk.dim(`${hitRate}% hit rate (${analysis.summary.bufferHits} hits, ${analysis.summary.bufferMisses} misses)`)}`);
  }

  if (analysis.recommendations.length > 0) {
    lines.push("");
    lines.push(chalk.bold("─── Recommendations ──────────────────────────"));
    for (const rec of analysis.recommendations) {
      const icon = rec.severity === "warning" ? chalk.yellow("⚠") : chalk.blue("ℹ");
      lines.push(`  ${icon} ${rec.message}`);
    }
  }

  return lines.join("\n");
}
