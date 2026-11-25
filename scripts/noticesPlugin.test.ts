import { describe, expect, it } from 'vitest';
import { licenceProblems } from './noticesPlugin';

const pkg = (licence: string, files = ['LICENSE']) => ({ name: 'x', version: '1.0.0', licence, texts: files.map((file) => ({ file, text: 'text' })) });

describe('which licences Antogo may ship', () => {
  it('the permissive ones pass', () => {
    for (const l of ['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1', '(MIT OR Apache-2.0)']) expect(licenceProblems(pkg(l)), l).toEqual([]);
  });
  it('copyleft, unknown and unstated licences stop the build', () => {
    for (const l of ['GPL-3.0', 'LGPL-2.1', 'AGPL-3.0-only', 'GPL-2.0-or-later', 'SEE LICENSE IN LICENSE.txt', 'UNLICENSED', '']) expect(licenceProblems(pkg(l)).length, l).toBeGreaterThan(0);
  });
  it('a package with no licence file stops the build, whatever it says of itself', () => {
    expect(licenceProblems(pkg('MIT', []))[0]).toMatch(/no licence file/);
    expect(licenceProblems(pkg('MIT', ['NOTICE']))[0]).toMatch(/no licence file/);
  });
});
