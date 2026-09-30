// .NET Regex semantics the runtime emulates: x-mode, substring Match, Captures of repeated groups.
import { it, expect } from 'vitest';
import { boot } from './helpers';

it('emulates .NET Regex options, substring matches and repeated-group captures', () => {
  const G: any = boot();
  const Regex = G.$.ext('System.Text.RegularExpressions.Regex');
  // IgnorePatternWhitespace (32): whitespace and # comments are not part of the pattern
  const x = new Regex('^ a \\  b # comment\n [ ]c', 32);
  expect(x.IsMatch('a b c')).toBe(true);
  // SmartFormat's complex condition: Match(s, beginning, length) + every capture of the repeated group
  const cond = new Regex('^  (?:   ([&/]?)   ([<>=!]=?)   ([0-9.-]+)   )+   \\?', 8 | 32);
  const s = 'xx>=1&<5?yes';
  const m = cond.Match(s, 2, s.length - 2);
  expect(m.Success).toBe(true);
  expect(m.Index).toBe(2);
  expect(m.Groups.get_Item(2).Captures.map((c: any) => c.Value)).toEqual(['>=', '<']);
  expect(m.Groups.get_Item(3).Captures.map((c: any) => c.Value)).toEqual(['1', '5']);
  expect(m.Groups.get_Item(1).Captures.map((c: any) => c.Value)).toEqual(['', '&']);
  expect(m.Groups.get_Item(3).Captures[1].Index).toBe(7);
  // ^ anchors at `beginning`, not at 0
  expect(cond.Match(s, 0, s.length).Success).toBe(false);
  // Match(s, startat) keeps ^ at 0
  expect(new Regex('^b').Match('ab', 1).Success).toBe(false);
  // exact group indices
  expect(new Regex('(a)(a)').Match('xaa').Groups.get_Item(2).Index).toBe(2);
});

it('formats SmartFormat complex conditions with every clause', () => {
  const G: any = boot();
  const fmt = (n: number) => G.LocManager._smartFormatter.Format$IFormatProvider_String_ObjectArr(null, '{0:cond:>=1&<5?mid|out}', [n]);
  expect([0, 1, 4, 5].map(fmt)).toEqual(['out', 'mid', 'mid', 'out']);
});
