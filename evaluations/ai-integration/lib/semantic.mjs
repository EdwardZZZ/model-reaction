import path from 'node:path';
import { createRequire } from 'node:module';

export function typescript(toolchain) {
  const require = createRequire(path.join(toolchain, 'package.json'));
  const resolved = require.resolve('typescript');
  if (!resolved.startsWith(toolchain + path.sep)) throw new Error('TypeScript must resolve within the trusted toolchain');
  return require(resolved);
}

export function inspectExports(root, toolchain) {
  const ts = typescript(toolchain);
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
