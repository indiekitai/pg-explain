# @indiekitai/pg-explain

**PostgreSQL EXPLAIN ANALYZE in your terminal.**

The only CLI/MCP tool for query plan visualization — everything else is a website ([explain.dalibo.com](https://explain.dalibo.com), [pgexplain.dev](https://pgexplain.dev), pev2).

```bash
npx @indiekitai/pg-explain "SELECT * FROM orders WHERE user_id = 1" postgres://localhost/mydb
```

```
Query: SELECT * FROM orders WHERE user_id = 1

└─ Index Scan on orders cost=0.43..8.45 actual=0.07ms rows=12/10
     idx=idx_orders_user_id

─── Summary ─────────────────────────────────
  Execution time:  0.124ms
  Planning time:   0.350ms
  Buffer cache:    100.0% hit rate (15 hits, 0 misses)
```

## Why CLI?

| Tool | CLI | MCP | Works offline | Scriptable |
|------|-----|-----|--------------|------------|
| explain.dalibo.com | ❌ | ❌ | ❌ | ❌ |
| pgexplain.dev | ❌ | ❌ | ❌ | ❌ |
| pev2 (npm) | ❌ | ❌ | ✅ | ❌ |
| **pg-explain** | **✅** | **✅** | **✅** | **✅** |

## Install

```bash
npm install -g @indiekitai/pg-explain
# or use directly:
npx @indiekitai/pg-explain "SELECT ..." postgres://...
```

## Usage

```bash
# Basic (runs EXPLAIN ANALYZE)
pg-explain "SELECT * FROM users WHERE email = $1" postgres://user:pass@host/db

# From a file
pg-explain --file slow_query.sql postgres://localhost/mydb

# EXPLAIN only (no actual execution)
pg-explain --no-analyze "SELECT * FROM large_table" postgres://localhost/mydb

# JSON output (for scripts/CI)
pg-explain --json "SELECT count(*) FROM orders" postgres://localhost/mydb
```

## Output

The tree uses color to highlight issues at a glance:
- 🔴 **Red** — Seq Scan on large table (> 1000 rows)
- 🟢 **Green** — Index Scan (good)
- 🟡 **Yellow** — Hash Join (watch memory usage)
- 🟣 **Magenta** — Sort node
- ⚪ **White** — Other nodes

Each node shows: `type [on relation] cost=start..total actual=Xms rows=actual/estimated`

## MCP Server (Claude / Cursor)

After installing globally (`npm install -g @indiekitai/pg-explain`):

```json
{
  "mcpServers": {
    "pg-explain": {
      "command": "pg-explain-mcp"
    }
  }
}
```

Or without global install:

```json
{
  "mcpServers": {
    "pg-explain": {
      "command": "npx",
      "args": ["--package", "@indiekitai/pg-explain", "pg-explain-mcp"]
    }
  }
}
```

Tools:
- `explain_query(connectionString, sql, analyze?)` — explain and analyze a query
- `explain_file(connectionString, filePath)` — explain a query from a file

## Programmatic Usage

```typescript
import { analyze } from "@indiekitai/pg-explain";

// Pass raw PG EXPLAIN JSON (from your own pg client)
const rawJson = await client.query("EXPLAIN (FORMAT JSON, ANALYZE) SELECT ...");
const result = analyze(rawJson.rows[0]["QUERY PLAN"], "SELECT ...");

console.log(result.executionTime);         // 12.5 (ms)
console.log(result.summary.seqScans);      // ["users"]
console.log(result.recommendations);       // [{ severity: "warning", message: "..." }]
console.log(result.tree);                  // colored tree string
```

---

Part of the [IndieKit](https://indiekit.ai) PostgreSQL toolchain:
[pg-inspect](https://github.com/indiekitai/pg-inspect) · [pg-diff](https://github.com/indiekitai/pg-diff) · [pg-top](https://github.com/indiekitai/pg-top) · [pg-safe-migrate](https://github.com/indiekitai/pg-safe-migrate) · **pg-explain** · [pg-dash](https://github.com/indiekitai/pg-dash)
