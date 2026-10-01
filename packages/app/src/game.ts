// Access to the transpiled rule layer with loose typing (generated file is @ts-nocheck).
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Core from '@sts2/core';
export const G: any = Core;
export const $: any = Core.$;
export const N = (path: string): any => $.ext('MegaCrit.Sts2.Core.Nodes.' + path);
export const enumName = (e: any, v: number) => $.enumStr(e, v);
export const list = <T = any>(x: any): T[] => (x == null ? [] : Array.from($.iter(x)));
