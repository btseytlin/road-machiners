import { runAgentCheck } from './agent-check';

process.exitCode = runAgentCheck(process.argv.slice(2), process.cwd(), (line) => console.log(line));
