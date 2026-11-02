// Syntaxe de tous les modules du jeu (js/*.js), avant d'ouvrir Chrome : une erreur de syntaxe
// (une apostrophe non échappée dans un texte, par exemple) casserait la page entière, et chaque
// contrôle échouerait sans dire pourquoi. Appelé au début de chaque banc de test ;
// seul : node tests/syntaxe.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Liste des erreurs : [{ file, message }] (vide : tout est bon)
export function syntaxErrors() {
  const dir = path.join(ROOT, 'js'), out = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    // les fichiers sont des modules ES : sans ce drapeau, « node --check » ne les analyse pas vraiment
    const r = spawnSync(process.execPath, ['--experimental-default-type=module', '--check', path.join(dir, f)], { encoding: 'utf8' });
    if (r.status !== 0) out.push({ file: 'js/' + f, message: (r.stderr || '').split('\n').filter(l => l.trim()).slice(0, 4).join('\n') });
  }
  return out;
}

// Arrête le banc de test si un module ne se lit pas
export function requireValidSyntax() {
  const errs = syntaxErrors();
  if (!errs.length) return;
  for (const e of errs) console.log(`ECHEC syntaxe ${e.file}\n${e.message}`);
  console.log(`RESULTAT ${errs.length} module(s) illisible(s)`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errs = syntaxErrors();
  for (const e of errs) console.log(`ECHEC ${e.file}\n${e.message}`);
  console.log(errs.length ? `RESULTAT ${errs.length} module(s) illisible(s)` : 'RESULTAT TOUT OK (syntaxe)');
  process.exit(errs.length ? 1 : 0);
}
