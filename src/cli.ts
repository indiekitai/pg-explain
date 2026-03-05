#!/usr/bin/env node
import { readFileSync } from "fs";
import pg from "pg";
import chalk from "chalk";
import { analyze, formatSummary, renderTree } from "./analyzer.js";

const { Client } = pg;

function printHelp(): void {
  console.log(`
${chalk.bold("pg-explain")} — PostgreSQL EXPLAIN ANALYZE in your terminal

${chalk.bold("Usage:")}
  pg-explain <query> <connectionString>
  pg-explain --file <query.sql> <connectionString>

${chalk.bold("Options:")}
  --file          Read query from a file instead of argument
  --no-analyze    Run EXPLAIN without ANALYZE (no actual execution)
  --json          Output results as JSON
  --help          Show this help

${chalk.bold("Examples:")}
  pg-explain "SELECT * FROM users WHERE email = $1" postgres://localhost/mydb
  pg-explain --file slow_query.sql postgres://user:pass@host/db
  pg-explain --json "SELECT count(*) FROM orders" postgres://localhost/mydb

${chalk.bold("MCP Server:")}
  pg-explain-mcp    Start the MCP server for use with Claude/Cursor
`);
}

async function runExplain(
  query: string,
  connectionString: string,
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const jsonMode = args.includes("--json");
  const noAnalyze = args.includes("--no-analyze");
  const fileMode = args.includes("--file");
  const filteredArgs = args.filter(
    (a) => !["--json", "--no-analyze", "--file"].includes(a)
  );

  if (filteredArgs.length < 2) {
    console.error(chalk.red("Error: provide a query and connection string"));
    console.error(chalk.dim("Usage: pg-explain <query> <connectionString>"));
    process.exit(1);
  }

  let query: string;
  let connectionString: string;

  if (fileMode) {
    const filePath = filteredArgs[0];
    try {
      query = readFileSync(filePath, "utf-8").trim();
    } catch {
      console.error(chalk.red(`Error: cannot read file ${filePath}`));
      process.exit(1);
    }
    connectionString = filteredArgs[1];
  } else {
    query = filteredArgs[0];
    connectionString = filteredArgs[1];
  }

  try {
    const rawJson = await runExplain(query, connectionString, !noAnalyze);
    const analysis = analyze(rawJson, query);

    if (jsonMode) {
      // Remove the tree (ANSI codes) from JSON output, rebuild plain text tree
      console.log(
        JSON.stringify(
          {
            query: analysis.query,
            planningTime: analysis.planningTime,
            executionTime: analysis.executionTime,
            summary: analysis.summary,
            recommendations: analysis.recommendations,
          },
          null,
          2
        )
      );
    } else {
      if (analysis.query) {
        console.log(chalk.bold("\nQuery:"), chalk.dim(analysis.query.slice(0, 120)));
      }
      console.log("\n" + analysis.tree);
      console.log(formatSummary(analysis));
      console.log();
    }
  } catch (err) {
    console.error(chalk.red("Error:"), (err as Error).message);
    process.exit(1);
  }
}

main();
