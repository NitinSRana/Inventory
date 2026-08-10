import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapHeaders, parseCsv } from './csv.ts';

test('parses a plain file', () => {
  assert.deepEqual(parseCsv('name,ean\nMilk,123\nBread,456'), [
    ['name', 'ean'],
    ['Milk', '123'],
    ['Bread', '456'],
  ]);
});

test('keeps commas inside quoted fields', () => {
  // The whole reason this is not a String.split.
  assert.deepEqual(parseCsv('name,ean\n"Milch, fettarm 1L",4001234567890'), [
    ['name', 'ean'],
    ['Milch, fettarm 1L', '4001234567890'],
  ]);
});

test('handles escaped quotes and embedded newlines', () => {
  assert.deepEqual(parseCsv('name\n"He said ""hi"""\n"two\nlines"'), [
    ['name'],
    ['He said "hi"'],
    ['two\nlines'],
  ]);
});

test('accepts CRLF and a UTF-8 BOM from Excel', () => {
  assert.deepEqual(parseCsv('﻿name,ean\r\nMilk,123\r\n'), [
    ['name', 'ean'],
    ['Milk', '123'],
  ]);
});

test('drops trailing blank lines', () => {
  assert.equal(parseCsv('name\nMilk\n\n\n').length, 2);
});

test('preserves empty fields in the middle of a row', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3'), [
    ['a', 'b', 'c'],
    ['1', '', '3'],
  ]);
});

test('maps headers regardless of case, spacing or punctuation', () => {
  const index = mapHeaders(['Product Name', ' EAN ', 'Cost_Price', 'Sell price']);
  assert.equal(index.name, 0);
  assert.equal(index.gtin, 1);
  assert.equal(index.costPrice, 2);
  assert.equal(index.sellPrice, 3);
});

test('ignores columns it does not recognise', () => {
  const index = mapHeaders(['name', 'shelf location', 'notes']);
  assert.deepEqual(index, { name: 0 });
});

test('first matching column wins when a header repeats', () => {
  const index = mapHeaders(['ean', 'barcode']);
  assert.equal(index.gtin, 0);
});

test('accepts semicolon separators, as German Excel writes', () => {
  assert.deepEqual(parseCsv('name;ean\nMilch;123'), [
    ['name', 'ean'],
    ['Milch', '123'],
  ]);
});

test('a decimal comma survives a semicolon-separated file', () => {
  // German Excel: ";" separates fields, "," is the decimal point. Treating both
  // as delimiters shears 0,79 into two fields and imports a null price.
  assert.deepEqual(parseCsv('name;cost\nMilch;0,79'), [
    ['name', 'cost'],
    ['Milch', '0,79'],
  ]);
});

test('a semicolon inside a comma-separated file is just text', () => {
  assert.deepEqual(parseCsv('name,note\nMilk,a;b'), [
    ['name', 'note'],
    ['Milk', 'a;b'],
  ]);
});
