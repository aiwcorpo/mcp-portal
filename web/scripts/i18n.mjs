// Translations of the portal: messages.xlf holds the English source texts (ng extract-i18n), messages.pl.xlf the Polish
// translations. The browser gets the Polish ones as JSON and registers them with loadTranslations before the application
// starts (src/app/core/locale.ts), so one build serves both languages and the BFF and nginx need to know nothing.
//
//   node scripts/i18n.mjs json    writes public/i18n/messages.pl.json (npm run build and start run it first)
//   node scripts/i18n.mjs check   every source text has a Polish translation with the same placeholders, and none is left over
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Xliff2TranslationParser } from '@angular/localize/tools';

const SOURCE = 'src/locale/messages.xlf';
const POLISH = 'src/locale/messages.pl.xlf';
const OUTPUT = 'public/i18n/messages.pl.json';

function polishTranslations() {
  const contents = readFileSync(POLISH, 'utf8');
  const parser = new Xliff2TranslationParser();
  const hint = parser.analyze(POLISH, contents);
  if (!hint.canParse) {
    throw new Error(`${POLISH}: not an XLIFF 2.0 file`);
  }
  const { translations, diagnostics } = parser.parse(POLISH, contents, hint.hint);
  if (diagnostics.messages.length > 0) {
    throw new Error(diagnostics.messages.map((message) => message.message).join('\n'));
  }
  return translations;
}

function runtimeString(translation) {
  let text = translation.messageParts[0];
  translation.placeholderNames.forEach((name, index) => {
    text += `{$${name}}${translation.messageParts[index + 1]}`;
  });
  return text;
}

function sourcePlaceholders() {
  const units = new Map();
  for (const match of readFileSync(SOURCE, 'utf8').matchAll(
    /<unit id="([^"]+)">[\s\S]*?<source>([\s\S]*?)<\/source>/g,
  )) {
    const names = [...match[2].matchAll(/ (?:equiv|equivStart|equivEnd)="([^"]+)"/g)].map((ph) => ph[1]).sort();
    units.set(match[1], names);
  }
  return units;
}

const command = process.argv[2];
if (command === 'json') {
  const output = {};
  for (const [id, translation] of Object.entries(polishTranslations())) {
    output[id] = runtimeString(translation);
  }
  mkdirSync('public/i18n', { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 1)}\n`);
} else if (command === 'check') {
  const source = sourcePlaceholders();
  const polish = polishTranslations();
  const problems = [];
  for (const [id, names] of source) {
    const translation = polish[id];
    if (!translation || runtimeString(translation).trim() === '') {
      problems.push(`${id}: no Polish translation`);
    } else if (JSON.stringify([...translation.placeholderNames].sort()) !== JSON.stringify(names)) {
      problems.push(`${id}: placeholders differ (${names.join(',')} vs ${translation.placeholderNames.join(',')})`);
    }
  }
  for (const id of Object.keys(polish)) {
    if (!source.has(id)) {
      problems.push(`${id}: translated but not in the source`);
    }
  }
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`i18n: ${source.size} texts, all translated`);
} else {
  console.error('usage: node scripts/i18n.mjs json|check');
  process.exit(2);
}
