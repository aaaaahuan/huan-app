import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
const sources = ['native/ideas/IdeaTable.swift', 'native/ideas/main.swift'];
const output = 'out/native/idea-store';
try {
  const built = statSync(output).mtimeMs;
  if ([...sources, 'scripts/build-idea-native.mjs'].every(path => statSync(path).mtimeMs <= built)) process.exit(0);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
try {
  execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'pipe' });
  execFileSync('xcrun', ['--find', 'lipo'], { stdio: 'pipe' });
} catch (error) {
  if (!process.argv.includes('--dev')) throw error;
  console.warn('未找到 Swift/Xcode 命令行工具，跳过灵感原生组件。安装工具后重新启动可恢复灵感保存功能。');
  process.exit(0);
}
// 构建时生成通用二进制，最终用户无需安装 Swift/Xcode。
mkdirSync('out/native', { recursive: true });
for (const arch of ['arm64','x86_64']) {
  execFileSync('xcrun',['swiftc','-O','-target',`${arch}-apple-macos13.0`,...sources,'-o',`out/native/idea-store-${arch}`],{stdio:'inherit'});
}
execFileSync('xcrun',['lipo','-create','out/native/idea-store-arm64','out/native/idea-store-x86_64','-output','out/native/idea-store'],{stdio:'inherit'});

for (const arch of ['arm64','x86_64']) rmSync(`out/native/idea-store-${arch}`);
