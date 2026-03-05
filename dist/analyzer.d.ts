import type { PlanNode, ExplainResult, ExplainSummary, Recommendation, AnalysisResult } from "./types.js";
export declare function renderTree(node: PlanNode, indent?: number, isLast?: boolean): string;
export declare function buildSummary(result: ExplainResult): ExplainSummary;
export declare function buildRecommendations(result: ExplainResult): Recommendation[];
export declare function parseExplainJson(raw: unknown): ExplainResult;
export declare function analyze(rawJson: unknown, query?: string): AnalysisResult;
export declare function formatSummary(analysis: AnalysisResult): string;
//# sourceMappingURL=analyzer.d.ts.map