import { type Arbitrary, constant, constantFrom, integer, nat, oneof, record, string } from 'fast-check'

const byteOrderMark = String.fromCharCode(0xfeff)

export const hostileSnippets = [
  '<!DOCTYPE a [<!ENTITY x "xx">]>',
  '&x;',
  '&#0;',
  '&#xD800;',
  '&#99999999999;',
  '<__proto__><polluted>1</polluted></__proto__>',
  '<constructor><prototype><polluted>1</polluted></prototype></constructor>',
  ' __proto__="1"',
  ' xmlns:__proto__="urn:polluted"',
  ' xmlns="urn:x"',
  ' xmlns:="urn:x"',
  '<?php ?>',
  '<![CDATA[',
  ']]>',
  '<!--',
  '-->',
  '</',
  '/>',
  '"',
  "'",
  '=',
  String.fromCharCode(0),
  byteOrderMark,
  '<a:b:c>',
  '<'.repeat(64)
]

export type Mutation =
  | { kind: 'delete'; at: number; length: number }
  | { kind: 'insert'; at: number; text: string }
  | { kind: 'truncate'; at: number }
  | { kind: 'duplicate'; at: number; length: number }

export const mutation: Arbitrary<Mutation> = oneof(
  record({ kind: constant('delete' as const), at: nat(), length: integer({ min: 1, max: 64 }) }),
  record({ kind: constant('insert' as const), at: nat(), text: oneof(string(), constantFrom(...hostileSnippets)) }),
  record({ kind: constant('truncate' as const), at: nat() }),
  record({ kind: constant('duplicate' as const), at: nat(), length: integer({ min: 1, max: 512 }) })
)

export const applyMutation = (xml: string, change: Mutation): string => {
  const at = change.at % (xml.length + 1)
  switch (change.kind) {
    case 'delete':
      return xml.slice(0, at) + xml.slice(at + change.length)
    case 'insert':
      return xml.slice(0, at) + change.text + xml.slice(at)
    case 'truncate':
      return xml.slice(0, at)
    case 'duplicate':
      return xml.slice(0, at) + xml.slice(at, at + change.length).repeat(2) + xml.slice(at + change.length)
  }
}
