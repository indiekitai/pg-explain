export interface PlanNode {
    "Node Type": string;
    "Relation Name"?: string;
    "Alias"?: string;
    "Schema"?: string;
    "Startup Cost": number;
    "Total Cost": number;
    "Plan Rows": number;
    "Plan Width": number;
    "Actual Startup Time"?: number;
    "Actual Total Time"?: number;
    "Actual Rows"?: number;
    "Actual Loops"?: number;
    "Shared Hit Blocks"?: number;
    "Shared Read Blocks"?: number;
    "Shared Dirtied Blocks"?: number;
    "Shared Written Blocks"?: number;
    "Sort Key"?: string[];
    "Sort Method"?: string;
    "Hash Batches"?: number;
    "Peak Memory Usage"?: number;
    "Join Type"?: string;
    "Index Name"?: string;
    "Index Cond"?: string;
    "Filter"?: string;
    Plans?: PlanNode[];
    [key: string]: unknown;
}
export interface ExplainResult {
    Plan: PlanNode;
    "Planning Time"?: number;
    "Execution Time"?: number;
}
export interface NodeSummary {
    type: string;
    relation?: string;
    actualTime?: number;
    estimatedCost: number;
    rows: number;
}
export interface ExplainSummary {
    planningTime?: number;
    executionTime?: number;
    slowestNode: NodeSummary | null;
    seqScans: string[];
    bufferHits: number;
    bufferMisses: number;
    totalNodes: number;
}
export interface Recommendation {
    severity: "warning" | "info";
    message: string;
}
export interface AnalysisResult {
    query?: string;
    planningTime?: number;
    executionTime?: number;
    tree: string;
    summary: ExplainSummary;
    recommendations: Recommendation[];
    raw?: ExplainResult;
}
//# sourceMappingURL=types.d.ts.map