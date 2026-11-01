// 배포용 zip 만들기: dist/를 HTML 한 파일로 합치고 사용법과 함께 release/에 묶는다.
// 받은 사람은 zip을 풀고 BossMaker.html을 더블클릭하면 된다(서버·Node 불필요).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `BossMaker-v${version}`;
const stage = join(root, 'release', name);
const zip = join(root, 'release', `${name}.zip`);

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const asset = (href) => readFileSync(join(dist, href.replace(/^\//, '')), 'utf8');

// <script src> → 인라인. 코드 안의 '</script'가 태그를 닫지 않게 이스케이프한다
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) =>
  `<script type="module">${asset(src).replaceAll('</script', '<\\/script')}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${asset(href)}</style>`);
if (/(src|href)="\/assets\//.test(html)) throw new Error('인라인하지 못한 파일 참조가 남아 있습니다: dist/index.html 형식을 확인하세요');

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(stage, { recursive: true });
writeFileSync(join(stage, 'BossMaker.html'), html);
// 메모장에서 한글이 깨지지 않게 BOM + CRLF
writeFileSync(join(stage, 'README.txt'), '﻿' + [
  `BossMaker v${version} - 메이플 파티 보스 메이커`,
  '',
  '[실행]',
  '  BossMaker.html 을 더블클릭하세요. 브라우저(Chrome/Edge 권장)로 열립니다.',
  '  설치나 인터넷 연결은 필요 없습니다.',
  '',
  '[저장]',
  '  입력한 내용은 브라우저에 자동 저장됩니다.',
  '  BossMaker.html 파일을 다른 폴더로 옮기거나 다른 브라우저로 열면 저장 내용이 안 보일 수 있습니다.',
  '  옮기기 전에 앱의 [JSON 내보내기]로 파일을 받아 두고, 옮긴 뒤 [JSON 불러오기]로 되돌리세요.',
  '',
].join('\r\n'));

execFileSync('powershell', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}'`], { stdio: 'inherit' });
if (!existsSync(zip)) throw new Error('zip 생성 실패');
console.log(`완료: release/${name}.zip`);
