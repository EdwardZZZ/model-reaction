import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { json, suite, write } from './lib/environment.mjs';

// Semantic evidence for the existing no-type-escape rule; does not change frozen checks.
export function inspectExports(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const ts = require('typescript');
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options), checker = program.getTypeChecker();
  const findings = [];
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(path.join(root, 'src') + path.sep) || /\/support\.tsx?$/.test(file.fileName)) continue;
    const symbol = checker.getSymbolAtLocation(file);
    if (!symbol) continue;
    for (const exported of checker.getExportsOfModule(symbol)) {
      const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (!(target.flags & ts.SymbolFlags.Value)) continue;
      const declaration = exported.valueDeclaration ?? exported.declarations?.[0];
      if (!declaration) continue;
      const type = checker.getTypeOfSymbolAtLocation(exported, declaration);
      const signatures = type.getCallSignatures();
      const inspected = signatures.length ? signatures.map(s => checker.getReturnTypeOfSignature(s)) : [type];
      for (const value of inspected) {
        findings.push({
          file: path.relative(root, file.fileName), export: exported.name,
          kind: signatures.length ? 'return' : 'value', type: checker.typeToString(value),
          is_any: !!(value.flags & ts.TypeFlags.Any),
        });
      }
    }
  }
  return { typescript_version: ts.version, findings, violations: findings.filter(f => f.is_any) };
}
export function diagnostic(result) {
  return result.violations.map(f => `CONSTRAINT FAIL: ${f.file}, export ${f.export}, ${f.kind} type is any (TypeScript ${result.typescript_version} checker). The task forbids type escapes.`).join('\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? path.join(suite, 'runs/baseline-v1'));
  const environment = json(path.join(output, 'environment.json'));
  const evidence = {};
  for (const name of fs.readdirSync(path.join(output, 'attempts'))) {
    if (!fs.existsSync(path.join(output, 'attempts', name, 'result.json'))) continue;
    evidence[name] = inspectExports(path.join(environment.runtime, 'attempts', name, 'project'));
  }
  write(path.join(output, 'export-types-review.json'), evidence);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(evidence).map(([id, r]) => [id, r.violations])), null, 2));
}
