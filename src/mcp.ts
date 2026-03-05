#!/usr/bin/env node
import { readFileSync } from "fs";
import pg from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyze } from "./analyzer.js";

const { Client } = pg;

async function runExplain(
  connectionString: string,
  query: string,
  doAnalyze: boolean
): Promise<unknown> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const explainQuery = doAnalyze
      ? `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) ${query}`
      : `EXPLAIN (COSTS, VERBOSE, FORMAT JSON) ${query}`;
    const result = await client.query(explainQuery);
    return result.rows[0]["QUERY PLAN"];
  } finally {
    await client.end();
  }
}

const server = new McpServer({
  name: "pg-explain",
  version: "1.0.0",
});

server.tool(
  "explain_query",
  "Run EXPLAIN ANALYZE on a PostgreSQL query and return a structured analysis: plan tree, summary (execution time, slowest node, seq scans, buffer stats), and recommendations.",
  {
    connectionString: z.string().describe("PostgreSQL connection string, e.g. postgres://user:pass@host/db"),
    sql: z.string().describe("The SQL query to explain"),
    analyze: z.boolean().optional().default(true).describe("Run EXPLAIN ANALYZE (actually executes the query). Set false for EXPLAIN only."),
  },
  async ({ connectionString, sql, analyze: doAnalyze }) => {
    try {
      const rawJson = await runExplain(connectionString, sql, doAnalyze ?? true);
      const result = analyze(rawJson, sql);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: result.query,
                planningTime: result.planningTime,
                executionTime: result.executionTime,
                summary: result.summary,
                recommendations: result.recommendations,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "explain_file",
  "Run EXPLAIN ANALYZE on a SQL query read from a file.",
  {
    connectionString: z.string().describe("PostgreSQL connection string"),
    filePath: z.string().describe("Path to the .sql file containing the query"),
    analyze: z.boolean().optional().default(true).describe("Run EXPLAIN ANALYZE. Set false for EXPLAIN only."),
  },
  async ({ connectionString, filePath, analyze: doAnalyze }) => {
    try {
      const sql = readFileSync(filePath, "utf-8").trim();
      const rawJson = await runExplain(connectionString, sql, doAnalyze ?? true);
      const result = analyze(rawJson, sql);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: result.query,
                planningTime: result.planningTime,
                executionTime: result.executionTime,
                summary: result.summary,
                recommendations: result.recommendations,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
