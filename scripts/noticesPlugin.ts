/**
 * Open-source notices, made at every build from what that build actually ships (24 Nov 2026).
 *
 * The pages' own bundle is read for the packages it holds; to those are added what the bundle takes in by other
 * routes (the typeface, from the stylesheet; the offline support of the web version). Each package's licence text,
 * and any NOTICE file it ships, go into notices.txt, which Settings, About and legal shows. The iPhone and iPad app's
 * shell and the Mac app's engine have their own files, notices-ios.txt and notices-mac.txt.
 *
 * The build stops if a shipped package has no licence file, or carries a licence that isn't on the list below:
 * copyleft licences (GPL, LGPL, AGPL and the like) sit badly with the App Store's terms and with Antogo's own.
 * (Garmin's FIT SDK is used only by Antogo's tests, to cross-check its own reader and writer of ride files; it is not
 * in the pages and so not here. Were it ever imported by the app, its licence is not on the list and the build stops.)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const ALLOWED = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1']);
/** Taken into the pages other than through the bundle's imports. */
const ALSO_SHIPPED = ['@fontsource-variable/archivo', 'workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', 'workbox-expiration', 'workbox-cacheable-response', 'workbox-window'];

const NM = join(process.cwd(), 'node_modules');

export interface Pkg { name: string; version: string; licence: string; texts: Array<{ file: string; text: string }> }

function readPkg(name: string): Pkg {
  const dir = join(NM, name);
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; license?: string | { type?: string } };
  const licence = typeof json.license === 'string' ? json.license : json.license?.type ?? '';
  const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice|copyrightnotice)(\.(md|txt))?$/i.test(f)).sort();
  return { name, version: json.version, licence, texts: files.map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8').trim() })) };
}

/** The problems with one package's licence, in words; empty when it is fine to ship. */
export function licenceProblems(p: Pkg): string[] {
  const out: string[] = [];
  if (!p.texts.some((t) => /^(licen[cs]e|copying)/i.test(t.file))) out.push(`${p.name} ships no licence file`);
  const ids = p.licence.replace(/[()]/g, ' ').split(/\s+(?:OR|AND)\s+|\s+/).filter(Boolean);
  if (!ids.length || !ids.some((id) => ALLOWED.has(id))) out.push(`${p.name} is licensed "${p.licence || 'unstated'}", which is not on the list of licences Antogo may ship`);
  if (/GPL/i.test(p.licence)) out.push(`${p.name} carries a copyleft licence (${p.licence})`);
  return out;
}

function noticeText(title: string, intro: string, pkgs: Pkg[]): string {
  const rule = '='.repeat(72);
  return [title, '', intro, '', ...pkgs.flatMap((p) => [rule, `${p.name} ${p.version}`, `Licence: ${p.licence}`, '', ...p.texts.flatMap((t) => [t.text, ''])])].join('\n');
}

const pkgOf = (id: string): string | null => {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id.replace(/\\/g, '/'));
  return m ? m[1] : null;
};

const APACHE_CORDOVA_NOTICE = `Apache Cordova
Copyright 2012 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).`;

export function noticesPlugin(): Plugin {
  return {
    name: 'antogo-notices',
    apply: 'build',
    generateBundle() {
      const names = new Set<string>(ALSO_SHIPPED.filter((n) => existsSync(join(NM, n, 'package.json'))));
      for (const id of this.getModuleIds()) { const n = pkgOf(id); if (n) names.add(n); }
      const pkgs = [...names].sort().map(readPkg);
      const problems = pkgs.flatMap(licenceProblems);
      if (problems.length) this.error(`Open-source licence check failed:\n- ${problems.join('\n- ')}`);
      this.emitFile({
        type: 'asset', fileName: 'notices.txt',
        source: noticeText('Antogo: open-source and third-party notices', 'The pages of Antogo, in every version (in a browser, for the Mac, and for iPhone and iPad), include the following software, each under its own licence, reproduced below. The map data shown on activity maps is © OpenStreetMap contributors, available under the Open Database Licence (openstreetmap.org/copyright).', pkgs),
      });
      // iPhone and iPad: the shell the pages run in. Its Cordova-compatibility part comes from Apache Cordova.
      const ios = readPkg('@capacitor/ios');
      const dexie = readPkg('dexie');   // its LICENSE is the Apache License 2.0's full text
      const apache = dexie.texts.find((t) => /^licen/i.test(t.file))?.text ?? '';
      this.emitFile({
        type: 'asset', fileName: 'notices-ios.txt',
        source: [noticeText('Antogo for iPhone and iPad: the app\'s shell', 'The iPhone and iPad app runs Antogo\'s pages inside Capacitor, under its own licence, reproduced below.', [ios]), '='.repeat(72), 'CapacitorCordova (part of Capacitor) includes code from Apache Cordova, licensed under the Apache License 2.0:', '', APACHE_CORDOVA_NOTICE, '', apache].join('\n'),
      });
      const electron = readPkg('electron');
      this.emitFile({
        type: 'asset', fileName: 'notices-mac.txt',
        source: noticeText('Antogo for the Mac: the app\'s engine', 'The Mac app runs Antogo\'s pages inside Electron, which includes Chromium and Node.js. Electron\'s licence is reproduced below; the licences of Chromium and its many parts are in the full list the app opens from Settings, About and legal.', [electron]),
      });
    },
  };
}
