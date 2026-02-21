// action execution — runs the tools daimon calls
// daimon: you can ADD new handlers here. go wild.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { REPO_ROOT } = require("./config");
const { githubAPI, addToProject } = require("./github");
const { deployContract, getWalletInfo } = require("./network");
// inference import removed — web_search now uses DuckDuckGo directly

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const filesChanged = new Set();

// contract sources for deployment
const CONTRACT_SOURCES = {
  DaimonChat: () => fs.readFileSync(path.join(REPO_ROOT, "contracts/DaimonChat.sol"), "utf-8"),
};

// compile a contract and return abi + bytecode
function compileContract(name, source) {
  // lazy load solc only when needed
  const solc = require("solc");
  
  const input = {
    language: "Solidity",
    sources: {
      [`${name}.sol`]: { content: source },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  log(`compiling ${name}.sol...`);
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    const hasError = output.errors.some((e) => e.severity === "error");
    if (hasError) {
      console.error("compilation errors:", output.errors);
      throw new Error("compilation failed: " + output.errors.map(e => e.message).join("; "));
    }
    output.errors.forEach((e) => log(`warning: ${e.message}`));
  }

  const contract = output.contracts[`${name}.sol`][name];
  return {
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  };
}

// executes a tool call and returns the result string
async function executeTool(name, args) {
  switch (name) {
    case "write_file": {
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, args.content, "utf-8");
      filesChanged.add(args.path);
      log(`wrote: ${args.path} (${args.content.length} chars)`);
      return `wrote ${args.path} (${args.content.length} chars)`;
    }
    case "append_file": {
      // block append on JSON files — corrupts them
      if (args.path.endsWith(".json")) {
        log(`blocked append_file on JSON: ${args.path}`);
        return `error: cannot append to JSON files — use write_file() with the full valid JSON instead. read the file first, modify it, then write_file() the complete content.`;
      }
      // block append to old daily journal format
      if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(args.path)) {
        log(`blocked append to deprecated daily journal: ${args.path}`);
        return `error: daily journal format (memory/YYYY-MM-DD.md) is deprecated. write your journal to memory/cycles/<cycle_number>.md instead using write_file().`;
      }
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.appendFileSync(fullPath, "\n" + args.content, "utf-8");
      filesChanged.add(args.path);
      log(`appended: ${args.path}`);
      return `appended to ${args.path}`;
    }
    case "read_file": {
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      if (!fs.existsSync(fullPath)) return `file not found: ${args.path}`;
      const raw = fs.readFileSync(fullPath, "utf-8");
      const lines = raw.split("\n");
      const totalLines = lines.length;

      // support offset/limit for partial reads
      const offset = Math.max(1, args.offset || 1);
      const limit = args.limit || totalLines;
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const content = slice.join("\n");

      const rangeInfo = args.offset || args.limit
        ? ` (lines ${offset}-${offset + slice.length - 1} of ${totalLines})`
        : "";
      log(`read: ${args.path}${rangeInfo} (${content.length} chars)`);
      return content.length > 4000
        ? content.slice(0, 4000) + `\n... (truncated, ${totalLines} total lines)`
        : content + (rangeInfo ? `\n--- ${totalLines} total lines ---` : "");
    }
    case "create_issue": {
      const issue = await githubAPI("/issues", {
        method: "POST",
        body: JSON.stringify({
          title: args.title,
          body: args.body || "",
          labels: args.labels || [],
        }),
      });
      log(`created issue #${issue.number}: ${issue.title}`);
      if (issue.node_id) await addToProject(issue.node_id);
      return `created issue #${issue.number}: ${issue.title}`;
    }
    case "close_issue": {
      if (args.comment) {
        await githubAPI(`/issues/${args.number}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: args.comment }),
        });
      }
      await githubAPI(`/issues/${args.number}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed" }),
      });
      log(`closed issue #${args.number}`);
      return `closed issue #${args.number}`;
    }
    case "comment_issue": {
      await githubAPI(`/issues/${args.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: args.body }),
      });
      log(`commented on issue #${args.number}`);
      return `commented on issue #${args.number}`;
    }
    case "web_search": {
      log(`web search: ${args.query}`);
      try {
        const q = encodeURIComponent(args.query);
        const res = await fetch(`https://duckduckgo.com/html/?q=${q}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!res.ok) return `search failed: HTTP ${res.status}`;
        const html = await res.text();
        // extract results from DDG HTML
        const results = [];
        const regex = /<a[^>]+class="result__a"[^>]*>([^<]+)<\/a>/g;
        let match;
        while ((match = regex.exec(html)) !== null && results.length < 10) {
          results.push(match[1].trim());
        }
        // also extract snippets
        const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;
        const snippets = [];
        while ((match = snippetRegex.exec(html)) !== null && snippets.length < 10) {
          snippets.push(match[1].trim());
        }
        if (results.length === 0) return "no results found";
        const output = results
          .map((r, i) => `${i + 1}. ${r}${snippets[i] ? ` — ${snippets[i]}` : ""}`)
          .join("\n");
        log(`web search: ${results.length} results`);
        return output;
      } catch (e) {
        return `search error: ${e.message}`;
      }
    }
    case "run_command": {
      // block git commands — commits happen automatically
      if (/\bgit\b/.test(args.command)) {
        return "git commands are blocked — commits happen automatically at the end of each cycle";
      }
      log(`running: ${args.command}`);
      try {
        const output = execSync(args.command, {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          timeout: 30000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        log(`command succeeded (${output.length} chars)`);
        return output.length > 4000 ? output.slice(0, 4000) + "\n... (truncated)" : output;
      } catch (e) {
        const output = e.stdout || "" + (e.stderr || "");
        log(`command failed: ${e.message}`);
        return output.length > 0 ? output : `error: ${e.message}`;
      }
    }
    case "list_dir": {
      const dirPath = args.path ? path.resolve(REPO_ROOT, args.path) : REPO_ROOT;
      if (!dirPath.startsWith(REPO_ROOT)) throw new Error("path escape attempt");
      if (!fs.existsSync(dirPath)) return `directory not found: ${args.path || "."}`;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join("\n");
      log(`listed: ${args.path || "."} (${entries.length} entries)`);
      return result || "(empty directory)";
    }
    case "search_files": {
      log(`searching files for: ${args.pattern}`);
      try {
        const searchPath = args.path ? path.resolve(REPO_ROOT, args.path) : REPO_ROOT;
        if (!searchPath.startsWith(REPO_ROOT)) throw new Error("path escape attempt");
        const results = [];
        const pattern = new RegExp(args.pattern, "i");
        const walk = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith(".") && e.name !== ".github") continue;
            const fullPath = path.join(dir, e.name);
            if (e.isDirectory()) {
              walk(fullPath);
            } else if (e.isFile()) {
              if (args.glob && !e.name.match(new RegExp(args.glob.replace(/\*/g, ".*")))) continue;
              const relPath = path.relative(REPO_ROOT, fullPath);
              try {
                const content = fs.readFileSync(fullPath, "utf-8");
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                  if (pattern.test(lines[i])) {
                    results.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
                  }
                }
              } catch {}
            }
          }
        };
        walk(searchPath);
        if (results.length === 0) return "no matches found";
        log(`file search: ${results.length} matches`);
        return results.slice(0, 50).join("\n");
      } catch (e) {
        if (e.status === 1) return "no matches found";
        return `search error: ${e.message.slice(0, 200)}`;
      }
    }
    case "delete_file": {
      const fullPath = path.resolve(REPO_ROOT, args.path);
      if (!fullPath.startsWith(REPO_ROOT + "/")) throw new Error("path escape attempt");
      if (!fs.existsSync(fullPath)) return `file not found: ${args.path}`;
      fs.unlinkSync(fullPath);
      filesChanged.add(args.path);
      log(`deleted: ${args.path}`);
      return `deleted ${args.path}`;
    }
    case "fetch_url": {
      log(`fetching: ${args.url}`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(args.url, {
          headers: { "User-Agent": "daimon/1.0" },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return `fetch failed: HTTP ${res.status}`;
        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();
        // if JSON, return as-is; if HTML, strip tags
        let content;
        if (contentType.includes("json")) {
          content = text;
        } else {
          content = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
        log(`fetched: ${args.url} (${content.length} chars)`);
        return content.length > 4000
          ? content.slice(0, 4000) + "\n... (truncated)"
          : content;
      } catch (e) {
        return `fetch error: ${e.message}`;
      }
    }
    case "search_memory": {
      log(`searching memory for: ${args.query}`);
      try {
        const memDir = path.resolve(REPO_ROOT, "memory");
        // collect all searchable files: top-level + cycles/
        const topFiles = fs.readdirSync(memDir)
          .filter(f => f.endsWith(".md") || f.endsWith(".json"))
          .map(f => ({ rel: `memory/${f}`, full: path.join(memDir, f) }));
        const cyclesDir = path.join(memDir, "cycles");
        const cycleFiles = fs.existsSync(cyclesDir)
          ? fs.readdirSync(cyclesDir)
              .filter(f => f.endsWith(".md"))
              .map(f => ({ rel: `memory/cycles/${f}`, full: path.join(cyclesDir, f) }))
          : [];
        const allFiles = [...topFiles, ...cycleFiles];
        const results = [];
        let pattern;
        try {
          pattern = new RegExp(args.query, "i");
        } catch (e) {
          return `invalid search pattern: ${e.message}`;
        }
        for (const file of allFiles) {
          const content = fs.readFileSync(file.full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length - 1, i + 1);
              const snippet = lines.slice(start, end + 1).join("\n");
              results.push(`${file.rel}:${i + 1}\n${snippet}`);
            }
          }
        }
        if (results.length === 0) return `no matches for "${args.query}" in memory/`;
        const output = results.slice(0, 20).join("\n---\n");
        log(`memory search: ${results.length} matches`);
        return output.length > 3000 ? output.slice(0, 3000) + "\n... (truncated)" : output;
      } catch (e) {
        return `memory search error: ${e.message}`;
      }
    }
    case "github_search": {
      const type = args.type || "repositories";
      log(`github search (${type}): ${args.query}`);
      try {
        const q = encodeURIComponent(args.query);
        const data = await githubAPI(
          `https://api.github.com/search/${type}?q=${q}&per_page=10`,
          { raw: true }
        );
        if (type === "repositories") {
          return (data.items || [])
            .map((r) => `${r.full_name} (${r.stargazers_count}★) — ${r.description || "no description"}\n  ${r.html_url}`)
            .join("\n\n") || "no results";
        } else if (type === "code") {
          return (data.items || [])
            .map((r) => `${r.repository.full_name}: ${r.path}\n  ${r.html_url}`)
            .join("\n\n") || "no results";
        } else {
          return (data.items || [])
            .map((r) => `#${r.number}: ${r.title} (${r.state}) — ${r.repository_url}\n  ${r.html_url}`)
            .join("\n\n") || "no results";
        }
      } catch (e) {
        return `github search error: ${e.message}`;
      }
    }
    case "deploy_contract": {
      const contractName = args.name;
      const constructorArgs = args.constructorArgs || [];
      
      log(`deploying contract: ${contractName}`);
      
      // check if we have the source
      if (!CONTRACT_SOURCES[contractName]) {
        return `error: unknown contract "${contractName}". available: ${Object.keys(CONTRACT_SOURCES).join(", ")}`;
      }
      
      try {
        // get wallet info first
        const walletInfo = await getWalletInfo();
        log(`deployer: ${walletInfo.address}, balance: ${walletInfo.balance} ETH`);
        
        if (parseFloat(walletInfo.balance) < 0.001) {
          return `error: insufficient balance (${walletInfo.balance} ETH). need at least 0.001 ETH for deployment.`;
        }
        
        // compile the contract
        const source = CONTRACT_SOURCES[contractName]();
        const { abi, bytecode } = compileContract(contractName, source);
        
        // deploy
        const result = await deployContract(abi, bytecode, constructorArgs);
        
        // save deployment info
        const deployInfo = {
          name: contractName,
          address: result.address,
          txHash: result.txHash,
          deployedAt: new Date().toISOString(),
          abi,
        };
        const deployPath = path.join(REPO_ROOT, "contracts", `${contractName}.json`);
        fs.writeFileSync(deployPath, JSON.stringify(deployInfo, null, 2), "utf-8");
        filesChanged.add(`contracts/${contractName}.json`);
        
        log(`deployed ${contractName} at ${result.address}`);
        return `deployed ${contractName} at ${result.address}\ntx: ${result.txHash}\ndeployment info saved to contracts/${contractName}.json`;
      } catch (e) {
        log(`deployment failed: ${e.message}`);
        return `deployment failed: ${e.message}`;
      }
    }
    default:
      log(`unknown tool: ${name}`);
      return `unknown tool: ${name}`;
  }
}

module.exports = { executeTool, filesChanged };