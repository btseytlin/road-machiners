import { runAgentCheck } from './agent-check';

// The bundled entry the agent container runs, see buildCheckBundle in container.ts.
process.exitCode = runAgentCheck(process.argv.slice(2), process.cwd(), (line) => console.log(line));
