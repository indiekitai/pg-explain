import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseExplainJson, buildSummary, buildRecommendations, renderTree, analyze, } from "../analyzer.js";
// ─── Mock data ─────────────────────────────────────────────────────────────────
const seqScanNode = {
    "Node Type": "Seq Scan",
    "Relation Name": "users",
    "Alias": "users",
    "Startup Cost": 0,
    "Total Cost": 150.5,
    "Plan Rows": 5000,
    "Plan Width": 64,
    "Actual Startup Time": 0.1,
    "Actual Total Time": 12.5,
    "Actual Rows": 5000,
    "Actual Loops": 1,
    "Shared Hit Blocks": 50,
    "Shared Read Blocks": 10,
};
const indexScanNode = {
    "Node Type": "Index Scan",
    "Relation Name": "users",
    "Index Name": "idx_users_email",
    "Startup Cost": 0.1,
    "Total Cost": 8.3,
    "Plan Rows": 1,
    "Plan Width": 64,
    "Actual Startup Time": 0.05,
    "Actual Total Time": 0.07,
    "Actual Rows": 1,
    "Actual Loops": 1,
    "Shared Hit Blocks": 3,
    "Shared Read Blocks": 0,
};
const sortNode = {
    "Node Type": "Sort",
    "Sort Key": ["created_at"],
    "Sort Method": "quicksort",
    "Startup Cost": 10,
    "Total Cost": 15,
    "Plan Rows": 100,
    "Plan Width": 32,
    "Actual Startup Time": 5.0,
    "Actual Total Time": 5.2,
    "Actual Rows": 100,
    "Actual Loops": 1,
    Plans: [indexScanNode],
};
const hashJoinNode = {
    "Node Type": "Hash Join",
    "Startup Cost": 20,
    "Total Cost": 200,
    "Plan Rows": 1000,
    "Plan Width": 128,
    "Actual Startup Time": 50,
    "Actual Total Time": 100,
    "Actual Rows": 1000,
    "Actual Loops": 1,
    "Hash Batches": 4,
    "Peak Memory Usage": 100 * 1024, // 100MB
};
const simpleResult = {
    Plan: seqScanNode,
    "Planning Time": 0.5,
    "Execution Time": 12.5,
};
const nestedResult = {
    Plan: {
        "Node Type": "Nested Loop",
        "Startup Cost": 0,
        "Total Cost": 300,
        "Plan Rows": 5000,
        "Plan Width": 128,
        "Actual Startup Time": 0.1,
        "Actual Total Time": 20.0,
        "Actual Rows": 5000,
        "Actual Loops": 1,
        Plans: [seqScanNode, indexScanNode],
    },
    "Planning Time": 1.0,
    "Execution Time": 20.0,
};
// ─── parseExplainJson ──────────────────────────────────────────────────────────
describe("parseExplainJson", () => {
    test("parses array format (PG native)", () => {
        const raw = [{ Plan: seqScanNode, "Planning Time": 0.5, "Execution Time": 12.5 }];
        const result = parseExplainJson(raw);
        assert.equal(result.Plan["Node Type"], "Seq Scan");
        assert.equal(result["Planning Time"], 0.5);
    });
    test("parses pre-unwrapped object", () => {
        const raw = { Plan: seqScanNode, "Planning Time": 0.5, "Execution Time": 12.5 };
        const result = parseExplainJson(raw);
        assert.equal(result.Plan["Node Type"], "Seq Scan");
    });
    test("throws on unexpected format", () => {
        assert.throws(() => parseExplainJson("not a plan"), /Unexpected EXPLAIN JSON format/);
    });
    test("throws on null", () => {
        assert.throws(() => parseExplainJson(null), /Unexpected EXPLAIN JSON format/);
    });
});
// ─── buildSummary ──────────────────────────────────────────────────────────────
describe("buildSummary", () => {
    test("extracts execution time and planning time", () => {
        const summary = buildSummary(simpleResult);
        assert.equal(summary.executionTime, 12.5);
        assert.equal(summary.planningTime, 0.5);
    });
    test("identifies seq scans", () => {
        const summary = buildSummary(simpleResult);
        assert.deepEqual(summary.seqScans, ["users"]);
    });
    test("counts buffer hits and misses", () => {
        const summary = buildSummary(simpleResult);
        assert.equal(summary.bufferHits, 50);
        assert.equal(summary.bufferMisses, 10);
    });
    test("identifies slowest node", () => {
        const summary = buildSummary(nestedResult);
        assert.ok(summary.slowestNode !== null);
        assert.ok(summary.slowestNode.actualTime !== undefined);
    });
    test("counts total nodes", () => {
        const summary = buildSummary(nestedResult);
        assert.equal(summary.totalNodes, 3); // Nested Loop + Seq Scan + Index Scan
    });
    test("no seq scans for index scan only", () => {
        const result = { Plan: indexScanNode, "Planning Time": 0.1, "Execution Time": 0.07 };
        const summary = buildSummary(result);
        assert.deepEqual(summary.seqScans, []);
    });
});
// ─── buildRecommendations ──────────────────────────────────────────────────────
describe("buildRecommendations", () => {
    test("warns about seq scan on large table", () => {
        const recs = buildRecommendations(simpleResult);
        const seqRec = recs.find((r) => r.message.includes("Seq Scan") && r.message.includes("users"));
        assert.ok(seqRec, "should have seq scan warning");
        assert.equal(seqRec.severity, "warning");
    });
    test("no warning for seq scan on small table", () => {
        const smallSeq = {
            ...seqScanNode,
            "Plan Rows": 50,
            "Actual Rows": 50,
        };
        const result = { Plan: smallSeq };
        const recs = buildRecommendations(result);
        const warnings = recs.filter((r) => r.severity === "warning" && r.message.includes("Seq Scan"));
        assert.equal(warnings.length, 0);
    });
    test("flags hash batches > 1", () => {
        const result = { Plan: hashJoinNode };
        const recs = buildRecommendations(result);
        const hashRec = recs.find((r) => r.message.includes("batches"));
        assert.ok(hashRec, "should warn about hash batches");
        assert.equal(hashRec.severity, "warning");
    });
    test("suggests index for sort node", () => {
        const result = { Plan: sortNode };
        const recs = buildRecommendations(result);
        const sortRec = recs.find((r) => r.message.includes("Sort"));
        assert.ok(sortRec, "should have sort recommendation");
    });
    test("warns about bad row estimates", () => {
        const badEstimate = {
            ...seqScanNode,
            "Plan Rows": 1,
            "Actual Rows": 50000,
        };
        const result = { Plan: badEstimate };
        const recs = buildRecommendations(result);
        const estimateRec = recs.find((r) => r.message.includes("estimate"));
        assert.ok(estimateRec, "should warn about bad estimate");
    });
    test("no recommendations for fast index scan", () => {
        const result = { Plan: indexScanNode };
        const recs = buildRecommendations(result);
        // Index scan with 1 row should have no warnings
        const warnings = recs.filter((r) => r.severity === "warning");
        assert.equal(warnings.length, 0);
    });
});
// ─── renderTree ────────────────────────────────────────────────────────────────
describe("renderTree", () => {
    test("renders a single node", () => {
        const tree = renderTree(indexScanNode);
        assert.ok(tree.includes("Index Scan"));
        assert.ok(tree.includes("idx_users_email"));
    });
    test("renders nested nodes with indentation", () => {
        const tree = renderTree(sortNode);
        assert.ok(tree.includes("Sort"));
        assert.ok(tree.includes("Index Scan"));
        assert.ok(tree.includes("└─"));
    });
    test("includes cost information", () => {
        const tree = renderTree(seqScanNode);
        assert.ok(tree.includes("cost="));
        assert.ok(tree.includes("150.50")); // Total Cost
    });
    test("includes actual timing when available", () => {
        const tree = renderTree(seqScanNode);
        assert.ok(tree.includes("actual="));
        assert.ok(tree.includes("12.500ms"));
    });
    test("renders multi-level nested plan", () => {
        const tree = renderTree(nestedResult.Plan);
        assert.ok(tree.includes("Nested Loop"));
        assert.ok(tree.includes("Seq Scan"));
        assert.ok(tree.includes("Index Scan"));
    });
});
// ─── analyze (integration) ────────────────────────────────────────────────────
describe("analyze", () => {
    test("returns full analysis result", () => {
        const result = analyze([simpleResult], "SELECT * FROM users");
        assert.equal(result.query, "SELECT * FROM users");
        assert.equal(result.executionTime, 12.5);
        assert.ok(typeof result.tree === "string");
        assert.ok(result.tree.includes("Seq Scan"));
        assert.ok(Array.isArray(result.recommendations));
        assert.ok(result.summary.seqScans.includes("users"));
    });
    test("handles plan without analyze data", () => {
        const noAnalyze = {
            Plan: {
                "Node Type": "Seq Scan",
                "Relation Name": "orders",
                "Startup Cost": 0,
                "Total Cost": 50,
                "Plan Rows": 1000,
                "Plan Width": 32,
            },
        };
        const result = analyze(noAnalyze);
        assert.ok(result.executionTime === undefined);
        assert.ok(typeof result.tree === "string");
    });
});
//# sourceMappingURL=analyzer.test.js.map