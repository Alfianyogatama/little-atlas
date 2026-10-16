import { createCodec } from './codec';
import { runReprocess } from './reprocess';

function parseArgs(argv: string[]): string[] | 'all' {
  let codes: string[] = [];
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') all = true;
    else if (a === '--codes') codes = (argv[++i] ?? '').split(',').filter((c) => c !== '');
    else throw new Error(`Argumen tidak dikenal: ${a ?? ''}`);
  }
  if (all) return 'all';
  if (codes.length === 0) throw new Error('Beri --codes A,B atau --all.');
  return codes.map((c) => c.toUpperCase());
}

async function main(): Promise<void> {
  const codes = parseArgs(process.argv.slice(2));
  const results = await runReprocess({
    codes,
    rawDir: '.tmp/icons/raw',
    publicDir: 'public/content',
    manifestPath: 'src/content/data/icon-manifest.json',
    codec: await createCodec(),
    log: (line) => console.log(line),
  });
  console.log(`Selesai: ${results.length} ikon diproses ulang.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
